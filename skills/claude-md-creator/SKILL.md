---
name: claude-md-creator
description: Crée le CLAUDE.md d'un projet à partir de STACK_EVAL.yaml, LIBS_EVAL.yaml (si présent) et du contexte du repo. Remplit mécaniquement les champs [YAML] depuis STACK_EVAL + LIBS_EVAL et déduit les champs [INFER] du projet. Si STACK_EVAL.yaml est absent, lance /stack-evaluator d'abord. Use when the user says "crée le CLAUDE.md", "génère le CLAUDE.md", "CLAUDE.md du projet", "claude-md-creator", "init CLAUDE.md", "project CLAUDE.md", or any variant requesting the creation of a project-level CLAUDE.md file.
---

# Claude MD Creator

Génère le `CLAUDE.md` d'un projet en combinant `STACK_EVAL.yaml` + `LIBS_EVAL.yaml` (données mécaniques) et le contexte du repo (données inférées).

## Workflow

### 0. Pré-requis — STACK_EVAL.yaml (obligatoire) + LIBS_EVAL.yaml (recommandé)

**STACK_EVAL.yaml** — source des méta-choix structurants (langage, runtime, framework, DB, test runner, linter, SAST, type checker, conteneurisation, isolation, deploy target, CI).

- **Absent** → informer le mainteneur et lancer `/stack-evaluator`. Attendre que le fichier soit généré avant de continuer.
- **Présent** → le lire intégralement. Stocker `decisions.*` et `rationale.*` en mémoire de travail.

**LIBS_EVAL.yaml** — source des libs applicatives (schema_validation, orm, http_server, auth, ui_framework, styling, state, router, logging, property_testing, e2e, mocking, cli_parsing, env_parsing, id_generation, etc.).

- **Absent** → continuer sans (dégrade la section "Libs applicatives" du CLAUDE.md mais ne bloque pas). Proposer au mainteneur de lancer `/libs-evaluator` plus tard.
- **Présent** → le lire intégralement. Stocker `decisions.*` (filtrer les valeurs `not-applicable`) en mémoire de travail.

Vérifier aussi si `CLAUDE.md` existe déjà :
- **Présent** → demander au mainteneur : écraser ou annuler. Ne jamais écraser silencieusement.
- **Absent** → continuer.

### 1. Lire STACK_EVAL.yaml — Champs [YAML]

Extraire les valeurs pour le mapping mécanique. Correspondance directe :

```
STACK_EVAL.yaml → decisions.*     →  CLAUDE.md § Stack technique

decisions.language                →  | `language` | <valeur> |
decisions.runtime                 →  | `runtime` | <valeur> |
decisions.package_manager         →  | `package_manager` | <valeur> |
decisions.framework               →  | `framework` | <valeur> ou "none" |
decisions.containerization        →  | `containerization` | <valeur> |
decisions.database                →  | `database` | <valeur> ou "none" |
decisions.test_runner             →  | `test_runner` | <valeur> |
decisions.linter                  →  | `linter` | <valeur> |
decisions.sast                    →  | `sast` | <valeur> ou "none" |
decisions.ci                      →  | `ci` | <valeur> ou "none" |
```

Si une clé manque dans STACK_EVAL.yaml → écrire "none" dans le CLAUDE.md.

Champs supplémentaires présents dans STACK_EVAL.yaml mais pas dans le tableau principal — les utiliser pour les champs [INFER] de la section Stack :

```
decisions.type_checker            →  | Vérification de types | <valeur> |
```

Si `type_checker` est absent de STACK_EVAL.yaml, déduire des conventions du langage ou demander.

### 1b. Lire LIBS_EVAL.yaml — Champs [YAML] libs applicatives

Si `LIBS_EVAL.yaml` existe, mapper les décisions vers la section "Libs applicatives" du CLAUDE.md. Ignorer les capabilities avec `choice: not-applicable`.

**Format v2 (schéma actuel)** : chaque décision est un objet `{ choice, package, dev, source, confidence }`. La valeur à afficher dans le tableau CLAUDE.md est `decisions.<cap>.choice`. Optionnellement, noter `package` entre parenthèses si différent du `choice` (ex : `drizzle (drizzle-orm)`).

**Format v1 legacy** : valeur scalaire directe (ex : `decisions.orm: drizzle`). Supporter en lecture pour les projets anciens — lire la valeur telle quelle. Suggérer en commentaire dans le CLAUDE.md : `<!-- LIBS_EVAL.yaml en format v1 — re-run /libs-evaluator --force pour mettre à jour -->`.

```
LIBS_EVAL.yaml → decisions.<cap>.choice  →  CLAUDE.md § Libs applicatives

decisions.schema_validation            →  | `schema_validation` | <valeur> |
decisions.orm                          →  | `orm` | <valeur> |
decisions.migrations                   →  | `migrations` | <valeur> |
decisions.http_client                  →  | `http_client` | <valeur> |
decisions.http_server                  →  | `http_server` | <valeur> |
decisions.auth                         →  | `auth` | <valeur> |
decisions.date                         →  | `date` | <valeur> |
decisions.logging                      →  | `logging` | <valeur> |
decisions.property_testing             →  | Tests de propriété | <valeur> |
decisions.e2e                          →  | `e2e` | <valeur> |
decisions.mocking                      →  | `mocking` | <valeur> |
decisions.cli_parsing                  →  | `cli_parsing` | <valeur> |
decisions.env_parsing                  →  | `env_parsing` | <valeur> |
decisions.id_generation                →  | `id_generation` | <valeur> |

# Frontend (uniquement si project_type implique UI)
decisions.ui_framework                 →  | `ui_framework` | <valeur> |
decisions.styling                      →  | `styling` | <valeur> |
decisions.component_lib                →  | `component_lib` | <valeur> |
decisions.state                        →  | `state` | <valeur> |
decisions.router                       →  | `router` | <valeur> |
decisions.forms                        →  | `forms` | <valeur> |
```

**Règles** :
- Ne JAMAIS écrire une dimension avec valeur `not-applicable` dans le CLAUDE.md — la skip silencieusement
- Si `LIBS_EVAL.yaml` est absent, omettre toute la section "Libs applicatives" du CLAUDE.md et ajouter un placeholder : `<!-- Libs applicatives : lancer /libs-evaluator pour remplir cette section -->`
- Les `lib_constraints` (contraintes issues des specs) de LIBS_EVAL.yaml peuvent être listées en note dans la section "Règles spécifiques au projet" si elles impactent les choix de dev

### 2. Scanner le projet — Champs [INFER]

Lire ces fichiers pour collecter le contexte :

```
README.md           → nom du projet, description, objectif
package.json        → name, description (si TS/JS)
pyproject.toml      → name, description (si Python)
Cargo.toml          → name, description (si Rust)
go.mod              → module name (si Go)
specs/              → présence de specs formelles
docs/               → présence de documentation
src/                → structure réelle du code source
tests/              → structure réelle des tests
```

### 3. Remplir les sections [INFER]

Pour chaque section [INFER], appliquer cette logique :

#### § Contexte

- **Nom du projet** : nom du dossier ou `name` du manifeste
- **Description** : `description` du manifeste ou README.md. Si absent → demander.
- **Propriétés fondamentales** : déduire du type de projet (`project_type` dans STACK_EVAL.yaml) et du contenu des specs/README. Si pas assez d'indices → demander au mainteneur via `AskUserQuestion` (max 4 options + Other).

#### § Stack technique — Commandes de vérification

Construire les commandes en combinant `decisions.test_runner`, `decisions.linter`, `decisions.type_checker`, `decisions.sast`, et `decisions.package_manager` :

| Langage | package_manager | Pattern |
|---------|-----------------|---------|
| TypeScript/Bun | bun | `bun test` / `bunx biome check src/` / `tsc --noEmit` |
| TypeScript/Node | npm | `npm test` / `npx eslint src/` / `tsc --noEmit` |
| Python | uv | `uv run pytest tests/ -v` / `uv run ruff check src/` / `uv run pyright src/` |
| Python | poetry | `poetry run pytest tests/ -v` / `poetry run ruff check src/` |
| Python | pip | `.venv/bin/pytest tests/ -v` / `.venv/bin/ruff check src/` |
| Rust | cargo | `cargo test` / `cargo clippy` |
| Go | go modules | `go test ./...` / `golangci-lint run` |

Si `decisions.sast` ≠ `none`, ajouter la commande SAST avec le même préfixe :
- `bandit` → `<prefix> bandit -r src/`
- `semgrep` → `<prefix> semgrep scan src/`

Adapter selon les valeurs réelles de STACK_EVAL.yaml. Toujours 3-4 commandes si applicable : tests, lint, types, SAST (si activé).

#### § Structure du projet

- **Si `src/` n'existe pas** (projet doc-only, specs sans code) → ne pas inventer une arborescence `src/`. Écrire uniquement les fichiers qui existent réellement (specs/, docs/, configs) et ajouter un placeholder :
  ```
  # La structure src/ sera définie lors de l'implémentation.
  # Les principes structurels ci-dessous s'appliqueront.
  ```
- **Si `src/` existe** → scanner le contenu réel et adapter l'arborescence du template
- Remplacer `<nom-du-projet>` par le nom réel
- Remplacer `<manifeste dépendances>` et `<fichier de lock>` selon `decisions.package_manager` :
  - bun → `package.json` / `bun.lockb`
  - npm → `package.json` / `package-lock.json`
  - yarn → `package.json` / `yarn.lock`
  - pnpm → `package.json` / `pnpm-lock.yaml`
  - pip → `requirements.txt` / (pas de lock standard)
  - poetry → `pyproject.toml` / `poetry.lock`
  - cargo → `Cargo.toml` / `Cargo.lock`
  - go → `go.mod` / `go.sum`
- Remplacer `<fichier conteneur>` / `<fichier orchestration>` :
  - Si `decisions.containerization` = DOCKER → `Dockerfile` / `docker-compose.yml`
  - Si NO-DOCKER → supprimer ces lignes
- Inclure `specs/` seulement si le dossier existe
- Inclure `docs/` seulement si le dossier existe
- Inclure `.env.example` seulement si des secrets sont détectés (`.env` existe ou `secrets_management` dans validations)

#### § Conventions de nommage

Remplir selon `decisions.language` avec les conventions standard :

| Langage | Fichiers | Classes | Fonctions | Variables | Constantes | Interfaces |
|---------|----------|---------|-----------|-----------|------------|------------|
| TypeScript | `kebab-case.ts` | `PascalCase` | `camelCase` | `camelCase` | `UPPER_SNAKE_CASE` | `IPrefix` |
| Python | `snake_case.py` | `PascalCase` | `snake_case` | `snake_case` | `UPPER_SNAKE_CASE` | `IPrefix` |
| Rust | `snake_case.rs` | `PascalCase` | `snake_case` | `snake_case` | `UPPER_SNAKE_CASE` | traits sans préfixe |
| Go | `snake_case.go` | `PascalCase` | `camelCase` / `PascalCase` (exported) | `camelCase` | `PascalCase` | sans préfixe |

Le mainteneur peut surcharger ces defaults.

#### § Spécifications

- Si `specs/` existe et contient des fichiers → conserver la section, lister les specs trouvées
- Si pas de `specs/` → supprimer la section entière du CLAUDE.md final

#### § Règles spécifiques au projet

- Déduire du type de projet et du contenu. Si rien de spécifique détecté → écrire "Aucune pour l'instant."
- Si le mainteneur a des règles spécifiques en tête → demander via `AskUserQuestion`

### 4. Questions au mainteneur

Regrouper TOUTES les questions en un seul round `AskUserQuestion` (max 4 questions). Typiquement :

1. **Propriétés fondamentales** (si non-déductibles)
2. **Conventions de nommage** (si le mainteneur veut surcharger les defaults du langage)
3. **Règles spécifiques** (s'il y en a)
4. **Specs** (si ambigu — dossier specs/ existe mais contenu pas clair)

Ne poser que les questions réellement nécessaires. Si tout est déductible → ne rien demander.

### 5. Assembler et écrire CLAUDE.md

- Lire le template depuis `assets/CLAUDE-project-template.md` (dans le dossier du skill)
- Remplacer tous les champs [YAML] et [INFER] par les valeurs collectées
- Supprimer tous les blocs "Exemples :" du template — ils ne servent que de guide, pas de contenu final
- Supprimer les annotations `[YAML]` et `[INFER]` — le CLAUDE.md final ne doit contenir que du contenu rempli
- Écrire le fichier à `$PWD/CLAUDE.md`

### 6. Ajouter CLAUDE.md au .gitignore — OBLIGATOIRE

`CLAUDE.md` est un artefact local de configuration Claude Code. Même logique que STACK_EVAL.yaml :

- Si `.gitignore` existe → ajouter `CLAUDE.md` s'il n'y figure pas déjà
- Si `.gitignore` n'existe pas → ne pas le créer (c'est le job de git-preflight)
- Append only — ne jamais écraser le `.gitignore` existant

### 7. Afficher le récap

```
## CLAUDE.md créé

| Section | Source | Statut |
|---------|--------|--------|
| Contexte | [INFER] | rempli / demandé au mainteneur |
| Stack technique | [YAML] | rempli depuis STACK_EVAL.yaml |
| Structure | [INFER] | adapté au repo réel |
| Conventions | [INFER] | defaults langage |
| Spécifications | [INFER] | conservé / supprimé |
| Règles spécifiques | [INFER] | rempli / "Aucune pour l'instant." |

Écrit dans CLAUDE.md
```

## Règles

- Ne jamais inventer de contenu — si un champ n'est pas déductible, demander.
- Le template est dans `assets/CLAUDE-project-template.md` — toujours le relire comme base. Ne pas écrire de mémoire.
- Les blocs "Exemples" du template sont des guides de rédaction, pas du contenu à recopier dans le CLAUDE.md final.
- Si le projet a déjà un CLAUDE.md → ne jamais écraser sans validation explicite.
