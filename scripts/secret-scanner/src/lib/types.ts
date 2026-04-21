// HookInput and PreToolUseOutput are now imported from hook-utils (single source of truth).
// See ../../hook-utils/src/types.ts for the canonical definitions.

export interface ScanResult {
	clean: boolean;
	findings: Finding[];
}

export interface Finding {
	name: string;
	line: string;
	lineNumber: number;
}
