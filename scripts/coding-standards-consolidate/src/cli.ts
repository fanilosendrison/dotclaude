#!/usr/bin/env bun
/**
 * coding-standards-consolidate — deterministic merge of the scanner JSON
 * and per-file sub-agent JSONs into a single coding-standards report.
 *
 * No LLM, no judgment. Merge, validate, recompute summary, emit.
 *
 * Usage:
 *   bun cli.ts \
 *     --scanner-json=<path> \
 *     --files-json-dir=<dir>  # directory containing *.json per-file reports
 *     --output=<path>
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
	computeBlocking,
	computeSummary,
	type CodingStandardsReport,
	type Finding,
	parseReport,
	validateReport,
} from "../../lib/coding-standards-schema/src/index.ts";

export interface ConsolidateArgs {
	scannerJson: string;
	filesJsonDir: string;
	output: string;
}

export function parseArgs(argv: string[]): ConsolidateArgs {
	let scannerJson: string | undefined;
	let filesJsonDir: string | undefined;
	let output: string | undefined;

	for (const arg of argv) {
		if (arg.startsWith("--scanner-json=")) {
			scannerJson = arg.slice("--scanner-json=".length);
		} else if (arg.startsWith("--files-json-dir=")) {
			filesJsonDir = arg.slice("--files-json-dir=".length);
		} else if (arg.startsWith("--output=")) {
			output = arg.slice("--output=".length);
		}
	}
	if (!scannerJson) throw new Error("missing --scanner-json=<path>");
	if (!filesJsonDir) throw new Error("missing --files-json-dir=<dir>");
	if (!output) throw new Error("missing --output=<path>");
	return { scannerJson, filesJsonDir, output };
}

/**
 * Consolidate scanner + per-file JSONs into a single report.
 *
 * - HARD FAIL (throws) if any input JSON fails schema validation. The
 *   calling script should map that to exit 4 (see loop-clean.sh pattern).
 * - Defensive dedup by id: on collision, keep the first occurrence and
 *   warn to stderr.
 */
export function consolidate(
	scannerReport: CodingStandardsReport,
	perFileReports: readonly CodingStandardsReport[],
): CodingStandardsReport {
	const byId = new Map<string, Finding>();

	for (const f of scannerReport.findings) {
		byId.set(f.id, f);
	}
	for (const report of perFileReports) {
		for (const f of report.findings) {
			if (byId.has(f.id)) {
				console.warn(
					`[coding-standards-consolidate] duplicate finding id ${f.id} (${f.file}:${f.line_start ?? "?"} ${f.axis}) — keeping first occurrence.`,
				);
				continue;
			}
			byId.set(f.id, f);
		}
	}

	const findings = [...byId.values()];
	const summary = computeSummary(findings);
	const blocking = computeBlocking(summary);

	return {
		skill: "coding-standards",
		verdict: findings.length === 0 ? "CLEAN" : "ISSUES_FOUND",
		findings,
		summary,
		blocking,
	};
}

async function readReport(path: string): Promise<CodingStandardsReport> {
	const text = await Bun.file(path).text();
	try {
		return parseReport(text);
	} catch (e) {
		throw new Error(
			`Invalid coding-standards JSON at ${path}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const scanner = await readReport(args.scannerJson);

	let entries: string[] = [];
	try {
		entries = readdirSync(args.filesJsonDir);
	} catch {
		// Directory absent → treat as no per-file reports. Deliberate:
		// orchestrator may skip the sub-agent step when there are zero files.
		entries = [];
	}
	const jsonFiles = entries
		.filter((name) => name.endsWith(".json"))
		.map((name) => join(args.filesJsonDir, name));

	const perFile: CodingStandardsReport[] = [];
	for (const path of jsonFiles) {
		perFile.push(await readReport(path));
	}

	const final = consolidate(scanner, perFile);
	validateReport(final);

	await Bun.write(args.output, `${JSON.stringify(final, null, 2)}\n`);
}

// Only run main when invoked directly — keeps the module importable for tests.
if (import.meta.main) {
	main().catch((err: unknown) => {
		console.error(
			"[coding-standards-consolidate] fatal:",
			err instanceof Error ? err.message : String(err),
		);
		process.exit(4);
	});
}
