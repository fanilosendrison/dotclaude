---
name: dedup-codebase
description: >
  Audits duplication, dead code, and oversized files with the loop-clean scope
  as subject and the complete repository as comparison corpus. Emits a report
  carrying the exact iteration scope digest.
---

# Dedup Codebase

Find structural duplication, dead code, and oversized subject files without
modifying repository content.

## Scope contract

### Loop-clean mode

Require and validate:

```text
LOOP_CLEAN_REPO_ROOT
LOOP_CLEAN_SCOPE_FILE
LOOP_CLEAN_SCOPE_DIGEST
LOOP_CLEAN_JSON_OUT
```

Require the manifest root and digest to match the environment. Select only
entries with `eligible_for_audit=true`. The subject scope is the current
uncommitted manifest; never replace it with a source-tree glob.

The complete repository remains available as read-only comparison corpus.
Apply these normative boundaries:

- `duplication-intra`: inspect only existing subject files.
- `oversized-file`: inspect only existing subject files.
- `dead-code`: the reported symbol must be located in an existing subject
  file; search usages across the complete repository.
- `duplication-inter`: at least one side of every reported pair must be an
  existing subject file.
- Never emit a finding exclusively about two unchanged files.
- Do not scan deleted file content. A deletion receives a finding only when a
  separately demonstrated impact belongs to another canonical review axis.

### Standalone mode

Allow an explicit target path and extension set. Standalone mode may audit the
complete target but must not change loop-clean scope semantics.

## Procedure

1. Read the manifest and build the existing subject file set.
2. Count lines only for subject files and identify those above `max_lines`
   (default 400).
3. Dispatch one `dedup-intra` agent per subject file.
4. Dispatch `dedup-inter` with both the subject set and repository comparison
   corpus. Require every emitted cluster to name at least one subject path.
5. Search complete-repository usages for symbols declared in subject files
   before emitting dead-code findings.
6. Propose concrete extraction, deletion, or split plans.
7. Consolidate and validate all findings.

Do not override pinned sub-agent models or efforts.

## Output

Write to `LOOP_CLEAN_JSON_OUT`:

```json
{
  "skill": "dedup-codebase",
  "scope_digest": "sha256",
  "verdict": "CLEAN",
  "findings": [],
  "summary": {
    "critical": 0,
    "major": 0,
    "notable": 0,
    "minor": 0,
    "nit": 0
  },
  "blocking": false
}
```

Allowed axes are `duplication-intra`, `duplication-inter`, `dead-code`, and
`oversized-file`. Use stable IDs:

```text
sha256([source, file, String(line_start ?? ""), axis, problem.slice(0, 80)].join("|")).slice(0, 16)
```

Copy `LOOP_CLEAN_SCOPE_DIGEST` exactly as `scope_digest`. Fail closed if the
manifest or digest is invalid.
