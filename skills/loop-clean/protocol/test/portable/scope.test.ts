import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { collectScope } from "../../src/scope/collect-scope.ts";
import { parsePorcelainV2 } from "../../src/scope/parse-porcelain-v2.ts";
import {
	createRepository,
	removeRepository,
	runGit,
	writeRepositoryFile,
} from "../helpers/git-fixture.ts";

const repositories: string[] = [];

async function repository(options?: { readonly withBaseline?: boolean }) {
	const root = await createRepository(options);
	repositories.push(root);
	return root;
}

afterEach(async () => {
	for (const root of repositories.splice(0)) await removeRepository(root);
});

describe("collectScope", () => {
	test("collects every non-committed Git state once and excludes ignored files", async () => {
		const root = await repository();
		for (const path of [
			"unstaged.ts",
			"staged.ts",
			"both.ts",
			"old-name.ts",
			"deleted.ts",
			"committed-only.ts",
		]) {
			await writeRepositoryFile(
				root,
				path,
				`export const value = "${path}";\n`,
			);
		}
		await writeRepositoryFile(root, ".gitignore", "ignored.ts\n.claude/run/\n");
		await writeRepositoryFile(root, "backlog.md", "# Backlog\n");
		await writeRepositoryFile(root, "design-queue.md", "# Design queue\n");
		await writeRepositoryFile(
			root,
			"backlog.archive.md",
			"# Backlog archive\n",
		);
		await writeRepositoryFile(root, ".claude/run/tracked.json", "{}\n");
		await runGit(root, ["add", "."]);
		await runGit(root, ["add", "--force", ".claude/run/tracked.json"]);
		await runGit(root, ["commit", "--quiet", "-m", "scope fixtures"]);

		await writeRepositoryFile(root, "unstaged.ts", "export const value = 2;\n");
		await writeRepositoryFile(root, "staged.ts", "export const value = 3;\n");
		await runGit(root, ["add", "staged.ts"]);
		await writeRepositoryFile(root, "both.ts", "export const value = 4;\n");
		await runGit(root, ["add", "both.ts"]);
		await writeRepositoryFile(root, "both.ts", "export const value = 5;\n");
		await writeRepositoryFile(
			root,
			"untracked.ts",
			"export const value = 6;\n",
		);
		await writeRepositoryFile(
			root,
			"ignored.ts",
			"export const ignored = true;\n",
		);
		await runGit(root, ["mv", "old-name.ts", "renamed name.ts"]);
		await unlink(join(root, "deleted.ts"));
		await writeRepositoryFile(root, "path with spaces.ts", "export {};\n");
		await writeRepositoryFile(root, "src/café-東京.ts", "export {};\n");
		await writeRepositoryFile(root, "backlog.md", "# Backlog\n- [ ] item\n");
		await writeRepositoryFile(
			root,
			"design-queue.md",
			"# Design queue\n- [ ] item\n",
		);
		await writeRepositoryFile(
			root,
			"backlog.archive.md",
			"# Backlog archive\n- [x] item\n",
		);
		await writeRepositoryFile(
			root,
			".claude/run/tracked.json",
			'{"changed":true}\n',
		);

		const manifest = await collectScope(root);
		const byPath = new Map(
			manifest.entries.map((entry) => [entry.path, entry]),
		);

		expect([...byPath.keys()]).not.toContain("ignored.ts");
		expect([...byPath.keys()]).not.toContain("committed-only.ts");
		expect(byPath.get("unstaged.ts")).toMatchObject({
			kind: "tracked",
			index_status: ".",
			worktree_status: "M",
			exists: true,
			eligible_for_audit: true,
		});
		expect(byPath.get("staged.ts")).toMatchObject({
			kind: "tracked",
			index_status: "M",
			worktree_status: ".",
		});
		expect(byPath.get("both.ts")).toMatchObject({
			index_status: "M",
			worktree_status: "M",
		});
		expect(
			manifest.entries.filter((entry) => entry.path === "both.ts"),
		).toHaveLength(1);
		expect(byPath.get("untracked.ts")).toMatchObject({
			kind: "untracked",
			exists: true,
		});
		expect(byPath.get("renamed name.ts")).toMatchObject({
			kind: "renamed",
			original_path: "old-name.ts",
		});
		expect(byPath.get("deleted.ts")).toMatchObject({
			kind: "deleted",
			exists: false,
		});
		expect(byPath.has("path with spaces.ts")).toBe(true);
		expect(byPath.has("src/café-東京.ts")).toBe(true);
		for (const ledgerPath of [
			".claude/run/tracked.json",
			"backlog.md",
			"design-queue.md",
			"backlog.archive.md",
		]) {
			expect(byPath.get(ledgerPath)).toMatchObject({
				eligible_for_audit: false,
			});
		}
	});

	test("supports an unborn repository", async () => {
		const root = await repository({ withBaseline: false });
		await writeRepositoryFile(root, "first.ts", "export const first = true;\n");
		const manifest = await collectScope(root);
		expect(manifest.entries).toHaveLength(1);
		expect(manifest.entries[0]).toMatchObject({
			path: "first.ts",
			kind: "untracked",
			exists: true,
		});
	});

	test("uses the explicitly resolved nested repository only", async () => {
		const outer = await repository();
		await writeRepositoryFile(outer, "outer-untracked.ts", "export {};\n");
		const inner = join(outer, "nested");
		await mkdir(inner, { recursive: true });
		await runGit(inner, ["init", "--quiet"]);
		await runGit(inner, ["config", "user.name", "Loop Clean Test"]);
		await runGit(inner, ["config", "user.email", "loop-clean@example.invalid"]);
		await writeRepositoryFile(inner, "inner-untracked.ts", "export {};\n");

		const manifest = await collectScope(inner);
		expect(manifest.repo_root).toBe(await realpath(inner));
		expect(manifest.entries.map((entry) => entry.path)).toEqual([
			"inner-untracked.ts",
		]);
	});

	test("digest ignores record order, timestamp, and absolute repository path", async () => {
		const first = await repository();
		const second = await repository();
		await writeRepositoryFile(first, "same.ts", "export {};\n");
		await writeRepositoryFile(second, "same.ts", "export {};\n");
		const firstManifest = await collectScope(first);
		const secondManifest = await collectScope(second);
		expect(firstManifest.repo_root).not.toBe(secondManifest.repo_root);
		expect(firstManifest.generated_at).toBeString();
		expect(firstManifest.digest).toBe(secondManifest.digest);
	});

	test("index_digest changes when only the staged blob changes (MM→M. scenario)", async () => {
		const root = await repository();
		await writeRepositoryFile(root, "mm-file.ts", "v1\n");
		await runGit(root, ["add", "mm-file.ts"]);
		await runGit(root, ["commit", "--quiet", "-m", "baseline"]);

		// Modify worktree → .M (index unchanged)
		await writeRepositoryFile(root, "mm-file.ts", "v2\n");
		const afterWorktree = await collectScope(root);

		// Stage the change → M. (index matches worktree, both differ from HEAD)
		await runGit(root, ["add", "mm-file.ts"]);
		const afterStage = await collectScope(root);

		// Restore worktree to HEAD content (v1) without touching the index
		await runGit(root, [
			"restore",
			"--source=HEAD",
			"--worktree",
			"--",
			"mm-file.ts",
		]);
		const indexOnlyModified = await collectScope(root);

		// index_digest must change when something is staged
		expect(afterWorktree.index_digest).not.toBe(afterStage.index_digest);

		// content_digest is stable: both states have same worktree content (v2)
		expect(afterWorktree.content_digest).toBe(afterStage.content_digest);

		// When worktree is restored to HEAD but index is still modified:
		// The entry set is the same (one modified tracked file),
		// content_digest matches because worktree = HEAD (v1)
		expect(indexOnlyModified.content_digest).not.toBe(
			afterStage.content_digest,
		);
		expect(indexOnlyModified.index_digest).toBe(afterStage.index_digest);

		// digest (canonical) must differ between states
		expect(afterWorktree.digest).not.toBe(afterStage.digest);
		expect(afterStage.digest).not.toBe(indexOnlyModified.digest);
	});

	test("index_digest changes for executable mode change in the index", async () => {
		const root = await repository();
		await writeRepositoryFile(root, "script.sh", "#!/bin/sh\necho ok\n");
		await runGit(root, ["add", "script.sh"]);
		await runGit(root, ["commit", "--quiet", "-m", "baseline"]);

		const before = await collectScope(root);

		await runGit(root, ["update-index", "--chmod=+x", "script.sh"]);
		const after = await collectScope(root);

		expect(after.index_digest).not.toBe(before.index_digest);
		// content_digest changes because the scope gained an entry (index modified)
		expect(after.content_digest).not.toBe(before.content_digest);
		expect(after.digest).not.toBe(before.digest);
	});

	test("index unchanged but worktree modified: index_digest stable, content_digest changes", async () => {
		const root = await repository();
		await writeRepositoryFile(root, "mod.ts", "v1\n");
		await runGit(root, ["add", "mod.ts"]);
		await runGit(root, ["commit", "--quiet", "-m", "baseline"]);

		const before = await collectScope(root);

		await writeRepositoryFile(root, "mod.ts", "v2\n");
		const after = await collectScope(root);

		expect(after.index_digest).toBe(before.index_digest);
		expect(after.content_digest).not.toBe(before.content_digest);
		expect(after.digest).not.toBe(before.digest);
		expect(after.entries[0]).toMatchObject({
			index_status: ".",
			worktree_status: "M",
		});
	});

	test("digest changes for same-status content changes", async () => {
		const root = await repository();
		await writeRepositoryFile(root, "dirty.ts", "dirty-v1\n");
		const first = await collectScope(root);
		await writeRepositoryFile(root, "dirty.ts", "dirty-v2\n");
		const second = await collectScope(root);
		expect(second.entries).toEqual(first.entries);
		expect(second.content_digest).not.toBe(first.content_digest);
		expect(second.digest).not.toBe(first.digest);
	});
});

describe("parsePorcelainV2", () => {
	test("parses ordinary, renamed, copied, deleted, unmerged, and untracked records", () => {
		const input = new TextEncoder().encode(
			[
				"1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb tracked.ts",
				"1 .D N... 100644 100644 000000 aaaaaaa bbbbbbb deleted.ts",
				"2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 renamed.ts",
				"old.ts",
				"2 C. N... 100644 100644 100644 aaaaaaa bbbbbbb C100 copied.ts",
				"source.ts",
				"u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.ts",
				"? untracked path.ts",
				"! ignored.ts",
				"",
			].join("\0"),
		);
		const records = parsePorcelainV2(input);
		expect(records.map((record) => record.kind)).toEqual([
			"tracked",
			"deleted",
			"renamed",
			"copied",
			"unmerged",
			"untracked",
		]);
		expect(records[2]).toMatchObject({
			path: "renamed.ts",
			original_path: "old.ts",
		});
		expect(records[3]).toMatchObject({
			path: "copied.ts",
			original_path: "source.ts",
		});
	});

	test("rejects non-UTF-8 Git paths instead of decoding them lossily", () => {
		const input = Uint8Array.from([63, 32, 0xff, 0]);
		expect(() => parsePorcelainV2(input)).toThrow(/UTF-8/i);
	});
});
