import { z } from "zod";
import {
	AXES,
	type CodingStandardsReport,
	type Finding,
	SEVERITIES,
	type SeveritySummary,
} from "./types.ts";

/** Zod schema for a single Finding. Mirrors the type in types.ts. */
export const FindingSchema = z
	.object({
		id: z.string().regex(/^[0-9a-f]{16}$/, "id must be 16 lowercase hex chars"),
		source: z.literal("coding-standards"),
		axis: z.enum(AXES as unknown as [string, ...string[]]),
		severity: z.enum(SEVERITIES as unknown as [string, ...string[]]),
		file: z.string().min(1),
		line_start: z.number().int().nonnegative().nullable(),
		line_end: z.number().int().nonnegative().nullable(),
		problem: z.string().min(1),
		evidence: z.string(),
		fix_proposal: z.string(),
		observable_change: z.string(),
	})
	.refine(
		(f) => f.severity === "design" || f.observable_change.trim().length > 0,
		{
			message:
				"observable_change must be non-empty unless severity is 'design'",
			path: ["observable_change"],
		},
	);

export const SeveritySummarySchema = z.object({
	critical: z.number().int().nonnegative(),
	major: z.number().int().nonnegative(),
	notable: z.number().int().nonnegative(),
	minor: z.number().int().nonnegative(),
	nit: z.number().int().nonnegative(),
	design: z.number().int().nonnegative(),
});

export const ReportSchema = z.object({
	skill: z.literal("coding-standards"),
	scope_digest: z.string().regex(/^[0-9a-f]{64}$/),
	verdict: z.enum(["CLEAN", "ISSUES_FOUND"]),
	findings: z.array(FindingSchema),
	summary: SeveritySummarySchema,
	blocking: z.boolean(),
});

/**
 * Parse + validate a JSON string as a CodingStandardsReport. Throws on any
 * schema violation — callers in `consolidate` rely on this hard-fail
 * behaviour (see HARD FAIL with exit 4 note in design spec).
 */
export function parseReport(jsonText: string): CodingStandardsReport {
	const raw = JSON.parse(jsonText);
	const parsed = ReportSchema.parse(raw);
	return parsed as CodingStandardsReport;
}

/** Validate an already-parsed object. Throws on mismatch. */
export function validateReport(obj: unknown): CodingStandardsReport {
	return ReportSchema.parse(obj) as CodingStandardsReport;
}

/** Validate a single finding. */
export function validateFinding(obj: unknown): Finding {
	return FindingSchema.parse(obj) as Finding;
}

/** Validate a summary object. */
export function validateSummary(obj: unknown): SeveritySummary {
	return SeveritySummarySchema.parse(obj) as SeveritySummary;
}
