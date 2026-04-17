---
name: semver-convention
description: "Semantic Versioning (SemVer 2.0.0) convention for all version numbers. Apply when generating, updating, or validating a version number anywhere: package.json, YAML frontmatter, pipeline files, tags, changelogs. Use when the user says 'version', 'bump version', 'quelle version', 'SemVer', 'numéro de version', or when any file contains a version field to set."
---

# SemVer Convention

Semantic Versioning 2.0.0 — spec complète : https://semver.org

## Format

```
MAJOR.MINOR.PATCH[-prerelease][+build]
```

Toujours **3 segments**. `1.0` est invalide — écrire `1.0.0`.

## Règles de bump

| Changement | Bump | Exemple |
|---|---|---|
| Breaking change (API incompatible) | MAJOR | `1.2.3` → `2.0.0` |
| Nouvelle fonctionnalité rétrocompatible | MINOR | `1.2.3` → `1.3.0` |
| Bug fix, correction sans changement d'API | PATCH | `1.2.3` → `1.2.4` |

Quand MAJOR est bumpé → MINOR et PATCH reset à 0.
Quand MINOR est bumpé → PATCH reset à 0.

## Mapping Conventional Commits → SemVer

| Commit type | Bump |
|---|---|
| `feat` | MINOR |
| `fix` | PATCH |
| `perf` | PATCH |
| `revert` | Dépend du commit reverté |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | Aucun bump de version |
| Tout type avec `!` ou footer `BREAKING CHANGE:` | MAJOR |

## Phase 0.x.y — développement initial

- Commencer à `0.1.0` (jamais `0.0.0`, jamais `1.0`)
- `0.x.y` = API instable, tout peut changer à tout moment
- Breaking changes en `0.x.y` bumpent MINOR : `0.1.0` → `0.2.0`
- Nouvelles features en `0.x.y` bumpent MINOR : `0.1.2` → `0.2.0`
- Fixes bumpent PATCH : `0.1.2` → `0.1.3`
- Passer à `1.0.0` quand le projet est utilisé en production ou a une API stable

## Pre-release et build metadata

```
1.0.0-alpha        # pre-release
1.0.0-alpha.1      # pre-release avec numéro
1.0.0-beta.2       # beta
1.0.0-rc.1         # release candidate
1.0.0+build.123    # build metadata (ignoré dans le tri)
```

Ordre de précédence : `alpha` < `beta` < `rc` < release.

## Où appliquer

- `package.json` / `pyproject.toml` / `Cargo.toml` — champ `version`
- YAML frontmatter (`version: "X.Y.Z"`) — pipelines, steps, skills
- Git tags : `vX.Y.Z` (préfixe `v` obligatoire pour les tags)
- Changelogs : en-tête `## [X.Y.Z] - YYYY-MM-DD`

## Anti-patterns

```
# ❌ Deux segments
version: "1.0"

# ❌ Commencer à 0.0.0
version: "0.0.0"

# ❌ Commencer à 1.0.0 pour du WIP
version: "1.0.0"    # si c'est pas encore stable → 0.1.0

# ❌ Préfixe v dans les fichiers de config
version: "v1.2.3"   # le v est pour les git tags, pas les fichiers

# ❌ Bump MAJOR pour un fix
1.2.3 → 2.0.0       # si c'est juste un bug fix → 1.2.4
```
