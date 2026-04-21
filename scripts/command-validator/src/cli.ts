#!/usr/bin/env bun

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readHookInput } from "../../hook-utils/src/index";
import type { HookInput, PreToolUseOutput } from "../../hook-utils/src/types";
import { CommandValidator } from "./lib/validator";

const LOG_FILE = join(import.meta.dir, "../data/security.log");

async function logSecurityEvent(
	command: string,
	toolName: string,
	result: { isValid: boolean; severity: string; violations: string[] },
	sessionId: string | null,
) {
	const timestamp = new Date().toISOString();
	const logEntry = {
		timestamp,
		sessionId,
		toolName,
		command: command.substring(0, 500),
		blocked: !result.isValid,
		severity: result.severity,
		violations: result.violations,
		source: "claude-code-hook",
	};

	try {
		const logLine = `${JSON.stringify(logEntry)}\n`;
		await mkdir(dirname(LOG_FILE), { recursive: true });
		await appendFile(LOG_FILE, logLine);

		console.error(
			`[SECURITY] ${result.isValid ? "ALLOWED" : "BLOCKED"}: ${command.substring(0, 100)}`,
		);
	} catch (error) {
		console.error("Failed to write security log:", error);
	}
}

async function main() {
	const validator = new CommandValidator();

	try {
		const hookData: HookInput = await readHookInput();

		const toolName = hookData.tool_name || "Unknown";
		const toolInput = hookData.tool_input || {};
		const sessionId = hookData.session_id || null;

		if (toolName !== "Bash") {
			console.log(`Skipping validation for tool: ${toolName}`);
			process.exit(0);
		}

		const command = toolInput.command as string | undefined;
		if (!command) {
			console.error("No command found in tool input");
			process.exit(1);
		}

		const result = validator.validate(command, toolName);

		await logSecurityEvent(command, toolName, result, sessionId);

		if (result.isValid) {
			console.log("Command validation passed");
			process.exit(0);
		}

		const message =
			result.action === "deny"
				? `Command blocked!\n\nCommand: ${command}\nReason: ${result.violations.join(", ")}\nSeverity: ${result.severity}`
				: `⚠️ Potentially dangerous command\n\nCommand: ${command}\nReason: ${result.violations.join(", ")}\nSeverity: ${result.severity}\n\nDo you want to proceed?`;

		const hookOutput: PreToolUseOutput = {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: result.action === "deny" ? "deny" : "ask",
				permissionDecisionReason: message,
			},
		};

		console.log(JSON.stringify(hookOutput));
		process.exit(0);
	} catch (error) {
		console.error("Validation script error:", error);
		process.exit(2);
	}
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(2);
});
