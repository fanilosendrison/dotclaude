---
name: git-branches
description: Guide branching strategy, branch creation, and naming conventions. Use when the user asks about branch naming, which branch to create, or how to organize branches. Triggers include "quelle branche", "feature branch", "hotfix", "branch naming", "stratégie de branches".
---

# Git Branches

Stratégie de branches simple pour un dev solo : `main` + `dev` + branches éphémères.

## Trigger

L'utilisateur a besoin de guidance sur les branches. Signaux :
- "quelle branche je crée pour ça ?"
- "feature branch", "hotfix"
- "comment on nomme les branches"

## Modèle

`main` (production) → `dev` (travail courant) → branches éphémères.

- `main` est toujours déployable, on n'y touche pas directement
- `dev` est la branche de travail par défaut — c'est là qu'on vit au quotidien
- Les branches éphémères partent de `dev` et mergent dans `dev`
- Quand c'est prêt pour la prod : `dev` → `main` via PR
- Après un `git init`, on se retrouve sur `dev` direct

### Branches permanentes

| Branche | Rôle | Règles |
|---------|------|--------|
| `main` | Code production-ready, toujours déployable | Pas de push direct. Merge depuis `dev` via PR uniquement. Jamais de force-push. |
| `dev` | Branche de travail courante | Branche par défaut après init. Les éphémères mergent ici. |

### Branches éphémères

| Préfixe | Usage | Créée depuis | Merge dans |
|---------|-------|-------------|------------|
| `feature/` | Nouvelle fonctionnalité | `dev` | `dev` |
| `fix/` | Correction de bug | `dev` | `dev` |
| `hotfix/` | Fix critique en production | `main` | `main` + `dev` |
| `chore/` | Maintenance, tooling, refactoring | `dev` | `dev` |
| `docs/` | Documentation uniquement | `dev` | `dev` |
| `experiment/` | POC, spike, exploration | `dev` | `dev` ou abandon |

> `hotfix/` est la seule exception : part de `main`, merge dans `main` ET `dev`.

## Convention de nommage

### Format

```
<type>/<ticket-id>-<short-description>
```

### Règles

1. **Tout en minuscules**, mots séparés par des tirets (kebab-case)
2. **50 caractères max** pour la partie description
3. **Pas de noms de personnes**, pas de dates
4. Préfixe ticket (GH-, JIRA-, LINEAR-) optionnel mais recommandé si un tracker existe
5. Le `<type>/` doit correspondre à un des types éphémères ci-dessus

### Exemples

```
feature/GH-42-user-authentication
feature/oauth2-provider
fix/JIRA-108-null-pointer-on-export
hotfix/critical-auth-bypass
chore/update-ci-pipeline
chore/migrate-to-eslint-9
docs/api-reference-v2
experiment/graphql-gateway-poc
```

### Anti-patterns à rejeter

```
# ❌ Pas de préfixe de type
user-authentication

# ❌ Majuscules, espaces, caractères spéciaux
Feature/GH-42_User_Authentication
feature/GH 42 user auth

# ❌ Nom de personne ou date
feature/john-auth-fix
feature/2025-01-15-auth

# ❌ Trop vague
fix/bug
feature/update
chore/stuff
```

## Cycle de vie

1. **Créer** depuis `dev` (sauf `hotfix/` → depuis `main`)
2. **Travailler** — commits fréquents, push régulier
3. **Rebase** sur `dev` avant d'ouvrir la PR (résoudre les conflits sur ta branche)
4. **Ouvrir la PR** vers `dev` — suivre la convention PR (voir skill `git-pr`)
5. **Merge** — squash pour features/fixes, merge commit pour hotfixes
6. **Supprimer** la branche immédiatement après merge

## Guidelines

- **Toujours fournir les commandes `git` exactes** pour créer une branche — pas juste le nom
- **Valider le nom** contre la convention avant de confirmer
- **Rappeler le rebase** si la branche vit longtemps (> 3 jours sans merge)
