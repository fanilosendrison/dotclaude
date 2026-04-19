# Decision Axes — Dimensions d'évaluation

## Philosophie : Automation-First

Claude Code automatise l'intégralité du setup. Les critères d'évaluation excluent :
- ~~Temps de setup~~ → Claude le fait
- ~~Complexité de config~~ → Claude la gère
- ~~Courbe d'apprentissage~~ → Claude connaît
- ~~Nombre de fichiers de config~~ → Claude les génère
- ~~Vitesse d'exécution~~ → non-critère sauf besoin explicite

**Seuls comptent** : correctness, reproductibilité, isolation, best practice, sécurité, scalabilité.

---

## Axes

### 1. language

Le langage de programmation principal du projet.

| Valeur | Quand choisir |
|--------|--------------|
| `typescript` | Projets web, API Node/Bun/Deno, CLI tools JS ecosystem, full-stack |
| `javascript` | Projet existant sans TypeScript (ne jamais recommander JS sur un nouveau projet — toujours TS) |
| `python` | Data science, ML, scripting, API (FastAPI/Django), automation |
| `go` | Services haute performance, CLI tools système, microservices |
| `rust` | Performance critique, systèmes bas niveau, WASM, CLI tools perf-sensitive |
| `ruby` | Rails ecosystem |
| `swift` | Apple ecosystem natif |
| `java` / `kotlin` | Enterprise, Android |
| `elixir` | Real-time, haute concurrence |

**Projet neuf sans signal** → poser la question. Ne jamais deviner le langage.

**RÈGLE ÉLIMINATOIRE (priorité absolue)** : si le projet a des specs normatives (`specs/`), appliquer le step 2b AVANT toute recommandation. Deux niveaux d'élimination :
- **`eliminates`** : le langage ne peut PAS respecter la contrainte, même avec un contournement. Exemple : JS/TS n'a qu'un type `number` — impossible de distinguer int/float à la désérialisation JSON.
- **`eliminates_with_caveat`** : le langage PEUT respecter la contrainte mais via un pattern non-standard. Exemple : Go perd int/float dans `json.Unmarshal(interface{})` mais le préserve via structs typés. Ces langages sont signalés avec leur caveat mais pas formellement exclus — le mainteneur décide.

Un langage `eliminates` ne peut jamais être recommandé. Un langage `eliminates_with_caveat` est déconseillé avec explication, sauf si le mainteneur accepte le contournement.

#### Sous-champs version

| Champ | Description | Exemple |
|-------|-------------|---------|
| `version` | Version spécifique détectée ou recommandée | `"5.7"` |
| `version_constraint` | Contrainte de compatibilité (surtout pour libraries) | `">=5.0"` |

La version est résolue via les signaux de `signals.md` § "Language & Runtime Versions", ou par l'agent `websearch` si aucun signal.

---

### 2. runtime

L'interpréteur / runtime d'exécution.

| Valeur | Quand choisir |
|--------|--------------|
| `bun` | TypeScript/JavaScript — runtime le plus moderne, bundler intégré, test runner intégré, compatible npm |
| `node` | TypeScript/JavaScript — si contrainte de compatibilité ou dépendance node-spécifique |
| `deno` | TypeScript — si le projet utilise déjà Deno ou cible des permissions fines |
| `cpython` | Python standard |
| `pypy` | Python avec besoin de perf CPU (rare) |
| `go` | Go (compilé, pas de choix de runtime) |
| `rustc` | Rust (compilé) |

**Recommandation par défaut TS/JS** → `bun` (sauf contrainte explicite).

#### Sous-champs version

| Champ | Description | Exemple |
|-------|-------------|---------|
| `version` | Version du runtime détectée ou recommandée | `"22"` (node), `"1.1"` (bun), `"3.12"` (cpython) |
| `version_strategy` | Stratégie de versioning appliquée | `LTS` \| `LATEST` \| `PINNED` |
| `version_constraint` | Contrainte de compatibilité (pour libraries) | `">=18"` |

**Stratégies de version** :

| Stratégie | Quand | Exemple |
|-----------|-------|---------|
| `LTS` | Application, API, web app en production — stabilité et support long terme | Node 22 (LTS), Python 3.12 (LTS) |
| `LATEST` | Script utilitaire, projet expérimental — dernière version stable | Node 23, Python 3.13 |
| `PINNED` | Version imposée par une contrainte externe (deploy target, legacy, client) | Node 20 (car AWS Lambda) |

**Règles de sélection** :
- `project_type` = `web-app` / `api` / `cli-tool` → `LTS` par défaut
- `project_type` = `library` → `LTS` + `version_constraint` large pour maximiser la compatibilité
- `project_type` = `script` → `LATEST`
- Si `deploy_target` impose une version max → `PINNED` avec la version la plus haute supportée
- Si un fichier de version existe (`.nvmrc`, `.python-version`) → `PINNED` à la version déclarée

**Résolution de la version recommandée** (projet neuf, aucun signal) :
1. Agent `websearch` → `"[runtime] current LTS version [année en cours]"` (ou `latest stable` si strategy = LATEST)
2. Si `deploy_target` connu → agent `websearch` → `"[deploy_target] supported [runtime] versions [année en cours]"` et prendre le min(LTS, max supportée)
3. Toujours recommander une version **majeure** (ex: `"22"`, pas `"22.11.0"`) sauf si un signal explicite donne une version patch

---

### 3. package_manager

Le gestionnaire de dépendances.

| Valeur | Quand choisir |
|--------|--------------|
| `bun` | Si runtime = bun |
| `npm` | Si runtime = node et pas de lockfile existant spécifique |
| `yarn` | Si yarn.lock existe |
| `pnpm` | Si pnpm-lock.yaml existe, ou monorepo avec workspaces |
| `pip` | Python simple, requirements.txt |
| `poetry` | Python avec besoin de gestion de versions + venv intégré |
| `uv` | Python moderne, compatible pip, très rapide |
| `cargo` | Rust |
| `go modules` | Go |

**Cohérence** : le package manager doit être cohérent avec le runtime et le lockfile existant.

---

### 4. framework

Le framework applicatif principal.

| Valeur | Quand choisir |
|--------|--------------|
| `next` | Full-stack React, SSR, ISR |
| `nuxt` | Full-stack Vue, SSR |
| `astro` | Content-first, statique avec îlots interactifs |
| `sveltekit` | Full-stack Svelte |
| `remix` | Full-stack React, nested routes, loaders |
| `express` | API Node simple (legacy, préférer Hono pour nouveau projet) |
| `hono` | API TS/JS moderne, multi-runtime (Bun, Node, Deno, CF Workers) |
| `elysia` | API Bun-native, performance |
| `fastify` | API Node performant |
| `fastapi` | API Python moderne, async, auto-docs |
| `django` | Python full-stack, ORM intégré, admin |
| `flask` | Python API simple (préférer FastAPI pour nouveau projet) |
| `gin` / `chi` / `echo` / `fiber` | API Go |
| `actix-web` / `axum` | API Rust |
| `none` | CLI tool, library, script — pas de framework nécessaire |

**Projet neuf API** → recommander `hono` (TS) ou `fastapi` (Python) sauf raison spécifique.

---

### 5. containerization

| Valeur | Quand choisir |
|--------|--------------|
| `DOCKER` | **Par défaut pour tout projet qui sera déployé ou qui a des dépendances système.** Aussi : multi-services, database locale, variables d'env sensibles, Python (isolation système), reproductibilité cross-machine. |
| `NO-DOCKER` | Uniquement : CLI tool / library standalone compilée (Go, Rust), ou script utilitaire simple sans dépendances système. |

**Biais automation-first** : en cas de doute → DOCKER. Le coût est nul (Claude génère le Dockerfile), le bénéfice est réel (reproductibilité, isolation).

---

### 6. isolation

| Valeur | Quand choisir |
|--------|--------------|
| `VENV` | Python — **toujours** (sauf si DEVCONTAINER). Pas de Python global, jamais. |
| `CONDA` | Python data science / ML avec dépendances C/Fortran (numpy, scipy compilés) |
| `DEVCONTAINER` | Quand l'environnement complet doit être reproductible (VS Code, Codespaces) |
| `NIX` | Si le projet utilise déjà Nix |
| `NONE` | Go (isolation native via modules), Rust (isolation native via cargo), Node/Bun (node_modules local) |

**Python = VENV obligatoire.** Pas de discussion, pas de "c'est un petit script". Un venv se crée en 2 secondes.

---

### 7. database

| Valeur | Quand choisir |
|--------|--------------|
| `postgres` | Base relationnelle par défaut. Scalable, fiable, extensible (JSON, full-text search, etc.) |
| `sqlite` | Projets embarqués, CLI avec stockage local, prototypage, single-user |
| `mongo` | Si le projet l'utilise déjà. Ne jamais recommander Mongo sur un nouveau projet sauf besoin document-store explicite. |
| `redis` | Cache, pub/sub, queues. Souvent en complément, rarement seul. |
| `supabase` | Postgres managé + auth + realtime. Si le projet cible Supabase. |
| `none` | Pas de persistence nécessaire |

**Nouveau projet avec besoin DB** → `postgres` par défaut, `sqlite` si embarqué/local.

---

### 8. test_runner

| Valeur | Quand choisir |
|--------|--------------|
| `bun:test` | Si runtime = bun |
| `vitest` | Si runtime = node et projet moderne |
| `jest` | Si jest déjà configuré (ne pas migrer sans raison) |
| `pytest` | Python — toujours |
| `go test` | Go — natif |
| `cargo test` | Rust — natif |

**Cohérence avec le runtime.** Ne jamais proposer un test runner incompatible.

---

### 9. linter

| Valeur | Quand choisir |
|--------|--------------|
| `biome` | TS/JS — lint + format en un seul outil, rapide, zero config |
| `eslint` | Si déjà configuré (ne pas migrer sans raison) |
| `ruff` | Python — lint + format, remplace flake8 + black + isort |
| `golangci-lint` | Go — agrégateur de linters standard |
| `clippy` | Rust — linter officiel |

**Nouveau projet TS/JS** → `biome`. **Nouveau projet Python** → `ruff`.

---

### 10. sast

Static Application Security Testing — analyse de sécurité du code source. Distinct du linter (qualité de code). Le linter détecte des anti-patterns syntaxiques, le SAST détecte des vulnérabilités par data flow analysis.

| Valeur | Quand choisir |
|--------|--------------|
| `bandit` | Python — léger, rapide, standard pour la sécurité Python |
| `semgrep` | Multi-langage, ou besoin de règles SAST custom (patterns maison) |
| `none` | CLI tool / lib locale sans input externe, sans réseau, sans auth |

**Heuristiques** — recommander SAST (`bandit` ou `semgrep`) si **au moins un** :
- Le projet expose une API ou un web app
- Le projet gère de l'auth / des tokens / des sessions
- Le projet accepte du user input exploitable (formulaires, requêtes, eval/exec)
- Le projet fait du réseau (HTTP client, WebSocket, gRPC)
- Le projet manipule de la crypto au-delà du hashing standard
- `deploy_target` ≠ `local`

Recommander `none` seulement si **tous** :
- CLI tool ou lib locale, pas de réseau
- Pas d'auth, pas de secrets en runtime
- Pas de user input exploitable

**Choix Python** → `bandit` (sauf besoin de règles custom → `semgrep`).
**Choix TS/JS** → `semgrep` (pas de SAST dédié TS aussi mature que bandit).
**Choix Go** → `semgrep` ou `gosec`.
**Choix Rust** → `none` (le compilateur couvre déjà la majorité des vulnérabilités mémoire ; `cargo-audit` pour les deps).

---

### 11. deploy_target

| Valeur | Quand choisir |
|--------|--------------|
| `vercel` | Next.js, front-end, serverless |
| `fly` | Containers, API, bases de données, multi-région |
| `railway` | Full-stack simple, DB incluse |
| `cloudflare-workers` | Edge computing, Hono |
| `vps` | Contrôle total, budget fixe |
| `local` | CLI tool, library, script utilitaire |
| `none` | Pas encore déterminé |

**Ne pas forcer un deploy target.** Si pas de signal → `none`, poser la question uniquement si le projet est clairement déployable.

---

### 12. ci

| Valeur | Quand choisir |
|--------|--------------|
| `github-actions` | Si le repo est sur GitHub (ou sera sur GitHub) — **par défaut** |
| `gitlab-ci` | Si le repo est sur GitLab |
| `none` | Script utilitaire, projet personnel sans remote |

**Biais automation-first** : recommander CI dès que le projet a des tests. Le coût est un fichier YAML, le bénéfice est la confiance sur chaque push.

---

### 13. monorepo_tool

| Valeur | Quand choisir |
|--------|--------------|
| `turborepo` | Monorepo TS/JS, build caching |
| `nx` | Monorepo large, multi-langage |
| `pnpm workspaces` | Monorepo simple, pas besoin d'orchestration |
| `npm workspaces` / `yarn workspaces` | Monorepo simple avec npm/yarn |
| `none` | Single project |

---

### 14. type_checker

Le vérificateur de types. **Obligatoire si le langage le supporte** (statique ou via annotations).

| Valeur | Quand choisir |
|--------|--------------|
| `tsc` | TypeScript — inclus dans le langage, pas de choix à faire |
| `mypy` | Python — le plus mature, large écosystème de stubs |
| `pyright` | Python — plus rapide, meilleur support IDE (VS Code) |
| `go compiler` | Go — typage statique natif, pas de choix |
| `rustc` | Rust — typage statique natif, pas de choix |
| `javac` / `kotlinc` | Java/Kotlin — typage statique natif |
| `swiftc` | Swift — typage statique natif |

**Python sans type checker = dette technique dès le premier jour.** Pas de discussion.

**Nouveau projet Python** → `pyright` (plus rapide, meilleur DX). **JavaScript sans TS** → recommander migration TypeScript.

---

### 15. dependency_policy

Dimension de **validation** — pas un choix d'outil mais une vérification d'hygiène des dépendances.

| Critère | Attendu |
|---------|---------|
| Manifeste présent | Oui — `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `build.gradle`, etc. |
| Lock file présent | Oui — cohérent avec le package manager (`bun.lockb`, `package-lock.json`, `poetry.lock`, `Cargo.lock`, `go.sum`, `uv.lock`, etc.) |
| Lock file utilisé dans Docker | Le `COPY` du Dockerfile copie le lock file, pas seulement le manifeste |
| Dépendances dev séparées | `devDependencies`, `[tool.poetry.group.dev]`, `[dev-dependencies]`, `extras`, `features`, etc. |
| Dépendances justifiées | Privilégier la stdlib du langage ; chaque dep externe a une raison |

**Règle** : le manifeste déclare les contraintes souples (`>=1.2,<2`), le lock file fige les versions exactes (`1.2.7`). La conteneurisation utilise le lock file, jamais le manifeste directement.

---

### 16. secrets_management

Dimension de **validation** — vérifie que les secrets ne fuient pas.

| Critère | Attendu |
|---------|---------|
| Aucun secret dans le code | Pas de clé API, mot de passe, token hardcodé. Jamais. |
| `.env` dans `.gitignore` | Obligatoire si `.env` existe |
| `.env.example` versionné | Montre les variables attendues sans les valeurs réelles |
| Secrets via env vars | Variables d'environnement ou fichier de config local non versionné |

**Template `.env.example`** :
```
# .env.example — copier vers .env et remplir les valeurs
API_KEY=
DATABASE_URL=
LOG_LEVEL=INFO
```

---

### 17. repo_hygiene

Dimension de **validation** — vérifie que le `.gitignore` couvre les exclusions minimales.

Le repo DOIT inclure un fichier d'exclusion (`.gitignore` ou équivalent) qui exclut au minimum :

| Catégorie | Exemples |
|-----------|----------|
| Artefacts de build | `dist/`, `build/`, `out/`, `target/` |
| Caches d'outils | `.cache/`, `.pytest_cache/`, `.mypy_cache/`, `.eslintcache` |
| Dépendances locales | `node_modules/`, `.venv/`, `vendor/` |
| Fichiers de secrets | `.env`, `.env.local` |
| Fichiers d'IDE | `.vscode/`, `.idea/`, `*.swp` |
| Fichiers système | `.DS_Store`, `Thumbs.db` |
| Artefacts générés | `STACK_EVAL.yaml`, `*.pyc`, `__pycache__/` |

---

## Matrice de décision rapide par type de projet

| Type de projet | Containerization | Isolation | CI | Deploy |
|---------------|-----------------|-----------|-----|--------|
| CLI tool (Go/Rust) | NO-DOCKER | NONE | github-actions | local |
| CLI tool (TS/Python) | NO-DOCKER | VENV (py) / NONE (ts) | github-actions | local |
| API web | DOCKER | selon langage | github-actions | fly / railway |
| Full-stack web app | DOCKER | selon langage | github-actions | vercel / fly |
| Library / package | NO-DOCKER | selon langage | github-actions | npm / pypi |
| Data science | DOCKER | CONDA / VENV | github-actions | none |
| Script utilitaire | NO-DOCKER | VENV (py) / NONE | none | local |
| Monorepo | DOCKER | selon langage | github-actions | selon services |

## Matrice complémentaire — dimensions d'outillage

| Type de projet | Type Checker | SAST | Dep Lock | Secrets |
|---------------|-------------|------|----------|---------|
| CLI tool (Go/Rust) | natif | none | go.sum / Cargo.lock | si env vars |
| CLI tool (TS/Python) | tsc / pyright | none (sauf réseau) | lockfile PM | si env vars |
| API web | selon langage | obligatoire | obligatoire | obligatoire |
| Full-stack web app | selon langage | obligatoire | obligatoire | obligatoire |
| Library / package | obligatoire | si input externe | obligatoire | rare |
| Data science | pyright | none | obligatoire | si API keys |
| Script utilitaire | recommandé | none | recommandé | si secrets |

Note : property_testing et logging ont été migrés vers `libs-evaluator` (libs applicatives).
