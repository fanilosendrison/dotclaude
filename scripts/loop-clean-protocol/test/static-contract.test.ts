import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const read = (relativePath: string): string =>
	readFileSync(resolve(repositoryRoot, relativePath), "utf8");

function sourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
		else if (path.endsWith(".ts")) files.push(path);
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
			"scripts/loop-clean-protocol/src",
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

	test("removes every legacy production feature", () => {
		const productionFiles = [
			"skills/loop-clean/SKILL.md",
			"skills/loop-clean/loop-clean.sh",
			"agents/loop-clean-orchestrator.md",
			"skills/fix-or-backlog/SKILL.md",
			"skills/coding-standards/SKILL.md",
			"skills/senior-review/SKILL.md",
			"agents/coding-standards-file.md",
			"agents/senior-review-file.md",
			"agents/backlog-deep-crush-orchestrator.md",
			"helpers/nightly-clean-prompt.md",
			"skills/agent-creator/SKILL.md",
		];
		const forbiddenProductionTerms = [
			"LOOP_CLEAN_BASE_SHA",
			"LOOP_CLEAN_COMMIT_PER_ITER",
			"commit-iter",
			"cmd_commit_iter",
			"scope_mode",
			"--scope=audit",
			"direction-block",
			"drift_id",
		];
		for (const relativePath of productionFiles) {
			const contents = read(relativePath);
			for (const term of forbiddenProductionTerms)
				expect(contents).not.toContain(term);
			expect(contents).not.toMatch(/spec[- ]drift/i);
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
		expect(packageJson.scripts.test).toContain("loop-clean-protocol");
		for (const scriptName of Object.keys(packageJson.scripts)) {
			expect(scriptName).not.toMatch(/^spec-drift(?::|$)/);
		}
		expect(packageJson.scripts.test).not.toMatch(/spec-drift/);
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
