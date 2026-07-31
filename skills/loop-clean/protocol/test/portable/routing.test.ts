import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeFindingId } from "../../src/findings/finding-id.ts";
import type { RoutingCategory } from "../../src/routing/routing-schema.ts";
import { validateRouting } from "../../src/routing/validate-routing.ts";

const temporaryDirectories: string[] = [];
const scopeDigest = "c".repeat(64);

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function setup(findings: readonly Record<string, unknown>[]): Promise<{
	readonly findingsFile: string;
	readonly routingFile: string;
	readonly deferredFile: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "loop-clean-routing-test-"));
	temporaryDirectories.push(directory);
	const findingsFile = join(directory, "findings.json");
	const routingFile = join(directory, "fix-or-backlog.json");
	const deferredFile = join(directory, "deferred-findings.json");
	await writeJson(findingsFile, {
		schema_version: 1,
		scope_digest: scopeDigest,
		sources: {
			"coding-standards": findings.length,
			"senior-review": 0,
			"dedup-codebase": 0,
			"runtime-gate": 0,
		},
		findings,
		actionable_findings: findings,
		previously_deferred_findings: [],
		runtime_gate_status: "pass",
		summary: {
			total: findings.length,
			actionable: findings.length,
			deferred: 0,
		},
	});
	await writeJson(deferredFile, { schema_version: 1, entries: [] });
	return { findingsFile, routingFile, deferredFile };
}

const findingIds = new Map<string, string>();

function finding(label: string, runtime = false): Record<string, unknown> {
	const source = runtime ? "runtime-gate" : "coding-standards";
	const axis = runtime ? "runtime-failure" : "typing";
	const file = runtime ? "" : "src/example.ts";
	const problem = `${label} stable problem`;
	const id = computeFindingId(source, file, null, axis, problem);
	findingIds.set(label, id);
	return {
		id,
		source,
		axis,
		severity: runtime ? "critical" : "minor",
		file,
		line_start: null,
		line_end: null,
		problem,
		evidence: "evidence",
		fix_proposal: "fix",
	};
}

function routeId(label: string): string {
	return (
		findingIds.get(label) ??
		computeFindingId(
			"coding-standards",
			"src/example.ts",
			null,
			"typing",
			`${label} stable problem`,
		)
	);
}

function routeEntry(
	category: RoutingCategory,
	label: string,
): Record<string, unknown> {
	const findingId = routeId(label);
	switch (category) {
		case "fix_now_applied":
			return {
				finding_id: findingId,
				files_touched: ["src/example.ts"],
				change_summary: "fixed demonstrated problem",
			};
		case "backlog_added":
		case "backlog_existing":
			return {
				finding_id: findingId,
				file: "src/example.ts",
				severity: "minor",
				reason: "bounded work deferred",
			};
		case "design_queue_added":
		case "design_queue_existing":
			return {
				finding_id: findingId,
				file: "src/example.ts",
				reason: "human design decision required",
			};
		case "escalated":
			return { finding_id: findingId, reason: "ambiguous outcome" };
	}
}

function routing(
	categories: Partial<Record<RoutingCategory, readonly string[]>>,
): Record<string, unknown> {
	const value: Record<string, unknown> = {
		skill: "fix-or-backlog",
		iteration: 2,
		scope_digest: scopeDigest,
		fix_now_applied: [],
		backlog_added: [],
		backlog_existing: [],
		design_queue_added: [],
		design_queue_existing: [],
		escalated: [],
		notes: [],
	};
	for (const [category, ids] of Object.entries(categories)) {
		value[category] =
			ids?.map((label) => routeEntry(category as RoutingCategory, label)) ?? [];
	}
	return value;
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("validateRouting", () => {
	test("accepts exact partitions across every terminal category", async () => {
		const inputs = await setup([
			finding("fix"),
			finding("backlog-new"),
			finding("backlog-old"),
			finding("design-new"),
			finding("design-old"),
			finding("escalated"),
		]);
		await writeJson(
			inputs.routingFile,
			routing({
				fix_now_applied: ["fix"],
				backlog_added: ["backlog-new"],
				backlog_existing: ["backlog-old"],
				design_queue_added: ["design-new"],
				design_queue_existing: ["design-old"],
				escalated: ["escalated"],
			}),
		);

		const result = await validateRouting({
			...inputs,
			deferredOutputFile: inputs.deferredFile,
		});
		expect(result.actionable_count).toBe(6);
		expect(result.routed_count).toBe(6);
		const deferred = JSON.parse(await Bun.file(inputs.deferredFile).text());
		expect(deferred.entries).toEqual(
			[
				{
					finding_id: routeId("backlog-new"),
					disposition: "backlog",
					iteration: 2,
				},
				{
					finding_id: routeId("backlog-old"),
					disposition: "backlog",
					iteration: 2,
				},
				{
					finding_id: routeId("design-new"),
					disposition: "design_queue",
					iteration: 2,
				},
				{
					finding_id: routeId("design-old"),
					disposition: "design_queue",
					iteration: 2,
				},
				{
					finding_id: routeId("escalated"),
					disposition: "escalated",
					iteration: 2,
				},
			].sort((left, right) => left.finding_id.localeCompare(right.finding_id)),
		);
	});

	test("accepts all-fix, all-backlog, and mixed partitions", async () => {
		for (const categories of [
			{ fix_now_applied: ["a", "b"] },
			{ backlog_added: ["a", "b"] },
			{ fix_now_applied: ["a"], backlog_added: ["b"] },
		]) {
			const inputs = await setup([finding("a"), finding("b")]);
			await writeJson(inputs.routingFile, routing(categories));
			await expect(
				validateRouting({ ...inputs, deferredOutputFile: inputs.deferredFile }),
			).resolves.toMatchObject({ actionable_count: 2, routed_count: 2 });
		}
	});

	test("rejects a forgotten finding", async () => {
		const inputs = await setup([finding("a"), finding("b")]);
		await writeJson(inputs.routingFile, routing({ fix_now_applied: ["a"] }));
		await expect(
			validateRouting({ ...inputs, deferredOutputFile: inputs.deferredFile }),
		).rejects.toThrow(/missing/i);
	});

	test("rejects one finding routed into two categories", async () => {
		const inputs = await setup([finding("a")]);
		await writeJson(
			inputs.routingFile,
			routing({ fix_now_applied: ["a"], backlog_added: ["a"] }),
		);
		await expect(
			validateRouting({ ...inputs, deferredOutputFile: inputs.deferredFile }),
		).rejects.toThrow(/more than one/i);
	});

	test("rejects invented IDs", async () => {
		const inputs = await setup([finding("a")]);
		await writeJson(
			inputs.routingFile,
			routing({ fix_now_applied: ["a"], backlog_added: ["invented"] }),
		);
		await expect(
			validateRouting({ ...inputs, deferredOutputFile: inputs.deferredFile }),
		).rejects.toThrow(/non-actionable/i);
	});

	test("requires runtime failures to be fixed now", async () => {
		const inputs = await setup([finding("runtime", true)]);
		for (const category of [
			"backlog_added",
			"backlog_existing",
			"design_queue_added",
			"design_queue_existing",
			"escalated",
		] as const) {
			await writeJson(inputs.routingFile, routing({ [category]: ["runtime"] }));
			await expect(
				validateRouting({ ...inputs, deferredOutputFile: inputs.deferredFile }),
			).rejects.toThrow(/runtime.*fix_now_applied/i);
		}
	});

	test("rejects a routing report with a divergent scope digest", async () => {
		const inputs = await setup([finding("a")]);
		await writeJson(inputs.routingFile, {
			...routing({ fix_now_applied: ["a"] }),
			scope_digest: "d".repeat(64),
		});
		await expect(
			validateRouting({ ...inputs, deferredOutputFile: inputs.deferredFile }),
		).rejects.toThrow(/scope_digest/i);
	});

	test("rejects routed findings without category-specific evidence", async () => {
		const inputs = await setup([finding("a")]);
		await writeJson(inputs.routingFile, {
			...routing({ fix_now_applied: [] }),
			fix_now_applied: [{ finding_id: routeId("a") }],
		});
		await expect(
			validateRouting({ ...inputs, deferredOutputFile: inputs.deferredFile }),
		).rejects.toThrow();
	});
});
