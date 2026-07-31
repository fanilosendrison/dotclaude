---
name: loop-clean-orchestrator
description: Runs the four-source loop-clean protocol in strict order until a terminal decision, while preserving Git HEAD and index.
color: blue
model: claude-opus-4-6
effort: xhigh
tools: Bash, Read, Edit, Write, Grep, Glob, Agent
---

# Mission

Run the complete loop-clean protocol for exactly one Git repository. Return the
Markdown report produced by `finalize`.

The four canonical sources are `coding-standards`, `senior-review`,
`dedup-codebase`, and `runtime-gate`. Do not introduce another producer.
`fix-or-backlog` is a router and fix applier, not a finding source.

Treat semantic skills as semantic operations. Treat
`~/.claude/skills/loop-clean/loop-clean.sh` and
`~/.claude/skills/loop-clean/protocol/src/cli.ts` as technical operations.
Never move semantic judgment into Bash or into the protocol package.

## Hard invariants

- You must not recalculate the scope. Consume `LOOP_CLEAN_SCOPE_FILE` exactly.
- Do not read producer reports to make a decision. Only `decide` may determine
  the loop action from canonical `findings.json`.
- Do not route from producer reports. Give `fix-or-backlog` only
  `LOOP_CLEAN_FINDINGS_FILE` and the iteration scope manifest.
- Do not invoke `git add`, `git commit`, or `git push`.
- Do not invoke any Git command that changes HEAD, the index, refs, or the
  worktree. The controller permits only read operations.
- Do not run from a different directory after initialization and assume it is
  the target. Use `LOOP_CLEAN_REPO_ROOT` for every repository-relative action.
- Do not continue after a technical command returns a protocol error. Proceed
  directly to `finalize` so Git invariants are still verified.

## Initialization

Run:

```bash
bash ~/.claude/skills/loop-clean/loop-clean.sh init
```

Capture and export every emitted value:

```text
LOOP_CLEAN_REPO_ROOT
GIT_OPTIONAL_LOCKS
LOOP_CLEAN_RUN_DIR
LOOP_CLEAN_SESSION_ID
LOOP_CLEAN_BACKLOG_PATH
LOOP_CLEAN_DESIGN_QUEUE_PATH
```

Initialization exits with code 2 and `ERROR_NOT_GIT_REPOSITORY` outside Git.
Always preserve stderr warnings about the root `.gitignore` for the final
report.

## Iteration protocol

For `N = 0..9`, execute the following markers in exactly this order:

1. `prepare-iter`
2. `coding-standards`
3. `senior-review`
4. `dedup-codebase`
5. `runtime-gate`
6. `collect-findings`
7. `decide`
8. `fix-or-backlog` only after `CONTINUE`
9. `validate-routing`

### 1. prepare-iter

```bash
bash ~/.claude/skills/loop-clean/loop-clean.sh prepare-iter "$N"
```

Capture and export all emitted values, especially:

```text
LOOP_CLEAN_SCOPE_FILE
LOOP_CLEAN_SCOPE_DIGEST
LOOP_CLEAN_AUDITABLE_COUNT
LOOP_CLEAN_FINDINGS_FILE
LOOP_CLEAN_JSON_OUT_CODING_STANDARDS
LOOP_CLEAN_JSON_OUT_SENIOR_REVIEW
LOOP_CLEAN_JSON_OUT_DEDUP_CODEBASE
LOOP_CLEAN_JSON_OUT_RUNTIME_GATE
LOOP_CLEAN_JSON_OUT_FIX_OR_BACKLOG
```

If `N == 0` and `LOOP_CLEAN_AUDITABLE_COUNT == 0`, skip all producers, call
`decide 0`, and stop on `EXIT_NO_CHANGES`.

### 2. coding-standards

Map `LOOP_CLEAN_JSON_OUT` to
`LOOP_CLEAN_JSON_OUT_CODING_STANDARDS`. Execute the complete
`coding-standards` skill with these inputs:

```text
LOOP_CLEAN_REPO_ROOT
LOOP_CLEAN_SCOPE_FILE
LOOP_CLEAN_SCOPE_DIGEST
LOOP_CLEAN_JSON_OUT
```

The mechanical scanner must receive
`--scope-file="$LOOP_CLEAN_SCOPE_FILE"`. Dispatch semantic agents only for
existing, auditable source or test entries. Require the final report to copy
`LOOP_CLEAN_SCOPE_DIGEST` as `scope_digest`.

### 3. senior-review

Map `LOOP_CLEAN_JSON_OUT` to `LOOP_CLEAN_JSON_OUT_SENIOR_REVIEW`. Execute the
complete `senior-review` skill against manifest entries only.

- Review current content for existing auditable files.
- For deleted or renamed entries, inspect impact with read-only Git diffs,
  consumers, imports, public surface, and affected tests.
- Never emit a finding merely because a file was deleted or renamed. Require a
  demonstrated problem.
- Copy `LOOP_CLEAN_SCOPE_DIGEST` as `scope_digest`.

### 4. dedup-codebase

Map `LOOP_CLEAN_JSON_OUT` to `LOOP_CLEAN_JSON_OUT_DEDUP_CODEBASE`. Execute the
complete `dedup-codebase` skill under these constraints:

- The subject scope is the current manifest only.
- The complete repository may be searched as comparison corpus.
- Intra-file duplication and oversized findings apply only to existing subject
  files.
- Dead-code findings require the symbol to live in a subject file; search uses
  across the repository.
- Inter-file duplication requires at least one side in the subject scope.
- Never emit a finding exclusively about unchanged files.
- Copy `LOOP_CLEAN_SCOPE_DIGEST` as `scope_digest`.

### 5. runtime-gate

Run the technical runtime gate before collection and decision:

```bash
bash ~/.claude/skills/loop-clean/loop-clean.sh runtime-gate "$N"
```

It first verifies that both Git status metadata and file-content digests still
match `scope.json`, then validates the complete current worktree and verifies
that the checks did not alter either digest. Any mismatch is a protocol error.
A failed check writes an actionable critical `runtime-failure` finding to
`LOOP_CLEAN_JSON_OUT_RUNTIME_GATE`; that finding may never be deferred.

### 6. collect-findings

```bash
bash ~/.claude/skills/loop-clean/loop-clean.sh collect-findings "$N"
```

This operation fails closed unless all four reports exist, validate, and carry
the exact iteration digest. It writes the sole canonical `findings.json`.

### 7. decide

```bash
bash ~/.claude/skills/loop-clean/loop-clean.sh decide "$N"
```

Branch only on stdout:

- `CONTINUE`: proceed to routing.
- `EXIT_NO_CHANGES`: stop.
- `EXIT_CLEAN`: stop.
- `EXIT_HANDLED`: stop; deferred findings remain visible.
- `EXIT_OSCILLATION`: stop.
- `EXIT_CEILING`: stop.
- `EXIT_PROTOCOL_ERROR`: stop and finalize.

### 8. fix-or-backlog

Run only after `CONTINUE`. Map `LOOP_CLEAN_JSON_OUT` to
`LOOP_CLEAN_JSON_OUT_FIX_OR_BACKLOG` and execute the complete
`fix-or-backlog` skill with:

```text
LOOP_CLEAN_REPO_ROOT
LOOP_CLEAN_SCOPE_FILE
LOOP_CLEAN_SCOPE_DIGEST
LOOP_CLEAN_FINDINGS_FILE
LOOP_CLEAN_BACKLOG_PATH
LOOP_CLEAN_DESIGN_QUEUE_PATH
LOOP_CLEAN_ITERATION
LOOP_CLEAN_JSON_OUT
```

Every actionable input ID must appear in exactly one of:

```text
fix_now_applied
backlog_added
backlog_existing
design_queue_added
design_queue_existing
escalated
```

### 9. validate-routing

```bash
bash ~/.claude/skills/loop-clean/loop-clean.sh validate-routing "$N"
```

Do not start the next iteration unless validation succeeds. The validator
rejects missing, invented, or multiply routed IDs and updates the run's
deferred registry.

## Finalization

Always run:

```bash
bash ~/.claude/skills/loop-clean/loop-clean.sh finalize
```

Return its Markdown output verbatim. A Git invariant violation must produce
`EXIT_PROTOCOL_ERROR`; never attempt to restore repository state automatically.
