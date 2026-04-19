---
name: repo-indexer
description: "Generates SPEC_MANIFEST.md (deterministic) and PROJECT_INDEX.md (semantic) for navigating spec-to-code-to-test relationships. FULL SCAN (runs the scanner CLI): at the start of every session on a git repository, when the user asks to index the project, scan the project, refresh the index, check project index, scan specs, load project context, or when starting work on an unfamiliar codebase. READ-ONLY CONSULTATION (just read existing PROJECT_INDEX.md / SPEC_MANIFEST.md, no re-scan): when the user asks what does this project do, where is X implemented, which files should I touch for X, what depends on X, what's the impact of changing X, which specs are not implemented, what's missing, what tests cover X, check spec coverage, project status, état du projet, or before implementing/refactoring to identify affected files and tests."
---

# Index Repo

Spec-aware project indexer that creates a navigation map of any git repository: structure, normative specs, and cross-references spec-to-code-to-test.

## Overview

Two complementary outputs:
- **SPEC_MANIFEST.md** — deterministic, script-generated registry of specs with cross-references (spec-to-code-to-test mapping, gaps, dependencies)
- **PROJECT_INDEX.md** — semantic, Claude-generated navigation map (architecture, modules, entry points, quick start)
- **.index-state.json** — internal state for staleness detection (gitignored)

## Workflow

### 0. Pre-step: Serialize specs without frontmatter

Before running the scanner, check for specs missing frontmatter:

1. Glob for spec files: `docs/**/*.md`, `specs/**/*.md`, `*.spec.md`
2. If no spec files found → skip, proceed to step 1
3. Read each file and check for valid frontmatter (bloc `---` with `id` + `version`)
4. If ALL specs have valid frontmatter → skip, proceed to step 1
5. If specs without frontmatter exist → invoke `/specs-serializer`
6. After serialization, proceed to step 1 with `--force` (files changed on disk, staleness cache is stale)

### 1. Run the deterministic scanner

```bash
bun ~/.claude/scripts/index-repo/src/cli.ts "$PWD"
```

Parse the JSON output from stdout. Possible statuses: `FRESH`, `STALE`, `ERROR`.

Add `--force` to skip staleness check, `--verbose` for progress, `--dry-run` to scan without writing files.

### 1.5. Review & write `validates` globs (semantic enrichment — parallel fan-out)

**Trigger**: Only when Step 1 returns `STALE`. Skip for `FRESH` or `ERROR`.

Claude reviews the scanner's cross-references and writes correct `validates` globs into spec frontmatter. This upgrades convention-based matches to explicit, and catches transversal specs the convention matcher can't handle.

**Parallelism**: this step fans out one sub-agent per spec (single message, N parallel `Agent` tool calls, `subagent_type: Explore`). Each sub-agent handles exactly one spec in isolation. Safe because 1 sub-agent ↔ 1 spec, no shared writes, no cross-spec dependency.

**Zero user interaction**: all decisions are deterministic (see the decision table). No branch pauses for confirmation. Ambiguous cases are handled by conservative defaults (never remove user intent).

#### Input to the parent

From the Step 1 JSON output:
- `crossReferences` — all spec-to-code mappings with `matchStrategy` and `gaps`
- `scanResult.code.files` — full list of code files
- `scanResult.tests.files` — full list of test files

#### Parent: prepare jobs

For each spec in `crossReferences`, build a job payload:
```
{
  spec_path,
  current_validates,          // null or existing array
  convention_matches,         // what the scanner matched by convention
  explicit_matches,           // what an existing validates resolved to (may be ∅ if broken)
  gaps,                       // reported gaps
  candidate_code_files,       // filtered subset (≤ 20 most relevant paths)
}
```

#### Parent: fan out

Spawn all sub-agents in **a single message with multiple `Agent` tool calls** (true parallelism). Each sub-agent receives one job payload and the decision table below.

#### Sub-agent: decision table (deterministic, auto)

| Case | Detection | Action |
|------|-----------|--------|
| No `validates`, convention match correct | scanner's convention paths are accurate | **WRITE** — convert to explicit `validates` |
| No `validates`, convention match wrong/incomplete | Read spec scope + code signatures | **WRITE-CORRECTED** |
| No `validates`, no match, no code exists | legitimate gap | **SKIP** (modified=false) |
| Meta-spec (structure/process, not code behavior) | spec describes workflow or conventions | **SKIP** (modified=false) |
| `validates` exists, all paths resolve to real files, coherent with spec scope | healthy | **SKIP** (modified=false) |
| `validates` exists, ≥1 path resolves to ∅ on disk (broken glob) | factually broken | **AUTO-FIX** — rewrite with valid paths |
| `validates` exists, all paths valid, but missing obvious convention matches | incomplete | **AUTO-EXTEND** — append missing paths, never remove existing ones |
| `validates` exists, divergent from convention but all paths valid & coherent | deliberate user choice | **SKIP** (respect user intent, modified=false) |

**Glob rules**:
- Specific files when few (`src/types.ts`), globs for multiplying test files (`tests/phase-a*.test.ts`).
- Never write a path that doesn't exist on disk.
- Patterns must be compatible with `Bun.Glob`.

#### Sub-agent: return value

Structured result — no prose, no side effects outside its own spec's frontmatter:
```json
{
  "spec": "docs/auth.spec.md",
  "action": "write | write-corrected | auto-fix | auto-extend | skip",
  "modified": true | false,
  "rationale": "one short line"
}
```

#### Parent: aggregate

1. Collect all sub-agent results.
2. `anyModified = results.some(r => r.modified)`.
3. Print a compact summary — one line per spec, grouped by action:
   ```
   Step 1.5 — enrichment summary:
     write           : 8 specs
     write-corrected : 2 specs
     auto-fix        : 1 spec  (docs/billing.spec.md — broken glob rewritten)
     auto-extend     : 1 spec  (docs/auth.spec.md — added tests/auth-mfa*.test.ts)
     skip            : 8 specs
   ```
4. If `anyModified` → proceed to Step 1.6. Otherwise proceed to Step 2 with Step 1's output.

#### Safety properties

- **1 sub-agent ↔ 1 spec** — no concurrent writes to the same file.
- **Writes confined to the spec's own frontmatter** — no other files touched.
- **`AUTO-EXTEND` never removes existing paths** — cannot erase user intent.
- **`AUTO-FIX` only triggers when paths resolve to ∅** — factually broken, not an opinion.
- **Divergent-but-valid `validates` are respected** — manual user choices are preserved.
- **All changes are reviewable via `git diff` on spec files** before commit.

### 1.6. Re-run scanner (second pass)

Only if Step 1.5 modified any spec files.

```bash
bun ~/.claude/scripts/index-repo/src/cli.ts "$PWD" --force
```

Parse the new JSON output. This replaces the Step 1 output for all subsequent steps. The scanner now finds explicit `validates` in frontmatter → cross-references are accurate. `SPEC_MANIFEST.md` is rewritten with correct data.

### 2. Handle result by status

**FRESH** — Index is up to date. Read `PROJECT_INDEX.md` and `SPEC_MANIFEST.md` silently for navigation context. Confirm briefly: "Index frais, chargé."

**ERROR** — Inform user (likely not a git repo). Do not attempt recovery.

**STALE** — At this point, `SPEC_MANIFEST.md` has been written (by Step 1 or Step 1.6 if validates were enriched). Generate `PROJECT_INDEX.md`:

1. Read `SPEC_MANIFEST.md` to confirm it was generated
2. Read key project files for architecture understanding:
   - README.md (if exists)
   - Main entry points (max 3-5 files from scan.code)
   - 1 file per major module to understand API surface
3. Generate `PROJECT_INDEX.md` following the format in `references/project-index-format.md`

**Edge case**: If `PROJECT_INDEX.md` + `SPEC_MANIFEST.md` don't exist but status is `FRESH`, re-run with `--force` then treat as STALE.

### 3. Constraints

- Keep `PROJECT_INDEX.md` under 10K tokens
- If `tokenWarning=true` in scan output, use more concise descriptions
- Group files by module when > 50 files (never list individually)

## Staleness Detection

Uses `git write-tree` to hash the staging area. Compares with stored hash in `.index-state.json`. STALE if hash differs, working tree is dirty, or no stored state exists. No arbitrary timers.

## Spec Frontmatter Convention

Spec files in `docs/` or `specs/` directories can include YAML frontmatter:

```yaml
---
id: SPEC-001
version: 2.3
scope: OAuth2 + session management
depends_on: [SPEC-002, SPEC-004]
validates: [src/auth/*, src/session/*]
---
```

- `id` + `version` required for indexing
- `validates` enables explicit code mapping (glob patterns)
- Without frontmatter, specs appear as "Unindexed" in manifest
- Without `validates`, convention-based matching is used (filename stem to directory)
- Step 1.5 auto-populates `validates` by reviewing cross-refs and spec/code content. After first enrichment, most specs have explicit validates.
- Manually-set `validates` are respected — Step 1.5 will not overwrite without warning.

## Cross-Reference Strategy

1. **Explicit** (priority): `validates` field glob-matched against code/test files
2. **Convention** (fallback): spec filename stem matched to directories (`auth-flow.md` to `src/auth/`, `tests/auth/`)
3. **Mixed**: both explicit and convention matches combined

**Enrichment loop**: Convention matching is a bootstrapping mechanism. On the first run (or when specs/code change), Step 1.5 reviews all cross-refs, upgrades convention matches to explicit `validates` in frontmatter, and catches transversal specs. Subsequent runs find these validates and use the "explicit" strategy directly.

## Additional Resources

### Reference Files

For detailed PROJECT_INDEX.md formatting:
- **`references/project-index-format.md`** — Complete template and section guide for generating PROJECT_INDEX.md

### CLI Source
 
The scanner package lives at `~/.claude/scripts/index-repo/`. Architecture details in its `CLAUDE.md`.
