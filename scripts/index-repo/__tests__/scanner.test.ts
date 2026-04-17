import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCrossReferences } from "../src/lib/cross-references";
import { generateManifest } from "../src/lib/manifest-writer";
import { scanProject } from "../src/lib/scanner";
import { validateIndex } from "../src/lib/validation";

const FIXTURES = join(import.meta.dir, "../fixtures/sample-project");
let tempDir: string;

beforeAll(async () => {
	// Copy fixtures to temp git repo (scanners work on any dir, but e2e needs git)
	tempDir = await mkdtemp(join(tmpdir(), "index-repo-integration-"));
	await cp(FIXTURES, tempDir, { recursive: true });
	await Bun.$`cd ${tempDir} && git init && git add . && git commit -m "init"`.quiet();
});

afterAll(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("scanner integration", () => {
	it("should scan all 5 axes from fixture", async () => {
		const scan = await scanProject(tempDir);

		expect(scan.code.count).toBeGreaterThan(0);
		expect(scan.specs.count).toBe(2); // auth-flow.md + no-front.md
		expect(scan.tests.count).toBeGreaterThan(0);
		expect(scan.config.count).toBeGreaterThan(0); // package.json
		expect(scan.totalFiles).toBeGreaterThan(0);
	});

	it("should parse frontmatter from spec files", async () => {
		const scan = await scanProject(tempDir);
		const authSpec = scan.specs.files.find((s) => s.path.includes("auth-flow"));

		expect(authSpec).toBeDefined();
		expect(authSpec?.frontmatter).not.toBeNull();
		expect(authSpec?.frontmatter?.id).toBe("SPEC-001");
		expect(authSpec?.frontmatter?.version).toBe("2.3");
		expect(authSpec?.frontmatter?.depends_on).toEqual(["SPEC-002"]);
	});

	it("should handle specs without frontmatter", async () => {
		const scan = await scanProject(tempDir);
		const noFront = scan.specs.files.find((s) => s.path.includes("no-front"));

		expect(noFront).toBeDefined();
		expect(noFront?.frontmatter).toBeNull();
		expect(noFront?.firstHeading).toBe("Data Model Notes");
	});

	it("should produce deterministic hashes", async () => {
		const scan1 = await scanProject(tempDir);
		const scan2 = await scanProject(tempDir);

		expect(scan1.code.hash).toBe(scan2.code.hash);
		expect(scan1.specs.hash).toBe(scan2.specs.hash);
		expect(scan1.config.hash).toBe(scan2.config.hash);
		expect(scan1.tests.hash).toBe(scan2.tests.hash);
	});
});

describe("end-to-end pipeline", () => {
	it("should produce complete cross-references from fixture", async () => {
		const scan = await scanProject(tempDir);
		const refs = buildCrossReferences(
			scan.specs.files,
			scan.code.files,
			scan.tests.files,
		);

		expect(refs.has("SPEC-001")).toBe(true);
		const ref = refs.get("SPEC-001");
		expect(ref?.implementedBy.length).toBeGreaterThan(0);
		expect(ref?.specVersion).toBe("2.3");
	});

	it("should generate valid manifest from fixture", async () => {
		const scan = await scanProject(tempDir);
		const refs = buildCrossReferences(
			scan.specs.files,
			scan.code.files,
			scan.tests.files,
		);
		const validation = validateIndex(scan, refs);
		const manifest = generateManifest(scan, refs, validation, "abc123def456");

		expect(manifest).toContain("# Spec Manifest");
		expect(manifest).toContain("SPEC-001");
		expect(manifest).toContain("auth-flow.md");
		expect(manifest).toContain("v2.3");
		expect(manifest).toContain("Unindexed Specs");
		expect(manifest).toContain("no-front.md");
	});

	it("should produce deterministic manifest (2 runs = same output)", async () => {
		const scan = await scanProject(tempDir);
		const refs = buildCrossReferences(
			scan.specs.files,
			scan.code.files,
			scan.tests.files,
		);
		const validation = validateIndex(scan, refs);

		const m1 = generateManifest(scan, refs, validation, "abc123");
		const m2 = generateManifest(scan, refs, validation, "abc123");
		expect(m1).toBe(m2);
	});
});
