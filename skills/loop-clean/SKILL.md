---
name: loop-clean
description: >
  Orchestre de maniere deterministe la boucle post-implementation
  (coding-standards → senior-review → dedup-codebase → spec-drift →
  fix-or-backlog) jusqu'a convergence CLEAN, detection d'oscillation,
  ou plafond d'iterations. L'orchestration est deleguee a l'agent
  `loop-clean-orchestrator` ; les decisions de flux (next action,
  convergence, oscillation, ceiling) sont calculees par un controleur
  bash (`loop-clean.sh`) qui parse les JSON produits par chaque skill.
  Claude execute les skills et ecrit les JSON.
  Separation stricte decision/execution.
  Use when the user says "loop-clean", "boucle clean", "nettoyage boucle",
  "post-implementation loop", or any variant requesting a deterministic
  iterative cleanup of findings until convergence.
---

# loop-clean

Ce skill delegue toute son orchestration a l'agent **`loop-clean-orchestrator`**
(model `claude-opus-4-6`, effort `xhigh`, pinnes via frontmatter).

**Pourquoi un agent dedie** : l'orchestration execute dans son propre contexte
les etapes cognitives de coding-standards, senior-review, dedup-codebase et fix-or-backlog
(classification correctness/hygiene, decoupage de fichiers oversized,
consolidation des findings, emission JSON avec hash stables). Pinner le model
garantit une qualite deterministe independante du model de session parent.

## Quand declencher

- L'utilisateur tape `/loop-clean`
- L'utilisateur demande "boucle la post-implementation", "itere jusqu'au clean",
  "tourne jusqu'a convergence", ou toute variante

Ne PAS declencher :
- Apres un simple `/senior-review` (ponctuel)
- Pour un audit one-shot sans intention d'appliquer les fixes

## Pre-requis projet

- `.claude/run/` gitignore (l'agent emet un WARNING sinon via stderr de
  `loop-clean.sh init`)
- Dependances runtime : `jq`, `git`, `node`, `bash >= 3`, `sha256sum` ou
  `shasum -a 256`

## Modes

- **`diff`** (defaut) — sub-skills auditent uniquement les fichiers
  modifies / staged (`git diff --name-only` + `git diff --cached --name-only`).
  C'est le cas standard post-implementation : on review ce qui vient de changer
  avant commit.
- **`audit`** — sub-skills auditent le **repo complet** (`--scope=all`).
  Cas d'usage : inspection de qualite d'une codebase existante, audit
  periodique, audit nocturne. Plus lent (~minutes selon la taille) et plus
  couteux (dizaines de sub-agents en parallele).

### Detection du mode depuis `ARGUMENTS`

- Si `ARGUMENTS` contient le mot `audit` (case-insensitive, mot entier) →
  `scope_mode=audit`.
- Sinon → `scope_mode=diff`.

Exemples :
- `/loop-clean` → mode `diff`
- `/loop-clean audit` → mode `audit`
- `/loop-clean audit complet codebase` → mode `audit`
- `/loop-clean sur <worktree>` → mode `diff` (pas de mot `audit`)

## Procedure

Lancer l'agent orchestrateur avec le `scope_mode` resolu :

```
Agent({
  subagent_type: "loop-clean-orchestrator",
  description: "Run /loop-clean",
  prompt: "Lance la boucle loop-clean complete selon ta procedure avec scope_mode=<diff|audit>. Suis-la integralement jusqu'a terminaison (EXIT_CLEAN, EXIT_OSCILLATION, ou EXIT_CEILING). Retourne le rapport markdown final de l'etape finalize, enrichi d'une note sur le WARNING .gitignore si applicable, et d'une note sur le WARNING scope vide si applicable."
})
```

**Ne PAS passer de `model` ou `effort` override** dans l'appel `Agent(...)` —
laisser le frontmatter de l'agent decider (determinisme).

Presenter a l'utilisateur le rapport markdown retourne par l'agent, tel quel.

## Procedure complete de reference

La procedure detaillee (init, boucle iterations avec prepare-iter /
coding-standards / senior-review / dedup-codebase / spec-drift / decide /
fix-or-backlog, finalize) vit dans le
system prompt de l'agent `loop-clean-orchestrator` (voir
`~/.claude/agents/loop-clean-orchestrator.md`). L'agent est autonome et suit
cette procedure sans intervention de l'orchestrateur de skill.
