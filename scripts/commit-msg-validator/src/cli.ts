#!/usr/bin/env bun

import { readHookInput } from "../../hook-utils/src/index";
import type { HookInput, PreToolUseOutput } from "../../hook-utils/src/types";
import {
	extractCommitMessage,
	isGitCommit,
	validateCommitMessage,
} from "./lib/validator";

async function main() {
	const hookData: HookInput = await readHookInput();

	// Only intercept Bash tool
	if (hookData.tool_name !== "Bash") {
		process.exit(0);
	}

	const command = hookData.tool_input?.command as string | undefined;
	if (!command || !isGitCommit(command)) {
		process.exit(0);
	}

	const message = extractCommitMessage(command);

	// No -m flag → editor-based commit, can't validate
	if (!message) {
		process.exit(0);
	}

	const result = validateCommitMessage(message);

	if (result.valid) {
		const hookOutput = {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow" as const,
				permissionDecisionReason: `[commit-msg-validator] ✅ "${message}"`,
				additionalContext: `[commit-msg-validator] ✅ commit message conforme : "${message}"`,
			},
		};
		console.log(JSON.stringify(hookOutput));
		process.exit(0);
	}

	const reason = [
		"Commit message invalide :",
		"",
		`  "${message}"`,
		"",
		...result.errors.map((e) => `  - ${e}`),
		"",
		"Format attendu: <type>(<scope>): <description>",
	].join("\n");

	const hookOutput: PreToolUseOutput = {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: reason,
		},
	};

	console.log(JSON.stringify(hookOutput));
	process.exit(0);
}

main().catch((error) => {
	console.error("commit-msg-validator error:", error);
	process.exit(2);
});
