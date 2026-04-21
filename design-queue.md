# Design Queue

- [ ] [design] skills/loop-clean/loop-clean.sh — 940 lines; consider splitting into loop-clean.sh (core ~400 lines) + loop-clean-test-gate.sh + loop-clean-commit.sh + loop-clean-sweep.sh (date: 2026-04-22, source: dedup-codebase)
- [ ] [escalated] scripts/spec-drift/src/spec-drift.ts:1 — file at 877 lines is oversized (8+ responsibilities); decompose into cli.ts, lib/spec-parser.ts, lib/tsc-runner.ts, lib/hints.ts, lib/ignore.ts, lib/reporter.ts (date: 2026-04-21, source: dedup-codebase)
  - origin_severity: minor
  - origin_id: e4fd1db730121c64
  - skipped_count: 2
  - escalated_on: 2026-04-21
  - why: recurrent defensive skip by backlog-fix after 2 cycle(s). Likely cause: scope too large, spec ambiguity, or pending product decision.
  - cta: examine manually. See `.claude/run/backlog-deep-crush/*/` for sub-agent skip reasons.

