# Implementation Plan

## Goal

Refactor `loop-clean` into a deterministic, non-Git-mutating controller that operates on one resolved repository, canonicalizes all current uncommitted states, aggregates exactly four digest-bound reports, and validates complete finding disposition before reaching a defined terminal state.

## Tasks

1. **Lock the protocol contracts with failing TypeScript tests**
   - Files:
     - `scripts/loop-clean-protocol/src/__tests__/scope.test.ts`
     - `scripts/loop-clean-protocol/src/__tests__/collect.test.ts`
     - `scripts/loop-clean-protocol/src/__tests__/routing.test.ts`
     - `scripts/loop-clean-protocol/src/__tests__/git-state.test.ts`
   - Changes:
     - Create RED tests using real temporary Git repositories.
     - Cover tracked staged/unstaged changes, mixed index/worktree changes, untracked files, deletes, renames, ignored files, paths containing whitespace/newlines, linked worktrees, invocation below repo root, and unborn `HEAD`.
     - Assert `scope` parses `git status --porcelain=v2 -z`, emits sorted canonical `scope.json`, and resolves exactly one non-bare repo.
     - Assert `collect` requires exactly `coding-standards`, `senior-review`, `dedup-codebase`, and `runtime-gate`; rejects missing, extra, malformed, duplicate, or wrong-digest reports; and emits canonical `findings.json`.
     - Assert routing partitions every canonical routing identity exactly once among applied, backlog, design queue, escalated, or deferred outcomes.
     - Assert capture/verify detects `HEAD` or index changes without rejecting expected worktree edits.
   - Acceptance:
     - `cd scripts && bun test loop-clean-protocol` fails only because the protocol implementation is absent.
   - Rollback checkpoint:
     - Tests are isolated in the new package and can be removed without affecting existing behavior.

2. **Create the Bun/TypeScript protocol package**
   - Files:
     - `scripts/loop-clean-protocol/package.json`
     - `scripts/loop-clean-protocol/CLAUDE.md`
     - `scripts/loop-clean-protocol/src/cli.ts`
     - `scripts/loop-clean-protocol/src/types.ts`
     - `scripts/loop-clean-protocol/src/lib/canonical-json.ts`
     - `scripts/loop-clean-protocol/src/lib/git-state.ts`
     - `scripts/loop-clean-protocol/src/lib/scope.ts`
     - `scripts/loop-clean-protocol/src/lib/collect.ts`
     - `scripts/loop-clean-protocol/src/lib/routing.ts`
   - Changes:
     - Implement CLI commands `scope`, `collect`, `validate-routing`, `capture-git`, and `verify-git`.
     - Use Zod for external JSON validation.
     - Use RFC 8785/JCS canonical JSON and SHA-256 for stable digests rather than a project-specific canonicalization format.
     - Parse porcelain v2 as NUL-delimited bytes, including rename source/destination records.
     - Normalize paths relative to the resolved repository root without losing unusual legal Git path bytes.
     - Represent unborn `HEAD` explicitly rather than treating it as an error.
     - Capture and verify `HEAD` plus the resolved worktree index file; do not invoke `git add`, `commit`, `reset`, `checkout`, `switch`, `stash`, `merge`, `rebase`, `update-index`, or other Git-writing commands.
   - Acceptance:
     - All package unit tests pass.
     - Repeated runs over unchanged repository state produce byte-identical JSON and digests.
   - Rollback checkpoint:
     - Do not integrate the package with `loop-clean.sh` until all protocol tests pass.

3. **Add mutation and Git-write-defense tests**
   - Files:
     - `scripts/loop-clean-protocol/src/__tests__/mutation.test.ts`
     - `scripts/loop-clean-protocol/src/__tests__/static-guards.test.ts`
     - `scripts/loop-clean-protocol/src/__tests__/helpers/temp-repo.ts`
     - `scripts/loop-clean-protocol/src/__tests__/helpers/git-wrapper.ts`
   - Changes:
     - Mutate scope digests, source names, finding IDs, report ordering, routing identities, deferred records, `HEAD`, and index bytes; require fail-closed `PROTOCOL_ERROR` behavior.
     - Put a dynamic `git` wrapper first on `PATH`; allow only enumerated read-only subcommands and fail immediately on a mutating command.
     - Add static scans for removed modes, sticky base variables, commit-per-iteration behavior, spec-drift, and prohibited Git commands in loop-clean code.
   - Acceptance:
     - Every intentional mutation is detected.
     - The wrapper records no Git-mutating invocation.
   - Rollback checkpoint:
     - Keep the permitted read-only Git command list narrow; review additions individually rather than weakening the wrapper globally.

4. **Rewrite the shell controller around the protocol CLI**
   - Files:
     - `skills/loop-clean/loop-clean.sh`
     - `skills/loop-clean/loop-clean-test.sh`
   - Changes:
     - Remove audit/diff/all modes, sticky `BASE_SHA`, reset behavior, `commit-iter`, per-iteration commit messages, sticky advancement, spec-drift collection, and any Git write.
     - Resolve one repository root once and anchor all runtime artifacts and queue paths to it.
     - Rebuild iteration order:
       1. Resolve repo and capture protected Git state.
       2. Generate that iteration’s `scope.json`.
       3. Exit `NO_CHANGES` if scope is empty.
       4. Run the three semantic producers against that exact scope.
       5. Discover and execute the runtime gate.
       6. Verify protected Git state.
       7. Collect the four reports into `findings.json`.
       8. Decide `CLEAN`, `OSCILLATION`, `CEILING`, or continue.
       9. Pass only `findings.json` to `fix-or-backlog`.
       10. Validate the exact routing partition and update deferred state.
       11. Verify protected Git state again and return `HANDLED` or begin the next iteration.
     - Convert malformed artifacts, digest mismatches, Git-state violations, invalid routing, and unexpected controller failures to `PROTOCOL_ERROR`.
     - Replace commit-focused smoke tests with real-repository E2E scenarios for all seven terminal states.
   - Acceptance:
     - `bash skills/loop-clean/loop-clean-test.sh` passes under the dynamic Git wrapper.
     - No test changes `HEAD` or the index.
   - Rollback checkpoint:
     - Preserve the old controller until the new E2E suite is GREEN, then replace it atomically rather than incrementally mixing the two protocols.

5. **Make producer reports scope-bound**
   - Files:
     - `skills/coding-standards/SKILL.md`
     - `skills/senior-review/SKILL.md`
     - `skills/dedup-codebase/SKILL.md`
     - `agents/coding-standards-file.md`
     - `agents/senior-review-file.md`
     - `agents/dedup-intra.md`
     - `agents/dedup-inter.md`
     - `scripts/coding-standards-scanner/src/cli.ts`
     - `scripts/coding-standards-scanner/src/lib/scope-resolver.ts`
     - `scripts/coding-standards-scanner/src/__tests__/scope-resolver.test.ts`
     - `scripts/coding-standards-consolidate/src/cli.ts`
     - `scripts/coding-standards-consolidate/src/__tests__/cli.test.ts`
     - `scripts/lib/coding-standards-schema/src/types.ts`
     - `scripts/lib/coding-standards-schema/src/validator.ts`
     - `scripts/lib/coding-standards-schema/src/__tests__/validator.test.ts`
   - Changes:
     - Write failing tests first for scope-file consumption and `scope_digest` propagation.
     - Replace `LOOP_CLEAN_SCOPE` and `LOOP_CLEAN_BASE_SHA` behavior with the canonical iteration scope file.
     - Require each final producer report to declare the current `scope_digest`.
     - Ensure dedup only inventories files represented by the current scope instead of globbing the whole repository.
     - Preserve stable finding IDs while defining routing identity independently from presentation order.
   - Acceptance:
     - Each producer emits a valid report with the exact current digest.
     - A stale or manually altered report is rejected by `collect`.
   - Rollback checkpoint:
     - Migrate one producer at a time behind its tests; do not enable four-report collection until all three semantic producers are compatible.

6. **Move the runtime gate before collection and decision**
   - Files:
     - `skills/loop-clean/loop-clean.sh`
     - `agents/loop-clean-orchestrator.md`
     - `skills/loop-clean/loop-clean-test.sh`
   - Changes:
     - Add RED cases for configured command, convention fallback, no command, command failure, and multiple candidate configurations.
     - Emit a required `runtime-gate.json` for pass, failure, and skip, always carrying `scope_digest`.
     - Make runtime failures canonical findings available in the same iteration’s `findings.json`.
     - Ensure the gate runs before `collect` and `decide`.
   - Acceptance:
     - A failing runtime command reaches `fix-or-backlog` through `findings.json`.
     - Missing runtime-gate output becomes `PROTOCOL_ERROR`, not zero findings.
   - Rollback checkpoint:
     - Keep discovery and execution separately testable so command-selection bugs do not require reverting report aggregation.

7. **Make canonical findings the sole routing input**
   - Files:
     - `skills/fix-or-backlog/SKILL.md`
     - `agents/fix-file.md`
     - `skills/loop-clean/loop-clean.sh`
   - Changes:
     - Remove direct reading of per-source report files and all `BASE_SHA` classification.
     - Require only the current canonical `findings.json`.
     - Base “fresh code” classification on canonical scope membership and status metadata.
     - Emit routing results keyed by the canonical routing identity.
     - Validate that applied, backlog, design, escalated, and deferred sets form an exact, duplicate-free partition with no unknown identities.
     - Add and maintain a deferred-findings registry with deterministic serialization.
   - Acceptance:
     - Missing, duplicate, or invented dispositions fail before the controller reports `HANDLED`.
     - Runtime-gate and coding-standards findings are routable through the same contract as the other sources.
   - Rollback checkpoint:
     - Do not remove legacy source-reading instructions until routing validation tests are GREEN.

8. **Anchor queue behavior to the resolved repository root**
   - Files:
     - `skills/fix-or-backlog/SKILL.md`
     - `skills/backlog-crush/backlog-crush.sh`
     - `skills/backlog-deep-crush/backlog-deep-crush.sh`
     - `skills/backlog-crush/SKILL.md`
     - `skills/backlog-deep-crush/SKILL.md`
     - `agents/backlog-crush-orchestrator.md`
     - `agents/backlog-deep-crush-orchestrator.md`
     - `agents/backlog-fix.md`
   - Changes:
     - Add tests that invoke commands from nested directories and linked worktrees.
     - Resolve `backlog.md`, `backlog.archive.md`, and `design-queue.md` from the same canonical repo root used by loop-clean.
     - Remove assumptions that the process current directory is the repository root.
     - Remove backlog/deep-crush reliance on per-iteration loop-clean commits.
   - Acceptance:
     - Nested-directory invocation updates only the intended repository’s queues.
     - No queue is created in a caller’s subdirectory or parent repository.
   - Rollback checkpoint:
     - Verify path resolution independently before enabling queue writes in E2E scenarios.

9. **Remove spec-drift implementation and references**
   - Files to delete:
     - `scripts/spec-drift/src/spec-drift.ts`
     - `scripts/spec-drift/src/__tests__/spec-drift.test.ts`
     - `scripts/spec-drift/CLAUDE.md`
   - Files to modify:
     - `scripts/package.json`
     - `scripts/bun.lock`
     - `skills/loop-clean/SKILL.md`
     - `agents/loop-clean-orchestrator.md`
     - `skills/fix-or-backlog/SKILL.md`
     - `skills/coding-standards/SKILL.md`
     - `skills/senior-review/SKILL.md`
     - `skills/dedup-codebase/SKILL.md`
     - `agents/coding-standards-file.md`
     - `agents/senior-review-file.md`
     - `agents/backlog-deep-crush-orchestrator.md`
     - `helpers/nightly-clean-prompt.md`
     - `skills/agent-creator/SKILL.md`
   - Changes:
     - Remove package scripts and default-suite entries for spec-drift.
     - Remove pipeline steps, schema branches, routing gates, commit-message conventions, examples, exclusions, and generated-agent examples tied to spec-drift.
     - Add the new protocol package to the default test command.
   - Acceptance:
     - A tracked-file search finds no executable or normative spec-drift reference.
     - The full scripts test suite remains GREEN.
   - Rollback checkpoint:
     - Delete spec-drift only after the four-source collector and updated routing contracts pass.

10. **Rebuild the skill and orchestrator documentation**
    - Files:
      - `skills/loop-clean/SKILL.md`
      - `agents/loop-clean-orchestrator.md`
      - `helpers/nightly-clean-prompt.md`
    - Changes:
      - Document the single-scope behavior and remove argument parsing for audit mode.
      - Specify the exact controller order and seven terminal states: `NO_CHANGES`, `CLEAN`, `HANDLED`, `OSCILLATION`, `CEILING`, and `PROTOCOL_ERROR`—noting that the supplied list contains six distinct names, not seven.
      - Remove `LOOP_CLEAN_COMMIT_PER_ITER`, sticky session setup, and Git-commit language.
      - Explicitly prohibit Git mutation and require protected-state verification around semantic/fix phases.
    - Acceptance:
      - Static tests confirm documentation and implementation agree on command order, reports, and terminal names.
    - Rollback checkpoint:
      - Treat documentation as normative; do not merge controller behavior that differs from it.

11. **Add a separate opt-in live smoke**
    - File:
      - `skills/loop-clean/loop-clean-live-smoke.sh`
    - Changes:
      - Exercise the installed skill/protocol against a disposable real repository with available runtime tooling.
      - Keep it outside the default deterministic suite.
      - Run it under the Git mutation wrapper and verify unchanged `HEAD` and index afterward.
    - Acceptance:
      - Explicit live smoke succeeds without repository-history or index changes.
    - Rollback checkpoint:
      - A live-smoke failure blocks release but does not weaken deterministic test assertions.

12. **Run final repository-wide validation**
    - Commands:
      ```bash
      cd scripts && bun test loop-clean-protocol
      bash skills/loop-clean/loop-clean-test.sh
      cd scripts && bun test
      cd scripts && bunx biome check loop-clean-protocol coding-standards-scanner coding-standards-consolidate
      shellcheck skills/loop-clean/loop-clean.sh skills/loop-clean/loop-clean-test.sh
      git grep -n -E 'spec-drift|LOOP_CLEAN_BASE_SHA|LOOP_CLEAN_COMMIT_PER_ITER|commit-iter|scope_mode|--scope=(audit|diff|all)'
      git grep -n -E 'git (add|commit|reset|checkout|switch|stash|merge|rebase|update-index)' -- skills/loop-clean scripts/loop-clean-protocol agents/loop-clean-orchestrator.md
      git diff --check
      git diff --cached --quiet
      git status --porcelain=v2 --untracked-files=all
      ```
   - Acceptance:
     - All automated checks pass.
     - Removal searches return no prohibited live references.
     - The staged diff is empty unless the user explicitly stages the completed implementation later.
   - Rollback checkpoint:
     - Stop and revert the latest phase on any protocol, Git-state, or routing-partition regression; do not suppress the failing guard.

## Files to Modify

- `skills/loop-clean/loop-clean.sh` — replace the legacy flow controller.
- `skills/loop-clean/loop-clean-test.sh` — replace commit smoke tests with E2E controller tests.
- `skills/loop-clean/SKILL.md` — document the single canonical scope and new protocol.
- `agents/loop-clean-orchestrator.md` — enforce exact protocol order.
- `skills/fix-or-backlog/SKILL.md` — consume only `findings.json` and emit a complete routing partition.
- `skills/coding-standards/SKILL.md` — consume canonical scope instead of diff/all and `BASE_SHA`.
- `skills/senior-review/SKILL.md` — consume canonical scope and emit its digest.
- `skills/dedup-codebase/SKILL.md` — restrict inventory to canonical scope and remove spec-drift references.
- `agents/coding-standards-file.md` — propagate scope identity and remove spec-drift exclusions.
- `agents/senior-review-file.md` — remove the spec-drift direction axis and bind output to scope.
- `agents/dedup-intra.md` — bind findings to the iteration scope.
- `agents/dedup-inter.md` — bind findings to the iteration scope.
- `agents/fix-file.md` — preserve routing identity in fix results.
- `scripts/coding-standards-scanner/src/cli.ts` — accept a canonical scope file.
- `scripts/coding-standards-scanner/src/lib/scope-resolver.ts` — replace diff/all resolution.
- `scripts/coding-standards-scanner/src/__tests__/scope-resolver.test.ts` — test canonical scope input.
- `scripts/coding-standards-consolidate/src/cli.ts` — propagate and validate `scope_digest`.
- `scripts/coding-standards-consolidate/src/__tests__/cli.test.ts` — test digest validation.
- `scripts/lib/coding-standards-schema/src/types.ts` — add scope-bound report fields.
- `scripts/lib/coding-standards-schema/src/validator.ts` — validate scope-bound reports.
- `scripts/lib/coding-standards-schema/src/__tests__/validator.test.ts` — cover the new schema.
- `scripts/package.json` — add protocol tests and remove spec-drift scripts.
- `scripts/bun.lock` — update only if an RFC 8785 implementation is added.
- `skills/backlog-crush/backlog-crush.sh` — resolve queue paths from repo root.
- `skills/backlog-deep-crush/backlog-deep-crush.sh` — resolve queue paths and remove commit assumptions.
- `skills/backlog-crush/SKILL.md` — document root-relative paths.
- `skills/backlog-deep-crush/SKILL.md` — document root-relative paths and no per-iteration commits.
- `agents/backlog-crush-orchestrator.md` — use resolved queue paths.
- `agents/backlog-deep-crush-orchestrator.md` — remove spec-drift/commit breakdowns.
- `agents/backlog-fix.md` — use repository-root queue identity.
- `helpers/nightly-clean-prompt.md` — remove commit-per-iteration setup and old pipeline.
- `skills/agent-creator/SKILL.md` — remove obsolete loop-clean/spec-drift example text.

## New Files

- `scripts/loop-clean-protocol/package.json` — Bun package metadata.
- `scripts/loop-clean-protocol/CLAUDE.md` — protocol architecture and invariants.
- `scripts/loop-clean-protocol/src/cli.ts` — five-command CLI.
- `scripts/loop-clean-protocol/src/types.ts` — protocol types and schemas.
- `scripts/loop-clean-protocol/src/lib/canonical-json.ts` — JCS serialization and digesting.
- `scripts/loop-clean-protocol/src/lib/git-state.ts` — repository resolution and protected-state capture.
- `scripts/loop-clean-protocol/src/lib/scope.ts` — porcelain v2 `-z` parsing and scope emission.
- `scripts/loop-clean-protocol/src/lib/collect.ts` — four-report validation and finding aggregation.
- `scripts/loop-clean-protocol/src/lib/routing.ts` — exact partition and deferred-registry validation.
- `scripts/loop-clean-protocol/src/__tests__/scope.test.ts` — real-Git scope tests.
- `scripts/loop-clean-protocol/src/__tests__/collect.test.ts` — collection tests.
- `scripts/loop-clean-protocol/src/__tests__/routing.test.ts` — routing/deferred tests.
- `scripts/loop-clean-protocol/src/__tests__/git-state.test.ts` — capture/verify tests.
- `scripts/loop-clean-protocol/src/__tests__/mutation.test.ts` — deliberate artifact and state mutations.
- `scripts/loop-clean-protocol/src/__tests__/static-guards.test.ts` — forbidden-reference and Git-write guards.
- `scripts/loop-clean-protocol/src/__tests__/helpers/temp-repo.ts` — temporary repository fixtures.
- `scripts/loop-clean-protocol/src/__tests__/helpers/git-wrapper.ts` — dynamic Git mutation blocker.
- `skills/loop-clean/loop-clean-live-smoke.sh` — separate opt-in live validation.

## Files to Delete

- `scripts/spec-drift/src/spec-drift.ts`
- `scripts/spec-drift/src/__tests__/spec-drift.test.ts`
- `scripts/spec-drift/CLAUDE.md`

## Dependencies

- Task 1 precedes all implementation.
- Tasks 2–3 must be GREEN before shell integration.
- Tasks 5–6 must finish before four-report collection is enabled.
- Task 7 depends on canonical collection and stable routing identity.
- Task 8 depends on canonical repository resolution from Task 2.
- Spec-drift deletion in Task 9 depends on the new four-source flow being GREEN.
- Documentation and final validation follow functional convergence.
- Prefer an established RFC 8785 library plus existing Zod; update `scripts/bun.lock` only if dependency installation is authorized.

## Risks

- **Clarification required:** The target names only six terminal states despite saying “seven.” The missing seventh state must be identified or the count corrected.
- **Clarification required:** Define canonical routing identity. Recommended default is `(source, finding.id)`, not `finding.id` alone.
- **Clarification required:** Define deferred-finding lifecycle: run-local versus cross-run persistence, reactivation conditions, and whether deferred findings count as `HANDLED`.
- **Clarification required:** Define runtime-gate discovery precedence when multiple workspaces or test commands exist. Current behavior selects one command; the target does not say whether to run one or all.
- **Clarification required:** Confirm RFC 8785/JCS plus SHA-256 and the exact fields included in `scope_digest`.
- **Clarification required:** Confirm whether ignored files remain excluded even when explicitly staged; the target says “non-ignored,” while Git can track paths matching ignore rules.
- **Clarification required:** Decide whether historical spec-drift entries in root `backlog.md` and `design-queue.md` should be purged. Removing executable/normative references is clear; rewriting historical queue records is potentially destructive scope widening.
- Porcelain v2 rename records and unusual filenames are easy to parse incorrectly if decoded line-by-line rather than from NUL-delimited bytes.
- Raw index capture must resolve linked-worktree index paths correctly and represent a missing index in an unborn repository.
- The controller is expected to permit worktree edits while forbidding index/HEAD mutations; verification must not reject legitimate fix application.
- Existing `loop-clean.sh` currently mixes scope, runtime gate, aggregation, commits, queue sweeping, and finalization. Partial migration could create two incompatible protocols.
- The current runtime gate is generated after `decide`, so transitional ordering must never be released.
- `fix-or-backlog` currently omits coding-standards and runtime-gate inputs and includes extensive spec-drift-specific routing; incomplete cleanup would leave contradictory contracts.