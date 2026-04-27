import {
	INDEX_STATE_FILE,
	PROJECT_INDEX_FILE,
	SPEC_MANIFEST_FILE,
} from "./constants";
import { readState } from "./state";

/** Files written by the indexer — excluded from staleness comparison */
const GENERATED_FILES = new Set([SPEC_MANIFEST_FILE, PROJECT_INDEX_FILE]);

export interface StalenessResult {
	status: "FRESH" | "STALE" | "NO_INDEX";
	currentHash: string;
	storedHash: string | null;
	timestamp: string | null;
}

/**
 * Check if the project index is stale by comparing git write-tree hash
 * with the stored hash in .index-state.json.
 *
 * git write-tree hashes the staging area — any file change in the worktree
 * that's been staged will produce a different hash. We also check for
 * unstaged changes via git diff --quiet.
 */
export async function checkStaleness(cwd: string): Promise<StalenessResult> {
	const currentHash = await getTreeHash(cwd);
	const state = await readState(cwd);

	if (!state) {
		return {
			status: "NO_INDEX",
			currentHash,
			storedHash: null,
			timestamp: null,
		};
	}

	// Working tree has unstaged changes → stale
	const isDirty = await isWorkingTreeDirty(cwd);
	if (isDirty) {
		return {
			status: "STALE",
			currentHash,
			storedHash: state.treeHash,
			timestamp: state.timestamp,
		};
	}

	// Hash matches → fresh
	if (currentHash === state.treeHash) {
		return {
			status: "FRESH",
			currentHash,
			storedHash: state.treeHash,
			timestamp: state.timestamp,
		};
	}

	// Tree hash differs but working tree is clean.
	// Check if only generated output files changed (post-commit cycle).
	if (await onlyGeneratedFilesChanged(cwd, state.treeHash, currentHash)) {
		return {
			status: "FRESH",
			currentHash,
			storedHash: state.treeHash,
			timestamp: state.timestamp,
		};
	}

	return {
		status: "STALE",
		currentHash,
		storedHash: state.treeHash,
		timestamp: state.timestamp,
	};
}

/**
 * Get tree hash via `git write-tree`. Falls back to `git rev-parse HEAD`
 * if write-tree fails (e.g. during merge conflict).
 */
async function getTreeHash(cwd: string): Promise<string> {
	try {
		const proc = Bun.spawn(["git", "write-tree"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		const code = await proc.exited;
		if (code === 0) return output.trim();
	} catch {
		/* fallback below */
	}

	// Fallback: HEAD commit hash
	const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(proc.stdout).text();
	return output.trim();
}

/**
 * Check if working tree has unstaged, staged-but-uncommitted, or untracked changes.
 * `git status --porcelain` lists all of those. We filter out our own state file,
 * which is intentionally untracked and not user content.
 */
async function isWorkingTreeDirty(cwd: string): Promise<boolean> {
	const proc = Bun.spawn(["git", "status", "--porcelain"], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(proc.stdout).text();
	const lines = output.split("\n").filter((l) => l.length > 0);
	return lines.some((line) => line.slice(3) !== INDEX_STATE_FILE);
}

/**
 * Check if only generated files differ between two tree objects.
 * Breaks the commit-cycle where committing SPEC_MANIFEST.md/PROJECT_INDEX.md
 * changes the tree hash, causing a false STALE on next session.
 */
async function onlyGeneratedFilesChanged(
	cwd: string,
	treeA: string,
	treeB: string,
): Promise<boolean> {
	try {
		const proc = Bun.spawn(
			["git", "diff-tree", "--no-commit-id", "--name-only", "-r", treeA, treeB],
			{ cwd, stdout: "pipe", stderr: "pipe" },
		);
		const output = await new Response(proc.stdout).text();
		const code = await proc.exited;
		if (code !== 0) return false;

		const changedFiles = output.trim().split("\n").filter(Boolean);
		if (changedFiles.length === 0) return false;

		return changedFiles.every((f) => GENERATED_FILES.has(f));
	} catch {
		return false;
	}
}
