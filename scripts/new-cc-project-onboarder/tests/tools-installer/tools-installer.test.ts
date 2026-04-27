import { describe, expect, test } from "bun:test";
import {
	type InstallResult,
	type InstallResults,
	installTools,
	shellCmd,
	type ToolConfig,
} from "../../src/tools-installer/tools-installer";

// Helper: deterministic verify mock that decodes a code from the tool name.
// Convention used in this test file:
//   - tool name ending in "-okverify"   → verify exit=0, version="vX"
//   - tool name ending in "-failverify" → verify exit=1
//   - else                              → verify exit=0, version=`<name> 1.0`
function makeVerify(): NonNullable<
	Parameters<typeof installTools>[1]
>["verify"] {
	return async (toolName: string) => {
		if (toolName.endsWith("-failverify")) {
			return { exit_code: 1, stdout: "" };
		}
		return { exit_code: 0, stdout: `${toolName} 1.0` };
	};
}

describe("installTools (multi-method)", () => {
	test("empty list returns empty result map", async () => {
		const results: InstallResults = await installTools([], { verify: makeVerify() });
		expect(results).toEqual({});
	});

	test("single method, install OK + verify OK → ok=true, 1 attempt", async () => {
		const tools: ToolConfig[] = [
			{
				name: "alpha",
				methods: [{ id: "primary", run: shellCmd("echo installed") }],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		const r: InstallResult = results.alpha;
		expect(r.ok).toBe(true);
		expect(r.attempts).toHaveLength(1);
		expect(r.attempts[0].id).toBe("primary");
		expect(r.attempts[0].ok).toBe(true);
		expect(r.attempts[0].exit_code).toBe(0);
		expect(r.attempts[0].verify_exit_code).toBe(0);
		expect(r.successful_method_id).toBe("primary");
		expect(r.version).toBe("alpha 1.0");
	});

	test("single method, install fails → ok=false, 1 attempt, verify NOT attempted", async () => {
		const tools: ToolConfig[] = [
			{
				name: "beta",
				methods: [{ id: "broken", run: shellCmd("false") }],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		const r = results.beta;
		expect(r.ok).toBe(false);
		expect(r.attempts).toHaveLength(1);
		expect(r.attempts[0].id).toBe("broken");
		expect(r.attempts[0].ok).toBe(false);
		expect(r.attempts[0].exit_code).not.toBe(0);
		expect(r.attempts[0].verify_exit_code).toBeUndefined();
		expect(r.successful_method_id).toBeUndefined();
		expect(r.version).toBeUndefined();
	});

	test("single method, install OK but verify fails → ok=false, attempt records both", async () => {
		const tools: ToolConfig[] = [
			{
				name: "gamma-failverify",
				methods: [{ id: "looks-ok", run: shellCmd("echo installed") }],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		const r = results["gamma-failverify"];
		expect(r.ok).toBe(false);
		expect(r.attempts).toHaveLength(1);
		expect(r.attempts[0].ok).toBe(false);
		expect(r.attempts[0].exit_code).toBe(0);
		expect(r.attempts[0].verify_exit_code).not.toBe(0);
	});

	test("2 methods, first install fails, second OK → ok=true, 2 attempts in order", async () => {
		const tools: ToolConfig[] = [
			{
				name: "delta",
				methods: [
					{ id: "doomed", run: shellCmd("echo 'boom' >&2; exit 1") },
					{ id: "savior", run: shellCmd("echo installed") },
				],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		const r = results.delta;
		expect(r.ok).toBe(true);
		expect(r.attempts).toHaveLength(2);
		expect(r.attempts.map((a) => a.id)).toEqual(["doomed", "savior"]);
		expect(r.attempts[0].ok).toBe(false);
		expect(r.attempts[0].stderr).toContain("boom");
		expect(r.attempts[1].ok).toBe(true);
		expect(r.successful_method_id).toBe("savior");
	});

	test("2 methods, first install OK but verify fails, second OK → retried on subtle failure", async () => {
		// Use distinct tool names per attempt so the verify mock can produce different outcomes
		const tools: ToolConfig[] = [
			{
				name: "epsilon",
				methods: [
					{
						id: "fake-success",
						run: shellCmd("echo installed-but-not-really"),
					},
					{ id: "real", run: shellCmd("echo installed") },
				],
			},
		];

		// Custom verify: fails on first call, succeeds on second
		let verifyCalls = 0;
		const verify: NonNullable<
			Parameters<typeof installTools>[1]
		>["verify"] = async () => {
			verifyCalls++;
			if (verifyCalls === 1) return { exit_code: 1, stdout: "" };
			return { exit_code: 0, stdout: "epsilon 2.0" };
		};

		const results = await installTools(tools, { verify });

		const r = results.epsilon;
		expect(r.ok).toBe(true);
		expect(r.attempts).toHaveLength(2);
		expect(r.attempts[0].ok).toBe(false);
		expect(r.attempts[0].exit_code).toBe(0);
		expect(r.attempts[0].verify_exit_code).toBe(1);
		expect(r.attempts[1].ok).toBe(true);
		expect(r.successful_method_id).toBe("real");
		expect(r.version).toBe("epsilon 2.0");
	});

	test("all methods exhausted → ok=false, attempts contains every method tried in order", async () => {
		const tools: ToolConfig[] = [
			{
				name: "zeta",
				methods: [
					{ id: "m1", run: shellCmd("false") },
					{ id: "m2", run: shellCmd("false") },
					{ id: "m3", run: shellCmd("false") },
				],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		const r = results.zeta;
		expect(r.ok).toBe(false);
		expect(r.attempts).toHaveLength(3);
		expect(r.attempts.map((a) => a.id)).toEqual(["m1", "m2", "m3"]);
		for (const a of r.attempts) {
			expect(a.ok).toBe(false);
		}
		expect(r.successful_method_id).toBeUndefined();
	});

	test("first method succeeds → stops early, no waste on subsequent methods", async () => {
		let m2Called = false;
		const tools: ToolConfig[] = [
			{
				name: "eta",
				methods: [
					{ id: "fast-win", run: shellCmd("echo installed") },
					{
						id: "should-not-run",
						run: async () => {
							m2Called = true;
							return { exit_code: 0, stdout: "", stderr: "" };
						},
					},
				],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		expect(results.eta.ok).toBe(true);
		expect(results.eta.attempts).toHaveLength(1);
		expect(m2Called).toBe(false);
	});

	test("multiple tools: parallel, results indexed by name, each tool independent", async () => {
		const tools: ToolConfig[] = [
			{
				name: "tool-a",
				methods: [{ id: "ok", run: shellCmd("echo ok-a") }],
			},
			{
				name: "tool-b",
				methods: [
					{ id: "fail", run: shellCmd("false") },
					{ id: "ok", run: shellCmd("echo ok-b") },
				],
			},
			{
				name: "tool-c",
				methods: [{ id: "always-fail", run: shellCmd("false") }],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		expect(Object.keys(results).sort()).toEqual(["tool-a", "tool-b", "tool-c"]);
		expect(results["tool-a"].ok).toBe(true);
		expect(results["tool-a"].attempts).toHaveLength(1);
		expect(results["tool-b"].ok).toBe(true);
		expect(results["tool-b"].attempts).toHaveLength(2);
		expect(results["tool-b"].successful_method_id).toBe("ok");
		expect(results["tool-c"].ok).toBe(false);
		expect(results["tool-c"].attempts).toHaveLength(1);
	});

	test("custom verify dep is honored (defaults are not used when override provided)", async () => {
		const tools: ToolConfig[] = [
			{
				name: "iota",
				methods: [{ id: "p", run: shellCmd("echo done") }],
			},
		];

		const customVerify: NonNullable<
			Parameters<typeof installTools>[1]
		>["verify"] = async () => ({ exit_code: 0, stdout: "iota custom-version-7" });

		const results = await installTools(tools, { verify: customVerify });

		expect(results.iota.ok).toBe(true);
		expect(results.iota.version).toBe("iota custom-version-7");
	});

	test("shellCmd helper interprets via shell (pipes work)", async () => {
		const tools: ToolConfig[] = [
			{
				name: "kappa",
				methods: [
					{
						id: "piped",
						run: shellCmd("echo hello | tr '[:lower:]' '[:upper:]'"),
					},
				],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		expect(results.kappa.ok).toBe(true);
		expect(results.kappa.attempts[0].stdout).toContain("HELLO");
	});

	test("attempt captures stderr of failed install command", async () => {
		const tools: ToolConfig[] = [
			{
				name: "lambda",
				methods: [
					{
						id: "verbose-fail",
						run: shellCmd("echo 'specific failure reason' >&2; exit 7"),
					},
				],
			},
		];

		const results = await installTools(tools, { verify: makeVerify() });

		const a = results.lambda.attempts[0];
		expect(a.ok).toBe(false);
		expect(a.exit_code).toBe(7);
		expect(a.stderr).toContain("specific failure reason");
	});
});
