import { scanCode } from "./axes/code";
import { scanConfig } from "./axes/config";
import { scanScripts } from "./axes/scripts";
import { scanSpecs } from "./axes/specs";
import { scanTests } from "./axes/tests";
import type { ScanResult } from "./types";

/**
 * Scan project across 5 axes in parallel.
 * Each axis is independent — no cross-dependencies.
 */
export async function scanProject(cwd: string): Promise<ScanResult> {
	const [code, specs, config, tests, scripts] = await Promise.all([
		scanCode(cwd),
		scanSpecs(cwd),
		scanConfig(cwd),
		scanTests(cwd),
		scanScripts(cwd),
	]);

	const totalFiles =
		code.count + specs.count + config.count + tests.count + scripts.count;

	return { code, specs, config, tests, scripts, totalFiles };
}
