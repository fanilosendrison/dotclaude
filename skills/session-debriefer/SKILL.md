---
name: session-debriefer
description: Rédige un résumé rétrospectif factuel de la session Claude Code en cours et l''écrit dans un fichier journal brut. Use when the user says "session debrief", "debrief", "résumé de session", "journal de session", "log this session", "ferme la session", or any variant requesting a retrospective summary of the current work session.
---

# Session Debriefer

Produire une entrée de journal factuelle et concise résumant la session Claude Code en cours.

## Workflow

1. Déterminer la date (`YYYY-MM-DD`) et l'heure (`HH-MM-SS`) actuelles
2. Créer `~/.claude/journal/raw/` si inexistant
3. Analyser la session : fichiers touchés, commandes exécutées, discussions, décisions
4. Si rien de significatif (question rapide, session avortée) → entrée minimale ou rien
5. Écrire dans `~/.claude/journal/raw/YYYY-MM-DD_HH-MM-SS.raw.md`
   - Ne jamais écraser un fichier existant — suffixer `_2`, `_3`, etc. si collision
6. Confirmer à l'utilisateur : contenu écrit + chemin du fichier

## Format de l'entrée

```markdown
## Session HH:MM — <repo ou répertoire de travail>

- **Contexte** : sur quoi je travaillais (1 ligne)
- **Actions** : fichiers créés/modifiés, commandes significatives
- **Décisions** : choix architecturaux ou techniques pris
- **Blocages** : ce qui a coincé, résolu ou non
```

## Règles

- **Un fichier par session** : toujours un nouveau fichier, jamais d'écrasement
- **Factuel et concis** : pas de prose, pas d'embellissement
- **Heure** : format HH:MM, 24h
- **Répertoire** : nom du repo git si disponible, sinon nom du répertoire courant
- **Sections vides** : omettre (pas de "Aucun" ou "N/A")
- **Entrée minimale** : `## Session HH:MM — <dir> — Session minimale`
