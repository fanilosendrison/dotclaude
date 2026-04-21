import type { ProblemContext } from "./problem-canonicalizer.ts";

/**
 * Per-rule observable_change template. For mechanical findings, the
 * observable change is almost always "the linter rule no longer fires on
 * that file:line after the fix". Templates can be specialized when a
 * more precise observable exists.
 */
const TEMPLATES: Record<string, (ctx: ProblemContext) => string> = {
	complexity: (ctx) =>
		`Cyclomatic complexity reported by the linter at ${ctx.file}:${ctx.line ?? "?"} drops under the configured threshold.`,
	C901: (ctx) =>
		`Cyclomatic complexity reported by the linter at ${ctx.file}:${ctx.line ?? "?"} drops under the configured threshold.`,
	"max-lines-per-function": (ctx) =>
		`Line count of the function at ${ctx.file}:${ctx.line ?? "?"} drops under the configured threshold.`,
	"max-lines": (ctx) =>
		`Line count of ${ctx.file} drops under the configured threshold.`,
};

export function observableChangeForRule(ctx: ProblemContext): string {
	const tmpl = TEMPLATES[ctx.ruleId];
	if (tmpl) return tmpl(ctx);
	const loc = ctx.line != null ? `${ctx.file}:${ctx.line}` : ctx.file;
	return `Linter rule ${ctx.ruleId} no longer fires on ${loc}.`;
}
