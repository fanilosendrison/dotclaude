import {
	type Axis,
	computeFindingId,
	type Finding,
	type Severity,
} from "../../../lib/coding-standards-schema/src/index.ts";
import { fixForRule } from "./fix-templates.ts";
import { observableChangeForRule } from "./observable-change-templates.ts";
import {
	canonicalProblem,
	type ProblemContext,
} from "./problem-canonicalizer.ts";

export interface FindingSeed {
	ruleId: string;
	axis: Axis;
	severity: Severity;
	file: string;
	line_start: number | null;
	line_end: number | null;
	/** Raw linter message (or grep-rule description) — surfaces in evidence/fallback fix. */
	message: string;
	/** Optional override — for grep rules that already build a perfect problem. */
	problemOverride?: string;
	fixOverride?: string;
	observableChangeOverride?: string;
	evidenceOverride?: string;
}

/** Build a fully-populated Finding from a seed. Deterministic — no LLM. */
export function buildFinding(seed: FindingSeed): Finding {
	const ctx: ProblemContext = {
		ruleId: seed.ruleId,
		file: seed.file,
		line: seed.line_start,
		message: seed.message,
	};
	const problem = seed.problemOverride ?? canonicalProblem(ctx);
	const evidence = seed.evidenceOverride ?? seed.message;
	const fix = seed.fixOverride ?? fixForRule(ctx);
	const observable =
		seed.observableChangeOverride ?? observableChangeForRule(ctx);

	const id = computeFindingId(
		"coding-standards",
		seed.file,
		seed.line_start,
		seed.axis,
		problem,
	);

	return {
		id,
		source: "coding-standards",
		axis: seed.axis,
		severity: seed.severity,
		file: seed.file,
		line_start: seed.line_start,
		line_end: seed.line_end,
		problem,
		evidence,
		fix_proposal: fix,
		observable_change: observable,
	};
}
