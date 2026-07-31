#!/usr/bin/env bash
# loop-clean.sh — technical controller for the four-source loop-clean protocol.
# Semantic producers and fix-or-backlog own every qualitative decision.

set -euo pipefail

readonly MAX_ITERATIONS=10
readonly RETENTION_DAYS=7
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_PROTOCOL_CLI="$SCRIPT_DIR/protocol/src/cli.ts"
readonly PROTOCOL_CLI="${LOOP_CLEAN_PROTOCOL_CLI:-$DEFAULT_PROTOCOL_CLI}"

_run_protocol() {
	bun --no-install "$PROTOCOL_CLI" "$@"
}

_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum | awk '{print $1}'
	else
		shasum -a 256 | awk '{print $1}'
	fi
}

_require_dependencies() {
	local dependency
	for dependency in bun jq git; do
		if ! command -v "$dependency" >/dev/null 2>&1; then
			echo "ERROR: loop-clean requires $dependency" >&2
			exit 2
		fi
	done
	if [[ ! -f "$PROTOCOL_CLI" ]]; then
		echo "ERROR: loop-clean protocol CLI not found: $PROTOCOL_CLI" >&2
		exit 2
	fi
	if [[ "$PROTOCOL_CLI" == "$DEFAULT_PROTOCOL_CLI" ]] \
		&& [[ ! -d "$SCRIPT_DIR/protocol/node_modules/zod" ]]; then
		echo "ERROR: loop-clean protocol dependencies are not installed." >&2
		echo "Run: cd $SCRIPT_DIR/protocol && bun install --frozen-lockfile" >&2
		exit 2
	fi
}

_emit_export() {
	local name="$1" value="$2"
	value=${value//\\/\\\\}
	value=${value//\"/\\\"}
	printf '%s="%s"\n' "$name" "$value"
}

_iter_dir() {
	local iteration="$1"
	printf '%s/iter-%03d' "$LOOP_CLEAN_RUN_DIR" "$iteration"
}

_validate_iteration() {
	local iteration="${1:-}"
	if [[ ! "$iteration" =~ ^[0-9]+$ ]] || (( iteration < 0 || iteration >= MAX_ITERATIONS )); then
		echo "ERROR: iteration must be an integer from 0 to $((MAX_ITERATIONS - 1))" >&2
		exit 2
	fi
}

_require_context() {
	: "${LOOP_CLEAN_REPO_ROOT:?ERROR: LOOP_CLEAN_REPO_ROOT is required}"
	: "${LOOP_CLEAN_RUN_DIR:?ERROR: LOOP_CLEAN_RUN_DIR is required}"
	: "${LOOP_CLEAN_SESSION_ID:?ERROR: LOOP_CLEAN_SESSION_ID is required}"
	LOOP_CLEAN_BACKLOG_PATH="${LOOP_CLEAN_BACKLOG_PATH:-$LOOP_CLEAN_REPO_ROOT/backlog.md}"
	LOOP_CLEAN_DESIGN_QUEUE_PATH="${LOOP_CLEAN_DESIGN_QUEUE_PATH:-$LOOP_CLEAN_REPO_ROOT/design-queue.md}"
	if [[ "$LOOP_CLEAN_REPO_ROOT" != /* || "$LOOP_CLEAN_RUN_DIR" != /* ]]; then
		echo "ERROR: loop-clean repository and run paths must be absolute" >&2
		exit 2
	fi
	local resolved_root
	if ! resolved_root=$(GIT_OPTIONAL_LOCKS=0 git -C "$LOOP_CLEAN_REPO_ROOT" rev-parse --show-toplevel 2>/dev/null); then
		echo "ERROR_NOT_GIT_REPOSITORY" >&2
		exit 2
	fi
	if [[ "$resolved_root" != "$LOOP_CLEAN_REPO_ROOT" ]]; then
		echo "ERROR: LOOP_CLEAN_REPO_ROOT is not the resolved Git top-level" >&2
		exit 2
	fi
}

_cleanup_old_runs() {
	local base="$LOOP_CLEAN_REPO_ROOT/.claude/run/loop-clean"
	[[ -d "$base" ]] || return 0
	while IFS= read -r -d '' directory; do
		[[ "$directory" == "$LOOP_CLEAN_RUN_DIR" ]] && continue
		find "$directory" -depth -delete 2>/dev/null || true
	done < <(find "$base" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null)
}

_record_protocol_error() {
	local message="$1"
	mkdir -p "$LOOP_CLEAN_RUN_DIR"
	jq -n --arg message "$message" \
		'{schema_version: 1, action: "EXIT_PROTOCOL_ERROR", message: $message}' \
		> "$LOOP_CLEAN_RUN_DIR/protocol-error.json"
}

_fail_protocol() {
	local message="$1" iteration="${2:-}"
	_record_protocol_error "$message"
	if [[ -n "$iteration" ]]; then
		local directory
		directory="$(_iter_dir "$iteration")"
		mkdir -p "$directory"
		jq -n --argjson iteration "$iteration" --arg reason "$message" \
			'{iteration: $iteration, action: "EXIT_PROTOCOL_ERROR", reason: $reason, actionable_hash: "", findings_count: 0, actionable_count: 0, deferred_count: 0}' \
			> "$directory/decision.json"
	fi
	echo "$message" >&2
	echo "EXIT_PROTOCOL_ERROR"
	return 4
}

cmd_init() {
	if (( $# > 0 )); then
		echo "ERROR: unknown init argument: $1" >&2
		exit 2
	fi
	_require_dependencies
	local repository_root
	if ! repository_root=$(GIT_OPTIONAL_LOCKS=0 git rev-parse --show-toplevel 2>/dev/null); then
		echo "ERROR_NOT_GIT_REPOSITORY" >&2
		exit 2
	fi
	repository_root=$(cd "$repository_root" && pwd -P)
	local session_id="${LOOP_CLEAN_SESSION_ID:-${PPID:-$$}}"
	local run_dir="$repository_root/.claude/run/loop-clean/$session_id"
	if [[ -e "$run_dir/git-baseline.json" ]]; then
		echo "ERROR: loop-clean session already initialized: $session_id" >&2
		exit 2
	fi
	LOOP_CLEAN_REPO_ROOT="$repository_root"
	LOOP_CLEAN_RUN_DIR="$run_dir"
	LOOP_CLEAN_SESSION_ID="$session_id"
	LOOP_CLEAN_BACKLOG_PATH="$repository_root/backlog.md"
	LOOP_CLEAN_DESIGN_QUEUE_PATH="$repository_root/design-queue.md"
	mkdir -p "$run_dir"
	_cleanup_old_runs
	local baseline_file="$run_dir/git-baseline.json"
	local baseline_tmp="$run_dir/.git-baseline.json.tmp.$$"
	local deferred_file="$run_dir/deferred-findings.json"
	local deferred_tmp="$run_dir/.deferred-findings.json.tmp.$$"

	rm -f "$baseline_tmp" "$deferred_tmp"

	if ! _run_protocol capture-git \
		--repo-root "$repository_root" \
		--output "$baseline_tmp"; then
		rm -f "$baseline_tmp" "$deferred_tmp"
		echo "ERROR: failed to capture Git invariants" >&2
		exit 4
	fi

	if [[ ! -s "$baseline_tmp" ]] || ! jq -e '
		.schema_version == 1
		and (
			.head == "UNBORN"
			or (
				(.head | type) == "string"
				and (.head | test("^[0-9a-f]{40,64}$"))
			)
		)
		and (
			(.index_digest | type) == "string"
			and (.index_digest | test("^[0-9a-f]{64}$"))
		)
	' "$baseline_tmp" >/dev/null; then
		rm -f "$baseline_tmp" "$deferred_tmp"
		echo "ERROR: protocol CLI did not produce a valid Git baseline" >&2
		exit 4
	fi

	# Prepare all non-marker artifacts before publishing the commit marker.
	if ! printf '{"schema_version":1,"entries":[]}\n' > "$deferred_tmp"; then
		rm -f "$baseline_tmp" "$deferred_tmp"
		echo "ERROR: failed to initialize deferred findings" >&2
		exit 4
	fi

	if ! mv "$deferred_tmp" "$deferred_file"; then
		rm -f "$baseline_tmp" "$deferred_tmp"
		echo "ERROR: failed to publish deferred findings" >&2
		exit 4
	fi

	# Publish the commit marker last. Its presence guarantees that every
	# artifact under the run directory is fully initialized.
	# Use ln (not mv) so the marker is exclusive: two concurrent inits
	# with the same session ID cannot both succeed.
	if ! ln "$baseline_tmp" "$baseline_file" 2>/dev/null; then
		# ln failed — determine whether we lost a race or hit an I/O fault.
		rm -f "$baseline_tmp" "$deferred_tmp"

		if [[ -e "$baseline_file" ]]; then
			# Marker exists: another process already claimed this session.
			echo "ERROR: loop-clean session already initialized or concurrently claimed: $session_id" >&2
			exit 2
		fi

		# Marker absent despite a valid baseline: infrastructure failure.
		echo "ERROR: failed to publish Git baseline" >&2
		exit 4
	fi
	# Claim succeeded — our temp baseline is now the marker.
	rm -f "$baseline_tmp"
	if ! GIT_OPTIONAL_LOCKS=0 git -C "$repository_root" check-ignore -q -- ".claude/run/loop-clean/$session_id"; then
		cat >&2 <<'WARNING'
WARNING: .claude/run/ is not ignored at the resolved Git root.
Add .claude/run/ to the root .gitignore before committing.
WARNING
	fi
	_emit_export LOOP_CLEAN_REPO_ROOT "$repository_root"
	_emit_export GIT_OPTIONAL_LOCKS "0"
	_emit_export LOOP_CLEAN_RUN_DIR "$run_dir"
	_emit_export LOOP_CLEAN_SESSION_ID "$session_id"
	_emit_export LOOP_CLEAN_BACKLOG_PATH "$LOOP_CLEAN_BACKLOG_PATH"
	_emit_export LOOP_CLEAN_DESIGN_QUEUE_PATH "$LOOP_CLEAN_DESIGN_QUEUE_PATH"
}

cmd_prepare_iter() {
	_validate_iteration "${1:-}"
	_require_dependencies
	_require_context
	local iteration="$1" directory scope_file digest auditable_count
	directory="$(_iter_dir "$iteration")"
	scope_file="$directory/scope.json"
	mkdir -p "$directory"
	local protocol_error
	if ! protocol_error=$(_run_protocol scope \
		--repo-root "$LOOP_CLEAN_REPO_ROOT" \
		--output "$scope_file" 2>&1); then
		_fail_protocol "scope collection failed: $protocol_error" "$iteration"
		return $?
	fi
	if ! digest=$(jq -er '.digest' "$scope_file" 2>/dev/null); then
		_fail_protocol "scope.json has no valid digest" "$iteration"
		return $?
	fi
	if ! auditable_count=$(jq -er '[.entries[] | select(.eligible_for_audit == true)] | length' "$scope_file" 2>/dev/null); then
		_fail_protocol "scope.json has no valid auditable entry set" "$iteration"
		return $?
	fi
	_emit_export LOOP_CLEAN_ITERATION "$iteration"
	_emit_export LOOP_CLEAN_REPO_ROOT "$LOOP_CLEAN_REPO_ROOT"
	_emit_export LOOP_CLEAN_RUN_DIR "$LOOP_CLEAN_RUN_DIR"
	_emit_export LOOP_CLEAN_SESSION_ID "$LOOP_CLEAN_SESSION_ID"
	_emit_export LOOP_CLEAN_BACKLOG_PATH "$LOOP_CLEAN_BACKLOG_PATH"
	_emit_export LOOP_CLEAN_DESIGN_QUEUE_PATH "$LOOP_CLEAN_DESIGN_QUEUE_PATH"
	_emit_export LOOP_CLEAN_SCOPE_FILE "$scope_file"
	_emit_export LOOP_CLEAN_SCOPE_DIGEST "$digest"
	_emit_export LOOP_CLEAN_AUDITABLE_COUNT "$auditable_count"
	_emit_export LOOP_CLEAN_JSON_OUT_CODING_STANDARDS "$directory/coding-standards.json"
	_emit_export LOOP_CLEAN_JSON_OUT_SENIOR_REVIEW "$directory/senior-review.json"
	_emit_export LOOP_CLEAN_JSON_OUT_DEDUP_CODEBASE "$directory/dedup-codebase.json"
	_emit_export LOOP_CLEAN_JSON_OUT_RUNTIME_GATE "$directory/runtime-gate.json"
	_emit_export LOOP_CLEAN_FINDINGS_FILE "$directory/findings.json"
	_emit_export LOOP_CLEAN_JSON_OUT_FIX_OR_BACKLOG "$directory/fix-or-backlog.json"
}

cmd_runtime_gate() {
	_validate_iteration "${1:-}"
	_require_dependencies
	_require_context
	local iteration="$1" directory scope_file output protocol_error
	directory="$(_iter_dir "$iteration")"
	scope_file="$directory/scope.json"
	output="$directory/runtime-gate.json"
	if [[ ! -f "$scope_file" ]]; then
		_fail_protocol "runtime-gate requires $scope_file" "$iteration"
		return $?
	fi
	if ! protocol_error=$(_run_protocol runtime-gate \
		--repo-root "$LOOP_CLEAN_REPO_ROOT" \
		--scope "$scope_file" \
		--output "$output" 2>&1); then
		_fail_protocol "runtime-gate failed: $protocol_error" "$iteration"
		return $?
	fi
	printf '%s\n' "$protocol_error"
}

cmd_collect_findings() {
	_validate_iteration "${1:-}"
	_require_dependencies
	_require_context
	local iteration="$1" directory protocol_error
	directory="$(_iter_dir "$iteration")"
	if ! protocol_error=$(_run_protocol collect \
		--iter-dir "$directory" \
		--scope "$directory/scope.json" \
		--deferred "$LOOP_CLEAN_RUN_DIR/deferred-findings.json" \
		--output "$directory/findings.json" 2>&1); then
		_fail_protocol "finding collection failed: $protocol_error" "$iteration"
		return $?
	fi
}

cmd_decide() {
	_validate_iteration "${1:-}"
	_require_dependencies
	_require_context
	local iteration="$1" directory scope_file findings_file
	directory="$(_iter_dir "$iteration")"
	scope_file="$directory/scope.json"
	findings_file="$directory/findings.json"
	if [[ -f "$LOOP_CLEAN_RUN_DIR/protocol-error.json" ]]; then
		local prior_error
		prior_error=$(jq -r '.message // "prior protocol error"' "$LOOP_CLEAN_RUN_DIR/protocol-error.json")
		_fail_protocol "$prior_error" "$iteration"
		return $?
	fi
	if [[ ! -f "$scope_file" ]]; then
		_fail_protocol "decide requires scope.json" "$iteration"
		return $?
	fi
	local auditable_count
	if ! auditable_count=$(jq -er '[.entries[] | select(.eligible_for_audit == true)] | length' "$scope_file" 2>/dev/null); then
		_fail_protocol "scope.json is invalid" "$iteration"
		return $?
	fi
	if (( iteration == 0 && auditable_count == 0 )); then
		jq -n --argjson iteration "$iteration" \
			'{iteration: $iteration, action: "EXIT_NO_CHANGES", reason: "no auditable uncommitted changes", actionable_hash: "", findings_count: 0, actionable_count: 0, deferred_count: 0}' \
			> "$directory/decision.json"
		echo "EXIT_NO_CHANGES"
		return 0
	fi
	if [[ ! -f "$findings_file" ]]; then
		_fail_protocol "decide requires findings.json" "$iteration"
		return $?
	fi
	local total actionable deferred runtime_status
	if ! total=$(jq -er '.summary.total' "$findings_file" 2>/dev/null) \
		|| ! actionable=$(jq -er '.summary.actionable' "$findings_file" 2>/dev/null) \
		|| ! deferred=$(jq -er '.summary.deferred' "$findings_file" 2>/dev/null) \
		|| ! runtime_status=$(jq -er '.runtime_gate_status' "$findings_file" 2>/dev/null); then
		_fail_protocol "findings.json is invalid" "$iteration"
		return $?
	fi
	local actionable_hash
	actionable_hash=$(jq -r '.actionable_findings[].id' "$findings_file" | LC_ALL=C sort -u | _sha256)
	local action="CONTINUE" reason="actionable findings require routing"
	if (( total == 0 )); then
		if [[ "$runtime_status" == "pass" || "$runtime_status" == "skipped" ]]; then
			action="EXIT_CLEAN"
			reason="no findings and runtime gate did not fail"
		else
			_fail_protocol "runtime gate failed without a runtime finding" "$iteration"
			return $?
		fi
	elif (( actionable == 0 && deferred > 0 )); then
		if [[ "$runtime_status" == "pass" || "$runtime_status" == "skipped" ]]; then
			action="EXIT_HANDLED"
			reason="all remaining findings were previously deferred"
		else
			_fail_protocol "runtime failure cannot be deferred" "$iteration"
			return $?
		fi
	fi
	if [[ "$action" == "CONTINUE" && "$iteration" -gt 0 ]]; then
		local previous_decision previous_hash
		previous_decision="$(_iter_dir $((iteration - 1)))/decision.json"
		if [[ -f "$previous_decision" ]]; then
			previous_hash=$(jq -r '.actionable_hash // ""' "$previous_decision")
			if [[ -n "$previous_hash" && "$previous_hash" == "$actionable_hash" ]]; then
				action="EXIT_OSCILLATION"
				reason="actionable finding ID set matches the previous iteration"
			fi
		fi
	fi
	if [[ "$action" == "CONTINUE" && "$iteration" -ge $((MAX_ITERATIONS - 1)) ]]; then
		action="EXIT_CEILING"
		reason="iteration ceiling reached with actionable findings"
	fi
	jq -n \
		--argjson iteration "$iteration" \
		--arg action "$action" \
		--arg reason "$reason" \
		--arg actionable_hash "$actionable_hash" \
		--argjson findings_count "$total" \
		--argjson actionable_count "$actionable" \
		--argjson deferred_count "$deferred" \
		'{iteration: $iteration, action: $action, reason: $reason, actionable_hash: $actionable_hash, findings_count: $findings_count, actionable_count: $actionable_count, deferred_count: $deferred_count}' \
		> "$directory/decision.json"
	echo "$action"
}

cmd_validate_routing() {
	_validate_iteration "${1:-}"
	_require_dependencies
	_require_context
	local iteration="$1" directory protocol_error
	directory="$(_iter_dir "$iteration")"
	if ! protocol_error=$(_run_protocol validate-routing \
		--findings "$directory/findings.json" \
		--routing "$directory/fix-or-backlog.json" \
		--deferred-out "$LOOP_CLEAN_RUN_DIR/deferred-findings.json" 2>&1); then
		_fail_protocol "routing validation failed: $protocol_error" "$iteration"
		return $?
	fi
	printf '%s\n' "$protocol_error"
}

cmd_finalize() {
	_require_dependencies
	_require_context
	local final_action="UNKNOWN" protocol_details="" final_exit=0
	local iterations=0 total_fixes=0 total_deferred=0
	local iteration directory decision routing
	for ((iteration = 0; iteration < MAX_ITERATIONS; iteration += 1)); do
		directory="$(_iter_dir "$iteration")"
		[[ -d "$directory" ]] || break
		iterations=$((iterations + 1))
		decision="$directory/decision.json"
		if [[ -f "$decision" ]]; then
			final_action=$(jq -r '.action // "UNKNOWN"' "$decision")
		fi
		routing="$directory/fix-or-backlog.json"
		if [[ -f "$routing" ]]; then
			total_fixes=$((total_fixes + $(jq -r '.fix_now_applied // [] | length' "$routing")))
			total_deferred=$((total_deferred + $(jq -r '((.backlog_added // []) + (.backlog_existing // []) + (.design_queue_added // []) + (.design_queue_existing // []) + (.escalated // [])) | length' "$routing")))
		fi
	done
	if [[ -f "$LOOP_CLEAN_RUN_DIR/protocol-error.json" ]]; then
		final_action="EXIT_PROTOCOL_ERROR"
		protocol_details=$(jq -r '.message // "protocol error"' "$LOOP_CLEAN_RUN_DIR/protocol-error.json")
		final_exit=4
	fi
	local verify_error
	if ! verify_error=$(_run_protocol verify-git \
		--repo-root "$LOOP_CLEAN_REPO_ROOT" \
		--baseline "$LOOP_CLEAN_RUN_DIR/git-baseline.json" 2>&1); then
		final_action="EXIT_PROTOCOL_ERROR"
		protocol_details="${protocol_details:+$protocol_details; }${verify_error#ERROR_PROTOCOL: }"
		final_exit=4
	fi
	if [[ "$final_action" == "UNKNOWN" ]]; then
		final_action="EXIT_PROTOCOL_ERROR"
		protocol_details="${protocol_details:+$protocol_details; }no terminal decision was recorded"
		final_exit=4
	fi
	cat <<EOF
# loop-clean report

- Session: $LOOP_CLEAN_SESSION_ID
- Repository root: $LOOP_CLEAN_REPO_ROOT
- RUN_DIR: $LOOP_CLEAN_RUN_DIR
- Iterations executed: $iterations
- Final action: $final_action
- Total fixes applied: $total_fixes
- Total deferred routes: $total_deferred
- HEAD unchanged: $([[ "$verify_error" == *"HEAD changed"* ]] && echo no || echo yes)
- Index unchanged: $([[ "$verify_error" == *"index changed"* ]] && echo no || echo yes)
- Protocol details: ${protocol_details:-none}

Per-iteration decisions: $LOOP_CLEAN_RUN_DIR/iter-*/decision.json
Git baseline: $LOOP_CLEAN_RUN_DIR/git-baseline.json
EOF
	return "$final_exit"
}

usage() {
	cat >&2 <<'EOF'
Usage:
  loop-clean.sh init
  loop-clean.sh prepare-iter <N>
  loop-clean.sh runtime-gate <N>
  loop-clean.sh collect-findings <N>
  loop-clean.sh decide <N>
  loop-clean.sh validate-routing <N>
  loop-clean.sh finalize
EOF
	exit 2
}

main() {
	if (( $# < 1 )); then usage; fi
	local command_name="$1"
	shift
	case "$command_name" in
		init) cmd_init "$@" ;;
		prepare-iter) cmd_prepare_iter "${1:-}" ;;
		runtime-gate) cmd_runtime_gate "${1:-}" ;;
		collect-findings) cmd_collect_findings "${1:-}" ;;
		decide) cmd_decide "${1:-}" ;;
		validate-routing) cmd_validate_routing "${1:-}" ;;
		finalize) cmd_finalize ;;
		*) usage ;;
	esac
}

main "$@"
