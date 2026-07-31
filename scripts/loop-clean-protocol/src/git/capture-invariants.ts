import { z } from "zod";
import { readIndexDigest } from "./read-index-digest.ts";

export const GitBaselineSchema = z.object({
	schema_version: z.literal(1),
	head: z.union([z.literal("UNBORN"), z.string().regex(/^[0-9a-f]{40,64}$/)]),
	index_digest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type GitBaseline = z.infer<typeof GitBaselineSchema>;

interface GitExecution {
	readonly exitCode: number;
	readonly stdout: Uint8Array;
	readonly stderr: string;
}

export async function executeGitRead(
	repositoryRoot: string,
	args: readonly string[],
): Promise<GitExecution> {
	const processHandle = Bun.spawn(["git", "-C", repositoryRoot, ...args], {
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(processHandle.stdout).arrayBuffer(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	return { exitCode, stdout: new Uint8Array(stdout), stderr };
}

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
