# Python Venv Setup for Claude Code

Setup a local Python virtual environment so Claude Code runs all commands in isolation.

## Prerequisites

- `decisions.containerization: NO-DOCKER` in STACK_EVAL.yaml
- `decisions.isolation: VENV` in STACK_EVAL.yaml
- `decisions.language: python`

## Doc-only project — scaffold package first

If the project has no source code yet (only `specs/`, `docs/`, configs), the build backend will fail because there's no Python package to install. **Create the package skeleton BEFORE running the install command.**

If `pyproject.toml` doesn't exist yet, create it. **Build backend values — never guess, use these exact strings:**

| Backend | `build-backend` value |
|---|---|
| hatchling | `hatchling.build` |
| setuptools | `setuptools.build_meta` |
| flit | `flit_core.buildapi` |
| pdm | `pdm.backend` |

Then scaffold the package:

1. Read `[project].name` from `pyproject.toml` → derive `package_name` (replace `-` with `_`)
2. Create `src/<package_name>/__init__.py` with a minimal docstring
3. Create `tests/__init__.py` (empty)
4. If build backend is `hatchling` → ensure `[tool.hatch.build.targets.wheel].packages = ["src/<package_name>"]` exists in `pyproject.toml`
5. If build backend is `setuptools` → ensure `[tool.setuptools.packages.find].where = ["src"]` exists

**Detection**: `src/` directory does not exist, or no `__init__.py` found in `src/`.
**Skip**: if `src/` already contains Python files.

## Pin Python version

**AVANT de créer le venv**, écrire un fichier `.python-version` à la racine du projet. Ce fichier est le signal de référence pour `uv`, `pyenv`, et les autres outils.

1. Lire `decisions.runtime.version` dans `STACK_EVAL.yaml` (ex: `"3.13"`)
2. Créer `.python-version` avec cette valeur (une ligne, pas de newline trailing)
3. S'assurer que `.python-version` n'est **pas** dans `.gitignore` — il doit être versionné (c'est un choix d'équipe, pas un artefact local)

**Pourquoi** : `uv venv` sans `--python` prend la version la plus récente disponible sur la machine, ce qui peut diverger de la version évaluée. `.python-version` résout ce problème à la source — `uv` le lit automatiquement.

## Setup by package manager

### pip

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -r requirements-dev.txt  # if exists
```

### poetry

```bash
poetry config virtualenvs.in-project true  # .venv in project root
poetry install                              # creates .venv + installs all deps
```

### uv

```bash
uv venv .venv --python $(cat .python-version)   # force la version évaluée
uv sync                                          # installs from uv.lock
```

**Note** : si `.python-version` existe, `uv venv .venv` (sans `--python`) le respecte automatiquement. Le flag explicite est un filet de sécurité.

## Post-setup checks

1. Verify `.venv/` is in `.gitignore` (should already be from git-preflight)
2. Verify Python version: `.venv/bin/python --version`
3. Verify deps installed: `.venv/bin/pip list | head -20`

## Verify CLAUDE.md commands

Relire la section "Commandes de vérification" dans CLAUDE.md. Le préfixe dépend du package manager :

| package_manager | Préfixe | Exemple |
|---|---|---|
| `uv` | `uv run <cmd>` | `uv run pytest tests/ -v` |
| `poetry` | `poetry run <cmd>` | `poetry run pytest tests/ -v` |
| `pip` | `.venv/bin/<cmd>` | `.venv/bin/pytest tests/ -v` |

Les trois formes évitent la dépendance au shell state (`source activate`).

Si `claude-md-creator` a généré les commandes correctement → rien à faire. Sinon → corriger.

## Startup validation

After setup, verify with the prefix matching the package manager (see table above).

**Ces 4 commandes sont indépendantes — les lancer en parallèle** (multiple Bash tool calls dans un seul message) :

- `<prefix> python --version` — verify Python version matches `.python-version`
- `<prefix> pytest --version` — verify test runner
- `<prefix> ruff --version` — verify linter
- `<prefix> pyright --version` — verify type checker (si dans les deps)

Puis, séparément (dépend des outils ci-dessus) :

- `<prefix> pytest tests/ -v` — run tests

**Skip le `pytest tests/ -v`** si `tests/` ne contient que des `__init__.py` (projet neuf sans tests). `pytest --version` suffit à valider l'installation. Lancer pytest sans tests = exit code 5 ("no tests collected") qui affiche une fausse erreur.

If any step fails, diagnose and fix before proceeding.
