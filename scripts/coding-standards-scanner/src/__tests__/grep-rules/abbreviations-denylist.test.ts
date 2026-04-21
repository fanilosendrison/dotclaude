import { describe, expect, it } from "bun:test";
import { abbreviationsDenylistRule } from "../../lib/grep-rules/abbreviations-denylist.ts";

describe("abbreviationsDenylistRule", () => {
	it("catches denied abbreviations", () => {
		const text = `const mgr = new Manager();\nconst foo = 1;\n`;
		const findings = abbreviationsDenylistRule.scan("x.ts", text);
		expect(findings.length).toBe(2);
	});

	it("does not flag Manager (substring of mgr in word boundary terms)", () => {
		const text = `const manager = new Manager();\n`;
		expect(abbreviationsDenylistRule.scan("x.ts", text)).toEqual([]);
	});

	it("flags xxx in Python", () => {
		const text = `def xxx():\n    pass\n`;
		const findings = abbreviationsDenylistRule.scan("x.py", text);
		expect(findings.length).toBe(1);
	});

	it("flags the canonical proc_dat example", () => {
		const text = `let proc_dat = 42;\n`;
		const findings = abbreviationsDenylistRule.scan("x.ts", text);
		expect(findings.length).toBe(1);
	});
});
