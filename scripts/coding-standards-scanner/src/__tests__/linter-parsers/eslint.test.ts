import { describe, expect, it } from "bun:test";
import { parseEslintJson } from "../../lib/linter-parsers/eslint.ts";

// Golden fixture: shape of `eslint --format json` output (trimmed).
const GOLDEN = JSON.stringify([
	{
		filePath: "/repo/src/foo.ts",
		messages: [
			{
				ruleId: "@typescript-eslint/no-explicit-any",
				severity: 1,
				message: "Unexpected any. Specify a different type.",
				line: 12,
				endLine: 12,
				column: 18,
				endColumn: 21,
			},
			{
				ruleId: "no-empty",
				severity: 2,
				message: "Empty block statement.",
				line: 30,
				endLine: 32,
			},
			{
				// parser error — ruleId null, must be dropped
				ruleId: null,
				severity: 2,
				message: "Parsing error",
				line: 1,
			},
		],
	},
	{
		filePath: "/repo/src/bar.ts",
		messages: [],
	},
]);

describe("parseEslintJson", () => {
	it("parses the golden fixture", () => {
		const findings = parseEslintJson(GOLDEN);
		expect(findings).toHaveLength(2);

		const any = findings.find(
			(f) => f.ruleId === "@typescript-eslint/no-explicit-any",
		);
		expect(any).toBeDefined();
		expect(any?.file).toBe("/repo/src/foo.ts");
		expect(any?.line_start).toBe(12);
		expect(any?.line_end).toBe(12);

		const empty = findings.find((f) => f.ruleId === "no-empty");
		expect(empty).toBeDefined();
		expect(empty?.line_start).toBe(30);
		expect(empty?.line_end).toBe(32);
	});

	it("returns [] on empty input", () => {
		expect(parseEslintJson("")).toEqual([]);
	});

	it("returns [] on invalid JSON", () => {
		expect(parseEslintJson("not json")).toEqual([]);
	});

	it("returns [] on non-array JSON", () => {
		expect(parseEslintJson('{"foo":"bar"}')).toEqual([]);
	});

	it("drops messages with null ruleId (parser errors)", () => {
		const findings = parseEslintJson(GOLDEN);
		expect(findings.every((f) => f.ruleId !== null)).toBe(true);
	});
});
