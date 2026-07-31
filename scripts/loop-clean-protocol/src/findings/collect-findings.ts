import { join } from "node:path";
import { parseScopeManifest } from "../scope/scope-schema.ts";
import {
	canonicalJson,
	readJsonFile,
	writeJsonAtomic,
} from "../shared/json.ts";
import {
	type CanonicalFindings,
	CanonicalFindingsSchema,
	DeferredFindingRegistrySchema,
	FINDING_SOURCES,
	type Finding,
	type FindingSource,
	ProducerReportSchema,
	RuntimeGateStatusSchema,
} from "./findings-schema.ts";
import { normalizeFinding } from "./normalize-finding.ts";

export interface CollectFindingsOptions {
	readonly iterationDirectory: string;
	readonly scopeFile: string;
	readonly deferredFile: string;
	readonly outputFile?: string;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareFindings(left: Finding, right: Finding): number {
	return (
		compareText(left.id, right.id) ||
		compareText(left.source, right.source) ||
		compareText(left.file, right.file) ||
		(left.line_start ?? -1) - (right.line_start ?? -1)
	);
}

function contextualParse<T>(fileName: string, parse: () => T): T {
	try {
		return parse();
	} catch (error) {
		throw new Error(
			`${fileName} is invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function collectFindings(
	options: CollectFindingsOptions,
): Promise<CanonicalFindings> {
	const scopeValue = await readJsonFile(options.scopeFile);
	const scope = contextualParse("scope.json", () =>
		parseScopeManifest(scopeValue),
	);
	const deferredValue = await readJsonFile(options.deferredFile);
	const deferredRegistry = contextualParse("deferred-findings.json", () =>
		DeferredFindingRegistrySchema.parse(deferredValue),
	);
	const deferredById = new Map<
		string,
		(typeof deferredRegistry.entries)[number]
	>();
	for (const entry of deferredRegistry.entries) {
		if (deferredById.has(entry.finding_id)) {
			throw new Error(
				`deferred-findings.json contains duplicate finding_id ${entry.finding_id}`,
			);
		}
		deferredById.set(entry.finding_id, entry);
	}

	const byId = new Map<string, Finding>();
	const sources: Record<FindingSource, number> = {
		"coding-standards": 0,
		"senior-review": 0,
		"dedup-codebase": 0,
		"runtime-gate": 0,
	};
	let runtimeGateStatus: "pass" | "fail" | "skipped" = "skipped";

	for (const source of FINDING_SOURCES) {
		const fileName = `${source}.json`;
		const raw = await readJsonFile(join(options.iterationDirectory, fileName));
		const report = contextualParse(fileName, () =>
			ProducerReportSchema.parse(raw),
		);
		if (report.skill !== source) {
			throw new Error(
				`${fileName} declares skill ${report.skill}; expected ${source}`,
			);
		}
		if (report.scope_digest !== scope.digest) {
			throw new Error(
				`${fileName} scope_digest ${report.scope_digest} differs from scope.json ${scope.digest}`,
			);
		}
		if (source === "runtime-gate") {
			runtimeGateStatus = contextualParse(fileName, () =>
				RuntimeGateStatusSchema.parse(report.status),
			);
		}
		const sourceIds = new Set<string>();
		for (const value of report.findings) {
			const finding = normalizeFinding(value, source);
			if (finding.axis === "runtime-failure" && source !== "runtime-gate") {
				throw new Error(
					`finding ${finding.id} uses runtime-failure outside runtime-gate`,
				);
			}
			if (
				source === "runtime-gate" &&
				(finding.axis !== "runtime-failure" || finding.severity !== "critical")
			) {
				throw new Error(
					`runtime-gate finding ${finding.id} must be a critical runtime-failure`,
				);
			}
			const previous = byId.get(finding.id);
			if (previous && canonicalJson(previous) !== canonicalJson(finding)) {
				throw new Error(
					`finding id ${finding.id} has different content in the same iteration`,
				);
			}
			if (!previous) byId.set(finding.id, finding);
			sourceIds.add(finding.id);
		}
		sources[source] = sourceIds.size;
	}

	const runtimeFindingCount = [...byId.values()].filter(
		(finding) => finding.source === "runtime-gate",
	).length;
	if (runtimeGateStatus === "fail" && runtimeFindingCount === 0) {
		throw new Error(
			"runtime-gate status fail requires at least one runtime-failure finding",
		);
	}
	if (runtimeGateStatus !== "fail" && runtimeFindingCount > 0) {
		throw new Error(
			`runtime-gate status ${runtimeGateStatus} cannot contain findings`,
		);
	}

	const findings = [...byId.values()].sort(compareFindings);
	const actionableFindings: Finding[] = [];
	const previouslyDeferredFindings: Finding[] = [];
	for (const finding of findings) {
		if (deferredById.has(finding.id)) {
			if (finding.axis === "runtime-failure") {
				throw new Error(`runtime finding ${finding.id} must never be deferred`);
			}
			previouslyDeferredFindings.push(finding);
		} else {
			actionableFindings.push(finding);
		}
	}

	const result = CanonicalFindingsSchema.parse({
		schema_version: 1,
		scope_digest: scope.digest,
		sources,
		findings,
		actionable_findings: actionableFindings,
		previously_deferred_findings: previouslyDeferredFindings,
		runtime_gate_status: runtimeGateStatus,
		summary: {
			total: findings.length,
			actionable: actionableFindings.length,
			deferred: previouslyDeferredFindings.length,
		},
	});
	if (options.outputFile) await writeJsonAtomic(options.outputFile, result);
	return result;
}
