import { AXIS_PATTERNS } from "../constants";
import type { AxisResult } from "../types";
import { computeAxisHash, globFiles } from "./shared";

export async function scanTests(cwd: string): Promise<AxisResult> {
	const files = await globFiles(cwd, AXIS_PATTERNS.tests);
	// Exclude .spec.md files (those are specs, not tests)
	const testOnly = files.filter((f) => !f.endsWith(".spec.md"));
	const hash = await computeAxisHash(cwd, testOnly);
	return { files: testOnly, count: testOnly.length, hash };
}
