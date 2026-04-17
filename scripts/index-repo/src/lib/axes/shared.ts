import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { EXCLUDED_DIRS } from "../constants";

/**
 * Glob files matching patterns, excluding standard dirs.
 * Returns relative paths sorted alphabetically.
 */
export async function globFiles(
	cwd: string,
	patterns: readonly string[],
): Promise<string[]> {
	const seen = new Set<string>();

	for (const pattern of patterns) {
		const glob = new Glob(pattern);
		for await (const entry of glob.scan({
			cwd,
			absolute: false,
			onlyFiles: true,
		})) {
			// Skip excluded directories
			if (
				EXCLUDED_DIRS.some(
					(d) => entry.startsWith(`${d}/`) || entry.includes(`/${d}/`),
				)
			) {
				continue;
			}
			seen.add(entry);
		}
	}

	return [...seen].sort();
}

/**
 * Compute SHA-256 hash of sorted "path:size" entries.
 * Deterministic: same files in same state → same hash.
 */
export async function computeAxisHash(
	cwd: string,
	files: string[],
): Promise<string> {
	const entries: string[] = [];

	for (const file of files) {
		try {
			const s = await stat(join(cwd, file));
			entries.push(`${file}:${s.size}`);
		} catch {
			entries.push(`${file}:0`);
		}
	}

	entries.sort();
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(entries.join("\n"));
	return hasher.digest("hex");
}
