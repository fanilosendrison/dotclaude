import { AXIS_PATTERNS } from "../constants";
import type { AxisResult } from "../types";
import { computeAxisHash, globFiles } from "./shared";

export async function scanConfig(cwd: string): Promise<AxisResult> {
	const files = await globFiles(cwd, AXIS_PATTERNS.config);
	const hash = await computeAxisHash(cwd, files);
	return { files, count: files.length, hash };
}
