#!/usr/bin/env bun

import { join } from "node:path";
import { SPEC_MANIFEST_FILE } from "./lib/constants";
import { buildCrossReferences } from "./lib/cross-references";
import { generateManifest } from "./lib/manifest-writer";
import { scanProject } from "./lib/scanner";
import { checkStaleness } from "./lib/staleness";
import { writeState } from "./lib/state";
import type { CliOutput, CrossReference, IndexState } from "./lib/types";
import { validateIndex } from "./lib/validation";

async function main() {
	const args = process.argv.slice(2);

	const force = args.includes("--force");
	const verbose = args.includes("--verbose");
	const dryRun = args.includes("--dry-run");

	// First non-flag arg is project root
	const projectRoot = args.find((a) => !a.startsWith("--")) ?? process.cwd();

	// Git guard + staleness only apply on subsequent sessions (state file exists).
	// First session (onboarding): no git needed, go straight to scan.
	const hasState = await Bun.file(join(projectRoot, ".index-state.json")).exists();

	if (hasState) {
		let isGitRepo = false;
		try {
			const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
				cwd: projectRoot,
				stdout: "pipe",
				stderr: "pipe",
			});
			const output = await new Response(proc.stdout).text();
			isGitRepo = output.trim() === "true";
		} catch {
			isGitRepo = false;
		}

		if (!isGitRepo) {
			const output: CliOutput = {
				status: "ERROR",
				error: "Not a git repository",
			};
			console.log(JSON.stringify(output));
			process.exit(1);
		}
	}

	// Staleness check (skip if --force or first session)
	if (!force && hasState) {
		const staleness = await checkStaleness(projectRoot);

		if (staleness.status === "FRESH") {
			const output: CliOutput = {
				status: "FRESH",
				treeHash: staleness.currentHash,
				timestamp: staleness.timestamp ?? "",
			};
			console.log(JSON.stringify(output));
			process.exit(0);
		}

		if (verbose) {
			console.error(
				`[index-repo] Status: ${staleness.status} | Hash: ${staleness.currentHash.slice(0, 7)} (was: ${staleness.storedHash?.slice(0, 7) ?? "none"})`,
			);
		}
	}

	// Full scan
	if (verbose) console.error("[index-repo] Scanning project...");
	const scan = await scanProject(projectRoot);

	if (verbose) {
		console.error(
			`[index-repo] Found: ${scan.code.count} code, ${scan.specs.count} specs, ${scan.config.count} config, ${scan.tests.count} tests, ${scan.scripts.count} scripts`,
		);
	}

	// Cross-references
	const crossRefs = buildCrossReferences(
		scan.specs.files,
		scan.code.files,
		scan.tests.files,
	);

	// Validation
	const validation = validateIndex(scan, crossRefs);

	if (verbose && validation.tokenWarning) {
		console.error(
			`[index-repo] WARNING: Estimated output ${validation.estimatedTokens} tokens (>10K threshold)`,
		);
	}

	// Get current tree hash for state (empty string if no git yet)
	let treeHash = "";
	try {
		const staleness = await checkStaleness(projectRoot);
		treeHash = staleness.currentHash;
	} catch {
		// No git repo yet (first session / onboarding) — treeHash stays empty
	}

	if (!dryRun) {
		// Write SPEC_MANIFEST.md
		const manifest = generateManifest(scan, crossRefs, validation, treeHash);
		await Bun.write(join(projectRoot, SPEC_MANIFEST_FILE), manifest);

		if (verbose) console.error(`[index-repo] Wrote ${SPEC_MANIFEST_FILE}`);

		// Write .index-state.json
		const state: IndexState = {
			treeHash,
			timestamp: new Date().toISOString(),
			axisHashes: {
				code: scan.code.hash,
				specs: scan.specs.hash,
				config: scan.config.hash,
				tests: scan.tests.hash,
				scripts: scan.scripts.hash,
			},
			version: 1,
		};
		await writeState(projectRoot, state);

		if (verbose) console.error("[index-repo] Wrote .index-state.json");
	}

	// Output scan result as JSON
	const crossRefsObj: Record<string, CrossReference> = {};
	for (const [key, val] of crossRefs) {
		crossRefsObj[key] = val;
	}

	const output: CliOutput = {
		status: "STALE",
		scanResult: scan,
		crossReferences: crossRefsObj,
		validation,
	};

	console.log(JSON.stringify(output));
	process.exit(0);
}

main().catch((error) => {
	const output: CliOutput = {
		status: "ERROR",
		error: error instanceof Error ? error.message : String(error),
	};
	console.log(JSON.stringify(output));
	process.exit(1);
});
