/**
 * Common shape produced by every linter parser. The scanner maps these
 * raw records through rule-mapping / severity-defaults / finding-emitter
 * to build the final Findings.
 */
export interface RawLinterFinding {
	ruleId: string;
	file: string;
	line_start: number | null;
	line_end: number | null;
	message: string;
}
