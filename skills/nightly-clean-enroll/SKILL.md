---
name: nightly-clean-enroll
description: >
  Enroll le repo courant pour un nettoyage nocturne automatique via une
  Routine Claude Code cloud. Copie les skills necessaires (loop-clean,
  backlog-deep-crush et leurs dependances) dans `.claude/skills/` du repo,
  patche les chemins `~/.claude/...` vers `.claude/...` pour l'env cloud,
  ecrit les helpers `routine-setup.sh` et `nightly-clean-run.sh`, met a
  jour `.gitignore`, et fournit le prompt exact a coller dans l'UI
  Routines. Use when the user says "nightly-clean-enroll", "enroll repo",
  "setup nightly cleanup", "configure routine nocturne", "active le
  nightly clean sur ce repo", or any variant requesting nightly cleanup
  enrollment for the current repo.
---

# nightly-clean-enroll

## Quand declencher

- L'utilisateur est dans un repo GitHub et demande `/nightly-clean-enroll`
- L'utilisateur dit "active le nightly sur ce repo", "setup la routine
  nocturne", "enroll le repo courant", toute variante
- Apres `claude-project-onboarder` si l'utilisateur veut du nettoyage auto

Ne PAS declencher :
- Si le CWD n'est pas un repo git
- Si le repo n'est pas hebergé sur GitHub (la Routine a besoin de
  github.com/apps/claude pour cloner)
- Si l'utilisateur veut du nettoyage ponctuel — utiliser `/loop-clean`
  directement

## Pre-requis

- Repo git sous CWD, push-able vers GitHub
- **Claude GitHub App installee** sur le repo cible
  (https://github.com/apps/claude → Configure → Select repository)
- Plan Max (quota 15 runs/jour, marge confortable pour 1-4 repos)
- `gh` CLI authentifie en local (`gh auth status`) — pour les commandes locales
- `~/.claude/skills/` contient : `senior-review`, `dedup-codebase`,
  `fix-or-backlog`, `loop-clean`, `backlog-crush`, `backlog-deep-crush`
- `~/.claude/scripts/spec-drift` present (dep de `/loop-clean`)
- `~/.claude/agents/` contient les 8 agents requis par le workflow nocturne :
  - `loop-clean-orchestrator.md` (dep de `/loop-clean`)
  - `backlog-crush-orchestrator.md` (dep de `/backlog-crush`)
  - `backlog-deep-crush-orchestrator.md` (dep de `/backlog-deep-crush`)
  - `senior-reviewer-file.md` (dep de `/senior-review` et des orchestrateurs)
  - `backlog-fix.md` (dep des orchestrateurs backlog)
  - `fix-file.md` (dep de `/fix-or-backlog`)
  - `dedup-intra.md` et `dedup-inter.md` (dep de `/dedup-codebase`)
- Token GitHub (PAT ou fine-grained) a disposition pour la Routine —
  scope `repo` minimum. Sera stocke dans les env vars de la Routine
  sous le nom `GH_TOKEN`. **La Routine hard-fail sans GH_TOKEN.**
- Le repo a une branche par defaut clairement definie (`origin/HEAD` set,
  verifiable via `gh repo view --json defaultBranchRef`)

Dependances installees automatiquement cloud-side par `routine-setup.sh` :
`gh`, `jq`, `node`. Aucune action locale requise pour ces dernieres.

## Principe

Le skill fait 4 choses :

1. **Copie les skills** requis par la Routine cloud dans `.claude/skills/`
   du repo courant, avec patching des chemins `~/.claude/...` vers
   `.claude/...` (l'env cloud n'a pas de `~/.claude/`).
2. **Ecrit 2 helpers bash** committes dans le repo :
   - `.claude/routine-setup.sh` : install `gh` CLI cloud-side, check
     `GH_TOKEN`.
   - `.claude/nightly-clean-run.sh` : pre (skip-check, fetch, reset
     branche) et post (commit, tag archive, force-push, upsert PR).
3. **Met a jour `.gitignore`** avec `.claude/run/`.
4. **Fournit le prompt Routine exact** a coller dans l'UI claude.ai.

La creation de la Routine elle-meme reste **manuelle UI-side** (l'API
Anthropic pour creer une Routine n'est pas exposee publiquement a ce jour).

## Procedure

### Etape 1 — Enroll

Depuis la racine du repo cible :

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh init
```

Sortie attendue :

```
==> Copying skills to .claude/skills/ (with path patching)
  ✓ skill senior-review
  ✓ skill dedup-codebase
  ✓ skill fix-or-backlog
  ✓ skill loop-clean
  ✓ skill backlog-crush
  ✓ skill backlog-deep-crush
==> Copying scripts to .claude/scripts/
  ✓ script spec-drift
==> Writing helpers
  ✓ wrote .claude/routine-setup.sh
  ✓ wrote .claude/nightly-clean-run.sh
==> Updating .gitignore
  ✓ added .claude/run/ to .gitignore

✅ Enrollment complete for <repo>
```

### Etape 2 — Committer et pusher

Invoquer `/git-commits-push` avec le message :

```
chore(nightly-clean): enroll repo for nocturnal cleanup routine
```

Le push doit atteindre la branche par defaut (`main`, `dev`, etc.) car la
Routine clone cette branche a chaque run.

### Etape 3 — Creer la Routine

Ouvrir https://claude.ai/code/routines → **Nouvelle routine**.

**Champs a remplir** :

| Champ | Valeur |
|-------|--------|
| Nom | `nightly-clean — <nom-du-repo>` |
| Depot | `<owner>/<repo>` (apparait apres install Claude GitHub App) |
| Declencheur | **Planification**, cron `0 2 * * *` (2h du mat) |
| Modele | `Opus 4.7 1M` (default OK) |
| Setup script | **Copier le contenu de `.claude/routine-setup.sh`** |
| Env vars | `GH_TOKEN=<ton token avec scope repo>` |
| Connecteurs | Supprimer Notion et autres — garder minimal |

**Prompt** (copier tel quel dans le champ "Decrivez ce que Claude doit
faire") :

```
This is a nightly cleanup run on this repository. Follow these steps
strictly in order. Do NOT skip steps. Do NOT invent alternative workflows.
Run all commands exactly as the on-disk SKILL.md files show them — paths
are .claude/... (NOT ~/.claude/...).

STEP 1 — Pre-flight (T-operation, no semantics)
Run: bash .claude/nightly-clean-run.sh pre
Interpret exit codes strictly:
  - exit 0 → proceed to STEP 2
  - exit 1 → SKIP. Report "SKIPPED: <stderr reason>". Do NOT proceed.
  - exit >=2 → HARD FAIL. Report "FAILED: <stderr verbatim>". Do NOT
    proceed, and do NOT retry — fail loudly so the human investigates.

On the first run of the day the remote branch claude/nightly-clean does
not exist yet; the pre-flight will log "first run detected" and proceed
normally without running the skip-check. This is expected.

STEP 2 — /loop-clean (semantic)
SET ENV VARIABLE before invoking /loop-clean:
  export LOOP_CLEAN_COMMIT_PER_ITER=1
This enables per-iteration commits inside /loop-clean, producing a
segmented, reviewable history in the nightly PR (each iter = one commit
with Applied / Escalated / Notes sections). Without it, /loop-clean
leaves uncommitted changes and STEP 4 produces a single bulk commit.

Execute the full procedure documented in .claude/skills/loop-clean/SKILL.md.
Read that SKILL.md and follow it point by point. IMPORTANT:
  (a) After running loop-clean.sh init, parse the stdout for the three
      variables LOOP_CLEAN_RUN_DIR, LOOP_CLEAN_BASE_SHA, LOOP_CLEAN_SESSION_ID
      and EXPORT them before any subsequent loop-clean.sh invocation. Without
      this, each prepare-iter/decide/finalize call creates a new run dir and
      iterations do not chain.
  (b) /loop-clean orchestrates: senior-review → dedup-codebase → spec-drift
      → fix-or-backlog. Iterations are capped at 10. Exit on EXIT_CLEAN,
      EXIT_OSCILLATION, or EXIT_CEILING.

STEP 3 — /backlog-deep-crush (semantic)
Export DEEP_CRUSH_NOCTURNAL=1 in the environment before starting.
Execute the full procedure documented in
.claude/skills/backlog-deep-crush/SKILL.md. IMPORTANT:
  (a) After running backlog-deep-crush.sh init, parse the stdout for
      BACKLOG_DEEP_CRUSH_SESSION_ID and EXPORT it before any subsequent
      backlog-deep-crush.sh invocation. Without this, each next-item /
      mark-done / decide call creates a new run dir and EXIT_STABLE does
      not fire — cycles do not chain.
  (b) The skill processes all 5 severities (critical → major → notable →
      minor → nit) in strict priority order, invoking /loop-clean between
      cycles. Exit on EXIT_DONE, EXIT_CEILING (80 cycles), or EXIT_STABLE
      (3 cycles without strict decrease in pending count).

STEP 4 — Post (T-operation, no semantics)
Run: bash .claude/nightly-clean-run.sh post
This will:
  - Require gh CLI (fails fast if missing)
  - Stage only scoped paths: backlog.md, .claude/nightly-runs.log, and
    common source dirs (src/, lib/, app/, pkg/, internal/) if present
  - Commit under author name/email from GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL
    env vars (defaults: "Claude Nightly" / "claude-nightly@anthropic.com")
  - Tag the previous claude/nightly-clean tip as archive (fallback to
    .claude/nightly-runs.log if tag push is blocked by the proxy OR if
    the tag name already exists for today)
  - Force-push claude/nightly-clean with --force-with-lease (safe: push
    is rejected if origin moved since the pre-flight fetch)
  - Upsert a PR targeting the default branch

STEP 5 — Final report (ALWAYS runs, even if earlier steps failed)
Print a brief summary: which of STEP 1-4 ran, which were skipped or
failed, total fixes applied by /loop-clean and /backlog-deep-crush,
final PR number/URL if any. Include verbatim error text from any step
that did not complete.

Constraints:
- NEVER push directly to the default branch.
- NEVER call `gh pr merge` — the human reviews and merges via the UI.
- If any step fails with an unclear error, halt and print the error
  verbatim rather than improvising a workaround.
```

**Activer "Allow unrestricted branch pushes"** : **NON** (on utilise
`claude/` prefix par defaut, deja autorisé).

### Etape 4 — Validation du 1er run

Deux options :

**Option A** : attendre 2h du mat puis verifier le PR au petit-dej.

**Option B** : dans l'UI Routines, clic droit sur la Routine → **Run now**
(bouton sur la card de la Routine une fois creee). Valide end-to-end
immediatement. Duree typique : 2-15min selon taille du repo et volume
backlog.

Points a verifier apres le run :

1. **PR ouverte** sur la branche `claude/nightly-clean` → `<default>`
2. **Commits** authored by "Claude Nightly"
3. **Tag** `nightly-clean-archive-YYYY-MM-DD` pousse (ou log dans
   `.claude/nightly-runs.log` si fallback active)
4. **backlog.md** : items `[x]` qui n'y etaient pas avant
5. **Logs de la Routine** (UI) : STEP 1 a 5 dans l'ordre, aucune erreur

## Autres commandes

### Refresh des skills

Quand tu mets a jour un skill dans `~/.claude/skills/` (version canonique),
re-synchronise vers le repo cible :

```bash
cd <repo>
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh refresh
```

Puis commit + push. La prochaine execution de la Routine utilisera la
nouvelle version.

### Status

Voir ce qui est installe dans le repo courant :

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh status
```

### Uninstall

Retirer tous les artefacts d'enrollment (skills copies, helpers). Ne
supprime PAS la Routine cloud — a faire manuellement dans l'UI.

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh uninstall
```

## Troubleshooting

| Symptome | Cause probable | Fix |
|----------|----------------|-----|
| Routine UI ne liste pas le repo | Claude GitHub App non installee sur le repo | Installer via https://github.com/apps/claude → Configure |
| Routine fail sur `gh pr view` | `GH_TOKEN` non configure dans les env vars | Ajouter `GH_TOKEN=<ton-token>` dans les env vars de la Routine |
| Routine fail sur force-push | Branche n'est pas prefixee `claude/` OU "unrestricted branch pushes" OFF | Verifier que la Routine utilise bien `claude/nightly-clean` (defaut du script) |
| Tag archive non pousse | Policy proxy Anthropic restreint les tags | Fallback automatique : `.claude/nightly-runs.log` est committe a la place. Aucune action requise. |
| PR non cree mais changes pushed | `gh pr create` a echoue silencieusement | Re-invoquer la Routine ; creer manuellement si probleme persiste |
| Nightly run prend > 30min | Backlog enorme ou fixes qui regenerent | `EXIT_STABLE` (window=2) devrait bailout. Si non, verifier `.claude/run/backlog-deep-crush/*/cycle-*/decision.json` dans le PR pour comprendre |

## Structure apres enrollment

```
<repo>/
├── .claude/
│   ├── skills/
│   │   ├── senior-review/
│   │   ├── dedup-codebase/
│   │   ├── fix-or-backlog/
│   │   ├── loop-clean/
│   │   ├── backlog-crush/
│   │   └── backlog-deep-crush/
│   ├── scripts/
│   │   └── spec-drift/
│   ├── routine-setup.sh        # install gh CLI cloud-side
│   └── nightly-clean-run.sh    # pre/post git orchestration
├── .gitignore                   # + .claude/run/
└── ...
```

## Anti-patterns

- **Ne jamais editer manuellement les skills copies dans `.claude/skills/`**
  — ils seront ecrases au prochain `refresh`. Editer la version canonique
  dans `~/.claude/skills/` puis re-refresh.
- **Ne jamais activer "unrestricted branch pushes"** sans raison forte.
  Le prefixe `claude/` suffit pour la strategie par defaut.
- **Ne jamais coller `GH_TOKEN` directement dans le prompt** — toujours
  via les env vars de la Routine (chiffres).
- **Ne pas creer plusieurs Routines par repo** — une seule suffit, les
  collisions force-push entre deux runs simultanes corromprairaient la
  branche.

## Limites

- **Creation de Routine manuelle** : pas d'automatisation UI-side
  possible a ce jour. L'utilisateur doit coller le prompt dans
  https://claude.ai/code/routines.
- **Duplication** : chaque repo enrolle a une copie complete des skills
  (~6 dirs, quelques centaines de ko). Acceptable pour 1-4 repos. Au-dela,
  envisager une distribution par plugin Claude Code.
- **Sync manuel** : les updates de skills canoniques ne se propagent pas
  automatiquement — utiliser `refresh`.
- **Pas de rollback auto** : si un nightly run introduit une regression,
  `git reset --hard origin/claude/nightly-clean-archive-<date>` sur la
  branche par defaut n'est pas une option automatique. L'utilisateur
  ferme simplement le PR et le rollback se fait naturellement (le PR
  n'est jamais merge).
