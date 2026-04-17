/** Parsed JSON from stdin, provided by Claude Code to hooks. */
export interface HookInput {
	tool_name: string;
	tool_input: Record<string, unknown>;
	session_id?: string;
	hook_event_name: "PreToolUse" | "PostToolUse";
	tool_use_id?: string;
	cwd?: string;
}

/** PreToolUse hook output — wraps decision in hookSpecificOutput. */
export interface PreToolUseOutput {
	hookSpecificOutput: {
		hookEventName: "PreToolUse";
		permissionDecision: "allow" | "deny" | "ask";
		permissionDecisionReason: string;
		additionalContext?: string;
	};
}

/** PostToolUse hook output — top-level decision (advisory). */
export interface PostToolUseOutput {
	decision?: "block";
	reason?: string;
	additionalContext?: string;
}
