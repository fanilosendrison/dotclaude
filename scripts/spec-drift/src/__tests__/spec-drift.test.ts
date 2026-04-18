import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyIgnores,
	computeDriftDirection,
	findCrossSpecs,
	isApiSurface,
	parseIgnoreFile,
	runDriftCheck,
	scanNormativeLanguage,
	writeJsonReport,
} from "../spec-drift.ts";

async function setupFixture(
	root: string,
	spec: string,
	srcFiles: Record<string, string>,
): Promise<{ specsDir: string; srcDir: string }> {
	const specsDir = join(root, "specs");
	const srcDir = join(root, "src");
	await mkdir(specsDir, { recursive: true });
	await mkdir(srcDir, { recursive: true });
	await writeFile(join(specsDir, "NIB-TEST.md"), spec, "utf-8");
	for (const [name, content] of Object.entries(srcFiles)) {
		await writeFile(join(srcDir, name), content, "utf-8");
	}
	return { specsDir, srcDir };
}

describe("runDriftCheck", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spec-drift-test-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("reports OK when spec and src declarations match", async () => {
		const spec = [
			"# Spec",
			"",
			"```typescript",
			"export interface Foo { a: number; b: string; }",
			"```",
		].join("\n");
		const { specsDir, srcDir } = await setupFixture(root, spec, {
			"foo.ts": "export interface Foo { a: number; b: string; }\n",
		});

		const { checked, missing } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});

		expect(checked).toHaveLength(1);
		expect(checked[0]?.name).toBe("Foo");
		expect(checked[0]?.status).toBe("OK");
		expect(missing).toHaveLength(0);
	});

	test("reports DRIFT when src declaration diverges from spec", async () => {
		const spec = [
			"# Spec",
			"",
			"```typescript",
			"export interface Bar { a: number; b: string; }",
			"```",
		].join("\n");
		const { specsDir, srcDir } = await setupFixture(root, spec, {
			"bar.ts": "export interface Bar { a: number; c: boolean; }\n",
		});

		const { checked, missing } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});

		expect(checked).toHaveLength(1);
		expect(checked[0]?.name).toBe("Bar");
		expect(checked[0]?.status).toBe("DRIFT");
		expect(checked[0]?.detail).toBeDefined();
		expect(missing).toHaveLength(0);
	});

	test("reports MISSING when spec declaration has no matching src export", async () => {
		const spec = [
			"# Spec",
			"",
			"```typescript",
			"export interface Ghost { x: number; }",
			"```",
		].join("\n");
		const { specsDir, srcDir } = await setupFixture(root, spec, {
			"placeholder.ts": "export interface Other { y: number; }\n",
		});

		const { checked, missing } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});

		expect(checked).toHaveLength(0);
		expect(missing).toHaveLength(1);
		expect(missing[0]?.name).toBe("Ghost");
	});
});

describe("parseIgnoreFile", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spec-drift-ignore-test-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("returns empty array when file does not exist", () => {
		const entries = parseIgnoreFile(join(root, ".spec-drift-ignore"));
		expect(entries).toEqual([]);
	});

	test("parses valid entries with justification", async () => {
		const p = join(root, ".spec-drift-ignore");
		await writeFile(
			p,
			[
				"# comment line",
				"",
				"LLMRequest @ specs/NIB-S.md # I-11: readonly override in code",
				"LLMMessage @ specs/NIB-S.md # I-11: readonly arrays override",
			].join("\n"),
			"utf-8",
		);
		const entries = parseIgnoreFile(p);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual({
			name: "LLMRequest",
			specFile: "specs/NIB-S.md",
			reason: "I-11: readonly override in code",
		});
		expect(entries[1]?.name).toBe("LLMMessage");
	});

	test("tolerates trailing whitespace and CRLF", async () => {
		const p = join(root, ".spec-drift-ignore");
		await writeFile(
			p,
			"LLMRequest @ specs/NIB-S.md # reason here  \r\n",
			"utf-8",
		);
		const entries = parseIgnoreFile(p);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.reason).toBe("reason here");
	});

	test("throws when justification is missing (no #)", async () => {
		const p = join(root, ".spec-drift-ignore");
		await writeFile(p, "Foo @ specs/x.md\n", "utf-8");
		expect(() => parseIgnoreFile(p)).toThrow(/missing justification/);
	});

	test("throws when justification is empty (# alone)", async () => {
		const p = join(root, ".spec-drift-ignore");
		await writeFile(p, "Foo @ specs/x.md #\n", "utf-8");
		expect(() => parseIgnoreFile(p)).toThrow(
			/justification after '#' is required/,
		);
	});

	test("throws when @ separator is missing", async () => {
		const p = join(root, ".spec-drift-ignore");
		await writeFile(p, "Foo specs/x.md # reason\n", "utf-8");
		expect(() => parseIgnoreFile(p)).toThrow(
			/expected format 'TypeName @ spec_file # reason'/,
		);
	});

	test("throws when TypeName or spec_file is empty", async () => {
		const p = join(root, ".spec-drift-ignore");
		await writeFile(p, " @ specs/x.md # reason\n", "utf-8");
		expect(() => parseIgnoreFile(p)).toThrow(/must be non-empty/);
	});
});

describe("applyIgnores", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spec-drift-apply-test-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("demotes matching DRIFT to IGNORED and attaches reason", async () => {
		const spec = [
			"# Spec",
			"",
			"```typescript",
			"export interface Bar { a: number; b: string; }",
			"```",
		].join("\n");
		const { specsDir, srcDir } = await setupFixture(root, spec, {
			"bar.ts": "export interface Bar { a: number; c: boolean; }\n",
		});

		const { checked } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});
		expect(checked[0]?.status).toBe("DRIFT");

		applyIgnores(
			checked,
			[
				{
					name: "Bar",
					specFile: "specs/NIB-TEST.md",
					reason: "intentional override for test",
				},
			],
			root,
		);

		expect(checked[0]?.status).toBe("IGNORED");
		expect(checked[0]?.ignoreReason).toBe("intentional override for test");
	});

	test("leaves non-matching drifts untouched", async () => {
		const spec = [
			"# Spec",
			"",
			"```typescript",
			"export interface Bar { a: number; }",
			"```",
		].join("\n");
		const { specsDir, srcDir } = await setupFixture(root, spec, {
			"bar.ts": "export interface Bar { a: string; }\n",
		});

		const { checked } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});
		expect(checked[0]?.status).toBe("DRIFT");

		applyIgnores(
			checked,
			[
				{
					name: "DifferentType",
					specFile: "specs/NIB-TEST.md",
					reason: "unrelated",
				},
			],
			root,
		);

		expect(checked[0]?.status).toBe("DRIFT");
		expect(checked[0]?.ignoreReason).toBeUndefined();
	});

	test("does not demote OK entries even if matched", async () => {
		const spec = [
			"# Spec",
			"",
			"```typescript",
			"export interface Foo { a: number; }",
			"```",
		].join("\n");
		const { specsDir, srcDir } = await setupFixture(root, spec, {
			"foo.ts": "export interface Foo { a: number; }\n",
		});

		const { checked } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});
		expect(checked[0]?.status).toBe("OK");

		applyIgnores(
			checked,
			[
				{
					name: "Foo",
					specFile: "specs/NIB-TEST.md",
					reason: "should not demote an OK entry",
				},
			],
			root,
		);

		expect(checked[0]?.status).toBe("OK");
	});

	test("is no-op when ignores list is empty", async () => {
		const spec = [
			"# Spec",
			"",
			"```typescript",
			"export interface Baz { x: number; }",
			"```",
		].join("\n");
		const { specsDir, srcDir } = await setupFixture(root, spec, {
			"baz.ts": "export interface Baz { x: string; }\n",
		});

		const { checked } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});
		applyIgnores(checked, [], root);
		expect(checked[0]?.status).toBe("DRIFT");
	});
});

describe("scanNormativeLanguage", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spec-drift-normative-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("detects RFC 2119 uppercase keywords within radius", async () => {
		const spec = [
			"# Spec",
			"", // line 2
			"The field MUST be non-empty.", // line 3
			"", // line 4
			"```typescript", // line 5 (drift anchor)
			"export interface Foo { a: number; }",
			"```",
		].join("\n");
		const path = join(root, "spec.md");
		await writeFile(path, spec, "utf-8");
		const tags = scanNormativeLanguage(path, 5, 10);
		expect(tags).toContain("MUST");
	});

	test("detects French 'obligatoire' case-insensitively", async () => {
		const spec = [
			"# Spec",
			"",
			"Le champ `sanitization` est obligatoire.",
			"",
			"```typescript",
			"export interface Cfg { sanitization: unknown; }",
			"```",
		].join("\n");
		const path = join(root, "spec.md");
		await writeFile(path, spec, "utf-8");
		const tags = scanNormativeLanguage(path, 5, 10);
		expect(tags).toContain("obligatoire");
	});

	test("detects 'DOIT' but not its lowercase prose form 'doit'", async () => {
		const spec = [
			"# Spec",
			"",
			"Le moteur DOIT valider la config au boot.",
			"",
			"```typescript",
			"export interface Boot { validate: boolean; }",
			"```",
		].join("\n");
		const path = join(root, "spec.md");
		await writeFile(path, spec, "utf-8");
		const tagsDoit = scanNormativeLanguage(path, 5, 10);
		expect(tagsDoit).toContain("DOIT");

		// Lowercase "doit" in French prose is not normative — must not match.
		const proseSpec = [
			"# Spec",
			"",
			"La factory doit pouvoir être appelée plusieurs fois.",
			"",
			"```typescript",
			"export interface Factory { call: () => void; }",
			"```",
		].join("\n");
		const p2 = join(root, "spec2.md");
		await writeFile(p2, proseSpec, "utf-8");
		const tagsProse = scanNormativeLanguage(p2, 5, 10);
		expect(tagsProse).not.toContain("DOIT");
	});

	test("returns empty when keywords are outside the radius", async () => {
		const lines = ["# Spec", ""];
		// Put a MUST at line 3, then 30 filler lines, then the block at line ~34.
		lines.push("The field MUST be set.");
		for (let i = 0; i < 30; i += 1) lines.push("filler prose line.");
		const blockLine = lines.length + 1;
		lines.push("```typescript");
		lines.push("export interface Bar { a: number; }");
		lines.push("```");
		const path = join(root, "spec.md");
		await writeFile(path, lines.join("\n"), "utf-8");
		const tags = scanNormativeLanguage(path, blockLine, 10);
		expect(tags).not.toContain("MUST");
	});

	test("returns empty list when spec has no normative keywords", async () => {
		const spec = [
			"# Spec",
			"",
			"Here is a type declaration.",
			"",
			"```typescript",
			"export interface Foo { a: number; }",
			"```",
		].join("\n");
		const path = join(root, "spec.md");
		await writeFile(path, spec, "utf-8");
		const tags = scanNormativeLanguage(path, 5, 10);
		expect(tags).toEqual([]);
	});

	test("deduplicates repeated keywords (same tag appears at most once)", async () => {
		const spec = [
			"# Spec",
			"",
			"The value MUST be set. Again, MUST. And finally, MUST.",
			"",
			"```typescript",
			"export interface Foo { v: string; }",
			"```",
		].join("\n");
		const path = join(root, "spec.md");
		await writeFile(path, spec, "utf-8");
		const tags = scanNormativeLanguage(path, 5, 10);
		const mustCount = tags.filter((t) => t === "MUST").length;
		expect(mustCount).toBe(1);
	});

	test("hierarchically suppresses positive form when negated form matches (MUST NOT hides MUST)", async () => {
		const spec = [
			"# Spec",
			"",
			"The value MUST NOT be empty.",
			"",
			"```typescript",
			"export interface Foo { v: string; }",
			"```",
		].join("\n");
		const path = join(root, "spec.md");
		await writeFile(path, spec, "utf-8");
		const tags = scanNormativeLanguage(path, 5, 10);
		expect(tags).toContain("MUST NOT");
		expect(tags).not.toContain("MUST");
	});

	test("hierarchically suppresses DOIT when NE DOIT PAS matches", async () => {
		const spec = [
			"# Spec",
			"",
			"Le champ NE DOIT PAS etre vide.",
			"",
			"```typescript",
			"export interface Foo { v: string; }",
			"```",
		].join("\n");
		const path = join(root, "spec.md");
		await writeFile(path, spec, "utf-8");
		const tags = scanNormativeLanguage(path, 5, 10);
		expect(tags).toContain("NE DOIT PAS");
		expect(tags).not.toContain("DOIT");
		expect(tags).not.toContain("DOIT PAS");
	});

	// Individual pattern coverage. Each keyword gets a minimal fixture so a
	// regression in the corresponding regex (typo, removed entry, wrong
	// flags) fails loudly. The earlier hierarchical tests already cover
	// MUST / MUST NOT / NE DOIT PAS / DOIT PAS / DOIT / obligatoire; this
	// block covers the remaining patterns in NORMATIVE_PATTERNS.
	test.each([
		["SHALL", "The component SHALL validate input on boot."],
		["SHALL NOT", "The component SHALL NOT retry on 4xx."],
		["REQUIRED", "The field is REQUIRED for authentication."],
		["DOIVENT", "Les champs DOIVENT etre remplis."],
		["requis", "Ce parametre est requis au demarrage."],
		["explicitement", "Ce cas est traite explicitement par la spec."],
	])("detects normative keyword %s", async (expectedTag, proseLine) => {
		const spec = [
			"# Spec",
			"",
			proseLine,
			"",
			"```typescript",
			"export interface Foo { v: string; }",
			"```",
		].join("\n");
		const path = join(root, `spec-${expectedTag.replace(/\s+/g, "-")}.md`);
		await writeFile(path, spec, "utf-8");
		const tags = scanNormativeLanguage(path, 5, 10);
		expect(tags).toContain(expectedTag);
	});
});

describe("isApiSurface", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spec-drift-api-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("returns false when src/index.ts does not exist", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(srcFile, "export interface Foo { a: number; }\n", "utf-8");
		expect(isApiSurface(srcFile, "Foo", srcDir)).toBe(false);
	});

	test("returns true when drift site IS src/index.ts", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const indexFile = join(srcDir, "index.ts");
		await writeFile(
			indexFile,
			"export interface Foo { a: number; }\n",
			"utf-8",
		);
		expect(isApiSurface(indexFile, "Foo", srcDir)).toBe(true);
	});

	test("detects named re-export `export { X } from './m.js'`", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(
			srcFile,
			"export interface LLMRequest { m: string; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "index.ts"),
			'export { LLMRequest } from "./types.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "LLMRequest", srcDir)).toBe(true);
	});

	test("detects named type re-export `export type { X } from './m.js'`", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(srcFile, "export interface Cfg { a: number; }\n", "utf-8");
		await writeFile(
			join(srcDir, "index.ts"),
			'export type { Cfg } from "./types.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Cfg", srcDir)).toBe(true);
	});

	test("detects aliased re-export `export { X as Y }`", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(
			srcFile,
			"export interface Internal { a: number; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "index.ts"),
			'export { Internal as Public } from "./types.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Internal", srcDir)).toBe(true);
	});

	test("detects star re-export `export * from './m.js'`", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(srcFile, "export interface Foo { a: number; }\n", "utf-8");
		await writeFile(
			join(srcDir, "index.ts"),
			'export * from "./types.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Foo", srcDir)).toBe(true);
	});

	test("returns false when type is only in a non-reexported module", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "internals.ts");
		await writeFile(
			srcFile,
			"export interface Hidden { a: number; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "index.ts"),
			'export { Something } from "./other.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Hidden", srcDir)).toBe(false);
	});

	test("ignores commented-out line exports `// export { Foo } from ...`", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(srcFile, "export interface Foo { a: number; }\n", "utf-8");
		await writeFile(
			join(srcDir, "index.ts"),
			'// export { Foo } from "./types.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Foo", srcDir)).toBe(false);
	});

	test("ignores commented-out block exports `/* export { Foo } ... */`", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(srcFile, "export interface Foo { a: number; }\n", "utf-8");
		await writeFile(
			join(srcDir, "index.ts"),
			'/* export { Foo } from "./types.js"; */\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Foo", srcDir)).toBe(false);
	});

	test("detects multi-line named re-export", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		const srcFile = join(srcDir, "types.ts");
		await writeFile(
			srcFile,
			"export interface Foo { a: number; }\nexport interface Bar { b: string; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "index.ts"),
			'export {\n\tFoo,\n\tBar,\n} from "./types.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Foo", srcDir)).toBe(true);
		expect(isApiSurface(srcFile, "Bar", srcDir)).toBe(true);
	});

	test("returns false when same-name type is re-exported from a different module", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		await writeFile(
			join(srcDir, "types.ts"),
			"export interface Foo { a: number; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "unrelated.ts"),
			"export interface Foo { b: string; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "index.ts"),
			'export { Foo } from "./unrelated.js";\n',
			"utf-8",
		);
		expect(isApiSurface(join(srcDir, "types.ts"), "Foo", srcDir)).toBe(false);
		expect(isApiSurface(join(srcDir, "unrelated.ts"), "Foo", srcDir)).toBe(
			true,
		);
	});

	test("returns false for star re-export of a different module", async () => {
		const srcDir = join(root, "src");
		await mkdir(srcDir, { recursive: true });
		await writeFile(join(srcDir, "other.ts"), "export const x = 1;\n", "utf-8");
		const srcFile = join(srcDir, "hidden.ts");
		await writeFile(
			srcFile,
			"export interface Hidden { a: number; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "index.ts"),
			'export * from "./other.js";\n',
			"utf-8",
		);
		expect(isApiSurface(srcFile, "Hidden", srcDir)).toBe(false);
	});
});

describe("findCrossSpecs", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spec-drift-cross-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("returns empty when type is declared in only one spec", async () => {
		const specsDir = join(root, "specs");
		await mkdir(specsDir, { recursive: true });
		const spec1 = [
			"# Spec 1",
			"```typescript",
			"export interface Foo { a: number; }",
			"```",
		].join("\n");
		const spec2 = [
			"# Spec 2",
			"```typescript",
			"export interface Bar { b: string; }",
			"```",
		].join("\n");
		await writeFile(join(specsDir, "NIB-1.md"), spec1, "utf-8");
		await writeFile(join(specsDir, "NIB-2.md"), spec2, "utf-8");
		const others = findCrossSpecs("Foo", join(specsDir, "NIB-1.md"), specsDir);
		expect(others).toEqual([]);
	});

	test("returns other specs that declare the same type", async () => {
		const specsDir = join(root, "specs");
		await mkdir(specsDir, { recursive: true });
		const body = [
			"# Spec",
			"```typescript",
			"export interface LLMRequest { m: string; }",
			"```",
		].join("\n");
		await writeFile(join(specsDir, "NIB-S.md"), body, "utf-8");
		await writeFile(join(specsDir, "NIB-M-X.md"), body, "utf-8");
		await writeFile(join(specsDir, "NIB-M-Y.md"), body, "utf-8");
		const others = findCrossSpecs(
			"LLMRequest",
			join(specsDir, "NIB-S.md"),
			specsDir,
		);
		expect(others.sort()).toEqual(["NIB-M-X.md", "NIB-M-Y.md"]);
	});

	test("ignores specs where type name only appears in prose", async () => {
		const specsDir = join(root, "specs");
		await mkdir(specsDir, { recursive: true });
		const decl = [
			"# Spec 1",
			"```typescript",
			"export interface Foo { a: number; }",
			"```",
		].join("\n");
		const prose = [
			"# Spec 2",
			"",
			"The type `Foo` is mentioned in prose but not declared here.",
		].join("\n");
		await writeFile(join(specsDir, "NIB-1.md"), decl, "utf-8");
		await writeFile(join(specsDir, "NIB-2.md"), prose, "utf-8");
		const others = findCrossSpecs("Foo", join(specsDir, "NIB-1.md"), specsDir);
		expect(others).toEqual([]);
	});

	test("ignores spec-only blocks", async () => {
		const specsDir = join(root, "specs");
		await mkdir(specsDir, { recursive: true });
		const decl = [
			"# Spec 1",
			"```typescript",
			"export interface Foo { a: number; }",
			"```",
		].join("\n");
		const specOnly = [
			"# Spec 2",
			"```typescript",
			"// spec-only",
			"export interface Foo { a: number; }",
			"```",
		].join("\n");
		await writeFile(join(specsDir, "NIB-1.md"), decl, "utf-8");
		await writeFile(join(specsDir, "NIB-2.md"), specOnly, "utf-8");
		const others = findCrossSpecs("Foo", join(specsDir, "NIB-1.md"), specsDir);
		expect(others).toEqual([]);
	});
});

describe("computeDriftDirection", () => {
	test("returns ambiguous when no hints trigger", () => {
		const { direction, reason } = computeDriftDirection({
			normative_language: [],
			api_surface: false,
			cross_spec_files: [],
		});
		expect(direction).toBe("ambiguous");
		expect(reason).toMatch(/no blocking signal/);
	});

	test("returns block when normative language present", () => {
		const { direction, reason } = computeDriftDirection({
			normative_language: ["MUST"],
			api_surface: false,
			cross_spec_files: [],
		});
		expect(direction).toBe("block");
		expect(reason).toMatch(/normative keywords/);
		expect(reason).toMatch(/MUST/);
	});

	test("returns block when api_surface is true", () => {
		const { direction, reason } = computeDriftDirection({
			normative_language: [],
			api_surface: true,
			cross_spec_files: [],
		});
		expect(direction).toBe("block");
		expect(reason).toMatch(/public surface/);
	});

	test("returns block when type is declared in multiple specs", () => {
		const { direction, reason } = computeDriftDirection({
			normative_language: [],
			api_surface: false,
			cross_spec_files: ["NIB-M-X.md", "NIB-M-Y.md"],
		});
		expect(direction).toBe("block");
		expect(reason).toMatch(/other specs/);
		expect(reason).toMatch(/NIB-M-X\.md/);
	});

	test("concatenates all triggering reasons when multiple hints", () => {
		const { direction, reason } = computeDriftDirection({
			normative_language: ["obligatoire"],
			api_surface: true,
			cross_spec_files: ["NIB-M-X.md"],
		});
		expect(direction).toBe("block");
		expect(reason).toMatch(/normative/);
		expect(reason).toMatch(/public surface/);
		expect(reason).toMatch(/other specs/);
		// Separator is "; "
		expect(reason.split("; ")).toHaveLength(3);
	});
});

describe("writeJsonReport (end-to-end)", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spec-drift-json-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("serializes hints + direction + direction_reason per drift entry", async () => {
		const specsDir = join(root, "specs");
		const srcDir = join(root, "src");
		await mkdir(specsDir, { recursive: true });
		await mkdir(srcDir, { recursive: true });
		// Spec with normative language + a cross-spec type to ensure
		// multiple hints fire simultaneously.
		const mainSpec = [
			"# NIB-MAIN",
			"",
			"The field `v` MUST be set and is obligatoire.",
			"",
			"```typescript",
			"export interface Cfg { v: string; }",
			"```",
		].join("\n");
		const otherSpec = [
			"# NIB-OTHER",
			"",
			"```typescript",
			"export interface Cfg { v: number; }",
			"```",
		].join("\n");
		await writeFile(join(specsDir, "NIB-MAIN.md"), mainSpec, "utf-8");
		await writeFile(join(specsDir, "NIB-OTHER.md"), otherSpec, "utf-8");
		// src/types.ts has a different shape (drift) AND is on the public
		// surface via a star re-export in index.ts.
		await writeFile(
			join(srcDir, "types.ts"),
			"export interface Cfg { v: number; }\n",
			"utf-8",
		);
		await writeFile(
			join(srcDir, "index.ts"),
			'export * from "./types.js";\n',
			"utf-8",
		);

		const { checked } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});
		expect(checked[0]?.status).toBe("DRIFT");

		const jsonPath = join(root, "report.json");
		writeJsonReport(checked, [], 1, jsonPath, root, specsDir, srcDir);

		const report = JSON.parse(await readFile(jsonPath, "utf-8"));
		expect(report.drift).toHaveLength(1);
		const entry = report.drift[0];
		expect(entry.name).toBe("Cfg");
		expect(entry.hints).toBeDefined();
		expect(entry.hints.normative_language).toContain("MUST");
		expect(entry.hints.normative_language).toContain("obligatoire");
		expect(entry.hints.api_surface).toBe(true);
		expect(entry.hints.cross_spec_files).toContain("NIB-OTHER.md");
		expect(entry.direction).toBe("block");
		expect(entry.direction_reason).toMatch(/normative keywords/);
		expect(entry.direction_reason).toMatch(/public surface/);
		expect(entry.direction_reason).toMatch(/other specs/);
	});

	test("emits direction=ambiguous when no signal fires", async () => {
		const specsDir = join(root, "specs");
		const srcDir = join(root, "src");
		await mkdir(specsDir, { recursive: true });
		await mkdir(srcDir, { recursive: true });
		// No normative keywords, no cross-spec, no re-export.
		const spec = [
			"# NIB-PLAIN",
			"",
			"A plain type declaration without rules.",
			"",
			"```typescript",
			"export interface Plain { v: string; }",
			"```",
		].join("\n");
		await writeFile(join(specsDir, "NIB-PLAIN.md"), spec, "utf-8");
		await writeFile(
			join(srcDir, "plain.ts"),
			"export interface Plain { v: number; }\n",
			"utf-8",
		);

		const { checked } = runDriftCheck({
			specsDir,
			srcDir,
			tmpFile: join(root, "drift-assertion.ts"),
		});
		expect(checked[0]?.status).toBe("DRIFT");

		const jsonPath = join(root, "report.json");
		writeJsonReport(checked, [], 1, jsonPath, root, specsDir, srcDir);

		const report = JSON.parse(await readFile(jsonPath, "utf-8"));
		const entry = report.drift[0];
		expect(entry.hints.normative_language).toEqual([]);
		expect(entry.hints.api_surface).toBe(false);
		expect(entry.hints.cross_spec_files).toEqual([]);
		expect(entry.direction).toBe("ambiguous");
	});

	test("emits empty drift array when no DRIFT entries", async () => {
		const jsonPath = join(root, "report.json");
		const specsDir = join(root, "specs");
		const srcDir = join(root, "src");
		await mkdir(specsDir, { recursive: true });
		await mkdir(srcDir, { recursive: true });
		writeJsonReport([], [], 0, jsonPath, root, specsDir, srcDir);
		const report = JSON.parse(await readFile(jsonPath, "utf-8"));
		expect(report.drift).toEqual([]);
		expect(report.checked_count).toBe(0);
		expect(report.ignored_count).toBe(0);
		expect(report.missing_count).toBe(0);
	});
});
