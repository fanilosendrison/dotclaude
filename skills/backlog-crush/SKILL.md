---
name: backlog-crush
description: >
  Traite les items critical et major non coches du `backlog.md` en invoquant
  /loop-clean entre chaque fix (un critical a la fois, majors par batch de 5).
  Script bash pour les decisions de flux ; Claude applique les fixes et suit
  la procedure. Termine sur EXIT_DONE (plus rien), EXIT_CEILING (40 cycles),
  ou EXIT_STABLE (3 cycles consecutifs sans reduction). Use when the user
  says "backlog-crush", "crush the backlog", "vider le backlog", "fix les
  critical du backlog", or any variant, AND automatically after /loop-clean
  if backlog.md contains unchecked critical or major items.
---

# backlog-crush

Ce skill delegue toute son orchestration a l'agent
**`backlog-crush-orchestrator`** (model `claude-opus-4-6`, effort `xhigh`,
pinnes via frontmatter).

**Pourquoi un agent dedie** : l'orchestration execute dans son propre contexte
la classification et le dispatch des fixes par cluster, et invoque loop-clean
imbrique (lui-meme un agent orchestrateur) entre chaque cycle. Pinner le model
garantit une qualite deterministe meme si la session parent est Sonnet/Haiku
pour economiser sur le sequencement.

## Quand declencher

- Apres `/loop-clean` si `backlog.md` contient au moins un item non coche
  `- [ ] [critical]` ou `- [ ] [major]`
- Invocation manuelle `/backlog-crush`
- L'utilisateur demande "crush le backlog", "fix les critical", "vide les
  prios du backlog", toute variante

Ne PAS declencher :
- Si `backlog.md` n'existe pas ou ne contient que des `[x]` / `notable`/
  `minor`/`nit`
- En plein milieu d'une implementation de tache courante (attendre
  `/loop-clean` terminee)

## Pre-requis

- `backlog.md` a la racine du projet, format :
  `- [ ] [SEVERITE] Fichier:ligne — Description (date: YYYY-MM-DD, source: ...)`
- `.claude/run/` gitignore (meme exigence que loop-clean)
- Dependances : `jq`, `bash >= 3`, `sha256sum` ou `shasum -a 256`

## Procedure

Lancer l'agent orchestrateur :

```
Agent({
  subagent_type: "backlog-crush-orchestrator",
  description: "Run /backlog-crush",
  prompt: "Lance la boucle backlog-crush complete selon ta procedure. Traite les items critical et major de backlog.md en invoquant loop-clean entre cycles jusqu'a terminaison (EXIT_DONE, EXIT_CEILING, ou EXIT_STABLE). Retourne le rapport markdown final de finalize, enrichi des notes[] consolidees des sub-agents backlog-fix."
})
```

**Ne PAS passer de `model` ou `effort` override** dans l'appel — laisser le
frontmatter de l'agent decider.

Presenter a l'utilisateur le rapport markdown retourne par l'agent, tel quel.

## Procedure complete de reference

La procedure detaillee (init, boucle cycles avec next-item / parsing /
clustering / dispatch sub-agents `backlog-fix` / mark-done / loop-clean
imbrique / decide, finalize) vit dans le system prompt de l'agent
`backlog-crush-orchestrator` (voir
`~/.claude/agents/backlog-crush-orchestrator.md`). L'agent est autonome.
