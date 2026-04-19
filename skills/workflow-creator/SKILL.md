---
name: workflow-creator
description: Scaffolde un nouveau workflow Claude Code dans `~/.claude/skills/`. Génère le SKILL.md, workflow.yaml, et les squelettes de steps avec frontmatter canonique. Use when the user says "crée un workflow", "nouveau workflow", "create workflow", "scaffold workflow", "workflow-creator", or any variant requesting the creation of a new workflow-orchestrator workflow.
---

# Workflow Creator

Scaffolder de workflows pour workflow-orchestrator. Génère un skill complet prêt à exécuter via `/<workflow-name>`.

## Input

Argument attendu : `<nom>`

Exemple : `project-setup`

- kebab-case uniquement
- Si pas d'argument → demander le nom

## Workflow

### 1. Collecter les infos

Demander via `AskUserQuestion` :

- **Description** du workflow (1 ligne)
- **Steps** : liste ordonnée des steps (nom + description courte pour chacun)

### 2. Vérifier

- `~/.claude/skills/<nom>/` n'existe pas → si oui, prévenir et stop
- `~/.claude/scripts/workflow-orchestrator/workflow-orchestrator.sh` existe → sinon, prévenir

### 3. Scaffolder

Créer la structure :

```
~/.claude/skills/<nom>/
├── SKILL.md
├── workflow.yaml
└── steps/
    ├── 01-<step-name>.md
    ├── 02-<step-name>.md
    └── ...
```

### 4. Générer SKILL.md

```markdown
---
name: <nom>
description: "<description>. Use when the user says '<nom>', '<triggers>'."
---

# <Nom en titre>

<description>

## Exécution

Ce workflow s'exécute via workflow-orchestrator :

\`\`\`bash
bash ~/.claude/scripts/workflow-orchestrator/workflow-orchestrator.sh \
  ~/.claude/skills/<nom>/workflow.yaml
\`\`\`

## Steps

1. **<step-1-name>** — <step-1-description>
2. **<step-2-name>** — <step-2-description>
...

## Tracking

Avant de lancer la boucle d'exécution, créer une task par step avec `TaskCreate` :

- **subject** : `Step NN — <step-name>` (impératif, ex: "Check prerequisites")
- **description** : description du step + ce qui est attendu en sortie
- **activeForm** : forme continue (ex: "Checking prerequisites")

Pendant la boucle, pour chaque step :

1. `TaskUpdate` → `in_progress` avant le lancement
2. Exécuter le step via `--only`
3. `TaskUpdate` → `completed` si succès, rester `in_progress` si échec (+ créer une task bloquante si abort)
```

### 5. Générer workflow.yaml

```yaml
name: <nom>
version: "0.1.0"
steps:
  - file: steps/01-<step-name>.md
  - file: steps/02-<step-name>.md
```

### 6. Générer les step files

Chaque step file suit le frontmatter canonique :

```markdown
---
name: <step-name>
version: "0.1.0"
description: "<step-description>"
allowed_tools:
  - Read
  - Write
  - Glob
  - Grep
inputs: []
outputs: []
parameters:
  flags: []
---

[TODO : prompt du step]
```

- Numérotation : `01-`, `02-`, etc.
- `allowed_tools` : défaut Read/Write/Glob/Grep, à ajuster par l'utilisateur
- `inputs` et `outputs` : vides par défaut, à remplir par l'utilisateur

### 7. Résumé

Afficher :

```
Workflow créé : ~/.claude/skills/<nom>/
├── SKILL.md
├── workflow.yaml
└── steps/
    ├── 01-<step>.md
    └── 02-<step>.md

Prochaines actions :
1. Remplir le prompt de chaque step (remplacer [TODO])
2. Définir les inputs/outputs de chaque step
3. Ajuster les allowed_tools si nécessaire
4. Tester : workflow-orchestrator.sh workflow.yaml --dry-run
5. Exécuter : /<nom>
```

## Règles

- **Ne PAS implémenter** le contenu des steps — juste le squelette avec `[TODO]`
- Ne rien écraser si le dossier existe déjà
- Nommage kebab-case uniquement
- Le SKILL.md généré doit inclure la commande `bash workflow-orchestrator.sh` dans sa section Exécution
- Les steps sont numérotés séquentiellement (`01-`, `02-`, ...)
