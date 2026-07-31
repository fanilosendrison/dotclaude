import { describe, expect, test } from "bun:test";
import type { Phase, PhaseIO, PhaseResult } from "turnlock";
import {
	createPhaseConsumeAgentResult,
	createPhaseOnboard,
	type State,
} from "../../src/turnlock-orchestrator/phases";

type IOCall =
	| {
			method: "delegateBatch";
			req: {
				kind: "batch";
				worker?: string;
				jobs: ReadonlyArray<{ id: string; prompt: string }>;
				label: string;
			};
			resumeAt: string;
			nextState: State;
	  }
	| { method: "done"; output: unknown }
	| { method: "fail"; error: Error }
	| { method: "consumePendingBatchResults"; schema: unknown };

interface MockIO {
	calls: IOCall[];
	io: PhaseIO<State>;
}

function mockIO(pendingResult?: unknown): MockIO {
	const calls: IOCall[] = [];
	const sentinel = (kind: string): PhaseResult<State> =>
		({ kind }) as unknown as PhaseResult<State>;
	const io = {
		delegate(): PhaseResult<State> {
			throw new Error("delegate is not used by these phases");
		},
		delegateBatch(
			req: {
				kind: "batch";
				worker?: string;
				jobs: ReadonlyArray<{ id: string; prompt: string }>;
				label: string;
			},
			resumeAt: string,
			nextState: State,
		): PhaseResult<State> {
			calls.push({ method: "delegateBatch", req, resumeAt, nextState });
			return sentinel("delegate");
		},
		requestExternal(): PhaseResult<State> {
			throw new Error("requestExternal is not used by these phases");
		},
		done<Output>(output: Output): PhaseResult<State, Output> {
			calls.push({ method: "done", output });
			return sentinel("done") as PhaseResult<State, Output>;
		},
		fail(error: Error): PhaseResult<State> {
			calls.push({ method: "fail", error });
			return sentinel("fail");
		},
		consumePendingResult<T>(): T {
			throw new Error("consumePendingResult is not used by these phases");
		},
		consumePendingBatchResults<T>(schema: unknown): readonly T[] {
			calls.push({ method: "consumePendingBatchResults", schema });
			if (pendingResult === undefined) {
				throw new Error("no pending batch result configured");
			}
			return pendingResult as readonly T[];
		},
		consumePendingExternalResolution<T>(): T {
			throw new Error("external resolution is not used by these phases");
		},
		refreshLock(): void {},
		logger: { event: () => {} } as unknown as PhaseIO<State>["logger"],
		clock: {
			nowWall: () => new Date(0),
			nowWallIso: () => new Date(0).toISOString(),
			nowEpochMs: () => 0,
			nowMono: () => 0,
		} as PhaseIO<State>["clock"],
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

const darwin = { platform: "darwin", arch: "x64", label: "darwin x64" };

describe("phaseOnboard", () => {
	test("finishes immediately when every prerequisite exists", async () => {
		const phase = createPhaseOnboard({
			checkPrerequisites: async () => ({
				status: "ok",
				os: darwin,
				tools: { git: { found: true, version: "git 2.42" } },
				missing: [],
			}),
			installTools: async () => {
				throw new Error("installTools must not run");
			},
		});
		const mock = mockIO();
		await runPhase(phase, emptyState(), mock.io);
		expect(mock.calls).toEqual([{ method: "done", output: { ok: true } }]);
	});

	test("fails on an unsupported platform", async () => {
		const phase = createPhaseOnboard({
			checkPrerequisites: async () => ({
				status: "unsupported_platform",
				os: { platform: "linux", arch: "x64", label: "linux x64" },
			}),
			installTools: async () => ({}),
		});
		const mock = mockIO();
		await runPhase(phase, emptyState(), mock.io);
		expect(mock.calls[0]?.method).toBe("fail");
		if (mock.calls[0]?.method === "fail") {
			expect(mock.calls[0].error.message).toContain("linux x64");
		}
	});

	test("installs mechanically and rechecks without an artificial transition", async () => {
		let checkCount = 0;
		const phase = createPhaseOnboard({
			checkPrerequisites: async () => {
				checkCount += 1;
				return checkCount === 1
					? {
							status: "missing_tools" as const,
							os: darwin,
							tools: { gh: { found: false as const, version: null } },
							missing: [{ name: "gh" }],
						}
					: {
							status: "ok" as const,
							os: darwin,
							tools: { gh: { found: true as const, version: "gh 2.86" } },
							missing: [],
						};
			},
			installTools: async (tools) => {
				expect(tools.map((tool) => tool.name)).toEqual(["gh"]);
				return {
					gh: {
						ok: true,
						attempts: [
							{
								id: "webi",
								ok: true,
								exit_code: 0,
								stdout: "installed",
								stderr: "",
								verify_exit_code: 0,
							},
						],
						successful_method_id: "webi",
						version: "gh 2.86",
					},
				};
			},
		});
		const mock = mockIO();
		await runPhase(phase, emptyState(), mock.io);
		expect(checkCount).toBe(2);
		expect(mock.calls).toEqual([{ method: "done", output: { ok: true } }]);
	});

	test("delegates failed installations through the current batch contract", async () => {
		const phase = createPhaseOnboard({
			checkPrerequisites: async () => ({
				status: "missing_tools",
				os: darwin,
				tools: {
					gh: { found: false, version: null },
					bun: { found: false, version: null },
				},
				missing: [{ name: "gh" }, { name: "bun" }],
			}),
			installTools: async () => ({
				gh: {
					ok: false,
					attempts: [
						{
							id: "webi",
							ok: false,
							exit_code: 1,
							stdout: "",
							stderr: "gh failed",
						},
					],
				},
				bun: {
					ok: false,
					attempts: [
						{
							id: "bun-sh",
							ok: false,
							exit_code: 2,
							stdout: "",
							stderr: "bun failed",
						},
					],
				},
			}),
		});
		const mock = mockIO();
		await runPhase(phase, emptyState(), mock.io);
		expect(mock.calls).toHaveLength(1);
		const call = mock.calls[0];
		expect(call?.method).toBe("delegateBatch");
		if (call?.method !== "delegateBatch") return;
		expect(call.req).toMatchObject({
			kind: "batch",
			worker: "installing-missing-tools-fallback",
			label: "tools-fallback-batch",
		});
		expect(call.req.jobs.map((job) => job.id).sort()).toEqual(["bun", "gh"]);
		expect(call.req.jobs.find((job) => job.id === "gh")?.prompt).toContain(
			"gh failed",
		);
		expect(call.resumeAt).toBe("consume-agent-result");
		expect(call.nextState.install_results).toBeDefined();
	});
});

describe("phaseConsumeAgentResult", () => {
	const pending = [
		{
			name: "gh",
			status: "installed" as const,
			version: "gh 2.86",
			method_used: "release archive",
			error: "",
		},
	];

	test("consumes the fallback batch and accepts an authoritative successful recheck", async () => {
		const phase = createPhaseConsumeAgentResult({
			checkPrerequisites: async () => ({
				status: "ok",
				os: darwin,
				tools: { gh: { found: true, version: "gh 2.86" } },
				missing: [],
			}),
		});
		const mock = mockIO(pending);
		await runPhase(phase, emptyState(), mock.io);
		expect(mock.calls.map((call) => call.method)).toEqual([
			"consumePendingBatchResults",
			"done",
		]);
		expect(mock.calls[1]).toMatchObject({
			method: "done",
			output: { ok: true, agent_result: { gh: pending[0] } },
		});
	});

	test("fails when the authoritative recheck still reports a missing tool", async () => {
		const phase = createPhaseConsumeAgentResult({
			checkPrerequisites: async () => ({
				status: "missing_tools",
				os: darwin,
				tools: { gh: { found: false, version: null } },
				missing: [{ name: "gh" }],
			}),
		});
		const mock = mockIO(pending);
		await runPhase(phase, emptyState(), mock.io);
		const failure = mock.calls.find((call) => call.method === "fail");
		expect(failure?.method).toBe("fail");
		if (failure?.method === "fail")
			expect(failure.error.message).toContain("gh");
	});
});
