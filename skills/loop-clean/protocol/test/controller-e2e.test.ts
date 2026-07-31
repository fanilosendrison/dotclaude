import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeFindingId } from "../src/findings/finding-id.ts";
import type { RoutingCategory } from "../src/routing/routing-schema.ts";
import {
	createReadOnlyGitWrapper,
	createRepository,
	parseShellExports,
	removeRepository,
	runGit,
	runProcess,
	writeRepositoryFile,
} from "./helpers/git-fixture.ts";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const controller = join(repositoryRoot, "skills/loop-clean/loop-clean.sh");
const repositories: string[] = [];
const externalDirectories: string[] = [];
let sessionCounter = 0;

interface RunContext {
	readonly root: string;
	readonly cwd: string;
	readonly environment: Record<string, string>;
	readonly wrapperLog: string;
	readonly initialHead: string;
	readonly initialIndex: string;
}

async function createLoopRepository(): Promise<string> {
	const root = await createRepository();
	repositories.push(root);
	await writeRepositoryFile(root, ".gitignore", ".claude/run/\n");
	await runGit(root, ["add", ".gitignore"]);
	await runGit(root, ["commit", "--quiet", "-m", "ignore runtime state"]);
	return root;
}

async function startRun(options?: {
	readonly root?: string;
	readonly cwd?: string;
}): Promise<RunContext> {
	const root = options?.root ?? (await createLoopRepository());
	const cwd = options?.cwd ?? root;
	const wrapperParent = await mkdtemp(
		join(tmpdir(), "loop-clean-git-wrapper-"),
	);
	externalDirectories.push(wrapperParent);
	const wrapper = await createReadOnlyGitWrapper(wrapperParent);
	const initialHead = await runGit(root, ["rev-parse", "HEAD"]);
	const initialIndex = await runGit(root, ["ls-files", "--stage"]);
	const baseEnvironment: Record<string, string> = {
		LOOP_CLEAN_SESSION_ID: `e2e-${process.pid}-${sessionCounter++}`,
		PATH: `${wrapper.binDirectory}:${process.env.PATH ?? ""}`,
	};
	const init = await runProcess(["bash", controller, "init"], {
		cwd,
		env: baseEnvironment,
	});
	expect(init.exitCode).toBe(0);
	const exported = parseShellExports(init.stdout);
	return {
		root,
		cwd,
		environment: { ...baseEnvironment, ...exported },
		wrapperLog: wrapper.logPath,
		initialHead,
		initialIndex,
	};
}

async function controllerCommand(context: RunContext, args: readonly string[]) {
	return await runProcess(["bash", controller, ...args], {
		cwd: context.cwd,
		env: context.environment,
	});
}

async function prepareIteration(
	context: RunContext,
	iteration: number,
): Promise<Record<string, string>> {
	const result = await controllerCommand(context, [
		"prepare-iter",
		String(iteration),
	]);
	expect(result.exitCode).toBe(0);
	return parseShellExports(result.stdout);
}

const semanticFindingIds = new Map<string, string>();

function semanticFinding(
	source: string,
	label: string,
): Record<string, unknown> {
	const axis = source === "dedup-codebase" ? "duplication-intra" : "edge-cases";
	const problem = `${source} ${label} stable finding`;
	const id = computeFindingId(source, "fresh.ts", 1, axis, problem);
	semanticFindingIds.set(label, id);
	return {
		id,
		source,
		axis,
		severity: "major",
		file: "fresh.ts",
		line_start: 1,
		line_end: 1,
		problem,
		evidence: "evidence",
		fix_proposal: "fix",
	};
}

async function writeSemanticReports(
	iterationEnvironment: Record<string, string>,
	findings: Partial<
		Record<
			"coding-standards" | "senior-review" | "dedup-codebase",
			readonly Record<string, unknown>[]
		>
	> = {},
): Promise<void> {
	const digest = iterationEnvironment.LOOP_CLEAN_SCOPE_DIGEST;
	for (const [source, environmentName] of [
		["coding-standards", "LOOP_CLEAN_JSON_OUT_CODING_STANDARDS"],
		["senior-review", "LOOP_CLEAN_JSON_OUT_SENIOR_REVIEW"],
		["dedup-codebase", "LOOP_CLEAN_JSON_OUT_DEDUP_CODEBASE"],
	] as const) {
		await writeFile(
			iterationEnvironment[environmentName],
			`${JSON.stringify({
				skill: source,
				scope_digest: digest,
				findings: findings[source] ?? [],
			})}\n`,
		);
	}
}

async function runCollection(
	context: RunContext,
	iteration: number,
	iterationEnvironment: Record<string, string>,
): Promise<void> {
	Object.assign(context.environment, iterationEnvironment);
	const gate = await controllerCommand(context, [
		"runtime-gate",
		String(iteration),
	]);
	expect(gate.exitCode).toBe(0);
	const collect = await controllerCommand(context, [
		"collect-findings",
		String(iteration),
	]);
	expect(collect.exitCode).toBe(0);
}

function routingEntry(category: RoutingCategory, labelOrId: string) {
	const findingId = semanticFindingIds.get(labelOrId) ?? labelOrId;
	if (category === "fix_now_applied") {
		return {
			finding_id: findingId,
			files_touched: ["fresh.ts"],
			change_summary: "fixed demonstrated problem",
		};
	}
	if (category === "backlog_added" || category === "backlog_existing") {
		return {
			finding_id: findingId,
			file: "fresh.ts",
			severity: "major",
			reason: "bounded work deferred",
		};
	}
	if (
		category === "design_queue_added" ||
		category === "design_queue_existing"
	) {
		return {
			finding_id: findingId,
			file: "fresh.ts",
			reason: "human design decision required",
		};
	}
	return { finding_id: findingId, reason: "ambiguous outcome" };
}

async function writeRouting(
	iterationEnvironment: Record<string, string>,
	iteration: number,
	categories: Partial<Record<RoutingCategory, readonly string[]>>,
): Promise<void> {
	const routing: Record<string, unknown> = {
		skill: "fix-or-backlog",
		iteration,
		scope_digest: iterationEnvironment.LOOP_CLEAN_SCOPE_DIGEST,
		fix_now_applied: [],
		backlog_added: [],
		backlog_existing: [],
		design_queue_added: [],
		design_queue_existing: [],
		escalated: [],
		notes: [],
	};
	for (const [category, ids] of Object.entries(categories)) {
		routing[category] =
			ids?.map((value) => routingEntry(category as RoutingCategory, value)) ??
			[];
	}
	await writeFile(
		iterationEnvironment.LOOP_CLEAN_JSON_OUT_FIX_OR_BACKLOG,
		`${JSON.stringify(routing)}\n`,
	);
}

afterEach(async () => {
	for (const root of repositories.splice(0)) await removeRepository(root);
	for (const directory of externalDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("loop-clean controller E2E", () => {
	test("resolves the nearest Git root from a subdirectory and reports no changes", async () => {
		const root = await createLoopRepository();
		const subdirectory = join(root, "nested", "work");
		await mkdir(subdirectory, { recursive: true });
		const context = await startRun({ root, cwd: subdirectory });
		expect(context.environment.LOOP_CLEAN_REPO_ROOT).toBe(root);
		expect(context.environment.GIT_OPTIONAL_LOCKS).toBe("0");
		expect(context.environment.LOOP_CLEAN_RUN_DIR).toStartWith(
			join(root, ".claude/run/loop-clean/"),
		);
		expect(context.environment.LOOP_CLEAN_BACKLOG_PATH).toBe(
			join(root, "backlog.md"),
		);
		const iteration = await prepareIteration(context, 0);
		expect(Number(iteration.LOOP_CLEAN_AUDITABLE_COUNT)).toBe(0);
		Object.assign(context.environment, iteration);
		const decision = await controllerCommand(context, ["decide", "0"]);
		expect(decision.exitCode).toBe(0);
		expect(decision.stdout.trim()).toBe("EXIT_NO_CHANGES");
	});

	test("returns EXIT_CLEAN only after all four reports and a passing or skipped runtime gate", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		const iteration = await prepareIteration(context, 0);
		await writeSemanticReports(iteration);
		await runCollection(context, 0, iteration);
		const decision = await controllerCommand(context, ["decide", "0"]);
		expect(decision.stdout.trim()).toBe("EXIT_CLEAN");
	});

	test.each([
		"coding-standards",
		"senior-review",
		"dedup-codebase",
	] as const)("continues for a finding emitted only by %s", async (source) => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		const iteration = await prepareIteration(context, 0);
		await writeSemanticReports(iteration, {
			[source]: [semanticFinding(source, `${source}-id`)],
		});
		await runCollection(context, 0, iteration);
		const decision = await controllerCommand(context, ["decide", "0"]);
		expect(decision.stdout.trim()).toBe("CONTINUE");
	});

	test("runtime failure is actionable before decision and prevents false CLEAN", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		await writeRepositoryFile(
			root,
			"STACK_EVAL.yaml",
			'test_command: "exit 5"\n',
		);
		const context = await startRun({ root });
		const iteration = await prepareIteration(context, 0);
		await writeSemanticReports(iteration);
		await runCollection(context, 0, iteration);
		const findings = JSON.parse(
			await readFile(iteration.LOOP_CLEAN_FINDINGS_FILE, "utf8"),
		);
		expect(findings.runtime_gate_status).toBe("fail");
		expect(findings.actionable_findings[0].axis).toBe("runtime-failure");
		const decision = await controllerCommand(context, ["decide", "0"]);
		expect(decision.stdout.trim()).toBe("CONTINUE");
	});

	test("returns EXIT_HANDLED when every re-emitted finding was deferred", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		const first = await prepareIteration(context, 0);
		await writeSemanticReports(first, {
			"senior-review": [semanticFinding("senior-review", "deferred-id")],
		});
		await runCollection(context, 0, first);
		expect(
			(await controllerCommand(context, ["decide", "0"])).stdout.trim(),
		).toBe("CONTINUE");
		await writeRouting(first, 0, { backlog_added: ["deferred-id"] });
		Object.assign(context.environment, first);
		expect(
			(await controllerCommand(context, ["validate-routing", "0"])).exitCode,
		).toBe(0);

		const second = await prepareIteration(context, 1);
		await writeSemanticReports(second, {
			"senior-review": [semanticFinding("senior-review", "deferred-id")],
		});
		await runCollection(context, 1, second);
		const decision = await controllerCommand(context, ["decide", "1"]);
		expect(decision.stdout.trim()).toBe("EXIT_HANDLED");
	});

	test("detects actionable oscillation and treats a changed ID as new", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		for (const [iterationNumber, id] of [
			[0, "stable-id"],
			[1, "stable-id"],
		] as const) {
			const iteration = await prepareIteration(context, iterationNumber);
			await writeSemanticReports(iteration, {
				"coding-standards": [semanticFinding("coding-standards", id)],
			});
			await runCollection(context, iterationNumber, iteration);
			const decision = await controllerCommand(context, [
				"decide",
				String(iterationNumber),
			]);
			if (iterationNumber === 0) {
				expect(decision.stdout.trim()).toBe("CONTINUE");
				await writeRouting(iteration, 0, { fix_now_applied: [id] });
				Object.assign(context.environment, iteration);
				expect(
					(await controllerCommand(context, ["validate-routing", "0"]))
						.exitCode,
				).toBe(0);
			} else {
				expect(decision.stdout.trim()).toBe("EXIT_OSCILLATION");
			}
		}
	});

	test("recalculates scope so a file created by a fix appears next iteration", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		const first = await prepareIteration(context, 0);
		await writeRepositoryFile(
			root,
			"created-by-fix.ts",
			"export const created = true;\n",
		);
		const second = await prepareIteration(context, 1);
		expect(second.LOOP_CLEAN_SCOPE_DIGEST).not.toBe(
			first.LOOP_CLEAN_SCOPE_DIGEST,
		);
		const scope = JSON.parse(
			await readFile(second.LOOP_CLEAN_SCOPE_FILE, "utf8"),
		);
		expect(
			scope.entries.map((entry: { path: string }) => entry.path),
		).toContain("created-by-fix.ts");
	});

	test("fails closed when a source report is missing", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		const iteration = await prepareIteration(context, 0);
		Object.assign(context.environment, iteration);
		await writeFile(
			iteration.LOOP_CLEAN_JSON_OUT_CODING_STANDARDS,
			`${JSON.stringify({ skill: "coding-standards", scope_digest: iteration.LOOP_CLEAN_SCOPE_DIGEST, findings: [] })}\n`,
		);
		await writeFile(
			iteration.LOOP_CLEAN_JSON_OUT_SENIOR_REVIEW,
			`${JSON.stringify({ skill: "senior-review", scope_digest: iteration.LOOP_CLEAN_SCOPE_DIGEST, findings: [] })}\n`,
		);
		expect(
			(await controllerCommand(context, ["runtime-gate", "0"])).exitCode,
		).toBe(0);
		const collect = await controllerCommand(context, ["collect-findings", "0"]);
		expect(collect.exitCode).not.toBe(0);
		const finalize = await controllerCommand(context, ["finalize"]);
		expect(finalize.exitCode).not.toBe(0);
		expect(finalize.stdout).toContain("EXIT_PROTOCOL_ERROR");
	});

	test("preserves HEAD and index and only invokes read-only Git through the wrapper", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		const iteration = await prepareIteration(context, 0);
		await writeSemanticReports(iteration);
		await runCollection(context, 0, iteration);
		expect(
			(await controllerCommand(context, ["decide", "0"])).stdout.trim(),
		).toBe("EXIT_CLEAN");
		const finalize = await controllerCommand(context, ["finalize"]);
		expect(finalize.exitCode).toBe(0);
		expect(await runGit(root, ["rev-parse", "HEAD"])).toBe(context.initialHead);
		expect(await runGit(root, ["ls-files", "--stage"])).toBe(
			context.initialIndex,
		);
		const log = await readFile(context.wrapperLog, "utf8");
		expect(log).not.toContain("BLOCKED_MUTATING_GIT_COMMAND");
		for (const line of log.trim().split("\n")) {
			expect(line).toMatch(
				/(?:^|\t)(rev-parse|status|diff|ls-files|show|cat-file|check-ignore)(?:\t|$)/,
			);
		}
		const blocked = await runProcess(["git", "-C", root, "add", "fresh.ts"], {
			cwd: root,
			env: context.environment,
		});
		expect(blocked.exitCode).toBe(97);
		expect(blocked.stderr).toContain("BLOCKED_MUTATING_GIT_COMMAND add");
	});

	test("finalize reports an external index mutation as a protocol error without restoring it", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		await runGit(root, ["add", "fresh.ts"]);
		const finalize = await controllerCommand(context, ["finalize"]);
		expect(finalize.exitCode).not.toBe(0);
		expect(finalize.stdout).toContain("EXIT_PROTOCOL_ERROR");
		expect(finalize.stdout).toContain("index changed");
		expect(await runGit(root, ["diff", "--cached", "--name-only"])).toContain(
			"fresh.ts",
		);
	});

	test("runtime-gate rejects scope when index changed after capture", async () => {
		const root = await createLoopRepository();
		const context = await startRun({ root });
		const iteration = await prepareIteration(context, 0);

		// Mutate the index without touching the worktree
		await runGit(root, ["update-index", "--chmod=+x", ".gitignore"]);

		// runtime-gate recalculates scope and must detect the index divergence
		const gate = await controllerCommand(context, [
			"runtime-gate",
			"0",
		]);
		expect(gate.exitCode).not.toBe(0);
		expect(gate.stderr).toMatch(/scope.*changed|index|diverg/i);
	});

	test("treats a deferred finding with a new ID as actionable", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		const first = await prepareIteration(context, 0);
		await writeSemanticReports(first, {
			"senior-review": [semanticFinding("senior-review", "old-id")],
		});
		await runCollection(context, 0, first);
		expect(
			(await controllerCommand(context, ["decide", "0"])).stdout.trim(),
		).toBe("CONTINUE");
		await writeRouting(first, 0, { backlog_added: ["old-id"] });
		Object.assign(context.environment, first);
		expect(
			(await controllerCommand(context, ["validate-routing", "0"])).exitCode,
		).toBe(0);

		const second = await prepareIteration(context, 1);
		await writeSemanticReports(second, {
			"senior-review": [semanticFinding("senior-review", "new-id")],
		});
		await runCollection(context, 1, second);
		const findings = JSON.parse(
			await readFile(second.LOOP_CLEAN_FINDINGS_FILE, "utf8"),
		);
		expect(
			findings.actionable_findings.map((entry: { id: string }) => entry.id),
		).toEqual([semanticFindingIds.get("new-id")]);
		expect(
			(await controllerCommand(context, ["decide", "1"])).stdout.trim(),
		).toBe("CONTINUE");
	});

	test("returns EXIT_CEILING at iteration nine with changing actionable IDs", async () => {
		const root = await createLoopRepository();
		await writeRepositoryFile(root, "fresh.ts", "export const fresh = true;\n");
		const context = await startRun({ root });
		for (let iterationNumber = 0; iterationNumber < 10; iterationNumber += 1) {
			const iteration = await prepareIteration(context, iterationNumber);
			const findingId = `ceiling-${iterationNumber}`;
			await writeSemanticReports(iteration, {
				"coding-standards": [semanticFinding("coding-standards", findingId)],
			});
			await runCollection(context, iterationNumber, iteration);
			const decision = await controllerCommand(context, [
				"decide",
				String(iterationNumber),
			]);
			if (iterationNumber === 9) {
				expect(decision.stdout.trim()).toBe("EXIT_CEILING");
				break;
			}
			expect(decision.stdout.trim()).toBe("CONTINUE");
			await writeRouting(iteration, iterationNumber, {
				fix_now_applied: [findingId],
			});
			Object.assign(context.environment, iteration);
			expect(
				(
					await controllerCommand(context, [
						"validate-routing",
						String(iterationNumber),
					])
				).exitCode,
			).toBe(0);
		}
	}, 60_000);

	test("finalize reports an external HEAD mutation without restoring it", async () => {
		const root = await createLoopRepository();
		const context = await startRun({ root });
		await runGit(root, [
			"commit",
			"--quiet",
			"--allow-empty",
			"-m",
			"external head change",
		]);
		const changedHead = await runGit(root, ["rev-parse", "HEAD"]);
		expect(changedHead).not.toBe(context.initialHead);
		const finalize = await controllerCommand(context, ["finalize"]);
		expect(finalize.exitCode).not.toBe(0);
		expect(finalize.stdout).toContain("HEAD changed");
		expect(await runGit(root, ["rev-parse", "HEAD"])).toBe(changedHead);
	});

	test("the dynamic Git wrapper blocks add, commit, and push", async () => {
		const root = await createLoopRepository();
		const context = await startRun({ root });
		for (const commandName of ["add", "commit", "push"]) {
			const blocked = await runProcess(["git", "-C", root, commandName], {
				cwd: root,
				env: context.environment,
			});
			expect(blocked.exitCode).toBe(97);
			expect(blocked.stderr).toContain(
				`BLOCKED_MUTATING_GIT_COMMAND ${commandName}`,
			);
		}
	});

	test("rejects audit as an unknown argument", async () => {
		const root = await createLoopRepository();
		const result = await runProcess(["bash", controller, "init", "audit"], {
			cwd: root,
			env: { LOOP_CLEAN_SESSION_ID: "audit-is-removed" },
		});
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toMatch(/unknown.*audit/i);
	});
});
