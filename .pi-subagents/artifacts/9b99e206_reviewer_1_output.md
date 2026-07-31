## Review

### Correct

- `agents/fix-file.md:97` explicitly forbids subagents from running `git add` or `git commit`.
- `scripts/package.json:4-37` already provides Bun/TypeScript test infrastructure, making a testable TypeScript controller feasible without adding a runtime.
- `skills/lib/backlog-common.sh` centralizes shared backlog behavior, reducing the migration surface for both backlog consumers.
- `skills/loop-clean/loop-clean.sh:143-160` fails hard when required producer reports are absent rather than silently declaring success.

### Blockers

- **Blocker — runtime failures are never actionable.**  
  `agents/loop-clean-orchestrator.md:140-189` calls `decide` before `test-gate`. Meanwhile, `skills/loop-clean/loop-clean.sh:692-704` reads `runtime-gate.json` from the current iteration, where it does not yet exist. The next iteration reads a different directory, so the previous failure is lost. Additionally, `skills/fix-or-backlog/SKILL.md:34-43` consumes only senior-review, dedup, and spec-drift reports—not runtime-gate or coding-standards. Runtime failures therefore cannot reach fix-or-backlog.

- **Blocker — current implementation violates a no-Git-write contract.**  
  `skills/loop-clean/loop-clean.sh:574-681` implements `commit-iter`, including `git add` and `git commit`; `agents/loop-clean-orchestrator.md:200-208` exposes it. `skills/loop-clean/loop-clean-test.sh` exists primarily to verify those writes. Removing only the command would leave contradictory documentation and tests.

- **Blocker — scope discovery is not filename-safe and misses files.**  
  `agents/loop-clean-orchestrator.md:92,107,168`, `skills/coding-standards/SKILL.md:52-63`, and `skills/fix-or-backlog/SKILL.md:48-61` prescribe newline-delimited `git diff --name-only`. This:
  - omits untracked files;
  - does not provide porcelain-v2 index/worktree state;
  - cannot safely represent filenames containing newlines;
  - does not model rename source/destination identity;
  - is unsuitable as the shell/TypeScript interchange format.

- **Blocker — unborn `HEAD` has no coherent base model.**  
  `skills/loop-clean/loop-clean.sh:68-105` resolves `HEAD` to an empty string when no commit exists, then persists or propagates that absence. Later logic assumes a commit-like `BASE_SHA`, including `git diff "$LOOP_CLEAN_BASE_SHA"` and ancestry checks. A new repository needs an explicit `head: null`/empty-tree model and tests, not an empty-string pseudo-SHA.

- **Blocker — handled/deferred state is count-based rather than identity-based.**  
  `skills/loop-clean/loop-clean.sh:977-1007` advances the sticky base when the number of handled outputs is at least the number of findings. This can falsely succeed when outputs duplicate one finding while another remains unhandled. Each disposition must reference a unique canonical finding/routing identity.

### Notes and risks

- **Major — digest construction is not canonicalization.**  
  `skills/loop-clean/loop-clean.sh:386-449,707-719` hashes lossy normalized text transported through TSV. Tabs/newlines in paths or problem text alter field boundaries, and distinct findings can collapse after lowercase/whitespace normalization. Define canonical report data and digest it using a maintained standard such as RFC 8785 JCS, with explicit inclusion/exclusion of volatile fields.

- **Major — producer identity is distributed and partly LLM-generated.**  
  `agents/loop-clean-orchestrator.md:118` asks orchestration logic to reproduce an ID formula, while individual skills emit their own JSON. Canonical IDs and report validation should be owned by one TypeScript module/CLI, not duplicated in prompts and shell.

- **Major — backlog routing identity is unstable.**  
  `skills/backlog-crush/backlog-crush.sh:40-67` and `skills/backlog-deep-crush/backlog-deep-crush.sh:52-78` derive IDs from line number plus the first 80 characters. Appending, reordering, editing, or archiving lines changes identity. `skills/lib/backlog-common.sh` then propagates this derived value as `origin_id`, losing the original producer finding identity. New entries need a durable `route_id`; consumers must temporarily accept legacy lines during migration.

- **Major — deferred findings are not first-class.**  
  Backlogged/design-routed findings continue to appear in the raw producer set and therefore contribute to oscillation, while finalization merely infers handling from aggregate counts. The contract must specify whether deferred findings:
  1. are excluded from the active convergence digest;
  2. remain visible in a separate deferred digest/report;
  3. can be reactivated when evidence or source content changes.

- **Major — test-command discovery is fragile and shell-evaluated.**  
  `skills/loop-clean/loop-clean.sh:456-500` detects `"test"` with grep, parses YAML with regex, and later executes strings through `bash -c`. This mishandles structured YAML/package metadata and creates an avoidable shell-evaluation boundary. Discovery should be TypeScript-based, rooted at the repository, return argv plus provenance, and define monorepo, timeout, missing-tool, and signal behavior.

- **Major — read-only Git commands still need defensive execution.**  
  A no-Git-write guarantee should enforce an allowlist of Git subcommands and run with `GIT_OPTIONAL_LOCKS=0`/`--no-optional-locks` where supported. Tests should inject a fake `git` executable and fail on `add`, `commit`, `reset`, `checkout`, `switch`, `merge`, `rebase`, `push`, or other mutators.

- **Moderate — shell tests are not wired into the package suite.**  
  `scripts/package.json:4` does not run `skills/loop-clean/loop-clean-test.sh`. The existing tests cover only commit-message/staging behavior, not decision flow, porcelain parsing, unborn HEAD, report digests, deferred findings, or Git-write defenses.

- **Moderate — repository-relative paths depend on caller CWD.**  
  `backlog.md`, `design-queue.md`, `.claude/run`, `package.json`, and lockfiles are commonly accessed relative to the current directory. Invocation from a subdirectory can inspect or mutate the wrong paths. Resolve the repository root once and pass absolute internal paths.

- **Moderate — documentation conflicts internally.**  
  `agents/loop-clean-orchestrator.md:189` says a failed runtime finding is seen by the next iteration, which the directory layout does not implement. Its limits section also says the orchestrator does not run tests or commit, contradicting sections 2.8 and 2.9.

- **Review-input gap.**  
  The requested `plan.md` and `progress.md` do not exist at the supplied paths, and `context.md` was also absent. Exact clause-by-clause validation against the detailed target contract was therefore impossible; findings above are grounded in the task’s named requirements and current files.

### Required clarifications before implementation

1. Is canonical JSON specifically RFC 8785 JCS, and which volatile fields are excluded from digests?
2. Does “no Git writes” prohibit only Git mutations, or also optional index refresh/lock creation by read commands?
3. How should renamed files be identified: destination path only or an old/new path tuple?
4. What reactivates a deferred finding: changed canonical finding digest, changed source content, or explicit user action?
5. Are runtime gates one repository-level command, one command per workspace, or all discovered commands?
6. For unborn repositories, should the base be represented as `null` or Git’s empty-tree object ID?

### RED → GREEN implementation sequence

1. **RED: repository-state parser tests**  
   Add TypeScript fixtures for porcelain v2 `-z`: unstaged, staged, untracked, rename/copy, spaces, tabs, newlines, non-ASCII paths, detached HEAD, and unborn HEAD.

2. **GREEN: read-only repository snapshot module**  
   Implement a TypeScript Git adapter using byte/NUL parsing and an explicit `head: string | null`. Keep shell only as a compatibility launcher. Add a Git-command allowlist and fake-Git mutation tests.

3. **RED: canonical report and digest tests**  
   Cover producer-order independence, object-key ordering, Unicode, newlines, duplicate IDs, digest stability, and rejection of malformed reports.

4. **GREEN: shared schemas and canonicalization**  
   Add Zod contracts and RFC-standard canonical JSON hashing. Normalize producer reports through this boundary before decision logic.

5. **RED: runtime/deferred state-machine tests**  
   Prove that a runtime failure reaches routing, missing reports fail closed, handled identities cannot mask unhandled findings, and deferred findings do not cause false oscillation.

6. **GREEN: TypeScript decision/state core**  
   Reorder each iteration to discover all current source reports—including runtime gates—before aggregation and decision. Persist dispositions keyed by canonical routing identity.

7. **RED: backlog compatibility tests**  
   Test stable `route_id` through line movement/archive, deduplication, escalation, and parsing of legacy lines without `route_id`.

8. **GREEN: migrate producer and consumer contracts**  
   Update fix-or-backlog to consume all reports, preserve source/finding identity, emit active/deferred dispositions, and update both backlog consumers with legacy fallback.

9. **RED then GREEN: remove Git-write behavior**  
   First add end-to-end tests asserting no mutating Git command is attempted. Then remove `commit-iter`, its shell tests, environment option, and all orchestrator/skill documentation.

10. **Wire validation**  
    Add loop-clean tests to `scripts/package.json`; run focused tests first, then the complete scripts suite and shell static analysis.

## Acceptance evidence

- No files were edited or staged.
- Inspection found only untracked `.pi-subagents/` artifacts; the index was clean.
- Tests were not run because this was a read-only architecture review and the browsing budget was explicitly stopped.