import { describe, expect, it } from "bun:test";
import { buildCrossReferences } from "../src/lib/cross-references";
import type { SpecFile } from "../src/lib/types";

const codeFiles = [
	"src/auth/login.ts",
	"src/auth/session.ts",
	"src/models/user.ts",
	"src/utils/helpers.ts",
];

const testFiles = [
	"tests/auth/login.test.ts",
	"tests/auth/session.test.ts",
	"tests/models/user.test.ts",
];

describe("buildCrossReferences", () => {
	it("should match via explicit validates patterns", () => {
		const specs: SpecFile[] = [
			{
				path: "specs/auth-flow.md",
				frontmatter: {
					id: "SPEC-001",
					version: "2.3",
					depends_on: ["SPEC-002"],
					validates: ["src/auth/*"],
				},
				firstHeading: "Auth Flow",
			},
		];

		const refs = buildCrossReferences(specs, codeFiles, testFiles);
		const ref = refs.get("SPEC-001");

		expect(ref).toBeDefined();
		expect(ref?.matchStrategy).toBe("mixed"); // explicit + convention both match
		expect(ref?.implementedBy).toContain("src/auth/login.ts");
		expect(ref?.implementedBy).toContain("src/auth/session.ts");
		expect(ref?.validatedBy).toContain("tests/auth/login.test.ts");
		expect(ref?.dependsOn).toEqual(["SPEC-002"]);
		expect(ref?.gaps).toEqual([]);
	});

	it("should match via naming convention when no validates field", () => {
		const specs: SpecFile[] = [
			{
				path: "specs/auth-flow.md",
				frontmatter: {
					id: "SPEC-001",
					version: "1.0",
					depends_on: [],
					validates: [],
				},
				firstHeading: "Auth Flow",
			},
		];

		const refs = buildCrossReferences(specs, codeFiles, testFiles);
		const ref = refs.get("SPEC-001");

		expect(ref?.matchStrategy).toBe("convention");
		expect(ref.implementedBy).toContain("src/auth/login.ts");
		expect(ref.validatedBy).toContain("tests/auth/login.test.ts");
	});

	it("should flag specs with no matches", () => {
		const specs: SpecFile[] = [
			{
				path: "specs/payments.md",
				frontmatter: {
					id: "SPEC-099",
					version: "1.0",
					depends_on: [],
					validates: [],
				},
				firstHeading: "Payments",
			},
		];

		const refs = buildCrossReferences(specs, codeFiles, testFiles);
		const ref = refs.get("SPEC-099");

		expect(ref?.implementedBy).toEqual([]);
		expect(ref?.validatedBy).toEqual([]);
		expect(ref?.gaps).toContain("No implementation files matched");
		expect(ref?.gaps).toContain("No test files matched");
	});

	it("should match case-insensitively across naming conventions", () => {
		const specs: SpecFile[] = [
			{
				path: "specs/Phase_A.md",
				frontmatter: {
					id: "SPEC-PHASE-A",
					version: "0.1.0",
					depends_on: [],
					validates: [],
				},
				firstHeading: "Phase A — Pre-scan",
			},
		];

		const phaseCodeFiles = [
			"src/phase-a.ts",
			"src/phase-b.ts",
			"src/index.ts",
		];
		const phaseTestFiles = [
			"tests/phase-a.test.ts",
			"tests/phase-a-unit.test.ts",
			"tests/phase-b.test.ts",
		];

		const refs = buildCrossReferences(specs, phaseCodeFiles, phaseTestFiles);
		const ref = refs.get("SPEC-PHASE-A");

		expect(ref?.matchStrategy).toBe("convention");
		expect(ref?.implementedBy).toContain("src/phase-a.ts");
		expect(ref?.implementedBy).not.toContain("src/phase-b.ts");
		expect(ref?.implementedBy).not.toContain("src/index.ts");
		expect(ref?.validatedBy).toContain("tests/phase-a.test.ts");
		expect(ref?.validatedBy).toContain("tests/phase-a-unit.test.ts");
		expect(ref?.validatedBy).not.toContain("tests/phase-b.test.ts");
	});

	it("should skip specs without frontmatter", () => {
		const specs: SpecFile[] = [
			{
				path: "specs/notes.md",
				frontmatter: null,
				firstHeading: "Notes",
			},
		];

		const refs = buildCrossReferences(specs, codeFiles, testFiles);
		expect(refs.size).toBe(0);
	});

	it("should use firstHeading as fallback scope", () => {
		const specs: SpecFile[] = [
			{
				path: "specs/auth-flow.md",
				frontmatter: {
					id: "SPEC-001",
					version: "1.0",
					depends_on: [],
					validates: [],
				},
				firstHeading: "Authentication Flow v2",
			},
		];

		const refs = buildCrossReferences(specs, codeFiles, testFiles);
		expect(refs.get("SPEC-001")?.scope).toBe("Authentication Flow v2");
	});

	it("should prefer frontmatter scope over firstHeading", () => {
		const specs: SpecFile[] = [
			{
				path: "specs/auth-flow.md",
				frontmatter: {
					id: "SPEC-001",
					version: "1.0",
					scope: "OAuth2 auth",
					depends_on: [],
					validates: [],
				},
				firstHeading: "Long Heading Here",
			},
		];

		const refs = buildCrossReferences(specs, codeFiles, testFiles);
		expect(refs.get("SPEC-001")?.scope).toBe("OAuth2 auth");
	});
});
