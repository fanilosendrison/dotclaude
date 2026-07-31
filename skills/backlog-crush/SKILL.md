---
name: backlog-crush
description: >
  Processes unchecked critical and major items from backlog.md at the resolved
  Git root, invoking loop-clean between bounded fix cycles.
---

# Backlog Crush

Delegate the complete run to `backlog-crush-orchestrator` without overriding
its pinned model or effort.

## Trigger

Run when requested explicitly, or after loop-clean when the Git-root backlog
contains unchecked critical or major items. Do not run when no such item exists
or while another implementation is still in progress.

## Root contract

The technical script resolves:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
BACKLOG_PATH="$REPO_ROOT/backlog.md"
```

Never assume the current directory is the repository root. Runtime state also
lives below the resolved root's `.claude/run/` directory.

## Procedure

```text
Agent({
  subagent_type: "backlog-crush-orchestrator",
  description: "Run /backlog-crush",
  prompt: "Run backlog-crush for critical and major items at the resolved Git root. Invoke loop-clean between cycles until EXIT_DONE, EXIT_CEILING, or EXIT_STABLE, then return finalize output with consolidated fix-agent notes."
})
```

Return the orchestrator report verbatim.
