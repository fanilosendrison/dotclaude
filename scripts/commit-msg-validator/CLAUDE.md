# commit-msg-validator — Valide les messages de commit (Conventional Commits)

## Usage

Hook Claude Code `PreToolUse` sur `Bash`. Se déclenche automatiquement.

```bash
bun ~/.claude/scripts/commit-msg-validator/src/cli.ts  # via hook stdin
bun test commit-msg-validator                           # tests
```

## Architecture

```
src/
├── cli.ts                  # Entry point (lit stdin, output HookOutput JSON)
├── lib/
│   ├── types.ts            # HookInput/HookOutput interfaces
│   └── validator.ts        # extractCommitMessage, isGitCommit, validateCommitMessage
└── __tests__/
    └── validator.test.ts   # 46 tests
```

## Flow

1. Reçoit `HookInput` JSON sur stdin
2. Si pas `Bash` ou pas `git commit` → exit 0 (pass-through silencieux)
3. Extrait le message de commit depuis `-m "..."`, `-m '...'`, ou HEREDOC
4. Si pas de `-m` (commit éditeur) → exit 0 (can't validate)
5. Valide : type, scope, format, 72 chars, impératif, pas de majuscule, pas de point, pas vague
6. Si valide → exit 0
7. Si invalide → output `HookOutput` JSON avec `permissionDecision: "deny"` + erreurs

## Invariants

- Pass-through silencieux pour toute commande non-commit
- Ne bloque jamais un commit sans `-m` (mode éditeur)
- Exit 0 en cas d'erreur de parsing (fail-open, pas fail-closed)
- Aucun side-effect (pas de log, pas d'écriture fichier)

## Output

- Silencieux si la commande passe
- JSON `HookOutput` sur stdout si bloqué, avec raisons lisibles
