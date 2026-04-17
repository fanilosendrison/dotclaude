import { describe, expect, it } from "bun:test";
import { generateManifest } from "../src/lib/manifest-writer";
import type {
	CrossReferenceMap,
	ScanResult,
	ValidationReport,
} from "../src/lib/types";

function makeScan(): ScanResult {
	return {
		code: { files: ["src/auth/login.ts"], count: 1, hash: "" },
		specs: {
			files: [
				{
					path: "specs/auth-flow.md",
					frontmatter: {
						id: "SPEC-001",
						version: "2.3",
						scope: "OAuth2",
						depends_on: ["SPEC-002"],
						validates: ["src/auth/*"],
					},
					firstHeading: "Auth",
				},
				{
					path: "specs/notes.md",
					frontmatter: null,
					firstHeading: "Data Model Notes",
				},
			],
			count: 2,
			hash: "",
		},
		config: { files: [], count: 0, hash: "" },
		tests: { files: ["tests/auth/login.test.ts"], count: 1, hash: "" },
		scripts: { files: [], count: 0, hash: "" },
		totalFiles: 4,
	};
}

function makeRefs(): CrossReferenceMap {
	return new Map([
		[
			"SPEC-001",
			{
				specId: "SPEC-001",
				specPath: "specs/auth-flow.md",
				specVersion: "2.3",
				scope: "OAuth2",
				dependsOn: ["SPEC-002"],
				implementedBy: ["src/auth/login.ts"],
				validatedBy: ["tests/auth/login.test.ts"],
				gaps: [],
				matchStrategy: "explicit" as const,
			},
		],
	]);
}

function makeValidation(): ValidationReport {
	return {
		orphanCodeFiles: [],
		specsWithoutTests: [],
		specsWithoutCode: [],
		specsWithoutFrontmatter: ["specs/notes.md"],
		specsWithInvalidFrontmatter: [],
		totalSpecs: 1,
		specsWithTests: 1,
		testCoveragePct: 100,
		estimatedTokens: 500,
		tokenWarning: false,
	};
}

describe("generateManifest", () => {
	it("should produce deterministic output", () => {
		const scan = makeScan();
		const refs = makeRefs();
		const val = makeValidation();

		const output1 = generateManifest(scan, refs, val, "abc123def456");
		const output2 = generateManifest(scan, refs, val, "abc123def456");

		expect(output1).toBe(output2);
	});

	it("should contain header with git ref", () => {
		const output = generateManifest(
			makeScan(),
			makeRefs(),
			makeValidation(),
			"abc123def456",
		);
		expect(output).toContain("Git ref: abc123d");
	});

	it("should contain summary stats", () => {
		const output = generateManifest(
			makeScan(),
			makeRefs(),
			makeValidation(),
			"abc123def456",
		);
		expect(output).toContain("Specs: 1");
		expect(output).toContain("With tests: 1 (100%)");
		expect(output).toContain("Gaps: 0");
	});

	it("should contain spec block with correct format", () => {
		const output = generateManifest(
			makeScan(),
			makeRefs(),
			makeValidation(),
			"abc123def456",
		);
		expect(output).toContain("### SPEC-001 — auth-flow.md (v2.3)");
		expect(output).toContain("**Scope**: OAuth2");
		expect(output).toContain("**Depends on**: SPEC-002");
		expect(output).toContain("**Implements**: src/auth/login.ts");
		expect(output).toContain("**Validated by**: tests/auth/login.test.ts");
	});

	it("should list unindexed specs", () => {
		const output = generateManifest(
			makeScan(),
			makeRefs(),
			makeValidation(),
			"abc123def456",
		);
		expect(output).toContain("Unindexed Specs");
		expect(output).toContain("specs/notes.md");
		expect(output).toContain("Data Model Notes");
	});

	it("should warn about specs without frontmatter", () => {
		const output = generateManifest(
			makeScan(),
			makeRefs(),
			makeValidation(),
			"abc123def456",
		);
		expect(output).toContain("Warning");
		expect(output).toContain("specs/notes.md");
	});

	it("should sort specs by ID", () => {
		const refs: CrossReferenceMap = new Map([
			[
				"SPEC-002",
				{
					specId: "SPEC-002",
					specPath: "b.md",
					specVersion: "1.0",
					scope: null,
					dependsOn: [],
					implementedBy: [],
					validatedBy: [],
					gaps: [],
					matchStrategy: "convention",
				},
			],
			[
				"SPEC-001",
				{
					specId: "SPEC-001",
					specPath: "a.md",
					specVersion: "1.0",
					scope: null,
					dependsOn: [],
					implementedBy: [],
					validatedBy: [],
					gaps: [],
					matchStrategy: "convention",
				},
			],
		]);

		const output = generateManifest(
			makeScan(),
			refs,
			makeValidation(),
			"abc123",
		);
		const idx1 = output.indexOf("SPEC-001");
		const idx2 = output.indexOf("SPEC-002");
		expect(idx1).toBeLessThan(idx2);
	});
});
