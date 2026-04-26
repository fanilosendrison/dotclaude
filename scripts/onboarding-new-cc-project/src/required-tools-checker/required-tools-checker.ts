#!/usr/bin/env bun

import { arch as nodeArch } from "node:os";
import { join } from "node:path";

export type ToolStatus = { found: true; version: string } | { found: false; version: null };
export type MissingTool = { name: string; install_command: string };
export type ToolsConfig = { tools: Array<{ name: string; install_command: string }> };

export type CheckResult =
  | {
      status: "ok" | "missing_tools";
      os: { platform: string; arch: string; label: string };
      tools: Record<string, ToolStatus>;
      missing: MissingTool[];
    }
  | {
      status: "unsupported_platform";
      os: { platform: string; arch: string; label: string };
    };

export async function checkPrerequisites(opts: {
  configPath: string;
  platform: string;
}): Promise<CheckResult> {
  const archResolved = nodeArch();

  if (opts.platform !== "darwin") {
    return {
      status: "unsupported_platform",
      os: { platform: opts.platform, arch: archResolved, label: `${opts.platform} ${archResolved}` },
    };
  }

  const config: ToolsConfig = await Bun.file(opts.configPath).json();

  const tools: Record<string, ToolStatus> = {};
  const missing: MissingTool[] = [];

  for (const tool of config.tools) {
    const binPath = Bun.which(tool.name);

    if (binPath === null) {
      tools[tool.name] = { found: false, version: null };
      missing.push({ name: tool.name, install_command: tool.install_command });
      continue;
    }

    const proc = Bun.spawnSync({
      cmd: [binPath, "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });

    if (proc.exitCode === 0) {
      const version = new TextDecoder().decode(proc.stdout).split("\n")[0].trim();
      tools[tool.name] = { found: true, version };
    } else {
      tools[tool.name] = { found: false, version: null };
      missing.push({ name: tool.name, install_command: tool.install_command });
    }
  }

  return {
    status: missing.length === 0 ? "ok" : "missing_tools",
    os: { platform: "darwin", arch: archResolved, label: `darwin ${archResolved}` },
    tools,
    missing,
  };
}

if (import.meta.main) {
  const result = await checkPrerequisites({
    configPath: join(import.meta.dir, "required-tools.json"),
    platform: process.platform,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.status === "ok" ? 0 : 1);
}
