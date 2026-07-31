import {
	CanonicalFindingsSchema,
	DeferredFindingRegistrySchema,
} from "../findings/findings-schema.ts";
import { normalizeFinding } from "../findings/normalize-finding.ts";
import { readJsonFile, writeJsonAtomic } from "../shared/json.ts";
import {
	ROUTING_CATEGORIES,
	type RoutingCategory,
	RoutingReportSchema,
} from "./routing-schema.ts";

export interface ValidateRoutingOptions {
	readonly findingsFile: string;
	readonly routingFile: string;
	readonly deferredOutputFile: string;
}

export interface RoutingValidationResult {
	readonly actionable_count: number;
	readonly routed_count: number;
	readonly deferred_count: number;
}

function dispositionForCategory(
	category: RoutingCategory,
): "backlog" | "design_queue" | "escalated" | null {
	switch (category) {
		case "backlog_added":
		case "backlog_existing":
			return "backlog";
		case "design_queue_added":
		case "design_queue_existing":
			return "design_queue";
		case "escalated":
			return "escalated";
		case "fix_now_applied":
			return null;
	}
}

export async function validateRouting(
	options: ValidateRoutingOptions,
): Promise<RoutingValidationResult> {
	const findings = CanonicalFindingsSchema.parse(
		await readJsonFile(options.findingsFile),
	);
	const routing = RoutingReportSchema.parse(
		await readJsonFile(options.routingFile),
	);
	for (const finding of findings.findings) {
		normalizeFinding(finding, finding.source);
	}
	if (routing.scope_digest !== findings.scope_digest) {
		throw new Error(
			`routing scope_digest ${routing.scope_digest} differs from findings ${findings.scope_digest}`,
		);
	}

	const actionableById = new Map(
		findings.actionable_findings.map((finding) => [finding.id, finding]),
	);
	const routedCategoryById = new Map<string, RoutingCategory>();
	for (const category of ROUTING_CATEGORIES) {
		for (const routedFinding of routing[category]) {
			const findingId = routedFinding.finding_id;
			if (!actionableById.has(findingId)) {
				throw new Error(
					`routing invents or re-routes non-actionable finding ${findingId}`,
				);
			}
			const previousCategory = routedCategoryById.get(findingId);
			if (previousCategory) {
				throw new Error(
					`finding ${findingId} appears in more than one routing category (${previousCategory}, ${category})`,
				);
			}
			routedCategoryById.set(findingId, category);
			const finding = actionableById.get(findingId);
			if (
				finding?.axis === "runtime-failure" &&
				category !== "fix_now_applied"
			) {
				throw new Error(
					`runtime finding ${findingId} must be routed to fix_now_applied`,
				);
			}
		}
	}

	const missingIds = [...actionableById.keys()].filter(
		(findingId) => !routedCategoryById.has(findingId),
	);
	if (missingIds.length > 0) {
		throw new Error(
			`routing is missing actionable finding(s): ${missingIds.sort().join(", ")}`,
		);
	}

	const existingRegistry = DeferredFindingRegistrySchema.parse(
		await readJsonFile(options.deferredOutputFile),
	);
	const deferredById = new Map(
		existingRegistry.entries.map((entry) => [entry.finding_id, entry]),
	);
	if (deferredById.size !== existingRegistry.entries.length) {
		throw new Error("deferred-findings.json contains duplicate finding IDs");
	}
	for (const [findingId, category] of routedCategoryById) {
		const disposition = dispositionForCategory(category);
		if (!disposition) continue;
		deferredById.set(findingId, {
			finding_id: findingId,
			disposition,
			iteration: routing.iteration,
		});
	}
	const entries = [...deferredById.values()].sort((left, right) =>
		left.finding_id < right.finding_id
			? -1
			: left.finding_id > right.finding_id
				? 1
				: 0,
	);
	const registry = DeferredFindingRegistrySchema.parse({
		schema_version: 1,
		entries,
	});
	await writeJsonAtomic(options.deferredOutputFile, registry);
	return {
		actionable_count: actionableById.size,
		routed_count: routedCategoryById.size,
		deferred_count: entries.length,
	};
}
