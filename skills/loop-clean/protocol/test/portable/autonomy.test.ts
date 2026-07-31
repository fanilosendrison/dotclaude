import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createRepository,
	parseShellExports,
	removeRepository,
	runGit,
	runProcess,
} from "../helpers/git-fixture.ts";

const skillRoot = resolve(import.meta.dir, "../../..");
const repositories: string[] = [];
const isolatedDirs: string[] = [];

afterEach(async () => {
	for (const root of repositories.splice(0)) await removeRepository(root);
	for (const dir of isolatedDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("autonomous installation", () => {
	test("a copy containing only skills/loop-clean can initialise the protocol in a separate Git repository", async () => {
		// 1. Copy only skills/loop-clean/ (without node_modules)
		const isolatedRoot = await mkdtemp(join(tmpdir(), "loop-clean-autonomy-"));
		isolatedDirs.push(isolatedRoot);
		const isolatedSkill = join(isolatedRoot, "skills", "loop-clean");
		await mkdir(join(isolatedSkill, "protocol"), { recursive: true });

		await cp(skillRoot, isolatedSkill, {
			recursive: true,
			filter: (src) => !src.includes("node_modules"),
		});

		// Verify the copy does not contain scripts/ or node_modules
		const { existsSync } = await import("node:fs");
		expect(existsSync(join(isolatedSkill, "protocol", "node_modules"))).toBe(
			false,
		);
		expect(existsSync(join(isolatedRoot, "scripts"))).toBe(false);

		// 2. Install dependencies from the lockfile
		const installResult = await runProcess(
			["bun", "install", "--frozen-lockfile"],
			{ cwd: join(isolatedSkill, "protocol") },
		);
		expect(installResult.exitCode).toBe(0);

		// Verify zod is resolved locally
		expect(existsSync(join(isolatedSkill, "protocol", "node_modules", "zod")))
			.toBe(true);

		// 3. Create a separate Git repository
		const repoRoot = await createRepository({ prefix: "autonomy-test-" });
		repositories.push(repoRoot);
		const initialHead = await runGit(repoRoot, ["rev-parse", "HEAD"]);

		// 4. Run init
		const controller = join(isolatedSkill, "loop-clean.sh");
		const initEnv = { LOOP_CLEAN_SESSION_ID: "autonomy-test" };
		const init = await runProcess(["bash", controller, "init"], {
			cwd: repoRoot,
			env: initEnv,
		});
		expect(init.exitCode).toBe(0);
		expect(init.stdout).toContain("LOOP_CLEAN_REPO_ROOT");

		// 5. Run prepare-iter to produce scope.json
		const initExports = parseShellExports(init.stdout);
		const iter = await runProcess(
			["bash", controller, "prepare-iter", "0"],
			{ cwd: repoRoot, env: { ...initEnv, ...initExports } },
		);
		expect(iter.exitCode).toBe(0);
		expect(iter.stdout).toContain("LOOP_CLEAN_SCOPE_FILE");

		// 6. Verify no access to scripts/ was possible
		expect(init.stderr).not.toContain("scripts/loop-clean-protocol");

		// 7. Verify scope.json was produced
		const scopeMatch = /LOOP_CLEAN_SCOPE_FILE="([^"]+)"/.exec(iter.stdout);
		expect(scopeMatch).not.toBeNull();
		const scopeFile = scopeMatch![1];
		expect(existsSync(scopeFile)).toBe(true);

		// 8. Verify HEAD is unchanged after protocol operations
		const finalHead = await runGit(repoRoot, ["rev-parse", "HEAD"]);
		expect(finalHead).toBe(initialHead);
	}, 60_000);
});
