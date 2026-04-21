#!/usr/bin/env bash
# backlog-common.sh — Shared utilities for backlog-crush.sh and
# backlog-deep-crush.sh. Sourced (not executed) by each orchestrator.
#
# Required variables that the caller MUST set before sourcing:
#   SCRIPT_NAME        — log prefix ("backlog-crush" | "backlog-deep-crush")
#   RUN_DIR_BASE       — base path for run directories
#   RUN_DIR            — active run directory for the session
#   BACKLOG_FILE       — path to backlog.md (usually "backlog.md")
#   RETENTION_DAYS     — how long to keep old runs
#   SKIP_THRESHOLD     — skip-count before an item is excluded from next-item
#
# Provided functions (utilities):
#   _sha256, _require_jq, _cleanup_old_runs, _cycle_dir, _skip_counts_file,
#   _ensure_skip_counts, _ensure_design_queue
#
# Provided functions (commands):
#   cmd_record_skip, cmd_annotate_blocked, cmd_migrate_blocked,
#   cmd_escalate_stuck, cmd_mark_done, cmd_sweep_resolved

# ---------------------------------------------------------------------------
# Portability utilities
# ---------------------------------------------------------------------------

_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum | awk '{print $1}'
	else
		shasum -a 256 | awk '{print $1}'
	fi
}

_require_jq() {
	if ! command -v jq >/dev/null 2>&1; then
		echo "ERROR: $SCRIPT_NAME requires jq. See loop-clean SKILL.md for install." >&2
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
		echo "$SCRIPT_NAME: purged $deleted run(s) older than ${RETENTION_DAYS} days." >&2
	fi
}

_cycle_dir() {
	local n="$1"
	printf '%s/cycle-%03d' "$RUN_DIR" "$n"
}

_skip_counts_file() {
	echo "$RUN_DIR/skip-counts.json"
}

_ensure_skip_counts() {
	local f
	f="$(_skip_counts_file)"
	[[ -f "$f" ]] || { mkdir -p "$(dirname "$f")" && echo '{}' > "$f"; }
}

# Ensure design-queue.md exists with standard header. Shared by
# cmd_migrate_blocked and cmd_escalate_stuck (dedup items 1 & 3).
_ensure_design_queue() {
	local design_file="${1:-design-queue.md}"
	if [[ ! -f "$design_file" ]]; then
		cat > "$design_file" <<'EOF'
# Design queue

Items qui necessitent un arbitrage humain avant d'etre traduits en fix atomique. Ces items ne sont **pas** traites par `/backlog-crush` ou `/backlog-deep-crush`. Voir `~/.claude/skills/fix-or-backlog/SKILL.md` pour la convention de format et la logique d'escalade auto.

EOF
	fi
}

# ---------------------------------------------------------------------------
# Shared commands
# ---------------------------------------------------------------------------

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

	local ids_json
	ids_json=$(printf '%s\n' $ids_arg | jq -R . | jq -sc .)
	local tmp
	tmp=$(mktemp)
	jq --argjson ids "$ids_json" \
		'reduce $ids[] as $id (.; .[$id] = ((.[$id] // 0) + 1))' \
		"$skip_file" > "$tmp"
	mv "$tmp" "$skip_file"
}

# Annotate blocked items in backlog.md (legacy — prefer escalate-stuck).
# Called by the orchestrator when EXIT_STABLE fires, before finalize. Adds a
# suffix "(blocked: YYYY-MM-DD, skipped Nx)" to each item whose skip-count >=
# SKIP_THRESHOLD. Idempotent.
cmd_annotate_blocked() {
	_require_jq
	_ensure_skip_counts
	[[ -f "$BACKLOG_FILE" ]] || return 0
	local skip_file
	skip_file="$(_skip_counts_file)"

	local blocked
	blocked=$(jq -r --argjson thr "$SKIP_THRESHOLD" \
		'to_entries[] | select(.value >= $thr) | "\(.key)\t\(.value)"' "$skip_file")
	[[ -z "$blocked" ]] && return 0

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
	echo "$SCRIPT_NAME: annotated $annotated item(s) as blocked in $BACKLOG_FILE" >&2
}

# One-shot migration: move legacy `(blocked: ...)` items to design-queue.md.
cmd_migrate_blocked() {
	_require_jq
	[[ -f "$BACKLOG_FILE" ]] || return 0
	local design_file="design-queue.md"
	_ensure_design_queue "$design_file"

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
	echo "$SCRIPT_NAME: migrated $migrated legacy-blocked item(s) to $design_file" >&2
}

# Escalate items with skip_count >= SKIP_THRESHOLD to design-queue.md.
# Physically moves each stuck item out of backlog.md and appends an
# "[escalated]" entry in design-queue.md with origin metadata.
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

	_ensure_design_queue "$design_file"

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
			echo "  - cta: examine manually. See \`.claude/run/$SCRIPT_NAME/*/\` for sub-agent skip reasons."
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

		# Clear skip counts for escalated ids.
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
	echo "$SCRIPT_NAME: escalated $escalated item(s) to $design_file" >&2
}

# Mark each id as done by flipping "[ ]" to "[x]" on the matching line.
# Arguments: space-separated list of ids (as produced by next-item).
cmd_mark_done() {
	_require_jq
	local ids_arg="${1:-}"
	[[ -z "$ids_arg" ]] && return 0
	[[ -f "$BACKLOG_FILE" ]] || return 0

	local tmp_map
	tmp_map=$(mktemp)
	_scan_backlog | jq -r '"\(.id)\t\(.line)"' > "$tmp_map"

	local marked=0
	for id in $ids_arg; do
		local target_line
		target_line=$(awk -v id="$id" '$1 == id {print $2; exit}' "$tmp_map")
		if [[ -z "$target_line" ]]; then
			echo "$SCRIPT_NAME: id $id not found in backlog (already marked?)" >&2
			continue
		fi
		local tmp_bk
		tmp_bk=$(mktemp)
		awk -v L="$target_line" 'NR == L { sub(/\[ \]/, "[x]") } { print }' "$BACKLOG_FILE" > "$tmp_bk"
		mv "$tmp_bk" "$BACKLOG_FILE"
		marked=$((marked + 1))
	done
	rm -f "$tmp_map"
	echo "$SCRIPT_NAME: marked $marked item(s) as done." >&2
}

# Archive every resolved "- [x] " line in backlog.md to backlog.archive.md.
# Silent no-op if backlog.md is absent or no resolved item is present.
# Reuses the "# Backlog archive" format shared with loop-clean's sweep-backlog.
cmd_sweep_resolved() {
	local src="$BACKLOG_FILE"
	local dst="backlog.archive.md"
	local session_id="${SESSION_ID:-unknown}"

	[[ -f "$src" ]] || { echo "0"; return 0; }

	local tmp_live tmp_arch
	tmp_live=$(mktemp)
	tmp_arch=$(mktemp)
	local archived=0 kept=0

	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ "$line" =~ ^[[:space:]]*-[[:space:]]+\[x\][[:space:]] ]]; then
			echo "$line" >> "$tmp_arch"
			archived=$((archived + 1))
			continue
		fi
		echo "$line" >> "$tmp_live"
		kept=$((kept + 1))
	done < "$src"

	if [[ "$archived" -eq 0 ]]; then
		rm -f "$tmp_live" "$tmp_arch"
		echo "0"
		return 0
	fi

	if [[ ! -f "$dst" ]]; then
		echo "# Backlog archive" > "$dst"
		echo "" >> "$dst"
		echo "Items migrated from backlog.md after resolution." >> "$dst"
		echo "" >> "$dst"
	fi
	echo "" >> "$dst"
	echo "## Crush sweep $(date -u +%Y-%m-%d) — $archived items (session $session_id)" >> "$dst"
	cat "$tmp_arch" >> "$dst"

	mv "$tmp_live" "$src"
	rm -f "$tmp_arch"

	echo "$SCRIPT_NAME: archived $archived resolved item(s) to $dst (kept $kept lines in $src)" >&2
	echo "$archived"
}
