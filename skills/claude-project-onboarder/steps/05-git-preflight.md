---
name: git-preflight
version: "0.1.0"
description: "Initialize git repo and GitHub remote via git-preflight.sh"
allowed_tools:
  - Bash
  - Read
  - Write
inputs:
  - name: stack_eval
    path: STACK_EVAL.yaml
    required: true
    description: "STACK_EVAL.yaml from step 03 — provides decisions.language and decisions.runtime for .gitignore generation"
outputs:
  - name: git_status
    description: "stdout du script — lignes OK:/NEED:/WARN:/INFO: par check, plus ligne finale STATUS: ALL GOOD ou STATUS: NEEDS SETUP suivie de la liste des action identifiers kebab-case (ex: git-init, branch-main, gitignore-create, gitattributes-create, gitignore-secrets, initial-commit, gh-create, branch-protection, gitleaks-install, gitleaks-hook, cliff-install, cliff-init, readme-create, gitmessage-create, gitmessage-config)"
parameters:
  flags: []
---

# Step 05 — Git Preflight

Initialiser le repo git et configurer le remote GitHub.

## Execution

Lancer le diagnostic :

```bash
bash ~/.claude/scripts/git-preflight/git-preflight.sh "$PWD"
```

## Comportement

### `STATUS: ALL GOOD`

Tout est en place → continuer au Step 06. Afficher : `Git: ALL GOOD`

### `STATUS: NEEDS SETUP`

Exécuter les actions listées dans l'ordre prescrit par le script. Séquence complète possible (le script n'émet que les actions nécessaires — skip celles déjà faites) :

1. `git-init` — `git init`
2. `branch-main` — `git branch -m main`
3. `gitignore-create` / `gitignore-enrich` — créer ou compléter `.gitignore` basé sur `decisions.language` et `decisions.runtime` dans `STACK_EVAL.yaml`
4. `gitattributes-create` — créer `.gitattributes` depuis le template (normalisation LF)
5. `gitignore-secrets` — ajouter les fichiers sensibles détectés au `.gitignore`
6. `initial-commit` — `git add . && git commit -m "Initial commit"`
7. `gh-create` — `gh repo create <nom-dossier> --private --source=. --push`
8. `branch-protection` — activer la protection sur `main` via `gh api` (voir `~/.claude/scripts/git-preflight/CLAUDE.md` pour la commande exacte)
9. `gitleaks-install` / `gitleaks-hook` — installer gitleaks + hook pre-commit
10. `cliff-install` / `cliff-init` — installer git-cliff + générer `cliff.toml`
11. `readme-create` — invoquer le skill `readme-writer`
12. `gitmessage-create` / `gitmessage-config` — créer `.gitmessage` et le configurer comme template local (optionnel)

**Important** : suivre exactement les action identifiers émis par le script, pas cette séquence type. Le script est la source de vérité et skippe les actions déjà faites.

### `--dry-run`

Lancer le diagnostic mais ne pas exécuter les actions. Afficher le résultat du script et les actions qui seraient nécessaires.

## Pré-requis fichier

Lire `STACK_EVAL.yaml` avant d'exécuter le script. Il fournit `decisions.language` et `decisions.runtime` → le `.gitignore` est basé sur des données fiables, pas sur une détection heuristique.

**Mode skill** (`is_skill: true`) : `STACK_EVAL.yaml` n'existe pas car le step 03 (`03-stack-evaluate.md`) est skippé en mode skill. Tester l'existence du fichier avant lecture. Le `.gitignore` existe déjà dans les skills → pas besoin de le générer. Si `git-preflight.sh` demande de créer un `.gitignore` (`gitignore-create`), utiliser le template de base sans détection de stack.

## Si échec

**Abort** — git est fondamental pour la suite. Si `gh auth` échoue, guider l'utilisateur vers `gh auth login`.
