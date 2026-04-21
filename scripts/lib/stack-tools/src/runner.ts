import { extname } from "node:path";
import type { StackConfig } from "./stack-config.ts";

const TOOL_TIMEOUT_MS = 30_000;

export interface LintResult {
	tool: string;
	phase: "format" | "lint" | "typecheck";
	success: boolean;
	output: string;
}

export interface PipelineResult {
	results: LintResult[];
	hasErrors: boolean;
}

/** Check if a tool is installed. Exposed for callers that want to branch before
 *  constructing a pipeline (e.g. the coding-standards scanner doing fail-open
 *  semantics on missing linters). */
export async function isInstalled(tool: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(["which", tool], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch {
		return false;
	}
}

/** Run a tool with timeout, return LintResult. */
async function runTool(
	command: string[],
	phase: LintResult["phase"],
): Promise<LintResult> {
	const toolName = command[0];
	try {
		const proc = Bun.spawn(command, {
			stdout: "pipe",
			stderr: "pipe",
			timeout: TOOL_TIMEOUT_MS,
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		const output = (stdout + stderr).trim();

		return {
			tool: toolName,
			phase,
			success: exitCode === 0,
			output,
		};
	} catch (error) {
		return {
			tool: toolName,
			phase,
			success: false,
			output: `Failed to run ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/** Run format → lint → typecheck pipeline sequentially. */
export async function runLintPipeline(
	config: StackConfig,
	filePath: string,
): Promise<PipelineResult> {
	const results: LintResult[] = [];
	const ext = extname(filePath).toLowerCase();

	// --- FORMAT ---
	if (config.linter) {
		const formatCmd = getFormatCommand(config.linter, filePath);
		if (formatCmd && (await isInstalled(formatCmd[0]))) {
			results.push(await runTool(formatCmd, "format"));
		}
	}

	// --- LINT ---
	if (config.linter) {
		const lintCmd = getLintCommand(config.linter, filePath);
		if (lintCmd && (await isInstalled(lintCmd[0]))) {
			results.push(await runTool(lintCmd, "lint"));
		}
	}

	// --- TYPECHECK ---
	if (config.typeChecker) {
		const typecheckCmd = getTypecheckCommand(config.typeChecker, filePath, ext);
		if (typecheckCmd && (await isInstalled(typecheckCmd[0]))) {
			results.push(await runTool(typecheckCmd, "typecheck"));
		}
	}

	return {
		results,
		hasErrors: results.some((r) => !r.success),
	};
}

/** Get format command for a linter. Returns null if linter has no formatter. */
function getFormatCommand(linter: string, filePath: string): string[] | null {
	switch (linter) {
		case "biome":
			return ["biome", "format", "--write", filePath];
		case "ruff":
			return ["ruff", "format", filePath];
		default:
			// eslint, shellcheck — no built-in formatter
			return null;
	}
}

/** Get lint command for a linter. */
function getLintCommand(linter: string, filePath: string): string[] | null {
	switch (linter) {
		case "biome":
			return ["biome", "check", "--write", filePath];
		case "eslint":
			return ["eslint", "--fix", filePath];
		case "ruff":
			return ["ruff", "check", "--fix", filePath];
		case "shellcheck":
			return ["shellcheck", filePath];
		default:
			return null;
	}
}

/** Get typecheck command. tsc skipped (can't check single file). */
function getTypecheckCommand(
	typeChecker: string,
	filePath: string,
	ext: string,
): string[] | null {
	switch (typeChecker) {
		case "tsc":
			// tsc cannot typecheck a single file meaningfully — skip
			return null;
		case "pyright":
			return ext === ".py" ? ["pyright", filePath] : null;
		case "mypy":
			return ext === ".py" ? ["mypy", filePath] : null;
		default:
			return null;
	}
}
