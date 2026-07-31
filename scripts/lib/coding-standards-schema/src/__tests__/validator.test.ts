import { describe, expect, it } from "bun:test";
import { FindingSchema, parseReport, validateReport } from "../validator.ts";

const validFinding = {
	id: "0123456789abcdef",
	source: "coding-standards",
	axis: "typing",
	severity: "notable",
	file: "src/foo.ts",
	line_start: 10,
	line_end: 12,
	problem: "weak type any in foo return",
	evidence: "return value typed as any",
	fix_proposal: "Replace any with FooReturn",
	observable_change: "grep '\\bany\\b' src/foo.ts returns 0 hits on that line",
};

const validReport = {
	skill: "coding-standards",
	scope_digest: "a".repeat(64),
	verdict: "ISSUES_FOUND",
	findings: [validFinding],
	summary: {
		critical: 0,
		major: 0,
		notable: 1,
		minor: 0,
		nit: 0,
		design: 0,
	},
	blocking: false,
};

describe("FindingSchema", () => {
	it("accepts a valid finding", () => {
		expect(() => FindingSchema.parse(validFinding)).not.toThrow();
	});

	it("rejects a bad id (not hex)", () => {
		const bad = { ...validFinding, id: "NOT_HEX_XXXXXXXX" };
		expect(() => FindingSchema.parse(bad)).toThrow();
	});

	it("rejects an id of wrong length", () => {
		const bad = { ...validFinding, id: "abcdef" };
		expect(() => FindingSchema.parse(bad)).toThrow();
	});

	it("rejects an unknown axis", () => {
		const bad = { ...validFinding, axis: "not-an-axis" };
		expect(() => FindingSchema.parse(bad)).toThrow();
	});

	it("rejects an unknown severity", () => {
		const bad = { ...validFinding, severity: "catastrophic" };
		expect(() => FindingSchema.parse(bad)).toThrow();
	});

	it("rejects empty observable_change when severity != design", () => {
		const bad = { ...validFinding, observable_change: "" };
		expect(() => FindingSchema.parse(bad)).toThrow();
	});

	it("allows empty observable_change when severity = design", () => {
		const ok = {
			...validFinding,
			severity: "design",
			observable_change: "",
		};
		expect(() => FindingSchema.parse(ok)).not.toThrow();
	});

	it("accepts null line_start / line_end", () => {
		const ok = { ...validFinding, line_start: null, line_end: null };
		expect(() => FindingSchema.parse(ok)).not.toThrow();
	});

	it("rejects non-'coding-standards' source", () => {
		const bad = { ...validFinding, source: "senior-review" };
		expect(() => FindingSchema.parse(bad)).toThrow();
	});
});

describe("ReportSchema", () => {
	it("accepts a valid report", () => {
		expect(() => validateReport(validReport)).not.toThrow();
	});

	it("accepts a CLEAN empty report", () => {
		const empty = {
			skill: "coding-standards",
			scope_digest: "a".repeat(64),
			verdict: "CLEAN",
			findings: [],
			summary: {
				critical: 0,
				major: 0,
				notable: 0,
				minor: 0,
				nit: 0,
				design: 0,
			},
			blocking: false,
		};
		expect(() => validateReport(empty)).not.toThrow();
	});

	it("rejects report with wrong skill label", () => {
		const bad = { ...validReport, skill: "senior-review" };
		expect(() => validateReport(bad)).toThrow();
	});

	it("rejects a missing scope digest", () => {
		const { scope_digest: _omit, ...bad } = validReport;
		expect(() => validateReport(bad)).toThrow();
	});

	it("rejects report with invalid verdict", () => {
		const bad = { ...validReport, verdict: "MAYBE" };
		expect(() => validateReport(bad)).toThrow();
	});

	it("rejects report missing summary", () => {
		const { summary: _omit, ...rest } = validReport as {
			summary: unknown;
			[k: string]: unknown;
		};
		expect(() => validateReport(rest)).toThrow();
	});

	it("parseReport round-trips", () => {
		const parsed = parseReport(JSON.stringify(validReport));
		expect(parsed.findings[0]?.id).toBe(validFinding.id);
		expect(parsed.verdict).toBe("ISSUES_FOUND");
	});

	it("parseReport throws on invalid JSON", () => {
		expect(() => parseReport("not json")).toThrow();
	});
});
