import { describe, expect, it } from "bun:test";
import { parseRuffJson } from "../../lib/linter-parsers/ruff.ts";

// Golden fixture from `ruff check --output-format json`.
const GOLDEN = JSON.stringify([
	{
		code: "E722",
		filename: "/repo/src/foo.py",
		message: "Do not use bare `except`",
		location: { row: 14, column: 5 },
		end_location: { row: 14, column: 12 },
		fix: null,
	},
	{
		code: "D103",
		filename: "/repo/src/foo.py",
		message: "Missing docstring in public function",
		location: { row: 3, column: 1 },
		end_location: { row: 3, column: 10 },
	},
]);

describe("parseRuffJson", () => {
	it("parses the golden fixture", () => {
		const findings = parseRuffJson(GOLDEN);
		expect(findings).toHaveLength(2);
		expect(findings[0]?.ruleId).toBe("E722");
		expect(findings[0]?.file).toBe("/repo/src/foo.py");
		expect(findings[0]?.line_start).toBe(14);
		expect(findings[1]?.ruleId).toBe("D103");
		expect(findings[1]?.line_start).toBe(3);
	});

	it("returns [] on empty output", () => {
		expect(parseRuffJson("")).toEqual([]);
		expect(parseRuffJson("[]")).toEqual([]);
	});

	it("returns [] on malformed JSON", () => {
		expect(parseRuffJson("not json")).toEqual([]);
	});
});
