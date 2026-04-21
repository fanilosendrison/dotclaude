import type { RawLinterFinding } from "./types.ts";

/**
 * Parse `ruff check --output-format json` output.
 *
 * Shape: top-level array of { code, filename, location: { row }, end_location: { row }, message }.
 */
export function parseRuffJson(jsonText: string): RawLinterFinding[] {
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
		if (typeof code !== "string" || !code) continue;
		const filename = (d as { filename?: unknown }).filename;
		const location = (d as { location?: unknown }).location;
		const endLoc = (d as { end_location?: unknown }).end_location;
		const message = (d as { message?: unknown }).message;

		out.push({
			ruleId: code,
			file: typeof filename === "string" ? filename : "",
			line_start: extractRow(location),
			line_end: extractRow(endLoc) ?? extractRow(location),
			message: typeof message === "string" ? message : "",
		});
	}
	return out;
}

function extractRow(location: unknown): number | null {
	if (!location || typeof location !== "object") return null;
	const row = (location as { row?: unknown }).row;
	return typeof row === "number" ? row : null;
}
