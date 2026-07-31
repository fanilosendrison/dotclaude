import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { sha256 } from "../shared/hash.ts";
import { canonicalJson } from "../shared/json.ts";
import { captureScopeContentDigest } from "./capture-scope-content.ts";
import { parsePorcelainV2 } from "./parse-porcelain-v2.ts";
import {
	type ScopeEntry,
	type ScopeManifest,
	ScopeManifestSchema,
} from "./scope-schema.ts";

interface GitResult {
	readonly stdout: Uint8Array;
	readonly stderr: string;
}

async function runGitRead(
	repositoryRoot: string,
	args: readonly string[],
): Promise<GitResult> {
	const processHandle = Bun.spawn(["git", "-C", repositoryRoot, ...args], {
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdoutBuffer, stderr, exitCode] = await Promise.all([
		new Response(processHandle.stdout).arrayBuffer(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`git -C <repo> ${args.join(" ")} failed (${exitCode}): ${stderr.trim()}`,
		);
	}
	return { stdout: new Uint8Array(stdoutBuffer), stderr };
}

async function normalizeRepositoryRoot(
	repositoryRoot: string,
): Promise<string> {
	if (!isAbsolute(repositoryRoot))
		throw new Error("repo-root must be absolute");
	const requestedRoot = await realpath(resolve(repositoryRoot));
	const result = await runGitRead(requestedRoot, [
		"rev-parse",
		"--show-toplevel",
	]);
	const reportedRoot = new TextDecoder("utf-8", { fatal: true })
		.decode(result.stdout)
		.trim();
	const normalizedReportedRoot = await realpath(reportedRoot);
	if (normalizedReportedRoot !== requestedRoot) {
		throw new Error(
			`repo-root must be the resolved Git top-level: expected ${normalizedReportedRoot}`,
		);
	}
	return requestedRoot;
}

async function pathExists(
	repositoryRoot: string,
	path: string,
): Promise<boolean> {
	try {
		await lstat(join(repositoryRoot, path));
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return false;
		throw error;
	}
}

function auditExclusion(path: string): string | null {
	if (path === "backlog.md") return "loop-clean backlog ledger";
	if (path === "design-queue.md") return "loop-clean design queue ledger";
	if (path === "backlog.archive.md") return "loop-clean backlog archive ledger";
	if (path === ".claude/run" || path.startsWith(".claude/run/")) {
		return "loop-clean runtime ledger";
	}
	return null;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(left: ScopeEntry, right: ScopeEntry): number {
	return (
		compareText(left.path, right.path) ||
		compareText(left.original_path ?? "", right.original_path ?? "") ||
		compareText(left.kind, right.kind) ||
		compareText(left.index_status, right.index_status) ||
		compareText(left.worktree_status, right.worktree_status)
	);
}

export async function collectScope(
	repositoryRoot: string,
): Promise<ScopeManifest> {
	const normalizedRoot = await normalizeRepositoryRoot(repositoryRoot);
	const status = await runGitRead(normalizedRoot, [
		"status",
		"--porcelain=v2",
		"-z",
		"--untracked-files=all",
		"--ignored=no",
	]);
	const parsedEntries = parsePorcelainV2(status.stdout);
	const entries: ScopeEntry[] = [];
	const seenPaths = new Set<string>();
	for (const parsedEntry of parsedEntries) {
		if (seenPaths.has(parsedEntry.path)) {
			throw new Error(`git status emitted duplicate path ${parsedEntry.path}`);
		}
		seenPaths.add(parsedEntry.path);
		const exclusionReason = auditExclusion(parsedEntry.path);
		entries.push({
			...parsedEntry,
			exists: await pathExists(normalizedRoot, parsedEntry.path),
			eligible_for_audit: exclusionReason === null,
			exclusion_reason: exclusionReason,
		});
	}
	entries.sort(compareEntries);
	const contentDigest = await captureScopeContentDigest({
		repo_root: normalizedRoot,
		entries,
	});
	const digest = sha256(
		canonicalJson({
			schema_version: 1,
			entries,
			content_digest: contentDigest,
		}),
	);
	return ScopeManifestSchema.parse({
		schema_version: 1,
		repo_root: normalizedRoot,
		generated_at: new Date().toISOString(),
		entries,
		content_digest: contentDigest,
		digest,
	});
}
