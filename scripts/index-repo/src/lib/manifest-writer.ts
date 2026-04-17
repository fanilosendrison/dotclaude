import type {
	CrossReference,
	CrossReferenceMap,
	ScanResult,
	ValidationReport,
} from "./types";

/**
 * Generate SPEC_MANIFEST.md content. 100% deterministic — same input → same output.
 */
export function generateManifest(
	scan: ScanResult,
	crossRefs: CrossReferenceMap,
	validation: ValidationReport,
	gitRef: string,
): string {
	const lines: string[] = [];
	const now = new Date().toISOString().split("T")[0];

	// Header
	lines.push("# Spec Manifest");
	lines.push("");
	lines.push(`> Git ref: ${gitRef.slice(0, 7)} | Generated: ${now}`);
	lines.push(
		`> Specs: ${validation.totalSpecs} | With tests: ${validation.specsWithTests} (${validation.testCoveragePct}%) | Gaps: ${validation.specsWithoutTests.length}`,
	);

	// Specs without frontmatter warning
	if (validation.specsWithoutFrontmatter.length > 0) {
		lines.push("");
		lines.push(
			`> **Warning**: ${validation.specsWithoutFrontmatter.length} spec file(s) without frontmatter: ${validation.specsWithoutFrontmatter.join(", ")}`,
		);
	}

	// Specs with invalid frontmatter warning (block exists but schema validation failed)
	if (validation.specsWithInvalidFrontmatter.length > 0) {
		lines.push("");
		lines.push(
			`> **Warning**: ${validation.specsWithInvalidFrontmatter.length} spec file(s) with invalid frontmatter (run /specs-serializer to auto-repair):`,
		);
		for (const { path, error } of validation.specsWithInvalidFrontmatter) {
			lines.push(`> - ${path} — ${error}`);
		}
	}

	lines.push("");
	lines.push("---");

	// Spec blocks sorted by ID
	const refs = [...crossRefs.values()].sort((a, b) =>
		a.specId.localeCompare(b.specId, undefined, { numeric: true }),
	);

	for (const ref of refs) {
		lines.push("");
		lines.push(formatSpecBlock(ref));
	}

	// Specs without frontmatter (appendix)
	const noFront = scan.specs.files.filter((s) => !s.frontmatter);
	if (noFront.length > 0) {
		lines.push("");
		lines.push("---");
		lines.push("");
		lines.push("## Unindexed Specs (no valid frontmatter)");
		lines.push("");
		for (const s of noFront) {
			const heading = s.firstHeading ?? "(no heading)";
			const reason = s.frontmatterError
				? ` — _invalid: ${s.frontmatterError}_`
				: "";
			lines.push(`- **${s.path}** — ${heading}${reason}`);
		}
	}

	lines.push("");
	return lines.join("\n");
}

function formatSpecBlock(ref: CrossReference): string {
	const lines: string[] = [];
	const specName = ref.specPath.split("/").pop() ?? ref.specPath;

	lines.push(`### ${ref.specId} — ${specName} (v${ref.specVersion})`);

	if (ref.scope) {
		lines.push(`- **Scope**: ${ref.scope}`);
	}

	lines.push(
		`- **Depends on**: ${ref.dependsOn.length > 0 ? ref.dependsOn.join(", ") : "\\u2205"}`,
	);
	lines.push(
		`- **Implements**: ${ref.implementedBy.length > 0 ? ref.implementedBy.join(", ") : "\\u2205"}`,
	);
	lines.push(
		`- **Validated by**: ${ref.validatedBy.length > 0 ? ref.validatedBy.join(", ") : "\\u2205"}`,
	);
	lines.push(
		`- **Gaps**: ${ref.gaps.length > 0 ? ref.gaps.join("; ") : "\\u2205"}`,
	);

	return lines.join("\n");
}
