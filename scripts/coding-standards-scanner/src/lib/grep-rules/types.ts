import type { RawLinterFinding } from "../linter-parsers/types.ts";

/**
 * A grep rule is a language-agnostic (or single-language) check that runs
 * purely on file text. It emits RawLinterFinding objects with a synthetic
 * `ruleId` prefixed with `grep/<rule-name>`. Those IDs also appear in
 * rule-mapping / severity-defaults / canonicalizer via helper exports of
 * each rule module.
 */
export interface GrepRule {
	/** ruleId emitted in the RawLinterFinding — also the key used for canon/fix/sev. */
	readonly ruleId: string;
	/** Run the rule on one file's text. */
	scan(file: string, text: string): RawLinterFinding[];
	/** True if this rule applies to the given file path. */
	applies(file: string): boolean;
}
