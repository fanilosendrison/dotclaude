export interface HookInput {
	tool_name: string;
	tool_input: {
		command?: string;
	};
	session_id?: string;
}

export interface HookOutput {
	hookSpecificOutput: {
		hookEventName: string;
		permissionDecision: "allow" | "deny" | "ask";
		permissionDecisionReason: string;
	};
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}
