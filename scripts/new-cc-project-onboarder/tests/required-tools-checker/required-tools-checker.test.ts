import { test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  checkPrerequisites,
  renderHumanReport,
  type CheckResult,
} from "../../src/required-tools-checker/required-tools-checker";

const SCRIPT_PATH = join(
  import.meta.dir,
  "../../src/required-tools-checker/required-tools-checker.ts",
);

const REAL_CONFIG = join(
  import.meta.dir,
  "../../src/required-tools-checker/required-tools.json",
);

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "prereq-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeConfig(
  filename: string,
  tools: Array<{ name: string }>,
): Promise<string> {
  const path = join(tmpDir, filename);
  await writeFile(path, JSON.stringify({ tools }), "utf8");
  return path;
}

test("happy path: real config on darwin → status ok, all tools found", async () => {
  const result = await checkPrerequisites({ configPath: REAL_CONFIG, platform: "darwin" });

  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;

  expect(result.missing).toEqual([]);
  expect(result.tools.git.found).toBe(true);
  expect(result.tools.gh.found).toBe(true);

  if (result.tools.git.found) {
    expect(result.tools.git.version.length).toBeGreaterThan(0);
  }
});

test("missing tool: fake binary → status missing_tools, name propagated", async () => {
  const cfg = await writeConfig("only-fake.json", [{ name: "__fake_tool_xyz__" }]);

  const result = await checkPrerequisites({ configPath: cfg, platform: "darwin" });

  expect(result.status).toBe("missing_tools");
  if (result.status === "unsupported_platform") return;

  expect(result.missing.length).toBe(1);
  expect(result.missing[0]).toEqual({ name: "__fake_tool_xyz__" });
  expect(result.tools.__fake_tool_xyz__.found).toBe(false);
  expect(result.tools.__fake_tool_xyz__.version).toBeNull();
});

test("mix found/missing: git + fake → git found, fake missing", async () => {
  const cfg = await writeConfig("mix.json", [{ name: "git" }, { name: "__fake__" }]);

  const result = await checkPrerequisites({ configPath: cfg, platform: "darwin" });

  expect(result.status).toBe("missing_tools");
  if (result.status === "unsupported_platform") return;

  expect(result.tools.git.found).toBe(true);
  expect(result.tools.__fake__.found).toBe(false);
  expect(result.missing.length).toBe(1);
  expect(result.missing[0].name).toBe("__fake__");
});

test("non-darwin platform → status unsupported_platform, no tools/missing fields", async () => {
  const result = await checkPrerequisites({ configPath: REAL_CONFIG, platform: "linux" });

  expect(result.status).toBe("unsupported_platform");
  expect(result.os.platform).toBe("linux");
  expect(result.os.label).toBe(`linux ${result.os.arch}`);
  expect("tools" in result).toBe(false);
  expect("missing" in result).toBe(false);
});

test("JSON contract: required keys present in happy path", async () => {
  const result = await checkPrerequisites({ configPath: REAL_CONFIG, platform: "darwin" });

  expect(result).toHaveProperty("status");
  expect(result).toHaveProperty("os.platform");
  expect(result).toHaveProperty("os.arch");
  expect(result).toHaveProperty("os.label");

  if (result.status === "ok" || result.status === "missing_tools") {
    expect(result).toHaveProperty("tools");
    expect(result).toHaveProperty("missing");
    expect(Array.isArray(result.missing)).toBe(true);
  }
});

test("renderHumanReport: ok status renders ✅ marker, OS label, and version table", () => {
  const result: CheckResult = {
    status: "ok",
    os: { platform: "darwin", arch: "arm64", label: "darwin arm64" },
    tools: { git: { found: true, version: "git version 2.42.0" } },
    missing: [],
  };

  const out = renderHumanReport(result);

  expect(out).toContain("✅");
  expect(out).toContain("darwin arm64");
  expect(out).toContain("| git | git version 2.42.0 |");
  expect(out).not.toContain("Manquants");
});

test("renderHumanReport: missing_tools renders ❌ marker and missing tool list", () => {
  const result: CheckResult = {
    status: "missing_tools",
    os: { platform: "darwin", arch: "arm64", label: "darwin arm64" },
    tools: {
      git: { found: true, version: "git version 2.42.0" },
      gh: { found: false, version: null },
    },
    missing: [{ name: "gh" }],
  };

  const out = renderHumanReport(result);

  expect(out).toContain("❌");
  expect(out).toContain("Trouvés");
  expect(out).toContain("| git | git version 2.42.0 |");
  expect(out).toContain("Manquants");
  expect(out).toContain("- gh");
});

test("renderHumanReport: unsupported_platform renders ⚠️ marker, label, and macOS-only mention", () => {
  const result: CheckResult = {
    status: "unsupported_platform",
    os: { platform: "linux", arch: "x64", label: "linux x64" },
  };

  const out = renderHumanReport(result);

  expect(out).toContain("⚠️");
  expect(out).toContain("linux x64");
  expect(out).toContain("darwin");
});

test("CLI smoke: default invocation outputs human report on stdout (contains a status marker)", () => {
  const proc = Bun.spawnSync({
    cmd: ["bun", SCRIPT_PATH],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(proc.stdout);

  expect(stdout).toMatch(/[✅❌⚠️]/);
  expect(() => JSON.parse(stdout)).toThrow();
});

test("CLI smoke: --format json outputs parseable JSON with status field", () => {
  const proc = Bun.spawnSync({
    cmd: ["bun", SCRIPT_PATH, "--format", "json"],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(proc.stdout);
  const parsed = JSON.parse(stdout);

  expect(parsed).toHaveProperty("status");
  expect(["ok", "missing_tools", "unsupported_platform"]).toContain(parsed.status);
});

test("CLI smoke: --format with invalid value exits with code 2 and writes to stderr", () => {
  const proc = Bun.spawnSync({
    cmd: ["bun", SCRIPT_PATH, "--format", "yaml"],
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(proc.exitCode).toBe(2);
  const stderr = new TextDecoder().decode(proc.stderr);
  expect(stderr).toContain("--format");
  expect(stderr).toContain("yaml");
});
