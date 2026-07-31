/**
 * Canonical types for the coding-standards skill JSON report.
 *
 * FROZEN SCHEMA: these types describe the producer JSON validated and merged
 * by the loop-clean protocol. Coordinate every contract change with the
 * scanner, semantic producer, consolidator, and canonical collector.
 */

export type Severity =
	| "critical"
	| "major"
	| "notable"
	| "minor"
	| "nit"
	| "design";

/** The six canonical axes of the coding-standards skill. */
export type Axis =
	| "naming"
	| "typing"
	| "maintainability"
	| "comments"
	| "error-handling"
	| "immutability";

export const AXES: readonly Axis[] = [
	"naming",
	"typing",
	"maintainability",
	"comments",
	"error-handling",
	"immutability",
] as const;

export const SEVERITIES: readonly Severity[] = [
	"critical",
	"major",
	"notable",
	"minor",
	"nit",
	"design",
] as const;

/** One finding emitted by the mechanical scanner or by a semantic sub-agent. */
export interface Finding {
	/** 16 hex chars, computed via computeFindingId — stable across invocations. */
	id: string;
	/** Always "coding-standards" for both mechanical and semantic findings. */
	source: "coding-standards";
	axis: Axis;
	severity: Severity;
	/** Repo-relative path. */
	file: string;
	line_start: number | null;
	line_end: number | null;
	/** Stable canonical phrasing — see SKILL.md "Stabilité du problem". */
	problem: string;
	evidence: string;
	fix_proposal: string;
	/**
	 * FAIL→PASS assertion or run-time observable. Empty string ONLY if
	 * severity === "design". Enforced by the validator.
	 */
	observable_change: string;
}

export interface SeveritySummary {
	critical: number;
	major: number;
	notable: number;
	minor: number;
	nit: number;
	design: number;
}

export type Verdict = "CLEAN" | "ISSUES_FOUND";

export interface CodingStandardsReport {
	skill: "coding-standards";
	/** Digest copied from the single scope manifest used for this report. */
	scope_digest: string;
	verdict: Verdict;
	findings: Finding[];
	summary: SeveritySummary;
	/** true iff ≥ 1 finding is critical or major. */
	blocking: boolean;
}

/** Build an empty summary — useful for incremental counting. */
export function emptySummary(): SeveritySummary {
	return {
		critical: 0,
		major: 0,
		notable: 0,
		minor: 0,
		nit: 0,
		design: 0,
	};
}

/** Count findings by severity. Deterministic — pure function of input. */
export function computeSummary(findings: readonly Finding[]): SeveritySummary {
	const summary = emptySummary();
	for (const f of findings) {
		summary[f.severity] += 1;
	}
	return summary;
}

/** Blocking rule: critical or major bloque le merge. */
export function computeBlocking(summary: SeveritySummary): boolean {
	return summary.critical > 0 || summary.major > 0;
}
