import { describe, expect, it } from "bun:test";
import { debugStatementsRule } from "../../lib/grep-rules/debug-statements.ts";

describe("debugStatementsRule", () => {
	it("detects console.log in TypeScript", () => {
		const text = `function foo() {\n  console.log("hello");\n  return 1;\n}\n`;
		const findings = debugStatementsRule.scan("x.ts", text);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.line_start).toBe(2);
		expect(findings[0]?.ruleId).toBe("grep/debug-statements");
	});

	it("detects debugger statement", () => {
		const text = `function foo() {\n  debugger;\n}\n`;
		const findings = debugStatementsRule.scan("x.ts", text);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.line_start).toBe(2);
	});

	it("detects print() in Python", () => {
		const text = `def foo():\n    print("hi")\n    return 1\n`;
		const findings = debugStatementsRule.scan("x.py", text);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.line_start).toBe(2);
	});

	it("applies to supported extensions only", () => {
		expect(debugStatementsRule.applies("x.ts")).toBe(true);
		expect(debugStatementsRule.applies("x.py")).toBe(true);
		expect(debugStatementsRule.applies("x.sh")).toBe(false);
		expect(debugStatementsRule.applies("x.md")).toBe(false);
	});

	it("returns empty when no debug statement present", () => {
		const text = `function foo() {\n  return 1;\n}\n`;
		expect(debugStatementsRule.scan("x.ts", text)).toEqual([]);
	});
});
