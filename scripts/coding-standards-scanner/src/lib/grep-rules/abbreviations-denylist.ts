import { extname } from "node:path";
import type { RawLinterFinding } from "../linter-parsers/types.ts";
import type { GrepRule } from "./types.ts";

const RULE_ID = "grep/abbreviations-denylist";

const SUPPORTED_EXTS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".py",
	".sh",
	".bash",
]);

/**
 * Hand-picked list of cryptic abbreviations that repeatedly show up in
 * throwaway code. Kept intentionally small — anything longer would catch
 * legitimate domain words (e.g. `data` is fine, `dat` in an accounting
 * context would not be).
 *
 * The canonical list comes from the coding-standards doctrine section
 * "Nommage — INTERDIT partout".
 */
const DENYLIST = [
	"proc_dat",
	"mgr",
	"impl2",
	"tmp2",
	"foo",
	"bar",
	"xxx",
	"asdf",
	"data2",
];

// Word-boundary regex per entry (built once).
const PATTERNS = DENYLIST.map(
	(word) =>
		new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "g"),
);

export const abbreviationsDenylistRule: GrepRule = {
	ruleId: RULE_ID,
	applies(file: string): boolean {
		return SUPPORTED_EXTS.has(extname(file).toLowerCase());
	},
	scan(file: string, text: string): RawLinterFinding[] {
		const out: RawLinterFinding[] = [];
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i] ?? "";
			for (let j = 0; j < PATTERNS.length; j += 1) {
				const p = PATTERNS[j];
				if (!p) continue;
				p.lastIndex = 0;
				if (p.test(line)) {
					const word = DENYLIST[j] ?? "?";
					out.push({
						ruleId: RULE_ID,
						file,
						line_start: i + 1,
						line_end: i + 1,
						message: `Cryptic abbreviation '${word}' used.`,
					});
					break;
				}
			}
		}
		return out;
	},
};
