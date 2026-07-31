# Coding Standards Scanner

Deterministic Bun CLI for the mechanical coding-standards pass.

## Usage

```bash
bun src/cli.ts --scope-file=/absolute/run/iter-000/scope.json --output=/tmp/scanner.json
bun src/cli.ts --scope=all --output=/tmp/scanner.json
bun src/cli.ts --scope=path --path=src --output=/tmp/scanner.json
```

Loop-clean callers must use `--scope-file`. The scanner never derives another
Git scope in that mode.

## Flow

1. Parse and validate the scope manifest.
2. Require its repository root to equal the scanner working directory.
3. Select existing, auditable entries and recognized code extensions.
4. Read `STACK_EVAL.yaml` for configured linter choices.
5. Run supported linters per language bucket.
6. Run deterministic grep rules.
7. Build stable findings, summaries, and blocking state.
8. Copy the manifest digest into `scope_digest`.
9. Validate and write the report.

Missing optional linters are fail-open with a warning. Invalid arguments,
manifest data, digest shape, or report schema are hard failures.

## Architecture

```text
coding-standards-scanner/
├── CLAUDE.md
└── src/
    ├── cli.ts
    ├── lib/
    │   ├── scope-resolver.ts
    │   ├── finding-emitter.ts
    │   ├── rule-mapping.ts
    │   ├── severity-defaults.ts
    │   ├── grep-rules/
    │   └── linter-parsers/
    └── __tests__/
```

The output schema comes from `scripts/lib/coding-standards-schema`. The
loop-clean protocol manifest schema comes from
`skills/loop-clean/protocol/src/scope/scope-schema.ts`.
