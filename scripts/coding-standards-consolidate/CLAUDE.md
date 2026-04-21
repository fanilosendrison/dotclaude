# coding-standards-consolidate — Deterministic merge of scanner + per-file JSONs

Bun TS CLI that reads the mechanical scanner JSON and the N per-file
sub-agent JSONs produced by the `coding-standards` skill, merges them
into a single canonical report, and writes the result to `--output`.

No LLM, no judgment. Pure merge / defensive dedup / validate / emit.

## Usage

```bash
bun src/cli.ts \
  --scanner-json=<path> \
  --files-json-dir=<dir> \    # directory containing *.json per-file reports
  --output=<path>
```

## Architecture

```
coding-standards-consolidate/
├── CLAUDE.md
├── package.json
└── src/
    ├── cli.ts                # parseArgs, consolidate, main (exports testable units)
    └── __tests__/
        └── cli.test.ts
```

## Flow

1. Parse args (`--scanner-json`, `--files-json-dir`, `--output`).
2. Read + validate scanner JSON via `coding-standards-schema/parseReport`.
3. Glob `--files-json-dir/*.json`, read + validate each.
4. Concat findings into one array.
5. Defensive dedup by `id` via a `Map<id, Finding>` — on collision, keep first, warn to stderr.
6. Recompute `summary` + `blocking`.
7. Emit final JSON with `verdict = CLEAN` iff findings array is empty.
8. Validate output against the schema before writing.
9. Write to `--output`.

## Invariants

- **Deterministic** : same inputs → same bytes on disk.
- **HARD FAIL** : any input JSON that fails schema validation causes exit 4. This mirrors loop-clean.sh's exit-4 convention for missing iteration JSONs.
- **No LLM** : this script does zero inference. Any disagreement between scanner and per-file agent on the same id is resolved by first-wins, logged to stderr.
- **Schema-locked output** : the emitted JSON MUST pass `coding-standards-schema/validateReport` — that check runs pre-write to catch bugs in the consolidator itself.

## Consumers

- `skills/coding-standards/SKILL.md` (orchestrator) — invokes this CLI as step 4.
- Ultimately, `skills/loop-clean/loop-clean.sh` reads the emitted JSON at the path given by `LOOP_CLEAN_JSON_OUT_CODING_STANDARDS`.
