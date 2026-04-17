#!/bin/bash
set -uo pipefail

# summarize-the-day.sh
# Envoie /session-debriefer à toutes les sessions Claude tmux (sauf la courante)
# et attend que les entries apparaissent dans le journal raw.
# Output : JSON sur stdout
#
# Robustesse : détecte les sessions tmux zombie (Claude Code exité, shell nu)
# et les skip/kill au lieu de crasher.

JOURNAL_DIR="$HOME/.claude/journal/raw"
TODAY=$(date +%Y-%m-%d)
TIMEOUT=300          # 5min par défaut
POLL_INTERVAL=5      # secondes entre checks

log() { echo "[summarize] $*" >&2; }

# Parse args
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# --- Identifier les sessions claude-* (exclure la session courante) ---
CURRENT_SESSION=""
if [ -n "${TMUX:-}" ]; then
  CURRENT_SESSION=$(tmux display-message -p '#S' 2>/dev/null) || true
fi

SESSIONS=()
while IFS= read -r s; do
  [ "$s" = "$CURRENT_SESSION" ] && continue
  SESSIONS+=("$s")
done < <(tmux list-sessions -F '#S' 2>/dev/null | grep '^claude-' || true)

SESSION_COUNT=${#SESSIONS[@]}

log "Sessions tmux trouvées : ${SESSIONS[*]:-aucune} (total: $SESSION_COUNT)"

if [ "$SESSION_COUNT" -eq 0 ]; then
  log "Aucune session claude-* active. Fin."
  echo '{"status":"no_sessions","sessions_found":0,"live_sessions":0,"dead_sessions":0,"new_entries":0}'
  exit 0
fi

# --- Check if Claude Code is the foreground process (vs raw shell) ---
session_has_claude() {
  local cmd
  cmd=$(tmux display-message -t "$1" -p '#{pane_current_command}' 2>/dev/null) || return 1
  case "$cmd" in
    zsh|bash|sh|fish|login|-zsh|-bash) return 1 ;;  # shell = Claude exited
    *) return 0 ;;  # node, claude, etc. = Claude likely running
  esac
}

# --- Vérifier si une session est idle (prompt ❯ visible, pas de traitement) ---
session_is_idle() {
  local output
  output=$(tmux capture-pane -t "$1" -p 2>/dev/null) || return 1
  echo "$output" | tail -8 | grep -q '^❯[[:space:]]*$'
}

# --- Compter les fichiers raw existants pour aujourd'hui ---
count_raw_files() {
  find "$JOURNAL_DIR" -maxdepth 1 -name "${TODAY}_*.raw.md" 2>/dev/null | wc -l | tr -d ' '
}

# --- Filtrer les sessions vivantes vs mortes ---
LIVE_SESSIONS=()
DEAD_SESSIONS=()
for s in "${SESSIONS[@]}"; do
  if session_has_claude "$s"; then
    LIVE_SESSIONS+=("$s")
  else
    DEAD_SESSIONS+=("$s")
  fi
done

LIVE_COUNT=${#LIVE_SESSIONS[@]}
DEAD_COUNT=${#DEAD_SESSIONS[@]}

if [ "$DEAD_COUNT" -gt 0 ]; then
  log "Sessions zombie (shell nu, pas de Claude Code) : ${DEAD_SESSIONS[*]} → kill"
  for s in "${DEAD_SESSIONS[@]}"; do
    tmux kill-session -t "$s" 2>/dev/null || true
  done
fi

if [ "$LIVE_COUNT" -eq 0 ]; then
  log "Aucune session avec Claude Code actif. Fin."
  echo "{\"status\":\"no_sessions\",\"sessions_found\":$SESSION_COUNT,\"live_sessions\":0,\"dead_sessions\":$DEAD_COUNT,\"new_entries\":0}"
  exit 0
fi

log "Sessions avec Claude Code actif : ${LIVE_SESSIONS[*]} (total: $LIVE_COUNT)"

ENTRIES_BEFORE=$(count_raw_files)
log "Entries raw existantes aujourd'hui ($TODAY) : $ENTRIES_BEFORE"

# --- Envoyer /session-debriefer à chaque session vivante ---
for s in "${LIVE_SESSIONS[@]}"; do
  log "→ Envoi /session-debriefer à '$s'"
  if ! tmux send-keys -t "$s" "/session-debriefer" 2>/dev/null; then
    log "⚠ Échec send-keys pour '$s', skip"
    continue
  fi
  sleep 1
  tmux send-keys -t "$s" Enter 2>/dev/null || true    # sélectionne l'option autocomplete
  sleep 0.5
  tmux send-keys -t "$s" Enter 2>/dev/null || true    # soumet la commande
  sleep 2
done
log "Commandes envoyées. Attente que les sessions reviennent idle (timeout: ${TIMEOUT}s)..."

# --- Attendre que toutes les sessions soient idle ---
# Grace period : laisser les sessions démarrer le traitement
sleep 5
ELAPSED=5

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  IDLE_COUNT=0
  for s in "${LIVE_SESSIONS[@]}"; do
    if session_is_idle "$s"; then
      IDLE_COUNT=$((IDLE_COUNT + 1))
    fi
  done

  ENTRIES_NOW=$(count_raw_files)
  NEW_ENTRIES=$((ENTRIES_NOW - ENTRIES_BEFORE))

  if [ "$IDLE_COUNT" -eq "$LIVE_COUNT" ]; then
    log "✓ Toutes les sessions idle ($IDLE_COUNT/$LIVE_COUNT), $NEW_ENTRIES nouvelles entries en ${ELAPSED}s"
    # Fermer les sessions : envoyer /exit puis kill tmux
    for s in "${LIVE_SESSIONS[@]}"; do
      log "→ Fermeture de '$s'"
      tmux send-keys -t "$s" "/exit" 2>/dev/null || true
      sleep 0.5
      tmux send-keys -t "$s" Enter 2>/dev/null || true
    done
    # Laisser le temps à Claude Code de quitter proprement
    sleep 5
    for s in "${LIVE_SESSIONS[@]}"; do
      tmux kill-session -t "$s" 2>/dev/null || true
    done
    log "✓ Sessions fermées"
    echo "{\"status\":\"ok\",\"sessions_found\":$SESSION_COUNT,\"live_sessions\":$LIVE_COUNT,\"dead_sessions\":$DEAD_COUNT,\"sessions_idle\":$IDLE_COUNT,\"new_entries\":$NEW_ENTRIES,\"elapsed\":$ELAPSED}"
    exit 0
  fi

  log "  …${ELAPSED}s — $IDLE_COUNT/$LIVE_COUNT sessions idle, $NEW_ENTRIES nouvelles entries"
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# --- Timeout ---
ENTRIES_NOW=$(count_raw_files)
NEW_ENTRIES=$((ENTRIES_NOW - ENTRIES_BEFORE))
IDLE_COUNT=0
for s in "${LIVE_SESSIONS[@]}"; do
  session_is_idle "$s" && IDLE_COUNT=$((IDLE_COUNT + 1))
done
# Fermer les sessions idle malgré le timeout
for s in "${LIVE_SESSIONS[@]}"; do
  if session_is_idle "$s"; then
    log "→ Fermeture de '$s' (idle)"
    tmux send-keys -t "$s" "/exit" 2>/dev/null || true
    sleep 0.5
    tmux send-keys -t "$s" Enter 2>/dev/null || true
  else
    log "⚠ '$s' toujours active, non fermée"
  fi
done
sleep 5
for s in "${LIVE_SESSIONS[@]}"; do
  if session_is_idle "$s" || ! tmux has-session -t "$s" 2>/dev/null; then
    tmux kill-session -t "$s" 2>/dev/null || true
  fi
done
log "⚠ Timeout après ${ELAPSED}s — $IDLE_COUNT/$LIVE_COUNT idle, $NEW_ENTRIES nouvelles entries"
echo "{\"status\":\"timeout\",\"sessions_found\":$SESSION_COUNT,\"live_sessions\":$LIVE_COUNT,\"dead_sessions\":$DEAD_COUNT,\"sessions_idle\":$IDLE_COUNT,\"new_entries\":$NEW_ENTRIES,\"elapsed\":$ELAPSED}"
exit 1
