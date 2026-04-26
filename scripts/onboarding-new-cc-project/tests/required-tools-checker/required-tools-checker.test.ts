import { test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { checkPrerequisites } from "../../src/required-tools-checker/required-tools-checker";

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
  tools: Array<{ name: string; install_command: string }>,
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
  expect(result.tools.bun.found).toBe(true);

  if (result.tools.git.found) {
    expect(result.tools.git.version.length).toBeGreaterThan(0);
  }
});

test("missing tool: fake binary → status missing_tools, install_command propagated", async () => {
  const cfg = await writeConfig("only-fake.json", [
    { name: "__fake_tool_xyz__", install_command: "echo install fake" },
  ]);

  const result = await checkPrerequisites({ configPath: cfg, platform: "darwin" });

  expect(result.status).toBe("missing_tools");
  if (result.status === "unsupported_platform") return;

  expect(result.missing.length).toBe(1);
  expect(result.missing[0]).toEqual({
    name: "__fake_tool_xyz__",
    install_command: "echo install fake",
  });
  expect(result.tools.__fake_tool_xyz__.found).toBe(false);
  expect(result.tools.__fake_tool_xyz__.version).toBeNull();
});

test("mix found/missing: git + fake → git found, fake missing", async () => {
  const cfg = await writeConfig("mix.json", [
    { name: "git", install_command: "noop" },
    { name: "__fake__", install_command: "echo install fake" },
  ]);

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
