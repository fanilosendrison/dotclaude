import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runRuntimeGate } from "../../src/runtime/run-runtime-gate.ts";
import { collectScope } from "../../src/scope/collect-scope.ts";
import {
	createRepository,
	removeRepository,
	writeRepositoryFile,
} from "../helpers/git-fixture.ts";

const repositories: string[] = [];

async function setup(
	stackEvaluation?: string,
	initialDirtyContent?: string,
): Promise<{
	readonly root: string;
	readonly scopeFile: string;
	readonly scopeDigest: string;
}> {
	const root = await createRepository();
	repositories.push(root);
	if (stackEvaluation !== undefined) {
		await writeRepositoryFile(root, "STACK_EVAL.yaml", stackEvaluation);
	}
	if (initialDirtyContent !== undefined) {
		await writeRepositoryFile(root, "dirty.ts", initialDirtyContent);
	}
	const manifest = await collectScope(root);
	const scopeFile = join(root, ".git", "loop-clean-runtime-scope.json");
	await Bun.write(scopeFile, `${JSON.stringify(manifest)}\n`);
	return { root, scopeFile, scopeDigest: manifest.digest };
}

afterEach(async () => {
	for (const root of repositories.splice(0)) await removeRepository(root);
});

describe("runRuntimeGate", () => {
	test("runs configured test, lint, and typecheck commands in protocol order", async () => {
		const { root, scopeFile, scopeDigest } = await setup(
			[
				'test_command: "printf test"',
				'lint_command: "printf lint"',
				'typecheck_command: "printf typecheck"',
				"",
			].join("\n"),
		);
		const report = await runRuntimeGate({ repoRoot: root, scopeFile });
		expect(report.status).toBe("pass");
		expect(report.scope_digest).toBe(scopeDigest);
		expect(
			report.checks.map((check) => [
				check.name,
				check.status,
				check.output_tail,
			]),
		).toEqual([
			["test", "pass", "test"],
			["lint", "pass", "lint"],
			["typecheck", "pass", "typecheck"],
		]);
		expect(report.findings).toEqual([]);
	});

	test("marks absent checks as skipped", async () => {
		const { root, scopeFile } = await setup();
		const report = await runRuntimeGate({ repoRoot: root, scopeFile });
		expect(report.status).toBe("skipped");
		expect(report.checks).toEqual([
			{
				name: "test",
				command: "",
				status: "skipped",
				exit_code: null,
				output_tail: "",
			},
			{
				name: "lint",
				command: "",
				status: "skipped",
				exit_code: null,
				output_tail: "",
			},
			{
				name: "typecheck",
				command: "",
				status: "skipped",
				exit_code: null,
				output_tail: "",
			},
		]);
	});

	test("emits stable critical findings for every failed check", async () => {
		const { root, scopeFile } = await setup(
			[
				'test_command: "printf test-failed; exit 7"',
				'lint_command: "printf lint-ok"',
				'typecheck_command: "printf type-failed; exit 9"',
				"",
			].join("\n"),
		);
		const first = await runRuntimeGate({ repoRoot: root, scopeFile });
		const second = await runRuntimeGate({ repoRoot: root, scopeFile });
		expect(first.status).toBe("fail");
		expect(first.findings).toHaveLength(2);
		expect(first.findings.map((entry) => entry.id)).toEqual(
			second.findings.map((entry) => entry.id),
		);
		for (const entry of first.findings) {
			expect(entry).toMatchObject({
				source: "runtime-gate",
				axis: "runtime-failure",
				severity: "critical",
				file: "",
				line_start: null,
				line_end: null,
				fix_proposal: "Identify and fix the root cause of the failing check.",
			});
			expect(entry.problem).not.toMatch(/iter/i);
			expect(entry.evidence.length).toBeLessThanOrEqual(8192);
		}
	});

	test("copies the current iteration scope digest", async () => {
		const { root, scopeFile, scopeDigest } = await setup();
		const report = await runRuntimeGate({ repoRoot: root, scopeFile });
		expect(report.scope_digest).toBe(scopeDigest);
	});

	test("fails closed when same-status content changed after scope capture", async () => {
		const { root, scopeFile } = await setup(undefined, "dirty-v1\n");
		await writeRepositoryFile(root, "dirty.ts", "dirty-v2\n");
		await expect(runRuntimeGate({ repoRoot: root, scopeFile })).rejects.toThrow(
			/changed before runtime-gate/i,
		);
	});

	test("fails closed when a passing check mutates the worktree", async () => {
		const { root, scopeFile } = await setup(
			'test_command: "printf mutation >> baseline.txt"\n',
		);
		await expect(runRuntimeGate({ repoRoot: root, scopeFile })).rejects.toThrow(
			/modified.*worktree/i,
		);
	});
});
