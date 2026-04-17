#!/usr/bin/env bun

import { deny, readHookInput, skip } from "../../hook-utils/src/index.ts";
import { isCodeFile, isLinterCompatible } from "./lib/extensions.ts";
import { runLintPipeline } from "./lib/runner.ts";
import { findStackEval, readStackConfig } from "./lib/stack-config.ts";

async function main(): Promise<void> {
	const input = await readHookInput();

	// 1. Only trigger on Write or Edit
	if (input.tool_name !== "Write" && input.tool_name !== "Edit") skip();

	// 2. Need a file_path in tool_input
	const filePath = input.tool_input.file_path;
	if (typeof filePath !== "string" || !filePath) skip();

	// After this point, filePath is guaranteed to be a non-empty string
	const file = filePath as string;

	// 3. Must be a code file
	if (!isCodeFile(file)) skip();

	// 4. Find STACK_EVAL.yaml
	const stackEvalPath = findStackEval(file);
	if (!stackEvalPath) skip();

	// 5. Read config — need at least a linter or type checker
	const config = await readStackConfig(stackEvalPath as string);
	if (!config.linter && !config.typeChecker) skip();

	// 6. Check extension compatibility with linter
	if (config.linter && !isLinterCompatible(config.linter, file)) skip();

	// 7. Run format → lint → typecheck
	const pipeline = await runLintPipeline(config, file);

	// 8. Report errors (advisory — Claude sees and self-corrects)
	if (pipeline.hasErrors) {
		const errorDetails = pipeline.results
			.filter((r) => !r.success)
			.map((r) => `[${r.phase}/${r.tool}] ${r.output}`)
			.join("\n\n");

		deny(`Lint/format errors in ${file}:\n\n${errorDetails}`);
	}

	// 9. All clean — silent exit
	skip();
}

main().catch((error: unknown) => {
	console.error(
		"post-write-linter error:",
		error instanceof Error ? error.message : String(error),
	);
	process.exit(0); // Fail-open — never block on hook crash
});
