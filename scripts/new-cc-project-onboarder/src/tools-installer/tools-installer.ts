/**
 * Multi-method install with retry + verify.
 *
 * Each tool has an ordered list of `methods`. For each tool we try methods
 * in order until one succeeds. Success = install command exit 0 AND verify
 * command (`<tool> --version` by default) exit 0. The `attempts` array
 * captures every method tried, including verify outcomes — even the
 * subtle case where install exits 0 but verify reports failure (binary
 * dropped but PATH/perms broke).
 *
 * Tools install in parallel; methods within a tool are sequential.
 */

const decoder = new TextDecoder();

export interface InstallMethod {
	id: string;
	run: () => Promise<{ exit_code: number; stdout: string; stderr: string }>;
}

export interface ToolConfig {
	name: string;
	methods: InstallMethod[];
}

export interface MethodAttempt {
	id: string;
	/** True iff install exit=0 AND verify exit=0. */
	ok: boolean;
	/** Exit code of the install command. */
	exit_code: number;
	stdout: string;
	stderr: string;
	/** Exit code of the verify step. Present iff install exit=0. */
	verify_exit_code?: number;
}

export interface InstallResult {
	/** True iff at least one method's `attempt.ok` is true. */
	ok: boolean;
	/** Ordered list of every method tried (until first success or exhaustion). */
	attempts: MethodAttempt[];
	/** Id of the method that succeeded, if any. */
	successful_method_id?: string;
	/** First line of the verify stdout when ok, trimmed. */
	version?: string;
}

export type InstallResults = Record<string, InstallResult>;

export interface InstallToolsDeps {
	/** Override the verify step. Default: spawn `<toolName> --version`. */
	verify?: (toolName: string) => Promise<{ exit_code: number; stdout: string }>;
}

/**
 * Build an `InstallMethod.run` from a shell command string. Runs through
 * `bash -c` so pipes, redirects, and `curl ... | bash` patterns work.
 */
export function shellCmd(command: string): InstallMethod["run"] {
	return async () => {
		const proc = Bun.spawn(["bash", "-c", command], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
			new Response(proc.stdout).bytes(),
			new Response(proc.stderr).bytes(),
			proc.exited,
		]);
		return {
			exit_code: exitCode,
			stdout: decoder.decode(stdoutBytes),
			stderr: decoder.decode(stderrBytes),
		};
	};
}

async function defaultVerify(
	toolName: string,
): Promise<{ exit_code: number; stdout: string }> {
	const proc = Bun.spawn([toolName, "--version"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdoutBytes, exitCode] = await Promise.all([
		new Response(proc.stdout).bytes(),
		proc.exited,
	]);
	return {
		exit_code: exitCode,
		stdout: decoder.decode(stdoutBytes),
	};
}

export async function installTools(
	tools: readonly ToolConfig[],
	deps: InstallToolsDeps = {},
): Promise<InstallResults> {
	const verify = deps.verify ?? defaultVerify;

	const entries = await Promise.all(
		tools.map(async (tool): Promise<[string, InstallResult]> => {
			const attempts: MethodAttempt[] = [];
			let successfulMethodId: string | undefined;
			let version: string | undefined;

			for (const method of tool.methods) {
				const installResult = await method.run();

				if (installResult.exit_code !== 0) {
					attempts.push({
						id: method.id,
						ok: false,
						exit_code: installResult.exit_code,
						stdout: installResult.stdout,
						stderr: installResult.stderr,
					});
					continue;
				}

				const verifyResult = await verify(tool.name);
				const ok = verifyResult.exit_code === 0;

				attempts.push({
					id: method.id,
					ok,
					exit_code: installResult.exit_code,
					stdout: installResult.stdout,
					stderr: installResult.stderr,
					verify_exit_code: verifyResult.exit_code,
				});

				if (ok) {
					successfulMethodId = method.id;
					version = verifyResult.stdout.split("\n")[0]?.trim() || "";
					break;
				}
			}

			const result: InstallResult = {
				ok: successfulMethodId !== undefined,
				attempts,
				...(successfulMethodId !== undefined
					? { successful_method_id: successfulMethodId }
					: {}),
				...(version !== undefined && version !== ""
					? { version }
					: {}),
			};

			return [tool.name, result];
		}),
	);

	return Object.fromEntries(entries);
}
