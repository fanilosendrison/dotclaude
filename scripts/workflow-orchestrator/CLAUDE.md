# workflow-orchestrator — Dispatcher de steps de workflow

Moteur minimal qui fait le pont entre un `workflow.yaml` et Claude Code. Lit le workflow, sélectionne un step par son nom, émet son markdown sur stdout. Claude lit la sortie et exécute les instructions.

Un seul consommateur actuel : `~/.claude/skills/claude-project-onboarder/`. Ré-utilisable pour tout futur skill basé sur un `workflow.yaml` listant des steps `.md` avec frontmatter.

## Usage

```bash
bash ~/.claude/scripts/workflow-orchestrator/workflow-orchestrator.sh \
  <workflow.yaml> --only <step-name> [--force] [--dry-run] [--light]

bash ~/.claude/scripts/workflow-orchestrator/workflow-orchestrator.sh \
  <workflow.yaml> --list

bash ~/.claude/scripts/workflow-orchestrator/workflow-orchestrator.sh \
  <workflow.yaml> --validate
```

## Contrat

### Input

1. Chemin vers un `workflow.yaml` (positionnel, requis).
2. Un des trois modes (mutuellement exclusifs) :
   - `--only <step-name>` → émet le step correspondant
   - `--list` → liste les steps (tab-separated : `<name>\t<file>`)
   - `--validate` → valide le workflow + tous les steps, sort 0 si OK
3. Flags passthrough (optionnels, pour `--only` uniquement) : `--force`, `--dry-run`, `--light`

### Structure attendue du workflow.yaml

```yaml
name: <workflow-name>
version: "0.x.y"
steps:
  - file: steps/01-<step-a>.md
  - file: steps/02-<step-b>.md
  # ...
```

Seule la clé `steps:` est requise pour le dispatch. `name:`, `version:`, `dependencies:` sont ignorés par l'orchestrateur (le workflow reste libre de les utiliser).

### Structure attendue d'un step .md

```markdown
---
name: <step-name>
version: "0.x.y"
description: "..."
# ...
---

# Step instructions (markdown)

<corps libre, lu et exécuté par Claude>
```

Le champ `name:` du frontmatter est la **clé de dispatch** (pas le nom de fichier). Deux steps ne peuvent pas avoir le même `name:` — `--validate` détecte les doublons.

### Output (mode `--only`)

Stdout :

```
<!-- workflow-orchestrator dispatch -->
# Step Dispatch

| Field    | Value |
|----------|-------|
| workflow | <workflow-name> |
| step     | <step-name> |
| file     | <relative-path> |
| flags    | <active-flags or "<none>"> |

Execute the instructions below. Honor the flags above (they are the effective
runtime flags — ignore any default flag hints inside the step body).

---

<contenu integral du step .md, y compris le frontmatter>
```

Claude lit la sortie complète. L'en-tête sert à l'amorçage (quel step, quels flags actifs), le corps est la spec comportementale à exécuter.

### Exit codes

| Code | Signification |
|---|---|
| `0` | OK — step dispatché / liste/validation réussies |
| `1` | Erreur workflow — fichier manquant, illisible, sans bloc `steps:`, ou noms de step dupliqués (`--validate`) |
| `2` | Step introuvable — `--only <name>` ne correspond à aucun step (stderr liste les steps disponibles) |
| `3` | Erreur step file — fichier listé dans `steps:` manquant, illisible, ou sans `name:` dans le frontmatter |
| `4` | Erreur d'usage — flag inconnu, mode manquant, modes multiples |

## Invariants

- **Stateless** : aucun état disque, aucun side-effect (sauf stdout/stderr). Relançable à l'infini.
- **Pas d'exécution implicite** : l'orchestrateur n'exécute **jamais** le code du step. Il émet seulement des instructions. Claude est l'exécuteur.
- **Aucune dépendance externe** : bash + coreutils + POSIX awk. Pas de `yq`, pas de `jq`, pas de `python`.
- **Parser YAML minimal** : tolère uniquement la forme canonique attendue (`steps:` → `- file: ...`). Les formes exotiques (inline list, alias, ancres) sortiront en erreur ou ignoreront des steps. Passer par `--validate` en cas de doute.
- **Les flags sont passthrough** : l'orchestrateur ne les interprète pas, il les déclare dans l'en-tête. C'est au step (exécuté par Claude) de les honorer.

## Flow typique côté Claude

1. `bash orchestrator.sh workflow.yaml --only <step-name> <flags>`
2. Lire stdout → frontmatter + instructions
3. Lire `flags` dans l'en-tête → adapter le comportement (skip, force, dry-run…)
4. Exécuter les instructions du corps
5. Si exit ≠ 0 → stderr contient le diagnostic, traiter selon la table d'error handling du skill orchestrateur

## Quickstart diagnostics

```bash
# Valider un workflow
bash workflow-orchestrator.sh workflow.yaml --validate

# Lister les steps
bash workflow-orchestrator.sh workflow.yaml --list

# Dry-run d'un step (passthrough — c'est le step qui honore le flag)
bash workflow-orchestrator.sh workflow.yaml --only stack-evaluate --dry-run
```
