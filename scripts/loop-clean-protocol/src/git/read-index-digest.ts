import { sha256 } from "../shared/hash.ts";
import { executeGitRead } from "./execute-git-read.ts";

/**
 * Computes a SHA-256 digest of the full Git index content.
 *
 * Equivalent to: sha256(git ls-files --stage -z)
 * Detects any change to the staging area: content, mode, additions,
 * removals, and multi-stage conflict entries.
 */
export async function readIndexDigest(
	repositoryRoot: string,
): Promise<string> {
	const result = await executeGitRead(repositoryRoot, [
		"ls-files",
		"--stage",
		"-z",
	]);

	if (result.exitCode !== 0) {
		throw new Error(
			`git ls-files failed (${result.exitCode}): ${result.stderr.trim()}`,
		);
	}

	return sha256(result.stdout);
}
