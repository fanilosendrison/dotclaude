# Compatibility Matrix — Stack → libs compatibles

Filtres **durs** (language, runtime) + **indications** de compatibilité entre stack et libs. Les valeurs utilisées ici sont celles de l'enum fermé de `dimensions.md`.

**Filtres durs à respecter systématiquement** : `language` (une lib Python ne va pas avec TS et vice-versa) et `runtime` (libs Node-only vs Bun-only vs Edge). Appliqués sur les candidates de l'enum avant sélection.

## Filtres par `decisions.language`

### language = typescript | javascript

**Compatible** : toutes les libs TS/JS (zod, drizzle, hono, react, etc.)
**Incompatible** : pydantic, sqlalchemy, fastapi, httpx, flask, click, typer, celery, rq, loguru, structlog, authlib (libs Python)

### language = python

**Compatible** : pydantic, sqlalchemy, fastapi, httpx, flask, click, typer, celery, rq, loguru, structlog, authlib
**Incompatible** : zod, valibot, prisma, drizzle, hono, elysia, react, vue, pino, better-auth, nanoid (libs TS)

### language = go

**Compatible** : gin, viper, cobra, rapid, gopter, slog, zap, opentelemetry-go
**Incompatible** : toutes les libs TS et Python

### language = rust

**Compatible** : tracing, proptest, quickcheck, insta, axum, actix-web
**Incompatible** : toutes les libs TS et Python

---

## Filtres par `decisions.runtime`

### runtime = bun

**Privilégier** : hono (multi-runtime, optimisé Bun), elysia (Bun-native), drizzle (edge-ready), native-ws (Bun natif), fetch-native
**Éviter** : winston (Node legacy), express (compat OK mais pas idiomatique), got (Node streams spécifiques)

### runtime = node

**Compatible** : tout le TS incluant express, fastify, got, ws, socket.io
**À vérifier** : elysia (Bun-first, compat Node partielle)

### runtime = deno

**Privilégier** : libs edge-compatibles, hono
**Incompatible** : libs avec bindings natifs Node non portés (node-sass, sharp vieilles versions)

### runtime = cloudflare-workers / edge

**Privilégier** : hono, drizzle, valibot, fetch-native, jose (JWT edge-safe)
**Incompatible** : prisma (query engine binaire), express, toute lib utilisant `fs`/`net`/`child_process`, bullmq (nécessite Redis persistant côté serveur classique)

### runtime = cpython

**Compatible** : tout le Python. Préférer les libs async (httpx, asyncpg, sqlalchemy 2.0 async, fastapi) pour les projets API modernes.

---

## Filtres par `decisions.framework`

### framework = next

**Impose ou pousse** : react, next-router (imposé), auth-js (écosystème natif), tanstack-query (convention)
**Incompatible** : vue, svelte, solid (autre framework UI), tanstack-router, react-router (next a son router)

### framework = hono | elysia | fastify | express

**Compatible** : toutes libs backend TS. UI skippée (API pure).

### framework = fastapi

**Impose ou pousse** : pydantic (imposé), sqlalchemy, httpx, pytest
**Compatible** : structlog, loguru, celery, rq

### framework = django

**Impose** : Django ORM (pas de drizzle/prisma), Django templates ou DRF pour API
**Compatible** : celery, pydantic (via ninja)

### framework = sveltekit / nuxt / remix / astro

**Impose** : UI framework correspondant (svelte/vue/react), router natif du framework
**Skip** : router, parfois state manager (conventions du framework)

---

## Filtres par `decisions.database`

### database = postgres

**Compatible** : prisma, drizzle, kysely, sqlalchemy, raw-sql (pg, postgres.js, asyncpg)
**Incompatible** : better-sqlite3, sql.js, mongoose

### database = sqlite

**Compatible** : prisma (provider sqlite), drizzle, better-sqlite3, sql.js, sqlalchemy
**Incompatible** : mongoose, pymongo

### database = mongo

**Compatible** : mongoose, mongodb driver, pymongo, motor
**Incompatible** : prisma (support partiel, non recommandé), drizzle, kysely, sqlalchemy (sauf via sqlalchemy-mongodb, rare)

### database = redis

**Cohérent avec** : redis-client (ioredis, redis-py), bullmq (nécessite Redis), rq (nécessite Redis)
**Redis seul rarement suffisant** : souvent en complément d'une DB primaire.

### database = supabase

**Impose ou pousse** : supabase-auth, `@supabase/supabase-js`, postgres-compatible tools (drizzle OK, prisma OK)

### database = none

**Skip** : orm, migrations, cache (sauf besoin spécifique)

---

## Filtres par `decisions.containerization` / `deploy_target`

### deploy_target = cloudflare-workers | vercel (edge)

**Privilégier** : libs edge-ready (taille bundle < 1 MB, pas de binaires natifs)
**Incompatible** : prisma (sauf data proxy), libs avec `node:fs` / `node:net`, bullmq, celery

### deploy_target = vercel (serverless Node)

**Compatible** : la plupart des libs Node, avec cold start à considérer pour libs lourdes

### deploy_target = fly | railway | vps

**Compatible** : tout (environnement Node/Python classique)

---

## Conflits communs à signaler

| Situation | Conflit | Résolution |
|-----------|---------|------------|
| deploy_target = edge + orm = prisma | Prisma query engine ne tourne pas nativement en edge | Prisma Data Proxy, OU passer à drizzle |
| runtime = bun + orm = prisma | Compat partielle (s'améliore) | Préférer drizzle sur Bun 2026 |
| framework = next + state = redux-toolkit | Pas bloquant mais overkill | Préférer zustand + tanstack-query |
| runtime = edge + auth = lucia | Lucia v3+ OK edge, vérifier adapter | Confirmer adapter DB edge-compatible |
| database = sqlite + migrations = flyway | Flyway pour JVM, rare pour sqlite JS | Utiliser drizzle-kit ou prisma-migrate |

---

## Procédure d'application

1. Pour chaque dimension du step 3 de SKILL.md :
   - Récupérer la liste complète des valeurs depuis `dimensions.md`
   - Appliquer les filtres ci-dessus selon STACK_EVAL.yaml
   - Retenir uniquement les candidates survivantes
2. Parmi les candidates, appliquer les règles "quand choisir" de `dimensions.md` (ordre descendant, défaut en dernier)
3. Si le filtre laisse **zéro candidate** → signaler comme incohérence de stack ou dimension `not-applicable`. Ne pas inventer une lib hors enum.
