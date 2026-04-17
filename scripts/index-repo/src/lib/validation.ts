import { CHARS_PER_TOKEN, TOKEN_WARNING_THRESHOLD } from "./constants";
import type { CrossReferenceMap, ScanResult, ValidationReport } from "./types";

/**
 * Validate index completeness: orphans, gaps, token budget.
 */
export function validateIndex(
	scan: ScanResult,
	crossRefs: CrossReferenceMap,
): ValidationReport {
	const specsWithFrontmatter = scan.specs.files.filter((s) => s.frontmatter);
	const specsWithoutFrontmatter = scan.specs.files
		.filter((s) => !s.frontmatter && !s.frontmatterError)
		.map((s) => s.path);
	const specsWithInvalidFrontmatter = scan.specs.files
		.filter((s) => !s.frontmatter && s.frontmatterError)
		.map((s) => ({ path: s.path, error: s.frontmatterError ?? "" }));

	// Code files not referenced by any spec
	const referencedCode = new Set<string>();
	for (const ref of crossRefs.values()) {
		for (const f of ref.implementedBy) referencedCode.add(f);
	}
	const orphanCodeFiles = scan.code.files.filter((f) => !referencedCode.has(f));

	// Specs that have no test coverage
	const specsWithoutTests: string[] = [];
	const specsWithoutCode: string[] = [];
	let specsWithTests = 0;

	for (const ref of crossRefs.values()) {
		if (ref.validatedBy.length === 0) specsWithoutTests.push(ref.specId);
		else specsWithTests++;
		if (ref.implementedBy.length === 0) specsWithoutCode.push(ref.specId);
	}

	const totalSpecs = specsWithFrontmatter.length;
	const testCoveragePct =
		totalSpecs > 0 ? Math.round((specsWithTests / totalSpecs) * 100) : 0;

	// Token estimate from scan output size
	const estimatedTokens = estimateOutputTokens(scan, crossRefs);
	const tokenWarning = estimatedTokens > TOKEN_WARNING_THRESHOLD;

	return {
		orphanCodeFiles,
		specsWithoutTests,
		specsWithoutCode,
		specsWithoutFrontmatter,
		specsWithInvalidFrontmatter,
		totalSpecs,
		specsWithTests,
		testCoveragePct,
		estimatedTokens,
		tokenWarning,
	};
}

/**
 * Rough token estimate of the final index output.
 * Based on: file counts × avg chars per entry + cross-ref blocks.
 */
function estimateOutputTokens(
	scan: ScanResult,
	crossRefs: CrossReferenceMap,
): number {
	// ~80 chars per file entry, ~200 chars per cross-ref block, ~500 chars overhead
	const fileChars = scan.totalFiles * 80;
	const crossRefChars = crossRefs.size * 200;
	const overhead = 500;
	return Math.ceil((fileChars + crossRefChars + overhead) / CHARS_PER_TOKEN);
}
