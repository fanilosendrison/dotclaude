import { z } from "zod";
import { executeGitRead } from "./execute-git-read.ts";
import { readIndexDigest } from "./read-index-digest.ts";

export const GitBaselineSchema = z.object({
	schema_version: z.literal(1),
	head: z.union([z.literal("UNBORN"), z.string().regex(/^[0-9a-f]{40,64}$/)]),
	index_digest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type GitBaseline = z.infer<typeof GitBaselineSchema>;

async function readHead(repositoryRoot: string): Promise<string> {
	const head = await executeGitRead(repositoryRoot, [
		"rev-parse",
		"--verify",
		"HEAD",
	]);
	if (head.exitCode !== 0) return "UNBORN";
	return new TextDecoder("utf-8", { fatal: true }).decode(head.stdout).trim();
}

export async function captureGitInvariants(
	repositoryRoot: string,
): Promise<GitBaseline> {
	return GitBaselineSchema.parse({
		schema_version: 1,
		head: await readHead(repositoryRoot),
		index_digest: await readIndexDigest(repositoryRoot),
	});
}
