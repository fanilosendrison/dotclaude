---
name: libs-evaluate
version: "0.1.0"
description: "Evaluate application libraries and produce LIBS_EVAL.yaml"
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
    description: "STACK_EVAL.yaml from step 03 — required to filter compatible libs"
  - name: project_index
    path: PROJECT_INDEX.md
    required: false
    description: "PROJECT_INDEX.md from step 02 (optional context)"
outputs:
  - name: libs_eval
    description: "Path to LIBS_EVAL.yaml"
parameters:
  flags:
    - "--force"
    - "--dry-run"
---

# Step 04 — Libs Evaluate

Évaluer les libs applicatives du projet et produire `LIBS_EVAL.yaml`.

## Execution

Invoquer `/libs-evaluator`.

Le libs-evaluator :
1. Lit `STACK_EVAL.yaml` (obligatoire — fournit language/runtime pour le filtre dur de compat)
2. Réutilise le résumé de scan déjà produit par stack-evaluator (garde-fou contexte chaud) — pas de rescan du repo
3. Évalue ~25 capabilities de libs applicatives (schema_validation, orm, migrations, http_client/server, websocket, graphql, auth, date, i18n, queue, cache, ui_framework, styling, component_lib, state, router, forms, logging, tracing, metrics, property_testing, e2e, mocking, snapshot, cli_parsing, env_parsing, id_generation) **sans enum fermée** — Claude choisit la lib la plus pertinente par web lookup (websearch + context7), pas depuis une liste pré-définie
4. Filtre selon `project_type` (skip les capabilities non-applicables — ex : cli-tool skip UI)
5. Interroge le web (`websearch` + `context7`) en **voie par défaut**, pas en fallback — seule exception : lib déjà présente dans le manifest (signal direct)
6. **Résout le nom de package exact** via context7 (`resolve-library-id`) ou websearch pour chaque choix, et classe runtime vs dev
7. Produit `LIBS_EVAL.yaml` avec schéma v2 : chaque décision = `{ choice, package, dev, source, confidence }`

## Comportement

- Si `LIBS_EVAL.yaml` existe et `--force` n'est pas activé → **skip** (réutiliser l'existant). Informer l'utilisateur. Ne jamais demander — pour re-évaluer, relancer avec `--force`.
- Si manquant → évaluer
- Si `--force` → toujours réévaluer
- Si `--dry-run` → afficher ce qui serait évalué sans écrire
- Si `STACK_EVAL.yaml` absent → **abort** (le step 03 a dû échouer, ne pas tenter d'évaluer les libs sans stack)

## Contexte chaud — pas de rescan

Le libs-evaluator s'exécute **immédiatement après** stack-evaluator dans ce pipeline. Le résumé structuré produit par l'agent de scan de stack-evaluator est déjà dans le contexte principal. Le libs-evaluator réutilise ce résumé pour détecter les signaux libs (imports, dépendances déclarées) sans relancer de scan agent.

Si pour une raison quelconque le contexte chaud n'est pas détectable (invocation standalone), libs-evaluator relancera un scan ciblé (voir son SKILL.md step 2).

## Artefact produit

`LIBS_EVAL.yaml` — contient notamment :
- `decisions.schema_validation` : lib de validation runtime
- `decisions.orm` : ORM (ou `not-applicable` pour cli-tool/script)
- `decisions.http_server` : framework HTTP serveur
- `decisions.auth` : lib d'auth
- `decisions.ui_framework`, `styling`, `component_lib`, `state`, `router`, `forms` : stack UI (ou `not-applicable`)
- `decisions.logging`, `tracing`, `metrics` : observabilité
- `decisions.property_testing`, `e2e`, `mocking` : testing
- `decisions.cli_parsing`, `env_parsing`, `id_generation` : utilitaires
- `lib_constraints` : contraintes issues des specs (imposed / forbidden)

## Si échec

**Continuer** — `LIBS_EVAL.yaml` est consommé par le step 06 (claude-md-generate) pour enrichir le CLAUDE.md projet. Son absence dégrade le CLAUDE.md mais ne bloque pas le pipeline. Informer l'utilisateur et poursuivre.
