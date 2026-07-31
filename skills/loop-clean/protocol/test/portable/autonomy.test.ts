import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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
		const initialIndex = await runGit(repoRoot, ["ls-files", "--stage"]);

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

		// 8. Verify HEAD and index are unchanged after protocol operations
		const finalHead = await runGit(repoRoot, ["rev-parse", "HEAD"]);
		expect(finalHead).toBe(initialHead);
		const finalIndex = await runGit(repoRoot, ["ls-files", "--stage"]);
		expect(finalIndex).toBe(initialIndex);
	}, 60_000);

	test("LOOP_CLEAN_PROTOCOL_CLI override allows an external CLI without adjacent dependencies", async () => {
		const isolatedRoot = await mkdtemp(join(tmpdir(), "loop-clean-override-"));
		isolatedDirs.push(isolatedRoot);
		const isolatedSkill = join(isolatedRoot, "skills", "loop-clean");
		await mkdir(join(isolatedSkill, "protocol"), { recursive: true });

		// Copy the skill but intentionally skip installing dependencies
		await cp(skillRoot, isolatedSkill, {
			recursive: true,
			filter: (src) => !src.includes("node_modules"),
		});

		const calledArgsFile = join(isolatedRoot, "alternate-called.txt");

		// Create an alternate CLI that records its arguments
		// and writes a valid git baseline so init accepts it
		const alternateCli = join(isolatedRoot, "alternate-cli.ts");
		await Bun.write(
			alternateCli,
			`import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
writeFileSync("${calledArgsFile}", args.join(" "));
// Write a valid git baseline at the --output path
const outputIdx = args.indexOf("--output");
if (outputIdx >= 0 && outputIdx + 1 < args.length) {
  const outputPath = args[outputIdx + 1];
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    schema_version: 1,
    head: "UNBORN",
    index_digest: "${"0".repeat(64)}",
  }));
}
`,
		);

		// Verify the adjacent node_modules is absent
		expect(
			existsSync(join(isolatedSkill, "protocol", "node_modules", "zod")),
		).toBe(false);

		// Run init with the override — must succeed despite missing adjacent deps
		const repoRoot = await createRepository({ prefix: "override-test-" });
		repositories.push(repoRoot);
		const controller = join(isolatedSkill, "loop-clean.sh");
		const result = await runProcess(["bash", controller, "init"], {
			cwd: repoRoot,
			env: {
				LOOP_CLEAN_SESSION_ID: "override-test",
				LOOP_CLEAN_PROTOCOL_CLI: alternateCli,
			},
		});
		expect(result.exitCode).toBe(0);

		// Verify the alternate CLI was invoked with capture-git
		const calledArgs = await Bun.file(calledArgsFile).text();
		expect(calledArgs).toStartWith("capture-git --repo-root");
		expect(calledArgs).toContain("--output");
	}, 60_000);

	test("init fails when override CLI returns 0 but produces no valid baseline", async () => {
		const isolatedRoot = await mkdtemp(join(tmpdir(), "loop-clean-override-bad-"));
		isolatedDirs.push(isolatedRoot);
		const isolatedSkill = join(isolatedRoot, "skills", "loop-clean");
		await mkdir(join(isolatedSkill, "protocol"), { recursive: true });

		await cp(skillRoot, isolatedSkill, {
			recursive: true,
			filter: (src) => !src.includes("node_modules"),
		});

		// CLI that returns 0 but produces no output file
		const silentCli = join(isolatedRoot, "silent-cli.ts");
		await Bun.write(silentCli, "// exits 0, writes nothing\n");

		const repoRoot = await createRepository({ prefix: "bad-override-" });
		repositories.push(repoRoot);
		const controller = join(isolatedSkill, "loop-clean.sh");
		const result = await runProcess(["bash", controller, "init"], {
			cwd: repoRoot,
			env: {
				LOOP_CLEAN_SESSION_ID: "bad-override-test",
				LOOP_CLEAN_PROTOCOL_CLI: silentCli,
			},
		});
		expect(result.exitCode).toBe(4);
		expect(result.stderr).toContain("valid Git baseline");
	}, 60_000);
});
