import { describe, expect, it } from "bun:test";
import {
	CODE_EXTENSIONS,
	isCodeFile,
	isLinterCompatible,
	LINTER_EXTENSIONS,
} from "../extensions.ts";

describe("CODE_EXTENSIONS", () => {
	it("contains all expected extensions", () => {
		const expected = [".py", ".ts", ".tsx", ".js", ".jsx", ".sh", ".bash"];
		for (const ext of expected) {
			expect(CODE_EXTENSIONS.has(ext)).toBe(true);
		}
	});

	it("does not contain non-code extensions", () => {
		const notCode = [".md", ".json", ".yaml", ".html", ".css", ".txt"];
		for (const ext of notCode) {
			expect(CODE_EXTENSIONS.has(ext)).toBe(false);
		}
	});
});

describe("LINTER_EXTENSIONS", () => {
	it("biome supports JS/TS extensions", () => {
		expect(LINTER_EXTENSIONS.biome.has(".ts")).toBe(true);
		expect(LINTER_EXTENSIONS.biome.has(".tsx")).toBe(true);
		expect(LINTER_EXTENSIONS.biome.has(".js")).toBe(true);
		expect(LINTER_EXTENSIONS.biome.has(".jsx")).toBe(true);
		expect(LINTER_EXTENSIONS.biome.has(".py")).toBe(false);
	});

	it("ruff supports .py only", () => {
		expect(LINTER_EXTENSIONS.ruff.has(".py")).toBe(true);
		expect(LINTER_EXTENSIONS.ruff.has(".ts")).toBe(false);
	});

	it("shellcheck supports .sh and .bash", () => {
		expect(LINTER_EXTENSIONS.shellcheck.has(".sh")).toBe(true);
		expect(LINTER_EXTENSIONS.shellcheck.has(".bash")).toBe(true);
		expect(LINTER_EXTENSIONS.shellcheck.has(".ts")).toBe(false);
	});
});

describe("isCodeFile", () => {
	it("returns true for code files", () => {
		expect(isCodeFile("/project/src/main.ts")).toBe(true);
		expect(isCodeFile("/project/app.py")).toBe(true);
		expect(isCodeFile("/project/script.sh")).toBe(true);
		expect(isCodeFile("/project/Component.tsx")).toBe(true);
		expect(isCodeFile("/project/index.js")).toBe(true);
		expect(isCodeFile("/project/build.bash")).toBe(true);
	});

	it("returns false for non-code files", () => {
		expect(isCodeFile("/project/README.md")).toBe(false);
		expect(isCodeFile("/project/config.json")).toBe(false);
		expect(isCodeFile("/project/style.css")).toBe(false);
		expect(isCodeFile("/project/index.html")).toBe(false);
		expect(isCodeFile("/project/data.yaml")).toBe(false);
	});

	it("handles case insensitivity", () => {
		expect(isCodeFile("/project/main.TS")).toBe(true);
		expect(isCodeFile("/project/app.PY")).toBe(true);
	});
});

describe("isLinterCompatible", () => {
	it("biome is compatible with TS/JS files", () => {
		expect(isLinterCompatible("biome", "file.ts")).toBe(true);
		expect(isLinterCompatible("biome", "file.jsx")).toBe(true);
	});

	it("biome is not compatible with Python files", () => {
		expect(isLinterCompatible("biome", "file.py")).toBe(false);
	});

	it("ruff is compatible with Python files", () => {
		expect(isLinterCompatible("ruff", "file.py")).toBe(true);
	});

	it("ruff is not compatible with TS files", () => {
		expect(isLinterCompatible("ruff", "file.ts")).toBe(false);
	});

	it("unknown linter returns true (try anyway)", () => {
		expect(isLinterCompatible("unknown-linter", "file.ts")).toBe(true);
		expect(isLinterCompatible("unknown-linter", "file.py")).toBe(true);
	});
});
