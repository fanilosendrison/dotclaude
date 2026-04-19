# Signals — Cartographie manifeste / import → lib détectée

Signaux par dimension. Priorité : import dans le code > déclaration manifeste > lockfile.

## Schema Validation

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → deps `zod` | zod | high |
| Import `from 'zod'` | zod | high |
| `package.json` → deps `valibot` | valibot | high |
| `package.json` → deps `arktype` | arktype | high |
| `package.json` → deps `yup` | yup | high |
| `package.json` → deps `joi` | joi | high |
| Import `from 'pydantic'` | pydantic | high |
| `pyproject.toml` → `pydantic` | pydantic | high |

## ORM / Migrations

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `prisma/schema.prisma` | prisma + prisma-migrate | high |
| `package.json` → `@prisma/client` | prisma | high |
| `drizzle.config.*` | drizzle + drizzle-kit | high |
| `package.json` → `drizzle-orm` | drizzle | high |
| `package.json` → `kysely` | kysely | high |
| `package.json` → `typeorm` | typeorm | high |
| `pyproject.toml` → `sqlalchemy` | sqlalchemy | high |
| `alembic.ini` ou `alembic/` | alembic | high |
| `pyproject.toml` → `alembic` | alembic | high |

## HTTP Client

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `axios` | axios | high |
| `package.json` → `ky` | ky | high |
| `package.json` → `got` | got | high |
| `fetch(` sans autre client | fetch-native | medium |
| `pyproject.toml` → `httpx` | httpx | high |
| `pyproject.toml` → `requests` | requests | high |

## HTTP Server

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `hono` | hono | high |
| `package.json` → `elysia` | elysia | high |
| `package.json` → `express` | express | high |
| `package.json` → `fastify` | fastify | high |
| `pyproject.toml` → `fastapi` | fastapi | high |
| `pyproject.toml` → `flask` | flask | high |
| `go.mod` → `github.com/gin-gonic/gin` | gin | high |

## WebSocket

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `ws` | ws-lib | high |
| `package.json` → `socket.io` | socket-io | high |
| `Bun.serve` → `websocket:` | native-ws | high |

## GraphQL

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `@apollo/*` | apollo | high |
| `package.json` → `urql` | urql | high |
| `package.json` → `graphql-yoga` | graphql-yoga | high |
| `pyproject.toml` → `strawberry-graphql` | strawberry | high |

## Auth

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `better-auth` | better-auth | high |
| `package.json` → `lucia` | lucia | high |
| `package.json` → `next-auth` ou `@auth/*` | auth-js | high |
| `package.json` → `@clerk/*` | clerk | high |
| `package.json` → `@supabase/auth-*` | supabase-auth | high |
| `pyproject.toml` → `authlib` | authlib | high |

## Date

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `date-fns` | date-fns | high |
| `package.json` → `dayjs` | dayjs | high |
| `package.json` → `luxon` | luxon | high |
| `package.json` → `@js-temporal/polyfill` | temporal-polyfill | high |
| `pyproject.toml` → `arrow` | arrow | high |

## i18n

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `i18next` | i18next | high |
| `package.json` → `@formatjs/*` ou `react-intl` | formatjs | high |
| `package.json` → `@lingui/*` | lingui | high |

## Queue

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `bullmq` | bullmq | high |
| `package.json` → `inngest` | inngest | high |
| `package.json` → `@trigger.dev/*` | trigger-dev | high |
| `pyproject.toml` → `celery` | celery | high |
| `pyproject.toml` → `rq` | rq | high |

## Cache

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `ioredis` ou `redis` | redis-client | high |
| `package.json` → `unstorage` | unstorage | high |
| `package.json` → `keyv` | keyv | high |

## UI Framework

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `react` | react | high |
| `package.json` → `vue` | vue | high |
| `package.json` → `svelte` | svelte | high |
| `package.json` → `solid-js` | solid | high |
| `package.json` → `htmx.org` | htmx | high |

## Styling

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `tailwind.config.*`, `package.json` → `tailwindcss` | tailwind | high |
| Import `styled` from `styled-components` | styled-components | high |
| `package.json` → `@vanilla-extract/*` | vanilla-extract | high |
| `package.json` → `unocss` | unocss | high |
| `*.module.css` files | css-modules | medium |

## Component Lib

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `components/ui/` contenant shadcn components | shadcn | high |
| `package.json` → `@radix-ui/*` (sans shadcn) | radix | high |
| `package.json` → `@mantine/*` | mantine | high |
| `package.json` → `@chakra-ui/*` | chakra | high |
| `package.json` → `@headlessui/*` | headless-ui | high |

## State

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `zustand` | zustand | high |
| `package.json` → `jotai` | jotai | high |
| `package.json` → `@reduxjs/toolkit` | redux-toolkit | high |
| `package.json` → `@tanstack/react-query` ou `@tanstack/query-*` | tanstack-query | high |

## Router

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `@tanstack/react-router` | tanstack-router | high |
| `package.json` → `react-router-dom` | react-router | high |
| `app/` ou `pages/` + `next` | next-router | high |
| `package.json` → `wouter` | wouter | high |

## Forms

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `react-hook-form` | react-hook-form | high |
| `package.json` → `@tanstack/react-form` | tanstack-form | high |
| `package.json` → `formik` | formik | high |

## Logging

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `pino` | pino | high |
| `package.json` → `consola` | consola | high |
| `package.json` → `winston` | winston | high |
| `pyproject.toml` → `structlog` | structlog | high |
| `pyproject.toml` → `loguru` | loguru | high |
| `go.mod` → `log/slog` (stdlib) | slog | medium |
| `go.mod` → `go.uber.org/zap` | zap | high |
| `Cargo.toml` → `tracing` | tracing | high |

## Tracing

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `@opentelemetry/*` | opentelemetry | high |
| `package.json` → `@sentry/*` | sentry | high |
| `package.json` → `dd-trace` | datadog | high |
| `pyproject.toml` → `opentelemetry-*` | opentelemetry | high |

## Metrics

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `prom-client` | prom-client | high |
| `pyproject.toml` → `prometheus-client` | prom-client | high |

## Property Testing

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `fast-check` | fast-check | high |
| `pyproject.toml` → `hypothesis` | hypothesis | high |
| `Cargo.toml` → `proptest` | proptest | high |
| `Cargo.toml` → `quickcheck` | quickcheck | high |
| `go.mod` → `pgregory.net/rapid` | rapid | high |
| `go.mod` → `github.com/leanovate/gopter` | gopter | high |

## E2E

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `playwright.config.*` | playwright | high |
| `package.json` → `@playwright/test` | playwright | high |
| `cypress.config.*` | cypress | high |
| `package.json` → `puppeteer` | puppeteer | high |

## Mocking

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `msw` | msw | high |
| `package.json` → `nock` | nock | high |
| Import `vi.mock` depuis vitest | vitest-mock | high |

## Snapshot

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `__snapshots__/` folder | native / jest-snapshot | high |
| `Cargo.toml` → `insta` | insta | high |

## CLI Parsing

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `commander` | commander | high |
| `package.json` → `yargs` | yargs | high |
| `package.json` → `clipanion` | clipanion | high |
| `pyproject.toml` → `click` | click | high |
| `pyproject.toml` → `typer` | typer | high |
| `go.mod` → `github.com/spf13/cobra` | cobra | high |

## Env Parsing

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `dotenv` | dotenv | high |
| `package.json` → `env-schema` | env-schema | high |
| `pyproject.toml` → `pydantic-settings` | pydantic-settings | high |
| `go.mod` → `github.com/spf13/viper` | viper | high |

## ID Generation

| Signal | Valeur | Confiance |
|--------|--------|-----------|
| `package.json` → `nanoid` | nanoid | high |
| `package.json` → `uuid` | uuid | high |
| `package.json` → `ulid` ou `ulidx` | ulid | high |
| `package.json` → `@paralleldrive/cuid2` | cuid2 | high |
| Usage de `crypto.randomUUID()` seul | native | medium |
