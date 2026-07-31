import { describe, expect, it } from "bun:test";
import { parseShellcheckJson } from "../../lib/linter-parsers/shellcheck.ts";

const GOLDEN = JSON.stringify([
	{
		file: "/repo/bin/deploy.sh",
		line: 23,
		endLine: 23,
		column: 1,
		endColumn: 4,
		level: "warning",
		code: 2164,
		message: "Use 'cd ... || exit' or 'cd ... || return' in case cd fails.",
	},
	{
		file: "/repo/bin/deploy.sh",
		line: 8,
		endLine: 8,
		column: 1,
		endColumn: 7,
		level: "info",
		code: 2034,
		message: "variable appears unused",
	},
]);

describe("parseShellcheckJson", () => {
	it("parses the golden fixture", () => {
		const findings = parseShellcheckJson(GOLDEN);
		expect(findings).toHaveLength(2);
		expect(findings[0]?.ruleId).toBe("SC2164");
		expect(findings[0]?.line_start).toBe(23);
		expect(findings[1]?.ruleId).toBe("SC2034");
	});

	it("prefixes numeric codes with SC", () => {
		const findings = parseShellcheckJson(GOLDEN);
		expect(findings.every((f) => f.ruleId.startsWith("SC"))).toBe(true);
	});

	it("returns [] on empty output", () => {
		expect(parseShellcheckJson("")).toEqual([]);
		expect(parseShellcheckJson("[]")).toEqual([]);
	});
});
