---
name: senior-review
description: >
  Performs hostile semantic review of the shared loop-clean scope, including
  current content and demonstrated rename or deletion impact, and emits a
  scope-bound canonical findings report without modifying files.
---

# Senior Review

Review only the subject entries in the supplied manifest while using the full
repository as read-only impact context.

## Scope contract

### Loop-clean mode

Require `LOOP_CLEAN_SCOPE_FILE`, `LOOP_CLEAN_SCOPE_DIGEST`,
`LOOP_CLEAN_REPO_ROOT`, and `LOOP_CLEAN_JSON_OUT`.

1. Parse and validate the manifest.
2. Require `repo_root` and `digest` to match the environment exactly.
3. Ignore entries with `eligible_for_audit=false`.
4. Review current content for every eligible existing source or test file.
5. Review deleted and renamed entries through read-only Git diffs, imports,
   consumers, public surface, cross-references, and affected tests.
6. Do not turn deletion or rename into an automatic finding. Emit only a
   demonstrated behavioral, compatibility, or verification problem.
7. Do not derive an independent subject file list.

Use read-only Git commands with the resolved root, for example:

```bash
git -C "$LOOP_CLEAN_REPO_ROOT" diff HEAD -- "$path"
```

For an untracked file, review the complete current content. For a repository
without HEAD, treat every existing subject file as entirely new.

### Standalone mode

Allow an explicitly supplied file or source-tree review. Keep standalone scope
separate from loop-clean artifacts.

## Dispatch

Dispatch one `senior-review-file` agent for each existing subject file. For a
removed or renamed path, give an agent the manifest entry, diff, and impact
context rather than asking it to read nonexistent content.

Do not override the agent's pinned model or effort. Propagate findings without
rephrasing their stable `problem` field.

## Review axes

Audit these semantic axes:

- `cheat-detection`
- `edge-cases`
- `subtle-regression`
- `error-paths`
- `performance`
- `substrate-resilience`
- `input-contract-boundary`
- `tests-substance`
- `cross-ref-impact`
- `naming-readability`
- `api-surface`
- `contract-coherence`

`contract-coherence` covers a demonstrated mismatch between current behavior
and an explicit contract or invariant. It is a semantic review axis, not an
automatic document-to-code scanner. Require concrete evidence and preserve the
generic safety rule that ambiguous public or normative changes need human
design review.

Do not emit mechanical typing, formatting, unused import, duplication, or dead
code findings; the other canonical producers own them.

## Consolidation

For each finding, preserve:

```text
id
source=senior-review
axis
severity
file
line_start
line_end
problem
evidence
fix_proposal
observable_change
```

Use the canonical stable ID formula:

```text
sha256([source, file, String(line_start ?? ""), axis, problem.slice(0, 80)].join("|")).slice(0, 16)
```

Write one JSON report to `LOOP_CLEAN_JSON_OUT` and copy the manifest digest:

```json
{
  "skill": "senior-review",
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

Fail closed when the scope is invalid or the output cannot carry the exact
`scope_digest`.
