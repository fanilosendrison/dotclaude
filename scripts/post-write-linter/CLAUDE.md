# post-write-linter — Auto lint/format/typecheck on Write/Edit

PostToolUse hook that runs format → lint → typecheck on code files after Claude Code writes or edits them.

## Usage

```bash
# As Claude Code hook (configured in ~/.claude/settings.json)
bun ~/.claude/scripts/post-write-linter/src/cli.ts

# Manual test
echo '{"tool_name":"Write","tool_input":{"file_path":"test.ts"},"hook_event_name":"PostToolUse"}' | bun src/cli.ts
```

## Architecture

```
post-write-linter/
├── CLAUDE.md
└── src/
    ├── cli.ts                  # Entry point — early exits + pipeline
    └── lib/
        ├── extensions.ts       # CODE_EXTENSIONS, LINTER_EXTENSIONS, isCodeFile(), isLinterCompatible()
        ├── stack-config.ts     # findStackEval(), readStackConfig()
        └── runner.ts           # runLintPipeline() — format → lint → typecheck
```

## Flow

1. Read stdin (HookInput from Claude Code)
2. Early exits: not Write/Edit → skip, no file_path → skip, not code file → skip
3. Find STACK_EVAL.yaml by walking up from file
4. Read linter + type_checker from STACK_EVAL.yaml
5. Check extension compatibility with configured linter
6. Run pipeline: format → lint → typecheck (sequential)
7. Errors → deny (advisory, Claude sees and fixes). All OK → skip (silent).

## Invariants

- **Fail-open** : any unexpected state → silent exit 0
- **Advisory only** : PostToolUse deny is informational — Claude sees errors and self-corrects
- **No install** : if a tool isn't found via `which`, that step is skipped
- **Timeout** : 30s per tool invocation
- **Zero npm deps** : uses Bun built-ins (YAML.parse, subprocess)

## Output

- Errors found → PostToolUse `{ decision: "block", reason: "..." }` with error details
- All clean → silent exit 0
- Skip conditions → silent exit 0
