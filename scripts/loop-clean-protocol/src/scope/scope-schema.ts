import { isAbsolute } from "node:path";
import { z } from "zod";

export const SCOPE_KINDS = [
	"tracked",
	"untracked",
	"renamed",
	"copied",
	"deleted",
	"unmerged",
] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number];

function isSafeRepositoryRelativePath(path: string): boolean {
	if (path.length === 0 || path.includes("\0") || isAbsolute(path))
		return false;
	return !path
		.split("/")
		.some((component) => component === ".." || component === "");
}

export const ScopeEntrySchema = z.object({
	path: z
		.string()
		.refine(isSafeRepositoryRelativePath, "path must be repository-relative"),
	original_path: z
		.string()
		.refine(
			isSafeRepositoryRelativePath,
			"original_path must be repository-relative",
		)
		.nullable(),
	kind: z.enum(SCOPE_KINDS),
	index_status: z.string().length(1),
	worktree_status: z.string().length(1),
	exists: z.boolean(),
	eligible_for_audit: z.boolean(),
	exclusion_reason: z.string().min(1).nullable(),
});

export const ScopeManifestSchema = z.object({
	schema_version: z.literal(2),
	repo_root: z.string().refine(isAbsolute, "repo_root must be absolute"),
	generated_at: z.string().min(1),
	entries: z.array(ScopeEntrySchema),
	index_digest: z.string().regex(/^[0-9a-f]{64}$/),
	content_digest: z.string().regex(/^[0-9a-f]{64}$/),
	digest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ScopeEntry = z.infer<typeof ScopeEntrySchema>;
export type ScopeManifest = z.infer<typeof ScopeManifestSchema>;

export function parseScopeManifest(value: unknown): ScopeManifest {
	return ScopeManifestSchema.parse(value);
}
