import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { captureGitInvariants } from "../../src/git/capture-invariants.ts";
import { verifyGitInvariants } from "../../src/git/verify-invariants.ts";
import {
	createRepository,
	removeRepository,
	runGit,
	writeRepositoryFile,
} from "../helpers/git-fixture.ts";

const repositories: string[] = [];

afterEach(async () => {
	for (const root of repositories.splice(0)) await removeRepository(root);
});

describe("Git invariants", () => {
	test("captures and verifies unchanged HEAD and raw index bytes", async () => {
		const root = await createRepository();
		repositories.push(root);
		const baseline = await captureGitInvariants(root);
		expect(baseline.head).toMatch(/^[0-9a-f]{40}$/);
		expect(baseline.index_digest).toMatch(/^[0-9a-f]{64}$/);
		await expect(verifyGitInvariants(root, baseline)).resolves.toEqual({
			head_changed: false,
			index_changed: false,
		});
	});

	test("reports HEAD changes without restoring them", async () => {
		const root = await createRepository();
		repositories.push(root);
		const baseline = await captureGitInvariants(root);
		await writeRepositoryFile(root, "new-commit.txt", "new commit\n");
		await runGit(root, ["add", "new-commit.txt"]);
		await runGit(root, ["commit", "--quiet", "-m", "mutated head"]);
		await expect(verifyGitInvariants(root, baseline)).rejects.toThrow(
			/HEAD changed/,
		);
		expect(await readFile(`${root}/new-commit.txt`, "utf8")).toBe(
			"new commit\n",
		);
	});

	test("reports index changes without restoring them", async () => {
		const root = await createRepository();
		repositories.push(root);
		const baseline = await captureGitInvariants(root);
		await writeRepositoryFile(root, "staged.txt", "staged\n");
		await runGit(root, ["add", "staged.txt"]);
		await expect(verifyGitInvariants(root, baseline)).rejects.toThrow(
			/index changed/,
		);
		expect(await runGit(root, ["diff", "--cached", "--name-only"])).toContain(
			"staged.txt",
		);
	});

	test("uses UNBORN for a repository without an initial commit", async () => {
		const root = await createRepository({ withBaseline: false });
		repositories.push(root);
		const baseline = await captureGitInvariants(root);
		expect(baseline.head).toBe("UNBORN");
		await expect(verifyGitInvariants(root, baseline)).resolves.toMatchObject({
			head_changed: false,
		});
	});
});
