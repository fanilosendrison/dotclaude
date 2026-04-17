import { AXIS_PATTERNS } from "../constants";
import type { AxisResult } from "../types";
import { computeAxisHash, globFiles } from "./shared";

export async function scanCode(cwd: string): Promise<AxisResult> {
	const files = await globFiles(cwd, AXIS_PATTERNS.code);
	// Exclude test files that might match code patterns
	const codeOnly = files.filter(
		(f) =>
			!f.includes(".test.") &&
			!f.includes(".spec.") &&
			!f.startsWith("tests/") &&
			!f.startsWith("test/") &&
			!f.includes("__tests__/"),
	);
	const hash = await computeAxisHash(cwd, codeOnly);
	return { files: codeOnly, count: codeOnly.length, hash };
}
