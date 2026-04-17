---
name: backlog-deep-crush
description: >
  Variante nocturne de /backlog-crush. Traite les items non coches du
  `backlog.md` sur les 5 severites (critical, major, notable, minor, nit)
  en priorite stricte, en invoquant /loop-clean entre chaque cycle. Script
  bash pour les decisions de flux ; Claude applique les fixes et suit la
  procedure. Termine sur EXIT_DONE (plus rien), EXIT_CEILING (80 cycles),
  ou EXIT_STABLE (3 cycles consecutifs sans reduction). Use when the user
  says "backlog-deep-crush", "crush all severities", "vider tout le
  backlog", "vider jusqu'aux nits", "nightly backlog crush", or any
  variant requesting a full-severity backlog sweep. Invoquee uniquement
  en contexte nocturne (via Routine cloud ou manuel) — PAS de chainage
  automatique apres /loop-clean.
---

# backlog-deep-crush

Ce skill delegue toute son orchestration a l'agent
**`backlog-deep-crush-orchestrator`** (model `claude-opus-4-6`, effort
`xhigh`, pinnes via frontmatter).

**Pourquoi un agent dedie** : la boucle nocturne peut tourner jusqu'a 80
cycles, chacun invoquant loop-clean imbrique. L'orchestration execute
dans son propre contexte le clustering + dispatch des fixes et la
gestion de priorite stricte par severite. Pinner le model garantit une
qualite deterministe sur les cycles a travers les 5 tiers de severite
(ou `EXIT_STABLE` intervient apres 3 cycles consecutifs sans reduction).

## Quand declencher

- Invocation manuelle `/backlog-deep-crush`
- Automatiquement par une Routine Claude Code cloud nocturne (voir
  `/nightly-clean-enroll`)
- L'utilisateur demande "crush tout le backlog", "passe sur toutes les
  severites", "vide jusqu'aux nits", toute variante

Ne PAS declencher :
- Apres `/loop-clean` en journee — utiliser `/backlog-crush`
  (critical+major seulement)
- Si `backlog.md` n'existe pas ou est entierement coche
- En plein milieu d'une implementation de tache courante

## Pre-requis

- `backlog.md` a la racine du projet, format standard
- `.claude/run/` gitignore (meme exigence que loop-clean)
- Dependances : `jq`, `bash >= 3`, `sha256sum` ou `shasum -a 256`
- **En contexte nocturne** : exporter `DEEP_CRUSH_NOCTURNAL=1` avant
  invocation pour supprimer le WARNING au demarrage

## Procedure

Lancer l'agent orchestrateur :

```
Agent({
  subagent_type: "backlog-deep-crush-orchestrator",
  description: "Run /backlog-deep-crush",
  prompt: "Lance la boucle backlog-deep-crush complete selon ta procedure. Traite toutes les severites du backlog en priorite stricte, en invoquant loop-clean entre cycles jusqu'a terminaison (EXIT_DONE, EXIT_CEILING, ou EXIT_STABLE). Retourne le rapport markdown final de finalize (avec breakdown par severite), enrichi des notes[] consolidees des sub-agents backlog-fix."
})
```

**Ne PAS passer de `model` ou `effort` override** dans l'appel — laisser
le frontmatter de l'agent decider.

Presenter a l'utilisateur le rapport markdown retourne par l'agent, tel quel.

## Procedure complete de reference

La procedure detaillee (init avec SESSION_ID exporte, boucle cycles avec
next-item / clustering / dispatch sub-agents `backlog-fix` / mark-done /
loop-clean imbrique / decide, finalize avec breakdown par severite, regle
specifique "rigueur accrue sur les nits") vit dans le system prompt de
l'agent `backlog-deep-crush-orchestrator` (voir
`~/.claude/agents/backlog-deep-crush-orchestrator.md`). L'agent est autonome.
