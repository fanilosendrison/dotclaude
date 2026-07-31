import { z } from "zod";
import { FindingSchema } from "../findings/findings-schema.ts";

export const RuntimeCheckSchema = z.object({
	name: z.enum(["test", "lint", "typecheck"]),
	command: z.string(),
	status: z.enum(["pass", "fail", "skipped"]),
	exit_code: z.number().int().nullable(),
	output_tail: z.string(),
});

export const RuntimeGateReportSchema = z.object({
	skill: z.literal("runtime-gate"),
	scope_digest: z.string().regex(/^[0-9a-f]{64}$/),
	status: z.enum(["pass", "fail", "skipped"]),
	checks: z.array(RuntimeCheckSchema).length(3),
	findings: z.array(FindingSchema),
});

export type RuntimeGateReport = z.infer<typeof RuntimeGateReportSchema>;
