# Nightly Clean — Claude Session Prompt

You are running inside a GitHub Actions sandbox clone of a target repository. The runner has already:
- Cloned the target repo at branch `claude/nightly-clean` (reset to origin default)
- Materialized `.claude/` with agents, skills, scripts from the dotclaude repo
- Installed the Claude Code CLI
- Completed pre-flight checks (skip conditions already evaluated — if we are here, we proceed)

Your job: run `/loop-clean` and `/backlog-deep-crush` on this repo, then produce a final report. Do NOT push, do NOT create PRs, do NOT merge — the GHA post step handles remote git operations.

## STEP 1 — /loop-clean

SET ENV VARIABLE before starting:
```
export LOOP_CLEAN_COMMIT_PER_ITER=1
```
This enables per-iteration commits inside `/loop-clean`, producing a segmented, reviewable history in the nightly PR (each iter = one commit with Applied / Escalated / Notes sections).

Execute the full procedure documented in `.claude/skills/loop-clean/SKILL.md`. Read that SKILL.md and follow it point by point.

IMPORTANT:
- After running `loop-clean.sh init`, parse the stdout for the three variables `LOOP_CLEAN_RUN_DIR`, `LOOP_CLEAN_BASE_SHA`, `LOOP_CLEAN_SESSION_ID` and **export them** before any subsequent `loop-clean.sh` invocation. Without this, each prepare-iter/decide/finalize call creates a new run dir and iterations do not chain.
- `/loop-clean` orchestrates: senior-review → dedup-codebase → spec-drift → fix-or-backlog. Iterations are capped at 10. Exit on `EXIT_CLEAN`, `EXIT_OSCILLATION`, or `EXIT_CEILING`.

## STEP 2 — /backlog-deep-crush

Export before starting:
```
export DEEP_CRUSH_NOCTURNAL=1
```

Execute the full procedure documented in `.claude/skills/backlog-deep-crush/SKILL.md`.

IMPORTANT:
- After running `backlog-deep-crush.sh init`, parse stdout for `BACKLOG_DEEP_CRUSH_SESSION_ID` and **export it** before any subsequent `backlog-deep-crush.sh` invocation. Without this, each next-item / mark-done / decide call creates a new run dir and `EXIT_STABLE` does not fire — cycles do not chain.
- The skill processes all 5 severities (critical → major → notable → minor → nit) in strict priority order, invoking `/loop-clean` between cycles. Exit on `EXIT_DONE`, `EXIT_CEILING` (80 cycles), or `EXIT_STABLE` (3 cycles without strict decrease in pending count).

## STEP 3 — Final report

Print a concise summary block matching this format:

```
NIGHTLY_CLEAN_REPORT:
  LOOP_CLEAN_STATUS=<EXIT_CLEAN|EXIT_OSCILLATION|EXIT_CEILING>
  LOOP_CLEAN_ITERATIONS=<n>
  LOOP_CLEAN_FIXES_APPLIED=<n>
  BACKLOG_DEEP_CRUSH_STATUS=<EXIT_DONE|EXIT_CEILING|EXIT_STABLE>
  BACKLOG_DEEP_CRUSH_CYCLES=<n>
  BACKLOG_ITEMS_CLOSED=<n>
  VERBATIM_ERRORS=<any error text or "none">
```

## Constraints

- Do NOT `git push` — the GHA post step handles that.
- Do NOT `gh pr create` or `gh pr merge` — the GHA post step creates/updates the PR; a human reviews and merges.
- Do NOT `git checkout` another branch — stay on `claude/nightly-clean`.
- Commits produced by `/loop-clean` (with `LOOP_CLEAN_COMMIT_PER_ITER=1`) stay local to the runner — the GHA post step pushes them as-is.
- If any step fails with an unclear error, halt and print the error verbatim — no improvisation.
- If both `/loop-clean` and `/backlog-deep-crush` produce zero changes, print `NIGHTLY_CLEAN_REPORT: NO_CHANGES` and exit — the GHA post step will skip pushing and just comment on the existing PR.
