/**
 * Per-rule canonical `problem` phrasing. The scanner must emit a STABLE
 * problem string (same formulation across invocations) so that the
 * computed finding id remains stable — otherwise loop-clean.sh cannot
 * detect oscillation.
 *
 * Format: `{rule-label} at {file}:{line}` or an equivalent affirmative
 * phrase. Do NOT include LLM-generated text or timestamps.
 */

export interface ProblemContext {
	ruleId: string;
	file: string;
	line: number | null;
	/** Original linter message — used as fallback and to enrich if useful. */
	message: string;
}

type Canonicalizer = (ctx: ProblemContext) => string;

const LABELS: Record<string, string> = {
	// eslint / @typescript-eslint
	"no-empty": "empty block statement",
	"@typescript-eslint/no-explicit-any":
		"weak type `any` used without justification",
	"@typescript-eslint/explicit-function-return-type":
		"function missing explicit return type",
	complexity: "cyclomatic complexity exceeds threshold",
	"max-lines-per-function": "function exceeds max lines",
	"max-lines": "file exceeds max lines",
	"jsdoc/require-jsdoc": "missing JSDoc on public API",
	"prefer-const": "`let` used where `const` suffices",
	// biome
	"lint/suspicious/noExplicitAny": "weak type `any` used without justification",
	"lint/complexity/noUselessCatch": "useless catch block",
	"lint/style/useConst": "`let` used where `const` suffices",
	// ruff
	E722: "bare `except` clause",
	S110: "`try/except/pass` swallows the exception",
	C901: "cyclomatic complexity exceeds threshold",
	D100: "missing docstring on module",
	D101: "missing docstring on class",
	D102: "missing docstring on method",
	D103: "missing docstring on function",
	// shellcheck
	SC2164: "`cd` without `|| exit` risks running in wrong directory",
	// grep rules
	"grep/debug-statements": "debug statement left in production code",
	"grep/abbreviations-denylist": "cryptic abbreviation used",
	"grep/any-without-justif":
		"weak type `any` used without justification comment",
};

function defaultCanon(ctx: ProblemContext): string {
	const label = LABELS[ctx.ruleId] ?? ctx.ruleId;
	const loc = ctx.line != null ? `${ctx.file}:${ctx.line}` : ctx.file;
	return `${label} at ${loc}`;
}

export const PROBLEM_CANONICALIZERS: Record<string, Canonicalizer> = {};

/** Return the canonical problem for a linter finding. */
export function canonicalProblem(ctx: ProblemContext): string {
	const custom = PROBLEM_CANONICALIZERS[ctx.ruleId];
	if (custom) return custom(ctx);
	return defaultCanon(ctx);
}
