import type { RawLinterFinding } from "./types.ts";

/**
 * Parse `shellcheck -f json` output.
 *
 * Shape: top-level array of { file, line, endLine, code, message, level }.
 * Shellcheck codes are numbers (e.g. 2164); we prefix with "SC" to match
 * how people reference them (`SC2164`).
 */
export function parseShellcheckJson(jsonText: string): RawLinterFinding[] {
	if (!jsonText.trim()) return [];
	let data: unknown;
	try {
		data = JSON.parse(jsonText);
	} catch {
		return [];
	}
	if (!Array.isArray(data)) return [];

	const out: RawLinterFinding[] = [];
	for (const d of data) {
		if (!d || typeof d !== "object") continue;
		const code = (d as { code?: unknown }).code;
		if (typeof code !== "number") continue;
		const file = (d as { file?: unknown }).file;
		const line = (d as { line?: unknown }).line;
		const endLine = (d as { endLine?: unknown }).endLine;
		const message = (d as { message?: unknown }).message;

		out.push({
			ruleId: `SC${code}`,
			file: typeof file === "string" ? file : "",
			line_start: typeof line === "number" ? line : null,
			line_end:
				typeof endLine === "number"
					? endLine
					: typeof line === "number"
						? line
						: null,
			message: typeof message === "string" ? message : "",
		});
	}
	return out;
}
