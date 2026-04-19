---
name: commit-setup
version: "0.1.0"
description: "Commit all setup artifacts produced by steps 01-08"
allowed_tools:
  - Bash
  - Read
  - Glob
inputs: []
outputs:
  - name: commit_hash
    description: "Hash of the setup commit (if created)"
parameters:
  flags:
    - "--dry-run"
---

# Step 09 — Commit Setup

Commiter tous les artefacts produits par les steps précédents.

## Skip conditions

- **`--dry-run`** : skip entièrement (aucune écriture = rien à commiter). Afficher : `Commit: skip (--dry-run)`

## Execution

Invoquer `/git-commits-push` pour générer le message de commit.

### Séquence

1. `git status` pour lister les fichiers créés/modifiés
2. Stage uniquement les artefacts du setup — ne pas inclure de fichiers pré-existants non liés au setup

**Artefacts typiques à stager** :
- `.gitignore` (si modifié — notamment les entrées `STACK_EVAL.yaml`, `LIBS_EVAL.yaml`, `CLAUDE.md` ajoutées par les steps précédents)
- `SPEC_MANIFEST.md`, `PROJECT_INDEX.md`, `.index-state.json`
- `.python-version` (si Python)
- `src/<package>/__init__.py`, `tests/__init__.py` (si scaffoldé)
- `.env.example` (si créé — jamais `.env` lui-même)
- `README.md`
- Lockfiles (`uv.lock`, `poetry.lock`, `bun.lockb`, `package-lock.json`, etc.)

**Ne PAS stager** :
- `STACK_EVAL.yaml`, `LIBS_EVAL.yaml`, `CLAUDE.md` (artefacts locaux — dans `.gitignore` via steps 03, 04, 06)
- `.env` (secrets)
- `.venv/` (doit être dans `.gitignore`)
- `node_modules/` (doit être dans `.gitignore`)
- Fichiers non liés au setup

3. Invoquer `/git-commits-push` — le type attendu est `chore`, scope `setup` :
   ```
   chore(setup): onboard project for Claude Code
   ```
4. Push automatique (comportement par défaut de `/git-commits-push`)

## Si aucun changement

Si toutes les étapes ont skip parce que les artefacts étaient frais → skip silencieusement. Afficher : `Commit: skip (rien à commiter)`

## Recap final

Après le commit (ou skip), afficher le tableau récapitulatif complet :

```
| Etape         | Statut                              | Artefact                              |
|---------------|-------------------------------------|---------------------------------------|
| Prerequisites | OK / MISSING: <tool>                | —                                     |
| Git           | ALL GOOD / N actions                | .gitignore, remote                    |
| Index         | OK / skip (frais) / skip (--light)  | SPEC_MANIFEST.md, PROJECT_INDEX.md    |
| Stack         | OK / skip (existant)                | STACK_EVAL.yaml                       |
| Libs          | OK / skip (existant)                | LIBS_EVAL.yaml                        |
| CLAUDE.md     | OK / skip (existant)                | CLAUDE.md                             |
| Environnement | venv / conda / direct / skip        | .venv, deps, .env                     |
| Validation    | OK / ECHEC: <detail>                | —                                     |
| README        | OK / skip (--light)                 | README.md                             |
| Commit        | OK / skip (rien) / skip (--dry-run) | <commit hash>                         |
```

Si toutes les étapes critiques ont réussi et la validation est passée → afficher : **"Projet prêt pour Claude Code."**

Sinon → lister les étapes en échec et les actions recommandées.

## Si échec

**Informer** — si le commit échoue, les artefacts sont déjà sur disque. Pas bloquant. L'utilisateur peut commiter manuellement.
