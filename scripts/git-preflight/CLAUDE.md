# git-preflight — Git & GitHub Init Checker

Diagnostic idempotent qui vérifie si un repo est correctement initialisé (git + GitHub remote + branche dev + tooling).

## Usage

```bash
bash ~/.claude/scripts/git-preflight/git-preflight.sh "$PWD"
```

## Flow

1. `gh auth status` — GitHub CLI connecté ?
2. `git init` — repo initialisé ?
3. `git branch -m main` — branche principale = main ?
4. `.gitignore` — existe ? complet ? (deps, OS, IDE, logs, coverage)
5. `.gitattributes` — existe ? (line endings LF, binaires marqués)
6. Scan fichiers sensibles — `.env`, `*.key`, `credentials.json`, etc. → ajout auto au `.gitignore` si manquants
7. `git add . && commit` — initial commit ?
8. `gh repo create --private` — remote GitHub ?
9. `git checkout -b dev` — branche dev créée + active ?
10. Branch protection `main` — force-push bloqué + suppression bloquée ?
11. gitleaks pre-commit hook — installé et actif ?
12. `cliff.toml` — git-cliff configuré pour autogénération du CHANGELOG ?
13. `README.md` — existe (minimum : nom du projet) ?
14. `.gitmessage` — commit template configuré ? (optionnel)

## Output

- Chaque step affiche `OK:` (déjà fait), `NEED:` (action requise), `WARN:` (incomplet) ou `INFO:` (optionnel)
- Fin : `STATUS: ALL GOOD` ou `STATUS: NEEDS SETUP` + liste des actions

## Actions possibles

| Action | Description |
|---|---|
| `git-init` | Initialiser le repo git |
| `branch-main` | Renommer la branche courante en `main` |
| `gitignore-create` | Créer `.gitignore` depuis le template de base |
| `gitignore-enrich` | Compléter le `.gitignore` existant (catégories manquantes) |
| `gitattributes-create` | Créer `.gitattributes` (normalisation LF + binaires) |
| `gitignore-secrets` | Ajouter les fichiers sensibles détectés au `.gitignore` |
| `initial-commit` | Créer l'initial commit |
| `gh-create` | Créer le repo GitHub privé + push |
| `create-dev` | Créer la branche `dev` et basculer dessus |
| `switch-dev` | Basculer sur la branche `dev` existante |
| `branch-protection` | Activer la protection sur `main` (block force-push + delete) |
| `gitleaks-install` | Installer gitleaks + créer le hook pre-commit |
| `gitleaks-hook` | Créer le hook pre-commit gitleaks (binaire déjà présent) |
| `cliff-install` | Installer git-cliff + générer `cliff.toml` |
| `cliff-init` | Générer `cliff.toml` (git-cliff déjà installé) |
| `readme-create` | Créer un `README.md` minimal |
| `gitmessage-create` | Créer `.gitmessage` (template Conventional Commits) |
| `gitmessage-config` | Configurer `.gitmessage` comme commit template local |

## Templates

Les templates sont embarqués dans le script :
- `~/.claude/scripts/git-preflight/templates/.gitignore-base` — base universelle (.env, deps, build, IDE, OS, logs, coverage)
- `~/.claude/scripts/git-preflight/templates/.gitattributes` — normalisation LF, déclaration texte/binaire, merge strategy lock files

## Exécution des actions par Claude Code

Quand le diagnostic retourne `NEEDS SETUP`, Claude Code exécute les actions dans l'ordre listé. Détails :

### `.gitignore`
- Copier le template de base depuis `templates/.gitignore-base`
- Ajouter les entrées spécifiques au langage/framework détecté (identifier la stack : lang, package manager, framework)
- Référence pour ajouts stack-specific : [gitignore.io](https://www.toptal.com/developers/gitignore)
- Règle : exclure plus plutôt que moins (plus facile de un-ignorer que de nettoyer l'historique)

### `.gitattributes`
- Copier le template depuis `templates/.gitattributes`
- Normalise les line endings en LF
- Marque les fichiers binaires pour éviter le bruit dans les diffs
- Définit la merge strategy des lock files

### Branch protection `main`
```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field allow_force_pushes=false \
  --field allow_deletions=false \
  --field required_pull_request_reviews=null \
  --field required_status_checks=null \
  --field enforce_admins=false \
  --field restrictions=null
```

### gitleaks (détection de secrets)
```bash
# Installation (binaire direct, pas Homebrew)
curl -sSfL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_$(uname -s)_$(uname -m).tar.gz | tar xz -C /usr/local/bin gitleaks

# Hook pre-commit
cat > .git/hooks/pre-commit << 'HOOK'
#!/bin/sh
gitleaks protect --staged --verbose
HOOK
chmod +x .git/hooks/pre-commit
```

### git-cliff (changelog autogénéré)
```bash
# Installation (binaire direct, pas Homebrew)
curl -sSfL https://github.com/orhun/git-cliff/releases/latest/download/git-cliff-$(uname -m)-apple-darwin.tar.gz | tar xz -C /usr/local/bin git-cliff

# Config
git-cliff --init
```
Le `CHANGELOG.md` est **toujours autogénéré** via git-cliff depuis les Conventional Commits. Ne jamais l'écrire à la main.

### `README.md`
Invoquer le skill `readme-writer` (`/readme-writer`). Ne pas écrire le README à la main.

### `.gitmessage` (optionnel)
Voir le skill `git-commits-push` pour le template. Installer avec :
```bash
git config --local commit.template .gitmessage
```

Pour le lint, format et validation de commits → utiliser les **hooks Claude Code** dans `~/.claude/settings.json` plutôt qu'un hook manager (Husky, pre-commit framework, etc.).

## Checklist de vérification (post-setup)

- [ ] `.gitignore` couvre artifacts, secrets, fichiers IDE, OS, logs, coverage
- [ ] `.gitattributes` normalise les line endings
- [ ] Branche `dev` créée et active (on doit être sur `dev`, pas `main`)
- [ ] Branch protection active sur `main`
- [ ] gitleaks fonctionne (`echo "API_KEY=test" > leak.txt && git add leak.txt && git commit -m "test"` → bloqué)
- [ ] `cliff.toml` existe (config git-cliff pour l'autogénération du changelog)
- [ ] `README.md` existe avec au minimum les commandes pour lancer le projet (généré via `readme-writer`)

## Patterns sensibles détectés

`.env`, `.env.*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `credentials.json`, `service-account*.json`, `*secret*`, `.secret*`, `*.secrets`, `id_rsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `STACK_EVAL.yaml`

## Invariants

- **Diagnostic only** : le script ne modifie rien, il reporte
- **Idempotent** : safe à relancer autant de fois que nécessaire
- **Exit 1** uniquement si `gh auth` échoue (bloquant)
- **Générer les fichiers, pas juste conseiller** — toujours produire le contenu réel
- **Jamais inclure de secrets dans un template** — même pas des placeholders comme `API_KEY=xxx`
- Les actions sont exécutées par Claude Code après lecture du diagnostic
