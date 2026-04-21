#!/usr/bin/env bun

import { readHookInput } from "../../hook-utils/src/index";
import type { HookInput, PreToolUseOutput } from "../../hook-utils/src/types";
import { scanDiff } from "./lib/scanner";

/**
 * Checks if a command is a git commit (the point where secrets get persisted).
 */
function isGitCommit(command: string): boolean {
	return /\bgit\s+commit\b/.test(command);
}

/**
 * Runs `git diff --cached` to get the staged diff.
 * Returns the diff output or null if it fails.
 */
async function getStagedDiff(): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", "diff", "--cached", "--diff-filter=ACMR"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		return output;
	} catch {
		return null;
	}
}

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

	const diff = await getStagedDiff();

	// Can't get diff (not in a git repo, etc.) → let it through
	if (diff === null) {
		process.exit(0);
	}

	const result = scanDiff(diff);

	if (result.clean) {
		const hookOutput = {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow" as const,
				permissionDecisionReason:
					"[secret-scanner] ✅ aucun secret dans le diff staged",
				additionalContext:
					"[secret-scanner] ✅ aucun secret détecté dans le diff staged",
			},
		};
		console.log(JSON.stringify(hookOutput));
		process.exit(0);
	}

	const reason = [
		"Secrets détectés dans les fichiers staged :",
		"",
		...result.findings.map(
			(f) => `  [${f.name}] ligne ${f.lineNumber}: ${f.line.substring(0, 80)}`,
		),
		"",
		"Retirer les secrets du staging avant de committer.",
		"Utiliser .gitignore ou .env pour les données sensibles.",
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
	console.error("secret-scanner error:", error);
	process.exit(2);
});
