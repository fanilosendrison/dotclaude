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

export interface ScanResult {
	clean: boolean;
	findings: Finding[];
}

export interface Finding {
	name: string;
	line: string;
	lineNumber: number;
}
