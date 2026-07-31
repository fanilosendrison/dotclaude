import type { Phase, PhaseIO, PhaseResult } from "turnlock";
import { z } from "zod";

import type {
	CheckResult,
	MissingTool,
} from "../required-tools-checker/required-tools-checker";
import { INSTALL_METHODS } from "../tools-installer/install-methods";
import type {
	InstallResults,
	ToolConfig,
} from "../tools-installer/tools-installer";

export const SingleAgentResultSchema = z.object({
	name: z.string(),
	status: z.enum(["installed", "failed"]),
	version: z.string().nullable(),
	method_used: z.string(),
	error: z.string(),
});

export type SingleAgentResult = z.infer<typeof SingleAgentResultSchema>;

export interface State {
	os_label: string;
	missing_tools: MissingTool[];
	install_results: InstallResults | null;
	agent_result: Record<string, SingleAgentResult> | null;
	recheck_after_fallback: boolean;
}

export const initialState: State = {
	os_label: "",
	missing_tools: [],
	install_results: null,
	agent_result: null,
	recheck_after_fallback: false,
};

interface OnboardDependencies {
	checkPrerequisites: () => Promise<CheckResult>;
	installTools: (tools: readonly ToolConfig[]) => Promise<InstallResults>;
}

function finishCheckResult(
	result: CheckResult,
	io: PhaseIO<State>,
): PhaseResult<State> {
	if (result.status === "ok") return io.done({ ok: true });
	if (result.status === "unsupported_platform") {
		return io.fail(
			new Error(
				`unsupported_platform: ${result.os.label} (only darwin is supported)`,
			),
		);
	}
	const stillMissing = result.missing.map((tool) => tool.name).join(", ");
	return io.fail(
		new Error(`tools still missing after installation: ${stillMissing}`),
	);
}

function buildToolConfigs(missingTools: readonly MissingTool[]): ToolConfig[] {
	return missingTools.map((tool) => ({
		name: tool.name,
		methods: INSTALL_METHODS[tool.name] ?? [],
	}));
}

function buildFallbackJobs(
	results: InstallResults,
	osLabel: string,
): Array<{
	readonly id: string;
	readonly prompt: string;
}> {
	return Object.entries(results)
		.filter(([, result]) => !result.ok)
		.map(([name, result]) => ({
			id: name,
			prompt: JSON.stringify(
				{
					os_label: osLabel,
					tool: {
						name,
						methods_tried: result.attempts.map((attempt) => ({
							id: attempt.id,
							exit_code: attempt.exit_code,
							stderr: attempt.stderr,
							verify_exit_code: attempt.verify_exit_code,
						})),
					},
				},
				null,
				2,
			),
		}));
}

/**
 * Execute every mechanical step in one phase. Turnlock phases yield only at a
 * durable boundary, so check, installation, and successful recheck stay in the
 * same phase; a fallback batch is the only suspension point.
 */
export function createPhaseOnboard(deps: OnboardDependencies): Phase<State> {
	return async (state, io) => {
		const initialCheck = await deps.checkPrerequisites();
		if (initialCheck.status !== "missing_tools") {
			return finishCheckResult(initialCheck, io);
		}

		const installResults = await deps.installTools(
			buildToolConfigs(initialCheck.missing),
		);
		const fallbackJobs = buildFallbackJobs(
			installResults,
			initialCheck.os.label,
		);
		if (fallbackJobs.length === 0) {
			return finishCheckResult(await deps.checkPrerequisites(), io);
		}

		return io.delegateBatch(
			{
				kind: "batch",
				worker: "installing-missing-tools-fallback",
				jobs: fallbackJobs,
				label: "tools-fallback-batch",
			},
			"consume-agent-result",
			{
				...state,
				os_label: initialCheck.os.label,
				missing_tools: initialCheck.missing,
				install_results: installResults,
			},
		);
	};
}

export function createPhaseConsumeAgentResult(deps: {
	checkPrerequisites: () => Promise<CheckResult>;
}): Phase<State> {
	return async (_state, io) => {
		// The consumer currently resolves Zod v4 while Turnlock 0.10 exposes a
		// Zod v3 type. Both provide the safeParse contract used by Turnlock; this
		// boundary cast avoids weakening types anywhere else in the phase.
		const compatibleSchema = SingleAgentResultSchema as unknown as Parameters<
			PhaseIO<State>["consumePendingBatchResults"]
		>[0];
		const rawResults = io.consumePendingBatchResults(compatibleSchema);
		const results = rawResults.map((value) =>
			SingleAgentResultSchema.parse(value),
		);
		const agentResult: Record<string, SingleAgentResult> = {};
		for (const result of results) agentResult[result.name] = result;

		const recheck = await deps.checkPrerequisites();
		if (recheck.status === "ok") {
			return io.done({ ok: true, agent_result: agentResult });
		}
		if (recheck.status === "unsupported_platform") {
			return io.fail(
				new Error(`unsupported_platform on recheck: ${recheck.os.label}`),
			);
		}
		const stillMissing = recheck.missing.map((tool) => tool.name).join(", ");
		return io.fail(
			new Error(`tools still missing after fallback: ${stillMissing}`),
		);
	};
}
