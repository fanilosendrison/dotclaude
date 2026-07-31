import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { computeFindingId } from "../findings/finding-id.ts";
import type { Finding } from "../findings/findings-schema.ts";
import { collectScope } from "../scope/collect-scope.ts";
import { parseScopeManifest } from "../scope/scope-schema.ts";
import { readJsonFile } from "../shared/json.ts";
import {
	type RuntimeGateReport,
	RuntimeGateReportSchema,
} from "./runtime-schema.ts";

type CheckName = "test" | "lint" | "typecheck";

interface RuntimeCommands {
	readonly test: string;
	readonly lint: string;
	readonly typecheck: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findStringProperty(
	value: unknown,
	propertyName: string,
): string | null {
	if (!isRecord(value)) return null;
	const direct = value[propertyName];
	if (typeof direct === "string" && direct.trim().length > 0)
		return direct.trim();
	for (const key of Object.keys(value).sort()) {
		const nested = findStringProperty(value[key], propertyName);
		if (nested) return nested;
	}
	return null;
}

function normalizeToolName(value: string | null): string | null {
	if (!value) return null;
	const firstToken = value
		.trim()
		.toLowerCase()
		.split(/[\s—-]+/)[0];
	return firstToken === "none" || firstToken.length === 0 ? null : firstToken;
}

async function readStackEvaluation(repositoryRoot: string): Promise<unknown> {
	const path = join(repositoryRoot, "STACK_EVAL.yaml");
	if (!existsSync(path)) return null;
	const contents = await readFile(path, "utf8");
	try {
		return Bun.YAML.parse(contents) as unknown;
	} catch (error) {
		throw new Error(
			`STACK_EVAL.yaml is invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function readPackageJson(
	repositoryRoot: string,
): Promise<Record<string, unknown> | null> {
	const path = join(repositoryRoot, "package.json");
	if (!existsSync(path)) return null;
	const value = await readJsonFile(path);
	if (!isRecord(value)) throw new Error("package.json must contain an object");
	return value;
}

function packageScripts(
	packageJson: Record<string, unknown> | null,
): Record<string, string> {
	if (!packageJson || !isRecord(packageJson.scripts)) return {};
	const scripts: Record<string, string> = {};
	for (const [name, value] of Object.entries(packageJson.scripts)) {
		if (typeof value === "string") scripts[name] = value;
	}
	return scripts;
}

function detectPackageManager(
	repositoryRoot: string,
	stackEvaluation: unknown,
): string {
	const configured = normalizeToolName(
		findStringProperty(stackEvaluation, "package_manager"),
	);
	if (configured && ["bun", "pnpm", "yarn", "npm"].includes(configured)) {
		return configured;
	}
	if (
		existsSync(join(repositoryRoot, "bun.lock")) ||
		existsSync(join(repositoryRoot, "bun.lockb"))
	) {
		return "bun";
	}
	if (existsSync(join(repositoryRoot, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(repositoryRoot, "yarn.lock"))) return "yarn";
	return "npm";
}

function packageScriptCommand(
	packageManager: string,
	scriptName: string,
): string {
	if (packageManager === "npm" && scriptName === "test") return "npm test";
	return `${packageManager} run ${scriptName}`;
}

async function resolveRuntimeCommands(
	repositoryRoot: string,
): Promise<RuntimeCommands> {
	const stackEvaluation = await readStackEvaluation(repositoryRoot);
	const packageJson = await readPackageJson(repositoryRoot);
	const scripts = packageScripts(packageJson);
	const packageManager = detectPackageManager(repositoryRoot, stackEvaluation);
	const linter = normalizeToolName(
		findStringProperty(stackEvaluation, "linter"),
	);
	const typeChecker = normalizeToolName(
		findStringProperty(stackEvaluation, "type_checker"),
	);

	const explicitTest = findStringProperty(stackEvaluation, "test_command");
	const explicitLint = findStringProperty(stackEvaluation, "lint_command");
	const explicitTypecheck = findStringProperty(
		stackEvaluation,
		"typecheck_command",
	);

	let testCommand = explicitTest ?? "";
	if (!testCommand && scripts.test) {
		testCommand = packageScriptCommand(packageManager, "test");
	} else if (
		!testCommand &&
		existsSync(join(repositoryRoot, "pyproject.toml"))
	) {
		testCommand = "pytest -q";
	} else if (!testCommand && existsSync(join(repositoryRoot, "Cargo.toml"))) {
		testCommand = "cargo test --quiet";
	}

	let lintCommand = explicitLint ?? "";
	if (!lintCommand && scripts.lint) {
		lintCommand = packageScriptCommand(packageManager, "lint");
	} else if (!lintCommand && linter === "biome") {
		lintCommand = "biome check .";
	} else if (!lintCommand && linter === "eslint") {
		lintCommand = "eslint .";
	} else if (!lintCommand && linter === "ruff") {
		lintCommand = "ruff check .";
	}

	let typecheckCommand = explicitTypecheck ?? "";
	const typeScriptName = ["typecheck", "type-check", "check:types"].find(
		(name) => scripts[name],
	);
	if (!typecheckCommand && typeScriptName) {
		typecheckCommand = packageScriptCommand(packageManager, typeScriptName);
	} else if (!typecheckCommand && typeChecker === "tsc") {
		typecheckCommand = "tsc --noEmit";
	} else if (!typecheckCommand && typeChecker === "pyright") {
		typecheckCommand = "pyright";
	} else if (!typecheckCommand && typeChecker === "mypy") {
		typecheckCommand = "mypy .";
	}

	return { test: testCommand, lint: lintCommand, typecheck: typecheckCommand };
}

function boundedOutput(stdout: string, stderr: string): string {
	const combined = `${stdout}${stderr}`.trimEnd();
	const lines = combined.split("\n").slice(-50).join("\n");
	return lines.slice(-8192);
}

async function runCheck(
	repositoryRoot: string,
	name: CheckName,
	command: string,
): Promise<{
	readonly check: {
		readonly name: CheckName;
		readonly command: string;
		readonly status: "pass" | "fail" | "skipped";
		readonly exit_code: number | null;
		readonly output_tail: string;
	};
	readonly finding: Finding | null;
}> {
	if (!command) {
		return {
			check: {
				name,
				command: "",
				status: "skipped",
				exit_code: null,
				output_tail: "",
			},
			finding: null,
		};
	}
	const processHandle = Bun.spawn(["bash", "-c", command], {
		cwd: repositoryRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	const outputTail = boundedOutput(stdout, stderr);
	if (exitCode === 0) {
		return {
			check: {
				name,
				command,
				status: "pass",
				exit_code: 0,
				output_tail: outputTail,
			},
			finding: null,
		};
	}
	const problem = `${name} check fails on the current uncommitted worktree`;
	const finding: Finding = {
		id: computeFindingId("runtime-gate", "", null, "runtime-failure", problem),
		source: "runtime-gate",
		axis: "runtime-failure",
		severity: "critical",
		file: "",
		line_start: null,
		line_end: null,
		problem,
		evidence: `command: ${command}\nexit_code: ${exitCode}\noutput_tail:\n${outputTail}`,
		fix_proposal: "Identify and fix the root cause of the failing check.",
	};
	return {
		check: {
			name,
			command,
			status: "fail",
			exit_code: exitCode,
			output_tail: outputTail,
		},
		finding,
	};
}

export async function runRuntimeGate(options: {
	readonly repoRoot: string;
	readonly scopeFile: string;
}): Promise<RuntimeGateReport> {
	const scope = parseScopeManifest(await readJsonFile(options.scopeFile));
	if (scope.repo_root !== options.repoRoot) {
		throw new Error("runtime-gate repo root differs from scope.json repo_root");
	}
	const scopeBeforeChecks = await collectScope(options.repoRoot);
	if (
		scopeBeforeChecks.digest !== scope.digest ||
		scopeBeforeChecks.content_digest !== scope.content_digest
	) {
		throw new Error("worktree scope changed before runtime-gate execution");
	}
	const commands = await resolveRuntimeCommands(options.repoRoot);
	const results = [];
	for (const name of ["test", "lint", "typecheck"] as const) {
		results.push(await runCheck(options.repoRoot, name, commands[name]));
	}
	const scopeAfterChecks = await collectScope(options.repoRoot);
	if (
		scopeAfterChecks.digest !== scopeBeforeChecks.digest ||
		scopeAfterChecks.content_digest !== scopeBeforeChecks.content_digest
	) {
		throw new Error(
			"runtime-gate commands modified the current worktree scope",
		);
	}
	const checks = results.map((result) => result.check);
	const findings = results.flatMap((result) =>
		result.finding ? [result.finding] : [],
	);
	const status =
		findings.length > 0
			? "fail"
			: checks.every((check) => check.status === "skipped")
				? "skipped"
				: "pass";
	return RuntimeGateReportSchema.parse({
		skill: "runtime-gate",
		scope_digest: scope.digest,
		status,
		checks,
		findings,
	});
}
