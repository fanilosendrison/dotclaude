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
 * - diff : `git diff --name-only` + `git diff --cached --name-only` merged, unique.
 *          Falls back to empty list if not a git repo.
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
	const files = new Set<string>();
	const add = async (cmd: string[]): Promise<void> => {
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
			if (exitCode !== 0) return;
			for (const line of stdout.split("\n")) {
				const trimmed = line.trim();
				if (trimmed) files.add(trimmed);
			}
		} catch {
			// Not a git repo / git missing → ignore.
		}
	};
	await add(["git", "diff", "--name-only"]);
	await add(["git", "diff", "--cached", "--name-only"]);
	return [...files];
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
