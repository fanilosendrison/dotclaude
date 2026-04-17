# git-commits-skill-reminder — Rappel d'invocation du skill /git-commits

## Usage

Hook Claude Code `PreToolUse` sur `Bash`. Se déclenche automatiquement.

```bash
bun ~/.claude/scripts/git-commits-skill-reminder/src/cli.ts  # via hook stdin
```

## Flow

1. Reçoit `HookInput` JSON sur stdin
2. Si pas `Bash` ou pas `git commit` → exit 0 (pass-through silencieux)
3. Si `git commit` détecté → injecte un rappel non-bloquant dans le contexte
4. Le rappel demande à Claude de vérifier que `/git-commits-push` a été invoqué

## Invariants

- Non-bloquant : `permissionDecision: "allow"` toujours
- Pass-through silencieux pour toute commande non-commit
- Exit 0 en cas d'erreur de parsing (fail-open)
- Aucun side-effect
