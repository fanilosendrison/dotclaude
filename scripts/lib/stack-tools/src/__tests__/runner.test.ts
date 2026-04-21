import { describe, expect, it } from "bun:test";
import { isInstalled, runLintPipeline } from "../runner.ts";
import type { StackConfig } from "../stack-config.ts";

describe("isInstalled", () => {
	it("returns true for a universally available binary (sh)", async () => {
		expect(await isInstalled("sh")).toBe(true);
	});

	it("returns false for an obviously missing binary", async () => {
		expect(await isInstalled("nonexistent-binary-xyz-abc-123")).toBe(false);
	});
});

describe("runLintPipeline", () => {
	it("returns empty results when linter and typeChecker are null", async () => {
		const config: StackConfig = { linter: null, typeChecker: null };
		const result = await runLintPipeline(config, "/tmp/test.ts");

		expect(result.results).toEqual([]);
		expect(result.hasErrors).toBe(false);
	});

	it("skips tsc typecheck (cannot check single file)", async () => {
		const config: StackConfig = { linter: null, typeChecker: "tsc" };
		const result = await runLintPipeline(config, "/tmp/test.ts");

		expect(result.results).toEqual([]);
		expect(result.hasErrors).toBe(false);
	});

	it("skips pyright for non-Python files", async () => {
		const config: StackConfig = { linter: null, typeChecker: "pyright" };
		const result = await runLintPipeline(config, "/tmp/test.ts");

		expect(result.results).toEqual([]);
		expect(result.hasErrors).toBe(false);
	});

	it("unknown linter produces no lint results", async () => {
		const config: StackConfig = {
			linter: "nonexistent-linter-xyz",
			typeChecker: null,
		};
		const result = await runLintPipeline(config, "/tmp/test.ts");

		expect(result.results).toEqual([]);
		expect(result.hasErrors).toBe(false);
	});
});
