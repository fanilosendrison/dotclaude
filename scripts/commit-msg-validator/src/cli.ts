#!/usr/bin/env bun

import type { HookInput, HookOutput } from "./lib/types";
import {
	extractCommitMessage,
	isGitCommit,
	validateCommitMessage,
} from "./lib/validator";

async function main() {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}

	const input = Buffer.concat(chunks).toString();
	if (!input.trim()) {
		process.exit(0);
	}

	let hookData: HookInput;
	try {
		hookData = JSON.parse(input);
	} catch {
		process.exit(0);
	}

	// Only intercept Bash tool
	if (hookData.tool_name !== "Bash") {
		process.exit(0);
	}

	const command = hookData.tool_input?.command;
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

	const hookOutput: HookOutput = {
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
