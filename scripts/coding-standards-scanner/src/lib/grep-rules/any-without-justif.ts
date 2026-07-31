import { extname } from "node:path";
import type { RawLinterFinding } from "../linter-parsers/types.ts";
import type { GrepRule } from "./types.ts";

const RULE_ID = "grep/any-without-justif";
const SUPPORTED_EXTS = new Set([".ts", ".tsx"]);

// `any` used as a TYPE annotation. We want to skip:
//   - property names like `any:` inside objects
//   - string content (hard to detect robustly without a parser, so we
//     accept the occasional FP — the biome/eslint rule is the real gate)
//
// Heuristic: `any` appearing after a `:` / `<` / `as ` / `|` / `&` /
// `return type arrow)`. That's a reasonable superset — any TS type use.
const TYPE_USE = /(:|<|\bas\s|\||&|=>)\s*any\b/;

export const anyWithoutJustifRule: GrepRule = {
	ruleId: RULE_ID,
	applies(file: string): boolean {
		return SUPPORTED_EXTS.has(extname(file).toLowerCase());
	},
	scan(file: string, text: string): RawLinterFinding[] {
		const out: RawLinterFinding[] = [];
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i] ?? "";
			if (!TYPE_USE.test(line)) continue;
			// Skip if line already has an inline comment signaling a
			// justification on the same line.
			if (/\/\/.*\bjustification\b/i.test(line)) continue;
			// Skip if the previous line is a comment block that mentions a
			// justification (the preceding line is a strong-enough heuristic).
			const prev = lines[i - 1] ?? "";
			if (/^\s*\/\/.*\bjustification\b/i.test(prev)) continue;
			if (/^\s*\/\*.*\bjustification\b/i.test(prev)) continue;
			// Tool suppression directives are a narrow, machine-readable justification.
			if (/biome-ignore\b/i.test(prev) || /biome-ignore\b/i.test(line))
				continue;
			// eslint-disable comments ditto.
			if (/eslint-disable(-next-line)?\b/i.test(prev)) continue;
			if (/eslint-disable(-next-line)?\b/i.test(line)) continue;

			out.push({
				ruleId: RULE_ID,
				file,
				line_start: i + 1,
				line_end: i + 1,
				message: `Weak type 'any' used without justification comment on line '${line.trim()}'.`,
			});
		}
		return out;
	},
};
