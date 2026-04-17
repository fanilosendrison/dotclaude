---
name: git-conventions
description: Index skill for Git conventions. Routes to the appropriate sub-skill based on the user's intent. Use when the user mentions "convention git", "git workflow", "bonnes pratiques git", or asks a general Git process question.
---

# Git Conventions — Index

Skill de routage central pour toutes les conventions Git.

## Trigger

L'utilisateur pose une question générale sur les conventions Git. Signaux :
- "convention git"
- "bonnes pratiques git"
- "comment on gère git sur ce projet"
- "git workflow"

## Routing

Identifier l'intention et rediriger vers le bon skill :

| Intention | Skill | Signaux |
|-----------|-------|---------|
| Setup d'un nouveau repo | `git-preflight` (script) | "init", "nouveau repo", "configure git", ".gitignore" |
| Branches et nommage | `git-branches` | "branche", "feature branch", "hotfix", "naming" |
| Messages de commit + push | `git-commits-push` | "commit", "message de commit", "conventional commits" |
| Pull requests | `git-pr` | "PR", "pull request", "merge strategy" |
| Tags, versions, releases | `git-release` | "release", "tag", "version", "SemVer", "changelog" |

Si l'intention est ambiguë, fournir un résumé de toutes les conventions avec références à chaque sub-skill.

## Résumé des conventions

Quand l'utilisateur veut une vue d'ensemble :

1. **Modèle** : `main` (prod) + `dev` (travail courant) + branches éphémères typées (`feature/`, `fix/`, `hotfix/`, `chore/`, `docs/`, `experiment/`)
2. **Commits** : Conventional Commits 1.0.0 — `<type>(<scope>): <description>`, impératif présent, 72 chars max
3. **PR** : Titre au format Conventional Commits, template structuré, squash and merge pour éphémères → `dev`, merge commit pour `dev` → `main`
4. **Versionnement** : SemVer 2.0.0, tags annotés sur `main` uniquement
5. **Historique** : Pas de force-push sur `main`/`dev`, rebase sur branches éphémères, `git pull --rebase`
6. **Automation** : gitleaks en pre-commit pour les secrets, hooks Claude Code pour le reste

## Guidelines

- **Langue** : Suivre la langue de l'utilisateur
- **Ton** : Prescriptif mais pragmatique — expliquer le pourquoi derrière chaque règle
- **Ne pas imposer d'outils spécifiques** : Proposer des options sans forcer un choix
