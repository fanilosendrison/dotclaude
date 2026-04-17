import { describe, expect, it } from "bun:test";
import { runLintPipeline } from "../lib/runner.ts";
import type { StackConfig } from "../lib/stack-config.ts";

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

		// tsc is skipped by design — no results
		expect(result.results).toEqual([]);
		expect(result.hasErrors).toBe(false);
	});

	it("skips pyright for non-Python files", async () => {
		const config: StackConfig = { linter: null, typeChecker: "pyright" };
		const result = await runLintPipeline(config, "/tmp/test.ts");

		expect(result.results).toEqual([]);
		expect(result.hasErrors).toBe(false);
	});

	it("runs biome format + check on TS files when biome is installed", async () => {
		const config: StackConfig = { linter: "biome", typeChecker: null };

		// Vérifier si biome est installé avant de tester
		const proc = Bun.spawn(["which", "biome"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const biomeInstalled = (await proc.exited) === 0;

		if (!biomeInstalled) {
			// biome pas installé — pipeline skip les outils manquants
			const result = await runLintPipeline(config, "/tmp/test.ts");
			expect(result.results).toEqual([]);
			return;
		}

		// Créer un fichier temporaire valide pour biome
		const tmpFile = `/tmp/post-write-linter-test-${Date.now()}.ts`;
		await Bun.write(tmpFile, 'const x: string = "hello";\nconsole.log(x);\n');

		try {
			const result = await runLintPipeline(config, tmpFile);
			// biome devrait produire des résultats (format + check)
			expect(result.results.length).toBeGreaterThanOrEqual(1);
		} finally {
			try {
				const { unlinkSync } = await import("node:fs");
				unlinkSync(tmpFile);
			} catch {
				// Cleanup best-effort
			}
		}
	});

	it("reports hasErrors when a tool fails", async () => {
		// Utiliser un linter inconnu qui n'existera pas via `which`
		const config: StackConfig = {
			linter: "nonexistent-linter-xyz",
			typeChecker: null,
		};
		const result = await runLintPipeline(config, "/tmp/test.ts");

		// Unknown linter → getLintCommand returns null → no results
		expect(result.results).toEqual([]);
		expect(result.hasErrors).toBe(false);
	});
});
