import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolveScope } from "../lib/scope-resolver";

let repo: string;
let originalBaseSha: string | undefined;

async function git(args: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	const stdout = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	}
	return stdout.trim();
}

beforeEach(async () => {
	repo = await mkdtemp(join(tmpdir(), "scope-resolver-test-"));
	await git(["init", "--quiet", "--initial-branch=main"], repo);
	await writeFile(join(repo, "baseline.ts"), "export const baseline = 1;\n");
	await git(["add", "."], repo);
	await git(["commit", "--quiet", "-m", "baseline"], repo);
	originalBaseSha = process.env.LOOP_CLEAN_BASE_SHA;
	delete process.env.LOOP_CLEAN_BASE_SHA;
});

afterEach(async () => {
	if (originalBaseSha === undefined) {
		delete process.env.LOOP_CLEAN_BASE_SHA;
	} else {
		process.env.LOOP_CLEAN_BASE_SHA = originalBaseSha;
	}
	await rm(repo, { recursive: true, force: true });
});

describe("resolveScope mode=diff", () => {
	test("without LOOP_CLEAN_BASE_SHA: returns working-tree + staged unique union", async () => {
		await writeFile(join(repo, "baseline.ts"), "export const baseline = 99;\n");
		await writeFile(join(repo, "staged.ts"), "export const b = 2;\n");
		await git(["add", "staged.ts"], repo);

		const files = await resolveScope({ mode: "diff", cwd: repo });

		expect(files.sort()).toEqual(["baseline.ts", "staged.ts"]);
	});

	test("with LOOP_CLEAN_BASE_SHA: returns files changed since that SHA", async () => {
		const baseSha = await git(["rev-parse", "HEAD"], repo);
		await writeFile(join(repo, "since-base.ts"), "export const c = 3;\n");
		await git(["add", "."], repo);
		await git(["commit", "--quiet", "-m", "post-base change"], repo);

		process.env.LOOP_CLEAN_BASE_SHA = baseSha;
		const files = await resolveScope({ mode: "diff", cwd: repo });

		expect(files).toEqual(["since-base.ts"]);
	});

	test("with LOOP_CLEAN_BASE_SHA: scope survives an intermediate commit (commit-per-iter scenario)", async () => {
		const baseSha = await git(["rev-parse", "HEAD"], repo);

		await writeFile(join(repo, "feature.ts"), "export const f = 4;\n");
		await git(["add", "."], repo);
		await git(["commit", "--quiet", "-m", "iter-0 commit"], repo);

		process.env.LOOP_CLEAN_BASE_SHA = baseSha;
		const anchoredFiles = await resolveScope({ mode: "diff", cwd: repo });

		expect(anchoredFiles).toEqual(["feature.ts"]);

		delete process.env.LOOP_CLEAN_BASE_SHA;
		const standaloneFiles = await resolveScope({ mode: "diff", cwd: repo });

		expect(standaloneFiles).toEqual([]);
	});

	test("with invalid LOOP_CLEAN_BASE_SHA: returns empty (git diff fails silently)", async () => {
		process.env.LOOP_CLEAN_BASE_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
		await writeFile(join(repo, "ignored.ts"), "export const x = 0;\n");

		const files = await resolveScope({ mode: "diff", cwd: repo });

		expect(files).toEqual([]);
	});
});
