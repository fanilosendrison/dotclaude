# Docker Setup for Claude Code

Setup Docker so Claude Code can execute, test, and lint inside the container.

## Prerequisites

- `decisions.containerization: DOCKER` in STACK_EVAL.yaml
- Docker installed and running on the host

## Artifacts to create

### 1. Dockerfile

Multi-stage build. The `dev` stage includes ALL dev dependencies (test runner, linter, type checker).

```dockerfile
# Adapt base image to decisions.language + decisions.runtime
FROM <runtime-image> AS base
WORKDIR /app

# Dependencies first (cache layer)
COPY <manifest> <lockfile> ./
RUN <install-prod-deps>

# Dev stage — adds dev deps on top of prod
FROM base AS dev
COPY <manifest> <lockfile> ./
RUN <install-all-deps>
COPY . .

# Prod stage — clean image with prod deps only
FROM base AS prod
COPY . .
CMD ["<start-command>"]
```

**Mapping runtime → base image:**

| Runtime | Base image |
|---|---|
| `bun` | `oven/bun:latest` |
| `node` | `node:<version>-slim` |
| `cpython` | `python:<version>-slim` |
| `go` | `golang:<version>-alpine` (build) + `alpine` (runtime) |
| `rustc` | `rust:<version>-slim` (build) + `debian:slim` (runtime) |

**Python specifics** — venv inside the container:

```dockerfile
FROM python:3.12-slim AS base
WORKDIR /app
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

FROM base AS dev
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt
COPY . .

FROM base AS prod
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "-m", "<module>"]
```

If `package_manager: poetry`:

```dockerfile
RUN pip install poetry && poetry config virtualenvs.in-project true
COPY pyproject.toml poetry.lock ./
RUN poetry install          # dev: all deps
# RUN poetry install --only main  # prod: prod deps only
```

If `package_manager: uv`:

```dockerfile
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync                 # dev: all deps
# RUN uv sync --no-dev      # prod: prod deps only
```

### 2. docker-compose.yml

Dev-oriented compose file with volume mounts for live editing.

```yaml
services:
  app:
    build:
      context: .
      target: dev
    volumes:
      - .:/app
      - <deps-volume>:/app/<deps-dir>  # named volume — avoids overwrite by bind mount
    env_file:
      - .env
    ports:
      - "${PORT:-3000}:3000"  # only if web app/API
    command: <dev-command>
```

**Deps volume by ecosystem:**

| Ecosystem | Volume mount |
|---|---|
| Node/Bun | `node_modules:/app/node_modules` |
| Python (venv) | `venv:/app/.venv` |
| Go | Not needed (compiled) |
| Rust | `target:/app/target` |

If `decisions.database` is set, add the database service:

```yaml
  db:
    image: postgres:16-alpine  # adapt to decisions.database
    environment:
      POSTGRES_DB: ${DB_NAME:-app}
      POSTGRES_USER: ${DB_USER:-app}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-dev}
    volumes:
      - db_data:/var/lib/postgresql/data
    ports:
      - "${DB_PORT:-5432}:5432"

volumes:
  db_data:
```

### 3. .dockerignore

```
.git
node_modules
.venv
__pycache__
*.pyc
target
dist
build
.env
.DS_Store
STACK_EVAL.yaml
PROJECT_INDEX.md
SPEC_MANIFEST.md
.index-state.json
CLAUDE.md
```

## Verify CLAUDE.md commands

After Docker setup, relire la section "Commandes de vérification" dans CLAUDE.md. Les commandes doivent être préfixées `docker compose exec app` :

```bash
docker compose exec app <test-command>    # e.g. bun test, pytest
docker compose exec app <lint-command>    # e.g. bunx biome check src/, ruff check src/
docker compose exec app <type-command>    # e.g. tsc --noEmit, mypy src/
```

Si `claude-md-creator` a généré les commandes correctement → rien à faire. Sinon → corriger.

## Startup validation

After creating all files:

1. `docker compose build` — verify image builds (installs deps)
2. `docker compose up -d` — start services
3. `docker compose exec app <test-command>` — verify tests run
4. `docker compose exec app <lint-command>` — verify linter runs

If any step fails, diagnose and fix before proceeding.
