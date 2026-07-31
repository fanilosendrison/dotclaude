import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveScope } from "../lib/scope-resolver.ts";

const temporaryDirectories: string[] = [];
const digest = "a".repeat(64);

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(
		join(tmpdir(), "coding-standards-scope-test-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

async function writeScopeFile(
	directory: string,
	entries: readonly Record<string, unknown>[],
): Promise<string> {
	const path = join(directory, "scope.json");
	await writeFile(
		path,
		`${JSON.stringify({
			schema_version: 2,
			repo_root: directory,
			index_digest: "c".repeat(64),
			generated_at: "informational",
			entries,
			content_digest: "b".repeat(64),
			digest,
		})}\n`,
	);
	return path;
}

function entry(
	path: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		path,
		original_path: null,
		kind: "tracked",
		index_status: ".",
		worktree_status: "M",
		exists: true,
		eligible_for_audit: true,
		exclusion_reason: null,
		...overrides,
	};
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("resolveScope from loop-clean manifest", () => {
	test("uses only existing eligible manifest entries and preserves the digest", async () => {
		const directory = await temporaryDirectory();
		const scopeFile = await writeScopeFile(directory, [
			entry("src/included.ts"),
			entry("src/deleted.ts", { kind: "deleted", exists: false }),
			entry("backlog.md", {
				eligible_for_audit: false,
				exclusion_reason: "loop-clean backlog ledger",
			}),
		]);
		const scope = await resolveScope({
			scopeFile,
			expectedDigest: digest,
			cwd: directory,
		});
		expect(scope.files).toEqual(["src/included.ts"]);
		expect(scope.digest).toBe(digest);
	});

	test("rejects a digest that differs from the orchestrator value", async () => {
		const directory = await temporaryDirectory();
		const scopeFile = await writeScopeFile(directory, [
			entry("src/example.ts"),
		]);
		await expect(
			resolveScope({
				scopeFile,
				expectedDigest: "b".repeat(64),
				cwd: directory,
			}),
		).rejects.toThrow(/digest/i);
	});

	test("rejects a manifest whose repo root differs from cwd", async () => {
		const directory = await temporaryDirectory();
		const other = await temporaryDirectory();
		const scopeFile = await writeScopeFile(other, [entry("src/example.ts")]);
		await expect(resolveScope({ scopeFile, cwd: directory })).rejects.toThrow(
			/repo_root/i,
		);
	});

	test("rejects an invalid manifest instead of silently returning an empty list", async () => {
		const directory = await temporaryDirectory();
		const scopeFile = join(directory, "scope.json");
		await writeFile(scopeFile, "{broken");
		await expect(resolveScope({ scopeFile, cwd: directory })).rejects.toThrow(
			/JSON/i,
		);
	});
});

describe("resolveScope standalone", () => {
	test("walks all or one target path without invoking Git", async () => {
		const directory = await temporaryDirectory();
		await mkdir(join(directory, "src", "nested"), { recursive: true });
		await mkdir(join(directory, "other"), { recursive: true });
		await writeFile(join(directory, "src", "one.ts"), "export {};\n");
		await writeFile(join(directory, "src", "nested", "two.ts"), "export {};\n");
		await writeFile(join(directory, "other", "three.ts"), "export {};\n");
		const all = await resolveScope({ mode: "all", cwd: directory });
		expect(all.files).toEqual([
			"other/three.ts",
			"src/nested/two.ts",
			"src/one.ts",
		]);
		expect(all.digest).toMatch(/^[0-9a-f]{64}$/);
		const targeted = await resolveScope({
			mode: "path",
			path: join(directory, "src"),
			cwd: directory,
		});
		expect(targeted.files).toEqual(["src/nested/two.ts", "src/one.ts"]);
	});
});
