# Conda Setup for Claude Code

Setup a conda environment so Claude Code runs all commands in isolation.

## Prerequisites

- `decisions.containerization: NO-DOCKER` in STACK_EVAL.yaml
- `decisions.isolation: CONDA` in STACK_EVAL.yaml
- `decisions.language: python`
- `conda` or `mamba` installed on the host

## When to use conda over venv

Conda is preferred when the project has:
- C/Fortran compiled dependencies (numpy, scipy, scikit-learn with MKL)
- CUDA/GPU dependencies (pytorch, tensorflow)
- Non-Python dependencies managed via conda (R, Julia bindings)
- An `environment.yml` file already present

## Setup

### From environment.yml (preferred)

```bash
conda env create -f environment.yml    # creates env with name from yml
conda activate <env-name>              # activate to verify
```

### From scratch

```bash
conda create -n <project-name> python=<version> -y
conda activate <project-name>
pip install -r requirements.txt         # install Python deps
pip install -r requirements-dev.txt     # if exists
```

### With mamba (faster)

```bash
mamba env create -f environment.yml
# or
mamba create -n <project-name> python=<version> -y
```

## Claude Code command prefix

Claude Code ne peut pas `conda activate` (pas de shell interactif). Utiliser `conda run` :

```bash
conda run -n <env-name> --no-capture-output pytest tests/ -v
conda run -n <env-name> --no-capture-output ruff check src/
conda run -n <env-name> --no-capture-output mypy src/
```

`--no-capture-output` est nécessaire pour voir le output en temps réel.

## Post-setup checks

1. Verify env exists: `conda env list | grep <env-name>`
2. Verify Python version: `conda run -n <env-name> python --version`
3. Verify deps installed: `conda run -n <env-name> pip list | head -20`

## Verify CLAUDE.md commands

Relire la section "Commandes de vérification" dans CLAUDE.md. Les commandes doivent utiliser le préfixe `conda run -n <env-name> --no-capture-output` :

```bash
conda run -n <env-name> --no-capture-output pytest tests/ -v
conda run -n <env-name> --no-capture-output ruff check src/
conda run -n <env-name> --no-capture-output mypy src/
```

Si `claude-md-creator` a généré les commandes correctement → rien à faire. Sinon → corriger.

## Startup validation

After setup:

1. `conda env list | grep <env-name>` — verify env exists
2. `conda run -n <env-name> python --version` — verify Python version
3. `conda run -n <env-name> pytest --version` — verify test runner
4. `conda run -n <env-name> pytest tests/ -v` — run tests

If any step fails, diagnose and fix before proceeding.

## .gitignore

Conda environments are external (stored in `~/miniconda3/envs/` or `~/anaconda3/envs/`), so no `.venv/` to gitignore. But verify that `environment.yml` is tracked (it should be — it's the equivalent of `requirements.txt`).
