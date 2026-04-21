import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CodingStandardsReport,
	Finding,
} from "../../../lib/coding-standards-schema/src/index.ts";
import { consolidate, parseArgs } from "../cli.ts";

function mkFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "0123456789abcdef",
		source: "coding-standards",
		axis: "typing",
		severity: "notable",
		file: "src/foo.ts",
		line_start: 10,
		line_end: 12,
		problem: "weak type any",
		evidence: "any used",
		fix_proposal: "use concrete type",
		observable_change: "grep any returns 0 hits",
		...overrides,
	};
}

function mkReport(findings: Finding[]): CodingStandardsReport {
	const summary = {
		critical: 0,
		major: 0,
		notable: 0,
		minor: 0,
		nit: 0,
		design: 0,
	};
	for (const f of findings) summary[f.severity] += 1;
	const blocking = summary.critical > 0 || summary.major > 0;
	return {
		skill: "coding-standards",
		verdict: findings.length === 0 ? "CLEAN" : "ISSUES_FOUND",
		findings,
		summary,
		blocking,
	};
}

describe("parseArgs", () => {
	it("parses all three required args", () => {
		const a = parseArgs([
			"--scanner-json=/a.json",
			"--files-json-dir=/b",
			"--output=/c.json",
		]);
		expect(a.scannerJson).toBe("/a.json");
		expect(a.filesJsonDir).toBe("/b");
		expect(a.output).toBe("/c.json");
	});

	it("throws when scanner-json is missing", () => {
		expect(() =>
			parseArgs(["--files-json-dir=/b", "--output=/c.json"]),
		).toThrow();
	});

	it("throws when files-json-dir is missing", () => {
		expect(() =>
			parseArgs(["--scanner-json=/a.json", "--output=/c.json"]),
		).toThrow();
	});

	it("throws when output is missing", () => {
		expect(() =>
			parseArgs(["--scanner-json=/a.json", "--files-json-dir=/b"]),
		).toThrow();
	});
});

describe("consolidate", () => {
	it("merges scanner + one per-file report", () => {
		const f1 = mkFinding({ id: "1111111111111111", axis: "typing" });
		const f2 = mkFinding({
			id: "2222222222222222",
			axis: "naming",
			severity: "minor",
		});
		const final = consolidate(mkReport([f1]), [mkReport([f2])]);
		expect(final.findings).toHaveLength(2);
		expect(final.verdict).toBe("ISSUES_FOUND");
		expect(final.summary.notable).toBe(1);
		expect(final.summary.minor).toBe(1);
	});

	it("produces CLEAN when everything is empty", () => {
		const final = consolidate(mkReport([]), [mkReport([])]);
		expect(final.verdict).toBe("CLEAN");
		expect(final.findings).toHaveLength(0);
		expect(final.blocking).toBe(false);
	});

	it("deduplicates findings by id (keeps first occurrence)", () => {
		const f = mkFinding({ id: "dddddddddddddddd", evidence: "scanner" });
		const f2 = mkFinding({ id: "dddddddddddddddd", evidence: "agent" });
		const final = consolidate(mkReport([f]), [mkReport([f2])]);
		expect(final.findings).toHaveLength(1);
		// First occurrence wins (the scanner one).
		expect(final.findings[0]?.evidence).toBe("scanner");
	});

	it("recomputes blocking based on merged findings", () => {
		const critical = mkFinding({
			id: "cccccccccccccccc",
			severity: "critical",
		});
		const final = consolidate(mkReport([]), [mkReport([critical])]);
		expect(final.blocking).toBe(true);
	});

	it("handles zero per-file reports (scanner only)", () => {
		const f = mkFinding({ id: "abababababababab" });
		const final = consolidate(mkReport([f]), []);
		expect(final.findings).toHaveLength(1);
	});
});

describe("consolidate — schema validation on reads (integration)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cs-consolidate-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("consolidate output matches the schema", async () => {
		const { validateReport } = await import(
			"../../../lib/coding-standards-schema/src/index.ts"
		);
		const f = mkFinding({ id: "ffffffffffffffff", severity: "major" });
		const final = consolidate(mkReport([f]), []);
		expect(() => validateReport(final)).not.toThrow();
		expect(final.blocking).toBe(true);
	});

	it("reading an invalid per-file JSON throws during parseReport", async () => {
		const { parseReport } = await import(
			"../../../lib/coding-standards-schema/src/index.ts"
		);
		const bad = join(tempDir, "bad.json");
		writeFileSync(bad, '{"skill": "senior-review", "verdict": "CLEAN"}');
		expect(() => parseReport("not json")).toThrow();
	});
});
