# Code Context

## Files Retrieved

### Core loop-clean implementation

1. `skills/loop-clean/loop-clean.sh` (lines 1-1111) — flow controller for scope modes, sticky `BASE_SHA`, source aggregation, runtime gate, per-iteration commits, backlog sweeping, finalization, and sticky advancement.
2. `skills/loop-clean/SKILL.md` (lines 1-109) — public invocation contract, `diff`/`audit` selection, sticky-anchor lifecycle, and reset behavior.
3. `agents/loop-clean-orchestrator.md` (lines 1-257) — authoritative orchestration ordering and environment-variable/data-flow instructions.
4. `skills/loop-clean/loop-clean-test.sh` (lines 1-263) — manual smoke coverage for `commit-iter`; not wired into the package test suite.

### Scope and `BASE_SHA` consumers

5. `skills/coding-standards/SKILL.md` (relevant lines 43-69, 159-164) — consumes `LOOP_CLEAN_SCOPE` and `LOOP_CLEAN_BASE_SHA`; documents stable scope across intermediate commits.
6. `skills/senior-review/SKILL.md` (relevant lines 43-58, 131-136, 165-218) — independently resolves diff/all scope and emits one of the semantic source reports.
7. `scripts/coding-standards-scanner/src/lib/scope-resolver.ts` (relevant lines 15-45) — executable scope resolution for `diff`, including `LOOP_CLEAN_BASE_SHA`.
8. `scripts/coding-standards-scanner/src/__tests__/scope-resolver.test.ts` (relevant lines 38-99) — tests working-tree/staged behavior, anchored diffs, commit-per-iteration survival, and invalid SHA behavior.
9. `scripts/coding-standards-scanner/src/cli.ts` — CLI entry point that passes the selected scope into the resolver.
10. `scripts/coding-standards-scanner/CLAUDE.md` (relevant line 67) — documents the frozen report contract consumed by loop-clean.
11. `scripts/coding-standards-consolidate/src/cli.ts` (relevant around line 55) — consolidates coding-standard source reports and follows loop-clean’s exit-4 convention.
12. `scripts/coding-standards-consolidate/CLAUDE.md` (relevant lines 45-52) — documents hard-failure and output integration with loop-clean.

### Spec-drift producer and contract

13. `scripts/spec-drift/src/spec-drift.ts` (relevant lines 23-28, 725-829) — emits spec-drift IDs and machine-readable JSON consumed by loop-clean/fix-or-backlog.
14. `scripts/spec-drift/src/__tests__/spec-drift.test.ts` (relevant lines 14-864) — extensive unit coverage, including JSON emission around line 864 onward.
15. `scripts/spec-drift/CLAUDE.md` (relevant lines 19-25, 71-105, 149-176) — documents JSON schema, stable drift IDs, direction hints, normative routing, and consumer obligations.

### Finding schema and oscillation dependencies

16. `scripts/lib/coding-standards-schema/src/types.ts` (lines 5-6) — explicitly freezes report fields against loop-clean’s `jq` queries.
17. `scripts/lib/coding-standards-schema/src/id-hash.ts` (lines 6-11) — stable ID formula is load-bearing for oscillation detection.
18. `scripts/lib/coding-standards-schema/src/__tests__/id-hash.test.ts` (relevant around line 34) — tests stable finding IDs.
19. `scripts/lib/coding-standards-schema/CLAUDE.md` (relevant lines 12, 55-71) — requires schema changes to be coordinated with loop-clean.
20. `scripts/coding-standards-scanner/src/lib/problem-canonicalizer.ts` (lines 1-4 onward) — stabilizes problem text used by loop-clean signatures.
21. `agents/coding-standards-file.md` (relevant lines 27, 281) — requires canonical problem strings for oscillation.
22. `agents/dedup-intra.md` (relevant line 49) — same stability contract for intra-file dedup findings.
23. `agents/dedup-inter.md` (relevant line 49) — same stability contract for cross-file dedup findings.

### Fix-or-backlog inputs and output contract

24. `skills/fix-or-backlog/SKILL.md` (lines 1-576; especially 28-62, 117-244, 273-443, 458-555) — defines orchestrated inputs, fresh-code calculation, spec gates, backlog/design routing, dedup keys, and emitted JSON fields.
25. `agents/fix-file.md` — consumes clustered FIX NOW findings and returns `fixes_applied`, `fixes_skipped`, and `notes`.
26. `agents/backlog-fix.md` (relevant lines 10-39, 117-129) — downstream consumer of individual backlog items; explicitly does not commit.
27. `agents/loop-clean-orchestrator.md` (lines 157-209) — conflicts with the fix-or-backlog skill regarding source count and runtime-gate consumption.

### Backlog path handling and consumers

28. `skills/lib/backlog-common.sh` (lines 1-384) — shared backlog/design-queue mutation, migration, escalation, completion, and archive logic.
29. `skills/backlog-crush/backlog-crush.sh` (lines 1-288) — hard-coded root `backlog.md` consumer for critical/major items.
30. `skills/backlog-deep-crush/backlog-deep-crush.sh` (lines 1-373) — hard-coded root `backlog.md` consumer for all five auto-fixable severities.
31. `skills/backlog-crush/SKILL.md` (relevant lines 4-55) — user-facing critical/major backlog consumer contract.
32. `skills/backlog-deep-crush/SKILL.md` (relevant lines 5-46) — user-facing all-severity backlog consumer contract.
33. `agents/backlog-crush-orchestrator.md` (relevant lines 10-24, 135-162) — invokes loop-clean between cycles and moves stuck items to design queue.
34. `agents/backlog-deep-crush-orchestrator.md` (relevant lines 10-37, 121-151, 182-203) — invokes loop-clean and documents inherited `commit-iter` metadata.
35. `skills/backlog-crush/backlog-crush.sh` (lines 228-234) and `skills/lib/backlog-common.sh` (lines 337-384) — resolved-item archival into root `backlog.archive.md`.
36. `skills/loop-clean/loop-clean.sh` (lines 859-921) — separate age-based backlog archive implementation, also hard-coded to repo root.

### Additional references outside the minimum loop list

37. `skills/senior-review/SKILL.md` (lines 27-37) — declares the full pipeline and loop-clean as its primary consumer.
38. `skills/agent-creator/SKILL.md` (relevant lines 177-236) — example definitions for `backlog-fix` and `loop-clean-orchestrator`; must remain synchronized if the agent contract changes.
39. `skills/nightly-clean-enroll/SKILL.md` (relevant lines 24, 111-158) — points periodic cleanup toward loop-clean/backlog workflows.
40. `skills/nightly-clean-enroll/enroll.sh` — enrollment implementation for the periodic consumer described above.
41. `agents/senior-review-file.md` (relevant lines 54-57) — severity routing semantics, including design-queue.
42. `scripts/new-cc-project-onboarder/.claude/run/loop-clean/13453/base-sha`
43. `scripts/new-cc-project-onboarder/.claude/run/loop-clean/13453/baseline.json`
44. `scripts/new-cc-project-onboarder/.claude/run/loop-clean/13453/scope-mode`
45. `scripts/new-cc-project-onboarder/.claude/run/loop-clean/13523/iter-000/` — checked-in or present runtime-state fixtures/artifacts containing the old run layout; any state-layout refactor must decide whether these are fixtures or accidental artifacts.

### Package test wiring

46. `scripts/package.json` (lines 1-59) — root script package test command includes `spec-drift`, coding-standard schema/scanner/consolidator, and onboarder tests.
47. `scripts/bun.lock` — package lock governing the wired Bun suite.
48. `scripts/tsconfig.json` and `scripts/biome.json` — TypeScript and lint configuration for the wired tests.

## Key Code

### Scope propagation

`skills/loop-clean/loop-clean.sh:266-379`:

- `init --scope=diff|audit` persists `scope-mode`.
- Sticky `BASE_SHA` is written to `$RUN_DIR/base-sha`.
- `prepare-iter` maps user-facing `audit` to child-facing `all`.
- It emits per-source JSON paths plus `runtime-gate.json`.

The executable scanner then reads `LOOP_CLEAN_BASE_SHA` in `scripts/coding-standards-scanner/src/lib/scope-resolver.ts:15-45`.

### Source aggregation

`skills/loop-clean/loop-clean.sh:687-744` counts:

- coding standards
- senior review
- dedup codebase
- spec drift
- current iteration runtime gate

It also hashes all five sources for oscillation.

### Runtime ordering defect

`agents/loop-clean-orchestrator.md:145-209` orders:

1. Four semantic producers
2. `decide`
3. `fix-or-backlog`
4. `test-gate`
5. optional `commit-iter`

However, `loop-clean.sh:687-744` makes `decide N` read `iter-N/runtime-gate.json`. That file is only created later at step 4. On the next iteration, `decide N+1` reads `iter-(N+1)/runtime-gate.json`, not the previous result.

### Fix-or-backlog input mismatch

`agents/loop-clean-orchestrator.md:157-179` says collect four reports, including coding standards.

`skills/fix-or-backlog/SKILL.md:28-44` says orchestrated mode reads only three:

- senior-review
- dedup-codebase
- spec-drift

It omits:

- `coding-standards.json`
- `runtime-gate.json`

### Backlog paths

All operational code uses cwd-relative root paths:

```bash
BACKLOG_FILE="backlog.md"
design_file="design-queue.md"
dst="backlog.archive.md"
```

There is no shared configurable backlog-path input. Path semantics therefore depend on invocation cwd being the repository root.

## Architecture

`loop-clean/SKILL.md` resolves the public mode and delegates to `loop-clean-orchestrator.md`. The orchestrator invokes `loop-clean.sh` for deterministic state transitions while semantic skills emit JSON into per-iteration directories.

The intended data flow is:

```text
coding-standards ─┐
senior-review ────┤
dedup-codebase ───┼─> decide ─> fix-or-backlog ─> runtime gate ─> optional commit
spec-drift ───────┘
```

The implementation additionally tries to aggregate runtime-gate findings into `decide`, but current ordering makes that source unavailable at the decision that reads it.

Fix-or-backlog mutates source files and appends root-level `backlog.md` or `design-queue.md`. Backlog-crush and backlog-deep-crush later consume `backlog.md`, delegate fixes to `backlog-fix`, rerun loop-clean, and move repeatedly skipped items to `design-queue.md`. Both loop-clean and backlog-crush implement archive behavior targeting `backlog.archive.md`.

## Review Findings

- **blocker:** `agents/loop-clean-orchestrator.md:145-209` vs `skills/loop-clean/loop-clean.sh:687-744` — runtime gate is generated after `decide`, but `decide` only reads the current iteration’s runtime report. Runtime failures are therefore not incorporated into any decision as documented.
- **blocker:** `skills/fix-or-backlog/SKILL.md:28-44` — orchestrated collection omits `coding-standards.json`, despite `agents/loop-clean-orchestrator.md:166-168` requiring four semantic inputs.
- **blocker:** `skills/fix-or-backlog/SKILL.md:28-44` and `agents/loop-clean-orchestrator.md:189` — neither defines a real input path for runtime-gate findings, so the statement that the next iteration’s fix-or-backlog resolves them is unsupported.
- **major:** `skills/loop-clean/loop-clean.sh:142-158` — `_require_iter_jsons` validates only four semantic reports, while aggregation also consumes runtime-gate. Missing runtime data is silently treated as zero findings.
- **major:** `skills/loop-clean/loop-clean.sh:574-687` — `commit-iter` stages every existing root `backlog.md` and `design-queue.md`, not only iteration-owned changes. Concurrent or pre-existing unrelated queue edits can enter the commit.
- **major:** `skills/loop-clean/loop-clean.sh:574-687` — commit staging derives source paths only from `fix_now_applied`; deletions fail the `-e` check and will not be staged.
- **major:** `skills/loop-clean/loop-clean.sh:574-687` — title uses `.escalated` count but not `.design_queue_added`; gate-routed items may be omitted from the advertised escalation count depending on producer output.
- **major:** `skills/fix-or-backlog/SKILL.md:291-443`, `skills/backlog-crush/backlog-crush.sh:22`, `skills/backlog-deep-crush/backlog-deep-crush.sh:24`, and `skills/lib/backlog-common.sh:70-384` — backlog/design/archive paths are duplicated and cwd-relative, with no canonical configurable path contract.
- **major:** `skills/loop-clean/loop-clean-test.sh:1-263` and `scripts/package.json:4-41` — loop-clean’s only direct tests cover `commit-iter` and are excluded from `bun test`.
- **notable:** `agents/loop-clean-orchestrator.md:245-257` still states that loop-clean does not run tests or commit, contradicting its own runtime-gate and optional commit steps at lines 181-209.
- **notable:** direct loop-clean coverage is limited to four commit-message/staging scenarios; there are no direct tests for scope parsing, sticky SHA resolution/reset/advancement, source aggregation, runtime ordering, backlog sweeping, finalization, or path behavior.
- **notable:** `scripts/new-cc-project-onboarder/.claude/run/loop-clean/...` contains runtime-layout artifacts. Their fixture status is unclear and could make layout assertions stale or leak ephemeral state.

## Existing Test Wiring

Wired through `scripts/package.json:4-41`:

- `scripts/spec-drift/src/__tests__/spec-drift.test.ts`
- `scripts/coding-standards-scanner/src/__tests__/scope-resolver.test.ts`
- `scripts/lib/coding-standards-schema/src/__tests__/id-hash.test.ts`
- coding-standards consolidate tests
- the broader listed Bun suites

Not wired:

- `skills/loop-clean/loop-clean-test.sh`

No direct automated tests were found for backlog-crush, backlog-deep-crush, or `backlog-common.sh`.

## Start Here

Open `agents/loop-clean-orchestrator.md` first. It defines the intended ordering and source contract, and currently conflicts with both `skills/loop-clean/loop-clean.sh` and `skills/fix-or-backlog/SKILL.md`. Resolve that contract before changing implementation or tests.

## Residual Risks

- Search output was capped at configured match limits, although all files under the requested `skills/`, `agents/`, and `scripts/` trees were inventoried and targeted scope terms were searched across each tree.
- No commands that execute tests were run because this was a read-only preflight inventory.
- Runtime-state files under `scripts/new-cc-project-onboarder/.claude/run/` may be intentional fixtures or accidental artifacts; their role is not documented in the inspected files.
- Shell logic relies heavily on implicit cwd and environment exports; orchestration tests will need isolated Git repositories to validate behavior safely.