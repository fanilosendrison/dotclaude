import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../shared/hash.ts";
import { canonicalJson } from "../shared/json.ts";
import type { ScopeEntry } from "./scope-schema.ts";

export async function captureScopeContentDigest(manifest: {
	readonly repo_root: string;
	readonly entries: readonly ScopeEntry[];
}): Promise<string> {
	const contentEntries: Array<{
		readonly path: string;
		readonly content_kind:
			| "absent"
			| "directory"
			| "file"
			| "symlink"
			| "other";
		readonly content_hash: string;
	}> = [];
	for (const entry of manifest.entries) {
		if (!entry.exists) {
			contentEntries.push({
				path: entry.path,
				content_kind: "absent",
				content_hash: "",
			});
			continue;
		}
		const absolutePath = join(manifest.repo_root, entry.path);
		const metadata = await lstat(absolutePath);
		if (metadata.isSymbolicLink()) {
			contentEntries.push({
				path: entry.path,
				content_kind: "symlink",
				content_hash: sha256(await readlink(absolutePath)),
			});
		} else if (metadata.isFile()) {
			contentEntries.push({
				path: entry.path,
				content_kind: "file",
				content_hash: sha256(await readFile(absolutePath)),
			});
		} else if (metadata.isDirectory()) {
			contentEntries.push({
				path: entry.path,
				content_kind: "directory",
				content_hash: "",
			});
		} else {
			contentEntries.push({
				path: entry.path,
				content_kind: "other",
				content_hash: "",
			});
		}
	}
	return sha256(canonicalJson(contentEntries));
}
