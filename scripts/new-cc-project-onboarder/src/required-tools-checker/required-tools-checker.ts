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

  const raw: unknown = await Bun.file(opts.configPath).json();
  if (
    raw === null ||
    typeof raw !== "object" ||
    !("tools" in raw) ||
    !Array.isArray((raw as Record<string, unknown>).tools)
  ) {
    throw new Error(
      `Invalid config at ${opts.configPath}: expected { tools: Array<{ name, install_command }> }`,
    );
  }
  const config = raw as ToolsConfig;

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

export function renderHumanReport(result: CheckResult): string {
  if (result.status === "unsupported_platform") {
    return [
      `⚠️  Plateforme non supportée : ${result.os.label}`,
      `required-tools-checker ne couvre que macOS (\`darwin\`).`,
    ].join("\n");
  }

  const header =
    result.status === "ok"
      ? `✅ Required tools — tous présents (${result.os.label})`
      : `❌ Required tools — outils manquants (${result.os.label})`;

  const lines: string[] = [header, ""];

  const foundEntries = Object.entries(result.tools).filter(
    (entry): entry is [string, { found: true; version: string }] => entry[1].found,
  );

  if (foundEntries.length > 0) {
    lines.push("**Trouvés**", "", "| Tool | Version |", "|------|---------|");
    for (const [name, status] of foundEntries) {
      lines.push(`| ${name} | ${status.version} |`);
    }
    lines.push("");
  }

  if (result.missing.length > 0) {
    lines.push("**Manquants**", "", "| Tool | Install command |", "|------|-----------------|");
    for (const m of result.missing) {
      lines.push(`| ${m.name} | \`${m.install_command}\` |`);
    }
  }

  return lines.join("\n").trimEnd();
}

type Format = "human" | "json";

function parseFormat(argv: string[]): Format {
  const idx = argv.indexOf("--format");
  if (idx === -1) return "human";
  const value = argv[idx + 1];
  if (value !== "human" && value !== "json") {
    process.stderr.write(
      `error: --format expects "human" or "json", got ${value === undefined ? "(missing)" : `"${value}"`}\n`,
    );
    process.exit(2);
  }
  return value;
}

if (import.meta.main) {
  const format = parseFormat(process.argv.slice(2));
  const result = await checkPrerequisites({
    configPath: join(import.meta.dir, "required-tools.json"),
    platform: process.platform,
  });
  const output =
    format === "json" ? JSON.stringify(result, null, 2) : renderHumanReport(result);
  process.stdout.write(output + "\n");
  process.exit(result.status === "ok" ? 0 : 1);
}
