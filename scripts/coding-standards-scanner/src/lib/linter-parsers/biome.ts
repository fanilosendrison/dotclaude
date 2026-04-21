import type { RawLinterFinding } from "./types.ts";

/**
 * Parse biome JSON output (from `biome check --reporter json` or the
 * older `--json` flag). Biome's diagnostic envelope is:
 *
 * { diagnostics: [{ category, location: { path: { file }, span?: { start: { line } } },
 *                   description } ], ... }
 *
 * Version skew is real — we stay lenient: any missing field drops the
 * finding rather than crashing.
 */
export function parseBiomeJson(jsonText: string): RawLinterFinding[] {
	if (!jsonText.trim()) return [];
	let data: unknown;
	try {
		data = JSON.parse(jsonText);
	} catch {
		return [];
	}
	if (!data || typeof data !== "object") return [];

	const diagnostics = (data as { diagnostics?: unknown }).diagnostics;
	if (!Array.isArray(diagnostics)) return [];

	const out: RawLinterFinding[] = [];
	for (const d of diagnostics) {
		if (!d || typeof d !== "object") continue;
		const category = (d as { category?: unknown }).category;
		if (typeof category !== "string" || !category) continue;
		const location = (d as { location?: unknown }).location;
		const path = extractPath(location);
		const line = extractLine(location);
		const description = (d as { description?: unknown }).description;
		out.push({
			ruleId: category,
			file: path ?? "",
			line_start: line,
			line_end: line,
			message: typeof description === "string" ? description : "",
		});
	}
	return out;
}

function extractPath(location: unknown): string | null {
	if (!location || typeof location !== "object") return null;
	const path = (location as { path?: unknown }).path;
	if (typeof path === "string") return path;
	if (path && typeof path === "object") {
		const file = (path as { file?: unknown }).file;
		if (typeof file === "string") return file;
	}
	return null;
}

function extractLine(location: unknown): number | null {
	if (!location || typeof location !== "object") return null;
	const span = (location as { span?: unknown }).span;
	if (span && typeof span === "object") {
		const start = (span as { start?: unknown }).start;
		if (start && typeof start === "object") {
			const line = (start as { line?: unknown }).line;
			if (typeof line === "number") return line;
		}
	}
	// Older biome versions: { start: { line } } at top level
	const start = (location as { start?: unknown }).start;
	if (start && typeof start === "object") {
		const line = (start as { line?: unknown }).line;
		if (typeof line === "number") return line;
	}
	return null;
}
