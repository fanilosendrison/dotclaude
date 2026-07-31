import { z } from "zod";

export const ROUTING_CATEGORIES = [
	"fix_now_applied",
	"backlog_added",
	"backlog_existing",
	"design_queue_added",
	"design_queue_existing",
	"escalated",
] as const;

export type RoutingCategory = (typeof ROUTING_CATEGORIES)[number];

const FindingIdSchema = z.string().regex(/^[0-9a-f]{16}$/);

const AppliedFindingSchema = z
	.object({
		finding_id: FindingIdSchema,
		files_touched: z.array(z.string().min(1)).min(1),
		change_summary: z.string().trim().min(1),
	})
	.passthrough();

const BacklogFindingSchema = z
	.object({
		finding_id: FindingIdSchema,
		file: z.string().min(1),
		severity: z.enum(["critical", "major", "notable", "minor", "nit"]),
		reason: z.string().trim().min(1),
	})
	.passthrough();

const DesignQueueFindingSchema = z
	.object({
		finding_id: FindingIdSchema,
		file: z.string().min(1),
		reason: z.string().trim().min(1),
	})
	.passthrough();

const EscalatedFindingSchema = z
	.object({
		finding_id: FindingIdSchema,
		reason: z.string().trim().min(1),
	})
	.passthrough();

export const RoutingReportSchema = z
	.object({
		skill: z.literal("fix-or-backlog"),
		iteration: z.number().int().nonnegative(),
		scope_digest: z.string().regex(/^[0-9a-f]{64}$/),
		fix_now_applied: z.array(AppliedFindingSchema),
		backlog_added: z.array(BacklogFindingSchema),
		backlog_existing: z.array(BacklogFindingSchema),
		design_queue_added: z.array(DesignQueueFindingSchema),
		design_queue_existing: z.array(DesignQueueFindingSchema),
		escalated: z.array(EscalatedFindingSchema),
		notes: z.array(z.string()).default([]),
	})
	.passthrough();

export type RoutingReport = z.infer<typeof RoutingReportSchema>;
