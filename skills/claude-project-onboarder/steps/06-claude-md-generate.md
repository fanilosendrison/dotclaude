---
name: claude-md-generate
version: "0.1.0"
description: "Generate project CLAUDE.md directives from STACK_EVAL.yaml"
allowed_tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
inputs:
  - name: stack_eval
    path: STACK_EVAL.yaml
    required: true
    description: "STACK_EVAL.yaml from step 03 — provides all [YAML] fields for CLAUDE.md generation"
outputs:
  - name: claude_md
    description: "Path to CLAUDE.md"
parameters:
  flags:
    - "--force"
    - "--dry-run"
---

# Step 06 — Generate CLAUDE.md

Générer le fichier `CLAUDE.md` du projet avec les directives spécifiques.

## Execution

Invoquer `/claude-md-creator`.

Le claude-md-creator :
1. Lit `STACK_EVAL.yaml` pour les champs `[YAML]` (runtime, package manager, isolation, etc.)
2. Déduit les champs `[INFER]` du contexte du projet (structure, conventions, etc.)
3. Produit `CLAUDE.md` à la racine du projet

## Comportement

- Si `CLAUDE.md` existe et `--force` n'est pas activé → **skip** (conserver l'existant). Informer l'utilisateur. Ne jamais demander — pour écraser, relancer avec `--force`.
- Si manquant → générer
- Si `--force` → toujours régénérer
- Si `--dry-run` → afficher un aperçu sans écrire

## Cohérence des commandes

`claude-md-creator` lit `decisions.containerization`, `decisions.isolation` et `decisions.package_manager` dans `STACK_EVAL.yaml`. Les commandes de vérification dans CLAUDE.md doivent utiliser le préfixe adapté :

| Environnement | package_manager | Préfixe |
|---|---|---|
| Venv | `uv` | `uv run <cmd>` |
| Venv | `poetry` | `poetry run <cmd>` |
| Venv | `pip` | `.venv/bin/<cmd>` |
| Conda | any | `conda run -n <env> --no-capture-output <cmd>` |
| Direct | any | `<cmd>` (pas de préfixe) |

Vérifier la cohérence après génération. Si incohérent → corriger CLAUDE.md immédiatement.

## Artefact produit

`CLAUDE.md` — directives projet pour Claude Code (propriétés fondamentales, commandes de vérification, conventions, structure).

## Si échec

**Continuer** — informer l'utilisateur. Step 07 (Environnement) peut fonctionner sans CLAUDE.md, mais la vérification des commandes (step 07 sub-step 7d) sera skippée.
