---
name: readme-generate
version: "0.1.0"
description: "Generate or update an actionable README.md via readme-writer"
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
    description: "STACK_EVAL.yaml from step 03 — provides stack info for prerequisites section"
  - name: claude_md
    path: CLAUDE.md
    required: false
    description: "CLAUDE.md from step 06 (optional — README still generated without it)"
outputs:
  - name: readme
    description: "Path to README.md"
parameters:
  flags:
    - "--light"
    - "--dry-run"
---

# Step 08 — README Generate

Générer ou mettre à jour le README.md avec des instructions actionables.

## Skip conditions

- **`--light`** : skip cette étape. Le README placeholder de git-preflight reste en place. Afficher : `README: skip (--light)`
- **`--dry-run`** : skip (pas d'écriture).

## Execution

Invoquer `/readme-writer`.

Le readme-writer :
1. Scanne le projet (manifeste, scripts, configs, STACK_EVAL.yaml, CLAUDE.md)
2. Génère un README conforme au template : Getting Started, Prerequisites, install/test/run
3. Référence des commandes réelles et testées (celles validées au Step 07)

## Pré-requis fichiers

Lire `STACK_EVAL.yaml` à la racine du projet pour la stack et les commandes. Si `CLAUDE.md` existe, le lire aussi pour les commandes de vérification validées au Step 07. Le README référence des commandes réelles, pas des placeholders.

## Comportement

- Le README existant (créé par git-preflight) est un placeholder minimal → il est écrasé.
- Si le projet n'a pas encore de description claire → le README aura un one-liner générique. C'est OK, il sera enrichi plus tard.

## Si échec

**Continuer** — informer l'utilisateur. Le README placeholder de git-preflight reste en place. Pas bloquant pour la suite.
