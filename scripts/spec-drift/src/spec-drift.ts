// Detects drift between TypeScript declarations in specs/*.md and exported
// symbols in src/. For each `interface`/`type` declared in a ```typescript```
// block of a spec, if the same name is exported anywhere under src/, the
// script asks tsc whether the two are bidirectionally assignable. Any
// divergence is reported with the underlying tsc message.
//
// Each spec code block is processed in isolation (unique block prefix) so
// that names duplicated across specs don't collide as tsc duplicate
// identifiers.
//
// Run:
//   node --experimental-strip-types ~/.claude/scripts/spec-drift/src/spec-drift.ts \
//     [--specs-dir <path>] [--src-dir <path>] [--show-missing] [--json <path>] \
//     [--ignore-file <path>]
//
// Paths default to <cwd>/specs and <cwd>/src. If either is missing, the
// script exits 0 with a "not spec-driven, skipping" notice — safe to wire
// unconditionally into a post-implementation workflow.
//
// --json <path> writes a machine-readable report to <path> with fields
// { skill, exit_code, checked_count, drift[], ignored[], missing_count }.
// Each drift entry includes a synthetic id for oscillation hashing by
// loop-clean.sh. The console report is unaffected by this flag.
//
// --ignore-file <path> points to a `.spec-drift-ignore` file listing
// (TypeName @ spec_file # justification) entries that mask intentional
// drifts (e.g. code is more strict than spec YAML due to a normative
// invariant). Default: <cwd>/.spec-drift-ignore. Absent file = no
// ignores. Justification is required and preserved in the JSON report
// for traceability.
//
// Exit: 0 = no drift (or skipped), 1 = drift detected.

import { createHash } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SPEC_ONLY_MARKER = "// spec-only";

interface SpecBlock {
	specFile: string;
	line: number; // 1-based, opening ``` fence
	body: string; // raw block content
	declaredNames: string[]; // top-level interface/type names
	prefix: string; // e.g. "B007_"
}

export interface CheckedDecl {
	name: string;
	specFile: string;
	line: number;
	prefix: string;
	srcFile: string;
	status: "OK" | "DRIFT" | "IGNORED";
	detail?: string;
	ignoreReason?: string;
}

export interface MissingDecl {
	name: string;
	specFile: string;
	line: number;
}

export interface IgnoreEntry {
	name: string;
	specFile: string;
	reason: string;
}

// Per-drift signals that justify blocking auto-fix and escalating to
// design-queue. All deterministic, computed from file contents.
export interface DriftHints {
	// Normative keywords (RFC 2119 uppercase + French "obligatoire"/"DOIT"
	// class) found within the scan window around the drift site in the spec.
	// Non-empty list = spec asserts a hard rule near the drift, so aligning
	// spec to code would relax a normative rule.
	normative_language: string[];
	// True when the drifted type is exported from src/index.ts (directly
	// defined there or re-exported via `export { ... } from` / `export *`).
	// A change to a type on the public surface is a breaking change and
	// requires a new NIB, not a backlog item.
	api_surface: boolean;
	// Relative paths (within specsDir) of other spec files that also declare
	// the same type name in a ```typescript``` block. Aligning one side of
	// the drift would create cross-spec incoherence.
	cross_spec_files: string[];
}

export type DriftDirection = "block" | "ambiguous";

// Normative keyword patterns. Uppercase variants (RFC 2119) are matched
// case-sensitively: MUST, SHALL, REQUIRED in prose is a strong signal, the
// lowercase "must" / "required" would trigger on non-normative prose. The
// French equivalents are matched case-insensitively because standard
// French prose capitalizes them sentence-initially.
const NORMATIVE_PATTERNS: { re: RegExp; tag: string }[] = [
	{ re: /\bMUST NOT\b/, tag: "MUST NOT" },
	{ re: /\bMUST\b/, tag: "MUST" },
	{ re: /\bSHALL NOT\b/, tag: "SHALL NOT" },
	{ re: /\bSHALL\b/, tag: "SHALL" },
	{ re: /\bREQUIRED\b/, tag: "REQUIRED" },
	{ re: /\bNE DOIT PAS\b/, tag: "NE DOIT PAS" },
	{ re: /\bDOIT PAS\b/, tag: "DOIT PAS" },
	{ re: /\bDOIVENT\b/, tag: "DOIVENT" },
	{ re: /\bDOIT\b/, tag: "DOIT" },
	{ re: /\bobligatoires?\b/i, tag: "obligatoire" },
	{ re: /\brequise?s?\b/i, tag: "requis" },
	{ re: /\bexplicitement\b/i, tag: "explicitement" },
];

// Pure function: scan an already-loaded spec text for normative keywords
// within `radius` lines of `specLine` (1-based). Used by
// scanNormativeLanguage (file-based wrapper) and by writeJsonReport
// (which pre-loads spec content once per file to avoid re-reading the
// same spec multiple times when it contains multiple drifts).
function scanNormativeInText(
	text: string,
	specLine: number,
	radius: number,
): string[] {
	const lines = text.split(/\r?\n/);
	const start = Math.max(0, specLine - 1 - radius);
	const end = Math.min(lines.length, specLine - 1 + radius + 1);
	const window = lines.slice(start, end).join("\n");
	const matches: string[] = [];
	for (const { re, tag } of NORMATIVE_PATTERNS) {
		if (re.test(window) && !matches.includes(tag)) matches.push(tag);
	}
	// Hierarchical dedup: when a more specific negated form matched, drop
	// the redundant bare positive form. "MUST NOT X" text always also
	// matches `/\bMUST\b/`, but reporting both inflates the hint count
	// and confuses downstream consumers.
	const hierarchy: Array<[string, string[]]> = [
		["MUST NOT", ["MUST"]],
		["SHALL NOT", ["SHALL"]],
		["NE DOIT PAS", ["DOIT PAS", "DOIT"]],
		["DOIT PAS", ["DOIT"]],
	];
	for (const [specific, redundants] of hierarchy) {
		if (!matches.includes(specific)) continue;
		for (const r of redundants) {
			const idx = matches.indexOf(r);
			if (idx !== -1) matches.splice(idx, 1);
		}
	}
	return matches;
}

// Scan the spec file for normative keywords within `radius` lines of
// `specLine` (1-based). Returns the deduplicated list of matched tags
// (order: pattern order above). The anchor line is the opening ``` fence
// of the block containing the drifted type, so the window naturally covers
// both the block and the prose introducing it.
export function scanNormativeLanguage(
	specFile: string,
	specLine: number,
	radius = 10,
): string[] {
	return scanNormativeInText(readFileSync(specFile, "utf8"), specLine, radius);
}

// Return true iff the type `name` from `srcFile` is exposed on the public
// surface — i.e., reachable from `src/index.ts`. Recognizes:
//   1. The drift site is itself src/index.ts.
//   2. Named re-exports: `export { X }`, `export type { X }`, including
//      lists of names separated by commas (with optional aliases).
//   3. Star re-exports: `export * from './module.js'` or
//      `export type * from './module.js'` where the module's resolved path
//      equals `srcFile`.
// Stops at 1-hop depth: transitive re-exports (index.ts -> barrel.ts ->
// leaf.ts) are not followed. First-level public APIs are what matter here;
// a type that's buried under N levels of re-export is unusual and deserves
// explicit review anyway.
// Strip `//` line comments and `/* ... */` block comments from a TypeScript
// source. Used to avoid reporting `// export { Foo } from './m.js'` as a
// real re-export. Not a full parser — handles the common cases and is
// conservative: if a comment boundary straddles something clever (e.g.,
// a string literal containing `//`), the function may over-strip, but
// over-stripping only causes false negatives (type not flagged as public),
// which is strictly safer than the previous false positive.
function stripTsComments(text: string): string {
	// Block comments first so `// inside /* ... */` isn't double-stripped.
	let out = text.replace(/\/\*[\s\S]*?\*\//g, "");
	// Line comments: strip from `//` to end-of-line.
	out = out.replace(/\/\/[^\n]*/g, "");
	return out;
}

// Pure function: test whether `name` is reachable from the given
// (already-loaded, already-comment-stripped) index.ts content. Caller
// provides `indexPath` for resolving relative `from './m.js'` imports.
// If `indexContent === null`, the index file does not exist and the
// function returns false unconditionally.
function isApiSurfaceInContent(
	indexContent: string | null,
	indexPath: string,
	srcFile: string,
	name: string,
): boolean {
	if (indexContent === null) return false;
	if (resolve(srcFile) === resolve(indexPath)) return true;
	// Named re-exports with a `from` clause. Only count a match if the
	// resolved module path equals srcFile.
	const namedWithFromRe =
		/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
	for (;;) {
		const m = namedWithFromRe.exec(indexContent);
		if (m === null) break;
		const inside = m[1];
		const modPath = m[2];
		const noExt = modPath.replace(/\.js$/, "");
		const resolved = resolve(dirname(indexPath), `${noExt}.ts`);
		if (resolve(srcFile) !== resolved) continue;
		for (const raw of inside.split(",")) {
			const local = raw
				.trim()
				.split(/\s+as\s+/)[0]
				.trim();
			if (local === name) return true;
		}
	}
	// Star re-exports.
	const starRe = /export\s+(?:type\s+)?\*\s+from\s+["']([^"']+)["']/g;
	for (;;) {
		const m = starRe.exec(indexContent);
		if (m === null) break;
		const noExt = m[1].replace(/\.js$/, "");
		const resolved = resolve(dirname(indexPath), `${noExt}.ts`);
		if (resolve(srcFile) === resolved) return true;
	}
	return false;
}

export function isApiSurface(
	srcFile: string,
	name: string,
	srcDir: string,
): boolean {
	const indexPath = join(srcDir, "index.ts");
	if (!existsSync(indexPath)) return false;
	const content = stripTsComments(readFileSync(indexPath, "utf8"));
	return isApiSurfaceInContent(content, indexPath, srcFile, name);
}

// Return the list of OTHER spec files (relative paths within specsDir)
// that declare the same type name in a ```typescript``` block. Empty list
// if the type is defined in exactly one spec. Used to flag drifts whose
// alignment would create cross-spec incoherence.
export function findCrossSpecs(
	name: string,
	currentSpecFile: string,
	specsDir: string,
): string[] {
	const index = buildCrossSpecIndex(specsDir);
	const currentAbs = resolve(currentSpecFile);
	const entries = index.get(name) ?? [];
	return entries
		.filter((abs) => abs !== currentAbs)
		.map((abs) => relative(specsDir, abs));
}

// Build an index: type name → list of absolute spec file paths that
// declare it in a ```typescript``` block. Computed once per scan so that
// D drift entries don't trigger D*S file reads.
//
// Returned map uses absolute paths (not relative) so the caller can
// filter out the drift's own spec file robustly across symlink / /private
// macOS aliases. Callers re-relativize at emit time.
function buildCrossSpecIndex(specsDir: string): Map<string, string[]> {
	const index = new Map<string, string[]>();
	const blockRegex = /```(?:typescript|ts)[^\n]*\n([\s\S]*?)```/g;
	for (const f of readdirSync(specsDir)) {
		if (!f.endsWith(".md")) continue;
		const abs = resolve(join(specsDir, f));
		const text = readFileSync(abs, "utf8");
		const seenHere = new Set<string>();
		blockRegex.lastIndex = 0;
		for (;;) {
			const match = blockRegex.exec(text);
			if (match === null) break;
			const body = match[1];
			if (body.includes(SPEC_ONLY_MARKER)) continue;
			// Extract every `interface Foo` / `type Foo` declaration in the
			// block. One pass over the block's AST via the TS parser would
			// be more accurate, but the regex is good enough here: any top-
			// level declaration in a typescript block begins with one of
			// these keywords followed by the identifier.
			const declRe = /\b(?:interface|type)\s+([A-Za-z_$][\w$]*)\b/g;
			for (;;) {
				const d = declRe.exec(body);
				if (d === null) break;
				seenHere.add(d[1]);
			}
		}
		for (const name of seenHere) {
			const existing = index.get(name);
			if (existing) existing.push(abs);
			else index.set(name, [abs]);
		}
	}
	return index;
}

// Derive the drift direction from hints. Any non-empty hint triggers
// `block`; no hints => `ambiguous`. The reason is a concatenation of all
// triggering signals, separated by "; ". Callers must serialize this into
// the JSON report so downstream skills can route without re-computing.
export function computeDriftDirection(hints: DriftHints): {
	direction: DriftDirection;
	reason: string;
} {
	const reasons: string[] = [];
	if (hints.normative_language.length > 0) {
		reasons.push(
			`normative keywords near drift site: ${hints.normative_language.join(", ")}`,
		);
	}
	if (hints.api_surface) {
		reasons.push("type exposed on public surface (src/index.ts)");
	}
	if (hints.cross_spec_files.length > 0) {
		reasons.push(
			`type declared in other specs: ${hints.cross_spec_files.join(", ")}`,
		);
	}
	if (reasons.length > 0) {
		return { direction: "block", reason: reasons.join("; ") };
	}
	return {
		direction: "ambiguous",
		reason: "no blocking signal — direction must be classified by consumer",
	};
}

// Parse a .spec-drift-ignore file. Returns [] if the file doesn't exist.
// Throws if any non-blank, non-comment line is malformed — an ignore file
// without a justification is a silent failure mode the skill explicitly
// refuses: every mask must cite an invariant or DC.
//
// Format (one entry per line):
//   TypeName @ spec_file_rel_path # reason citing invariant / DC
//
// Leading / trailing whitespace tolerated. Blank lines and lines starting
// with `#` are comments.
export function parseIgnoreFile(path: string): IgnoreEntry[] {
	if (!existsSync(path)) return [];
	const text = readFileSync(path, "utf8");
	const entries: IgnoreEntry[] = [];
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i += 1) {
		const raw = lines[i];
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const hashIdx = line.indexOf("#");
		if (hashIdx === -1) {
			throw new Error(
				`.spec-drift-ignore:${i + 1}: missing justification (format: 'TypeName @ spec_file # reason')`,
			);
		}
		const before = line.slice(0, hashIdx).trim();
		const reason = line.slice(hashIdx + 1).trim();
		if (reason === "") {
			throw new Error(
				`.spec-drift-ignore:${i + 1}: justification after '#' is required`,
			);
		}
		const atIdx = before.indexOf("@");
		if (atIdx === -1) {
			throw new Error(
				`.spec-drift-ignore:${i + 1}: expected format 'TypeName @ spec_file # reason'`,
			);
		}
		const name = before.slice(0, atIdx).trim();
		const specFile = before.slice(atIdx + 1).trim();
		if (name === "" || specFile === "") {
			throw new Error(
				`.spec-drift-ignore:${i + 1}: TypeName and spec_file must be non-empty`,
			);
		}
		entries.push({ name, specFile, reason });
	}
	return entries;
}

function walkTsFiles(dir: string, out: string[]): void {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		const st = statSync(p);
		if (st.isDirectory()) walkTsFiles(p, out);
		else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(p);
	}
}

function indexSrcExports(srcDir: string): Map<string, string> {
	const map = new Map<string, string>();
	const files: string[] = [];
	walkTsFiles(srcDir, files);
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		sf.forEachChild((node) => {
			if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node))
				return;
			const exported = node.modifiers?.some(
				(m) => m.kind === ts.SyntaxKind.ExportKeyword,
			);
			if (!exported) return;
			if (!map.has(node.name.text)) map.set(node.name.text, file);
		});
	}
	return map;
}

function extractBlocks(
	specFile: string,
	blockCounter: { n: number },
): SpecBlock[] {
	const text = readFileSync(specFile, "utf8");
	const blocks: SpecBlock[] = [];
	// Tolerate trailing whitespace / CRLF / extra attributes after the language tag.
	const blockRegex = /```(?:typescript|ts)[^\n]*\n([\s\S]*?)```/g;
	while (true) {
		const match = blockRegex.exec(text);
		if (match === null) break;
		const body = match[1];
		if (body.includes(SPEC_ONLY_MARKER)) continue;
		const lineNumber = text.slice(0, match.index).split("\n").length;
		const sf = ts.createSourceFile(
			"block.ts",
			body,
			ts.ScriptTarget.Latest,
			true,
		);
		const names: string[] = [];
		sf.forEachChild((node) => {
			if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
				names.push(node.name.text);
			}
		});
		if (names.length === 0) continue;
		blockCounter.n += 1;
		blocks.push({
			specFile,
			line: lineNumber,
			body,
			declaredNames: names,
			prefix: `B${String(blockCounter.n).padStart(4, "0")}_`,
		});
	}
	return blocks;
}

// Whole-word rename. Sufficient for ASCII identifier names used in this repo.
function renameAll(body: string, names: string[], prefix: string): string {
	let out = body;
	for (const n of names) {
		out = out.replace(new RegExp(`\\b${n}\\b`, "g"), `${prefix}${n}`);
	}
	return out;
}

function buildAssertionFile(
	blocks: SpecBlock[],
	srcMap: Map<string, string>,
	tmpFile: string,
): { checked: CheckedDecl[]; missing: MissingDecl[] } {
	const checked: CheckedDecl[] = [];
	const missing: MissingDecl[] = [];

	let content = "// AUTO-GENERATED by spec-drift.ts — DO NOT COMMIT\n\n";
	const importLines: string[] = [];
	const declLines: string[] = [];

	for (const block of blocks) {
		const renamed = renameAll(
			block.body,
			block.declaredNames,
			`Spec_${block.prefix}`,
		);
		declLines.push(renamed);

		for (const name of block.declaredNames) {
			const srcFile = srcMap.get(name);
			if (!srcFile) {
				missing.push({ name, specFile: block.specFile, line: block.line });
				continue;
			}
			// Path resolved from the tmp file's directory, not ROOT.
			const relPath = relative(dirname(tmpFile), srcFile).replace(/\\/g, "/");
			const rel = `${relPath.startsWith(".") ? "" : "./"}${relPath.replace(/\.ts$/, ".js")}`;
			const actualAlias = `Actual_${block.prefix}${name}`;
			const specAlias = `Spec_${block.prefix}${name}`;
			importLines.push(
				`import type { ${name} as ${actualAlias} } from "${rel}";`,
			);
			declLines.push(
				`const _a_${block.prefix}${name}: ${specAlias} = {} as ${actualAlias};`,
			);
			declLines.push(
				`const _b_${block.prefix}${name}: ${actualAlias} = {} as ${specAlias};`,
			);
			checked.push({
				name,
				specFile: block.specFile,
				line: block.line,
				prefix: block.prefix,
				srcFile,
				status: "OK",
			});
		}
		declLines.push("");
	}

	content += `${importLines.join("\n")}\n\n${declLines.join("\n")}`;
	writeFileSync(tmpFile, content);
	return { checked, missing };
}

function runTsc(tmpFile: string): readonly ts.Diagnostic[] {
	const program = ts.createProgram([tmpFile], {
		noEmit: true,
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		skipLibCheck: true,
		esModuleInterop: true,
	});
	return ts.getPreEmitDiagnostics(program);
}

function classify(
	checked: CheckedDecl[],
	diags: readonly ts.Diagnostic[],
): void {
	for (const diag of diags) {
		const msg = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
		// Each diagnostic mentions our unique tag at least once. Find it.
		for (const c of checked) {
			const tag = `${c.prefix}${c.name}`;
			if (msg.includes(tag)) {
				c.status = "DRIFT";
				c.detail = c.detail ? `${c.detail}\n${msg}` : msg;
				break;
			}
		}
	}
}

// Mutates `checked` in place: any entry in DRIFT state whose
// (name, spec_file_rel) matches an ignore entry is demoted to IGNORED,
// with the justification attached. Relative path comparison uses `root`.
export function applyIgnores(
	checked: CheckedDecl[],
	ignores: IgnoreEntry[],
	root: string,
): void {
	if (ignores.length === 0) return;
	const ignoreMap = new Map<string, IgnoreEntry>();
	for (const e of ignores) ignoreMap.set(`${e.name}@${e.specFile}`, e);
	for (const c of checked) {
		if (c.status !== "DRIFT") continue;
		const key = `${c.name}@${relative(root, c.specFile).replace(/\\/g, "/")}`;
		const entry = ignoreMap.get(key);
		if (entry) {
			c.status = "IGNORED";
			c.ignoreReason = entry.reason;
		}
	}
}

function printReport(
	checked: CheckedDecl[],
	missing: MissingDecl[],
	showMissing: boolean,
	root: string,
): number {
	const drift = checked.filter((c) => c.status === "DRIFT");
	const ignored = checked.filter((c) => c.status === "IGNORED");
	const ok = checked.length - drift.length - ignored.length;

	const ignoredSegment =
		ignored.length > 0 ? `, ${ignored.length} IGNORED` : "";
	const missingSegment = showMissing
		? `, ${missing.length} MISSING_IN_CODE`
		: "";
	console.log(
		`Spec drift report: ${ok} OK, ${drift.length} DRIFT${ignoredSegment}${missingSegment}`,
	);
	if (!showMissing && missing.length > 0) {
		console.log(
			`(${missing.length} spec-only types hidden — pass --show-missing to list)`,
		);
	}

	if (drift.length > 0) {
		console.log("\n=== DRIFT ===");
		for (const c of drift) {
			console.log(
				`  ${c.name}  (${relative(root, c.specFile)}:${c.line} <-> ${relative(root, c.srcFile)})`,
			);
			if (c.detail) {
				const lines = c.detail.split("\n").slice(0, 8);
				for (const l of lines) console.log(`    ${l.trim()}`);
			}
		}
	}

	if (ignored.length > 0) {
		console.log("\n=== IGNORED (masked by .spec-drift-ignore) ===");
		for (const c of ignored) {
			console.log(
				`  ${c.name}  (${relative(root, c.specFile)}:${c.line} <-> ${relative(root, c.srcFile)})`,
			);
			if (c.ignoreReason) console.log(`    reason: ${c.ignoreReason}`);
		}
	}

	if (showMissing && missing.length > 0) {
		console.log("\n=== MISSING IN CODE (informational) ===");
		for (const m of missing) {
			console.log(`  ${m.name}  (${relative(root, m.specFile)}:${m.line})`);
		}
	}

	return drift.length > 0 ? 1 : 0;
}

export interface DriftCheckOptions {
	specsDir: string;
	srcDir: string;
	tmpFile?: string;
}

export interface DriftCheckResult {
	checked: CheckedDecl[];
	missing: MissingDecl[];
}

export function runDriftCheck(opts: DriftCheckOptions): DriftCheckResult {
	const tmpFile =
		opts.tmpFile ?? join(tmpdir(), `spec-drift-check-${process.pid}.ts`);
	const srcMap = indexSrcExports(opts.srcDir);
	const blocks: SpecBlock[] = [];
	const counter = { n: 0 };
	for (const f of readdirSync(opts.specsDir)) {
		if (!f.endsWith(".md")) continue;
		blocks.push(...extractBlocks(join(opts.specsDir, f), counter));
	}
	const { checked, missing } = buildAssertionFile(blocks, srcMap, tmpFile);
	const diags = runTsc(tmpFile);
	classify(checked, diags);
	try {
		unlinkSync(tmpFile);
	} catch {
		// best effort
	}
	return { checked, missing };
}

interface CliArgs {
	specsDir: string;
	srcDir: string;
	showMissing: boolean;
	jsonPath: string | null;
	ignoreFile: string;
}

function parseArgs(argv: string[], cwd: string): CliArgs {
	const resolveArg = (value: string): string =>
		isAbsolute(value) ? value : resolve(cwd, value);
	let specsDir = join(cwd, "specs");
	let srcDir = join(cwd, "src");
	let showMissing = false;
	let jsonPath: string | null = null;
	let ignoreFile = join(cwd, ".spec-drift-ignore");
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--specs-dir") {
			const next = argv[i + 1];
			if (!next) throw new Error("--specs-dir requires a path");
			specsDir = resolveArg(next);
			i += 1;
		} else if (a === "--src-dir") {
			const next = argv[i + 1];
			if (!next) throw new Error("--src-dir requires a path");
			srcDir = resolveArg(next);
			i += 1;
		} else if (a === "--show-missing") {
			showMissing = true;
		} else if (a === "--json") {
			const next = argv[i + 1];
			if (!next) throw new Error("--json requires a path");
			jsonPath = resolveArg(next);
			i += 1;
		} else if (a === "--ignore-file") {
			const next = argv[i + 1];
			if (!next) throw new Error("--ignore-file requires a path");
			ignoreFile = resolveArg(next);
			i += 1;
		} else if (a === "--help" || a === "-h") {
			console.log(
				"Usage: spec-drift [--specs-dir <path>] [--src-dir <path>] [--show-missing] [--json <path>] [--ignore-file <path>]",
			);
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}
	return { specsDir, srcDir, showMissing, jsonPath, ignoreFile };
}

// Synthetic id for drift entries, used by loop-clean.sh for oscillation hashing.
// Stable across invocations as long as (name, spec_file, src_file) are unchanged.
function driftId(name: string, specFile: string, srcFile: string): string {
	const input = `spec-drift|${name}|${specFile}|${srcFile}`;
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function writeJsonReport(
	checked: CheckedDecl[],
	missing: MissingDecl[],
	exitCode: number,
	jsonPath: string,
	root: string,
	specsDir: string,
	srcDir: string,
): void {
	// Pre-load content once. Without this, each drift entry re-reads every
	// spec via findCrossSpecs (O(D*S) file reads) and re-reads
	// src/index.ts via isApiSurface (O(D) reads). Pre-loading drops us to
	// O(S + 1) reads per scan.
	const driftEntries = checked.filter((c) => c.status === "DRIFT");
	const specContentCache = new Map<string, string>();
	for (const c of driftEntries) {
		if (!specContentCache.has(c.specFile)) {
			specContentCache.set(c.specFile, readFileSync(c.specFile, "utf8"));
		}
	}
	const crossSpecIndex =
		driftEntries.length > 0
			? buildCrossSpecIndex(specsDir)
			: new Map<string, string[]>();
	const indexPath = join(srcDir, "index.ts");
	const indexContent = existsSync(indexPath)
		? stripTsComments(readFileSync(indexPath, "utf8"))
		: null;

	const drift = driftEntries.map((c) => {
		const specFileRel = relative(root, c.specFile);
		const srcFileRel = relative(root, c.srcFile);
		const specText = specContentCache.get(c.specFile) ?? "";
		const currentAbs = resolve(c.specFile);
		const crossAbs = crossSpecIndex.get(c.name) ?? [];
		const hints: DriftHints = {
			normative_language: scanNormativeInText(specText, c.line, 10),
			api_surface: isApiSurfaceInContent(
				indexContent,
				indexPath,
				c.srcFile,
				c.name,
			),
			cross_spec_files: crossAbs
				.filter((abs) => abs !== currentAbs)
				.map((abs) => relative(specsDir, abs)),
		};
		const { direction, reason } = computeDriftDirection(hints);
		return {
			id: driftId(c.name, specFileRel, srcFileRel),
			name: c.name,
			spec_file: specFileRel,
			spec_line: c.line,
			src_file: srcFileRel,
			detail: c.detail ?? "",
			hints,
			direction,
			direction_reason: reason,
		};
	});
	const ignored = checked
		.filter((c) => c.status === "IGNORED")
		.map((c) => {
			const specFileRel = relative(root, c.specFile);
			const srcFileRel = relative(root, c.srcFile);
			return {
				id: driftId(c.name, specFileRel, srcFileRel),
				name: c.name,
				spec_file: specFileRel,
				spec_line: c.line,
				src_file: srcFileRel,
				reason: c.ignoreReason ?? "",
			};
		});
	const report = {
		skill: "spec-drift",
		exit_code: exitCode,
		checked_count: checked.length,
		drift,
		ignored_count: ignored.length,
		ignored,
		missing_count: missing.length,
	};
	writeFileSync(jsonPath, JSON.stringify(report, null, 2));
}

function main(): void {
	const cwd = process.cwd();
	const args = parseArgs(process.argv.slice(2), cwd);

	if (!existsSync(args.specsDir) || !existsSync(args.srcDir)) {
		const missing: string[] = [];
		if (!existsSync(args.specsDir))
			missing.push(relative(cwd, args.specsDir) || args.specsDir);
		if (!existsSync(args.srcDir))
			missing.push(relative(cwd, args.srcDir) || args.srcDir);
		console.log(
			`spec-drift: not a spec-driven project (missing ${missing.join(", ")}), skipping.`,
		);
		if (args.jsonPath) {
			writeJsonReport(
				[],
				[],
				0,
				args.jsonPath,
				cwd,
				args.specsDir,
				args.srcDir,
			);
		}
		process.exit(0);
	}

	const { checked, missing } = runDriftCheck({
		specsDir: args.specsDir,
		srcDir: args.srcDir,
	});
	const ignoreEntries = parseIgnoreFile(args.ignoreFile);
	applyIgnores(checked, ignoreEntries, cwd);
	const exitCode = printReport(checked, missing, args.showMissing, cwd);
	if (args.jsonPath) {
		writeJsonReport(
			checked,
			missing,
			exitCode,
			args.jsonPath,
			cwd,
			args.specsDir,
			args.srcDir,
		);
	}
	process.exit(exitCode);
}

// Only run main when invoked as a script, not when imported by tests.
// Use realpathSync + fileURLToPath to handle symlinks, macOS /private/var
// aliases, and non-POSIX path formats — a raw string equality on argv[1]
// fails silently in any of those cases and the script would exit 0 without
// running, masking drift in CI.
if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
	main();
}
