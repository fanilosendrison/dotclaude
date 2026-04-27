export interface MissingTool {
	name: string;
	install_command: string;
}

export interface InstallResult {
	ok: boolean;
	exit_code: number;
	stdout: string;
	stderr: string;
}

export type InstallResults = Record<string, InstallResult>;

/**
 * Run each tool's `install_command` through a shell (`bash -c`) and capture
 * the result. Tools are installed in parallel since the install commands
 * write to disjoint paths and don't share state.
 *
 * Shell interpretation is required because real install commands are pipes
 * (e.g. `curl -fsSL https://bun.sh/install | bash`).
 */
export async function installTools(
	missing: MissingTool[],
): Promise<InstallResults> {
	const decoder = new TextDecoder();

	const entries = await Promise.all(
		missing.map(async (tool): Promise<[string, InstallResult]> => {
			const proc = Bun.spawn(["bash", "-c", tool.install_command], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
				new Response(proc.stdout).bytes(),
				new Response(proc.stderr).bytes(),
				proc.exited,
			]);

			const result: InstallResult = {
				ok: exitCode === 0,
				exit_code: exitCode,
				stdout: decoder.decode(stdoutBytes),
				stderr: decoder.decode(stderrBytes),
			};

			return [tool.name, result];
		}),
	);

	return Object.fromEntries(entries);
}
