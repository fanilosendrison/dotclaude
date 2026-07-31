import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { computeFindingId } from "../id-hash.ts";

describe("computeFindingId", () => {
	it("produces a 16-character lowercase hex string", () => {
		const id = computeFindingId(
			"coding-standards",
			"src/foo.ts",
			42,
			"typing",
			"weak type any used in bar return",
		);
		expect(id).toMatch(/^[0-9a-f]{16}$/);
	});

	it("is stable: same inputs produce the same output", () => {
		const args: [string, string, number | null, string, string] = [
			"coding-standards",
			"src/foo.ts",
			42,
			"typing",
			"weak type any used in bar return",
		];
		const a = computeFindingId(...args);
		const b = computeFindingId(...args);
		expect(a).toBe(b);
	});

	it("matches the canonical formula exactly (regression guard)", () => {
		// Re-derive the expected hash from the documented formula to ensure
		// computeFindingId never drifts from the spec. If this fails, the
		// function has changed — coordinate with SKILL.md, the agent prompt,
		// and loop-clean.sh before landing.
		const key = [
			"coding-standards",
			"src/foo.ts",
			"42",
			"typing",
			"weak type any used in bar return",
		].join("|");
		const id = computeFindingId(
			"coding-standards",
			"src/foo.ts",
			42,
			"typing",
			"weak type any used in bar return",
		);
		const expected = createHash("sha256")
			.update(key)
			.digest("hex")
			.slice(0, 16);
		expect(id).toBe(expected);
	});

	it("changes when source changes", () => {
		const a = computeFindingId("coding-standards", "f.ts", 1, "typing", "p");
		const b = computeFindingId("coding-standardsX", "f.ts", 1, "typing", "p");
		expect(a).not.toBe(b);
	});

	it("changes when file changes", () => {
		const a = computeFindingId("coding-standards", "f.ts", 1, "typing", "p");
		const b = computeFindingId("coding-standards", "g.ts", 1, "typing", "p");
		expect(a).not.toBe(b);
	});

	it("changes when line_start changes", () => {
		const a = computeFindingId("coding-standards", "f.ts", 1, "typing", "p");
		const b = computeFindingId("coding-standards", "f.ts", 2, "typing", "p");
		expect(a).not.toBe(b);
	});

	it("changes when axis changes", () => {
		const a = computeFindingId("coding-standards", "f.ts", 1, "typing", "p");
		const b = computeFindingId("coding-standards", "f.ts", 1, "naming", "p");
		expect(a).not.toBe(b);
	});

	it("changes when problem changes (within first 80 chars)", () => {
		const a = computeFindingId(
			"coding-standards",
			"f.ts",
			1,
			"typing",
			"alpha",
		);
		const b = computeFindingId("coding-standards", "f.ts", 1, "typing", "beta");
		expect(a).not.toBe(b);
	});

	it("does NOT change when problem differs only after the first 80 chars", () => {
		// Deliberate property of the formula: only the prefix is hashed, so
		// trailing reformulations don't invalidate the id.
		const prefix = "a".repeat(80);
		const a = computeFindingId(
			"coding-standards",
			"f.ts",
			1,
			"typing",
			`${prefix}X`,
		);
		const b = computeFindingId(
			"coding-standards",
			"f.ts",
			1,
			"typing",
			`${prefix}Y`,
		);
		expect(a).toBe(b);
	});

	it("distinguishes null line_start from 0 line_start", () => {
		// null → "", 0 → "0" — these are DIFFERENT inputs to the hash.
		const a = computeFindingId("coding-standards", "f.ts", null, "typing", "p");
		const b = computeFindingId("coding-standards", "f.ts", 0, "typing", "p");
		expect(a).not.toBe(b);
	});

	it("null line_start serialises as '' in the hash key", () => {
		// Regression guard on the String(lineStart ?? "") idiom.
		const nullCase = computeFindingId("s", "f", null, "a", "p");
		const expected = createHash("sha256")
			.update(["s", "f", "", "a", "p"].join("|"))
			.digest("hex")
			.slice(0, 16);
		expect(nullCase).toBe(expected);
	});
});
