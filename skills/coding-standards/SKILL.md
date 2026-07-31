---
name: coding-standards
description: >
  Audits implementation quality on naming, typing, maintainability, comments,
  error handling, and immutability. In loop-clean mode it consumes the shared
  scope manifest and emits a report carrying the same scope digest.
---

# Coding Standards

Run one mechanical pass and one semantic pass over exactly the eligible,
existing source and test files in the supplied scope.

## Scope

### Loop-clean mode

Require `LOOP_CLEAN_SCOPE_FILE`, `LOOP_CLEAN_SCOPE_DIGEST`,
`LOOP_CLEAN_REPO_ROOT`, and `LOOP_CLEAN_JSON_OUT`.

1. Parse and validate `LOOP_CLEAN_SCOPE_FILE`.
2. Require its `repo_root` to equal `LOOP_CLEAN_REPO_ROOT`.
3. Require its `digest` to equal `LOOP_CLEAN_SCOPE_DIGEST`.
4. Select only entries with `eligible_for_audit=true` and `exists=true`.
5. Select only recognized source and test extensions.
6. Do not scan deleted content and do not emit a mechanical finding merely
   because an entry is deleted.

Do not derive another file list from Git.

### Standalone mode

Allow an explicit target path or a complete source-tree audit. Standalone mode
must not alter the loop-clean manifest contract.

## Mechanical pass

Run from the resolved repository root:

```bash
bun ~/.claude/scripts/coding-standards-scanner/src/cli.ts \
  --scope-file="$LOOP_CLEAN_SCOPE_FILE" \
  --output="$RUN_DIR/scanner.json"
```

The scanner validates the manifest, filters existing code files, runs supported
linters and deterministic grep rules, and writes `scope_digest` into its report.
Missing optional linters may produce a warning and skip that linter, but invalid
scope or JSON is a hard failure.

## Semantic pass

Dispatch one `coding-standards-file` agent per selected file. Include the
manifest path and digest in every prompt:

```text
CODING_STANDARDS_FILE_JSON_OUT=<unique path>
LOOP_CLEAN_SCOPE_FILE=<manifest path>
LOOP_CLEAN_SCOPE_DIGEST=<digest>
Audit <repository-relative file>.
```

Require every per-file JSON report to copy the exact digest. The semantic agent
must not duplicate mechanical rules.

## Consolidation

Run:

```bash
bun ~/.claude/scripts/coding-standards-consolidate/src/cli.ts \
  --scanner-json="$RUN_DIR/scanner.json" \
  --files-json-dir="$RUN_DIR/files" \
  --output="$LOOP_CLEAN_JSON_OUT"
```

The consolidator must fail when any input is invalid or has a divergent digest.
It merges findings, validates IDs, recomputes severity totals and blocking, and
emits one report:

```json
{
  "skill": "coding-standards",
  "scope_digest": "sha256",
  "verdict": "CLEAN",
  "findings": [],
  "summary": {
    "critical": 0,
    "major": 0,
    "notable": 0,
    "minor": 0,
    "nit": 0,
    "design": 0
  },
  "blocking": false
}
```

## Semantic axes

- `naming`: names that misrepresent behavior.
- `typing`: incoherent contracts or invalid weak-type justification.
- `maintainability`: unnecessarily opaque or multi-responsibility code.
- `comments`: stale comments or missing rationale for non-obvious invariants.
- `error-handling`: untraceable or inappropriate error contracts.
- `immutability`: unjustified domain mutation or hidden impurity.

Do not emit duplication or dead-code findings; `dedup-codebase` owns those.
Do not emit demonstrated runtime or behavioral correctness findings;
`senior-review` owns those, including contract-coherence problems that require
semantic evidence.

## Stable IDs

Use the canonical formula:

```text
sha256([source, file, String(line_start ?? ""), axis, problem.slice(0, 80)].join("|")).slice(0, 16)
```

Keep `problem` stable, affirmative, and free of timestamps or iteration
numbers.
