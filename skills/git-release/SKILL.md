---
name: git-release
description: Guide semantic versioning, tagging, release workflows, changelog generation, and Git history management. Use when the user asks about SemVer, creating tags, preparing a release, generating a changelog, managing Git history (rebase, force-push rules), or resolving conflicts. Triggers include "release", "tag", "version", "SemVer", "changelog", "rebase", "force push", "conflit git".
---

# Git Release

Versionner, taguer et releaser proprement avec SemVer. Maintenir un historique Git clean.

## Trigger

L'utilisateur travaille sur des releases ou la gestion d'historique. Signaux :
- "je release", "on tag", "quelle version"
- "SemVer", "versionnement"
- "changelog", "release notes"
- "rebase", "force push", "conflit"
- "nettoyer l'historique"

---

## Part 1 — Semantic Versioning (SemVer 2.0.0)

### Format

```
v<MAJOR>.<MINOR>.<PATCH>[-<pre-release>][+<build-metadata>]
```

### Règles de bump

| Bump | Quand | Exemple |
|------|-------|---------|
| **MAJOR** | Breaking change — modification d'API incompatible | `v1.2.3` → `v2.0.0` |
| **MINOR** | Nouvelle feature, rétro-compatible | `v1.2.3` → `v1.3.0` |
| **PATCH** | Bug fix, rétro-compatible | `v1.2.3` → `v1.2.4` |

### Versions pre-release

Pour les versions instables avant une release officielle :

```
v2.0.0-alpha.1    # Développement early, tout peut changer
v2.0.0-beta.1     # Feature-complete, peut avoir des bugs
v2.0.0-rc.1       # Release candidate, devrait être production-ready
```

Précédence : `alpha` < `beta` < `rc` < release.

### Règles pre-1.0.0

Quand le projet est en `v0.x.y` :
- L'API est considérée **instable**
- Les breaking changes incrémentent **MINOR** (pas MAJOR)
- `v0.1.0` → `v0.2.0` peut être un breaking change
- Le passage à `v1.0.0` signale une API publique stable

### Aide à la décision

Quand tu hésites sur le bump :

1. Ce changement casse des consommateurs existants ? → **MAJOR**
2. Ça ajoute de la fonctionnalité sans rien casser ? → **MINOR**
3. Ça fixe un bug sans ajouter de feature ni casser quoi que ce soit ? → **PATCH**
4. C'est du docs/chore/refactor sans changement d'API publique ? → **Pas de bump** (ou PATCH si packagé)

---

## Part 2 — Tagging

### Règles

- Les tags sont créés **uniquement sur `main`**
- Toujours utiliser des **tags annotés** (pas lightweight) :

```bash
git tag -a v1.2.0 -m "Release v1.2.0: OAuth2 support, export bugfix"
git push origin v1.2.0
```

- Le message du tag résume les changements majeurs de la release
- Les noms de tags commencent toujours par `v` (minuscule)

### Workflow de tagging

```bash
# 1. S'assurer d'être sur main et à jour
git checkout main
git pull origin main

# 2. Vérifier le commit à taguer
git log --oneline -5

# 3. Créer le tag annoté
git tag -a v1.2.0 -m "Release v1.2.0: <summary>"

# 4. Pousser le tag
git push origin v1.2.0
```

### Lister et inspecter des tags

```bash
# Lister tous les tags triés par version
git tag --sort=-v:refname

# Voir les détails d'un tag
git show v1.2.0

# Trouver quel tag contient un commit spécifique
git tag --contains <commit-hash>
```

---

## Part 3 — Workflow de release

### Workflow standard

```
dev ──── PR ──── main ──── tag v1.2.0
```

1. Travailler dans `dev` (features et fixes mergent dans `dev` au quotidien)
2. Quand c'est prêt pour la prod : ouvrir une PR `dev` → `main` (merge commit)
3. Taguer `main` après le merge

Pas besoin de branche `release/` en solo.

### Hotfix

```
main ──── hotfix/critical-fix ──── main + dev
                  │                     │
              fix the bug          merge + tag v1.2.1
```

1. Créer `hotfix/` depuis `main`
2. Fixer le bug critique
3. Merger dans `main` avec merge commit
4. Taguer immédiatement
5. Merger aussi dans `dev` pour propager le fix

---

## Part 4 — Changelog

Le changelog est **toujours autogénéré** via **git-cliff** depuis les Conventional Commits. Jamais écrit à la main.

### Générer le changelog

```bash
# Régénérer tout le CHANGELOG.md
git-cliff -o CHANGELOG.md

# Prévisualiser ce qui sera dans la prochaine release (sans écrire)
git-cliff --unreleased

# Générer uniquement depuis le dernier tag
git-cliff --latest -o CHANGELOG.md
```

### Format de sortie

git-cliff groupe les changements par type automatiquement :

```markdown
## [1.2.0] - 2025-03-15

### Features
- **auth**: add OAuth2 authorization code flow with PKCE (GH-42)

### Bug Fixes
- **export**: handle empty dataset without crashing (GH-108)

### Maintenance
- **deps**: bump express from 4.18.2 to 4.19.0
```

### Intégration dans le workflow de release

Avant de taguer :

```bash
git-cliff --tag v1.2.0 -o CHANGELOG.md    # génère avec le futur tag
git add CHANGELOG.md
git commit -m "docs: update changelog for v1.2.0"
```

La config (`cliff.toml`) est générée à l'init du repo (voir script `git-preflight`).

---

## Part 5 — Gestion d'historique

### Règles fondamentales

| Règle | Pourquoi |
|-------|---------|
| **Jamais de force-push** sur `main` ou `dev` | Protège l'historique, empêche la perte de données |
| **Rebase autorisé** sur les branches éphémères avant PR | Nettoyer les commits WIP |
| **Rebase interactif encouragé** avant merge | Squash les fixups, réordonne, reword |
| **Préférer `git pull --rebase`** à `git pull --merge` | Évite les commits de merge parasites |

### Configurer pull en rebase par défaut

```bash
# Par repo
git config --local pull.rebase true

# Global
git config --global pull.rebase true
```

### Workflow de rebase interactif

Avant d'ouvrir une PR, nettoyer ta branche :

```bash
# Rebase sur main et nettoyer les commits
git fetch origin
git rebase -i origin/dev

# Dans l'éditeur :
# pick   abc1234 feat(auth): add login endpoint
# squash def5678 wip: fix typo
# squash 789abcd wip: add missing test
# reword 123defg fix(auth): handle expired tokens
```

### Résolution de conflits

1. **Toujours résoudre sur ta propre branche** en rebasant sur la cible
2. **Jamais résoudre des conflits directement sur `main` ou `dev`**
3. Après résolution, **lancer tous les tests** avant de push
4. Si le rebase est trop chaotique, considérer un merge à la place (pragmatisme > pureté)

```bash
# Résoudre les conflits pendant un rebase
git rebase origin/dev
# ... fix conflicts dans chaque fichier ...
git add <resolved-files>
git rebase --continue

# Si c'est trop le bordel, abort et essayer autrement
git rebase --abort
```

### Urgence : Secret dans l'historique

Si un secret a été commité :

1. **Révoquer le secret immédiatement** — considérer qu'il est compromis
2. Nettoyer l'historique avec `git filter-repo` (pas `filter-branch`, deprecated)
3. Force-push la branche nettoyée (c'est le seul scénario acceptable de force-push)

```bash
pip install git-filter-repo
git filter-repo --invert-paths --path <file-with-secret>
git push --force-with-lease
```

---

## Outils d'automation

| Outil | Usage |
|-------|-------|
| **git-cliff** | Génération de changelog (Rust, rapide, configurable) |
| **standard-version** | Auto-bump version + changelog depuis Conventional Commits (Node.js) |
| **semantic-release** | Versioning entièrement automatisé + npm publish + GitHub release |
| **release-please** | Automation de release Google pour GitHub |
| **gitleaks** / **trufflehog** | Détecter des secrets dans l'historique |
| **git-filter-repo** | Réécrire l'historique (supprimer fichiers, secrets) |

## Guidelines

- **Toujours confirmer le version bump** avant de taguer — demander ce qui a changé et dériver le bon bump
- **Générer la commande de tag** prête à copier-coller
- **Signaler les breaking changes** qui auraient pu être manqués (exports renommés, endpoints supprimés, signatures changées)
- **Recommander l'automation** quand le projet a assez de Conventional Commits pour bénéficier d'un auto-changelog
- **Être pragmatique sur l'historique** — un historique clean est un outil, pas une religion. Ne pas rebase si ça crée plus de problèmes que ça n'en résout.
