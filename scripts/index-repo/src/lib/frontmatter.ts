import { type SpecFrontmatter, SpecFrontmatterSchema } from "./types";

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;
const INLINE_ARRAY_REGEX = /^\[(.+)\]$/;

export type FrontmatterProbe =
	| { kind: "ok"; data: SpecFrontmatter }
	| { kind: "missing" }
	| { kind: "invalid"; error: string };

/**
 * Probe frontmatter presence AND validity.
 * - missing: no leading `---...---` block
 * - invalid: block exists but schema validation failed (wrong enum value, missing required field, etc.)
 * - ok: block exists and passes schema
 */
export function probeFrontmatter(content: string): FrontmatterProbe {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match?.[1]) return { kind: "missing" };

	const raw: Record<string, unknown> = {};

	for (const line of match[1].split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;

		const key = trimmed.slice(0, colonIdx).trim();
		const value = trimmed.slice(colonIdx + 1).trim();

		if (!key) continue;

		const arrayMatch = value.match(INLINE_ARRAY_REGEX);
		if (arrayMatch) {
			raw[key] = arrayMatch[1]
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""));
		} else {
			raw[key] = value;
		}
	}

	const result = SpecFrontmatterSchema.safeParse(raw);
	if (result.success) return { kind: "ok", data: result.data };

	const error = result.error.issues
		.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
		.join("; ");
	return { kind: "invalid", error };
}

/**
 * Parse YAML-like frontmatter from markdown content.
 * Returns null for missing OR invalid frontmatter (backward-compatible).
 * Use probeFrontmatter() when the caller needs to distinguish the two cases.
 */
export function parseFrontmatter(content: string): SpecFrontmatter | null {
	const probe = probeFrontmatter(content);
	return probe.kind === "ok" ? probe.data : null;
}

/**
 * Extract the first markdown heading from content.
 * Used as fallback scope when no frontmatter scope is defined.
 */
export function extractFirstHeading(content: string): string | null {
	// Skip frontmatter block if present
	let text = content;
	if (text.startsWith("---")) {
		const endIdx = text.indexOf("---", 3);
		if (endIdx !== -1) {
			text = text.slice(endIdx + 3);
		}
	}

	const match = text.match(/^#{1,3}\s+(.+)$/m);
	return match?.[1]?.trim() ?? null;
}
