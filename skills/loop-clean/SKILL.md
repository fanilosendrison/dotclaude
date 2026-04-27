---
name: loop-clean
description: >
  Boucle deterministe post-implementation : enchaine
  coding-standards → senior-review → dedup-codebase → spec-drift →
  fix-or-backlog jusqu'a convergence CLEAN, detection d'oscillation,
  ou plafond d'iterations. Modes : `diff` (fichiers modifies, defaut)
  ou `audit` (repo complet).
  Use when the user says "loop-clean", "boucle clean", "nettoyage boucle",
  "post-implementation loop", or any variant requesting a deterministic
  iterative cleanup of findings until convergence.
---

# loop-clean

Delegue l'orchestration a l'agent **`loop-clean-orchestrator`** (model et
effort pinnes via frontmatter).

## Quand declencher

- L'utilisateur tape `/loop-clean`
- L'utilisateur demande "boucle la post-implementation", "itere jusqu'au clean",
  "tourne jusqu'a convergence", ou toute variante

Ne PAS declencher :
- Apres un simple `/senior-review` (ponctuel)
- Pour un audit one-shot sans intention d'appliquer les fixes

## Detection du mode depuis `ARGUMENTS`

- Si `ARGUMENTS` contient le mot `audit` (case-insensitive, mot entier) →
  `scope_mode=audit` (repo complet via `--scope=all`).
- Sinon → `scope_mode=diff` (fichiers modifies / staged, cas standard
  post-implementation).

Exemples :
- `/loop-clean` → `diff`
- `/loop-clean audit` → `audit`
- `/loop-clean audit complet codebase` → `audit`
- `/loop-clean sur <worktree>` → `diff` (pas de mot `audit`)

## Procedure

Lancer l'agent orchestrateur avec le `scope_mode` resolu :

```
Agent({
  subagent_type: "loop-clean-orchestrator",
  description: "Run /loop-clean",
  prompt: "Lance la boucle loop-clean complete selon ta procedure avec scope_mode=<diff|audit>. Suis-la integralement jusqu'a terminaison (EXIT_CLEAN, EXIT_OSCILLATION, ou EXIT_CEILING). Retourne le rapport markdown final de l'etape finalize, enrichi d'une note sur le WARNING .gitignore si applicable, et d'une note sur le WARNING scope vide si applicable."
})
```

**Ne PAS passer de `model` ou `effort` override** — laisser le frontmatter de
l'agent decider (determinisme).

Presenter a l'utilisateur le rapport markdown retourne par l'agent, tel quel.

## Sticky `BASE_SHA` (mode `diff`)

Le `BASE_SHA` qui sert d'ancre au scope `diff` est **persistant par repo**, hors
de `$RUN_DIR/<PID>/` (volatile). Il est stocke dans :

```
~/.claude/run/loop-clean/sessions/<repo-id>/base-sha
```

ou `<repo-id>` est un hash du `git rev-parse --show-toplevel`.

**Resolution au premier `init`** (sticky absent ou invalide) :
- `merge-base origin/<default-branch> HEAD` si distinct de HEAD
  (couvre feature branches et worktrees backlog-crush / backlog-deep-crush)
- Sinon `HEAD` (cas main direct deja synchronise avec origin)

**Inits suivants** : reutilise le sticky tant qu'il reste un ancetre de HEAD.
Cela garantit que des commits / push intermediaires n'avancent PAS l'ancre :
le scope reste l'ensemble du chantier en cours.

**Avancement automatique sur `EXIT_CLEAN`** : a la fin de `finalize`, si la
boucle termine en `EXIT_CLEAN` ET sans regression test/lint/typecheck, le
sticky est avance a HEAD. Le prochain `/loop-clean` repart donc d'une
ancre fraiche — pas de re-audit du chantier deja convergé. Sur
`EXIT_OSCILLATION` / `EXIT_CEILING` / regression, le sticky ne bouge PAS,
afin que les findings non resolus restent dans le scope du run suivant.

**Reinitialisation manuelle** :

```bash
bash skills/loop-clean/loop-clean.sh reset                  # drop le sticky
bash skills/loop-clean/loop-clean.sh reset --from HEAD~3    # ancre N commits en arriere
bash skills/loop-clean/loop-clean.sh reset --from <sha>     # ancre sur un sha precis
```

A utiliser quand le sticky est trop vieux (chantier termine) ou quand le
scope `diff` ressort vide alors qu'on attend des fichiers (typique du cas
"Claude a commit + push avant le premier `/loop-clean`" : le sticky a ete
pose sur HEAD post-commit, donc `--from HEAD~N` permet de remonter avant
les commits a auditer).
