#!/usr/bin/env bash
# backlog-crush.sh — Deterministic orchestrator for post-loop-clean backlog
# reduction. Iterates through critical (one at a time) and major (batch of 5)
# items from backlog.md, asking Claude to fix each and re-run /loop-clean
# between cycles. Never makes semantic decisions.
#
# Usage (driven by backlog-crush/SKILL.md):
#   bash backlog-crush.sh init
#   bash backlog-crush.sh next-item
#   bash backlog-crush.sh mark-done "<id1> <id2> ..."
#   bash backlog-crush.sh decide <N>
#   bash backlog-crush.sh finalize
#   bash backlog-crush.sh cleanup

set -euo pipefail

if ! REPO_ROOT="$(git rev-parse --show-toplevel)"; then
	echo "ERROR: backlog-crush must run inside a Git repository" >&2
	exit 2
fi
readonly REPO_ROOT
readonly MAX_CYCLES=40
readonly MAJOR_BATCH_SIZE=5
readonly STABILITY_WINDOW=3
readonly RUN_DIR_BASE="$REPO_ROOT/.claude/run/backlog-crush"
readonly RETENTION_DAYS=7
readonly BACKLOG_FILE="$REPO_ROOT/backlog.md"
readonly SCRIPT_NAME="backlog-crush"

readonly SESSION_ID="${BACKLOG_CRUSH_SESSION_ID:-${PPID:-$$}}"
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
# every UNCHECKED item matching "- [ ] [critical|major] ...".
# id = sha256("backlog|" + line_number + "|" + raw_line.slice(0,80)).slice(0,16)
#
# Items already annotated with "(blocked:" are excluded from the pending set
# — they're considered out-of-band until the human edits the marker away.
_scan_backlog() {
	[[ -f "$BACKLOG_FILE" ]] || return 0
	local n=0
	while IFS= read -r line; do
		n=$((n + 1))
		# Skip items annotated as blocked (cross-session memory).
		if [[ "$line" == *"(blocked:"* ]]; then
			continue
		fi
		# Strict match: checkbox unchecked, severity in {critical, major}.
		if [[ "$line" =~ ^[[:space:]]*-[[:space:]]+\[[[:space:]]+\][[:space:]]+\[([Cc][Rr][Ii][Tt][Ii][Cc][Aa][Ll]|[Mm][Aa][Jj][Oo][Rr])\][[:space:]] ]]; then
			local sev
			sev=$(echo "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')
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

# Count unchecked critical+major items.
_count_pending() {
	_scan_backlog | wc -l | tr -d ' '
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

	cat <<EOF
BACKLOG_CRUSH_RUN_DIR="$RUN_DIR"
BACKLOG_CRUSH_SESSION_ID="$SESSION_ID"
BACKLOG_CRUSH_INITIAL_PENDING="$pending"
EOF
}

# Emit up to N items to work on in the current cycle.
# Rules:
#   - Items whose intra-session skip-count >= SKIP_THRESHOLD are filtered out
#     (starvation fix: blocked items don't mask tractable ones downstream).
#   - If at least one critical remains → emit the first critical (N=1).
#   - Otherwise, emit up to MAJOR_BATCH_SIZE majors (FIFO).
#   - Empty output = nothing actionable left to crush this cycle.
cmd_next_item() {
	_require_jq
	_ensure_skip_counts
	local skip_file
	skip_file="$(_skip_counts_file)"

	local items
	items=$(_scan_backlog)
	[[ -z "$items" ]] && return 0

	# Filter out items whose skip-count has reached the threshold. Reads the
	# current count per id from the sidecar; items absent from the sidecar
	# have an implicit count of 0 and pass through.
	local filtered
	filtered=$(printf '%s\n' "$items" | jq -c --slurpfile sk "$skip_file" \
		--argjson thr "$SKIP_THRESHOLD" \
		'. as $item | ($sk[0][$item.id] // 0) as $c | select($c < $thr)')
	[[ -z "$filtered" ]] && return 0

	local criticals
	criticals=$(printf '%s\n' "$filtered" | jq -c 'select(.severity == "critical")')
	if [[ -n "$criticals" ]]; then
		printf '%s\n' "$criticals" | head -n 1
		return 0
	fi

	printf '%s\n' "$filtered" | jq -c 'select(.severity == "major")' | head -n "$MAJOR_BATCH_SIZE"
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

	# EXIT_DONE: nothing left to crush.
	if [[ "$pending" -eq 0 ]]; then
		action="EXIT_DONE"
		reason="no critical or major items left in backlog"
	fi

	# EXIT_CEILING.
	if [[ "$action" == "CONTINUE" && "$n" -ge $((MAX_CYCLES - 1)) ]]; then
		action="EXIT_CEILING"
		reason="reached MAX_CYCLES=$MAX_CYCLES"
	fi

	# EXIT_STABLE: count did not strictly decrease over the last
	# STABILITY_WINDOW cycles. Requires at least STABILITY_WINDOW prior cycles.
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

	local archived
	archived=$(cmd_sweep_resolved)

	cat <<EOF
# backlog-crush report

- Session: $SESSION_ID
- RUN_DIR: $RUN_DIR
- Cycles executed: $cycles
- Final action: $final_action
- Pending (critical+major) at start: $initial
- Pending (critical+major) at end: $final_pending
- Resolved items archived to backlog.archive.md: $archived

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
  backlog-crush.sh init
  backlog-crush.sh next-item
  backlog-crush.sh mark-done "<id1> <id2> ..."
  backlog-crush.sh record-skip "<id1> <id2> ..."  # bump skip-count for items not fixed this cycle
  backlog-crush.sh annotate-blocked               # legacy: add "(blocked: ...)" marker in place
  backlog-crush.sh escalate-stuck                 # move items with skip_count >= threshold to design-queue.md (preferred at EXIT_STABLE)
  backlog-crush.sh migrate-blocked                # one-shot: migrate legacy "(blocked: ...)" items from backlog.md to design-queue.md
  backlog-crush.sh sweep-resolved                 # archive every "- [x] " item from backlog.md to backlog.archive.md (auto-invoked by finalize)
  backlog-crush.sh decide <N>
  backlog-crush.sh finalize
  backlog-crush.sh cleanup
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
		sweep-resolved) cmd_sweep_resolved ;;
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
