# Scripts - Project Memory

Monorepo containing Claude Code utilities and extensions.

## Structure

```
scripts/
├── auto-rename-session/    # Auto-generates session titles via AI
├── claude-code-ai/         # Shared Claude API helpers
├── command-validator/      # Security validation for bash commands
├── commit-msg-validator/   # Conventional Commits validation (PreToolUse hook)
├── hook-utils/             # Shared types & I/O helpers for hooks
├── index-repo/             # Repo indexer CLI
├── loop-clean-protocol/    # Deterministic scope/findings/routing/Git protocol
├── post-write-linter/      # Auto lint/format/typecheck on Write/Edit (PostToolUse hook)
├── secret-scanner/         # Secret detection in staged files (PreToolUse hook)
├── statusline/             # Custom statusline for Claude Code
└── package.json            # Root package with all scripts
```

## Commands

```bash
bun run test              # Run all tests
bun run lint              # Lint all packages
```

### Per-Package Commands

| Package | Test | Start |
|---------|------|-------|
| auto-rename-session | `bun run auto-rename:test` | `bun run auto-rename:start` |
| claude-code-ai | `bun run ai:test` | - |
| command-validator | `bun run validator:test` | `bun run validator:cli` |
| commit-msg-validator | `bun run commit-msg:test` | `bun run commit-msg:cli` |
| secret-scanner | `bun run secret-scanner:test` | `bun run secret-scanner:cli` |
| hook-utils | — | — |
| index-repo | `bun run indexer:test` | `bun run indexer:cli` |
| loop-clean-protocol | `bun run loop-clean-protocol:test` | `bun loop-clean-protocol/src/cli.ts` |
| post-write-linter | `bun run post-write-linter:test` | `bun run post-write-linter:cli` |
| statusline | `bun run statusline:test` | `bun run statusline:start` |

## Cross-Platform Support

All packages support macOS, Linux, and Windows (via WSL):
- Use `path.join()` instead of string concatenation
- Use `os.homedir()` instead of `process.env.HOME`
- Use `path.sep` or regex `[/\\]` for path splitting

## Shared Dependencies

- `@ai-sdk/anthropic` + `ai` - Claude API access
- `picocolors` - Terminal colors
- `@biomejs/biome` - Linting/formatting
- `bun:test` - Testing

## Credentials

Claude Code OAuth tokens are retrieved via `claude-code-ai/helper/credentials.ts`:
- macOS: Keychain (`security find-generic-password`)
- Linux/Windows: `~/.claude/.credentials.json`
