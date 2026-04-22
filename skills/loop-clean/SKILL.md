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
