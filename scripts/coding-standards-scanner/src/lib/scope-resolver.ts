import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseScopeManifest } from "../../../../skills/loop-clean/protocol/src/scope/scope-schema.ts";
import { sha256 } from "../../../../skills/loop-clean/protocol/src/shared/hash.ts";
import { canonicalJson } from "../../../../skills/loop-clean/protocol/src/shared/json.ts";

export type ScopeMode = "all" | "path";

export interface ScopeOptions {
	readonly scopeFile?: string;
	readonly expectedDigest?: string;
	readonly mode?: ScopeMode;
	readonly path?: string;
	readonly cwd: string;
}

export interface ResolvedScope {
	readonly files: string[];
	readonly digest: string;
}

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	".claude",
	"dist",
	"build",
	".next",
	".cache",
	"__pycache__",
	".venv",
	"venv",
]);

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

async function resolveManifestScope(
	scopeFile: string,
	cwd: string,
	expectedDigest?: string,
): Promise<ResolvedScope> {
	let raw: unknown;
	try {
		raw = JSON.parse(await Bun.file(scopeFile).text());
	} catch (error) {
		throw new Error(
			`scope file contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const manifest = parseScopeManifest(raw);
	if (resolve(manifest.repo_root) !== resolve(cwd)) {
		throw new Error(
			"scope.json repo_root differs from the scanner repository root",
		);
	}
	if (expectedDigest && manifest.digest !== expectedDigest) {
		throw new Error(
			`scope.json digest ${manifest.digest} differs from expected digest ${expectedDigest}`,
		);
	}
	const files = manifest.entries
		.filter((entry) => entry.eligible_for_audit && entry.exists)
		.map((entry) => entry.path)
		.sort(compareText);
	return { files, digest: manifest.digest };
}

async function walkSourceTree(
	directory: string,
	repositoryRoot: string,
): Promise<string[]> {
	const output: string[] = [];
	const stack: string[] = [directory];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		let entries: Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		entries.sort((left, right) => compareText(left.name, right.name));
		for (const entry of entries) {
			const fullPath = join(current, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) stack.push(fullPath);
			} else if (entry.isFile()) {
				output.push(relative(repositoryRoot, fullPath));
			}
		}
	}
	return output.sort(compareText);
}

export async function resolveScope(
	options: ScopeOptions,
): Promise<ResolvedScope> {
	if (options.scopeFile) {
		return await resolveManifestScope(
			options.scopeFile,
			options.cwd,
			options.expectedDigest,
		);
	}
	const mode = options.mode ?? "all";
	if (mode === "path" && !options.path) {
		throw new Error("--scope=path requires --path=<dir>");
	}
	const files = await walkSourceTree(
		mode === "path" ? (options.path as string) : options.cwd,
		options.cwd,
	);
	return {
		files,
		digest: sha256(canonicalJson({ schema_version: 1, files })),
	};
}
