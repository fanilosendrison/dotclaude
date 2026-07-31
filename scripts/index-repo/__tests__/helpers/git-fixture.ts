import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

async function resolveRealGit(): Promise<string> {
	const explicitPath = process.env.INDEX_REPO_TEST_REAL_GIT;
	if (explicitPath && existsSync(explicitPath))
		return await realpath(explicitPath);
	const discovery = Bun.spawn(["git", "--exec-path"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [gitExecPath, exitCode] = await Promise.all([
		new Response(discovery.stdout).text(),
		discovery.exited,
	]);
	if (exitCode !== 0) throw new Error("unable to resolve Git exec path");
	const candidate = join(gitExecPath.trim(), "git");
	if (!existsSync(candidate)) {
		throw new Error("set INDEX_REPO_TEST_REAL_GIT to bootstrap Git fixtures");
	}
	return await realpath(candidate);
}

export async function runFixtureGit(
	repositoryRoot: string,
	args: readonly string[],
): Promise<void> {
	const realGit = await resolveRealGit();
	const processHandle = Bun.spawn([realGit, ...args], {
		cwd: repositoryRoot,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Index Repo Test",
			GIT_AUTHOR_EMAIL: "index-repo@example.invalid",
			GIT_COMMITTER_NAME: "Index Repo Test",
			GIT_COMMITTER_EMAIL: "index-repo@example.invalid",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stderr, exitCode] = await Promise.all([
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`fixture git ${args.join(" ")} failed: ${stderr}`);
	}
}
