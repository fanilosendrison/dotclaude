import { basename } from "node:path";
import { Glob } from "bun";
import type { CrossReference, CrossReferenceMap, SpecFile } from "./types";

/**
 * Build cross-reference map: spec→code→test.
 *
 * Strategy (by priority):
 * 1. Explicit: `validates` field in frontmatter → glob match
 * 2. Convention: spec filename stem → directory matching
 */
export function buildCrossReferences(
	specs: SpecFile[],
	codeFiles: string[],
	testFiles: string[],
): CrossReferenceMap {
	const map: CrossReferenceMap = new Map();

	for (const spec of specs) {
		if (!spec.frontmatter) continue;

		const { id, version, validates, depends_on, scope } = spec.frontmatter;

		let implementedBy: string[] = [];
		let validatedBy: string[] = [];
		let matchStrategy: CrossReference["matchStrategy"] = "convention";

		// 1. Explicit matching via `validates` patterns
		if (validates.length > 0) {
			implementedBy = matchGlobs(validates, codeFiles);
			validatedBy = matchGlobs(validates, testFiles);
			matchStrategy = "explicit";
		}

		// 2. Convention-based fallback (or supplement)
		const conventionCode = matchByConvention(spec.path, codeFiles);
		const conventionTests = matchByConvention(spec.path, testFiles);

		if (implementedBy.length === 0 && conventionCode.length > 0) {
			implementedBy = conventionCode;
			matchStrategy = matchStrategy === "explicit" ? "mixed" : "convention";
		} else if (conventionCode.length > 0 && matchStrategy === "explicit") {
			// Merge convention results with explicit
			const merged = new Set([...implementedBy, ...conventionCode]);
			implementedBy = [...merged];
			matchStrategy = "mixed";
		}

		if (validatedBy.length === 0 && conventionTests.length > 0) {
			validatedBy = conventionTests;
		} else if (conventionTests.length > 0) {
			const merged = new Set([...validatedBy, ...conventionTests]);
			validatedBy = [...merged];
		}

		// Detect gaps
		const gaps: string[] = [];
		if (implementedBy.length === 0)
			gaps.push("No implementation files matched");
		if (validatedBy.length === 0) gaps.push("No test files matched");

		map.set(id, {
			specId: id,
			specPath: spec.path,
			specVersion: version,
			scope: scope ?? spec.firstHeading,
			dependsOn: depends_on,
			implementedBy: implementedBy.sort(),
			validatedBy: validatedBy.sort(),
			gaps,
			matchStrategy,
		});
	}

	return map;
}

/**
 * Match file list against glob-like patterns from frontmatter `validates`.
 * Patterns like "src/auth/*" should match "src/auth/login.ts".
 */
function matchGlobs(patterns: string[], files: string[]): string[] {
	const matched = new Set<string>();

	for (const pattern of patterns) {
		const glob = new Glob(pattern);
		for (const file of files) {
			if (glob.match(file)) {
				matched.add(file);
			}
		}
	}

	return [...matched];
}

/**
 * Convention-based matching: extract stem from spec filename,
 * match against directories and file paths.
 *
 * "auth-flow.md" → stem "auth" → matches src/auth/*, tests/auth/*
 * "data-model.md" → stem "data-model" → matches src/data-model/*, also tries "data_model"
 */
function matchByConvention(specPath: string, files: string[]): string[] {
	const raw = basename(specPath, ".md").replace(".spec", "");
	const lower = raw.toLowerCase();

	// Generate normalized stems: lowercase + both kebab and underscore variants
	const stems = new Set<string>();
	stems.add(lower);
	stems.add(lower.replace(/_/g, "-"));
	stems.add(lower.replace(/-/g, "_"));

	// First segment (before first dash or underscore) — directory matching only
	const firstPart = lower.split(/[-_]/)[0];
	const dirOnlyStems = new Set<string>();
	if (firstPart && firstPart !== lower) {
		dirOnlyStems.add(firstPart);
	}

	const matched: string[] = [];
	for (const file of files) {
		const fileLower = file.toLowerCase();
		let found = false;

		// Full stems: match directories and filenames
		for (const stem of stems) {
			if (
				fileLower.includes(`/${stem}/`) ||
				fileLower.startsWith(`${stem}/`) ||
				basename(fileLower, ".ts").includes(stem) ||
				basename(fileLower, ".js").includes(stem) ||
				basename(fileLower, ".py").includes(stem)
			) {
				found = true;
				break;
			}
		}

		// First-part stems: directories only (too broad for filename matching)
		if (!found) {
			for (const stem of dirOnlyStems) {
				if (fileLower.includes(`/${stem}/`) || fileLower.startsWith(`${stem}/`)) {
					found = true;
					break;
				}
			}
		}

		if (found) matched.push(file);
	}

	return matched;
}
