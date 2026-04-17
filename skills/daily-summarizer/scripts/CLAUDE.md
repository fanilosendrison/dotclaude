# summarize-the-day — Orchestration tmux pour debriefs multi-sessions

Envoie `/session-debriefer` à toutes les sessions Claude Code tmux (sauf la courante)
et attend que les entries apparaissent dans le journal raw.

## Usage

```bash
bash ~/.claude/skills/daily-summarizer/scripts/summarize-the-day.sh [--timeout SECONDS]
```

## Flow

1. Liste les sessions tmux `claude-*`, exclut la session courante
2. **Filtre live vs zombie** : vérifie via `#{pane_current_command}` si Claude Code tourne (vs shell nu après fermeture VSCode)
3. Kill les sessions zombie immédiatement
4. Compte les fichiers `YYYY-MM-DD_*.raw.md` existants dans le raw du jour
5. Envoie `/session-debriefer` aux sessions **vivantes uniquement** via `tmux send-keys`
6. Poll toutes les 5s : vérifie si chaque session est idle (prompt `❯` visible)
7. Une fois idle : envoie `/exit` à chaque session, attend 5s, puis `tmux kill-session`
8. Output JSON avec le status

## Invariants

- **Déterministe** : même state tmux + journal → même comportement
- **Idempotent** : relancer ne cause pas de double-debrief (les sessions peuvent refuser si déjà debriefées)
- **Résilient** : sessions zombie (VSCode fermé, shell nu) détectées et nettoyées sans crasher
- **Exit 0** : succès (toutes sessions idle) ou aucune session trouvée
- **Exit 1** : timeout (certaines sessions encore actives)
- **N'écrit rien** : le script ne touche pas au journal, ce sont les sessions Claude qui écrivent
- **Logs sur stderr** : progression visible en temps réel, JSON propre sur stdout
- **Pas de `set -e`** : erreurs gérées explicitement, une session qui fail ne bloque pas les autres

## Output

JSON sur stdout :
- `{"status":"ok","sessions_found":N,"live_sessions":N,"dead_sessions":N,"sessions_idle":N,"new_entries":N,"elapsed":S}`
- `{"status":"timeout","sessions_found":N,"live_sessions":N,"dead_sessions":N,"sessions_idle":N,"new_entries":N,"elapsed":S}`
- `{"status":"no_sessions","sessions_found":N,"live_sessions":0,"dead_sessions":N,"new_entries":0}`
