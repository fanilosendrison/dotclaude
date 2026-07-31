# Nightly Clean Session Prompt

Run inside the checked-out target repository. The automation layer owns any
later publication step; this session must not create or publish repository
history.

## Step 1: loop-clean

Read `.claude/skills/loop-clean/SKILL.md` and execute its complete procedure.
Capture and export every variable emitted by `loop-clean.sh init`, especially
the resolved repository root, run directory, session ID, and absolute ledger
paths.

The loop processes all uncommitted, non-ignored changes in one repository. It
uses exactly four canonical reports, runs the runtime gate before decision, and
stops on any terminal action:

```text
EXIT_NO_CHANGES
EXIT_CLEAN
EXIT_HANDLED
EXIT_OSCILLATION
EXIT_CEILING
EXIT_PROTOCOL_ERROR
```

Do not continue to backlog reduction after a protocol error.

## Step 2: backlog-deep-crush

Set:

```bash
export DEEP_CRUSH_NOCTURNAL=1
```

Read `.claude/skills/backlog-deep-crush/SKILL.md` and execute its complete
procedure. Capture and export the session values emitted by initialization.
The technical script resolves `backlog.md` from the Git root, not from the
current directory.

## Step 3: report

Print:

```text
NIGHTLY_CLEAN_REPORT:
  LOOP_CLEAN_STATUS=<terminal action>
  LOOP_CLEAN_ITERATIONS=<n>
  LOOP_CLEAN_FIXES_APPLIED=<n>
  BACKLOG_DEEP_CRUSH_STATUS=<EXIT_DONE|EXIT_CEILING|EXIT_STABLE|NOT_RUN>
  BACKLOG_DEEP_CRUSH_CYCLES=<n>
  BACKLOG_ITEMS_CLOSED=<n>
  VERBATIM_ERRORS=<error text or none>
```

## Constraints

- Do not publish, merge, or change branches.
- Do not alter Git HEAD or the index during loop-clean.
- Halt on an unclear technical error and report it verbatim.
- If both stages make no worktree changes, report `NO_CHANGES`.
