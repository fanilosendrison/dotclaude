import type { ProblemContext } from "./problem-canonicalizer.ts";

/**
 * Per-rule fix template. Produces a short, actionable sentence describing
 * the recommended fix. Not LLM-generated — deterministic, so the `problem`
 * / `fix_proposal` pair is stable across invocations.
 */
const TEMPLATES: Record<string, (ctx: ProblemContext) => string> = {
	"no-empty": () =>
		"Handle the exception explicitly (log, rethrow, or add a comment explaining why swallowing is intentional).",
	"@typescript-eslint/no-explicit-any": () =>
		"Replace `any` with the narrowest declared type, or justify with a comment starting with `// justification:`.",
	"lint/suspicious/noExplicitAny": () =>
		"Replace `any` with the narrowest declared type, or justify with a comment starting with `// justification:`.",
	"@typescript-eslint/explicit-function-return-type": () =>
		"Add an explicit return type annotation to the function signature.",
	complexity: () =>
		"Split the function: extract branches into smaller named helpers until cyclomatic complexity drops under the threshold.",
	C901: () =>
		"Split the function: extract branches into smaller named helpers until cyclomatic complexity drops under the threshold.",
	"max-lines-per-function": () =>
		"Split the function into smaller named helpers along its natural responsibilities.",
	"max-lines": () =>
		"Split the file along its natural responsibilities into smaller files with faithful names.",
	"jsdoc/require-jsdoc": () =>
		"Add a one-line JSDoc block above the declaration explaining its role.",
	"prefer-const": () =>
		"Change `let` to `const` if the binding is never reassigned.",
	"lint/style/useConst": () =>
		"Change `let` to `const` if the binding is never reassigned.",
	E722: () =>
		"Replace the bare `except:` with a specific exception class; re-raise or log.",
	S110: () =>
		"Replace `try/except/pass` with a logged handler or a specific exception class that justifies swallowing.",
	D100: () => "Add a module-level docstring describing the module's purpose.",
	D101: () => "Add a class docstring describing the class's responsibility.",
	D102: () => "Add a method docstring describing the method's contract.",
	D103: () => "Add a function docstring describing the function's contract.",
	SC2164: () =>
		"Chain the `cd` with `|| exit` so the script aborts on failure.",
	"grep/debug-statements": () =>
		"Remove the debug statement or replace it with the project's logger.",
	"grep/abbreviations-denylist": () =>
		"Rename the identifier to a full word describing its role (e.g. `manager` instead of `mgr`).",
	"grep/any-without-justif": () =>
		"Replace `any` with the narrowest declared type, or add a `// justification: ...` comment on the preceding line explaining why `any` is required.",
};

export function fixForRule(ctx: ProblemContext): string {
	const tmpl = TEMPLATES[ctx.ruleId];
	if (tmpl) return tmpl(ctx);
	// Fallback: surface the linter's own message — the most honest fix hint
	// we have when we don't know the rule.
	return `Address linter rule ${ctx.ruleId}: ${ctx.message}`.trim();
}
