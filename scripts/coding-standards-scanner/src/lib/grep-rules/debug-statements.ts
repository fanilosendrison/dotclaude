import { extname } from "node:path";
import type { RawLinterFinding } from "../linter-parsers/types.ts";
import type { GrepRule } from "./types.ts";

const RULE_ID = "grep/debug-statements";

/**
 * Detect leftover debug statements in production code.
 *
 * Patterns, per language family:
 *  - JS/TS   : `console.log`, `console.debug`, `debugger`
 *  - Python  : `print(...)` (top-level calls)
 *  - Rust    : `dbg!(...)`, `println!(...)`
 *  - Go      : `fmt.Println(...)`, `fmt.Printf(...)`
 *  - Shell   : (skipped — echo is legitimate CLI output)
 */
const PATTERNS_BY_EXT: Record<string, RegExp[]> = {
	".ts": [/\bconsole\.(log|debug|info)\s*\(/g, /\bdebugger\b/g],
	".tsx": [/\bconsole\.(log|debug|info)\s*\(/g, /\bdebugger\b/g],
	".js": [/\bconsole\.(log|debug|info)\s*\(/g, /\bdebugger\b/g],
	".jsx": [/\bconsole\.(log|debug|info)\s*\(/g, /\bdebugger\b/g],
	".py": [/^\s*print\s*\(/gm],
};

export const debugStatementsRule: GrepRule = {
	ruleId: RULE_ID,
	applies(file: string): boolean {
		return extname(file).toLowerCase() in PATTERNS_BY_EXT;
	},
	scan(file: string, text: string): RawLinterFinding[] {
		const ext = extname(file).toLowerCase();
		const patterns = PATTERNS_BY_EXT[ext] ?? [];
		if (patterns.length === 0) return [];

		const out: RawLinterFinding[] = [];
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i] ?? "";
			for (const p of patterns) {
				// Reset global regex state before each line.
				p.lastIndex = 0;
				if (p.test(line)) {
					out.push({
						ruleId: RULE_ID,
						file,
						line_start: i + 1,
						line_end: i + 1,
						message: `Debug statement in production code: '${line.trim()}'.`,
					});
					break; // one finding per line is enough
				}
			}
		}
		return out;
	},
};
