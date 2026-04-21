# coding-standards-scanner — Mechanical pass of the coding-standards skill

Bun TS CLI that scans a scope of source files, runs the configured
linters + language-agnostic grep rules, and emits a canonical
coding-standards JSON report. Deterministic — no LLM, no judgment.

## Usage

```bash
# Default scope: git diff
bun src/cli.ts --output=/tmp/scanner.json

# Explicit scopes
bun src/cli.ts --scope=diff            --output=/tmp/scanner.json
bun src/cli.ts --scope=all             --output=/tmp/scanner.json
bun src/cli.ts --scope=path --path=src --output=/tmp/scanner.json
```

## Architecture

```
coding-standards-scanner/
├── CLAUDE.md
├── package.json
└── src/
    ├── cli.ts                         # Entry: parse args, orchestrate
    ├── lib/
    │   ├── scope-resolver.ts          # --scope=diff|all|path → string[]
    │   ├── rule-mapping.ts            # ruleId → axis | null
    │   ├── severity-defaults.ts       # ruleId → default severity
    │   ├── problem-canonicalizer.ts   # ruleId → stable problem phrasing
    │   ├── fix-templates.ts           # ruleId → fix_proposal
    │   ├── observable-change-templates.ts  # ruleId → observable_change
    │   ├── finding-emitter.ts         # build Finding via shared lib id hash
    │   ├── linter-parsers/
    │   │   ├── types.ts               # RawLinterFinding
    │   │   ├── eslint.ts              # --format json
    │   │   ├── biome.ts               # --reporter json
    │   │   ├── ruff.ts                # --output-format json
    │   │   └── shellcheck.ts          # -f json
    │   └── grep-rules/
    │       ├── types.ts               # GrepRule interface
    │       ├── debug-statements.ts    # console.log/print/debugger
    │       ├── abbreviations-denylist.ts  # mgr/foo/tmp2/...
    │       └── any-without-justif.ts  # `any` w/o justification comment
    └── __tests__/                     # golden fixtures + unit tests
```

## Flow

1. Parse CLI args (`--scope`, `--path`, `--output`).
2. Resolve scope → `files[]`.
3. Filter to code files that still exist (git diff may include deleted files).
4. Walk up from cwd to find `STACK_EVAL.yaml` (for linter choice).
5. Bucket files by language (`.ts/.tsx/.js/.jsx` / `.py` / `.sh/.bash`).
6. Per non-empty bucket: pick + run linter. **Fail-open on missing linter**: stderr warning, skip that bucket.
7. Run language-agnostic grep rules on all files.
8. Map raw findings → `Finding` via `rule-mapping` (drop out-of-scope), `severity-defaults`, `problem-canonicalizer`, `fix-templates`, `observable-change-templates`, `finding-emitter` (stable id).
9. Compute summary + blocking.
10. Validate output via `coding-standards-schema/validator`.
11. Write JSON to `--output`.

## Invariants

- **Deterministic** : same inputs → same bytes on disk. No timestamps, no random ordering.
- **Fail-open** : missing linter → warning to stderr, skip that bucket. Only exit 1 on bad args or schema validation failure after building the report (that would indicate an internal bug).
- **Frozen schema** : output JSON matches `lib/coding-standards-schema` and is consumed by `loop-clean.sh` and `coding-standards-consolidate`.
- **Stable problem strings** : `problem-canonicalizer` must not embed timestamps, iteration numbers, or LLM-generated content.
- **Disjoint scope from semantic pass** : rules mapped here (`RULE_TO_AXIS`) are the exact exclusion list of the agent `coding-standards-file.md`.

## Consumers

- `scripts/coding-standards-consolidate/` — reads the scanner JSON + per-file sub-agent JSONs, emits the final report.
- `skills/coding-standards/SKILL.md` (orchestrator) — invokes this CLI as step 2.

## Adding a new rule

1. If linter-sourced: add the linter's ruleId to `rule-mapping.ts` (axis) and `severity-defaults.ts`. Optional: specialize `problem-canonicalizer.ts`, `fix-templates.ts`, `observable-change-templates.ts`.
2. If grep-sourced: create a new file under `lib/grep-rules/` implementing `GrepRule`, register it in `cli.ts#runGrepRules`, then register its `ruleId` in the mapping tables as above.
3. Add a test: golden fixture under `__tests__/linter-parsers/` (for linter rules) or unit test under `__tests__/grep-rules/` (for grep rules).
4. Mirror the exclusion in `agents/coding-standards-file.md`'s "Périmètre d'audit" section.
