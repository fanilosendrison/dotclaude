# Signals — Cartographie fichier → indice

Chaque signal est un fichier, pattern ou contenu qui indique une valeur pour une dimension.

## Language

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `tsconfig.json` | typescript | high |
| `*.ts`, `*.tsx` (majorité des fichiers) | typescript | high |
| `jsconfig.json` | javascript | high |
| `*.js`, `*.jsx` (majorité, pas de tsconfig) | javascript | high |
| `pyproject.toml`, `setup.py`, `requirements.txt` | python | high |
| `*.py` (majorité des fichiers) | python | high |
| `go.mod` | go | high |
| `*.go` (majorité) | go | high |
| `Cargo.toml` | rust | high |
| `*.rs` (majorité) | rust | high |
| `Gemfile` | ruby | high |
| `*.rb` (majorité) | ruby | high |
| `pom.xml`, `build.gradle` | java/kotlin | high |
| `*.swift`, `Package.swift` | swift | high |
| `mix.exs` | elixir | high |
| Aucun fichier source | unknown | low |

## Runtime

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `bun.lockb` | bun | high |
| `package.json` → `engines.bun` | bun | high |
| `bunfig.toml` | bun | high |
| `package-lock.json` | node | high |
| `yarn.lock` | node (yarn) | high |
| `pnpm-lock.yaml` | node (pnpm) | high |
| `.nvmrc`, `.node-version` | node | high |
| `.python-version` | python (cpython) | high |
| `go.mod` | go | high |
| `Cargo.toml` | rustc | high |
| `deno.json`, `deno.lock` | deno | high |
| `tsconfig.json` sans lockfile | indéterminé (ts) | low |

## Language & Runtime Versions

Signaux qui révèlent une version spécifique du langage ou du runtime. Ces signaux sont prioritaires sur toute recommandation par défaut.

### Version explicite (fichiers dédiés)

| Signal | Dimension | Confiance |
|--------|-----------|-----------|
| `.nvmrc` → contenu (ex: `20`, `lts/*`) | runtime_version (node) | high |
| `.node-version` → contenu | runtime_version (node) | high |
| `.python-version` → contenu (ex: `3.12.1`) | language_version + runtime_version (python) | high |
| `rust-toolchain.toml` → `channel` | language_version (rust) | high |
| `rust-toolchain` → contenu | language_version (rust) | high |
| `.tool-versions` (asdf) → lignes `python X.Y`, `nodejs X.Y`, etc. | language_version + runtime_version | high |
| `.ruby-version` → contenu | language_version (ruby) | high |
| `.go-version` → contenu | language_version (go) | high |
| `.java-version` → contenu | language_version (java) | high |

### Version dans les manifestes

| Signal | Dimension | Confiance |
|--------|-----------|-----------|
| `package.json` → `engines.node` (ex: `">=18"`, `"20.x"`) | runtime_version (node) + version_constraint | high |
| `package.json` → `engines.bun` | runtime_version (bun) + version_constraint | high |
| `package.json` → `volta.node` | runtime_version (node) | high |
| `tsconfig.json` → `compilerOptions.target` (ex: `ES2023`) | language_version (typescript) | medium |
| `tsconfig.json` → `compilerOptions.lib` | language_version (typescript) | medium |
| `pyproject.toml` → `requires-python` (ex: `">=3.11"`) | language_version (python) + version_constraint | high |
| `go.mod` → directive `go X.Y` (ex: `go 1.22`) | language_version (go) | high |
| `Cargo.toml` → `rust-version` (MSRV) | language_version (rust) + version_constraint | high |
| `Cargo.toml` → `edition` (ex: `"2021"`) | language_version (rust) | medium |
| `build.gradle` → `sourceCompatibility` / `targetCompatibility` | language_version (java) | high |
| `pom.xml` → `maven.compiler.source` / `maven.compiler.target` | language_version (java) | high |
| `.csproj` → `<TargetFramework>` (ex: `net8.0`) | language_version (C#) | high |

### Version dans Docker / CI

| Signal | Dimension | Confiance |
|--------|-----------|-----------|
| `Dockerfile` → `FROM node:20-alpine` | runtime_version (node) | high |
| `Dockerfile` → `FROM python:3.12-slim` | runtime_version (python) | high |
| `Dockerfile` → `FROM golang:1.22` | runtime_version (go) | high |
| `Dockerfile` → `FROM rust:1.77` | runtime_version (rust) | high |
| `Dockerfile` → `FROM oven/bun:1.1` | runtime_version (bun) | high |
| `.github/workflows/*.yml` → `node-version: 20` | runtime_version (node) | medium |
| `.github/workflows/*.yml` → `python-version: "3.12"` | runtime_version (python) | medium |
| `.github/workflows/*.yml` → `go-version: "1.22"` | runtime_version (go) | medium |

### Résolution de conflits

Si plusieurs signaux indiquent des versions différentes :
1. Fichier dédié (`.nvmrc`, `.python-version`) > manifeste (`engines`, `requires-python`) > Docker/CI
2. Signaler le conflit à l'utilisateur avec les fichiers concernés
3. Recommander d'aligner tous les fichiers sur une seule version

### Aucun signal de version (projet neuf)

Si aucun signal de version n'est détecté → utiliser l'**agent `websearch`** (Task tool, `subagent_type: websearch`) pour déterminer la version recommandée. L'agent peut fetch les pages officielles et extraire la version exacte, sans polluer le contexte principal :
- `"[language] current LTS version [année en cours]"` pour les langages avec cycle LTS (Node, Python, Java)
- `"[language] latest stable version [année en cours]"` pour les autres (Go, Rust, Bun)
- Si `deploy_target` est connu → `"[deploy_target] supported [language] versions [année en cours]"` pour vérifier la compatibilité

La version_strategy est déterminée par le project_type :
- `application` / `api` / `web-app` → `LTS` (stabilité en prod)
- `library` / `package` → `LTS` + `version_constraint` large (compat)
- `script` → `LATEST` (pas de contrainte de compat)

---

## Package Manager

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `bun.lockb` | bun | high |
| `package-lock.json` | npm | high |
| `yarn.lock` | yarn | high |
| `pnpm-lock.yaml` | pnpm | high |
| `Pipfile.lock` | pipenv | high |
| `poetry.lock` | poetry | high |
| `uv.lock` | uv | high |
| `requirements.txt` (seul) | pip | medium |
| `pyproject.toml` → `[tool.poetry]` | poetry | high |
| `pyproject.toml` → `[tool.pdm]` | pdm | high |
| `pyproject.toml` → `[project]` (PEP 621, sans tool section) | pip / uv | medium |
| `go.sum` | go modules | high |
| `Cargo.lock` | cargo | high |

## Framework

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `next.config.*` | next | high |
| `package.json` → deps contient `next` | next | high |
| `nuxt.config.*` | nuxt | high |
| `astro.config.*` | astro | high |
| `svelte.config.*` | sveltekit | high |
| `remix.config.*`, `package.json` → `@remix-run/*` | remix | high |
| `package.json` → deps contient `express` | express | high |
| `package.json` → deps contient `hono` | hono | high |
| `package.json` → deps contient `fastify` | fastify | high |
| `package.json` → deps contient `elysia` | elysia | high |
| `pyproject.toml` / `requirements.txt` → `fastapi` | fastapi | high |
| `pyproject.toml` / `requirements.txt` → `django` | django | high |
| `pyproject.toml` / `requirements.txt` → `flask` | flask | high |
| `main.go` + routeur (chi, gin, echo, fiber) | go + framework | high |
| Aucun framework détecté | none | medium |

## Containerization

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `Dockerfile` | DOCKER | high |
| `docker-compose.yml` / `docker-compose.yaml` / `compose.yml` | DOCKER | high |
| `.dockerignore` | DOCKER | high |
| `devcontainer.json` / `.devcontainer/` | DOCKER (devcontainer) | high |
| Aucun signal Docker | évaluer proactivement | — |

### Évaluation proactive (pas de signal Docker)

Recommander DOCKER si **au moins un** :
- Le projet a des dépendances système (database, redis, services externes)
- Le projet est une API ou un web app destiné au déploiement
- Le projet a plus d'un service (frontend + backend, ou API + worker)
- Le langage a des problèmes connus d'isolation d'environnement (Python, Ruby)
- Le projet utilise des variables d'environnement sensibles (.env)

Recommander NO-DOCKER uniquement si **tous** :
- CLI tool ou library standalone
- Pas de dépendances système
- Single runtime, pas de services annexes
- Déjà isolé par un autre mécanisme (go binary, rust binary)

## Isolation

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `.venv/`, `venv/` | VENV | high |
| `Pipfile` (pipenv crée un venv) | VENV | high |
| `pyproject.toml` (poetry/pdm gèrent des venvs) | VENV | high |
| `.python-version` | VENV (implicite) | medium |
| `.devcontainer/` | DEVCONTAINER | high |
| `flake.nix`, `shell.nix` | NIX | high |
| `go.mod` (Go isole nativement) | NONE | high |
| `Cargo.toml` (Rust isole nativement) | NONE | high |
| `node_modules/` local (Node isole par projet) | NONE | medium |
| Aucun signal, langage = Python | VENV recommandé | — |
| Aucun signal, langage ≠ Python | NONE | medium |

## Database

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `docker-compose.yml` → service postgres | postgres | high |
| `prisma/schema.prisma` → `provider = "postgresql"` | postgres | high |
| `prisma/schema.prisma` → `provider = "sqlite"` | sqlite | high |
| `drizzle.config.*` | inspecter le provider | high |
| `knexfile.*` | inspecter le client | high |
| `*.db`, `*.sqlite` files | sqlite | high |
| `requirements.txt` → `psycopg2` / `asyncpg` | postgres | high |
| `requirements.txt` → `pymongo` | mongo | high |
| `package.json` → `pg`, `postgres` | postgres | high |
| `package.json` → `better-sqlite3`, `sql.js` | sqlite | high |
| `package.json` → `mongoose`, `mongodb` | mongo | high |
| `package.json` → `redis`, `ioredis` | redis | high |
| `supabase/` dir, `.supabase/` | postgres (supabase) | high |
| Aucun signal DB | none | medium |

## Test Runner

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `vitest.config.*`, `package.json` → deps `vitest` | vitest | high |
| `jest.config.*`, `package.json` → deps `jest` | jest | high |
| `package.json` → scripts contient `bun test` | bun:test | high |
| `bun.lockb` + fichiers `*.test.ts` (sans vitest/jest) | bun:test | medium |
| `pytest.ini`, `pyproject.toml` → `[tool.pytest]` | pytest | high |
| `requirements.txt` → `pytest` | pytest | high |
| `*_test.go` files | go test | high |
| `Cargo.toml` + `#[cfg(test)]` | cargo test | high |
| Aucun test détecté | inférer du runtime | low |

## Type Checker

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `tsconfig.json` (TypeScript intègre le type checking) | tsc | high |
| `pyproject.toml` → `[tool.mypy]` | mypy | high |
| `mypy.ini`, `.mypy.ini` | mypy | high |
| `pyrightconfig.json` | pyright | high |
| `pyproject.toml` → `[tool.pyright]` | pyright | high |
| `pyproject.toml` → `[tool.pytype]` | pytype | high |
| Go (typage statique natif) | go compiler | high |
| Rust (typage statique natif) | rustc | high |
| Java / Kotlin (typage statique natif) | compilateur | high |
| Swift (typage statique natif) | swiftc | high |
| Aucun type checker, langage = Python | recommander mypy ou pyright | — |
| Aucun type checker, langage = JavaScript (pas TS) | recommander migration TS | — |

## Linter

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `biome.json`, `biome.jsonc` | biome | high |
| `.eslintrc*`, `eslint.config.*` | eslint | high |
| `pyproject.toml` → `[tool.ruff]` | ruff | high |
| `ruff.toml` | ruff | high |
| `pyproject.toml` → `[tool.flake8]` | flake8 | high |
| `.golangci.yml` | golangci-lint | high |
| `clippy` dans CI config | clippy | high |
| Aucun linter détecté | recommander selon langage | — |

### Recommandations par défaut (aucun linter existant)
- TypeScript/JavaScript → biome
- Python → ruff
- Go → golangci-lint
- Rust → clippy

## SAST

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `pyproject.toml` / `requirements.txt` → `bandit` | bandit | high |
| `.bandit` ou `pyproject.toml` → `[tool.bandit]` | bandit | high |
| `.semgrep.yml`, `.semgrep/` | semgrep | high |
| `package.json` → deps contient `semgrep` | semgrep | high |
| CI config → step `bandit` ou `semgrep` | selon outil | high |
| Aucun signal SAST | évaluer proactivement | — |

### Évaluation proactive (aucun outil SAST existant)

Recommander SAST si **au moins un** :
- Le projet expose une API ou un web app (framework détecté ≠ none)
- Le projet gère de l'auth / des tokens / des sessions (signaux dans le code ou les specs)
- Le projet accepte du user input exploitable (formulaires, requêtes, eval/exec)
- Le projet fait du réseau (HTTP client, WebSocket, gRPC)
- Le projet manipule de la crypto au-delà du hashing standard
- `deploy_target` ≠ `local` et ≠ `none`

Recommander `none` si **tous** :
- CLI tool ou lib locale, pas de réseau
- Pas d'auth, pas de secrets en runtime
- Pas de user input exploitable

### Recommandations par défaut (aucun outil SAST existant)
- Python → bandit
- TypeScript/JavaScript → semgrep
- Go → semgrep (ou gosec)
- Rust → none (compilateur + cargo-audit suffisent)

## Deploy Target

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `vercel.json`, `.vercel/` | vercel | high |
| `fly.toml` | fly | high |
| `railway.json`, `railway.toml` | railway | high |
| `netlify.toml` | netlify | high |
| `render.yaml` | render | high |
| `app.yaml` (GCP) | gcp | high |
| `serverless.yml` | serverless | high |
| `terraform/`, `*.tf` | infra-as-code | high |
| `Procfile` | heroku | high |
| `Dockerfile` seul (pas de config deploy) | indéterminé | low |
| Aucun signal deploy | none / local | medium |

## CI

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `.github/workflows/*.yml` | github-actions | high |
| `.gitlab-ci.yml` | gitlab-ci | high |
| `Jenkinsfile` | jenkins | high |
| `.circleci/config.yml` | circleci | high |
| `.travis.yml` | travis | high |
| Aucun signal CI | recommander github-actions si repo GitHub | — |

## Monorepo Tool

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `turbo.json` | turborepo | high |
| `nx.json` | nx | high |
| `lerna.json` | lerna | high |
| `pnpm-workspace.yaml` | pnpm workspaces | high |
| `package.json` → `workspaces` | npm/yarn workspaces | high |
| Multiple `package.json` in subdirs | monorepo probable | medium |
| Single project | none | high |

## Dependency Lock

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `package-lock.json` présent | npm lock ✓ | high |
| `yarn.lock` présent | yarn lock ✓ | high |
| `pnpm-lock.yaml` présent | pnpm lock ✓ | high |
| `bun.lockb` présent | bun lock ✓ | high |
| `poetry.lock` présent | poetry lock ✓ | high |
| `Pipfile.lock` présent | pipenv lock ✓ | high |
| `uv.lock` présent | uv lock ✓ | high |
| `requirements.txt` avec versions figées (`==`) | pip lock (partiel) | medium |
| `Cargo.lock` présent | cargo lock ✓ | high |
| `go.sum` présent | go lock ✓ | high |
| Manifeste présent sans lock file correspondant | lock manquant ⚠ | high |

## Secrets Management

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `.env` dans `.gitignore` | gitignore OK | high |
| `.env.example` ou `.env.template` présent | template OK | high |
| `.env` versionné (tracké par git) | anti-pattern ⚠ | high |
| Secrets détectés dans le code source (patterns `API_KEY=`, `token=`, `password=`) | anti-pattern ⚠ | high |
| `docker-compose.yml` → `env_file` | docker env ✓ | high |
| Aucun signal secrets | évaluer si le projet en a besoin | — |

## Repo Hygiene (.gitignore)

| Signal | Valeur indiquée | Confiance |
|--------|----------------|-----------|
| `.gitignore` présent | baseline OK | high |
| `.gitignore` contient `node_modules/` (projet JS/TS) | deps ignorées ✓ | high |
| `.gitignore` contient `.venv/` ou `venv/` (projet Python) | venv ignoré ✓ | high |
| `.gitignore` contient `target/` (projet Rust) | build ignoré ✓ | high |
| `.gitignore` contient `.env` | secrets ignorés ✓ | high |
| `.gitignore` contient `.DS_Store` | system files ✓ | medium |
| `.gitignore` contient `.vscode/` ou `.idea/` | IDE files ✓ | medium |
| `.gitignore` absent dans un repo git | absent ⚠ | high |
| Artefacts de build versionnés (`dist/`, `build/`, `out/`) | anti-pattern ⚠ | high |
| Caches d'outils versionnés (`.pytest_cache/`, `.mypy_cache/`, `.eslintcache`) | anti-pattern ⚠ | high |

---

## Spec-Derived Constraints

Contraintes techniques extraites des specs normatives du projet. Ces signaux sont des **filtres éliminatoires** — ils suppriment des options, pas en ajoutent.

### Type system du runtime

| Pattern dans les specs | Contrainte | Langages éliminés | Langages conformes |
|---|---|---|---|
| "types distincts pour entiers et flottants" / "int vs float" / "le runtime DOIT distinguer" | Le runtime doit avoir des types numériques distincts nativement | JavaScript, TypeScript (`number` unique, IEEE 754 double) | Python (`int`/`float`), Go (`int64`/`float64`), Rust (`i64`/`f64`), Java (`int`/`double`) |
| "désérialisation JSON DOIT préserver la distinction" int/float | `JSON.parse` natif doit produire des types différents pour `42` vs `3.14` | JavaScript, TypeScript (`JSON.parse` produit `number` dans les deux cas) | Python (`json.loads`), Go (avec `json.Number`), Rust (avec serde `Number`) |
| "classification numérique NE DOIT PAS dépendre de convention d'application" | Interdit les custom JSON revivers, wrappers, ou post-processing pour distinguer les types | Renforce l'élimination de JS/TS — même les contournements (lossless-json, custom reviver) sont interdits | Python (distinction native sans convention) |

### Précision numérique

| Pattern dans les specs | Contrainte | Langages éliminés | Langages conformes |
|---|---|---|---|
| "entiers au-delà de 2^53" / "integer overflow" | Le runtime doit supporter des entiers arbitrairement grands nativement | Go (`int64` limité à 2^63), C/C++ | Python (`int` arbitraire), Rust (`BigInt` via crate), JavaScript (`BigInt` natif) |
| "précision décimale exacte" / "decimal" / "pas d'arrondi IEEE 754" | Le runtime doit avoir un type décimal exact | JavaScript, Go (pas de `Decimal` natif) | Python (`decimal.Decimal`), Rust (`rust_decimal`), Java (`BigDecimal`) |

### Sérialisation / désérialisation

| Pattern dans les specs | Contrainte | Langages éliminés | Langages conformes |
|---|---|---|---|
| "canonical JSON" / "tri récursif des clés" | Le runtime doit pouvoir produire du JSON canonique déterministe | Aucun éliminé (faisable dans tous les langages) | Tous |
| "round-trip JSON fidelity" / "sérialiser puis désérialiser = identité" | Le runtime doit préserver la fidélité numérique au round-trip | JavaScript (perte de précision int > 2^53, pas de distinction int/float) | Python, Go, Rust |

### Portabilité / distribution

| Pattern dans les specs | Contrainte | Impact stack |
|---|---|---|
| "clone → run en une commande" / "sans prérequis applicatif" | Le projet doit fonctionner sans rien installer manuellement sur la machine hôte | Favorise Docker ou un script bootstrap qui installe le runtime. Si NO-DOCKER → le README doit documenter l'installation du runtime. |
| "binaire standalone" / "pas de runtime" | Le projet doit se distribuer comme un exécutable autonome | Favorise Go, Rust. Élimine Python, JS/TS (nécessitent un runtime). |

### Comment utiliser cette section

1. Pendant le step 2 (scan), noter les patterns normatifs trouvés dans les specs
2. Au step 2b, croiser avec ce tableau pour identifier les langages éliminés
3. Documenter chaque contrainte dans `spec_constraints` du STACK_EVAL.yaml
4. Ne recommander que des langages qui survivent à tous les filtres
