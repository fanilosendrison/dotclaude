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

readonly MAX_CYCLES=40
readonly MAJOR_BATCH_SIZE=5
readonly STABILITY_WINDOW=3
readonly RUN_DIR_BASE=".claude/run/backlog-crush"
readonly RETENTION_DAYS=7
readonly BACKLOG_FILE="backlog.md"

readonly SESSION_ID="${BACKLOG_CRUSH_SESSION_ID:-${PPID:-$$}}"
readonly RUN_DIR="${RUN_DIR_BASE}/${SESSION_ID}"

# Skip threshold: after this many consecutive cycles with no fix on an item,
# `next-item` stops offering it (intra-session) AND `annotate-blocked` marks
# it as blocked in backlog.md at EXIT_STABLE (cross-session).
readonly SKIP_THRESHOLD=2

_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum | awk '{print $1}'
	else
		shasum -a 256 | awk '{print $1}'
	fi
}

_require_jq() {
	if ! command -v jq >/dev/null 2>&1; then
		echo "ERROR: backlog-crush requires jq. See loop-clean SKILL.md for install." >&2
		exit 2
	fi
}

_cleanup_old_runs() {
	local root="$RUN_DIR_BASE"
	[[ -d "$root" ]] || return 0
	local deleted=0
	while IFS= read -r -d '' dir; do
		if [[ "$dir" == "$RUN_DIR" ]]; then continue; fi
		if find "$dir" -depth -delete 2>/dev/null; then
			deleted=$((deleted + 1))
		fi
	done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null)
	if [[ "$deleted" -gt 0 ]]; then
		echo "backlog-crush: purged $deleted run(s) older than ${RETENTION_DAYS} days." >&2
	fi
}

_cycle_dir() {
	local n="$1"
	printf '%s/cycle-%03d' "$RUN_DIR" "$n"
}

_skip_counts_file() {
	echo "$RUN_DIR/skip-counts.json"
}

# Ensure the skip-counts sidecar exists as a valid empty JSON object.
_ensure_skip_counts() {
	local f
	f="$(_skip_counts_file)"
	[[ -f "$f" ]] || { mkdir -p "$(dirname "$f")" && echo '{}' > "$f"; }
}

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

# Bump the skip-count for each id. Used by the orchestrator after each cycle
# for items that were dispatched but not fixed (fixes_applied[] missed them).
# Takes a space-separated list of ids. No-op if list empty.
cmd_record_skip() {
	_require_jq
	local ids_arg="${1:-}"
	[[ -z "$ids_arg" ]] && return 0
	_ensure_skip_counts
	local skip_file
	skip_file="$(_skip_counts_file)"

	# Build a jq filter that increments each id's count. Using a set construction
	# keeps the filter O(N) rather than jq's reduce-over-entries (O(N·M)).
	local ids_json
	ids_json=$(printf '%s\n' $ids_arg | jq -R . | jq -sc .)
	local tmp
	tmp=$(mktemp)
	jq --argjson ids "$ids_json" \
		'reduce $ids[] as $id (.; .[$id] = ((.[$id] // 0) + 1))' \
		"$skip_file" > "$tmp"
	mv "$tmp" "$skip_file"
}

# Annotate blocked items in backlog.md. Called by the orchestrator when
# EXIT_STABLE fires (and only then), before finalize. Adds a suffix
# "(blocked: YYYY-MM-DD, skipped Nx)" to each item whose skip-count >=
# SKIP_THRESHOLD. Idempotent: items already containing "(blocked:" are left
# alone. Output on stderr.
cmd_annotate_blocked() {
	_require_jq
	_ensure_skip_counts
	[[ -f "$BACKLOG_FILE" ]] || return 0
	local skip_file
	skip_file="$(_skip_counts_file)"

	# Extract (id, count) pairs where count >= threshold.
	local blocked
	blocked=$(jq -r --argjson thr "$SKIP_THRESHOLD" \
		'to_entries[] | select(.value >= $thr) | "\(.key)\t\(.value)"' "$skip_file")
	[[ -z "$blocked" ]] && return 0

	# Fresh scan to map id → line number (items annotated in a previous call
	# are filtered out by _scan_backlog, so they won't be re-annotated).
	local tmp_map
	tmp_map=$(mktemp)
	_scan_backlog | jq -r '"\(.id)\t\(.line)"' > "$tmp_map"

	local today
	today=$(date -u +%Y-%m-%d)

	local annotated=0
	while IFS=$'\t' read -r id count; do
		[[ -z "$id" ]] && continue
		local target_line
		target_line=$(awk -v id="$id" '$1 == id {print $2; exit}' "$tmp_map")
		[[ -z "$target_line" ]] && continue
		local tmp_bk
		tmp_bk=$(mktemp)
		awk -v L="$target_line" -v D="$today" -v C="$count" '
			NR == L && $0 !~ /\(blocked:/ {
				$0 = $0 " (blocked: " D ", skipped " C "x)"
			}
			{ print }
		' "$BACKLOG_FILE" > "$tmp_bk"
		mv "$tmp_bk" "$BACKLOG_FILE"
		annotated=$((annotated + 1))
	done <<< "$blocked"
	rm -f "$tmp_map"
	echo "backlog-crush: annotated $annotated item(s) as blocked in $BACKLOG_FILE" >&2
}

# One-shot migration helper: move all legacy `(blocked: ..., skipped Nx)`
# items from backlog.md to design-queue.md as [escalated] entries. Use on
# repos that pre-date the escalate-stuck command — their backlog contains
# items frozen by the old annotate-blocked flow, invisible to any crush
# until the marker is removed manually. migrate-blocked unfreezes them
# all by surfacing them as design-queue escalations with origin metadata.
#
# Idempotent via destruction: migrated items disappear from backlog.md,
# so a second invocation is a no-op. Skip counts are NOT touched (the
# items are already out-of-flight).
cmd_migrate_blocked() {
	_require_jq
	[[ -f "$BACKLOG_FILE" ]] || return 0
	local design_file="design-queue.md"

	if [[ ! -f "$design_file" ]]; then
		cat > "$design_file" <<'EOF'
# Design queue

Items qui necessitent un arbitrage humain avant d'etre traduits en fix atomique. Ces items ne sont **pas** traites par `/backlog-crush` ou `/backlog-deep-crush`. Voir `~/.claude/skills/fix-or-backlog/SKILL.md` pour la convention de format et la logique d'escalade auto.

EOF
	fi

	local today
	today=$(date -u +%Y-%m-%d)
	local lines_to_remove
	lines_to_remove=$(mktemp)
	local migrated=0
	local n=0

	while IFS= read -r line; do
		n=$((n + 1))
		if [[ "$line" =~ ^-[[:space:]]+\[[[:space:]]\][[:space:]]+\[([^]]+)\][[:space:]].*\(blocked:[[:space:]]*([0-9]{4}-[0-9]{2}-[0-9]{2}),[[:space:]]*skipped[[:space:]]+([0-9]+)x\) ]]; then
			local severity first_blocked_date skipped_count
			severity=$(printf '%s\n' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')
			first_blocked_date="${BASH_REMATCH[2]}"
			skipped_count="${BASH_REMATCH[3]}"

			local stripped
			stripped=$(printf '%s\n' "$line" | sed -E \
				-e 's/^-[[:space:]]+\[[[:space:]]\][[:space:]]+\[[^]]+\][[:space:]]*//' \
				-e 's/[[:space:]]*\(blocked:[[:space:]]*[0-9-]+,[[:space:]]*skipped[[:space:]]+[0-9]+x\)[[:space:]]*$//')

			local input="backlog|${n}|${line:0:80}"
			local id
			id=$(printf '%s' "$input" | _sha256 | cut -c1-16)

			{
				printf '%s\n' "- [ ] [escalated] $stripped"
				echo "  - origin_severity: $severity"
				echo "  - origin_id: $id"
				echo "  - skipped_count: $skipped_count"
				echo "  - first_blocked_on: $first_blocked_date"
				echo "  - escalated_on: $today"
				echo "  - why: legacy-blocked item migrated to design-queue via \`migrate-blocked\`. Was invisible to crush since $first_blocked_date."
				echo "  - cta: decide — retry (move back to backlog.md without marker), drop (resolve via code + check off), or redefine scope (rewrite + move back)."
				echo ""
			} >> "$design_file"

			echo "$n" >> "$lines_to_remove"
			migrated=$((migrated + 1))
		fi
	done < "$BACKLOG_FILE"

	if [[ "$migrated" -gt 0 ]]; then
		local drop_list
		drop_list=$(sort -u "$lines_to_remove" | tr '\n' ',' | sed 's/,$//')
		local tmp_bk
		tmp_bk=$(mktemp)
		awk -v lines="$drop_list" '
			BEGIN {
				n = split(lines, arr, ",")
				for (i = 1; i <= n; i++) if (arr[i] != "") drop[arr[i]+0] = 1
			}
			!(NR in drop) { print }
		' "$BACKLOG_FILE" > "$tmp_bk"
		mv "$tmp_bk" "$BACKLOG_FILE"
	fi

	rm -f "$lines_to_remove"
	echo "backlog-crush: migrated $migrated legacy-blocked item(s) to $design_file" >&2
}

# Escalate items with skip_count >= SKIP_THRESHOLD to design-queue.md.
# Physically moves each stuck item out of backlog.md and appends an
# "[escalated]" entry in design-queue.md with origin metadata. Called
# by the orchestrator at EXIT_STABLE INSTEAD of annotate-blocked — the
# two are alternatives: annotate marks items as blocked in place,
# escalate moves them to a separate human-facing queue.
#
# Idempotent: items already absent from backlog.md (previously escalated)
# are no-ops. Skip counts for escalated ids are cleared from the sidecar.
cmd_escalate_stuck() {
	_require_jq
	_ensure_skip_counts
	[[ -f "$BACKLOG_FILE" ]] || return 0
	local skip_file
	skip_file="$(_skip_counts_file)"
	local design_file="design-queue.md"

	local stuck_data
	stuck_data=$(jq -r --argjson thr "$SKIP_THRESHOLD" \
		'to_entries[] | select(.value >= $thr) | "\(.key)\t\(.value)"' "$skip_file")
	[[ -z "$stuck_data" ]] && return 0

	local tmp_map
	tmp_map=$(mktemp)
	_scan_backlog > "$tmp_map"

	if [[ ! -f "$design_file" ]]; then
		cat > "$design_file" <<'EOF'
# Design queue

Items qui necessitent un arbitrage humain avant d'etre traduits en fix atomique. Ces items ne sont **pas** traites par `/backlog-crush` ou `/backlog-deep-crush`. Voir `~/.claude/skills/fix-or-backlog/SKILL.md` pour la convention de format et la logique d'escalade auto.

EOF
	fi

	local today
	today=$(date -u +%Y-%m-%d)
	local lines_to_remove
	lines_to_remove=$(mktemp)
	local escalated_ids=()
	local escalated=0

	while IFS=$'\t' read -r id count; do
		[[ -z "$id" ]] && continue
		local entry
		entry=$(jq -rc --arg id "$id" 'select(.id == $id)' "$tmp_map" | head -1)
		[[ -z "$entry" ]] && continue
		local line_num severity raw
		line_num=$(printf '%s\n' "$entry" | jq -r '.line')
		severity=$(printf '%s\n' "$entry" | jq -r '.severity')
		raw=$(printf '%s\n' "$entry" | jq -r '.raw')

		local stripped
		stripped=$(printf '%s\n' "$raw" | sed -E 's/^-[[:space:]]+\[[[:space:]]\][[:space:]]+\[[^]]+\][[:space:]]*//')

		{
			printf '%s\n' "- [ ] [escalated] $stripped"
			echo "  - origin_severity: $severity"
			echo "  - origin_id: $id"
			echo "  - skipped_count: $count"
			echo "  - escalated_on: $today"
			echo "  - why: recurrent defensive skip by backlog-fix after $count cycle(s). Likely cause: scope too large, spec ambiguity, or pending product decision."
			echo "  - cta: examine manually. See \`.claude/run/backlog-crush/*/\` for sub-agent skip reasons."
			echo ""
		} >> "$design_file"

		echo "$line_num" >> "$lines_to_remove"
		escalated_ids+=("$id")
		escalated=$((escalated + 1))
	done <<< "$stuck_data"

	if [[ "$escalated" -gt 0 ]]; then
		local drop_list
		drop_list=$(sort -u "$lines_to_remove" | tr '\n' ',' | sed 's/,$//')
		local tmp_bk
		tmp_bk=$(mktemp)
		awk -v lines="$drop_list" '
			BEGIN {
				n = split(lines, arr, ",")
				for (i = 1; i <= n; i++) if (arr[i] != "") drop[arr[i]+0] = 1
			}
			!(NR in drop) { print }
		' "$BACKLOG_FILE" > "$tmp_bk"
		mv "$tmp_bk" "$BACKLOG_FILE"

		# Clear skip counts for escalated ids — they no longer live in backlog.md.
		local ids_json
		ids_json=$(printf '%s\n' "${escalated_ids[@]}" | jq -R . | jq -s .)
		local tmp_sk
		tmp_sk=$(mktemp)
		jq --argjson ids "$ids_json" \
			'reduce $ids[] as $id (.; del(.[$id]))' \
			"$skip_file" > "$tmp_sk"
		mv "$tmp_sk" "$skip_file"
	fi

	rm -f "$tmp_map" "$lines_to_remove"
	echo "backlog-crush: escalated $escalated item(s) to $design_file" >&2
}

# Mark each id as done by flipping "[ ]" to "[x]" on the matching line.
# Arguments: space-separated list of ids (as produced by next-item).
cmd_mark_done() {
	_require_jq
	local ids_arg="${1:-}"
	[[ -z "$ids_arg" ]] && return 0
	[[ -f "$BACKLOG_FILE" ]] || return 0

	# Build a map id → line_number from a fresh scan.
	local tmp_map
	tmp_map=$(mktemp)
	_scan_backlog | jq -r '"\(.id)\t\(.line)"' > "$tmp_map"

	local marked=0
	for id in $ids_arg; do
		local target_line
		target_line=$(awk -v id="$id" '$1 == id {print $2; exit}' "$tmp_map")
		if [[ -z "$target_line" ]]; then
			echo "backlog-crush: id $id not found in backlog (already marked?)" >&2
			continue
		fi
		# Portable in-place sed: write to temp, replace.
		local tmp_bk
		tmp_bk=$(mktemp)
		awk -v L="$target_line" 'NR == L { sub(/\[ \]/, "[x]") } { print }' "$BACKLOG_FILE" > "$tmp_bk"
		mv "$tmp_bk" "$BACKLOG_FILE"
		marked=$((marked + 1))
	done
	rm -f "$tmp_map"
	echo "backlog-crush: marked $marked item(s) as done." >&2
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

	cat <<EOF
# backlog-crush report

- Session: $SESSION_ID
- RUN_DIR: $RUN_DIR
- Cycles executed: $cycles
- Final action: $final_action
- Pending (critical+major) at start: $initial
- Pending (critical+major) at end: $final_pending

Per-cycle decisions: $RUN_DIR/cycle-*/decision.json
EOF
}

cmd_cleanup() {
	_cleanup_old_runs
	if [[ -d "$RUN_DIR_BASE" ]]; then
		local remaining
		remaining=$(find "$RUN_DIR_BASE" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
		echo "backlog-crush: $remaining run(s) remaining under $RUN_DIR_BASE/"
	else
		echo "backlog-crush: no $RUN_DIR_BASE/ directory present."
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
