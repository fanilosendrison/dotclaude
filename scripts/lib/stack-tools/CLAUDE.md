# stack-tools — Shared stack-aware linter/format/typecheck helpers

Library consumed by hooks and skills that need to run the project's
configured linter / formatter / type checker on a single file. Extracted
from `post-write-linter` so multiple consumers can share the logic without
drifting.

## Usage

```typescript
import {
	findStackEval,
	isCodeFile,
	isInstalled,
	isLinterCompatible,
	readStackConfig,
	runLintPipeline,
	type LintResult,
	type PipelineResult,
	type StackConfig,
} from "../lib/stack-tools/src/index.ts";
```

## Architecture

```
lib/stack-tools/
├── CLAUDE.md
├── package.json               # { name, type: module, private: true }
└── src/
    ├── index.ts               # Public re-exports (stable surface)
    ├── extensions.ts          # CODE_EXTENSIONS, LINTER_EXTENSIONS, isCodeFile, isLinterCompatible
    ├── stack-config.ts        # findStackEval, readStackConfig, StackConfig
    ├── runner.ts              # isInstalled, runLintPipeline, LintResult, PipelineResult
    └── __tests__/             # bun:test files mirroring lib module by module
```

## Consumers

- `scripts/post-write-linter/` — PostToolUse hook that runs the pipeline on a file just written or edited.
- `scripts/coding-standards-scanner/` — Mechanical pass of the coding-standards skill; needs `findStackEval`, `readStackConfig`, `isCodeFile`, `isInstalled`.

Any new consumer MUST import via the public `src/index.ts`; internal files
are not part of the stable surface.

## Invariants

- **Zero npm deps** : uses Bun built-ins only (`Bun.YAML`, `Bun.spawn`, `Bun.file`).
- **Fail-open** : `isInstalled` returns `false` on any failure, `runLintPipeline` returns a failing `LintResult` instead of throwing.
- **Stable API** : the shapes of `StackConfig`, `LintResult`, `PipelineResult` must not change without updating all consumers in the same commit.
- **30s tool timeout** : individual tool invocations are timeboxed in `runner.ts` via `TOOL_TIMEOUT_MS`.
