import type { Axis } from "../../../lib/coding-standards-schema/src/index.ts";

/**
 * Mapping: linter ruleId → coding-standards axis, or null to drop the
 * finding (ruleId out of scope — typically covered by dedup-codebase or
 * senior-review).
 *
 * Rules NOT in this dict are silently dropped (fail-open on noise).
 * Adding a new ruleId is a deliberate decision: pick the best axis based
 * on the canonical definition of each axis in agents/coding-standards-file.md.
 */
export const RULE_TO_AXIS: Record<string, Axis | null> = {
	// ---- ESLint + @typescript-eslint ----
	"no-empty": "error-handling",
	"@typescript-eslint/no-explicit-any": "typing",
	"@typescript-eslint/explicit-function-return-type": "typing",
	complexity: "maintainability",
	"max-lines-per-function": "maintainability",
	"max-lines": "maintainability",
	"jsdoc/require-jsdoc": "comments",
	"prefer-const": "immutability",
	"no-unused-vars": null, // dedup-codebase territory
	"@typescript-eslint/no-unused-vars": null,

	// ---- Biome equivalents ----
	"lint/suspicious/noExplicitAny": "typing",
	"lint/complexity/noUselessCatch": "error-handling",
	"lint/complexity/noForEach": null,
	"lint/style/useConst": "immutability",

	// ---- Ruff ----
	E722: "error-handling", // bare except
	S110: "error-handling", // try-except-pass
	C901: "maintainability", // complexity
	D102: "comments", // missing docstring method
	D103: "comments", // missing docstring function
	D100: "comments", // missing docstring module
	D101: "comments", // missing docstring class

	// ---- Shellcheck (subset) ----
	SC2086: null, // quoting — stylistic, skip
	SC2034: null, // unused var — dedup-codebase
	SC2164: "error-handling", // cd without && exit

	// ---- Grep rules (language-agnostic, emitted by coding-standards-scanner) ----
	"grep/debug-statements": "maintainability",
	"grep/abbreviations-denylist": "naming",
	"grep/any-without-justif": "typing",
};

/** Look up axis for a ruleId. Returns null if the rule is out of scope OR unknown. */
export function axisForRule(ruleId: string): Axis | null {
	if (!(ruleId in RULE_TO_AXIS)) return null;
	return RULE_TO_AXIS[ruleId] ?? null;
}
