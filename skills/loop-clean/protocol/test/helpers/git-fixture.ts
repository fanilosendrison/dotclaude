import { existsSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface ProcessResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export async function runProcess(
	command: readonly string[],
	options: {
		readonly cwd: string;
		readonly env?: Record<string, string | undefined>;
	},
): Promise<ProcessResult> {
	const processHandle = Bun.spawn([...command], {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	return { exitCode, stdout, stderr };
}

export async function requireProcess(
	command: readonly string[],
	options: {
		readonly cwd: string;
		readonly env?: Record<string, string | undefined>;
	},
): Promise<string> {
	const result = await runProcess(command, options);
	if (result.exitCode !== 0) {
		throw new Error(
			`${command.join(" ")} failed (${result.exitCode}): ${result.stderr}`,
		);
	}
	return result.stdout.trim();
}

export async function resolveRealGit(): Promise<string> {
	const explicitPath = process.env.LOOP_CLEAN_TEST_REAL_GIT;
	if (explicitPath && existsSync(explicitPath))
		return await realpath(explicitPath);
	const gitExecPath = await requireProcess(["git", "--exec-path"], {
		cwd: "/",
	});
	const delegatedGit = join(gitExecPath, "git");
	if (existsSync(delegatedGit)) return await realpath(delegatedGit);
	throw new Error(
		"real Git executable not found; set LOOP_CLEAN_TEST_REAL_GIT for fixture bootstrap",
	);
}

export async function runGit(
	repositoryRoot: string,
	args: readonly string[],
): Promise<string> {
	const realGit = await resolveRealGit();
	return await requireProcess([realGit, ...args], {
		cwd: repositoryRoot,
		env: {
			GIT_AUTHOR_NAME: "Loop Clean Test",
			GIT_AUTHOR_EMAIL: "loop-clean@example.invalid",
			GIT_COMMITTER_NAME: "Loop Clean Test",
			GIT_COMMITTER_EMAIL: "loop-clean@example.invalid",
			GIT_CONFIG_NOSYSTEM: "1",
		},
	});
}

export async function writeRepositoryFile(
	repositoryRoot: string,
	relativePath: string,
	contents: string,
): Promise<void> {
	const absolutePath = join(repositoryRoot, relativePath);
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, contents);
}

export async function createRepository(options?: {
	readonly withBaseline?: boolean;
	readonly prefix?: string;
}): Promise<string> {
	const repositoryRoot = await realpath(
		await mkdtemp(
			join(tmpdir(), options?.prefix ?? "loop-clean-protocol-test-"),
		),
	);
	await runGit(repositoryRoot, ["init", "--quiet"]);
	await runGit(repositoryRoot, ["config", "user.name", "Loop Clean Test"]);
	await runGit(repositoryRoot, [
		"config",
		"user.email",
		"loop-clean@example.invalid",
	]);
	if (options?.withBaseline !== false) {
		await writeRepositoryFile(
			repositoryRoot,
			"baseline.txt",
			"fixture baseline\n",
		);
		await runGit(repositoryRoot, ["add", "."]);
		await runGit(repositoryRoot, [
			"commit",
			"--quiet",
			"-m",
			"fixture baseline",
		]);
	}
	return repositoryRoot;
}

export async function removeRepository(repositoryRoot: string): Promise<void> {
	await rm(repositoryRoot, { recursive: true, force: true });
}

function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function createReadOnlyGitWrapper(
	parentDirectory: string,
): Promise<{ readonly binDirectory: string; readonly logPath: string }> {
	const binDirectory = join(parentDirectory, "git-wrapper-bin");
	const logPath = join(parentDirectory, "git-wrapper.log");
	const wrapperPath = join(binDirectory, "git");
	const realGit = await resolveRealGit();
	await mkdir(binDirectory, { recursive: true });
	await writeFile(
		wrapperPath,
		`#!/usr/bin/env bash
set -euo pipefail
REAL_GIT=${shellSingleQuote(realGit)}
LOG_PATH=${shellSingleQuote(logPath)}
printf '%s' "$1" >> "$LOG_PATH"
for argument in "\${@:2}"; do printf '\\t%s' "$argument" >> "$LOG_PATH"; done
printf '\\n' >> "$LOG_PATH"
arguments=("$@")
command_name=""
index=0
while (( index < \${#arguments[@]} )); do
  argument="\${arguments[$index]}"
  case "$argument" in
    -C|-c|--git-dir|--work-tree)
      index=$((index + 2))
      ;;
    --*)
      index=$((index + 1))
      ;;
    *)
      command_name="$argument"
      break
      ;;
  esac
done
case "$command_name" in
  rev-parse|status|diff|ls-files|show|cat-file|check-ignore)
    exec "$REAL_GIT" "$@"
    ;;
  *)
    printf 'BLOCKED_MUTATING_GIT_COMMAND %s\\n' "$command_name" >&2
    exit 97
    ;;
esac
`,
	);
	await chmod(wrapperPath, 0o755);
	return { binDirectory, logPath };
}

export function parseShellExports(stdout: string): Record<string, string> {
	const exports: Record<string, string> = {};
	for (const line of stdout.split("\n")) {
		const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
		if (match) exports[match[1]] = match[2];
	}
	return exports;
}
