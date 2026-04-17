import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findStackEval, readStackConfig } from "../lib/stack-config.ts";

describe("findStackEval", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "post-write-linter-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("finds STACK_EVAL.yaml in the same directory", () => {
		writeFileSync(
			join(tempDir, "STACK_EVAL.yaml"),
			"decisions:\n  linter: biome",
		);
		const result = findStackEval(join(tempDir, "src", "file.ts"));
		// file.ts parent is tempDir (src doesn't exist but dirname still works)
		// Actually need to check — findStackEval walks from dirname of filePath
		// dirname of tempDir/src/file.ts = tempDir/src, then walks up to tempDir
		expect(result).toBe(join(tempDir, "STACK_EVAL.yaml"));
	});

	it("finds STACK_EVAL.yaml in parent directory", () => {
		const subDir = join(tempDir, "src", "lib");
		mkdirSync(subDir, { recursive: true });
		writeFileSync(
			join(tempDir, "STACK_EVAL.yaml"),
			"decisions:\n  linter: biome",
		);

		const result = findStackEval(join(subDir, "file.ts"));
		expect(result).toBe(join(tempDir, "STACK_EVAL.yaml"));
	});

	it("returns null when no STACK_EVAL.yaml found", () => {
		const result = findStackEval(join(tempDir, "file.ts"));
		expect(result).toBeNull();
	});
});

describe("readStackConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "post-write-linter-config-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("parses linter and type_checker", async () => {
		const yamlPath = join(tempDir, "STACK_EVAL.yaml");
		writeFileSync(
			yamlPath,
			"decisions:\n  linter: biome\n  type_checker: tsc\n",
		);

		const config = await readStackConfig(yamlPath);
		expect(config.linter).toBe("biome");
		expect(config.typeChecker).toBe("tsc");
	});

	it("normalizes 'none' to null", async () => {
		const yamlPath = join(tempDir, "STACK_EVAL.yaml");
		writeFileSync(
			yamlPath,
			"decisions:\n  linter: none\n  type_checker: none\n",
		);

		const config = await readStackConfig(yamlPath);
		expect(config.linter).toBeNull();
		expect(config.typeChecker).toBeNull();
	});

	it("handles missing decisions gracefully", async () => {
		const yamlPath = join(tempDir, "STACK_EVAL.yaml");
		writeFileSync(yamlPath, "project_name: test\n");

		const config = await readStackConfig(yamlPath);
		expect(config.linter).toBeNull();
		expect(config.typeChecker).toBeNull();
	});

	it("handles missing type_checker", async () => {
		const yamlPath = join(tempDir, "STACK_EVAL.yaml");
		writeFileSync(yamlPath, "decisions:\n  linter: ruff\n");

		const config = await readStackConfig(yamlPath);
		expect(config.linter).toBe("ruff");
		expect(config.typeChecker).toBeNull();
	});

	it("lowercases values", async () => {
		const yamlPath = join(tempDir, "STACK_EVAL.yaml");
		writeFileSync(
			yamlPath,
			"decisions:\n  linter: Biome\n  type_checker: TSC\n",
		);

		const config = await readStackConfig(yamlPath);
		expect(config.linter).toBe("biome");
		expect(config.typeChecker).toBe("tsc");
	});
});
