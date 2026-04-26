import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export type ScopeMode = "diff" | "all" | "path";

export interface ScopeOptions {
	mode: ScopeMode;
	/** Required when mode === "path". Ignored otherwise. */
	path?: string;
	/** Current working directory — used as repo root for relative paths. */
	cwd: string;
}

/**
 * Resolve the list of files to scan based on the scope mode.
 *
 * - diff : when `LOOP_CLEAN_BASE_SHA` is set in the environment, return files
 *          changed since that SHA (`git diff $BASE_SHA --name-only`), so the
 *          scope stays stable across iterations even if intermediate commits
 *          advance HEAD. Otherwise, fall back to working-tree + staged
 *          (`git diff --name-only` + `git diff --cached --name-only`).
 *          Returns an empty list outside a git repo.
 * - all  : walk the repo from cwd, skip `node_modules`, `.git`, and
 *          `dist`/`build` dirs. Returns repo-relative paths.
 * - path : walk the given subtree the same way.
 */
export async function resolveScope(
	options: ScopeOptions,
): Promise<string[]> {
	switch (options.mode) {
		case "diff":
			return await resolveDiffScope(options.cwd);
		case "all":
			return await walkSourceTree(options.cwd, options.cwd);
		case "path": {
			if (!options.path) {
				throw new Error("--scope=path requires --path=<dir>");
			}
			return await walkSourceTree(options.path, options.cwd);
		}
	}
}

async function resolveDiffScope(cwd: string): Promise<string[]> {
	const baseSha = process.env.LOOP_CLEAN_BASE_SHA?.trim();
	if (baseSha) {
		return await runGitNameOnly(["git", "diff", baseSha, "--name-only"], cwd);
	}
	const files = new Set<string>();
	const both = await Promise.all([
		runGitNameOnly(["git", "diff", "--name-only"], cwd),
		runGitNameOnly(["git", "diff", "--cached", "--name-only"], cwd),
	]);
	for (const list of both) {
		for (const f of list) files.add(f);
	}
	return [...files];
}

async function runGitNameOnly(cmd: string[], cwd: string): Promise<string[]> {
	try {
		const proc = Bun.spawn(cmd, {
			stdout: "pipe",
			stderr: "pipe",
			cwd,
		});
		const [stdout, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		if (exitCode !== 0) return [];
		const out: string[] = [];
		for (const line of stdout.split("\n")) {
			const trimmed = line.trim();
			if (trimmed) out.push(trimmed);
		}
		return out;
	} catch {
		// Not a git repo / git missing → ignore.
		return [];
	}
}

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".cache",
	"__pycache__",
	".venv",
	"venv",
]);

async function walkSourceTree(
	dir: string,
	repoRoot: string,
): Promise<string[]> {
	const out: string[] = [];
	const stack: string[] = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) stack.push(full);
			} else if (entry.isFile()) {
				out.push(relative(repoRoot, full));
			}
		}
	}
	return out;
}
