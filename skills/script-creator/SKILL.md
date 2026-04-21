---
name: script-creator
description: Crée un nouveau script dans `~/.claude/scripts/` en suivant la convention du template "Script" de `~/.claude/TEMPLATES.md`. Use when the user says "crée un script", "nouveau script", "create script", "scaffold script", "script-creator", or any variant requesting the creation of a new CLI script in the scripts directory.
---

# Script Creator

Scaffolder de scripts `~/.claude/scripts/`. Génère le dossier, le squelette bash, et le CLAUDE.md pré-rempli.

## Argument

Argument attendu : `<nom> <description courte>`

Exemple : `deploy-check Vérifie que le déploiement est prêt`

- Premier mot = nom du script (kebab-case)
- Le reste = description courte

## Workflow

1. **Parser** l'argument : nom + description
2. **Vérifier** que `~/.claude/scripts/<nom>/` n'existe pas déjà → si oui, prévenir et stop
3. **Créer** le dossier `~/.claude/scripts/<nom>/`
4. **Créer** `~/.claude/scripts/<nom>/<nom>.sh` :
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   # <description>
   # Usage: bash ~/.claude/scripts/<nom>/<nom>.sh [args]

   ```
5. **Créer** `~/.claude/scripts/<nom>/CLAUDE.md` suivant le template ci-dessous
6. **Rendre exécutable** : `chmod +x` sur le .sh
7. **Afficher** le résumé de ce qui a été créé

## Template CLAUDE.md

Suivre exactement la structure "Script" de `~/.claude/TEMPLATES.md` :

```markdown
# <nom> — <Description courte>

<Ce que fait le script (1 ligne)>

## Usage

\`\`\`bash
bash ~/.claude/scripts/<nom>/<nom>.sh [args]
\`\`\`

## Flow

1. [TODO]
2. [TODO]

## Invariants

- [TODO — idempotence, exit codes, etc.]

## Output

- [TODO — ce que le script affiche / retourne]
```

La section `## Architecture` est optionnelle (uniquement si multi-fichiers).

## Règles

- **Ne PAS implémenter** la logique du script — juste le squelette
- Le CLAUDE.md doit avoir toutes les sections requises avec des placeholders `[TODO]`
- Si le nom existe déjà → prévenir et ne rien écraser
- Nommage kebab-case uniquement
