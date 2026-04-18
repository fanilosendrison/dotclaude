---
name: git-branches
description: Guide branching strategy, branch creation, and naming conventions. Use when the user asks about branch naming, which branch to create, or how to organize branches. Triggers include "quelle branche", "feature branch", "hotfix", "branch naming", "stratégie de branches".
---

# Git Branches

Stratégie trunk-based pour un dev solo : `main` unique + branches éphémères à la demande.

## Trigger

L'utilisateur a besoin de guidance sur les branches. Signaux :
- "quelle branche je crée pour ça ?"
- "feature branch", "hotfix"
- "comment on nomme les branches"

## Modèle

**Trunk-based** : `main` est l'unique branche permanente. On travaille directement dessus pour les changements courants. Les branches éphémères ne sont créées **que pour les chantiers risqués ou multi-commits qu'on veut batcher**.

- `main` est toujours déployable
- Pas de branche `dev` — simplicité solo-dev, pas de gate review
- Commits directs sur `main` pour : docs, fixes simples, refactors locaux, tâches terminées en une session
- Branche éphémère créée à la demande pour : migrations multi-jours, features à découper, expérimentations réversibles, refactors qui touchent beaucoup de fichiers
- Les automations (nightly-clean, routines cloud) opèrent sur leurs propres branches dédiées et mergent via PR — indépendantes de la stratégie humaine

### Branche permanente

| Branche | Rôle | Règles |
|---------|------|--------|
| `main` | Trunk. Toujours déployable. | Commits directs autorisés. Jamais de force-push. Branch protection active (block force-push + delete). |

### Branches éphémères (à la demande)

| Préfixe | Usage | Créée depuis | Merge dans |
|---------|-------|-------------|------------|
| `feature/` | Nouvelle fonctionnalité multi-commits | `main` | `main` |
| `fix/` | Bug fix nécessitant plusieurs commits | `main` | `main` |
| `hotfix/` | Fix critique à isoler | `main` | `main` |
| `chore/` | Maintenance/refactor multi-fichiers à batcher | `main` | `main` |
| `docs/` | Rare — pour doc work multi-session | `main` | `main` |
| `experiment/` | POC / spike, réversible | `main` | `main` ou abandon |

**Heuristique** : si le travail tient en une session avec un commit propre, vas direct sur `main`. Si tu prévois plusieurs commits à reviewer en bloc ou à pouvoir reverter d'un coup, crée une branche.

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

# ❌ Branche dev permanente recréée à l'aveugle
dev
develop
```

## Cycle de vie d'une branche éphémère

1. **Créer** depuis `main` à jour : `git checkout main && git pull && git checkout -b <type>/<desc>`
2. **Travailler** — commits fréquents, push régulier
3. **Rebase** sur `main` avant d'ouvrir la PR (résoudre les conflits sur ta branche)
4. **Ouvrir la PR** vers `main` — suivre la convention PR (voir skill `git-pr`)
5. **Merge** — rebase ou squash selon la granularité voulue (voir skill `git-pr`)
6. **Supprimer** la branche immédiatement après merge (locale + remote)

## Guidelines

- **Préférer `main` direct** pour le travail courant solo. La friction d'une branche doit être justifiée par un besoin de batching ou de revert facile.
- **Toujours fournir les commandes `git` exactes** pour créer une branche — pas juste le nom
- **Valider le nom** contre la convention avant de confirmer
- **Rappeler le rebase** si la branche vit longtemps (> 3 jours sans merge)
- **Si l'équipe grandit** (2+ devs actifs), revisiter : une branche `dev` peut redevenir utile comme zone d'intégration
