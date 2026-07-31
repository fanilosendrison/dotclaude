import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFindings } from "../../src/findings/collect-findings.ts";
import { computeFindingId } from "../../src/findings/finding-id.ts";
import type { FindingSource } from "../../src/findings/findings-schema.ts";

const temporaryDirectories: string[] = [];
const scopeDigest = "a".repeat(64);

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "loop-clean-findings-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

function finding(
	source: FindingSource,
	label: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const base = {
		source,
		axis: source === "runtime-gate" ? "runtime-failure" : "edge-cases",
		severity: source === "runtime-gate" ? "critical" : "major",
		file: source === "runtime-gate" ? "" : "src/example.ts",
		line_start: source === "runtime-gate" ? null : 1,
		line_end: source === "runtime-gate" ? null : 1,
		problem: `${source} ${label} stable problem`,
		evidence: "bounded evidence",
		fix_proposal: "Fix the demonstrated root cause.",
		...overrides,
	};
	return {
		id: computeFindingId(
			source,
			String(base.file),
			base.line_start as number | null,
			String(base.axis),
			String(base.problem),
		),
		...base,
	};
}

function idOf(value: Record<string, unknown>): string {
	return String(value.id);
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createInputs(
	reports: Partial<Record<FindingSource, Record<string, unknown>>> = {},
): Promise<{
	readonly iterationDirectory: string;
	readonly scopeFile: string;
	readonly deferredFile: string;
}> {
	const iterationDirectory = await temporaryDirectory();
	const scopeFile = join(iterationDirectory, "scope.json");
	const deferredFile = join(iterationDirectory, "deferred-findings.json");
	await writeJson(scopeFile, {
		schema_version: 2,
		repo_root: "/temporary/repository",
		generated_at: "informational",
		entries: [],
		index_digest: "e".repeat(64),
		content_digest: "f".repeat(64),
		digest: scopeDigest,
	});
	await writeJson(deferredFile, { schema_version: 1, entries: [] });
	for (const source of [
		"coding-standards",
		"senior-review",
		"dedup-codebase",
		"runtime-gate",
	] as const) {
		const defaultReport: Record<string, unknown> = {
			skill: source,
			scope_digest: scopeDigest,
			findings: [],
		};
		if (source === "runtime-gate") defaultReport.status = "pass";
		await writeJson(
			join(iterationDirectory, `${source}.json`),
			reports[source] ?? defaultReport,
		);
	}
	return { iterationDirectory, scopeFile, deferredFile };
}

describe("collectFindings", () => {
	test("aggregates exactly the four canonical sources", async () => {
		const entries = [
			finding("coding-standards", "coding"),
			finding("senior-review", "senior"),
			finding("dedup-codebase", "dedup"),
			finding("runtime-gate", "runtime"),
		];
		const inputs = await createInputs({
			"coding-standards": {
				skill: "coding-standards",
				scope_digest: scopeDigest,
				findings: [entries[0]],
			},
			"senior-review": {
				skill: "senior-review",
				scope_digest: scopeDigest,
				findings: [entries[1]],
			},
			"dedup-codebase": {
				skill: "dedup-codebase",
				scope_digest: scopeDigest,
				findings: [entries[2]],
			},
			"runtime-gate": {
				skill: "runtime-gate",
				scope_digest: scopeDigest,
				status: "fail",
				checks: [],
				findings: [entries[3]],
			},
		});
		const result = await collectFindings(inputs);
		expect(result.sources).toEqual({
			"coding-standards": 1,
			"senior-review": 1,
			"dedup-codebase": 1,
			"runtime-gate": 1,
		});
		expect(result.findings.map((entry) => entry.id).sort()).toEqual(
			entries.map(idOf).sort(),
		);
		expect(result.actionable_findings).toHaveLength(4);
		expect(result.summary).toEqual({ total: 4, actionable: 4, deferred: 0 });
		expect(result.runtime_gate_status).toBe("fail");
	});

	test("keeps re-emitted deferred findings visible but non-actionable", async () => {
		const deferredFinding = finding("senior-review", "deferred");
		const newFinding = finding("senior-review", "new", {
			problem: "new problem",
		});
		const inputs = await createInputs({
			"senior-review": {
				skill: "senior-review",
				scope_digest: scopeDigest,
				findings: [deferredFinding, newFinding],
			},
		});
		await writeJson(inputs.deferredFile, {
			schema_version: 1,
			entries: [
				{
					finding_id: idOf(deferredFinding),
					disposition: "backlog",
					iteration: 0,
				},
			],
		});
		const result = await collectFindings(inputs);
		expect(result.findings).toHaveLength(2);
		expect(
			result.previously_deferred_findings.map((entry) => entry.id),
		).toEqual([idOf(deferredFinding)]);
		expect(result.actionable_findings.map((entry) => entry.id)).toEqual([
			idOf(newFinding),
		]);
		expect(result.summary).toEqual({ total: 2, actionable: 1, deferred: 1 });
	});

	test("deduplicates identical IDs only when their complete content matches", async () => {
		const repeated = finding("senior-review", "same");
		const inputs = await createInputs({
			"senior-review": {
				skill: "senior-review",
				scope_digest: scopeDigest,
				findings: [repeated, repeated],
			},
		});
		expect((await collectFindings(inputs)).findings).toHaveLength(1);
		await writeJson(join(inputs.iterationDirectory, "senior-review.json"), {
			skill: "senior-review",
			scope_digest: scopeDigest,
			findings: [
				repeated,
				{
					...finding("senior-review", "different", {
						problem: "different content",
					}),
					id: idOf(repeated),
				},
			],
		});
		await expect(collectFindings(inputs)).rejects.toThrow(/not canonical/i);
	});

	test("fails closed on a missing report", async () => {
		const inputs = await createInputs();
		await rm(join(inputs.iterationDirectory, "coding-standards.json"));
		await expect(collectFindings(inputs)).rejects.toThrow(
			/coding-standards\.json.*missing/i,
		);
	});

	test("fails closed on malformed JSON", async () => {
		const inputs = await createInputs();
		await writeFile(
			join(inputs.iterationDirectory, "senior-review.json"),
			"{broken",
		);
		await expect(collectFindings(inputs)).rejects.toThrow(
			/senior-review\.json.*JSON/i,
		);
	});

	test("fails closed when any report has a divergent or absent scope digest", async () => {
		const inputs = await createInputs();
		await writeJson(join(inputs.iterationDirectory, "dedup-codebase.json"), {
			skill: "dedup-codebase",
			scope_digest: "b".repeat(64),
			findings: [],
		});
		await expect(collectFindings(inputs)).rejects.toThrow(/scope_digest/i);
		await writeJson(join(inputs.iterationDirectory, "dedup-codebase.json"), {
			skill: "dedup-codebase",
			findings: [],
		});
		await expect(collectFindings(inputs)).rejects.toThrow(/scope_digest/i);
	});

	test("rejects unknown sources, noncanonical IDs, and invalid severities", async () => {
		const inputs = await createInputs();
		for (const invalidFinding of [
			{ ...finding("senior-review", "bad-id"), id: "not-canonical" },
			finding("senior-review", "bad-source", { source: "fifth-source" }),
			finding("senior-review", "bad-severity", { severity: "urgent" }),
		]) {
			await writeJson(join(inputs.iterationDirectory, "senior-review.json"), {
				skill: "senior-review",
				scope_digest: scopeDigest,
				findings: [invalidFinding],
			});
			await expect(collectFindings(inputs)).rejects.toThrow();
		}
	});

	test("rejects a well-shaped but incorrectly computed ID", async () => {
		const inputs = await createInputs();
		await writeJson(join(inputs.iterationDirectory, "senior-review.json"), {
			skill: "senior-review",
			scope_digest: scopeDigest,
			findings: [{ ...finding("senior-review", "wrong"), id: "0".repeat(16) }],
		});
		await expect(collectFindings(inputs)).rejects.toThrow(/not canonical/i);
	});

	test("rejects runtime failures already present in the deferred registry", async () => {
		const runtimeFinding = finding("runtime-gate", "deferred-runtime");
		const inputs = await createInputs({
			"runtime-gate": {
				skill: "runtime-gate",
				scope_digest: scopeDigest,
				status: "fail",
				checks: [],
				findings: [runtimeFinding],
			},
		});
		await writeJson(inputs.deferredFile, {
			schema_version: 1,
			entries: [
				{
					finding_id: idOf(runtimeFinding),
					disposition: "backlog",
					iteration: 0,
				},
			],
		});
		await expect(collectFindings(inputs)).rejects.toThrow(/runtime.*defer/i);
	});
});
