import { describe, expect, it } from "bun:test";
import type { CrossReferenceMap, ScanResult } from "../src/lib/types";
import { validateIndex } from "../src/lib/validation";

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
	return {
		code: {
			files: ["src/auth/login.ts", "src/utils/helpers.ts"],
			count: 2,
			hash: "",
		},
		specs: {
			files: [
				{
					path: "specs/auth.md",
					frontmatter: {
						id: "SPEC-001",
						version: "1.0",
						depends_on: [],
						validates: [],
					},
					firstHeading: null,
				},
				{ path: "specs/notes.md", frontmatter: null, firstHeading: "Notes" },
			],
			count: 2,
			hash: "",
		},
		config: { files: ["package.json"], count: 1, hash: "" },
		tests: { files: ["tests/auth.test.ts"], count: 1, hash: "" },
		scripts: { files: [], count: 0, hash: "" },
		totalFiles: 6,
		...overrides,
	};
}

function makeRefs(): CrossReferenceMap {
	return new Map([
		[
			"SPEC-001",
			{
				specId: "SPEC-001",
				specPath: "specs/auth.md",
				specVersion: "1.0",
				scope: null,
				dependsOn: [],
				implementedBy: ["src/auth/login.ts"],
				validatedBy: ["tests/auth.test.ts"],
				gaps: [],
				matchStrategy: "convention",
			},
		],
	]);
}

describe("validateIndex", () => {
	it("should detect orphan code files", () => {
		const report = validateIndex(makeScan(), makeRefs());
		// src/utils/helpers.ts is not referenced by any spec
		expect(report.orphanCodeFiles).toContain("src/utils/helpers.ts");
		expect(report.orphanCodeFiles).not.toContain("src/auth/login.ts");
	});

	it("should detect specs without frontmatter", () => {
		const report = validateIndex(makeScan(), makeRefs());
		expect(report.specsWithoutFrontmatter).toEqual(["specs/notes.md"]);
	});

	it("should calculate test coverage percentage", () => {
		const report = validateIndex(makeScan(), makeRefs());
		expect(report.totalSpecs).toBe(1);
		expect(report.specsWithTests).toBe(1);
		expect(report.testCoveragePct).toBe(100);
	});

	it("should detect specs without tests", () => {
		const refs: CrossReferenceMap = new Map([
			[
				"SPEC-001",
				{
					specId: "SPEC-001",
					specPath: "specs/auth.md",
					specVersion: "1.0",
					scope: null,
					dependsOn: [],
					implementedBy: ["src/auth/login.ts"],
					validatedBy: [], // No tests!
					gaps: ["No test files matched"],
					matchStrategy: "convention",
				},
			],
		]);

		const report = validateIndex(makeScan(), refs);
		expect(report.specsWithoutTests).toEqual(["SPEC-001"]);
		expect(report.testCoveragePct).toBe(0);
	});

	it("should estimate tokens and warn if over threshold", () => {
		const report = validateIndex(makeScan(), makeRefs());
		expect(report.estimatedTokens).toBeGreaterThan(0);
		expect(report.tokenWarning).toBe(false); // small project, should be under 10K
	});
});
