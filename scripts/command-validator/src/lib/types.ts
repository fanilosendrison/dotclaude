// HookInput and PreToolUseOutput are now imported from hook-utils (single source of truth).
// See ../../hook-utils/src/types.ts for the canonical definitions.

export interface ValidationResult {
	isValid: boolean;
	severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
	violations: string[];
	sanitizedCommand: string;
	action: "allow" | "deny" | "ask";
}

export interface SecurityRules {
	CRITICAL_COMMANDS: string[];
	PRIVILEGE_COMMANDS: string[];
	NETWORK_COMMANDS: string[];
	SYSTEM_COMMANDS: string[];
	DANGEROUS_PATTERNS: RegExp[];
	PROTECTED_PATHS: string[];
	SAFE_EXECUTABLE_PATHS: string[];
	SAFE_RM_PATHS: string[];
}
