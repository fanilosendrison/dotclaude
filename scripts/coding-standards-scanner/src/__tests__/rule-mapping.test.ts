import { describe, expect, it } from "bun:test";
import { axisForRule, RULE_TO_AXIS } from "../lib/rule-mapping.ts";

describe("axisForRule", () => {
	it("returns the declared axis for known rules", () => {
		expect(axisForRule("no-empty")).toBe("error-handling");
		expect(axisForRule("@typescript-eslint/no-explicit-any")).toBe("typing");
		expect(axisForRule("complexity")).toBe("maintainability");
		expect(axisForRule("prefer-const")).toBe("immutability");
	});

	it("returns null for out-of-scope rules (dedup-codebase territory)", () => {
		expect(axisForRule("no-unused-vars")).toBeNull();
		expect(axisForRule("@typescript-eslint/no-unused-vars")).toBeNull();
		expect(axisForRule("SC2034")).toBeNull();
	});

	it("returns null for unknown rules", () => {
		expect(axisForRule("never-heard-of-it")).toBeNull();
	});

	it("handles shellcheck SC codes", () => {
		expect(axisForRule("SC2164")).toBe("error-handling");
		expect(axisForRule("SC2086")).toBeNull();
	});

	it("maps grep rule ids to their axes", () => {
		expect(axisForRule("grep/debug-statements")).toBe("maintainability");
		expect(axisForRule("grep/abbreviations-denylist")).toBe("naming");
		expect(axisForRule("grep/any-without-justif")).toBe("typing");
	});

	it("mapping table is non-empty", () => {
		expect(Object.keys(RULE_TO_AXIS).length).toBeGreaterThan(10);
	});
});
