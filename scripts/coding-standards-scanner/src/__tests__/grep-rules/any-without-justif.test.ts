import { describe, expect, it } from "bun:test";
import { anyWithoutJustifRule } from "../../lib/grep-rules/any-without-justif.ts";

describe("anyWithoutJustifRule", () => {
	it("flags `any` used as a type", () => {
		const text = `function foo(x: any): void {}\n`;
		const findings = anyWithoutJustifRule.scan("x.ts", text);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.line_start).toBe(1);
	});

	it("skips when the preceding line has a justification comment", () => {
		const text = `// justification: third-party untyped lib\nfunction foo(x: any): void {}\n`;
		expect(anyWithoutJustifRule.scan("x.ts", text)).toEqual([]);
	});

	it("skips when the line has a biome-ignore comment", () => {
		const text = `// biome-ignore lint/suspicious/noExplicitAny: untyped\nfunction foo(x: any): void {}\n`;
		expect(anyWithoutJustifRule.scan("x.ts", text)).toEqual([]);
	});

	it("skips when the line has an eslint-disable-next-line", () => {
		const text = `// eslint-disable-next-line @typescript-eslint/no-explicit-any\nfunction foo(x: any): void {}\n`;
		expect(anyWithoutJustifRule.scan("x.ts", text)).toEqual([]);
	});

	it("applies only to .ts/.tsx", () => {
		expect(anyWithoutJustifRule.applies("x.ts")).toBe(true);
		expect(anyWithoutJustifRule.applies("x.tsx")).toBe(true);
		expect(anyWithoutJustifRule.applies("x.js")).toBe(false);
		expect(anyWithoutJustifRule.applies("x.py")).toBe(false);
	});

	it("flags `as any` casts", () => {
		const text = `const x = payload as any;\n`;
		const findings = anyWithoutJustifRule.scan("x.ts", text);
		expect(findings).toHaveLength(1);
	});
});
