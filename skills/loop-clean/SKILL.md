---
name: loop-clean
description: >
  Runs a deterministic post-implementation loop over every uncommitted change
  in the nearest Git repository. Uses coding-standards, senior-review,
  dedup-codebase, and runtime-gate reports, then routes actionable findings
  through fix-or-backlog until clean, handled, oscillating, or capped.
---

# Loop Clean

Delegate the complete run to the `loop-clean-orchestrator` agent. Do not execute
semantic review steps in the parent session.

## Invocation contract

Accept `/loop-clean` with no mode argument. Reject unknown arguments clearly.
In particular, do not reinterpret an extra argument as a different scope.

A run has exactly one scope:

- Resolve the nearest Git repository once at initialization.
- Include every staged, unstaged, untracked, renamed, copied, deleted, and
  unmerged change in that repository.
- Exclude Git-ignored paths.
- Recompute the manifest at every iteration.
- Bind both Git status metadata and current path contents into the manifest
  `digest`; persist the independent `content_digest` for fail-closed checks.
- Keep ledger paths in the manifest with `eligible_for_audit=false`.
- Never cross into a nested repository or submodule. Run loop-clean from that
  repository when it needs its own audit.

## Procedure

Invoke the pinned orchestrator without overriding its model or effort:

```text
Agent({
  subagent_type: "loop-clean-orchestrator",
  description: "Run /loop-clean",
  prompt: "Run the complete loop-clean protocol in the nearest Git repository. Continue until a terminal EXIT_* action, always finalize, and return the finalize report verbatim."
})
```

Return the orchestrator's final Markdown report without adding a second,
potentially inconsistent summary.

## Invariants

- Treat `scope.json` as the only scope definition for an iteration.
- Treat `findings.json` as the only decision and routing input.
- Require exactly four canonical sources: `coding-standards`, `senior-review`,
  `dedup-codebase`, and `runtime-gate`.
- Run the runtime gate before collection and before decision.
- Write `backlog.md` and `design-queue.md` only through their absolute paths at
  the resolved Git root.
- Never alter HEAD or the Git index.
- Never create repository history or publish repository state.
- Report protocol violations instead of attempting automatic recovery.
