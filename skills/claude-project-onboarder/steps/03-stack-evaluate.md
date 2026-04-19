---
name: stack-evaluate
version: "0.1.0"
description: "Evaluate technical stack and produce STACK_EVAL.yaml"
allowed_tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
inputs:
  - name: project_index
    path: PROJECT_INDEX.md
    required: false
    description: "PROJECT_INDEX.md from step 02 (optional — stack-evaluator works with reduced context)"
outputs:
  - name: stack_eval
    description: "Path to STACK_EVAL.yaml"
parameters:
  flags:
    - "--force"
    - "--dry-run"
---

# Step 03 — Stack Evaluate

Évaluer la stack technique du projet et produire `STACK_EVAL.yaml`.

## Execution

Invoquer `/stack-evaluator`.

Le stack-evaluator :
1. Scanne les fichiers du repo (manifestes, configs, code source) — le résumé produit par l'agent de scan reste en contexte pour le step 04 (libs-evaluate)
2. Évalue ~17 dimensions (11 méta-choix structurants + 6 validations d'hygiène). Les libs applicatives sont évaluées séparément au step 04.
3. Pose des questions si les signaux sont insuffisants
4. Produit `STACK_EVAL.yaml`

## Comportement

- Si `STACK_EVAL.yaml` existe et `--force` n'est pas activé → **skip** (réutiliser l'existant). Informer l'utilisateur. Ne jamais demander — pour re-évaluer, relancer avec `--force`.
- Si manquant → évaluer
- Si `--force` → toujours réévaluer
- Si `--dry-run` → afficher ce qui serait évalué sans écrire

## Contexte

Si `PROJECT_INDEX.md` existe à la racine (produit par Step 02), le lire pour cibler les fichiers pertinents. Sinon, le stack-evaluator scanne le repo directement — il fonctionne avec moins de contexte mais un résultat correct.

## Contraintes environnement

Le CLAUDE.md global interdit Docker et Homebrew (macOS Monterey 12.7.6). Si le stack-evaluator propose `containerization: DOCKER`, le corriger en `NO-DOCKER` et choisir l'isolation appropriée (VENV, CONDA, ou NONE).

## Artefact produit

`STACK_EVAL.yaml` — contient notamment :
- `decisions.language` : langage principal
- `decisions.runtime` : runtime + version
- `decisions.package_manager` : gestionnaire de paquets
- `decisions.containerization` : DOCKER ou NO-DOCKER
- `decisions.isolation` : VENV, CONDA, DEVCONTAINER, NIX, NONE
- `decisions.database` : type de base de données (ou none)

## Si échec

**Abort** — `STACK_EVAL.yaml` est requis pour les Steps 04 (libs-evaluate), 05 (git-preflight, .gitignore), 06 (CLAUDE.md) et 07 (Environnement). Diagnostiquer l'erreur et retenter. Ne pas continuer sans cet artefact.
