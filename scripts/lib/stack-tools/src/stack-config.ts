import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const STACK_EVAL_FILENAME = "STACK_EVAL.yaml";

/** Walk up from filePath to find STACK_EVAL.yaml. Returns path or null. */
export function findStackEval(filePath: string): string | null {
	let dir = dirname(filePath);
	const root = "/";

	while (true) {
		const candidate = join(dir, STACK_EVAL_FILENAME);
		if (existsSync(candidate)) return candidate;

		const parent = dirname(dir);
		if (parent === dir || dir === root) return null;
		dir = parent;
	}
}

export interface StackConfig {
	linter: string | null;
	typeChecker: string | null;
}

/** Parse STACK_EVAL.yaml and extract linter + type_checker. "none" → null. */
export async function readStackConfig(
	stackEvalPath: string,
): Promise<StackConfig> {
	const content = await Bun.file(stackEvalPath).text();

	// Bun.YAML is available in Bun — zero dependency YAML parsing
	// biome-ignore lint/suspicious/noExplicitAny: YAML parse returns untyped structure
	const parsed = Bun.YAML.parse(content) as any;

	const decisions = parsed?.decisions ?? {};

	const rawLinter = decisions.linter ?? null;
	const rawTypeChecker = decisions.type_checker ?? null;

	return {
		linter: normalizeValue(rawLinter),
		typeChecker: normalizeValue(rawTypeChecker),
	};
}

/** Normalize: "none" and empty strings → null, otherwise lowercase trimmed. */
function normalizeValue(value: unknown): string | null {
	if (value == null) return null;
	const str = String(value).trim().toLowerCase();
	if (str === "" || str === "none") return null;
	return str;
}
