#!/usr/bin/env bash
# backlog-deep-crush.sh — Nocturnal variant of backlog-crush. Iterates through
# ALL 5 severities (critical → major → notable → minor → nit) in strict
# priority order, asking Claude to fix each cycle and re-run /loop-clean
# between cycles. Never makes semantic decisions.
#
# Usage (driven by backlog-deep-crush/SKILL.md):
#   bash backlog-deep-crush.sh init
#   bash backlog-deep-crush.sh next-item
#   bash backlog-deep-crush.sh mark-done "<id1> <id2> ..."
#   bash backlog-deep-crush.sh decide <N>
#   bash backlog-deep-crush.sh finalize
#   bash backlog-deep-crush.sh cleanup

set -euo pipefail

if ! REPO_ROOT="$(git rev-parse --show-toplevel)"; then
	echo "ERROR: backlog-deep-crush must run inside a Git repository" >&2
	exit 2
fi
readonly REPO_ROOT
readonly MAX_CYCLES="${DEEP_CRUSH_MAX_CYCLES:-80}"
# Window=3 (match parent backlog-crush): window=2 was too aggressive given the
# waterfall model (total can stay flat during tier transitions critical→major
# →notable→minor→nit even when work is progressing).
readonly STABILITY_WINDOW=3
readonly RUN_DIR_BASE="$REPO_ROOT/.claude/run/backlog-deep-crush"
readonly RETENTION_DAYS=7
readonly BACKLOG_FILE="$REPO_ROOT/backlog.md"
readonly SCRIPT_NAME="backlog-deep-crush"

# Batch sizes per severity. Priority enforced by cmd_next_item.
readonly CRITICAL_BATCH_SIZE=1
readonly MAJOR_BATCH_SIZE=5
readonly NOTABLE_BATCH_SIZE=6
readonly MINOR_BATCH_SIZE=8
readonly NIT_BATCH_SIZE=10

readonly SESSION_ID="${BACKLOG_DEEP_CRUSH_SESSION_ID:-${PPID:-$$}}"
readonly RUN_DIR="${RUN_DIR_BASE}/${SESSION_ID}"

# Skip threshold: after this many consecutive cycles with no fix on an item,
# `next-item` stops offering it (intra-session) AND `annotate-blocked` marks
# it as blocked in backlog.md at EXIT_STABLE (cross-session).
readonly SKIP_THRESHOLD=2

# Source shared utilities (_sha256, _require_jq, _cleanup_old_runs, etc.)
# and shared commands (cmd_record_skip, cmd_mark_done, cmd_escalate_stuck, etc.).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/backlog-common.sh
source "$SCRIPT_DIR/../lib/backlog-common.sh"

# Parse backlog.md, emit JSONL of (id, severity, line_number, raw_line) for
# every UNCHECKED item matching "- [ ] [critical|major|notable|minor|nit] ...".
# id = sha256("backlog|" + line_number + "|" + raw_line.slice(0,80)).slice(0,16)
#
# Items already annotated with "(blocked:" are excluded from the pending set
# — they're considered out-of-band until the human edits the marker away.
_scan_backlog() {
	[[ -f "$BACKLOG_FILE" ]] || return 0
	local n=0
	while IFS= read -r line; do
		n=$((n + 1))
		if [[ "$line" == *"(blocked:"* ]]; then
			continue
		fi
		if [[ "$line" =~ ^[[:space:]]*-[[:space:]]+\[[[:space:]]+\][[:space:]]+\[([Cc][Rr][Ii][Tt][Ii][Cc][Aa][Ll]|[Mm][Aa][Jj][Oo][Rr]|[Nn][Oo][Tt][Aa][Bb][Ll][Ee]|[Mm][Ii][Nn][Oo][Rr]|[Nn][Ii][Tt])\][[:space:]] ]]; then
			local sev
			sev=$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')
			local input="backlog|${n}|${line:0:80}"
			local id
			id=$(printf '%s' "$input" | _sha256 | cut -c1-16)
			jq -nc \
				--arg id "$id" \
				--arg severity "$sev" \
				--argjson line "$n" \
				--arg raw "$line" \
				'{id: $id, severity: $severity, line: $line, raw: $raw}'
		fi
	done < "$BACKLOG_FILE"
}

# Count unchecked items across all 5 severities.
_count_pending() {
	_scan_backlog | wc -l | tr -d ' '
}

# Count per-severity (emits "critical major notable minor nit" on stdout).
_count_by_severity() {
	local items
	items=$(_scan_backlog)
	if [[ -z "$items" ]]; then
		echo "0 0 0 0 0"
		return 0
	fi
	local c m n mi ni
	c=$(printf '%s\n' "$items" | jq -c 'select(.severity == "critical")' | wc -l | tr -d ' ')
	m=$(printf '%s\n' "$items" | jq -c 'select(.severity == "major")' | wc -l | tr -d ' ')
	n=$(printf '%s\n' "$items" | jq -c 'select(.severity == "notable")' | wc -l | tr -d ' ')
	mi=$(printf '%s\n' "$items" | jq -c 'select(.severity == "minor")' | wc -l | tr -d ' ')
	ni=$(printf '%s\n' "$items" | jq -c 'select(.severity == "nit")' | wc -l | tr -d ' ')
	echo "$c $m $n $mi $ni"
}

cmd_init() {
	_require_jq
	mkdir -p "$RUN_DIR"
	_cleanup_old_runs

	if [[ -f "$BACKLOG_FILE" ]]; then
		cp "$BACKLOG_FILE" "$RUN_DIR/backlog-baseline.md"
	else
		touch "$RUN_DIR/backlog-baseline.md"
	fi

	local pending
	pending=$(_count_pending)
	echo "$pending" > "$RUN_DIR/initial-pending"

	# Snapshot per-severity baseline for finalize report.
	_count_by_severity > "$RUN_DIR/initial-by-severity"

	# Non-blocking warning if not invoked nocturnally. The Routine should
	# export DEEP_CRUSH_NOCTURNAL=1 to suppress this.
	if [[ -z "${DEEP_CRUSH_NOCTURNAL:-}" ]]; then
		echo "backlog-deep-crush: WARNING — running outside nocturnal context. This skill processes all 5 severities including nit and can consume significant time. Prefer /backlog-crush in daytime." >&2
	fi

	cat <<EOF
BACKLOG_DEEP_CRUSH_RUN_DIR="$RUN_DIR"
BACKLOG_DEEP_CRUSH_SESSION_ID="$SESSION_ID"
BACKLOG_DEEP_CRUSH_INITIAL_PENDING="$pending"
EOF
}

# Emit up to N items to work on in the current cycle, following strict
# priority: critical > major > notable > minor > nit.
# Only one severity tier per cycle (never mix).
# Items whose intra-session skip-count >= SKIP_THRESHOLD are filtered out
# (starvation fix: blocked items don't mask tractable ones downstream).
# Empty output = nothing actionable left to crush this cycle.
cmd_next_item() {
	_require_jq
	_ensure_skip_counts
	local skip_file
	skip_file="$(_skip_counts_file)"

	local items
	items=$(_scan_backlog)
	[[ -z "$items" ]] && return 0

	# Filter out items whose skip-count has reached the threshold.
	local filtered
	filtered=$(printf '%s\n' "$items" | jq -c --slurpfile sk "$skip_file" \
		--argjson thr "$SKIP_THRESHOLD" \
		'. as $item | ($sk[0][$item.id] // 0) as $c | select($c < $thr)')
	[[ -z "$filtered" ]] && return 0

	local criticals
	criticals=$(printf '%s\n' "$filtered" | jq -c 'select(.severity == "critical")')
	if [[ -n "$criticals" ]]; then
		printf '%s\n' "$criticals" | head -n "$CRITICAL_BATCH_SIZE"
		return 0
	fi

	local majors
	majors=$(printf '%s\n' "$filtered" | jq -c 'select(.severity == "major")')
	if [[ -n "$majors" ]]; then
		printf '%s\n' "$majors" | head -n "$MAJOR_BATCH_SIZE"
		return 0
	fi

	local notables
	notables=$(printf '%s\n' "$filtered" | jq -c 'select(.severity == "notable")')
	if [[ -n "$notables" ]]; then
		printf '%s\n' "$notables" | head -n "$NOTABLE_BATCH_SIZE"
		return 0
	fi

	local minors
	minors=$(printf '%s\n' "$filtered" | jq -c 'select(.severity == "minor")')
	if [[ -n "$minors" ]]; then
		printf '%s\n' "$minors" | head -n "$MINOR_BATCH_SIZE"
		return 0
	fi

	printf '%s\n' "$filtered" | jq -c 'select(.severity == "nit")' | head -n "$NIT_BATCH_SIZE"
}

cmd_decide() {
	_require_jq
	local n="$1"
	local dir
	dir="$(_cycle_dir "$n")"
	mkdir -p "$dir"

	local pending
	pending=$(_count_pending)

	local action="CONTINUE"
	local reason=""

	if [[ "$pending" -eq 0 ]]; then
		action="EXIT_DONE"
		reason="no items left in backlog across all severities"
	fi

	if [[ "$action" == "CONTINUE" && "$n" -ge $((MAX_CYCLES - 1)) ]]; then
		action="EXIT_CEILING"
		reason="reached MAX_CYCLES=$MAX_CYCLES"
	fi

	# EXIT_STABLE: count did not strictly decrease over the last
	# STABILITY_WINDOW cycles. Window=3 (matches backlog-crush): window=2
	# triggered spurious exits during healthy tier transitions
	# (critical→major→notable→minor→nit) where the total can stay flat
	# for a cycle even when work is progressing.
	if [[ "$action" == "CONTINUE" && "$n" -ge "$STABILITY_WINDOW" ]]; then
		local stable_count=0
		local prev_pending
		prev_pending="$pending"
		local i
		for ((i = n - 1; i >= n - STABILITY_WINDOW; i--)); do
			local prev_file
			prev_file="$(_cycle_dir "$i")/decision.json"
			if [[ ! -f "$prev_file" ]]; then
				break
			fi
			local p
			p=$(jq -r '.pending_after // 0' "$prev_file")
			if [[ "$prev_pending" -ge "$p" ]]; then
				stable_count=$((stable_count + 1))
			else
				break
			fi
			prev_pending="$p"
		done
		if [[ "$stable_count" -ge "$STABILITY_WINDOW" ]]; then
			action="EXIT_STABLE"
			reason="pending count did not strictly decrease over last $STABILITY_WINDOW cycles"
		fi
	fi

	jq -n \
		--argjson cycle "$n" \
		--arg action "$action" \
		--arg reason "$reason" \
		--argjson pending_after "$pending" \
		'{
			cycle: $cycle,
			action: $action,
			reason: $reason,
			pending_after: $pending_after
		}' > "$dir/decision.json"

	echo "$action"
}

cmd_finalize() {
	_require_jq
	local cycles=0
	local final_action="UNKNOWN"
	local final_pending="?"

	for i in $(seq 0 $((MAX_CYCLES - 1))); do
		local dir
		dir="$(_cycle_dir "$i")"
		[[ -d "$dir" ]] || break
		cycles=$((cycles + 1))
		if [[ -f "$dir/decision.json" ]]; then
			final_action=$(jq -r '.action // "UNKNOWN"' "$dir/decision.json")
			final_pending=$(jq -r '.pending_after // "?"' "$dir/decision.json")
		fi
	done

	local initial
	initial=$(cat "$RUN_DIR/initial-pending" 2>/dev/null || echo "?")

	local initial_by_sev
	initial_by_sev=$(cat "$RUN_DIR/initial-by-severity" 2>/dev/null || echo "0 0 0 0 0")
	local final_by_sev
	final_by_sev=$(_count_by_severity)

	# Array-read with indexed access: guards against malformed baseline (missing
	# or extra tokens) and avoids `in` as a variable name (bash-keyword landmine).
	local -a init_arr=() final_arr=()
	read -r -a init_arr <<<"$initial_by_sev"
	read -r -a final_arr <<<"$final_by_sev"
	local ic=${init_arr[0]:-0} im=${init_arr[1]:-0} ino=${init_arr[2]:-0} imi=${init_arr[3]:-0} ini=${init_arr[4]:-0}
	local fc=${final_arr[0]:-0} fm=${final_arr[1]:-0} fno=${final_arr[2]:-0} fmi=${final_arr[3]:-0} fni=${final_arr[4]:-0}

	# max(0, start - end) guards against regeneration (/loop-clean may add new
	# items during the session, making end > start — "Fixed" must not go negative).
	local dc=$((ic - fc)); (( dc < 0 )) && dc=0
	local dm=$((im - fm)); (( dm < 0 )) && dm=0
	local dno=$((ino - fno)); (( dno < 0 )) && dno=0
	local dmi=$((imi - fmi)); (( dmi < 0 )) && dmi=0
	local dni=$((ini - fni)); (( dni < 0 )) && dni=0

	cat <<EOF
# backlog-deep-crush report

- Session: $SESSION_ID
- RUN_DIR: $RUN_DIR
- Cycles executed: $cycles
- Final action: $final_action
- Total pending at start: $initial
- Total pending at end: $final_pending

## Per-severity breakdown

| Severity | Start | End | Fixed |
|----------|-------|-----|-------|
| critical | $ic | $fc | $dc |
| major    | $im | $fm | $dm |
| notable  | $ino | $fno | $dno |
| minor    | $imi | $fmi | $dmi |
| nit      | $ini | $fni | $dni |

Note: "Fixed" is max(0, Start - End). If new items were added during the run,
Start + Fixed may not equal End. Inspect decision.json for live counts.

Per-cycle decisions: $RUN_DIR/cycle-*/decision.json
EOF
}

cmd_cleanup() {
	_cleanup_old_runs
	if [[ -d "$RUN_DIR_BASE" ]]; then
		local remaining
		remaining=$(find "$RUN_DIR_BASE" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
		echo "$SCRIPT_NAME: $remaining run(s) remaining under $RUN_DIR_BASE/"
	else
		echo "$SCRIPT_NAME: no $RUN_DIR_BASE/ directory present."
	fi
}

usage() {
	cat >&2 <<EOF
Usage:
  backlog-deep-crush.sh init
  backlog-deep-crush.sh next-item
  backlog-deep-crush.sh mark-done "<id1> <id2> ..."
  backlog-deep-crush.sh record-skip "<id1> <id2> ..."  # bump skip-count for items not fixed this cycle
  backlog-deep-crush.sh annotate-blocked               # legacy: add "(blocked: ...)" marker in place
  backlog-deep-crush.sh escalate-stuck                 # move items with skip_count >= threshold to design-queue.md (preferred at EXIT_STABLE)
  backlog-deep-crush.sh migrate-blocked                # one-shot: migrate legacy "(blocked: ...)" items from backlog.md to design-queue.md
  backlog-deep-crush.sh decide <N>
  backlog-deep-crush.sh finalize
  backlog-deep-crush.sh cleanup
EOF
	exit 2
}

main() {
	if [[ $# -lt 1 ]]; then usage; fi
	local cmd="$1"
	shift
	case "$cmd" in
		init) cmd_init "$@" ;;
		next-item) cmd_next_item "$@" ;;
		mark-done) cmd_mark_done "${1:-}" ;;
		record-skip) cmd_record_skip "${1:-}" ;;
		annotate-blocked) cmd_annotate_blocked ;;
		escalate-stuck) cmd_escalate_stuck ;;
		migrate-blocked) cmd_migrate_blocked ;;
		decide)
			if [[ $# -lt 1 ]]; then usage; fi
			cmd_decide "$1"
			;;
		finalize) cmd_finalize ;;
		cleanup) cmd_cleanup ;;
		*) usage ;;
	esac
}

main "$@"
