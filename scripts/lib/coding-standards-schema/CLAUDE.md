# coding-standards-schema — Canonical types, validator, id hash

Shared schema library for the `coding-standards` skill and its sub-scripts
(`coding-standards-scanner`, `coding-standards-consolidate`) plus the
per-file sub-agent described in `agents/coding-standards-file.md`.

## Why a separate package?

- Type sharing: scanner + consolidate + tests all refer to the same
  `Finding` / `Severity` / `Axis` types.
- Single source of truth for the id hash formula: stability of that
  formula is load-bearing for `loop-clean.sh` oscillation detection.
- Deterministic validation: both scanner and consolidate call
  `parseReport` / `validateReport` at their boundaries — a malformed JSON
  fails fast with a clear error rather than silently mis-counting later.

## Usage

```typescript
import {
	AXES,
	SEVERITIES,
	computeBlocking,
	computeFindingId,
	computeSummary,
	parseReport,
	validateFinding,
	validateReport,
	type Axis,
	type CodingStandardsReport,
	type Finding,
	type Severity,
} from "../lib/coding-standards-schema/src/index.ts";
```

## Architecture

```
lib/coding-standards-schema/
├── CLAUDE.md
├── package.json
└── src/
    ├── index.ts               # Public re-exports
    ├── types.ts               # Finding, Severity, Axis, CodingStandardsReport, AXES, SEVERITIES, computeSummary, computeBlocking
    ├── id-hash.ts             # computeFindingId (canonical formula)
    ├── validator.ts           # zod schemas + parseReport / validateReport
    └── __tests__/
        ├── id-hash.test.ts    # stability + sensitivity to each input dimension
        └── validator.test.ts  # valid + invalid JSON samples
```

## Frozen interface

The JSON shape of `CodingStandardsReport` is consumed by
`skills/loop-clean/loop-clean.sh`. The jq queries in that script read
`.findings[].id`, `.findings[].axis`, `.findings[].file`,
`.findings[].problem`, and `.findings | length`. Any rename or schema
change MUST be coordinated with loop-clean.sh in the same commit.

## Canonical id formula

```
id = sha256([source, file, String(line_start ?? ""), axis,
             problem.slice(0, 80)].join("|")).slice(0, 16)
```

This exact formula is also described verbatim in:

- `agents/coding-standards-file.md` (the semantic sub-agent prompt)
- `skills/coding-standards/SKILL.md` (the orchestrator)
- `agents/loop-clean-orchestrator.md` step 2.2 reference

If this formula changes, those three files must update together.

## Dependencies

- `zod` (already a root `scripts/package.json` dependency) for schema validation
- `node:crypto` for sha256
