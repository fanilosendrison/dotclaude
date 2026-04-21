// HookInput and PreToolUseOutput are now imported from hook-utils (single source of truth).
// See ../../hook-utils/src/types.ts for the canonical definitions.

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}
