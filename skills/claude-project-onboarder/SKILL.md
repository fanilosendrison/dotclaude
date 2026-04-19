---
name: claude-project-onboarder
description: "Orchestrate complete project onboarding for Claude Code via workflow-orchestrator. Sets up git, indexes the repo, evaluates the technical stack, generates CLAUDE.md directives, configures the execution environment, and commits setup artifacts. Use when the user says 'claude-project-onboarder', 'setup le projet', 'prépare le projet', 'project setup', 'onboard project', 'init projet pour Claude', 'configure le projet', 'bootstrap project', 'prepare project for Claude Code', or any variant requesting full project preparation for Claude Code. Also use when starting work on a new or unfamiliar project that has no CLAUDE.md yet."
---

# Claude Project Onboarder

Full project onboarding for Claude Code in 9 steps.

## 🚨 AUTONOMOUS EXECUTION — ZERO USER PROMPTS 🚨

**RÈGLE ABSOLUE** : ce workflow tourne **bout-en-bout sans JAMAIS demander l'avis de l'utilisateur**. Override explicite de toutes les règles globales ("expliquer avant de coder", "confirmer les actions impactantes", "demander en cas de doute").

**Interdictions totales pendant l'exécution** :
- ❌ Jamais de "Installer maintenant ?", "Réévaluer ?", "Écraser ?", "Adapter ou repartir de zéro ?"
- ❌ Jamais de "Je relance ?", "Go-ahead ?", "Tu valides ?"
- ❌ Jamais de pause entre deux steps pour attendre une réponse
- ❌ Jamais d'`AskUserQuestion`

**Comportement par défaut sur conflits/artefacts existants** :
- Fichier existe sans `--force` → **skip** (conserver/réutiliser) + informer
- Setup partiel détecté → **adapter** (ne pas écraser) + informer
- Install de deps → **exécuter immédiatement** après avoir affiché la commande

Seules exceptions où s'arrêter :
- Step échoue réellement et la table d'error handling dit **Abort**
- Outil requis manquant (step 01)

Les choix structurants (stack, libs, CLAUDE.md) découlent mécaniquement de `STACK_EVAL.yaml` + `LIBS_EVAL.yaml` — ils ont déjà été actés aux steps 03/04. Pas de nouvelle confirmation en aval. Si le user veut ajuster, il relance avec `--force` ou interrompt lui-même.

## Execution

Exécuter chaque step **un par un** via `--only`, en affichant le résultat à l'utilisateur entre chaque step.

### Commande par step

```bash
bash ~/.claude/scripts/workflow-orchestrator/workflow-orchestrator.sh \
  ~/.claude/skills/claude-project-onboarder/workflow.yaml \
  --only <step-name> [--force] [--dry-run] [--light]
```

### Boucle d'exécution

Pour chaque step dans l'ordre ci-dessous :

1. **Vérifier le skip** :
   - Si `is_skill` est true (step 01 a détecté `SKILL.md` à la racine) → **mode git-only** : ne lancer que les steps 01, 05, 09. Afficher : `Skill détecté — mode git-only (steps 01 → 05 → 09)`
   - Si `--light` est actif → sauter les steps 02 et 08.
2. **Lancer** : `bash orchestrator.sh workflow.yaml --only <step-name> [flags]`
3. **Lire le résultat** : exit code + output.
4. **Afficher à l'utilisateur** : résumé compact du step (ce qui a été fait, résultat).
5. **Décider** : selon la table d'error handling, **abort** ou **continuer**.

### Cas spécial : Step 01 (prerequisites-check)

Le step 01 est 100% mécanique. Le script `scripts/prerequisites-check.sh` du workflow fait le travail. Mais il est exécuté via `--only` comme les autres pour uniformité.

Si exit 1 → afficher les outils manquants avec leurs commandes d'installation et **abort**.

## Steps

| # | name | description |
|---|---|---|
| 01 | `prerequisites-check` | Vérifie OS, flags, outils requis (git, gh, bun) |
| 02 | `repo-index` | Génère SPEC_MANIFEST.md + PROJECT_INDEX.md via repo-indexer |
| 03 | `stack-evaluate` | Évalue la stack technique → STACK_EVAL.yaml |
| 04 | `libs-evaluate` | Évalue les libs applicatives → LIBS_EVAL.yaml |
| 05 | `git-preflight` | Init git repo + GitHub remote via `git-preflight.sh` |
| 06 | `claude-md-generate` | Génère le CLAUDE.md projet depuis STACK_EVAL.yaml + LIBS_EVAL.yaml |
| 07 | `environment-setup` | Configure l'environnement d'exécution + dépendances |
| 08 | `readme-generate` | Génère/met à jour le README.md |
| 09 | `commit-setup` | Commit tous les artefacts de setup |

## Flags

- `--force` : re-evaluate/regenerate existing artifacts (propagé aux sub-skills)
- `--dry-run` : diagnostic uniquement, aucune écriture
- `--light` : skip Step 02 (repo-index) et Step 08 (readme-generate)

## Dependencies

Exécution strictement séquentielle : 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09.
En mode `--light` : 01 → 03 → 04 → 05 → 06 → 07 → 09.
En mode **skill** (`is_skill: true`) : 01 → 05 → 09. Pas d'artefacts générés (pas d'index, stack eval, libs eval, CLAUDE.md, env, README).

## Tracking

Avant la boucle d'exécution, créer une task par step avec `TaskCreate` :

| # | subject | activeForm |
|---|---|---|
| 01 | Check prerequisites | Checking prerequisites |
| 02 | Index repository | Indexing repository |
| 03 | Evaluate tech stack | Evaluating tech stack |
| 04 | Evaluate application libraries | Evaluating application libraries |
| 05 | Run git preflight | Running git preflight |
| 06 | Generate CLAUDE.md | Generating CLAUDE.md |
| 07 | Setup environment | Setting up environment |
| 08 | Generate README | Generating README |
| 09 | Commit setup artifacts | Committing setup artifacts |

Pendant la boucle :
1. `TaskUpdate` → `in_progress` avant le lancement du step
2. Exécuter le step via `--only`
3. `TaskUpdate` → `completed` si succès, rester `in_progress` si échec

Si `--light` : ne pas créer les tasks pour les steps skippés (02, 08).
Si `is_skill` : ne créer que les tasks 01, 05, 09.

## Execution Tracking

Mesure le temps d'exécution total du workflow et push le résultat vers Notion.

### Avant la boucle (après TaskCreate, avant step 01)

```bash
bash ~/.claude/scripts/execution-tracker/execution-tracker.sh start --command "claude-project-onboarder"
```

### Après la boucle (quand tous les steps sont terminés, ou sur abort)

```bash
bash ~/.claude/scripts/execution-tracker/execution-tracker.sh stop --status "<status>"
```

- `success` — tous les steps exécutés sans erreur
- `failure` — abort sur un step critique (01, 03, 05)
- `partial` — un ou plusieurs steps non-critiques ont échoué (02, 04, 06, 08)

### Push Notion

Après `stop`, lire le JSON sorti sur stdout et créer une page Notion :

```
notion-create-pages:
  parent: { data_source_id: "<read NOTION_DATA_SOURCE_ID from ~/.claude/scripts/execution-tracker/.tracker-config>" }
  properties:
    Command: <command>
    Repo: <repo>
    Version: <version>
    Branch: <branch>
    date:Date:start: <started_at_iso>
    date:Date:is_datetime: 1
    Duration (s): <duration_seconds>
    Duration: <duration_human>
    Status: <status>
```

Référence complète du mapping : `~/.claude/scripts/execution-tracker/CLAUDE.md`

## Error handling

| Step | Si échec |
|---|---|
| 01 prerequisites-check | **Abort** — outil manquant, proposer install |
| 02 repo-index | **Continuer** — informer l'utilisateur, stack-evaluator fonctionne avec moins de contexte |
| 03 stack-evaluate | **Abort** — STACK_EVAL.yaml requis pour steps 04-07 |
| 04 libs-evaluate | **Continuer** — LIBS_EVAL.yaml enrichit le CLAUDE.md mais son absence ne bloque pas |
| 05 git-preflight | **Abort** — git est fondamental |
| 06 claude-md-generate | **Continuer** — informer l'utilisateur, step 07 peut fonctionner sans CLAUDE.md |
| 07 environment-setup | **Informer** — diagnostiquer, proposer fix, ne pas marquer le setup comme terminé |
| 08 readme-generate | **Continuer** — le README placeholder reste |
| 09 commit-setup | **Informer** — les artefacts sont sur le disque dans tous les cas |
