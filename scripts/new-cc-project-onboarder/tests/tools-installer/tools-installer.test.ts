import { describe, expect, test } from "bun:test";
import {
	installTools,
	type InstallResult,
	type InstallResults,
	type MissingTool,
} from "../../src/tools-installer/tools-installer";

describe("installTools", () => {
	test("empty list returns empty result map", async () => {
		const results: InstallResults = await installTools([]);
		expect(results).toEqual({});
	});

	test("passing install command returns ok=true, exit_code=0, captures stdout", async () => {
		const missing: MissingTool[] = [
			{ name: "fake-ok", install_command: "echo installed-ok" },
		];

		const results = await installTools(missing);

		expect(results["fake-ok"]).toBeDefined();
		const r: InstallResult = results["fake-ok"];
		expect(r.ok).toBe(true);
		expect(r.exit_code).toBe(0);
		expect(r.stdout).toContain("installed-ok");
		expect(r.stderr).toBe("");
	});

	test("failing install command returns ok=false with non-zero exit_code", async () => {
		const missing: MissingTool[] = [
			{ name: "fake-fail", install_command: "false" },
		];

		const results = await installTools(missing);

		const r = results["fake-fail"];
		expect(r.ok).toBe(false);
		expect(r.exit_code).not.toBe(0);
	});

	test("captures stderr from a failing install command", async () => {
		const missing: MissingTool[] = [
			{
				name: "fake-stderr",
				install_command: "echo 'install error message' >&2; exit 7",
			},
		];

		const results = await installTools(missing);

		const r = results["fake-stderr"];
		expect(r.ok).toBe(false);
		expect(r.exit_code).toBe(7);
		expect(r.stderr).toContain("install error message");
	});

	test("multiple tools: one result per tool, indexed by name", async () => {
		const missing: MissingTool[] = [
			{ name: "alpha", install_command: "echo alpha-installed" },
			{ name: "beta", install_command: "false" },
			{ name: "gamma", install_command: "echo gamma-installed" },
		];

		const results = await installTools(missing);

		expect(Object.keys(results).sort()).toEqual(["alpha", "beta", "gamma"]);
		expect(results["alpha"].ok).toBe(true);
		expect(results["beta"].ok).toBe(false);
		expect(results["gamma"].ok).toBe(true);
	});

	test("install_command interpreted by shell (pipes work)", async () => {
		const missing: MissingTool[] = [
			{
				name: "shell-pipe",
				install_command: "echo hello | tr '[:lower:]' '[:upper:]'",
			},
		];

		const results = await installTools(missing);

		const r = results["shell-pipe"];
		expect(r.ok).toBe(true);
		expect(r.stdout).toContain("HELLO");
	});
});
