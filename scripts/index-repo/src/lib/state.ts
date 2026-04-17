import { join } from "node:path";
import { INDEX_STATE_FILE } from "./constants";
import { type IndexState, IndexStateSchema } from "./types";

/**
 * Ensure .index-state.json is listed in .gitignore (if .gitignore exists).
 */
async function ensureGitignored(projectRoot: string): Promise<void> {
	const gitignorePath = join(projectRoot, ".gitignore");
	const file = Bun.file(gitignorePath);

	if (!(await file.exists())) return;

	const content = await file.text();
	const lines = content.split("\n").map((l) => l.trim());

	if (lines.includes(INDEX_STATE_FILE)) return;

	const suffix = content.endsWith("\n") ? "" : "\n";
	await Bun.write(gitignorePath, `${content}${suffix}${INDEX_STATE_FILE}\n`);
}

/**
 * Read .index-state.json from project root. Returns null if missing or invalid.
 */
export async function readState(
	projectRoot: string,
): Promise<IndexState | null> {
	const path = join(projectRoot, INDEX_STATE_FILE);
	const file = Bun.file(path);

	if (!(await file.exists())) return null;

	try {
		const raw = await file.json();
		const result = IndexStateSchema.safeParse(raw);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

/**
 * Write .index-state.json to project root.
 */
export async function writeState(
	projectRoot: string,
	state: IndexState,
): Promise<void> {
	const path = join(projectRoot, INDEX_STATE_FILE);
	await Bun.write(path, JSON.stringify(state, null, "\t"));
	await ensureGitignored(projectRoot);
}
