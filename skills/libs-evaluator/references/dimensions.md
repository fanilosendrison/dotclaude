# Dimensions — Libs applicatives

**Enum fermé** — snapshot de l'état de l'art à date. Claude applique les règles de décision ci-dessous sans consulter le web.

- `last_reviewed: 2026-04-15`
- `next_review_due: 2026-07-15` (trimestriel — libs bougent plus vite que la stack)

~25 capabilities groupées par catégorie. Pour chaque capability : valeurs candidates avec **package exact** (colonne `package`), flag `dev` (runtime vs devDep), et règle "quand choisir".

## Philosophie

- **Type-safety first** : privilégier systématiquement la lib typée (zod > yup, drizzle > typeorm)
- **Maintenance active** : critère appliqué au moment de la rédaction — re-vérifié à chaque `last_reviewed`
- **Compat runtime** : critique pour TS (Bun/Deno/Edge/Node) — voir `compatibility-matrix.md`
- **Déterminisme runtime** : pas de web lookup, décision figée par l'enum
- **Contraintes normatives** : une spec projet peut override l'enum (step 2b de SKILL.md)

## Comment lire les tableaux

| Colonne | Sens |
|---------|------|
| `Valeur` | Nom humain (kebab-case) — ce qui ira dans `choice` du LIBS_EVAL.yaml |
| `Package` | Nom exact sur le registry (npm / PyPI / crates.io / pkg.go.dev) — ce qui ira dans `package`. `null` pour sentinelles. |
| `Dev` | `true` = devDependency (tooling build/test/migration), `false` = runtime |
| `Langage` / `Runtime` | Filtre de compatibilité (voir `compatibility-matrix.md` pour les combinaisons) |
| `Quand choisir` | Règle de décision — conditions descendantes, défaut en dernier |

**Sentinelles** (valeurs sans package à installer) : `none`, `not-applicable`, `native`, `fetch-native`, `raw-sql`, `context-only`. Toutes ont `package: null`.

---

## Data & Validation

### 1. schema_validation

Validation de schémas runtime (entrées externes, env vars, body HTTP).

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `zod` | `zod` | false | TS | **Défaut TS** — écosystème massif, inférence de types, standard de fait |
| `valibot` | `valibot` | false | TS | Si `deploy_target ∈ {cloudflare-workers, vercel-edge}` OU bundle size mentionné comme contrainte dans specs |
| `arktype` | `arktype` | false | TS | Si specs demandent validation runtime ultra-performante OU syntaxe type-first explicitée |
| `pydantic` | `pydantic` | false | Python | **Défaut Python** — standard de facto, intégration FastAPI |
| `msgspec` | `msgspec` | false | Python | Si projet perf-critique avec beaucoup de (dé)sérialisation |
| `serde` | `serde` | false | Rust | **Défaut Rust** — avec `serde_json` (`serde_json`) pour JSON |
| `validator` | `github.com/go-playground/validator/v10` | false | Go | Si validation déclarative par tags requise |
| `none` | `null` | — | — | CLI sans validation runtime externe |

### 2. orm

Mapping base de données.

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `drizzle` | `drizzle-orm` | false | TS | **Défaut TS** — type-safe, léger, SQL-first, edge-compatible |
| `prisma` | `prisma` | false | TS | Si `database = mongo` (seul ORM TS mature mongo) OU studio GUI explicitement requis |
| `kysely` | `kysely` | false | TS | Si specs interdisent ORM et veulent query builder pur SQL-first |
| `sqlalchemy` | `sqlalchemy` | false | Python | **Défaut Python** — 2.0 async, type hints modernes |
| `sqlx` | `sqlx` | false | Rust | **Défaut Rust** — async, compile-time checked queries |
| `gorm` | `gorm.io/gorm` | false | Go | **Défaut Go** si ORM requis |
| `raw-sql` | `null` | — | — | Si specs interdisent les abstractions ORM |
| `none` | `null` | — | — | Si `database = none` |

### 3. migrations

Gestion des migrations DB. **Règle** : cohérence avec `orm`.

| Valeur | Package | Dev | Lié à | Quand choisir |
|--------|---------|-----|-------|---------------|
| `drizzle-kit` | `drizzle-kit` | true | drizzle | Si `orm = drizzle` |
| `prisma` | `prisma` | true | prisma | Si `orm = prisma` (CLI inclus dans le même package) |
| `alembic` | `alembic` | true | sqlalchemy | Si `language = python` |
| `sqlx-cli` | `sqlx-cli` | true | sqlx | Si `orm = sqlx` |
| `atlas` | `null` | true | — | Si `language = go` — binaire externe, à installer via curl |
| `none` | `null` | — | — | Si `orm ∈ {raw-sql, none}` ou pas de DB |

---

## I/O & Network

### 4. http_client

Client HTTP pour appels sortants.

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `fetch-native` | `null` | — | TS | **Défaut TS** — fetch global dans Bun/Deno/Node 18+/edge |
| `ky` | `ky` | false | TS | Si retry/timeout/hooks explicitement requis |
| `httpx` | `httpx` | false | Python | **Défaut Python** — async/sync, HTTP/2 |
| `reqwest` | `reqwest` | false | Rust | **Défaut Rust** — async, features JSON/TLS |
| `net/http` | `null` | — | Go | **Défaut Go** — stdlib suffit |
| `resty` | `github.com/go-resty/resty/v2` | false | Go | Si retry/middlewares requis |

### 5. http_server

Serveur HTTP / framework API. **Redondance partielle avec `framework` de STACK_EVAL** : si STACK_EVAL a fixé `framework`, recopier ici. Sinon utiliser l'enum.

| Valeur | Package | Dev | Runtime | Quand choisir |
|--------|---------|-----|---------|---------------|
| `hono` | `hono` | false | bun/node/edge | **Défaut TS API** — multi-runtime, léger |
| `elysia` | `elysia` | false | bun | Si `runtime = bun` ET specs demandent perf extrême |
| `fastify` | `fastify` | false | node | Si `runtime = node` strict |
| `fastapi` | `fastapi` | false | cpython | **Défaut Python API** — async, auto-docs OpenAPI |
| `axum` | `axum` | false | rust | **Défaut Rust API** — tokio, type-safe |
| `gin` | `github.com/gin-gonic/gin` | false | go | **Défaut Go API** — perf, écosystème |
| `none` | `null` | — | — | CLI, script, library |

### 6. websocket

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `native-ws` | `null` | — | Si `runtime ∈ {bun, deno, cloudflare-workers}` (natif) |
| `ws-lib` | `ws` | false | Si `runtime = node` et besoin minimaliste |
| `socket-io` | `socket.io` | false | Si rooms/broadcast/transport fallback explicitement requis |
| `none` | `null` | — | **Défaut** — pas de real-time |

### 7. graphql

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `graphql-yoga` | `graphql-yoga` | false | TS | Si GraphQL serveur TS requis (léger, schema-first) |
| `apollo-server` | `@apollo/server` | false | TS | Si federation ou écosystème Apollo explicitement requis |
| `strawberry` | `strawberry-graphql` | false | Python | Si GraphQL serveur Python requis (type-hint-first) |
| `none` | `null` | — | — | **Défaut** — REST suffit |

---

## Domain

### 8. auth

Authentification.

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `better-auth` | `better-auth` | false | TS | **Défaut TS** — type-safe, self-hosted, batteries-included |
| `auth-js` | `@auth/core` | false | TS | Si `framework = next` (écosystème NextAuth) |
| `supabase-auth` | `@supabase/supabase-js` | false | TS | Si `database = supabase` |
| `clerk` | `@clerk/clerk-sdk-node` | false | TS | Si specs acceptent vendor managed + UI clé-en-main |
| `authlib` | `authlib` | false | Python | **Défaut Python** — OAuth/OIDC standard |
| `none` | `null` | — | — | CLI, lib, script, API sans auth |

### 9. date

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `date-fns` | `date-fns` | false | TS | **Défaut TS** — modulaire, tree-shakable, immutable |
| `temporal-polyfill` | `@js-temporal/polyfill` | false | TS | Si specs exigent Temporal (futur standard JS) |
| `luxon` | `luxon` | false | TS | Si timezones poussées (Intl natif) |
| `arrow` | `arrow` | false | Python | Si manipulation TZ avancée requise |
| `chrono` | `chrono` | false | Rust | **Défaut Rust** |
| `time` | `time.Time` / `null` | — | Go | **Défaut Go** — stdlib |
| `native` | `null` | — | — | **Défaut Python** — `datetime` stdlib suffit |

### 10. i18n

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `i18next` | `i18next` | false | TS | Si i18n requis — standard de fait |
| `lingui` | `@lingui/core` | false | TS | Si macros + type-safe messages requis |
| `babel` | `babel` | false | Python | Si Flask/Django ecosystem |
| `none` | `null` | — | — | **Défaut** — single-language |

### 11. queue

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `bullmq` | `bullmq` | false | TS | Si `database = redis` ET jobs async requis — **défaut TS** |
| `inngest` | `inngest` | false | TS | Si durable workflows managed explicitement requis |
| `celery` | `celery` | false | Python | **Défaut Python** — mature, broker flexible |
| `rq` | `rq` | false | Python | Si léger + Redis suffit |
| `none` | `null` | — | — | **Défaut** — pas de jobs async |

### 12. cache

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `ioredis` | `ioredis` | false | TS | Si `database = redis` — client TS standard |
| `unstorage` | `unstorage` | false | TS | Si abstraction multi-driver requise (memory/redis/fs/kv) |
| `redis-py` | `redis` | false | Python | Si cache Redis Python |
| `none` | `null` | — | — | **Défaut** — pas de cache |

---

## Frontend (applicable uniquement si `project_type ∈ {web-app, monorepo}`)

### 13. ui_framework

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `react` | `react` | false | **Défaut web-app** — écosystème max |
| `vue` | `vue` | false | Si framework = nuxt OU préférence explicite |
| `svelte` | `svelte` | false | Si framework = sveltekit |
| `solid` | `solid-js` | false | Si perf + API React-like requis |
| `htmx` | `htmx.org` | false | Si server-rendered + minimal JS |
| `none` | `null` | — | Pas de UI interactive |

### 14. styling

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `tailwind` | `tailwindcss` | true | **Défaut 2026** — utility-first, JIT |
| `css-modules` | `null` | — | Si CSS scopé classique préféré (natif build tools) |
| `vanilla-extract` | `@vanilla-extract/css` | true | Si CSS-in-TS zero-runtime requis |
| `unocss` | `unocss` | true | Si atomic CSS + perf max requise |

### 15. component_lib

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `shadcn` | `null` | — | **Défaut React + tailwind** — copy-paste, pas de dep à installer |
| `radix` | `@radix-ui/react-*` | false | Si primitives headless sans shadcn |
| `mantine` | `@mantine/core` | false | Si batteries-included + hooks riches requis |
| `headless-ui` | `@headlessui/react` | false | Si Tailwind Labs minimaliste |
| `none` | `null` | — | Custom components from scratch |

### 16. state

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `zustand` | `zustand` | false | **Défaut** — léger, store global |
| `jotai` | `jotai` | false | Si state atomique fine-grained requis |
| `tanstack-query` | `@tanstack/react-query` | false | **Systématique** pour server state (complément de zustand) |
| `context-only` | `null` | — | Petit projet, state local suffit |

### 17. router

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `tanstack-router` | `@tanstack/react-router` | false | **Défaut SPA** — type-safe, code-splitting auto |
| `next-router` | `null` | — | Si `framework = next` (file-based, intégré) |
| `react-router` | `react-router-dom` | false | Si projet existant l'utilise déjà |

### 18. forms

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `react-hook-form` | `react-hook-form` | false | **Défaut React** — perf, resolver zod |
| `tanstack-form` | `@tanstack/react-form` | false | Si type-safe + agnostic framework requis |
| `native` | `null` | — | Forms simples (FormData API) |

---

## Observability

### 19. logging

Logging structuré. **Jamais console.log/print pour logger.**

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `pino` | `pino` | false | TS | **Défaut TS** — structuré, JSON natif, perf max |
| `consola` | `consola` | false | TS | Si DX CLI agréable requis (project_type = cli-tool) |
| `structlog` | `structlog` | false | Python | **Défaut Python** — structuré, composable |
| `loguru` | `loguru` | false | Python | Si DX prioritaire sur structure |
| `slog` | `null` | — | Go | **Défaut Go** — stdlib 1.21+ |
| `tracing` | `tracing` | false | Rust | **Défaut Rust** — async-aware |

### 20. tracing

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `opentelemetry` | `@opentelemetry/api` | false | TS | Si `project_type ∈ {api, web-app}` ET `deploy_target ≠ local` |
| `opentelemetry-py` | `opentelemetry-api` | false | Python | Idem pour Python |
| `sentry` | `@sentry/node` | false | TS | Si error tracking + perf monitoring managé requis |
| `none` | `null` | — | — | **Défaut** — CLI, lib, script |

### 21. metrics

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `prom-client` | `prom-client` | false | TS | Si Prometheus /metrics endpoint requis |
| `opentelemetry` | `@opentelemetry/sdk-metrics` | false | TS | Si unifié avec tracing |
| `none` | `null` | — | — | **Défaut** — pas de métriques custom |

---

## Testing (au-delà du `test_runner` de STACK_EVAL)

### 22. property_testing

**Recommandé sur tout projet avec logique métier.**

| Valeur | Package | Dev | Langage |
|--------|---------|-----|---------|
| `fast-check` | `fast-check` | true | TS |
| `hypothesis` | `hypothesis` | true | Python |
| `proptest` | `proptest` | true | Rust |
| `rapid` | `pgregory.net/rapid` | true | Go |
| `none` | `null` | — | Script trivial |

### 23. e2e

Tests end-to-end UI. Applicable si `ui_framework ≠ none`.

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `playwright` | `@playwright/test` | true | **Défaut 2026** — multi-browser, API moderne |
| `playwright-py` | `pytest-playwright` | true | Si `language = python` |
| `none` | `null` | — | Pas d'UI ou couvert par unit tests |

### 24. mocking

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `msw` | `msw` | true | TS | **Défaut TS HTTP** — intercepte fetch au niveau réseau |
| `vitest-mock` | `null` | — | TS | Si `test_runner = vitest` — natif |
| `bun-mock` | `null` | — | TS | Si `test_runner = bun:test` — natif |
| `unittest-mock` | `null` | — | Python | **Défaut Python** — stdlib |
| `mockito` | `github.com/stretchr/testify/mock` | true | Go | **Défaut Go** — via testify |
| `none` | `null` | — | — | Tests unitaires purs |

### 25. snapshot

| Valeur | Package | Dev | Quand choisir |
|--------|---------|-----|---------------|
| `native` | `null` | — | **Défaut** — intégré au test runner (vitest, bun:test, pytest) |
| `insta` | `insta` | true | Si `language = rust` |
| `none` | `null` | — | Pas de snapshots |

---

## Utilities

### 26. cli_parsing

Applicable si `project_type ∈ {cli-tool, script}`.

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `clipanion` | `clipanion` | false | TS | **Défaut TS cli-tool** — type-safe, classes |
| `commander` | `commander` | false | TS | Si classique + simple |
| `typer` | `typer` | false | Python | **Défaut Python cli-tool** — type-hints-first |
| `click` | `click` | false | Python | Si écosystème existant click |
| `cobra` | `github.com/spf13/cobra` | false | Go | **Défaut Go cli-tool** |
| `clap` | `clap` | false | Rust | **Défaut Rust cli-tool** |
| `native` | `null` | — | — | `process.argv` / `sys.argv` — scripts triviaux |

### 27. env_parsing

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `native+zod` | `null` | — | TS | **Défaut TS** — `zod.parse(process.env)`, lib zod déjà présente |
| `dotenv` | `dotenv` | false | TS | Si `runtime = node` et chargement `.env` requis (Bun/Deno le font nativement) |
| `pydantic-settings` | `pydantic-settings` | false | Python | **Défaut Python** — validation via pydantic |
| `viper` | `github.com/spf13/viper` | false | Go | **Défaut Go** — config multi-source |
| `none` | `null` | — | — | Pas d'env vars |

### 28. id_generation

| Valeur | Package | Dev | Langage | Quand choisir |
|--------|---------|-----|---------|---------------|
| `native` | `null` | — | TS | **Défaut TS** — `crypto.randomUUID()` stdlib suffit |
| `nanoid` | `nanoid` | false | TS | Si IDs courts URL-safe requis |
| `ulid` | `ulid` | false | TS | Si tri temporel requis |
| `uuid-py` | `null` | — | Python | **Défaut Python** — `uuid` stdlib |
| `google/uuid` | `github.com/google/uuid` | false | Go | **Défaut Go** |

---

## Matrice project_type × dimensions applicables

✅ = applicable / ❌ = skip (valeur `not-applicable`) / ⚪ = optionnel

| Dimension         | cli-tool | script | library | api | web-app | monorepo |
|-------------------|:--------:|:------:|:-------:|:---:|:-------:|:--------:|
| schema_validation | ⚪       | ⚪     | ⚪      | ✅  | ✅      | ✅       |
| orm               | ❌       | ❌     | ⚪      | ✅  | ✅      | ✅       |
| migrations        | ❌       | ❌     | ❌      | ✅  | ✅      | ✅       |
| http_client       | ⚪       | ⚪     | ⚪      | ✅  | ✅      | ✅       |
| http_server       | ❌       | ❌     | ⚪      | ✅  | ✅      | ✅       |
| websocket         | ❌       | ❌     | ❌      | ⚪  | ⚪      | ⚪       |
| graphql           | ❌       | ❌     | ❌      | ⚪  | ⚪      | ⚪       |
| auth              | ❌       | ❌     | ❌      | ✅  | ✅      | ✅       |
| date              | ⚪       | ⚪     | ⚪      | ✅  | ✅      | ✅       |
| i18n              | ❌       | ❌     | ❌      | ⚪  | ⚪      | ⚪       |
| queue             | ❌       | ❌     | ❌      | ⚪  | ⚪      | ⚪       |
| cache             | ❌       | ❌     | ❌      | ⚪  | ⚪      | ⚪       |
| ui_framework      | ❌       | ❌     | ❌      | ❌  | ✅      | ⚪       |
| styling           | ❌       | ❌     | ❌      | ❌  | ✅      | ⚪       |
| component_lib     | ❌       | ❌     | ❌      | ❌  | ✅      | ⚪       |
| state             | ❌       | ❌     | ❌      | ❌  | ✅      | ⚪       |
| router            | ❌       | ❌     | ❌      | ❌  | ✅      | ⚪       |
| forms             | ❌       | ❌     | ❌      | ❌  | ✅      | ⚪       |
| logging           | ✅       | ⚪     | ⚪      | ✅  | ✅      | ✅       |
| tracing           | ❌       | ❌     | ❌      | ⚪  | ⚪      | ⚪       |
| metrics           | ❌       | ❌     | ❌      | ⚪  | ⚪      | ⚪       |
| property_testing  | ⚪       | ❌     | ✅      | ✅  | ✅      | ✅       |
| e2e               | ❌       | ❌     | ❌      | ❌  | ✅      | ⚪       |
| mocking           | ⚪       | ❌     | ⚪      | ✅  | ✅      | ✅       |
| snapshot          | ⚪       | ❌     | ⚪      | ⚪  | ⚪      | ⚪       |
| cli_parsing       | ✅       | ✅     | ❌      | ❌  | ❌      | ❌       |
| env_parsing       | ⚪       | ⚪     | ❌      | ✅  | ✅      | ✅       |
| id_generation     | ⚪       | ❌     | ⚪      | ✅  | ✅      | ✅       |

Skip les dimensions `❌` → valeur `not-applicable` dans LIBS_EVAL.yaml.
Évaluer les dimensions `⚪` uniquement si un signal clair ou un besoin explicite.
Évaluer systématiquement les dimensions `✅`.
