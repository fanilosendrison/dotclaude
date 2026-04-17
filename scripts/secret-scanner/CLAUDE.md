# secret-scanner — Détecte les secrets dans les fichiers staged avant commit

## Usage

Hook Claude Code `PreToolUse` sur `Bash`. Se déclenche automatiquement.

```bash
bun ~/.claude/scripts/secret-scanner/src/cli.ts  # via hook stdin
bun test secret-scanner                           # tests
```

## Architecture

```
src/
├── cli.ts                  # Entry point (lit stdin, lance git diff --cached, output HookOutput)
├── lib/
│   ├── types.ts            # HookInput/HookOutput/ScanResult/Finding interfaces
│   └── scanner.ts          # scanDiff — scanne un diff unifié pour patterns de secrets
└── __tests__/
    └── scanner.test.ts     # 24 tests
```

## Flow

1. Reçoit `HookInput` JSON sur stdin
2. Si pas `Bash` ou pas `git commit` → exit 0 (pass-through silencieux)
3. Exécute `git diff --cached --diff-filter=ACMR` pour récupérer le diff staged
4. Si pas de diff (pas un repo git, erreur) → exit 0 (fail-open)
5. Scanne les lignes ajoutées (`+`) pour des patterns de secrets :
   - AWS keys (AKIA..., aws_secret_access_key)
   - Private keys (BEGIN ... PRIVATE KEY)
   - GitHub/Slack tokens
   - Connection strings avec credentials
   - API keys, tokens, passwords hardcodés
   - .env-style secrets (SECRET_KEY, STRIPE_API_KEY, etc.)
6. Filtre les faux positifs : références à process.env, os.environ, placeholders
7. Si propre → exit 0
8. Si secrets détectés → output `HookOutput` JSON avec `permissionDecision: "deny"` + findings

## Invariants

- Ne scanne que les lignes ajoutées (pas les suppressions, pas le contexte)
- Fail-open : si `git diff` échoue, laisse passer
- Pass-through silencieux pour toute commande non-commit
- Aucune écriture fichier, aucun side-effect
- Passwords placeholders (changeme, example, xxx) ne déclenchent pas d'alerte

## Output

- Silencieux si aucun secret détecté
- JSON `HookOutput` sur stdout si bloqué, avec type de secret + ligne + contenu tronqué
