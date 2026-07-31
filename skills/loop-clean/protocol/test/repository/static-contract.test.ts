import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../../../..");
const read = (relativePath: string): string =>
	readFileSync(resolve(repositoryRoot, relativePath), "utf8");

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SKIP_FILES = new Set(["bun.lock"]);

function globFiles(root: string, pattern: string): string[] {
	const prefix = pattern.replace(/\/\*\*$/, "");
	const dir = join(root, prefix);
	if (!existsSync(dir)) return [];
	const result: string[] = [];
	function walk(d: string) {
		for (const name of readdirSync(d)) {
			const full = join(d, name);
			if (statSync(full).isDirectory()) {
				if (!SKIP_DIRS.has(name)) walk(full);
			} else if (!SKIP_FILES.has(name)) {
				result.push(relative(root, full));
			}
		}
	}
	walk(dir);
	return result;
}

function sourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) {
			if (!SKIP_DIRS.has(name)) files.push(...sourceFiles(path));
		} else if (path.endsWith(".ts") && !SKIP_FILES.has(name)) {
			files.push(path);
		}
	}
	return files;
}

describe("production protocol contract", () => {
	test("contains no executable mutating Git command in loop-clean production", () => {
		const productionFiles = [
			"skills/loop-clean/loop-clean.sh",
			"agents/loop-clean-orchestrator.md",
		];
		const mutatingCommand =
			/(?:^|[\s;&|`$(])git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+(add|commit|push|reset|restore|checkout|switch|stash|clean|merge|rebase|cherry-pick)\b/;
		for (const relativePath of productionFiles) {
			const executableLines = read(relativePath)
				.split("\n")
				.filter((line) => !/^\s*#/.test(line))
				.filter(
					(line) =>
						!/\b(?:never|must not|do not|ne pas|interdit)\b/i.test(line),
				);
			expect(executableLines.join("\n")).not.toMatch(mutatingCommand);
		}
	});

	test("allows only read-only Git subcommands in the technical package", () => {
		const forbiddenLiteral =
			/["'](add|commit|push|reset|restore|checkout|switch|stash|clean|merge|rebase|cherry-pick)["']/;
		const protocolSourceRoot = resolve(
			repositoryRoot,
			"skills/loop-clean/protocol/src",
		);
		for (const path of sourceFiles(protocolSourceRoot)) {
			const contents = readFileSync(path, "utf8");
			expect(contents).not.toMatch(forbiddenLiteral);
			if (contents.includes('Bun.spawn(["git"')) {
				expect(contents).toContain('Bun.spawn(["git", "-C"');
				expect(contents).toContain('GIT_OPTIONAL_LOCKS: "0"');
			}
		}
		expect(read("skills/loop-clean/loop-clean.sh")).toContain(
			'_emit_export GIT_OPTIONAL_LOCKS "0"',
		);
	});

	test("removes every legacy production feature from the production perimeter", () => {
		const productionGlobs = [
			"skills/loop-clean/**",
			"skills/fix-or-backlog/**",
			"skills/coding-standards/**",
			"skills/senior-review/**",
			"skills/dedup-codebase/**",
		];
		const productionAgentGlobs = ["agents/**"];
		const productionSourceGlobs = [
			"skills/loop-clean/protocol/src/**",
			"scripts/coding-standards-scanner/src/**",
			"scripts/coding-standards-consolidate/src/**",
		];
		const allProductionPaths = [
			...productionGlobs.flatMap((g) => globFiles(repositoryRoot, g)),
			...productionAgentGlobs.flatMap((g) => globFiles(repositoryRoot, g)),
			...productionSourceGlobs.flatMap((g) => globFiles(repositoryRoot, g)),
			"scripts/package.json",
		].filter((p) => !p.includes("/test/") && !p.endsWith(".test.ts"));
		const forbiddenLiteralTerms = [
			"LOOP_CLEAN_BASE_SHA",
			"LOOP_CLEAN_COMMIT_PER_ITER",
			"commit-iter",
			"cmd_commit_iter",
			"scope_mode",
			"--scope=audit",
			"direction-block",
			"drift_id",
		];
		for (const relativePath of allProductionPaths) {
			const contents = read(relativePath);
			for (const term of forbiddenLiteralTerms)
				expect(contents).not.toContain(term);
			expect(contents).not.toMatch(/spec[-_ ]drift/i);
		}
		expect(existsSync(resolve(repositoryRoot, "scripts/spec-drift"))).toBe(
			false,
		);
		expect(
			existsSync(
				resolve(repositoryRoot, "skills/loop-clean/loop-clean-test.sh"),
			),
		).toBe(false);
	});

	test("registers the protocol suite and no removed package scripts", () => {
		const packageJson = JSON.parse(read("scripts/package.json"));
		expect(packageJson.scripts.test).toContain("skills/loop-clean/protocol");
		for (const scriptName of Object.keys(packageJson.scripts)) {
			expect(scriptName).not.toMatch(/^spec-drift(?::|$)/);
			expect(scriptName).not.toMatch(/^loop-clean-protocol/);
		}
		expect(packageJson.scripts.test).not.toMatch(/spec-drift/);
	});

	test("loop-clean.sh passes bash syntax validation", () => {
		const result = Bun.spawnSync(
			["bash", "-n", "skills/loop-clean/loop-clean.sh"],
			{
				cwd: repositoryRoot,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toBe("");
	});

	test("documents and enforces the exact orchestration order", () => {
		const orchestrator = read("agents/loop-clean-orchestrator.md");
		const orderedMarkers = [
			"prepare-iter",
			"coding-standards",
			"senior-review",
			"dedup-codebase",
			"runtime-gate",
			"collect-findings",
			"decide",
			"fix-or-backlog",
			"validate-routing",
		];
		const protocolList = [...orchestrator.matchAll(/^\d+\. `([^`]+)`/gm)].map(
			(match) => match[1],
		);
		expect(protocolList.slice(0, orderedMarkers.length)).toEqual(
			orderedMarkers,
		);
		expect(orchestrator).toContain("four canonical sources");
		expect(orchestrator).toContain("LOOP_CLEAN_SCOPE_FILE");
		expect(orchestrator).toContain("must not recalculate the scope");
	});

	test("makes findings.json the sole orchestrated routing input", () => {
		const skill = read("skills/fix-or-backlog/SKILL.md");
		expect(skill).toContain("$LOOP_CLEAN_FINDINGS_FILE");
		for (const sourceReport of [
			"coding-standards.json",
			"senior-review.json",
			"dedup-codebase.json",
			"runtime-gate.json",
		]) {
			expect(skill).not.toContain(sourceReport);
		}
		expect(skill).toContain("LOOP_CLEAN_BACKLOG_PATH");
		expect(skill).toContain("LOOP_CLEAN_DESIGN_QUEUE_PATH");
		expect(skill).not.toMatch(/>>\s*backlog\.md/);
	});

	test("requires every producer to consume and echo the manifest digest", () => {
		for (const relativePath of [
			"skills/coding-standards/SKILL.md",
			"skills/senior-review/SKILL.md",
			"skills/dedup-codebase/SKILL.md",
		]) {
			const contents = read(relativePath);
			expect(contents).toContain("LOOP_CLEAN_SCOPE_FILE");
			expect(contents).toContain("scope_digest");
		}
		const orchestrator = read("agents/loop-clean-orchestrator.md");
		expect(orchestrator).toContain("LOOP_CLEAN_SCOPE_DIGEST");
	});

	test("contains no residual references to the old protocol location", () => {
		const productionGlobs = [
			"skills/loop-clean/**",
			"skills/fix-or-backlog/**",
			"skills/coding-standards/**",
			"skills/senior-review/**",
			"skills/dedup-codebase/**",
		];
		const productionAgentGlobs = ["agents/**"];
		const productionSourceGlobs = [
			"scripts/coding-standards-scanner/src/**",
			"scripts/coding-standards-consolidate/src/**",
			"scripts/lib/coding-standards-schema/src/**",
		];
		const allProductionPaths = [
			...productionGlobs.flatMap((g) => globFiles(repositoryRoot, g)),
			...productionAgentGlobs.flatMap((g) => globFiles(repositoryRoot, g)),
			...productionSourceGlobs.flatMap((g) => globFiles(repositoryRoot, g)),
			"scripts/package.json",
		].filter((p) => !p.includes("/test/") && !p.endsWith(".test.ts"));
		for (const relativePath of allProductionPaths) {
			const contents = read(relativePath);
			expect(contents).not.toContain("scripts/loop-clean-protocol");
		}
	});

	test("old protocol directory no longer exists", () => {
		expect(
			existsSync(resolve(repositoryRoot, "scripts/loop-clean-protocol")),
		).toBe(false);
	});

	test("protocol package is self-contained with package.json, bun.lock, and tsconfig.json", () => {
		const protocolRoot = resolve(repositoryRoot, "skills/loop-clean/protocol");
		expect(existsSync(resolve(protocolRoot, "package.json"))).toBe(true);
		expect(existsSync(resolve(protocolRoot, "bun.lock"))).toBe(true);
		expect(existsSync(resolve(protocolRoot, "tsconfig.json"))).toBe(true);
		expect(existsSync(resolve(protocolRoot, "bunfig.toml"))).toBe(true);
	});

	test("loop-clean.sh points to the adjacent protocol CLI", () => {
		const shellScript = read("skills/loop-clean/loop-clean.sh");
		expect(shellScript).toContain("$SCRIPT_DIR/protocol/src/cli.ts");
		expect(shellScript).not.toContain("scripts/loop-clean-protocol");
	});

	test("all protocol CLI calls go through _run_protocol with --no-install", () => {
		const shellScript = read("skills/loop-clean/loop-clean.sh");
		// The _run_protocol helper must contain the exact bun --no-install invocation
		expect(shellScript).toMatch(
			/_run_protocol\(\)\s*\{\s*bun --no-install "\$PROTOCOL_CLI" "\$@"\s*\}/m,
		);
		// Remove the _run_protocol function body before checking for bare bun calls
		const lines = shellScript.split("\n");
		const filtered: string[] = [];
		let inHelper = false;
		for (const line of lines) {
			if (line.includes("_run_protocol() {")) { inHelper = true; continue; }
			if (inHelper) {
				if (line.trim() === "}") { inHelper = false; continue; }
				continue;
			}
			filtered.push(line);
		}
		expect(filtered.join("\n")).not.toMatch(/bun.*\$PROTOCOL_CLI/);
	});

	test("bunfig.toml disables runtime auto-install", () => {
		const bunfig = read("skills/loop-clean/protocol/bunfig.toml");
		expect(bunfig).toContain("[install]");
		expect(bunfig).toContain('auto = "disable"');
	});

	test("anchors both backlog consumers at the resolved Git root", () => {
		for (const relativePath of [
			"skills/backlog-crush/backlog-crush.sh",
			"skills/backlog-deep-crush/backlog-deep-crush.sh",
		]) {
			const contents = read(relativePath);
			expect(contents).toContain(
				'REPO_ROOT="$(git rev-parse --show-toplevel)"',
			);
			expect(contents).toContain('BACKLOG_FILE="$REPO_ROOT/backlog.md"');
		}
		const common = read("skills/lib/backlog-common.sh");
		expect(common).toContain('DESIGN_QUEUE_FILE="$REPO_ROOT/design-queue.md"');
		expect(common).toContain(
			'BACKLOG_ARCHIVE_FILE="$REPO_ROOT/backlog.archive.md"',
		);
	});
});
