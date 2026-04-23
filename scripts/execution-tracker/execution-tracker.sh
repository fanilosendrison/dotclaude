#!/bin/bash
# execution-tracker.sh — Mesure la durée d'exécution d'une commande Claude Code
#   et produit un JSON consommable par un push Notion côté Claude.
#
# Contrat :
#   start --command <name>   → capture cwd, repo, branch, version, started_at → state file
#   stop  --status <status>  → lit state, calcule duration, émet JSON sur stdout, purge state
#   peek                     → affiche l'état courant (diagnostic, pas de stop)
#   reset                    → purge le state file
#   --help                   → usage
#
# State file : ~/.claude/scripts/execution-tracker/.tracker-state.json
# Config file : ~/.claude/scripts/execution-tracker/.tracker-config  (key=value, lu par Claude)
#
# Exit codes :
#   0  OK
#   1  state error (stop sans start prealable, state corrompu)
#   2  usage error (arg manquant, flag inconnu, subcommand inconnue)

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${SCRIPT_DIR}/.tracker-state.json"

usage() {
  cat <<EOF
Usage:
  $SCRIPT_NAME start --command <name>
  $SCRIPT_NAME stop --status <success|failure|partial>
  $SCRIPT_NAME peek
  $SCRIPT_NAME reset
  $SCRIPT_NAME --help

start : capture cwd/repo/branch/version/timestamp, persiste dans le state file.
stop  : lit le state, calcule la durée, émet le JSON consolidé sur stdout.
peek  : affiche le state courant (diagnostic, sans le consommer).
reset : purge le state file.

Les status valides pour stop :
  success   — tout s'est exécuté sans erreur
  failure   — abort sur étape critique
  partial   — une ou plusieurs étapes non-critiques ont échoué

State file : $STATE_FILE
EOF
}

err() { printf '%s: error: %s\n' "$SCRIPT_NAME" "$*" >&2; }

# ----- JSON helpers (no jq dependency) -----

# Escape a string for JSON: backslash, double-quote, newline, carriage return, tab.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# Extract a string field from the state file. Handles only the exact format
# produced by our own writer (one "key": value per line, JSON-escaped strings).
# Understands the escape sequences json_escape emits: \" \\ \n \r \t.
state_get() {
  local key="$1"
  awk -v k="\"$key\"" '
    {
      idx = index($0, k)
      if (idx == 0) next
      rest = substr($0, idx + length(k))
      sub(/^[[:space:]]*:[[:space:]]*/, "", rest)
      if (substr(rest, 1, 1) == "\"") {
        rest = substr(rest, 2)
        out = ""
        n = length(rest)
        i = 1
        while (i <= n) {
          c = substr(rest, i, 1)
          if (c == "\\" && i < n) {
            nc = substr(rest, i + 1, 1)
            if      (nc == "\"") out = out "\""
            else if (nc == "\\") out = out "\\"
            else if (nc == "n")  out = out "\n"
            else if (nc == "r")  out = out "\r"
            else if (nc == "t")  out = out "\t"
            else                 out = out nc
            i += 2
          } else if (c == "\"") {
            break
          } else {
            out = out c
            i++
          }
        }
        print out
      } else {
        sub(/[,}].*$/, "", rest)
        sub(/[[:space:]]+$/, "", rest)
        print rest
      }
      exit
    }
  ' "$STATE_FILE"
}

# ----- Detection helpers -----

detect_repo_name() {
  local cwd="$1"
  local top
  if top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)"; then
    basename "$top"
  else
    basename "$cwd"
  fi
}

detect_branch() {
  local cwd="$1"
  git -C "$cwd" branch --show-current 2>/dev/null || true
}

# Detect the project version from the most common manifests.
# Tries in order: package.json, pyproject.toml, Cargo.toml, VERSION, version.txt,
# workflow.yaml, latest git tag. Returns empty string if nothing found.
detect_version() {
  local cwd="$1"
  local v=""

  if [[ -f "$cwd/package.json" ]]; then
    v="$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$cwd/package.json" | head -1 \
      | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
    [[ -n "$v" ]] && { printf '%s' "$v"; return; }
  fi

  if [[ -f "$cwd/pyproject.toml" ]]; then
    v="$(grep -E '^[[:space:]]*version[[:space:]]*=' "$cwd/pyproject.toml" | head -1 \
      | sed -E 's/.*=[[:space:]]*"([^"]*)".*/\1/')"
    [[ -n "$v" ]] && { printf '%s' "$v"; return; }
  fi

  if [[ -f "$cwd/Cargo.toml" ]]; then
    v="$(awk '/^\[package\]/{inpkg=1; next} /^\[/{inpkg=0} inpkg && /^version[[:space:]]*=/ {
      sub(/.*=[[:space:]]*"/,""); sub(/".*/,""); print; exit
    }' "$cwd/Cargo.toml")"
    [[ -n "$v" ]] && { printf '%s' "$v"; return; }
  fi

  for f in VERSION version.txt; do
    if [[ -f "$cwd/$f" ]]; then
      v="$(head -1 "$cwd/$f" | tr -d '[:space:]')"
      [[ -n "$v" ]] && { printf '%s' "$v"; return; }
    fi
  done

  if [[ -f "$cwd/workflow.yaml" ]]; then
    v="$(awk '/^version:/ { sub(/^version:[[:space:]]*/,""); gsub(/["\047]/,""); sub(/[[:space:]]+$/,""); print; exit }' "$cwd/workflow.yaml")"
    [[ -n "$v" ]] && { printf '%s' "$v"; return; }
  fi

  v="$(git -C "$cwd" describe --tags --abbrev=0 2>/dev/null || true)"
  printf '%s' "$v"
}

# Human-readable duration formatting. Examples: "0s", "42s", "3m 07s", "1h 02m 03s".
format_duration() {
  local total="$1"
  if [[ $total -lt 0 ]]; then total=0; fi
  local h=$(( total / 3600 ))
  local m=$(( (total % 3600) / 60 ))
  local s=$(( total % 60 ))
  if (( h > 0 )); then
    printf '%dh %02dm %02ds' "$h" "$m" "$s"
  elif (( m > 0 )); then
    printf '%dm %02ds' "$m" "$s"
  else
    printf '%ds' "$s"
  fi
}

iso_utc() {
  # POSIX-portable: seconds-precision UTC ISO8601 with trailing Z.
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# ----- Subcommands -----

cmd_start() {
  local command_name=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --command)
        [[ $# -ge 2 ]] || { err "--command requires a value"; exit 2; }
        command_name="$2"; shift 2 ;;
      *)
        err "unknown arg for start: $1"; exit 2 ;;
    esac
  done

  if [[ -z "$command_name" ]]; then
    err "start requires --command <name>"
    exit 2
  fi

  local cwd repo branch version started_epoch started_iso
  cwd="$PWD"
  repo="$(detect_repo_name "$cwd")"
  branch="$(detect_branch "$cwd")"
  version="$(detect_version "$cwd")"
  started_epoch="$(date +%s)"
  started_iso="$(iso_utc)"

  # Write the state file. We keep fields as JSON strings + one epoch integer.
  cat > "$STATE_FILE" <<EOF
{
  "command": "$(json_escape "$command_name")",
  "cwd": "$(json_escape "$cwd")",
  "repo": "$(json_escape "$repo")",
  "branch": "$(json_escape "$branch")",
  "version": "$(json_escape "$version")",
  "started_at_iso": "$started_iso",
  "started_at_epoch": $started_epoch
}
EOF

  printf 'tracker: started "%s" at %s (repo=%s branch=%s version=%s)\n' \
    "$command_name" "$started_iso" "$repo" "${branch:--}" "${version:--}" >&2
}

cmd_stop() {
  local status=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status)
        [[ $# -ge 2 ]] || { err "--status requires a value"; exit 2; }
        status="$2"; shift 2 ;;
      *)
        err "unknown arg for stop: $1"; exit 2 ;;
    esac
  done

  if [[ -z "$status" ]]; then
    err "stop requires --status <success|failure|partial>"
    exit 2
  fi
  case "$status" in
    success|failure|partial) ;;
    *)
      err "invalid status: '$status' (expected: success|failure|partial)"
      exit 2 ;;
  esac

  if [[ ! -f "$STATE_FILE" ]]; then
    err "no active tracker state (did you call 'start'?)"
    exit 1
  fi

  local command_name cwd repo branch version started_iso started_epoch
  command_name="$(state_get command)"
  cwd="$(state_get cwd)"
  repo="$(state_get repo)"
  branch="$(state_get branch)"
  version="$(state_get version)"
  started_iso="$(state_get started_at_iso)"
  started_epoch="$(state_get started_at_epoch)"

  if [[ -z "$started_epoch" ]] || ! [[ "$started_epoch" =~ ^[0-9]+$ ]]; then
    err "state file corrupt: missing/invalid started_at_epoch"
    exit 1
  fi

  local ended_epoch ended_iso duration_seconds duration_human
  ended_epoch="$(date +%s)"
  ended_iso="$(iso_utc)"
  duration_seconds=$(( ended_epoch - started_epoch ))
  duration_human="$(format_duration "$duration_seconds")"

  cat <<EOF
{
  "command": "$(json_escape "$command_name")",
  "cwd": "$(json_escape "$cwd")",
  "repo": "$(json_escape "$repo")",
  "branch": "$(json_escape "$branch")",
  "version": "$(json_escape "$version")",
  "started_at_iso": "$(json_escape "$started_iso")",
  "ended_at_iso": "$ended_iso",
  "duration_seconds": $duration_seconds,
  "duration_human": "$(json_escape "$duration_human")",
  "status": "$status"
}
EOF

  rm -f "$STATE_FILE"
}

cmd_peek() {
  if [[ ! -f "$STATE_FILE" ]]; then
    printf 'no active tracker state\n' >&2
    exit 1
  fi
  cat "$STATE_FILE"
}

cmd_reset() {
  if [[ -f "$STATE_FILE" ]]; then
    rm -f "$STATE_FILE"
    printf 'tracker: state reset\n' >&2
  else
    printf 'tracker: nothing to reset\n' >&2
  fi
}

# ----- Entry point -----

if [[ $# -eq 0 ]]; then
  err "subcommand required"
  usage >&2
  exit 2
fi

sub="$1"; shift
case "$sub" in
  -h|--help|help) usage; exit 0 ;;
  start)  cmd_start "$@" ;;
  stop)   cmd_stop "$@" ;;
  peek)   cmd_peek "$@" ;;
  reset)  cmd_reset "$@" ;;
  *)
    err "unknown subcommand: $sub"
    usage >&2
    exit 2 ;;
esac
