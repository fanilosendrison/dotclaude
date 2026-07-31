/**
 * Low-level git subprocess runner shared across the protocol package.
 *
 * Kept in its own module so that both capture-invariants and read-index-digest
 * can import it without creating a circular dependency.
 */

export interface GitExecution {
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
