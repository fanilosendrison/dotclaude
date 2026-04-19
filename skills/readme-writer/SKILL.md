---
name: readme-writer
description: "Create a minimal, actionable README.md for a project. Focus on getting started fast: clone, install, run. Use when git-preflight reports `readme-create`, when the user says 'crée un README', 'write a README', 'README manquant', 'ajoute un README', or when initializing a new project that has no README.md."
---

# README Writer

Generate a minimal README that answers one question: **how do I run this project?**

## Process

1. **Detect the project stack** — scan for: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `Makefile`, `docker-compose.yml`, `Dockerfile`, `compose.yaml`, etc.
2. **Detect the repo URL** — `git remote get-url origin` (fallback: `<repo-url>`)
3. **Write the README** following the template below

## Template

```markdown
# <Project Name>

<One-liner description — what the project does. If unclear, omit.>

## Getting Started

### Prerequisites

- <runtime + version, e.g. Node >= 20, Python >= 3.11, Rust >= 1.75>
- <package manager if non-default, e.g. pnpm, bun, uv>

### Option 1 — Container _(if applicable)_

\```bash
git clone <repo-url>
cd <project-name>
<orchestration command>       # e.g. docker compose up
\```

### Option 2 — Local

\```bash
git clone <repo-url>
cd <project-name>
<install command>             # e.g. npm install, pip install -e ., cargo build
<test command>                # e.g. npm test, pytest, cargo test
<run command>                 # e.g. npm run dev, python main.py, cargo run
\```
```

## Rules

- **Container section**: include ONLY if `docker-compose.yml`, `compose.yaml`, or `Dockerfile` exists. Otherwise skip entirely (no "Option 1 / Option 2" numbering — just a single "Getting Started" block).
- **Prerequisites**: list only what's needed to install and run. Skip if obvious from the ecosystem (e.g. don't list "npm" for a Node project).
- **Commands must be real** — read `package.json` scripts, `Makefile` targets, `Cargo.toml`, etc. Never guess.
- **One-liner description**: include only if the project's purpose is clear from config files or existing docs. Don't invent.
- **No badges, no license section, no contributing guide, no table of contents.** Keep it minimal.
- **Test command**: always include if a test runner is configured.
- **Run command**: include the primary way to start/use the project (dev server, CLI entry point, etc.). Omit if the project is a library with no runnable entry point.
