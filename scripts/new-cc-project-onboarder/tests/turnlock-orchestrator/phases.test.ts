import { describe, expect, test } from "bun:test";
import type { Phase, PhaseIO, PhaseResult } from "turnlock";
import type { ZodSchema } from "zod";
import {
	createPhaseCheck,
	createPhaseConsumeAgentResult,
	createPhaseInstall,
	createPhaseRecheck,
	type State,
} from "../../src/turnlock-orchestrator/phases";

type IOCall =
	| { method: "transition"; nextPhase: string; nextState: State }
	| {
			method: "delegateAgentBatch";
			req: {
				kind: "agent-batch";
				agentType: string;
				jobs: ReadonlyArray<{ id: string; prompt: string }>;
				label: string;
			};
			resumeAt: string;
			nextState: State;
	  }
	| { method: "done"; output: unknown }
	| { method: "fail"; error: Error }
	| { method: "consumePendingBatchResults"; schema: ZodSchema<unknown> };

interface MockIO {
	calls: IOCall[];
	io: PhaseIO<State>;
	pendingResult?: unknown;
}

function mockIO(pendingResult?: unknown): MockIO {
	const calls: IOCall[] = [];
	const sentinel = (kind: string): PhaseResult<State> =>
		({ kind } as unknown as PhaseResult<State>);

	const io = {
		transition(nextPhase: string, nextState: State): PhaseResult<State> {
			calls.push({ method: "transition", nextPhase, nextState });
			return sentinel("transition");
		},
		delegateSkill(): PhaseResult<State> {
			throw new Error("delegateSkill not used by these phases");
		},
		delegateAgent(): PhaseResult<State> {
			throw new Error("delegateAgent not used (use delegateAgentBatch)");
		},
		delegateAgentBatch(
			req: {
				kind: "agent-batch";
				agentType: string;
				jobs: ReadonlyArray<{ id: string; prompt: string }>;
				label: string;
			},
			resumeAt: string,
			nextState: State,
		): PhaseResult<State> {
			calls.push({
				method: "delegateAgentBatch",
				req,
				resumeAt,
				nextState,
			});
			return sentinel("delegate");
		},
		done<O>(output: O): PhaseResult<State> {
			calls.push({ method: "done", output });
			return sentinel("done");
		},
		fail(error: Error): PhaseResult<State> {
			calls.push({ method: "fail", error });
			return sentinel("fail");
		},
		consumePendingResult<T>(): T {
			throw new Error("consumePendingResult not used (use batch variant)");
		},
		consumePendingBatchResults<T>(schema: ZodSchema<T>): readonly T[] {
			calls.push({
				method: "consumePendingBatchResults",
				schema: schema as ZodSchema<unknown>,
			});
			if (pendingResult === undefined) {
				throw new Error("mockIO: no pending batch result configured");
			}
			return pendingResult as readonly T[];
		},
		refreshLock(): void {},
		logger: { event: () => {} } as unknown as PhaseIO<State>["logger"],
		clock: { now: () => new Date() } as PhaseIO<State>["clock"],
		runId: "test-run-id",
		args: [] as readonly string[],
		runDir: "/tmp/test-run-dir",
		signal: new AbortController().signal,
	} as unknown as PhaseIO<State>;

	return { calls, io };
}

function emptyState(): State {
	return {
		os_label: "darwin x64",
		missing_tools: [],
		install_results: null,
		agent_result: null,
		recheck_after_fallback: false,
	};
}

async function runPhase(
	phase: Phase<State>,
	state: State,
	io: PhaseIO<State>,
): Promise<void> {
	await phase(state, io);
}

describe("phaseCheck", () => {
	test("status=ok → io.done({ ok: true })", async () => {
		const phase = createPhaseCheck({
			checkPrerequisites: async () => ({
				status: "ok",
				os: { platform: "darwin", arch: "x64", label: "darwin x64" },
				tools: { git: { found: true, version: "git 2.42" } },
				missing: [],
			}),
		});
		const m = mockIO();

		await runPhase(phase, emptyState(), m.io);

		expect(m.calls).toHaveLength(1);
		expect(m.calls[0]).toMatchObject({
			method: "done",
			output: { ok: true },
		});
	});

	test("status=missing_tools → io.transition('install', state with missing_tools)", async () => {
		const phase = createPhaseCheck({
			checkPrerequisites: async () => ({
				status: "missing_tools",
				os: { platform: "darwin", arch: "x64", label: "darwin x64" },
				tools: { gh: { found: false, version: null } },
				missing: [{ name: "gh", install_command: "curl -sS https://webi.sh/gh | sh" }],
			}),
		});
		const m = mockIO();

		await runPhase(phase, emptyState(), m.io);

		expect(m.calls).toHaveLength(1);
		const call = m.calls[0];
		expect(call.method).toBe("transition");
		if (call.method !== "transition") return;
		expect(call.nextPhase).toBe("install");
		expect(call.nextState.missing_tools).toEqual([
			{ name: "gh", install_command: "curl -sS https://webi.sh/gh | sh" },
		]);
		expect(call.nextState.os_label).toBe("darwin x64");
	});

	test("status=unsupported_platform → io.fail with label in message", async () => {
		const phase = createPhaseCheck({
			checkPrerequisites: async () => ({
				status: "unsupported_platform",
				os: { platform: "linux", arch: "x64", label: "linux x64" },
			}),
		});
		const m = mockIO();

		await runPhase(phase, emptyState(), m.io);

		expect(m.calls).toHaveLength(1);
		const call = m.calls[0];
		expect(call.method).toBe("fail");
		if (call.method !== "fail") return;
		expect(call.error).toBeInstanceOf(Error);
		expect(call.error.message).toContain("linux x64");
	});
});

describe("phaseInstall", () => {
	test("all installs OK → io.transition('recheck', state with install_results)", async () => {
		const phase = createPhaseInstall({
			installTools: async () => ({
				gh: { ok: true, exit_code: 0, stdout: "installed", stderr: "" },
			}),
		});
		const m = mockIO();
		const state: State = {
			...emptyState(),
			missing_tools: [
				{ name: "gh", install_command: "curl -sS https://webi.sh/gh | sh" },
			],
		};

		await runPhase(phase, state, m.io);

		expect(m.calls).toHaveLength(1);
		const call = m.calls[0];
		expect(call.method).toBe("transition");
		if (call.method !== "transition") return;
		expect(call.nextPhase).toBe("recheck");
		expect(call.nextState.install_results).toEqual({
			gh: { ok: true, exit_code: 0, stdout: "installed", stderr: "" },
		});
		expect(call.nextState.recheck_after_fallback).toBe(false);
	});

	test("at least 1 install fails → io.delegateAgentBatch with one job per failed tool", async () => {
		const phase = createPhaseInstall({
			installTools: async () => ({
				gh: { ok: false, exit_code: 1, stdout: "", stderr: "boom-gh" },
				bun: { ok: false, exit_code: 2, stdout: "", stderr: "boom-bun" },
				git: { ok: true, exit_code: 0, stdout: "ok", stderr: "" },
			}),
		});
		const m = mockIO();
		const state: State = {
			...emptyState(),
			missing_tools: [
				{ name: "gh", install_command: "curl -sS https://webi.sh/gh | sh" },
				{
					name: "bun",
					install_command: "curl -fsSL https://bun.sh/install | bash",
				},
				{ name: "git", install_command: "curl -sS https://webi.sh/git | sh" },
			],
		};

		await runPhase(phase, state, m.io);

		expect(m.calls).toHaveLength(1);
		const call = m.calls[0];
		expect(call.method).toBe("delegateAgentBatch");
		if (call.method !== "delegateAgentBatch") return;

		expect(call.req.kind).toBe("agent-batch");
		expect(call.req.agentType).toBe("installing-missing-tools-fallback");
		expect(call.req.jobs).toHaveLength(2); // only the 2 failed, not git

		const ids = call.req.jobs.map((j) => j.id).sort();
		expect(ids).toEqual(["bun", "gh"]);

		const ghJob = call.req.jobs.find((j) => j.id === "gh");
		expect(ghJob).toBeDefined();
		if (!ghJob) return;
		expect(ghJob.prompt).toContain("gh");
		expect(ghJob.prompt).toContain("boom-gh");
		// each job's prompt is isolated to its own tool
		expect(ghJob.prompt).not.toContain("boom-bun");

		expect(call.resumeAt).toBe("consume-agent-result");
		expect(call.nextState.install_results).toBeDefined();
	});
});

describe("phaseConsumeAgentResult", () => {
	test("consumes pending batch results and merges into state.agent_result indexed by tool name", async () => {
		const phase = createPhaseConsumeAgentResult();
		const pending = [
			{
				name: "gh",
				status: "installed" as const,
				version: "gh version 2.86.0",
				method_used: "GitHub releases tarball darwin-amd64",
				error: "",
			},
			{
				name: "bun",
				status: "installed" as const,
				version: "1.3.12",
				method_used: "curl bun.sh/install",
				error: "",
			},
		];
		const m = mockIO(pending);

		await runPhase(phase, emptyState(), m.io);

		expect(m.calls.map((c) => c.method)).toEqual([
			"consumePendingBatchResults",
			"transition",
		]);
		const transitionCall = m.calls[1];
		if (transitionCall.method !== "transition") return;
		expect(transitionCall.nextPhase).toBe("recheck");
		expect(transitionCall.nextState.agent_result).toEqual({
			gh: pending[0],
			bun: pending[1],
		});
		expect(transitionCall.nextState.recheck_after_fallback).toBe(true);
	});
});

describe("phaseRecheck", () => {
	test("status=ok → io.done({ ok: true })", async () => {
		const phase = createPhaseRecheck({
			checkPrerequisites: async () => ({
				status: "ok",
				os: { platform: "darwin", arch: "x64", label: "darwin x64" },
				tools: { gh: { found: true, version: "gh 2.86" } },
				missing: [],
			}),
		});
		const m = mockIO();

		await runPhase(phase, emptyState(), m.io);

		expect(m.calls).toHaveLength(1);
		expect(m.calls[0]).toMatchObject({
			method: "done",
			output: { ok: true },
		});
	});

	test("still missing → io.fail with diagnostic listing remaining tools", async () => {
		const phase = createPhaseRecheck({
			checkPrerequisites: async () => ({
				status: "missing_tools",
				os: { platform: "darwin", arch: "x64", label: "darwin x64" },
				tools: { gh: { found: false, version: null } },
				missing: [
					{ name: "gh", install_command: "curl -sS https://webi.sh/gh | sh" },
				],
			}),
		});
		const m = mockIO();

		await runPhase(phase, emptyState(), m.io);

		expect(m.calls).toHaveLength(1);
		const call = m.calls[0];
		expect(call.method).toBe("fail");
		if (call.method !== "fail") return;
		expect(call.error.message).toContain("gh");
	});
});
