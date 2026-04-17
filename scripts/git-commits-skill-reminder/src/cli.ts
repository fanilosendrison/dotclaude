#!/usr/bin/env bun

interface HookInput {
	tool_name: string;
	tool_input: {
		command?: string;
	};
}

const GIT_COMMIT_PATTERN = /\bgit\s+commit\b/;

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

	if (hookData.tool_name !== "Bash") {
		process.exit(0);
	}

	const command = hookData.tool_input?.command;
	if (!command || !GIT_COMMIT_PATTERN.test(command)) {
		process.exit(0);
	}

	// Non-blocking reminder injected into context
	const hookOutput = {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow" as const,
			permissionDecisionReason: "[git-commits-push-skill] rappel contextuel",
			additionalContext:
				"[git-commits-push-skill] CRITICAL REMINDER : Le skill /git-commits-push doit avoir été invoqué (Skill tool) dans cette conversation AVANT de committer. Si ce n'est pas fait, annule ce commit et invoque /git-commits-push d'abord.",
		},
	};

	console.log(JSON.stringify(hookOutput));
	process.exit(0);
}

main().catch((error) => {
	console.error("git-commits-push-skill-reminder error:", error);
	process.exit(2);
});
