---
name: repo-index
version: "0.1.0"
description: "Generate SPEC_MANIFEST.md and PROJECT_INDEX.md via repo-indexer"
allowed_tools:
  - Bash
  - Read
inputs: []
outputs:
  - name: spec_manifest
    description: "SPEC_MANIFEST.md — mapping déterministe spec → code → tests avec détection de gaps (specs sans code), orphelins (code sans spec), et couverture de tests"
  - name: project_index
    description: "PROJECT_INDEX.md — résumé sémantique du projet généré par Claude : scope, modules, dépendances entre composants, conventions détectées"
parameters:
  flags:
    - "--force"
    - "--light"
---

# Step 02 — Repo Index

Générer l'index du projet pour fournir du contexte structuré aux steps suivants.

## Skip conditions

- **`--light`** : skip cette étape entièrement. Si `SPEC_MANIFEST.md` / `PROJECT_INDEX.md` existent déjà, les lire silencieusement pour contexte. Sinon continuer sans. Afficher : `Index: skip (--light)`
- **`--dry-run`** : lister ce qui serait généré sans écrire.

## Execution

Invoquer `/repo-indexer`.

Le repo-indexer :
1. Scanne le projet avec `bun ~/.claude/scripts/index-repo/src/cli.ts "$PWD"`
2. Génère `SPEC_MANIFEST.md` (déterministe — cross-refs spec → code → tests)
3. Génère `PROJECT_INDEX.md` (sémantique — résumé structuré du projet)
4. Produit `.index-state.json` (état du cache)

## Artefacts produits

| Fichier | Description |
|---|---|
| `SPEC_MANIFEST.md` | Mapping specs → code → tests, gaps, orphelins |
| `PROJECT_INDEX.md` | Résumé sémantique : scope, modules, dépendances |
| `.index-state.json` | Cache d'état pour détection de staleness |

## Comportement

- Si les artefacts existent et sont frais (pas stale) et `--force` n'est pas activé → lire silencieusement, afficher `Index: frais, skip.`
- Si stale ou manquants → régénérer
- Si `--force` → toujours régénérer

## Pourquoi avant la stack

Sur un repo neuf (uniquement docs/specs, pas encore de code), le scan passif du stack-evaluator ne trouve quasi aucun fichier-signal. L'index lui fournit le contexte structuré (scope des specs, architecture visée, dépendances entre specs) pour déduire la stack avec une meilleure confiance.

## Si échec

**Continuer** — informer l'utilisateur que l'index n'a pas pu être généré. Le stack-evaluator (Step 03) fonctionnera, mais avec moins de contexte sur les repos doc-only. L'index peut être régénéré plus tard avec `/repo-indexer --force`.
