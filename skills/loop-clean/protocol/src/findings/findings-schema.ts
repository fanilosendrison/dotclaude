import { z } from "zod";

export const FINDING_SOURCES = [
	"coding-standards",
	"senior-review",
	"dedup-codebase",
	"runtime-gate",
] as const;

export type FindingSource = (typeof FINDING_SOURCES)[number];

export const FINDING_SEVERITIES = [
	"critical",
	"major",
	"notable",
	"minor",
	"nit",
	"design",
] as const;

export const FindingSchema = z
	.object({
		id: z
			.string()
			.regex(/^[0-9a-f]{16}$/, "id must be canonical lowercase hex"),
		source: z.enum(FINDING_SOURCES),
		axis: z.string().trim().min(1),
		severity: z.enum(FINDING_SEVERITIES),
		file: z.string(),
		line_start: z.number().int().nonnegative().nullable(),
		line_end: z.number().int().nonnegative().nullable(),
		problem: z.string().trim().min(1),
		evidence: z.string(),
		fix_proposal: z.string(),
	})
	.passthrough();

export type Finding = z.infer<typeof FindingSchema>;

export const ProducerReportSchema = z
	.object({
		skill: z.enum(FINDING_SOURCES),
		scope_digest: z.string().regex(/^[0-9a-f]{64}$/),
		findings: z.array(FindingSchema),
	})
	.passthrough();

export const RuntimeGateStatusSchema = z.enum(["pass", "fail", "skipped"]);

export const DeferredDispositionSchema = z.enum([
	"backlog",
	"design_queue",
	"escalated",
]);

export const DeferredFindingRegistrySchema = z.object({
	schema_version: z.literal(1),
	entries: z.array(
		z.object({
			finding_id: z.string().trim().min(1),
			disposition: DeferredDispositionSchema,
			iteration: z.number().int().nonnegative(),
		}),
	),
});

export type DeferredFindingRegistry = z.infer<
	typeof DeferredFindingRegistrySchema
>;

export const CanonicalFindingsSchema = z.object({
	schema_version: z.literal(1),
	scope_digest: z.string().regex(/^[0-9a-f]{64}$/),
	sources: z
		.object({
			"coding-standards": z.number().int().nonnegative(),
			"senior-review": z.number().int().nonnegative(),
			"dedup-codebase": z.number().int().nonnegative(),
			"runtime-gate": z.number().int().nonnegative(),
		})
		.strict(),
	findings: z.array(FindingSchema),
	actionable_findings: z.array(FindingSchema),
	previously_deferred_findings: z.array(FindingSchema),
	runtime_gate_status: RuntimeGateStatusSchema,
	summary: z.object({
		total: z.number().int().nonnegative(),
		actionable: z.number().int().nonnegative(),
		deferred: z.number().int().nonnegative(),
	}),
});

export type CanonicalFindings = z.infer<typeof CanonicalFindingsSchema>;
