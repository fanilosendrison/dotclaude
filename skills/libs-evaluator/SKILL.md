---
name: libs-evaluator
description: Use when the user says "évalue les libs", "quelles libs", "eval libs", "libs applicatives", "application libraries", "libs-evaluator", or any variant requesting an application-library evaluation for a project. Lit STACK_EVAL.yaml (obligatoire) et les specs du projet, évalue ~25 capabilities de libs applicatives (HTTP client, ORM, validation, auth, UI, observabilité, etc.) via un enum fermé de candidats par (capability × stack), et produit un LIBS_EVAL.yaml machine-readable avec packages résolus consommable par le package manager.
---

# Libs Evaluator

Miroir applicatif de `stack-evaluator`. Évalue les libs applicatives optimales d'un projet sur ~25 dimensions (data & validation, I/O & network, domaine fonctionnel, frontend, observabilité, testing, utilitaires transverses) et produit un `LIBS_EVAL.yaml` à la racine.

**Principe clé** : les libs dépendent de la stack. Ce skill consomme `STACK_EVAL.yaml` et filtre les libs compatibles avec `language`, `runtime`, `framework`, `database`.

**Enum fermé** : les valeurs candidates par dimension sont figées dans `references/dimensions.md` (snapshot de l'état de l'art à date, voir `last_reviewed`). Claude ne découvre pas de libs sur le web — il applique les règles de décision de l'enum. Pas de `websearch`, pas de `context7` au runtime. Les packages exacts sont inline dans l'enum.

## Philosophie d'évaluation

Mêmes critères que `stack-evaluator`. **Claude Code automatise tout** — on ignore coût cognitif, temps de setup, courbe d'apprentissage. On évalue sur :

- **Correctness technique** — bonne lib pour ce besoin
- **Maintenance** — figée au moment de la rédaction de `dimensions.md`, pas re-vérifiée à chaque run
- **Type-safety** — zod > yup, drizzle > typeorm, etc.
- **Compat runtime** — critique pour TS multi-runtime (Bun/Edge/Node)
- **Sécurité** — surface d'attaque réduite
- **Contraintes normatives** — une spec peut imposer ou éliminer une lib (priorité absolue sur l'enum)

Conséquence : décision rapide, déterministe, auditable. Le coût de fraîcheur est déplacé vers la maintenance périodique de `dimensions.md`.

## Workflow

### 0. Vérifier si LIBS_EVAL.yaml existe déjà

- Si `--force` passé → ignorer, réévaluer tout
- Si le fichier existe et pas de `--force` → le lire, informer l'utilisateur, demander s'il veut réévaluer
- Si absent → continuer

### 1. Pré-requis — Lire STACK_EVAL.yaml (OBLIGATOIRE)

Vérifier que `STACK_EVAL.yaml` existe à la racine.

- **Absent** → informer l'utilisateur et lancer `/stack-evaluator` d'abord. Ne jamais évaluer les libs sans stack connue.
- **Présent** → le lire intégralement. Stocker `decisions.*` et `rationale.*` en mémoire de travail.

Les champs suivants sont **décisifs** pour filtrer les libs compatibles :

- `decisions.language` — filtre global (prisma ne va pas avec Python)
- `decisions.runtime` — filtre runtime-sensible (hono/elysia = Bun/edge-friendly, express = Node classique)
- `decisions.framework` — impose souvent l'écosystème (next → tanstack-query + auth.js)
- `decisions.database` — conditionne ORM/migration (postgres → prisma|drizzle, sqlite → better-sqlite3|drizzle)
- `decisions.project_type` — conditionne la pertinence des dimensions (cli-tool skip `ui_framework`, `styling`, `component_lib`, `state`, `router`, `forms`)

### 2. Récupérer le corpus de signaux

**Règle non-négociable** : avant toute déduction, les signaux libs doivent être visibles (imports, dépendances déclarées dans manifestes, patterns dans specs).

**Garde-fou contexte chaud** : si `libs-evaluator` est invoqué juste après `stack-evaluator` dans la même conversation (flux typique `claude-project-onboarder`), le résumé structuré produit par l'agent de scan de stack-evaluator est **déjà dans le contexte principal**. Le réutiliser tel quel — ne pas relancer un scan.

**Détecter le contexte chaud** : si dans les 20 derniers messages de la conversation on trouve un résumé structuré orienté "contraintes techniques / imports / dépendances" produit par un agent délégué par stack-evaluator → contexte chaud, skip rescan.

**Sinon** — invocation à froid :

1. Lister les fichiers du repo : `git ls-files`
2. Filtrer sur les fichiers porteurs de signaux libs : manifestes (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`), lockfiles (uniquement présence, pas contenu), configs dédiées (`drizzle.config.*`, `prisma/schema.prisma`, etc.), et échantillon d'imports dans le code source
3. Déléguer la lecture à un **agent `general-purpose`** (Task tool) si > 5 fichiers à lire — même pattern que stack-evaluator step 2
4. Le prompt de l'agent demande un résumé structuré orienté **libs** : imports détectés, dépendances déclarées, versions, configs applicatives trouvées
5. Fallback < 5 fichiers : lire directement avec Read

### 2b. Contraintes normatives — Filtres éliminatoires sur libs

**Si le projet contient des specs (`specs/`), cette étape est OBLIGATOIRE.**

Certaines specs imposent ou interdisent des libs spécifiques (ex : "utiliser Zod pour toute validation externe", "pas de dépendance à Prisma"). Ces contraintes ont priorité absolue.

**Procédure** :

1. Scanner les specs en cherchant : DOIT utiliser, INTERDIT, pattern `<lib>`, obligatoire, mandated, must use
2. Pour chaque contrainte trouvée, documenter dans `lib_constraints` du LIBS_EVAL.yaml :
   - `imposed` : lib X obligatoire pour dimension Y → la valeur est forcée
   - `forbidden` : lib X interdite pour dimension Y → éliminer des candidates
3. Si une lib imposée n'est pas compatible avec la stack → signaler un **conflit spec ↔ stack** et demander à l'utilisateur (soit la stack change, soit la spec est assouplie)

**Si aucune contrainte détectée** → continuer avec les heuristiques pures.

### 3. Décision par capability — Lookup enum

**Principe** : pour chaque capability, la valeur est résolue par **lookup dans `references/dimensions.md`** selon la stack détectée dans STACK_EVAL.yaml. Pas de web, pas de context7, pas de LLM qui "improvise". La décision est déterministe et traçable.

**Procédure pour chaque capability applicable** (selon matrice project_type × dimensions dans `dimensions.md`) :

1. **Contrainte spec** (priorité absolue, step 2b) → valeur forcée, `source: "spec:<id>"`, confidence `high`. Skip les étapes suivantes.

2. **Signal direct** (import explicite ou dépendance déclarée dans le manifest, voir `references/signals.md`) :
   - Si la lib détectée figure dans l'enum de `dimensions.md` → retenir, `source: "signal:<manifest>"`, confidence `high`
   - Si la lib détectée **ne figure pas** dans l'enum → retenir quand même (signal projet > enum), `source: "signal:<manifest>"`, confidence `medium`, noter dans `rationale` que la lib est hors enum

3. **Lookup enum** (cas par défaut, aucun signal) :
   - Lire le tableau de la capability dans `dimensions.md`
   - Filtrer les valeurs compatibles via `references/compatibility-matrix.md` selon `language`, `runtime`, `framework`, `database`, `deploy_target` de STACK_EVAL
   - Appliquer les règles "quand choisir" de l'enum par ordre de priorité (règles conditionnelles d'abord, défaut du langage ensuite)
   - Retenir la valeur choisie, `source: "default"` (ou `source: "enum:<rule>"` si règle conditionnelle a matché), confidence `high` si défaut clair, `medium` si ambigu

4. **Résolution du package** : inline dans `dimensions.md` (colonne `package` du tableau). Pas de lookup externe. Si la valeur est une sentinelle (`none`, `not-applicable`, `native`, `fetch-native`, `raw-sql`, `context-only`) → `package: null`.

5. **Classement `dev` vs runtime** : inline dans `dimensions.md` (colonne `dev`). Tooling de build/test/migration → `dev: true`. Libs runtime (validation, ORM, http, auth, logging...) → `dev: false`.

**Règles de confiance** :
- `high` = signal direct convergent avec l'enum, OU contrainte spec, OU défaut unique de l'enum sans ambiguïté
- `medium` = signal hors enum, OU ambiguïté entre plusieurs valeurs de l'enum
- `low` = situation non couverte par l'enum (stack exotique, combinaison rare) → signaler et demander à l'utilisateur au step 5

### 4. Applicabilité selon project_type

Toutes les dimensions ne s'appliquent pas à tous les projets. Consulter `references/dimensions.md` § "Matrice project_type × dimensions" pour filtrer.

Exemples :
- `project_type: cli-tool` → skip `ui_framework`, `styling`, `component_lib`, `state`, `router`, `forms`, `websocket`, `graphql`
- `project_type: library` → skip `deploy_target`-related, skip `auth`
- `project_type: script` → minimal : cli_parsing, env_parsing, logging, id_generation

Dimension non-applicable → noter `value: not-applicable` dans LIBS_EVAL.yaml (pas `none`, pour distinguer "on a choisi rien" de "ça ne s'applique pas").

### 5. Questions — Uniquement si nécessaire

Mêmes règles que stack-evaluator. Poser UNIQUEMENT si :
- Confidence `low` sur une dimension structurelle (auth, orm, ui_framework)
- Signaux contradictoires (deux libs concurrentes dans le même manifeste)
- Conflit spec ↔ stack détecté au step 2b

Utiliser `AskUserQuestion`, max 4 questions groupées.

### 6. Écrire LIBS_EVAL.yaml

Format strict :

```yaml
# Libs evaluation generated by libs-evaluator skill
# Do not edit manually — re-run /libs-evaluator to update

evaluated_at: "YYYY-MM-DDTHH:MM:SS"
stack_eval_ref: "STACK_EVAL.yaml"
project_type: "cli-tool | web-app | api | library | monorepo | script | other"
confidence: high | medium | low
schema_version: 2

decisions:
  # Chaque capability → objet structuré { choice, package, dev, source, confidence }
  # choice: nom humain de la lib retenue (ou "none" / "not-applicable" / "native" / "raw-sql" / "context-only" / "fetch-native")
  # package: nom exact sur npm / PyPI / crates.io / pkg.go.dev (null si choice est sentinelle)
  # dev: true si devDependency (tooling), false si runtime
  # source: "signal:<manifest>" | "spec:<id>" | "enum:<rule>" | "default"
  # confidence: high | medium | low

  schema_validation:
    choice: zod
    package: zod
    dev: false
    source: default
    confidence: high
  orm:
    choice: drizzle
    package: drizzle-orm
    dev: false
    source: default
    confidence: high
  migrations:
    choice: drizzle-kit
    package: drizzle-kit
    dev: true
    source: enum:orm=drizzle
    confidence: high

  # ... une entrée par capability applicable (voir references/dimensions.md pour la checklist)
  # Capabilities groupées : Data & Validation, I/O & Network, Domain, Frontend, Observability, Testing, Utilities
  # Sentinelles autorisées pour `choice` : none, not-applicable, native, fetch-native, raw-sql, context-only

  http_client:
    choice: fetch-native
    package: null          # sentinelle — runtime natif, rien à installer
    dev: false
    source: default
    confidence: high

lib_constraints:                # présent uniquement si step 2b a trouvé des contraintes
  - spec: "SPEC-VALIDATION §3.2"
    constraint: "Toute validation de données externes DOIT passer par Zod"
    type: imposed
    dimension: schema_validation
    value: zod
  - spec: "SPEC-DEPS §1.1"
    constraint: "Pas de dépendance Prisma (licence)"
    type: forbidden
    dimension: orm
    excludes: [prisma]

rationale:
  lib_constraints: "§3.2 impose Zod → schema_validation figé, §1.1 exclut Prisma → orm = drizzle"
  orm: "Drizzle préféré à Kysely pour DX type-safe sur postgres + bun, confirmé websearch 2026"
  # une entrée par capability non-trivialement déduite (confidence medium/low, lookup web, ou arbitrage)
```

**Règles d'écriture** :
- `choice` en kebab-case (noms humains : `better-auth`, `react-hook-form`)
- `package` = nom exact du registry (`drizzle-orm`, `@auth/core`, `fastapi`) — **lu dans la colonne `package` de `dimensions.md`**
- `package: null` pour sentinelles (`none`, `not-applicable`, `native`, `fetch-native`, `raw-sql`, `context-only`)
- `dev: true/false` — lu dans la colonne `dev` de `dimensions.md`
- `source` obligatoire — trace la provenance de la décision (`signal`, `spec`, `enum:<rule>`, `default`)
- `rationale` : une phrase par capability non-triviale ; skip les évidences (`id_generation: nanoid` sur TS)

### 7. Ajouter LIBS_EVAL.yaml au .gitignore — OBLIGATOIRE

Miroir exact de stack-evaluator step 7. **NON-NÉGOCIABLE.**

- Si `.gitignore` existe → ajouter `LIBS_EVAL.yaml` s'il n'y figure pas déjà
- Si `.gitignore` n'existe pas → ne pas le créer
- Append only — ne jamais écraser le `.gitignore`
- Aucune justification pour skip

### 8. Afficher le récap

```
## Libs Evaluation

### Data & Network
| Dimension         | Décision     | Confiance |
|-------------------|--------------|-----------|
| schema_validation | zod          | high      |
| orm               | drizzle      | medium    |
| http_server       | hono         | high      |

### Domain
| Dimension | Décision    | Confiance |
|-----------|-------------|-----------|
| auth      | better-auth | medium    |
| date      | date-fns    | high      |

### Observability
...

### Testing
...

### Utilities
...

Écrit dans LIBS_EVAL.yaml
```

## Arguments

- `--force` : réévaluer même si LIBS_EVAL.yaml existe
- `--dry-run` : afficher les décisions sans écrire le fichier
- (sans argument) : comportement par défaut

## Consommation par d'autres outils

Miroir de STACK_EVAL.yaml. Lu par `claude-md-creator` pour renseigner la section "Libs applicatives" du CLAUDE.md projet.

## Références

- `references/dimensions.md` — ~25 dimensions, valeurs possibles, defaults par project_type, matrice applicabilité
- `references/signals.md` — fichiers / imports / deps → lib détectée
- `references/compatibility-matrix.md` — filtres stack → libs compatibles
