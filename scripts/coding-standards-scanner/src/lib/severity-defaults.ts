import type { Severity } from "../../../lib/coding-standards-schema/src/index.ts";

/**
 * Default severity for each known ruleId. Applied when the linter output
 * doesn't give us an inherent severity we can translate (which is most
 * cases — linters report "error" vs "warning" but those don't map cleanly
 * to the 6-tier coding-standards scale).
 *
 * Rules not present here fall back to "minor" — see SEVERITY_FALLBACK.
 */
export const DEFAULT_SEVERITY: Record<string, Severity> = {
	"no-empty": "major",
	E722: "major",
	S110: "major",
	"@typescript-eslint/no-explicit-any": "notable",
	"lint/suspicious/noExplicitAny": "notable",
	complexity: "notable",
	C901: "notable",
	"max-lines-per-function": "minor",
	"max-lines": "minor",
	"@typescript-eslint/explicit-function-return-type": "minor",
	"jsdoc/require-jsdoc": "minor",
	D100: "nit",
	D101: "minor",
	D102: "minor",
	D103: "minor",
	"prefer-const": "nit",
	"lint/style/useConst": "nit",
	SC2164: "notable",
	// Grep rules
	"grep/debug-statements": "minor",
	"grep/abbreviations-denylist": "minor",
	"grep/any-without-justif": "notable",
};

export const SEVERITY_FALLBACK: Severity = "minor";

export function severityForRule(ruleId: string): Severity {
	return DEFAULT_SEVERITY[ruleId] ?? SEVERITY_FALLBACK;
}
