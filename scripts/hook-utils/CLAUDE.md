# hook-utils — Shared utilities for Claude Code hooks

## Usage

```typescript
import { readHookInput, allow, deny, ask, skip } from "../hook-utils/src/index.ts";
```

## Architecture

```
hook-utils/
├── CLAUDE.md
└── src/
    ├── index.ts       # Re-exports
    ├── types.ts       # HookInput + PreToolUse/PostToolUse output types
    └── io.ts          # readHookInput, allow, deny, ask, skip
```

## Flow

1. `readHookInput()` reads stdin → parses JSON → returns `HookInput`
2. Hook logic decides: allow, deny, ask, or skip
3. Output function emits correct JSON format based on `hook_event_name` (PreToolUse vs PostToolUse)

## Invariants

- **Fail-open** : invalid/empty stdin → exit 0 silencieux (jamais bloquer par erreur)
- **Format-aware** : `allow`/`deny` émettent le bon JSON selon PreToolUse ou PostToolUse
- **Never throws** : toutes les fonctions output appellent `process.exit(0)`
- **Zero dependencies** : aucune dépendance externe

## Output

- `allow(reason)` : PreToolUse → hookSpecificOutput "allow". PostToolUse + additionalContext → `{ additionalContext }`. PostToolUse sans context → exit 0.
- `deny(reason)` : PreToolUse → hookSpecificOutput "deny". PostToolUse → `{ decision: "block", reason }`.
- `ask(reason)` : PreToolUse only → hookSpecificOutput "ask".
- `skip()` : exit 0, zéro output.
