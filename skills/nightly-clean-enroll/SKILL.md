---
name: nightly-clean-enroll
description: >
  Enroll le repo courant pour un nettoyage nocturne automatique via GitHub
  Actions. Ecrit `.github/workflows/nightly-clean.yml` qui delegue au workflow
  reutilisable de `fanilosendrison/cc-ci`. Fournit les instructions pour set le
  secret `CLAUDE_CODE_OAUTH_TOKEN`. Use when the user says "nightly-clean-enroll",
  "enroll repo", "setup nightly cleanup", "active le nightly sur ce repo", or any
  variant requesting nightly cleanup enrollment for the current repo.
---

# nightly-clean-enroll

## Quand declencher

- L'utilisateur est dans un repo GitHub et demande `/nightly-clean-enroll`
- L'utilisateur dit "active le nightly sur ce repo", "enroll le repo courant",
  toute variante
- Apres `claude-project-onboarder` si l'utilisateur veut du nettoyage auto

Ne PAS declencher :
- Si le CWD n'est pas un repo git
- Si le repo n'est pas heberge sur GitHub
- Si l'utilisateur veut du nettoyage ponctuel — utiliser `/loop-clean`

## Pre-requis

- Repo git sous CWD, push-able vers GitHub
- Plan Claude Pro ou Max pour obtenir un OAuth token via `claude setup-token`
- `gh` CLI authentifie (`gh auth status`)
- La branche par defaut du repo est clairement definie (`origin/HEAD` set)

## Principe

Le skill fait 2 choses :

1. **Ecrit le caller workflow** `.github/workflows/nightly-clean.yml` — 10 lignes
   qui delegue au callable dans `fanilosendrison/cc-ci`
2. **Fournit la commande** pour set le secret `CLAUDE_CODE_OAUTH_TOKEN` sur le repo

Tout le reste (skills, agents, scripts, prompt nightly, orchestration git) vit
dans `fanilosendrison/dotclaude` et `fanilosendrison/cc-ci` — clones au runtime
par le workflow GHA. **Zero tracking** du contenu Claude dans le repo enroll.

## Procedure

### Etape 1 — Enroll

Depuis la racine du repo cible :

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh init
```

Par defaut :
- cron 00:00 UTC (utilise `--cron "MIN HOUR * * *"` pour override)
- branche `claude/nightly-clean` comme accumulator
- ref `main` du callable workflow

Sortie attendue :

```
==> Writing .github/workflows/nightly-clean.yml
  ✓ caller workflow written (cron: 0 0 * * *)
==> Updating .gitignore
  ✓ .gitignore entry for .claude/ already present (or added)

✅ Enrollment complete for <repo>

Next steps:
  1. Commit + push .github/workflows/nightly-clean.yml
  2. Set the secret (get token from: claude setup-token):
       printf '%s' '<TOKEN>' | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>
  3. Trigger a first run manually to validate:
       gh workflow run nightly-clean.yml --repo <owner>/<repo>
  4. Check the Actions tab after ~20 min — a PR should appear on claude/nightly-clean.
```

### Etape 2 — Set le secret (manuel)

L'OAuth token s'obtient via :

```bash
claude setup-token
```

Ca ouvre un browser, authentifie via Pro/Max, retourne un token `sk-ant-oat01-...`.

Puis set le secret (attention au newline trailing — utiliser `printf '%s'` pour
stripper) :

```bash
printf '%s' '<COLLE_TOKEN_ICI>' | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>
```

### Etape 3 — Commit + push

```bash
git add .github/workflows/nightly-clean.yml
git commit -m "chore: enroll nightly-clean via GHA + cc-ci"
git push
```

### Etape 4 — Validation

```bash
gh workflow run nightly-clean.yml --repo <owner>/<repo>
```

Observe les logs dans l'onglet Actions. Duree typique : 15-30 min selon taille
du repo et volume backlog. Un PR `claude/nightly-clean` apparait apres.

## Autres commandes

### Status

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh status
```
Verifie : workflow present, secret set, derniere execution.

### Uninstall

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh uninstall
```
Retire le caller workflow. Ne supprime PAS le secret (il reste utilisable si tu
re-enrolles). Pour vraiment tout nettoyer, aussi faire :
```bash
gh secret delete CLAUDE_CODE_OAUTH_TOKEN --repo <owner>/<repo>
```

## Options avancees

### Override cron

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh init --cron "17 3 * * *"
```
Pour staggerer les runs entre plusieurs repos enrolls (evite pic de quota en
cas de partage de token).

### Pin le callable a un SHA

Edit manuel du YAML apres `init` :
```yaml
uses: fanilosendrison/cc-ci/.github/workflows/nightly-clean-callable.yml@<sha>
```
Pour freezer ce repo a une version specifique de cc-ci (reproductibilite).

## Troubleshooting

| Symptome | Cause probable | Fix |
|----------|----------------|-----|
| Workflow fail avec "startup_failure" | Missing top-level permissions OU secret absent | Verifier que le workflow YAML contient `permissions: contents: write, pull-requests: write`, et que `gh secret list` montre bien `CLAUDE_CODE_OAUTH_TOKEN` |
| API Error "Header has invalid value" au step Claude | Token avec newline trailing | Re-set : `printf '%s' '<token>' \| gh secret set ...` (sans echo) |
| Workflow skip constant | PR label `wip-review` OU commits humains detectes sur `claude/nightly-clean` | Clean la branche, ou retirer le label |
| Claude session timeout | Repo enorme, backlog massif | Normal, workflow retrying au prochain cron |

## Anti-patterns

- **Ne PAS committer le token dans le workflow YAML** — toujours via `secrets`.
- **Ne PAS pin `uses: ...@main`** a un tag custom sauf si tu veux isoler ce repo
  des updates upstream (par defaut, latest main pour tous).
- **Ne PAS creer plusieurs workflows qui invoquent le callable** sur le meme
  repo — collisions force-push entre runs simultanes corromprairaient la
  branche nightly.

## Limites

- **Creation du secret manuelle** : pas d'automation possible pour
  `claude setup-token` (ouverture browser requise).
- **Quota OAuth token** : partage l'usage de ton plan Pro/Max entre tous les
  repos enrolls. Si tu approches le cap mensuel, stagger les cron pour lisser.
- **Pas de rollback auto** : si un nightly run introduit une regression, fermer
  le PR suffit (la branche `claude/nightly-clean` sera resetee au prochain run).
