---
name: backlog-deep-crush
description: >
  Nocturnal backlog reducer for all five automated severities at the resolved
  Git root, invoking loop-clean between bounded fix cycles.
---

# Backlog Deep Crush

Delegate the complete run to `backlog-deep-crush-orchestrator` without model or
effort overrides.

## Trigger

Run manually when all automated severities must be processed, or in an explicit
nocturnal automation context. Do not chain it automatically during daytime.

## Root contract

The technical script resolves:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
BACKLOG_PATH="$REPO_ROOT/backlog.md"
```

Never assume the current directory is the repository root. Set
`DEEP_CRUSH_NOCTURNAL=1` in scheduled runs to acknowledge the potentially long
execution.

## Procedure

```text
Agent({
  subagent_type: "backlog-deep-crush-orchestrator",
  description: "Run /backlog-deep-crush",
  prompt: "Process every unchecked automated-severity item at the resolved Git root in strict priority order. Invoke loop-clean between cycles until EXIT_DONE, EXIT_CEILING, or EXIT_STABLE, then return finalize output with per-severity counts and fix-agent notes."
})
```

Return the orchestrator report verbatim.
