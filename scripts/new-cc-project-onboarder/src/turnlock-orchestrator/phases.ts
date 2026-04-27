import type { Phase } from "turnlock";
import { z } from "zod";

import type {
	CheckResult,
	MissingTool,
} from "../required-tools-checker/required-tools-checker";
import type { InstallResults } from "../tools-installer/tools-installer";

// ---------------------------------------------------------------------------
// Sub-agent result schema (each entry of the agent-batch fan-in)
// ---------------------------------------------------------------------------

export const SingleAgentResultSchema = z.object({
	name: z.string(),
	status: z.enum(["installed", "failed"]),
	version: z.string().nullable(),
	method_used: z.string(),
	error: z.string(),
});

export type SingleAgentResult = z.infer<typeof SingleAgentResultSchema>;

// ---------------------------------------------------------------------------
// State shared across phases
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Phase: check
// ---------------------------------------------------------------------------

export function createPhaseCheck(deps: {
	checkPrerequisites: () => Promise<CheckResult>;
}): Phase<State> {
	return async (state, io) => {
		const result = await deps.checkPrerequisites();

		if (result.status === "unsupported_platform") {
			return io.fail(
				new Error(
					`unsupported_platform: ${result.os.label} (only darwin is supported)`,
				),
			);
		}

		if (result.status === "ok") {
			return io.done({ ok: true });
		}

		return io.transition("install", {
			...state,
			os_label: result.os.label,
			missing_tools: result.missing,
		});
	};
}

// ---------------------------------------------------------------------------
// Phase: install (mechanical) → fan-out to fallback batch on partial failure
// ---------------------------------------------------------------------------

export function createPhaseInstall(deps: {
	installTools: (missing: MissingTool[]) => Promise<InstallResults>;
}): Phase<State> {
	return async (state, io) => {
		const results = await deps.installTools(state.missing_tools);

		const failedNames = Object.entries(results)
			.filter(([, r]) => !r.ok)
			.map(([name]) => name);

		if (failedNames.length === 0) {
			return io.transition("recheck", {
				...state,
				install_results: results,
				recheck_after_fallback: false,
			});
		}

		const jobs = failedNames.map((name) => {
			const tool = state.missing_tools.find((t) => t.name === name);
			const installResult = results[name];
			const payload = {
				os_label: state.os_label,
				tool: {
					name,
					install_command_attempted: tool?.install_command ?? "",
					exit_code: installResult.exit_code,
					stderr: installResult.stderr,
				},
			};
			return {
				id: name,
				prompt: JSON.stringify(payload, null, 2),
			};
		});

		return io.delegateAgentBatch(
			{
				kind: "agent-batch",
				agentType: "installing-missing-tools-fallback",
				jobs,
				label: "tools-fallback-batch",
			},
			"consume-agent-result",
			{
				...state,
				install_results: results,
			},
		);
	};
}

// ---------------------------------------------------------------------------
// Phase: consume-agent-result — fan-in
// ---------------------------------------------------------------------------

export function createPhaseConsumeAgentResult(): Phase<State> {
	return async (state, io) => {
		const results = io.consumePendingBatchResults(SingleAgentResultSchema);

		const agent_result: Record<string, SingleAgentResult> = {};
		for (const r of results) {
			agent_result[r.name] = r;
		}

		return io.transition("recheck", {
			...state,
			agent_result,
			recheck_after_fallback: true,
		});
	};
}

// ---------------------------------------------------------------------------
// Phase: recheck — verify the system actually has the tools now
// ---------------------------------------------------------------------------

export function createPhaseRecheck(deps: {
	checkPrerequisites: () => Promise<CheckResult>;
}): Phase<State> {
	return async (_state, io) => {
		const result = await deps.checkPrerequisites();

		if (result.status === "ok") {
			return io.done({ ok: true });
		}

		if (result.status === "unsupported_platform") {
			return io.fail(
				new Error(`unsupported_platform on recheck: ${result.os.label}`),
			);
		}

		const stillMissing = result.missing.map((t) => t.name).join(", ");
		return io.fail(
			new Error(`tools still missing after fallback: ${stillMissing}`),
		);
	};
}
