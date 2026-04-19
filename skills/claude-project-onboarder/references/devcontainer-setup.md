# Devcontainer Setup for Claude Code

Generate a `.devcontainer/devcontainer.json` so the project can run in VS Code Dev Containers or GitHub Codespaces.

## Prerequisites

- `decisions.containerization: NO-DOCKER` in STACK_EVAL.yaml
- `decisions.isolation: DEVCONTAINER` in STACK_EVAL.yaml

## When to use devcontainer

- Team uses VS Code and wants a reproducible dev environment
- Project targets GitHub Codespaces
- Multiple system-level dependencies that are hard to install locally
- The project already has a `.devcontainer/` directory

## Artifacts to create

### 1. .devcontainer/devcontainer.json

```jsonc
{
  "name": "<project-name>",
  "image": "<base-image>",           // or "build": { "dockerfile": "Dockerfile" }
  "features": {},                     // optional: add devcontainer features
  "forwardPorts": [],                 // ports to forward from container
  "postCreateCommand": "<install-deps-command>",
  "customizations": {
    "vscode": {
      "extensions": [],               // recommended extensions
      "settings": {}                  // workspace settings
    }
  }
}
```

**Base image by language:**

| Language | Image |
|---|---|
| TypeScript/Node | `mcr.microsoft.com/devcontainers/typescript-node:1-<version>` |
| Python | `mcr.microsoft.com/devcontainers/python:1-<version>` |
| Go | `mcr.microsoft.com/devcontainers/go:1-<version>` |
| Rust | `mcr.microsoft.com/devcontainers/rust:1` |

**postCreateCommand by package manager:**

| Package manager | Command |
|---|---|
| `bun` | `bun install` |
| `npm` | `npm ci` |
| `pip` | `pip install -r requirements.txt -r requirements-dev.txt` |
| `poetry` | `poetry install` |
| `uv` | `uv sync` |
| `cargo` | `cargo build` |

**VS Code extensions by language:**

| Language | Extensions |
|---|---|
| TypeScript | `biomejs.biome`, `ms-vscode.vscode-typescript-next` |
| Python | `ms-python.python`, `charliermarsh.ruff`, `ms-python.mypy-type-checker` |
| Go | `golang.go` |
| Rust | `rust-lang.rust-analyzer` |

### 2. .devcontainer/Dockerfile (optional)

Only create if the project needs custom system dependencies beyond what the base image provides. Otherwise, use `"image"` directly.

```dockerfile
FROM <base-image>
RUN apt-get update && apt-get install -y <system-deps> && rm -rf /var/lib/apt/lists/*
```

### 3. If database needed

Add docker-compose.yml alongside devcontainer.json:

```jsonc
{
  "name": "<project-name>",
  "dockerComposeFile": "docker-compose.yml",
  "service": "app",
  "workspaceFolder": "/workspace",
  "postCreateCommand": "<install-deps-command>"
}
```

## Claude Code specifics

Claude Code runs locally, not inside the devcontainer. The devcontainer setup is for the team's VS Code/Codespaces workflow. Claude Code commands in CLAUDE.md should use **local** prefixes (direct or `.venv/bin/`), not container-prefixed commands.

Exception: if the user explicitly runs Claude Code inside a devcontainer terminal, commands are direct (no prefix needed — the container is the environment).

## Startup validation

After creating the devcontainer config:

1. Verify `.devcontainer/devcontainer.json` is valid JSON
2. Verify the base image exists (check Microsoft container registry)
3. If the user has VS Code + Dev Containers extension → suggest "Reopen in Container" to test
4. If not → inform that the config is ready for use with VS Code or Codespaces

## .gitignore

`.devcontainer/` should be **tracked** (versioned) — it's a project configuration, not a generated artifact. Verify it's NOT in `.gitignore`.
