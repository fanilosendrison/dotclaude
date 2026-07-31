import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPEC_MANIFEST_FILE } from "../src/lib/constants";
import { checkStaleness } from "../src/lib/staleness";
import { writeState } from "../src/lib/state";
import type { IndexState } from "../src/lib/types";
import { runFixtureGit } from "./helpers/git-fixture";

let tempDir: string;

beforeAll(async () => {
	// Create temp git repo for testing
	tempDir = await mkdtemp(join(tmpdir(), "index-repo-test-"));
	await runFixtureGit(tempDir, ["init", "--quiet"]);
	await runFixtureGit(tempDir, [
		"commit",
		"--quiet",
		"--allow-empty",
		"-m",
		"init",
	]);
	await writeFile(join(tempDir, "test.txt"), "hello");
	await runFixtureGit(tempDir, ["add", "."]);
	await runFixtureGit(tempDir, ["commit", "--quiet", "-m", "add test"]);
});

afterAll(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("checkStaleness", () => {
	it("should return NO_INDEX when no .index-state.json exists", async () => {
		const result = await checkStaleness(tempDir);
		expect(result.status).toBe("NO_INDEX");
		expect(result.currentHash).toBeTruthy();
		expect(result.storedHash).toBeNull();
	});

	it("should return FRESH when tree hash matches and tree is clean", async () => {
		// Get current hash and write matching state
		const first = await checkStaleness(tempDir);
		const state: IndexState = {
			treeHash: first.currentHash,
			timestamp: new Date().toISOString(),
			axisHashes: { code: "", specs: "", config: "", tests: "", scripts: "" },
			version: 1,
		};
		await writeState(tempDir, state);

		const result = await checkStaleness(tempDir);
		expect(result.status).toBe("FRESH");
	});

	it("should return STALE when tree hash differs", async () => {
		// Write state with wrong hash
		const state: IndexState = {
			treeHash: "0000000000000000000000000000000000000000",
			timestamp: new Date().toISOString(),
			axisHashes: { code: "", specs: "", config: "", tests: "", scripts: "" },
			version: 1,
		};
		await writeState(tempDir, state);

		const result = await checkStaleness(tempDir);
		expect(result.status).toBe("STALE");
		expect(result.storedHash).toBe("0000000000000000000000000000000000000000");
	});

	it("should return FRESH when only generated files changed (post-commit cycle)", async () => {
		// Simulate the cycle:
		// 1. Write state with current hash
		const first = await checkStaleness(tempDir);
		const state: IndexState = {
			treeHash: first.currentHash,
			timestamp: new Date().toISOString(),
			axisHashes: { code: "", specs: "", config: "", tests: "", scripts: "" },
			version: 1,
		};
		await writeState(tempDir, state);

		// 2. Write SPEC_MANIFEST.md (simulating scanner output) and commit
		await writeFile(
			join(tempDir, SPEC_MANIFEST_FILE),
			"# Spec Manifest\n> Git ref: abc1234\n",
		);
		await runFixtureGit(tempDir, ["add", SPEC_MANIFEST_FILE]);
		await runFixtureGit(tempDir, ["commit", "--quiet", "-m", "add manifest"]);

		// 3. Tree hash now differs (commit changed it), but only generated file changed
		const result = await checkStaleness(tempDir);
		expect(result.status).toBe("FRESH");

		// Clean up: remove manifest from tracking
		await runFixtureGit(tempDir, ["rm", "-f", SPEC_MANIFEST_FILE]);
		await runFixtureGit(tempDir, ["commit", "--quiet", "-m", "cleanup"]);
	});

	it("should return STALE when real files changed alongside generated files", async () => {
		// Write state with current hash
		const first = await checkStaleness(tempDir);
		const state: IndexState = {
			treeHash: first.currentHash,
			timestamp: new Date().toISOString(),
			axisHashes: { code: "", specs: "", config: "", tests: "", scripts: "" },
			version: 1,
		};
		await writeState(tempDir, state);

		// Modify both a real file AND the manifest, then commit
		await writeFile(join(tempDir, "test.txt"), "changed content");
		await writeFile(join(tempDir, SPEC_MANIFEST_FILE), "# Spec Manifest\n");
		await runFixtureGit(tempDir, ["add", "test.txt", SPEC_MANIFEST_FILE]);
		await runFixtureGit(tempDir, [
			"commit",
			"--quiet",
			"-m",
			"real + manifest",
		]);

		const result = await checkStaleness(tempDir);
		expect(result.status).toBe("STALE");

		// Clean up
		await runFixtureGit(tempDir, ["rm", "-f", SPEC_MANIFEST_FILE]);
		await runFixtureGit(tempDir, ["commit", "--quiet", "-m", "cleanup"]);
	});

	it("should return STALE when working tree is dirty", async () => {
		// First set matching hash
		const first = await checkStaleness(tempDir);
		const state: IndexState = {
			treeHash: first.currentHash,
			timestamp: new Date().toISOString(),
			axisHashes: { code: "", specs: "", config: "", tests: "", scripts: "" },
			version: 1,
		};
		await writeState(tempDir, state);

		// Dirty the working tree (unstaged change)
		await writeFile(join(tempDir, "test.txt"), "modified");

		const result = await checkStaleness(tempDir);
		expect(result.status).toBe("STALE");

		// Clean up
		await runFixtureGit(tempDir, ["checkout", "--", "test.txt"]);
	});

	it("should return STALE when an untracked file exists", async () => {
		const first = await checkStaleness(tempDir);
		const state: IndexState = {
			treeHash: first.currentHash,
			timestamp: new Date().toISOString(),
			axisHashes: { code: "", specs: "", config: "", tests: "", scripts: "" },
			version: 1,
		};
		await writeState(tempDir, state);

		// Brand new file, never `git add`-ed
		await writeFile(join(tempDir, "new-file.ts"), "export const x = 1;");

		const result = await checkStaleness(tempDir);
		expect(result.status).toBe("STALE");

		// Clean up
		await rm(join(tempDir, "new-file.ts"));
	});
});
