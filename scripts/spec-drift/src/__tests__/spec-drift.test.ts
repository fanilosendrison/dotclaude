import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyIgnores, parseIgnoreFile, runDriftCheck } from "../spec-drift.ts";

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
		expect(() => parseIgnoreFile(p)).toThrow(/justification after '#' is required/);
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
