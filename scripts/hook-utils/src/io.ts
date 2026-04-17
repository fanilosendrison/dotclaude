import type {
	HookInput,
	PostToolUseOutput,
	PreToolUseOutput,
} from "./types.ts";

/** Current hook event name, set after readHookInput(). */
let currentEventName: "PreToolUse" | "PostToolUse" | null = null;

/** Read stdin, parse JSON, return HookInput. Exit 0 on invalid input (fail-open). */
export async function readHookInput(): Promise<HookInput> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}

	const raw = Buffer.concat(chunks).toString();
	if (!raw.trim()) {
		process.exit(0);
	}

	let parsed: HookInput;
	try {
		parsed = JSON.parse(raw) as HookInput;
	} catch {
		process.exit(0);
	}

	currentEventName = parsed.hook_event_name ?? null;
	return parsed;
}

/** Allow the tool call. PreToolUse → JSON "allow". PostToolUse → additionalContext or silent exit. */
export function allow(reason: string, additionalContext?: string): never {
	if (currentEventName === "PreToolUse") {
		const output: PreToolUseOutput = {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow",
				permissionDecisionReason: reason,
				...(additionalContext ? { additionalContext } : {}),
			},
		};
		console.log(JSON.stringify(output));
	} else if (additionalContext) {
		const output: PostToolUseOutput = { additionalContext };
		console.log(JSON.stringify(output));
	}
	// PostToolUse sans additionalContext → silent exit
	process.exit(0);
}

/** Block the tool call. PreToolUse → JSON "deny". PostToolUse → JSON block (advisory). */
export function deny(reason: string): never {
	if (currentEventName === "PreToolUse") {
		const output: PreToolUseOutput = {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		};
		console.log(JSON.stringify(output));
	} else {
		const output: PostToolUseOutput = { decision: "block", reason };
		console.log(JSON.stringify(output));
	}
	process.exit(0);
}

/** Ask the user for confirmation. PreToolUse only. */
export function ask(reason: string): never {
	if (currentEventName !== "PreToolUse") {
		// ask() has no meaning for PostToolUse — silent exit
		process.exit(0);
	}
	const output: PreToolUseOutput = {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "ask",
			permissionDecisionReason: reason,
		},
	};
	console.log(JSON.stringify(output));
	process.exit(0);
}

/** Silent exit, zero output. */
export function skip(): never {
	process.exit(0);
}
