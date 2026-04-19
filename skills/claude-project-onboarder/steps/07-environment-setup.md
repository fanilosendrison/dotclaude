---
name: environment-setup
version: "0.1.0"
description: "Configure execution environment (venv/conda/direct), install dependencies, setup .env, validate startup"
allowed_tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
inputs:
  - name: stack_eval
    path: STACK_EVAL.yaml
    required: true
    description: "STACK_EVAL.yaml from step 03 — provides isolation, package_manager, language, runtime"
  - name: libs_eval
    path: LIBS_EVAL.yaml
    required: false
    description: "LIBS_EVAL.yaml from step 04 (optional) — provides list of application libs to install with exact package names and dev/runtime classification"
  - name: claude_md
    path: CLAUDE.md
    required: false
    description: "CLAUDE.md from step 06 (optional — skip command verification if absent)"
outputs:
  - name: environment_type
    description: "Type of environment configured: venv, conda, or direct"
  - name: validation_status
    description: "OK or FAIL with details"
parameters:
  flags:
    - "--dry-run"
---

# Step 07 — Environment Setup

Configurer l'environnement d'exécution, installer les dépendances, et valider que tout fonctionne.

## Pré-requis

Lire `STACK_EVAL.yaml` à la racine du projet pour déterminer la configuration :
- `decisions.containerization` (toujours `NO-DOCKER` — Docker interdit par le CLAUDE.md global)
- `decisions.isolation` : `VENV`, `CONDA`, `NONE`
- `decisions.package_manager` : `uv`, `poetry`, `pip`, `bun`, `npm`, `yarn`, `pnpm`, `cargo`, `go modules`
- `decisions.language` : langage principal
- `decisions.runtime.version` : version du runtime

## References

Les guides détaillés par type d'environnement sont dans `~/.claude/skills/claude-project-onboarder/references/` :

| isolation / containerization | Reference |
|---|---|
| `VENV` | `references/venv-setup.md` |
| `CONDA` | `references/conda-setup.md` |
| `DOCKER` | `references/docker-setup.md` |
| `DEVCONTAINER` | `references/devcontainer-setup.md` |

## Sub-steps

### 7a. Charger la reference

1. Lire `decisions.isolation` et `decisions.containerization` dans `STACK_EVAL.yaml`
2. Lire le fichier reference correspondant (voir table ci-dessus)
3. Suivre les instructions de la reference pour les sub-steps suivants

Si `isolation: NONE` (Node/Bun, Go, Rust) → pas de reference à charger, passer à 7b directement.
Si `isolation: NIX` → informer : setup Nix non automatisé, step manuelle. Vérifier que `shell.nix` ou `flake.nix` existe.

**Projet existant avec setup partiel** : si `.venv/`, `environment.yml/`, ou lockfile existe déjà, **ne pas écraser** et adapter (default). Informer l'utilisateur du choix pris. Ne jamais demander de confirmation.



### 7b. Setup environment + install deps

Suivre les sections "Setup" et "Post-setup checks" de la reference chargée en 7a.

La reference couvre : pin Python version, scaffold package si nécessaire, commandes d'install par package manager, et vérifications post-install.



### 7b-bis. Installer les libs applicatives depuis LIBS_EVAL.yaml

**Skip** si `LIBS_EVAL.yaml` n'existe pas (step 04 a échoué ou a été sauté).

1. **Lire `LIBS_EVAL.yaml`** et vérifier `schema_version`.
   - `schema_version: 2` (ou absent mais structure `decisions.<cap>: { choice, package, ... }`) → continuer.
   - Format v1 détecté (valeurs scalaires style `schema_validation: zod`) → **warn** : "LIBS_EVAL.yaml en format v1 sans packages résolus. Re-run `/libs-evaluator --force` pour bénéficier de l'install automatique des libs." → skip ce sub-step.

2. **Extraire les libs à installer** :
   - Itérer sur `decisions.<capability>`.
   - Skip si `choice ∈ {none, not-applicable, native, fetch-native, raw-sql, context-only}` ou `package == null`.
   - Retenir `{ capability, choice, package, dev }`.

3. **Diff vs manifest actuel** :
   - Lire le manifest selon `decisions.package_manager` de STACK_EVAL :
     - `bun`/`npm`/`pnpm`/`yarn` → `package.json` (sections `dependencies` + `devDependencies`)
     - `uv`/`poetry`/`pip` → `pyproject.toml` (project.dependencies + dependency-groups.dev ou tool.poetry.*)
     - `cargo` → `Cargo.toml` (`[dependencies]` + `[dev-dependencies]`)
     - `go modules` → `go.mod`
   - Pour chaque lib retenue : déjà présente dans le manifest ? → **skip + warn** si la version diffère (pas d'upgrade silencieux), **skip** si version identique.
   - Sinon → à installer.

4. **Afficher l'install à l'utilisateur (info, PAS une question)** :
   ```
   Libs applicatives à installer (depuis LIBS_EVAL.yaml) :

   Runtime :
     - zod              (capability: schema_validation)
     - drizzle-orm      (capability: orm)
     - hono             (capability: http_server)
   Dev :
     - drizzle-kit      (capability: migrations)
     - @playwright/test (capability: e2e)

   Commande : bun add zod drizzle-orm hono && bun add -d drizzle-kit @playwright/test
   ```
   **Ne jamais demander "Installer maintenant ?"** — enchaîner directement sur l'exécution.

5. **Exécuter immédiatement, sans confirmation** :
   - Grouper runtime puis dev en deux commandes distinctes.
   - Mapping package manager → commande :
     - `bun` : `bun add <pkgs>` / `bun add -d <pkgs>`
     - `npm` : `npm install <pkgs>` / `npm install -D <pkgs>`
     - `pnpm` : `pnpm add <pkgs>` / `pnpm add -D <pkgs>`
     - `yarn` : `yarn add <pkgs>` / `yarn add -D <pkgs>`
     - `uv` : `uv add <pkgs>` / `uv add --dev <pkgs>`
     - `poetry` : `poetry add <pkgs>` / `poetry add --group dev <pkgs>`
     - `pip` : `pip install <pkgs>` (+ ajouter à `requirements.txt` / `requirements-dev.txt` manuellement)
     - `cargo` : `cargo add <pkgs>` / `cargo add --dev <pkgs>`
     - `go` : `go get <pkgs>`

6. **En cas d'échec d'install** : diagnostiquer (package introuvable, conflit de version, réseau), informer, proposer un fix. Ne pas marquer le step comme terminé si une lib runtime n'a pas pu être installée.

7. **Package non résolu** (`package: null` avec `source: unresolved` dans LIBS_EVAL.yaml) : afficher à l'utilisateur la liste des capabilities sans package résolu. Suggérer une résolution manuelle ou re-run `/libs-evaluator --force`.



### 7c. Setup .env

Si `.env.example` existe et `.env` n'existe pas :
1. Copier `.env.example` → `.env`
2. Informer : "`.env` créé depuis `.env.example`. Vérifie et remplis les valeurs manquantes."
3. Ne **jamais** inventer de valeurs pour les secrets

Si `.env.example` n'existe pas mais `decisions.database` != `none` → suggérer la création d'un `.env.example`.



### 7d. Verify CLAUDE.md commands

Suivre la section "Verify CLAUDE.md commands" de la reference chargée en 7a.

Si incohérent → corriger CLAUDE.md.
**Skip** si CLAUDE.md n'existe pas (Step 06 a échoué).



### 7e. Startup validation

Suivre la section "Startup validation" de la reference chargée en 7a.

Pour les langages sans reference (Node/Bun, Go, Rust) :
- **Node/Bun** : `<pkg-manager> test` (si script test existe dans package.json)
- **Go** : `go test ./...`
- **Rust** : `cargo test`



## --dry-run

Afficher la configuration qui serait appliquée sans rien exécuter :
- Type d'isolation
- Package manager
- Commandes qui seraient lancées
- Artefacts qui seraient créés

## Si échec

**Informer** — diagnostiquer l'erreur, proposer un fix. Ne pas marquer le setup comme terminé si la startup validation échoue. Ne pas ignorer les erreurs.
