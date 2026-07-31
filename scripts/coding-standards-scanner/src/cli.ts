#!/usr/bin/env bun
/**
 * coding-standards-scanner — mechanical pass of the coding-standards skill.
 *
 * Resolves a scope of files, runs the project's linters + language-agnostic
 * grep rules, and emits a coding-standards JSON report. Fail-open on
 * missing linters (warn to stderr, skip).
 *
 * Usage:
 *   bun cli.ts --scope-file=<scope.json> --output=<path>
 *   bun cli.ts --scope=all               --output=<path>
 *   bun cli.ts --scope=path --path=src   --output=<path>
 */
import { existsSync } from "node:fs";
import { extname } from "node:path";
import {
	computeBlocking,
	computeSummary,
	type Finding,
	validateReport,
} from "../../lib/coding-standards-schema/src/index.ts";
import {
	findStackEval,
	isCodeFile,
	isInstalled,
	readStackConfig,
	type StackConfig,
} from "../../lib/stack-tools/src/index.ts";
import { buildFinding } from "./lib/finding-emitter.ts";
import { abbreviationsDenylistRule } from "./lib/grep-rules/abbreviations-denylist.ts";
import { anyWithoutJustifRule } from "./lib/grep-rules/any-without-justif.ts";
import { debugStatementsRule } from "./lib/grep-rules/debug-statements.ts";
import type { GrepRule } from "./lib/grep-rules/types.ts";
import { parseBiomeJson } from "./lib/linter-parsers/biome.ts";
import { parseEslintJson } from "./lib/linter-parsers/eslint.ts";
import { parseRuffJson } from "./lib/linter-parsers/ruff.ts";
import { parseShellcheckJson } from "./lib/linter-parsers/shellcheck.ts";
import type { RawLinterFinding } from "./lib/linter-parsers/types.ts";
import { axisForRule } from "./lib/rule-mapping.ts";
import { resolveScope, type ScopeMode } from "./lib/scope-resolver.ts";
import { severityForRule } from "./lib/severity-defaults.ts";

// Prepend the project-local node_modules/.bin so linters installed as
// devDependencies (biome, eslint, etc.) are discoverable by `which` and by
// Bun.spawn([toolName, ...]) without requiring a global install.
process.env.PATH = `${process.cwd()}/node_modules/.bin:${process.env.PATH ?? ""}`;

interface CliArgs {
	scope: ScopeMode;
	scopeFile: string | undefined;
	path: string | undefined;
	output: string;
}

function parseArgs(argv: string[]): CliArgs {
	let scope: ScopeMode = "all";
	let scopeFile: string | undefined;
	let path: string | undefined;
	let output: string | undefined;

	for (const arg of argv) {
		if (arg.startsWith("--scope=")) {
			const value = arg.slice("--scope=".length);
			if (value !== "all" && value !== "path") {
				throw new Error(`invalid --scope: ${value}`);
			}
			scope = value;
		} else if (arg.startsWith("--scope-file=")) {
			scopeFile = arg.slice("--scope-file=".length);
		} else if (arg.startsWith("--path=")) {
			path = arg.slice("--path=".length);
		} else if (arg.startsWith("--output=")) {
			output = arg.slice("--output=".length);
		}
	}
	if (!output) throw new Error("missing --output=<path>");
	if (scopeFile && path)
		throw new Error("--scope-file cannot be combined with --path");
	if (!scopeFile && scope === "path" && !path) {
		throw new Error("--scope=path requires --path=<dir>");
	}
	return { scope, scopeFile, path, output };
}

type Bucket = ".ts/.tsx/.js/.jsx" | ".py" | ".sh/.bash";

function bucketOf(file: string): Bucket | null {
	const ext = extname(file).toLowerCase();
	if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
		return ".ts/.tsx/.js/.jsx";
	}
	if (ext === ".py") return ".py";
	if (ext === ".sh" || ext === ".bash") return ".sh/.bash";
	return null;
}

async function runLinterForBucket(
	bucket: Bucket,
	files: string[],
	config: StackConfig | null,
): Promise<RawLinterFinding[]> {
	if (files.length === 0) return [];
	switch (bucket) {
		case ".ts/.tsx/.js/.jsx": {
			// Follow STACK_EVAL.yaml's linter choice when known.
			const linter = config?.linter ?? null;
			if (linter === "biome") return runBiome(files);
			if (linter === "eslint") return runEslint(files);
			// No linter declared — probe which is installed, prefer biome.
			if (await isInstalled("biome")) return runBiome(files);
			if (await isInstalled("eslint")) return runEslint(files);
			console.warn(
				"[coding-standards-scanner] No TS/JS linter installed (biome / eslint). Skipping bucket.",
			);
			return [];
		}
		case ".py":
			if (!(await isInstalled("ruff"))) {
				console.warn(
					"[coding-standards-scanner] ruff not installed. Skipping Python bucket.",
				);
				return [];
			}
			return runRuff(files);
		case ".sh/.bash":
			if (!(await isInstalled("shellcheck"))) {
				console.warn(
					"[coding-standards-scanner] shellcheck not installed. Skipping shell bucket.",
				);
				return [];
			}
			return runShellcheck(files);
	}
}

async function runBiome(files: string[]): Promise<RawLinterFinding[]> {
	if (!(await isInstalled("biome"))) {
		console.warn("[coding-standards-scanner] biome not installed. Skipping.");
		return [];
	}
	try {
		const proc = Bun.spawn(["biome", "check", "--reporter=json", ...files], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		return parseBiomeJson(stdout);
	} catch (e) {
		console.warn(
			`[coding-standards-scanner] biome run failed: ${e instanceof Error ? e.message : String(e)}`,
		);
		return [];
	}
}

async function runEslint(files: string[]): Promise<RawLinterFinding[]> {
	try {
		const proc = Bun.spawn(["eslint", "--format", "json", ...files], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		return parseEslintJson(stdout);
	} catch (e) {
		console.warn(
			`[coding-standards-scanner] eslint run failed: ${e instanceof Error ? e.message : String(e)}`,
		);
		return [];
	}
}

async function runRuff(files: string[]): Promise<RawLinterFinding[]> {
	try {
		const proc = Bun.spawn(
			["ruff", "check", "--output-format", "json", ...files],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [stdout] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		return parseRuffJson(stdout);
	} catch (e) {
		console.warn(
			`[coding-standards-scanner] ruff run failed: ${e instanceof Error ? e.message : String(e)}`,
		);
		return [];
	}
}

async function runShellcheck(files: string[]): Promise<RawLinterFinding[]> {
	try {
		const proc = Bun.spawn(["shellcheck", "-f", "json", ...files], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		return parseShellcheckJson(stdout);
	} catch (e) {
		console.warn(
			`[coding-standards-scanner] shellcheck run failed: ${e instanceof Error ? e.message : String(e)}`,
		);
		return [];
	}
}

async function runGrepRules(files: string[]): Promise<RawLinterFinding[]> {
	const rules: GrepRule[] = [
		debugStatementsRule,
		abbreviationsDenylistRule,
		anyWithoutJustifRule,
	];
	const out: RawLinterFinding[] = [];
	for (const file of files) {
		let text = "";
		try {
			text = await Bun.file(file).text();
		} catch {
			continue; // file unreadable — skip (could be deleted in the diff scope)
		}
		for (const rule of rules) {
			if (!rule.applies(file)) continue;
			out.push(...rule.scan(file, text));
		}
	}
	return out;
}

function rawToFinding(raw: RawLinterFinding): Finding | null {
	const axis = axisForRule(raw.ruleId);
	if (!axis) return null; // rule out of scope / unknown — drop
	const severity = severityForRule(raw.ruleId);
	return buildFinding({
		ruleId: raw.ruleId,
		axis,
		severity,
		file: raw.file,
		line_start: raw.line_start,
		line_end: raw.line_end,
		message: raw.message,
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();

	const scoped = await resolveScope({
		mode: args.scope,
		scopeFile: args.scopeFile,
		expectedDigest: process.env.LOOP_CLEAN_SCOPE_DIGEST,
		path: args.path,
		cwd,
	});

	const files = scoped.files.filter(
		(file) => isCodeFile(file) && existsSync(file),
	);

	// Resolve STACK_EVAL config once — we use it to pick between biome and
	// eslint when both are plausible. Walk up from cwd.
	const stackEvalPath = findStackEval(`${cwd}/.placeholder`);
	const config: StackConfig | null = stackEvalPath
		? await readStackConfig(stackEvalPath)
		: null;

	// Bucket files by language.
	const buckets: Record<Bucket, string[]> = {
		".ts/.tsx/.js/.jsx": [],
		".py": [],
		".sh/.bash": [],
	};
	for (const f of files) {
		const b = bucketOf(f);
		if (b) buckets[b].push(f);
	}

	// Run linters per non-empty bucket.
	const rawFindings: RawLinterFinding[] = [];
	for (const bucket of Object.keys(buckets) as Bucket[]) {
		const bucketFiles = buckets[bucket];
		if (bucketFiles.length === 0) continue;
		rawFindings.push(
			...(await runLinterForBucket(bucket, bucketFiles, config)),
		);
	}

	// Language-agnostic grep rules on all files.
	rawFindings.push(...(await runGrepRules(files)));

	// Map raw → Finding, drop out-of-scope rules.
	const findings: Finding[] = [];
	for (const raw of rawFindings) {
		const f = rawToFinding(raw);
		if (f) findings.push(f);
	}

	const summary = computeSummary(findings);
	const blocking = computeBlocking(summary);
	const report = {
		skill: "coding-standards" as const,
		scope_digest: scoped.digest,
		verdict: (findings.length === 0 ? "CLEAN" : "ISSUES_FOUND") as
			| "CLEAN"
			| "ISSUES_FOUND",
		findings,
		summary,
		blocking,
	};

	// Validate before writing — catches any bug in the emitter.
	validateReport(report);

	await Bun.write(args.output, `${JSON.stringify(report, null, 2)}\n`);
}

main().catch((err: unknown) => {
	console.error(
		"[coding-standards-scanner] fatal:",
		err instanceof Error ? err.message : String(err),
	);
	process.exit(1);
});
