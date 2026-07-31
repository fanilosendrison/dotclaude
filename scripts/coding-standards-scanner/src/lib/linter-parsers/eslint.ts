import type { RawLinterFinding } from "./types.ts";

/**
 * Parse `eslint --format json` output.
 *
 * Shape: top-level array of { filePath, messages: [{ ruleId, line, endLine, message, severity }] }.
 * `ruleId` can be null for parser errors — we drop those.
 */
export function parseEslintJson(jsonText: string): RawLinterFinding[] {
	if (!jsonText.trim()) return [];
	let data: unknown;
	try {
		data = JSON.parse(jsonText);
	} catch {
		return [];
	}
	if (!Array.isArray(data)) return [];

	const out: RawLinterFinding[] = [];
	for (const fileEntry of data) {
		if (!fileEntry || typeof fileEntry !== "object") continue;
		const filePath = (fileEntry as { filePath?: unknown }).filePath ?? "";
		if (typeof filePath !== "string") continue;
		const messages = (fileEntry as { messages?: unknown }).messages;
		if (!Array.isArray(messages)) continue;

		for (const m of messages) {
			if (!m || typeof m !== "object") continue;
			const ruleId = (m as { ruleId?: unknown }).ruleId;
			if (typeof ruleId !== "string" || !ruleId) continue;
			const line = (m as { line?: unknown }).line;
			const endLine = (m as { endLine?: unknown }).endLine;
			const message = (m as { message?: unknown }).message;

			out.push({
				ruleId,
				file: filePath,
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
	}
	return out;
}
