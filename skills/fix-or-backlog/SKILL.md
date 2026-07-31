---
name: fix-or-backlog
description: >
  Routes canonical findings into immediate fixes, the Git-root backlog, the
  Git-root design queue, or explicit escalation. In loop-clean mode it reads
  only findings.json and emits an exact ID partition for technical validation.
---

# Fix or Backlog

Classify each finding, apply safe immediate fixes, persist deferred work only
when needed, and emit an exact routing partition.

## Inputs

### Loop-clean mode

When `LOOP_CLEAN_FINDINGS_FILE` is set, read findings only from:

```text
$LOOP_CLEAN_FINDINGS_FILE
```

Also require:

```text
LOOP_CLEAN_REPO_ROOT
LOOP_CLEAN_SCOPE_FILE
LOOP_CLEAN_SCOPE_DIGEST
LOOP_CLEAN_BACKLOG_PATH
LOOP_CLEAN_DESIGN_QUEUE_PATH
LOOP_CLEAN_ITERATION
LOOP_CLEAN_JSON_OUT
```

Validate the canonical JSON, require its `scope_digest` to equal
`LOOP_CLEAN_SCOPE_DIGEST`, and route only `actionable_findings[]`. Do not route
`previously_deferred_findings[]` again.

### Standalone mode

Use findings explicitly supplied in the current conversation. If none are
available, ask for a review instead of guessing.

## Fresh-code classification

In loop-clean mode, a file is fresh when its path is present in
`LOOP_CLEAN_SCOPE_FILE`.

Determine whether the exact finding region changed with a read-only diff:

```bash
git -C "$LOOP_CLEAN_REPO_ROOT" diff HEAD -- "$file"
```

Apply these edge rules:

- An untracked file is fresh in its entirety.
- In a repository without HEAD, every existing manifest file is fresh in its
  entirety.
- A deleted path has no current content to edit. Route only a demonstrated
  impact finding; never treat deletion itself as a defect.
- A renamed path uses its current `path` plus `original_path` for impact review.

## Decision framework

Classify each actionable finding on two axes.

| Concern | Fresh code | Pre-existing code |
|---------|------------|-------------------|
| Correctness | Fix now | Fix now when bounded; otherwise backlog |
| Hygiene | Fix now when bounded | Backlog |

Apply these overrides before the matrix:

- Route every `runtime-failure` to `fix_now_applied`. Never defer it.
- Fix every demonstrated critical or major correctness defect now.
- Fix a test that does not test its claimed behavior now.
- Fix demonstrated duplication now when the complete refactor fits a coherent
  file cluster.
- Backlog pre-existing style, documentation hygiene, cold-path performance,
  and work that requires a separate multi-system task.
- Escalate only a genuinely ambiguous finding that cannot safely enter either
  automated queue.

Do not classify by source name alone. Use the demonstrated impact, freshness,
severity, and boundedness.

## Generic safety gates

Apply these gates to every proposed immediate fix:

1. Do not automatically relax an explicit normative requirement.
2. Do not modify `specs/` and `src/` together when the direction of an
   ambiguous alignment is not already established.
3. Do not automatically change a public API surface or a re-exported public
   type.

Route a gate-blocked item to the design queue or `escalated`, with a concrete
reason and decision required. These are safety constraints, not an automatic
code-to-document comparison system.

## Applying immediate fixes

Build connected file clusters from every finding's affected files. Findings
that share a file belong to the same cluster, transitively.

- Apply a single-file cluster directly only when the change is local and
  unambiguous.
- Dispatch one `fix-file` agent per disjoint multi-file cluster.
- Never allow parallel clusters to edit the same file.
- Record a finding under `fix_now_applied` only after its complete fix was
  actually applied.
- Convert a skipped or unsafe fix into an explicit routed outcome; never omit
  its ID.

Do not alter HEAD or the Git index and do not publish repository state.

## Ledger paths

Use only these absolute paths:

```text
$LOOP_CLEAN_BACKLOG_PATH
$LOOP_CLEAN_DESIGN_QUEUE_PATH
```

Never append through a path relative to the current directory.

### Backlog creation and deduplication

Create the backlog only when at least one new backlog item must be written. If
it does not exist, start it with exactly:

```markdown
# Backlog
```

Use one atomic line per finding:

```markdown
- [ ] [minor] src/foo.ts:42 — Description (date: YYYY-MM-DD, source: loop-clean, finding_id: abcdef0123456789)
```

Use `finding_id` as the primary deduplication key across unchecked and checked
entries. For legacy lines without a `finding_id`, temporarily fall back to
`file:line` plus the description. Do not rewrite unrelated legacy entries.

- New line written: `backlog_added`.
- Matching line already present: `backlog_existing`.

Both outcomes are deferred dispositions.

### Design queue

Create the design queue only when a new design item must be written. Persist the
finding ID, the blocking gate or ambiguity, and the exact human decision
required.

- New item written: `design_queue_added`.
- Matching item already present: `design_queue_existing`.

Both outcomes are deferred dispositions.

## Output contract

Write valid JSON to `LOOP_CLEAN_JSON_OUT`:

```json
{
  "skill": "fix-or-backlog",
  "iteration": 0,
  "scope_digest": "sha256",
  "fix_now_applied": [],
  "backlog_added": [],
  "backlog_existing": [],
  "design_queue_added": [],
  "design_queue_existing": [],
  "escalated": [],
  "notes": []
}
```

Every category entry must contain the canonical 16-character `finding_id`.
Applied fixes must also list at least one `files_touched` path and a concise
`change_summary`. Backlog entries must include `file`, non-design `severity`, and
`reason`. Design queue entries must include `file` and `reason`. Escalated
entries must include `reason`.

The actionable input ID set must equal the exact union of the six category ID
sets. Categories must be pairwise disjoint. Do not invent, duplicate, or omit
an ID. Technical validation runs immediately after this output is written.
