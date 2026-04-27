#!/usr/bin/env bash
# loop-clean.sh — Deterministic flow controller for the post-implementation
# workflow: coding-standards → senior-review → dedup-codebase → spec-drift
# → fix-or-backlog, iterated until CLEAN / OSCILLATION / CEILING.
#
# The actual orchestrator is the `loop-clean-orchestrator` agent; this
# script is its flow controller — pure bash, no semantic work.
#
# This script is pure bash: it parses JSON produced by the skills, decides
# which iteration to run next, and never performs semantic work. All
# semantic decisions (what is a finding, what to fix) remain in the skills.
#
# Usage (driven by loop-clean/SKILL.md, not invoked by the user directly):
#
#   bash loop-clean.sh init
#   bash loop-clean.sh prepare-iter <N>
#   bash loop-clean.sh decide <N>
#   bash loop-clean.sh finalize
#
# All runtime state lives under .claude/run/loop-clean/<PID>/ in the
# project repo. That directory must be gitignored.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants & portability
# ---------------------------------------------------------------------------

readonly MAX_ITERATIONS=10
readonly RUN_DIR_BASE=".claude/run/loop-clean"
readonly RETENTION_DAYS=7

# The PID of the parent shell invoking us. We use PPID rather than $$ so
# that all subcommands of a single /loop-clean session land in the same
# RUN_DIR — the script forks a new process each subcommand, so $$ would
# change. If PPID is unavailable (shouldn't happen on bash >= 3), fall
# back to $$.
readonly SESSION_ID="${LOOP_CLEAN_SESSION_ID:-${PPID:-$$}}"
readonly RUN_DIR="${RUN_DIR_BASE}/${SESSION_ID}"

# Portable sha256 wrapper: Linux ships sha256sum, macOS ships shasum -a 256.
_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum | awk '{print $1}'
	else
		shasum -a 256 | awk '{print $1}'
	fi
}

# Path to the per-repo sticky base-sha file. The sticky lives outside
# $RUN_DIR (which is volatile, keyed on PPID) so that successive /loop-clean
# invocations within the same chantier reuse the same base-sha — even after
# commits/pushes advance HEAD.
#
# Keyed on a hash of the repo toplevel so worktrees and unrelated clones
# don't share state. Returns non-zero (and emits nothing) outside a git repo.
_session_base_sha_path() {
	local repo_root repo_id
	repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
	repo_id=$(printf '%s' "$repo_root" | _sha256 | cut -c1-12)
	echo "$HOME/.claude/run/loop-clean/sessions/$repo_id/base-sha"
}

# Auto-computed base-sha for when there is no sticky yet:
#   merge-base origin/<default-branch> HEAD   (if that resolves and != HEAD)
#   else HEAD
# The merge-base form covers feature branches and orchestrator worktrees
# (backlog-crush, backlog-deep-crush) — the diff includes everything
# committed on the branch since divergence.
_compute_auto_base_sha() {
	local default_branch default_ref base head_sha
	default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
		| sed 's@^refs/remotes/origin/@@' || true)
	[[ -z "$default_branch" ]] && default_branch="main"
	default_ref="origin/$default_branch"
	head_sha=$(git rev-parse HEAD 2>/dev/null || echo "")
	if git rev-parse --verify "$default_ref" >/dev/null 2>&1 \
		&& base=$(git merge-base "$default_ref" HEAD 2>/dev/null) \
		&& [[ -n "$base" && "$base" != "$head_sha" ]]; then
		echo "$base"
		return 0
	fi
	echo "$head_sha"
}

# Resolve the sticky base-sha for the current repo:
#   - if a persisted sticky exists AND is still an ancestor of HEAD, reuse it
#   - else compute a fresh one via _compute_auto_base_sha and persist it
# Returns "" outside a git repo.
_resolve_sticky_base_sha() {
	local sticky_path candidate
	sticky_path=$(_session_base_sha_path 2>/dev/null) || { echo ""; return 0; }
	if [[ -f "$sticky_path" ]]; then
		candidate=$(cat "$sticky_path" 2>/dev/null || echo "")
		if [[ -n "$candidate" ]] \
			&& git cat-file -e "$candidate" 2>/dev/null \
			&& git merge-base --is-ancestor "$candidate" HEAD 2>/dev/null; then
			echo "$candidate"
			return 0
		fi
	fi
	candidate=$(_compute_auto_base_sha 2>/dev/null || echo "")
	if [[ -n "$candidate" ]]; then
		mkdir -p "$(dirname "$sticky_path")"
		echo "$candidate" > "$sticky_path"
	fi
	echo "$candidate"
}

# Walk up from cwd to find STACK_EVAL.yaml. Emits its absolute path on stdout,
# or empty string if not found. Factored out of _capture_baseline and
# _resolve_test_command to avoid duplicating the walk-up pattern.
_find_stack_eval() {
	local dir
	dir="$(pwd)"
	while [[ "$dir" != "/" ]]; do
		if [[ -f "$dir/STACK_EVAL.yaml" ]]; then
			echo "$dir/STACK_EVAL.yaml"
			return 0
		fi
		dir=$(dirname "$dir")
	done
	echo ""
}

# ---------------------------------------------------------------------------
# Precondition checks
# ---------------------------------------------------------------------------

_require_jq() {
	if ! command -v jq >/dev/null 2>&1; then
		cat >&2 <<'EOF'
ERROR: loop-clean requires jq (JSON parser).
  macOS:   download from https://stedolan.github.io/jq/download/
  Linux:   apt-get install jq  /  dnf install jq
EOF
		exit 2
	fi
}

# Fail hard (exit 4) if any of the four semantic JSONs that `decide` consumes
# is missing. A missing JSON means the orchestrator forgot to remap
# LOOP_CLEAN_JSON_OUT before invoking a skill, which would otherwise silently
# under-count findings and mask real issues.
_require_iter_jsons() {
	local dir="$1"
	local missing=()
	[[ -f "$dir/coding-standards.json" ]] || missing+=("coding-standards.json")
	[[ -f "$dir/senior-review.json"    ]] || missing+=("senior-review.json")
	[[ -f "$dir/dedup-codebase.json"   ]] || missing+=("dedup-codebase.json")
	[[ -f "$dir/spec-drift.json"       ]] || missing+=("spec-drift.json")
	if (( ${#missing[@]} > 0 )); then
		cat >&2 <<EOF
ERROR: missing iteration JSON(s) in $dir:
  ${missing[*]}
The orchestrator probably forgot to export LOOP_CLEAN_JSON_OUT (pointing at the
expected per-skill path) before invoking a skill. Re-run the failing skill with
the correct remap, then retry decide.
EOF
		exit 4
	fi
}

# Delete RUN_DIR entries older than RETENTION_DAYS. Uses find -depth -delete
# so we never need rm -rf (per user's CLAUDE.md). Silent on missing base dir.
# mtime is evaluated on the RUN_DIR itself — acceptable because each RUN_DIR
# is immutable after `finalize` (nothing writes to it anymore), so its mtime
# stably reflects when the loop-clean session ran.
_cleanup_old_runs() {
	local root="$RUN_DIR_BASE"
	[[ -d "$root" ]] || return 0
	local deleted=0
	while IFS= read -r -d '' dir; do
		# Safety: never touch the RUN_DIR of the current session.
		if [[ "$dir" == "$RUN_DIR" ]]; then
			continue
		fi
		if find "$dir" -depth -delete 2>/dev/null; then
			deleted=$((deleted + 1))
		fi
	done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null)
	if [[ "$deleted" -gt 0 ]]; then
		echo "loop-clean: purged $deleted run(s) older than ${RETENTION_DAYS} days." >&2
	fi
}

_check_gitignore() {
	# Non-destructive: warn if .claude/run/ is not in .gitignore, but do not
	# modify the file. The user's CLAUDE.md says the script must not write
	# to repo files it does not own.
	local gi=".gitignore"
	if [[ -f "$gi" ]]; then
		if ! grep -qE '(^|/)\.claude/run($|/)' "$gi"; then
			cat >&2 <<'EOF'
WARNING: .claude/run/ is not in .gitignore.
Add the following line to .gitignore before committing:
    .claude/run/
EOF
		fi
	else
		cat >&2 <<'EOF'
WARNING: no .gitignore found at repo root.
Create one and include the line:
    .claude/run/
EOF
	fi
}

# ---------------------------------------------------------------------------
# Iteration directory helper
# ---------------------------------------------------------------------------

_iter_dir() {
	local n="$1"
	printf '%s/iter-%03d' "$RUN_DIR" "$n"
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

# Capture baseline: test/lint/typecheck exit codes at loop start. Written to
# $RUN_DIR/baseline.json. Used by finalize to detect regressions introduced by
# the loop (vs pre-existing failures). Opt-out via LOOP_CLEAN_SKIP_BASELINE=1.
# The `scope` top-level field records the run mode ("diff" | "audit") for
# observability when inspecting a run after the fact.
_capture_baseline() {
	local scope_mode="${1:-diff}"
	if [[ "${LOOP_CLEAN_SKIP_BASELINE:-0}" == "1" ]]; then
		jq -n --arg scope "$scope_mode" \
			'{scope: $scope, skipped: true, reason: "LOOP_CLEAN_SKIP_BASELINE=1"}' > "$RUN_DIR/baseline.json"
		return 0
	fi
	local out="$RUN_DIR/baseline.json"
	local test_cmd="" lint_cmd="" type_cmd=""
	local test_exit="null" lint_exit="null" type_exit="null"

	test_cmd=$(_resolve_test_command || echo "")
	if [[ -n "$test_cmd" ]]; then
		bash -c "$test_cmd" >/dev/null 2>&1 && test_exit=0 || test_exit=$?
	fi

	# Lint / typecheck from STACK_EVAL.yaml if present. Silent skip if absent.
	local se_path=""
	se_path=$(_find_stack_eval)
	if [[ -n "$se_path" ]]; then
		lint_cmd=$(grep -E '^[[:space:]]*lint_command:' "$se_path" 2>/dev/null \
			| head -n 1 | sed 's/.*lint_command:[[:space:]]*//' | sed 's/^"//; s/"$//' || true)
		type_cmd=$(grep -E '^[[:space:]]*typecheck_command:' "$se_path" 2>/dev/null \
			| head -n 1 | sed 's/.*typecheck_command:[[:space:]]*//' | sed 's/^"//; s/"$//' || true)
		[[ -n "$lint_cmd" ]] && { bash -c "$lint_cmd" >/dev/null 2>&1 && lint_exit=0 || lint_exit=$?; }
		[[ -n "$type_cmd" ]] && { bash -c "$type_cmd" >/dev/null 2>&1 && type_exit=0 || type_exit=$?; }
	fi

	jq -n \
		--arg scope "$scope_mode" \
		--arg test_cmd "$test_cmd" --argjson test_exit "$test_exit" \
		--arg lint_cmd "$lint_cmd" --argjson lint_exit "$lint_exit" \
		--arg type_cmd "$type_cmd" --argjson type_exit "$type_exit" \
		'{scope: $scope,
		  test: {cmd: $test_cmd, exit: $test_exit},
		  lint: {cmd: $lint_cmd, exit: $lint_exit},
		  typecheck: {cmd: $type_cmd, exit: $type_exit}}' > "$out"
}

cmd_init() {
	# Parse optional --scope=diff|audit (default: diff).
	# diff  → sub-skills audit only git-modified/staged files (standard post-impl gate).
	# audit → sub-skills audit the full repo (full-codebase audit run).
	local scope_mode="diff"
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--scope=*) scope_mode="${1#--scope=}" ;;
			--scope)   shift; scope_mode="${1:-}" ;;
			*)
				echo "ERROR: unknown init arg: $1" >&2
				exit 2
				;;
		esac
		shift
	done
	case "$scope_mode" in
		diff|audit) ;;
		*)
			echo "ERROR: invalid --scope=$scope_mode (expected: diff | audit)" >&2
			exit 2
			;;
	esac

	_require_jq
	mkdir -p "$RUN_DIR"

	_cleanup_old_runs

	local base_sha
	base_sha=$(_resolve_sticky_base_sha 2>/dev/null || echo "")
	if [[ -n "$base_sha" ]]; then
		echo "$base_sha" > "$RUN_DIR/base-sha"
	else
		echo "" > "$RUN_DIR/base-sha"
		echo "NOTE: not a git repo (or no HEAD); BASE_SHA is empty." >&2
	fi

	# Persist mode so prepare-iter can emit it consistently across iterations.
	echo "$scope_mode" > "$RUN_DIR/scope-mode"

	# In diff mode, warn upfront if there is nothing to audit. The loop still
	# runs (it will exit CLEAN at iter 0) — this just tells the user their
	# invocation probably wasn't what they wanted. We compute the *real* scope
	# (working tree + staged + everything since BASE_SHA) so a fresh commit
	# made just before /loop-clean still triggers an audit.
	if [[ "$scope_mode" == "diff" ]]; then
		local diff_n cached_n base_n
		diff_n=$(git diff --name-only 2>/dev/null | grep -c . || true)
		cached_n=$(git diff --cached --name-only 2>/dev/null | grep -c . || true)
		base_n=0
		if [[ -n "$base_sha" ]]; then
			base_n=$(git diff "$base_sha" --name-only 2>/dev/null | grep -c . || true)
		fi
		if [[ "${diff_n:-0}" -eq 0 && "${cached_n:-0}" -eq 0 && "${base_n:-0}" -eq 0 ]]; then
			cat >&2 <<EOF
WARNING: mode=diff but no files changed since BASE_SHA=${base_sha:-<none>} and
working tree / staged area are both empty. coding-standards and senior-review
will have an empty scope and the loop will exit CLEAN at iter 0 without
auditing any file.

If you expected a non-empty scope, the sticky base-sha may be stale or wrong:
  bash $0 reset                         # drop the sticky; next init recomputes
  bash $0 reset --from <ref>            # seed a new sticky (e.g. HEAD~3, sha)
Or run /loop-clean audit for a full-codebase audit.
EOF
		fi
	fi

	if [[ -f backlog.md ]]; then
		cp backlog.md "$RUN_DIR/backlog-baseline.md"
	fi

	_capture_baseline "$scope_mode"

	_check_gitignore

	# Emit env-var exports for the caller to source.
	cat <<EOF
LOOP_CLEAN_RUN_DIR="$RUN_DIR"
LOOP_CLEAN_BASE_SHA="$(cat "$RUN_DIR/base-sha")"
LOOP_CLEAN_SESSION_ID="$SESSION_ID"
LOOP_CLEAN_SCOPE_MODE="$scope_mode"
EOF
}

cmd_prepare_iter() {
	_require_jq
	local n="$1"
	local dir
	dir="$(_iter_dir "$n")"
	mkdir -p "$dir"

	# Map persisted mode (diff|audit) to the scope token the sub-skills' CLIs
	# expect (diff|all). `audit` is the user-facing verb; `all` is the CLI arg.
	local scope_mode="diff"
	[[ -f "$RUN_DIR/scope-mode" ]] && scope_mode=$(cat "$RUN_DIR/scope-mode")
	local loop_scope="diff"
	[[ "$scope_mode" == "audit" ]] && loop_scope="all"

	# Emit the env-var exports the caller should apply for each sub-step.
	# Callers pick the one matching the skill they're about to invoke.
	cat <<EOF
LOOP_CLEAN_ITERATION="$n"
LOOP_CLEAN_RUN_DIR="$RUN_DIR"
LOOP_CLEAN_BASE_SHA="$(cat "$RUN_DIR/base-sha" 2>/dev/null || echo "")"
LOOP_CLEAN_SCOPE="$loop_scope"
# Per-step JSON output targets:
LOOP_CLEAN_JSON_OUT_CODING_STANDARDS="$dir/coding-standards.json"
LOOP_CLEAN_JSON_OUT_SENIOR_REVIEW="$dir/senior-review.json"
LOOP_CLEAN_JSON_OUT_DEDUP_CODEBASE="$dir/dedup-codebase.json"
LOOP_CLEAN_JSON_OUT_SPEC_DRIFT="$dir/spec-drift.json"
LOOP_CLEAN_JSON_OUT_FIX_OR_BACKLOG="$dir/fix-or-backlog.json"
LOOP_CLEAN_JSON_OUT_RUNTIME_GATE="$dir/runtime-gate.json"
EOF
}

# Extract all finding ids from one skill JSON (senior-review or
# dedup-codebase). Missing file → no output (treated as zero findings).
_ids_from_findings() {
	local f="$1"
	if [[ -f "$f" ]]; then
		jq -r '.findings[]?.id // empty' "$f"
	fi
}

# Extract drift ids from the spec-drift JSON.
_ids_from_drift() {
	local f="$1"
	if [[ -f "$f" ]]; then
		jq -r '.drift[]?.id // empty' "$f"
	fi
}

# Normalize text for stable oscillation signatures: lowercase, collapse
# whitespace, strip leading/trailing whitespace. Applied at hash-computation
# time (not at id-write time) so LLM reformulations between iterations
# ("ignores CRLF" vs "does not handle CRLF") produce the same signature.
_normalize_text() {
	tr '[:upper:]' '[:lower:]' \
		| tr -s '[:space:]' ' ' \
		| sed -E 's/^[[:space:]]+|[[:space:]]+$//g'
}

# Emit one normalized signature per finding, sourced from the JSON content
# rather than the stored id. Signature = sha256(axis|file|normalize(problem)).
# Used ONLY for oscillation detection; the original id is preserved in JSON.
_sigs_from_findings() {
	local f="$1"
	[[ -f "$f" ]] || return 0
	jq -r '.findings[]? | [.axis // "", .file // "", .problem // ""] | @tsv' "$f" \
		| while IFS=$'\t' read -r axis file problem; do
			local norm
			norm=$(printf '%s' "$problem" | _normalize_text)
			printf '%s|%s|%s' "$axis" "$file" "$norm" | _sha256
		done
}

# Same for spec-drift JSON. Signature = sha256(drift|spec_file|src_file|normalize(name)).
_sigs_from_drift() {
	local f="$1"
	[[ -f "$f" ]] || return 0
	jq -r '.drift[]? | [.spec_file // "", .src_file // "", .name // ""] | @tsv' "$f" \
		| while IFS=$'\t' read -r spec src name; do
			local norm
			norm=$(printf '%s' "$name" | _normalize_text)
			printf 'drift|%s|%s|%s' "$spec" "$src" "$norm" | _sha256
		done
}

_count_findings() {
	local f="$1"
	if [[ -f "$f" ]]; then
		jq -r '.findings // [] | length' "$f"
	else
		echo 0
	fi
}

_count_drift() {
	local f="$1"
	if [[ -f "$f" ]]; then
		jq -r '.drift // [] | length' "$f"
	else
		echo 0
	fi
}

# Resolve the project's test command from STACK_EVAL.yaml (walk up from cwd)
# or fall back to conventions. Emits the command string on stdout, or empty
# if nothing found. Respects $LOOP_CLEAN_SKIP_TESTS=1 as an explicit opt-out.
_resolve_test_command() {
	if [[ "${LOOP_CLEAN_SKIP_TESTS:-}" == "1" ]]; then
		echo ""
		return 0
	fi
	local se_path=""
	se_path=$(_find_stack_eval)
	if [[ -n "$se_path" ]]; then
		# Priority 1: explicit test_command override.
		local cmd
		cmd=$(grep -E '^[[:space:]]*test_command:' "$se_path" 2>/dev/null | head -n 1 | sed 's/.*test_command:[[:space:]]*//' | sed 's/^"//; s/"$//')
		if [[ -n "$cmd" ]]; then
			echo "$cmd"
			return 0
		fi
		# Priority 2: derive from declared package_manager (package.json projects).
		if [[ -f package.json ]] && grep -q '"test"' package.json 2>/dev/null; then
			local pm
			pm=$(grep -E '^[[:space:]]*package_manager:' "$se_path" 2>/dev/null | head -n 1 | sed 's/.*package_manager:[[:space:]]*//' | sed 's/^"//; s/"$//' | tr -d '[:space:]')
			case "$pm" in
				bun|pnpm|yarn|npm) echo "$pm test"; return 0 ;;
			esac
		fi
	fi
	# Priority 3: detect the package manager from the lockfile.
	if [[ -f package.json ]] && grep -q '"test"' package.json 2>/dev/null; then
		if [[ -f bun.lockb ]] || [[ -f bun.lock ]]; then echo "bun test"; return 0; fi
		if [[ -f pnpm-lock.yaml ]]; then echo "pnpm test"; return 0; fi
		if [[ -f yarn.lock ]]; then echo "yarn test"; return 0; fi
		if [[ -f package-lock.json ]]; then echo "npm test"; return 0; fi
		# Priority 4: no lockfile — use bun if installed, else npm.
		if command -v bun >/dev/null 2>&1; then echo "bun test"; return 0; fi
		echo "npm test"
		return 0
	fi
	if [[ -f pyproject.toml ]] || [[ -f pytest.ini ]] || [[ -f setup.cfg ]]; then
		echo "pytest -q"
		return 0
	fi
	if [[ -f Cargo.toml ]]; then
		echo "cargo test --quiet"
		return 0
	fi
	echo ""
}

# Runtime test gate: runs the project's test suite after fix-or-backlog and
# injects a synthetic critical finding into runtime-gate.json if it fails.
# Stdout: "PASS" | "FAIL" | "SKIP".
cmd_test_gate() {
	_require_jq
	local n="$1"
	local dir
	dir="$(_iter_dir "$n")"
	mkdir -p "$dir"
	local out="$dir/runtime-gate.json"

	local cmd
	cmd=$(_resolve_test_command)
	if [[ -z "$cmd" ]]; then
		jq -n '{skill: "runtime-gate", status: "skipped", reason: "no test command resolved", findings: []}' > "$out"
		echo "SKIP"
		return 0
	fi

	local log
	log=$(mktemp)
	local exit_code=0
	bash -c "$cmd" > "$log" 2>&1 || exit_code=$?

	if [[ "$exit_code" -eq 0 ]]; then
		jq -n --arg cmd "$cmd" \
			'{skill: "runtime-gate", status: "pass", command: $cmd, findings: []}' > "$out"
		rm -f "$log"
		echo "PASS"
		return 0
	fi

	# Failure — emit one synthetic critical finding. Problem text is stable
	# (doesn't embed iteration number) so the oscillation hash matches across
	# iterations as long as the failure persists.
	local tail_output
	tail_output=$(tail -n 50 "$log" | jq -Rs .)
	local problem="test suite failed after fix-or-backlog"
	local norm
	norm=$(printf '%s' "$problem" | _normalize_text)
	local fid
	fid=$(printf 'runtime-gate||runtime-failure|%s' "$norm" | _sha256 | cut -c1-16)

	jq -n \
		--arg cmd "$cmd" \
		--argjson exit "$exit_code" \
		--argjson output "$tail_output" \
		--arg id "$fid" \
		--arg problem "$problem" \
		'{
			skill: "runtime-gate",
			status: "fail",
			command: $cmd,
			exit_code: $exit,
			findings: [{
				id: $id,
				source: "runtime-gate",
				axis: "runtime-failure",
				severity: "critical",
				file: "",
				line_start: null,
				line_end: null,
				problem: $problem,
				evidence: $output,
				fix_proposal: "Read the test output, identify the failing test, fix the root cause."
			}]
		}' > "$out"
	rm -f "$log"
	echo "FAIL"
}

# Commit changes produced by iteration N. Opt-in via LOOP_CLEAN_COMMIT_PER_ITER=1.
# No-op (exit 0) if opt-out, not a git repo, or nothing to commit.
# Stdout: COMMITTED <sha> | SKIPPED_OPT_OUT | SKIPPED_NO_CHANGES | SKIPPED_NO_GIT.
cmd_commit_iter() {
	local n="$1"
	if [[ "${LOOP_CLEAN_COMMIT_PER_ITER:-0}" != "1" ]]; then
		echo "SKIPPED_OPT_OUT"
		return 0
	fi
	if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		echo "SKIPPED_NO_GIT"
		return 0
	fi
	local dir
	dir="$(_iter_dir "$n")"
	local fb="$dir/fix-or-backlog.json"
	[[ -f "$fb" ]] || { echo "SKIPPED_NO_CHANGES"; return 0; }

	# Stage files touched by fix-or-backlog + backlog.md + design-queue.md.
	# design-queue.md must be staged whenever fix-or-backlog has routed items
	# there (including gate-triggered escalations) — otherwise the commit title
	# advertises "escalated N" but the diff does not contain the design-queue
	# changes, leaving them unstaged and invisible to the reviewer.
	# Avoid -A (per CLAUDE.md).
	local files
	files=$(jq -r '[.fix_now_applied[]?.file, .fix_now_applied[]?.files_touched[]?] | unique | .[]' "$fb" 2>/dev/null)
	[[ -f backlog.md ]] && git add backlog.md 2>/dev/null || true
	[[ -f design-queue.md ]] && git add design-queue.md 2>/dev/null || true
	while IFS= read -r f; do
		[[ -n "$f" && -e "$f" ]] && git add "$f" 2>/dev/null || true
	done <<< "$files"

	if git diff --cached --quiet; then
		echo "SKIPPED_NO_CHANGES"
		return 0
	fi

	# Build enriched commit message: title + metadata + Applied + Escalated + Notes.
	local applied_count escalated_count backlog_count
	applied_count=$(jq -r '.fix_now_applied // [] | length' "$fb")
	escalated_count=$(jq -r '.escalated // [] | length' "$fb")
	backlog_count=$(jq -r '.backlog_added // [] | length' "$fb")

	# Spec-drift direction breakdown. Counts applied spec-drift fixes by
	# direction + escalations triggered specifically by the direction-block
	# gate (spec-drift-scoped, unambiguous attribution). The other gates
	# (single-layer, no-relaxation, api-surface) can fire on findings from
	# any source, so they are tracked separately in gate_other_count.
	# All counts are deterministic from fields emitted by fix-or-backlog.
	local sd_applied_count sd_code_to_spec sd_spec_to_code sd_block_count gate_other_count
	sd_applied_count=$(jq -r '[.fix_now_applied // [] | .[] | select(.source == "spec-drift")] | length' "$fb")
	sd_code_to_spec=$(jq -r '[.fix_now_applied // [] | .[] | select(.source == "spec-drift" and .direction == "code→spec")] | length' "$fb")
	sd_spec_to_code=$(jq -r '[.fix_now_applied // [] | .[] | select(.source == "spec-drift" and .direction == "spec→code:completion")] | length' "$fb")
	sd_block_count=$(jq -r '[.design_queue_added // [] | .[] | select(.gate_triggered == "direction-block")] | length' "$fb")
	gate_other_count=$(jq -r '[.design_queue_added // [] | .[] | select(.gate_triggered != null and .gate_triggered != "direction-block")] | length' "$fb")

	local title="chore(loop-clean): iter $n — $applied_count applied, $escalated_count escalated, $backlog_count backlog"

	# Build spec-drift breakdown block for the commit body (NOT the title).
	# Keeping this in the body avoids titles > 72 chars (conventional limit)
	# while preserving full visibility via `git show` / `git log --format=%B`.
	local sd_breakdown_block=""
	if [[ "$sd_applied_count" -gt 0 || "$sd_block_count" -gt 0 || "$gate_other_count" -gt 0 ]]; then
		local sd_lines=""
		[[ "$sd_code_to_spec" -gt 0 ]] && sd_lines+="  - code→spec: $sd_code_to_spec"$'\n'
		[[ "$sd_spec_to_code" -gt 0 ]] && sd_lines+="  - spec→code:completion: $sd_spec_to_code"$'\n'
		[[ "$sd_block_count" -gt 0 ]] && sd_lines+="  - escalated (direction-block): $sd_block_count"$'\n'
		[[ "$gate_other_count" -gt 0 ]] && sd_lines+="  - escalated (other gates: single-layer / no-relaxation / api-surface): $gate_other_count"$'\n'
		# Guard: only emit the block header if any line was populated. Avoids
		# an empty "Spec-drift direction breakdown:" header when the JSON
		# reports a spec-drift applied fix but with direction=null/absent.
		if [[ -n "$sd_lines" ]]; then
			sd_breakdown_block=$'\n\nSpec-drift direction breakdown:\n'
			sd_breakdown_block+="${sd_lines%$'\n'}"
		fi
	fi

	local applied_block="" escalated_block="" notes_block=""
	if [[ "$applied_count" -gt 0 ]]; then
		applied_block=$'\n\nApplied:\n'
		applied_block+=$(jq -r '.fix_now_applied // [] | sort_by(.finding_id)[] | "  - [\(.finding_id)] \(.file): \(.change_summary // "(no summary)")"' "$fb")
	fi
	if [[ "$escalated_count" -gt 0 ]]; then
		escalated_block=$'\n\nEscalated:\n'
		escalated_block+=$(jq -r '.escalated // [] | sort_by(.finding_id)[] | "  - [\(.finding_id)] \(.reason)"' "$fb")
	fi

	local notes_raw
	notes_raw=$(jq -r '.notes // [] | .[]' "$fb" 2>/dev/null | LC_ALL=C sort -u)
	if [[ -n "$notes_raw" ]]; then
		notes_block=$'\n\nNotes:\n'
		while IFS= read -r note; do
			[[ -n "$note" ]] && notes_block+="  - $note"$'\n'
		done <<< "$notes_raw"
		notes_block="${notes_block%$'\n'}"
	fi

	local metadata="Session: $SESSION_ID | RUN_DIR: $RUN_DIR | iter-$(printf '%03d' "$n")"
	local body="${metadata}${sd_breakdown_block}${applied_block}${escalated_block}${notes_block}"

	local author_name="${GIT_AUTHOR_NAME:-Claude Loop-Clean}"
	local author_email="${GIT_AUTHOR_EMAIL:-${CLAUDE_COMMITTER_EMAIL:-claude-loop-clean@anthropic.com}}"

	git -c "user.name=$author_name" -c "user.email=$author_email" \
		commit -m "$title" -m "$body" >/dev/null

	local sha
	sha=$(git rev-parse HEAD)
	echo "COMMITTED $sha"
}

cmd_decide() {
	_require_jq
	local n="$1"
	local dir
	dir="$(_iter_dir "$n")"

	_require_iter_jsons "$dir"

	local cs="$dir/coding-standards.json"
	local sr="$dir/senior-review.json"
	local dc="$dir/dedup-codebase.json"
	local sd="$dir/spec-drift.json"
	local rg="$dir/runtime-gate.json"

	# --- Total findings across the five sources for this iteration.
	# runtime-gate contributes 0 or 1 finding (synthetic critical on test fail).
	local cs_count sr_count dc_count sd_count rg_count total
	cs_count=$(_count_findings "$cs")
	sr_count=$(_count_findings "$sr")
	dc_count=$(_count_findings "$dc")
	sd_count=$(_count_drift "$sd")
	rg_count=$(_count_findings "$rg")
	total=$((cs_count + sr_count + dc_count + sd_count + rg_count))

	# --- Oscillation hash: sorted concatenation of normalized signatures.
	# Uses _sigs_from_findings instead of _ids_from_findings to immunize
	# against LLM reformulations of `problem` between iterations — the
	# same logical finding now produces the same signature even if the
	# stored id changed due to text variance.
	local hash
	hash=$(
		{
			_sigs_from_findings "$cs"
			_sigs_from_findings "$sr"
			_sigs_from_findings "$dc"
			_sigs_from_drift "$sd"
			_sigs_from_findings "$rg"
		} | LC_ALL=C sort -u | _sha256
	)

	local action="CONTINUE"
	local reason=""
	local next_step="run /fix-or-backlog"

	# --- EXIT_CLEAN: zero findings AND (N==0 OR previous iter did nothing).
	if [[ "$total" -eq 0 ]]; then
		if [[ "$n" -eq 0 ]]; then
			action="EXIT_CLEAN"
			reason="zero findings at iter 0"
			next_step="stop"
		else
			local prev_fb
			prev_fb="$(_iter_dir $((n - 1)))/fix-or-backlog.json"
			if [[ -f "$prev_fb" ]]; then
				local prev_fixes prev_backlog
				prev_fixes=$(jq -r '.fix_now_applied // [] | length' "$prev_fb")
				prev_backlog=$(jq -r '.backlog_added // [] | length' "$prev_fb")
				if [[ "$prev_fixes" -eq 0 && "$prev_backlog" -eq 0 ]]; then
					action="EXIT_CLEAN"
					reason="zero findings and previous iter applied no fixes / backlog"
					next_step="stop"
				else
					# Previous iter did work that resolved all findings — one more
					# verification pass already ran (this one) and found nothing.
					# That is the terminal CLEAN state.
					action="EXIT_CLEAN"
					reason="zero findings after previous iter applied fixes"
					next_step="stop"
				fi
			else
				# Previous fix-or-backlog JSON missing — assume CLEAN to avoid loop.
				action="EXIT_CLEAN"
				reason="zero findings; previous iter fix-or-backlog JSON absent"
				next_step="stop"
			fi
		fi
	fi

	# --- EXIT_OSCILLATION: same hash as previous iter.
	if [[ "$action" == "CONTINUE" && "$n" -gt 0 ]]; then
		local prev_decision
		prev_decision="$(_iter_dir $((n - 1)))/decision.json"
		if [[ -f "$prev_decision" ]]; then
			local prev_hash
			prev_hash=$(jq -r '.findings_hash // ""' "$prev_decision")
			if [[ -n "$prev_hash" && "$prev_hash" == "$hash" ]]; then
				action="EXIT_OSCILLATION"
				reason="findings_hash identical to iter $((n - 1)) — findings are not being resolved"
				next_step="stop"
			fi
		fi
	fi

	# --- EXIT_CEILING: iteration budget exhausted.
	if [[ "$action" == "CONTINUE" && "$n" -ge $((MAX_ITERATIONS - 1)) ]]; then
		action="EXIT_CEILING"
		reason="reached MAX_ITERATIONS=$MAX_ITERATIONS"
		next_step="stop"
	fi

	# --- Write decision.json.
	jq -n \
		--argjson iteration "$n" \
		--arg action "$action" \
		--arg findings_hash "$hash" \
		--arg reason "$reason" \
		--argjson findings_count "$total" \
		--arg next_step "$next_step" \
		'{
			iteration: $iteration,
			action: $action,
			findings_hash: $findings_hash,
			reason: $reason,
			findings_count: $findings_count,
			next_step: $next_step
		}' > "$dir/decision.json"

	# --- stdout: single word action, for easy branching by caller.
	echo "$action"
}

cmd_reset() {
	# Drops the per-repo sticky base-sha so the next `init` recomputes it.
	# With --from <ref>, immediately seeds a new sticky pointing at <ref>.
	local from_ref=""
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--from=*) from_ref="${1#--from=}" ;;
			--from)   shift; from_ref="${1:-}" ;;
			*)
				echo "ERROR: unknown reset arg: $1" >&2
				exit 2
				;;
		esac
		shift
	done

	local sticky_path
	if ! sticky_path=$(_session_base_sha_path 2>/dev/null); then
		echo "ERROR: not a git repo (or no toplevel); nothing to reset." >&2
		exit 2
	fi

	if [[ -n "$from_ref" ]]; then
		local sha
		if ! sha=$(git rev-parse --verify "$from_ref^{commit}" 2>/dev/null); then
			echo "ERROR: --from=$from_ref does not resolve to a commit." >&2
			exit 2
		fi
		mkdir -p "$(dirname "$sticky_path")"
		echo "$sha" > "$sticky_path"
		echo "sticky base-sha set to $sha ($from_ref) at $sticky_path"
	else
		if [[ -f "$sticky_path" ]]; then
			rm -f "$sticky_path"
			echo "sticky base-sha cleared ($sticky_path); next /loop-clean init will recompute"
		else
			echo "no sticky base-sha to clear ($sticky_path)"
		fi
	fi
}

cmd_cleanup() {
	_cleanup_old_runs
	# Also report current state (what remains).
	if [[ -d "$RUN_DIR_BASE" ]]; then
		local remaining
		remaining=$(find "$RUN_DIR_BASE" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
		echo "loop-clean: $remaining run(s) remaining under $RUN_DIR_BASE/"
	else
		echo "loop-clean: no $RUN_DIR_BASE/ directory present."
	fi
}

# Archive checked backlog items older than N days to backlog.archive.md.
# Silent no-op if backlog.md is absent or no item is eligible. Atomic
# via tmp file + mv. Threshold: LOOP_CLEAN_BACKLOG_ARCHIVE_DAYS (default 30).
cmd_sweep_backlog() {
	local src="backlog.md"
	local dst="backlog.archive.md"
	local days="${LOOP_CLEAN_BACKLOG_ARCHIVE_DAYS:-30}"

	[[ -f "$src" ]] || return 0

	local cutoff_ts
	if date -u -d "${days} days ago" +%s >/dev/null 2>&1; then
		cutoff_ts=$(date -u -d "${days} days ago" +%s)
	else
		cutoff_ts=$(date -u -v "-${days}d" +%s 2>/dev/null || echo 0)
	fi
	[[ "$cutoff_ts" -eq 0 ]] && return 0

	local tmp_live tmp_arch
	tmp_live=$(mktemp)
	tmp_arch=$(mktemp)
	local archived=0 kept=0

	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ "$line" =~ ^-\ \[x\]\ .*date:\ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
			local item_date="${BASH_REMATCH[1]}"
			local item_ts
			item_ts=$(date -u -d "$item_date" +%s 2>/dev/null \
				|| date -u -j -f "%Y-%m-%d" "$item_date" +%s 2>/dev/null \
				|| echo 0)
			if [[ "$item_ts" -gt 0 && "$item_ts" -lt "$cutoff_ts" ]]; then
				echo "$line" >> "$tmp_arch"
				archived=$((archived + 1))
				continue
			fi
		fi
		echo "$line" >> "$tmp_live"
		kept=$((kept + 1))
	done < "$src"

	if [[ "$archived" -eq 0 ]]; then
		rm -f "$tmp_live" "$tmp_arch"
		return 0
	fi

	if [[ ! -f "$dst" ]]; then
		echo "# Backlog archive" > "$dst"
		echo "" >> "$dst"
		echo "Items migrated from backlog.md after ${days}-day retention." >> "$dst"
		echo "" >> "$dst"
	fi
	echo "" >> "$dst"
	echo "## Sweep $(date -u +%Y-%m-%d) — $archived items" >> "$dst"
	cat "$tmp_arch" >> "$dst"

	mv "$tmp_live" "$src"
	rm -f "$tmp_arch"

	echo "loop-clean: archived $archived backlog item(s) to $dst (kept $kept lines in $src)" >&2
}

cmd_finalize() {
	_require_jq
	local total_iters=0
	local total_fixes=0
	local total_backlog=0
	local last_action="UNKNOWN"

	for i in $(seq 0 $((MAX_ITERATIONS - 1))); do
		local dir
		dir="$(_iter_dir "$i")"
		if [[ ! -d "$dir" ]]; then
			break
		fi
		total_iters=$((total_iters + 1))

		local fb="$dir/fix-or-backlog.json"
		if [[ -f "$fb" ]]; then
			local fx bg
			fx=$(jq -r '.fix_now_applied // [] | length' "$fb")
			bg=$(jq -r '.backlog_added // [] | length' "$fb")
			total_fixes=$((total_fixes + fx))
			total_backlog=$((total_backlog + bg))
		fi

		local dec="$dir/decision.json"
		if [[ -f "$dec" ]]; then
			last_action=$(jq -r '.action // "UNKNOWN"' "$dec")
		fi
	done

	# Post-loop regression check vs baseline.
	local regression_note=""
	local final_exit=0
	local baseline_file="$RUN_DIR/baseline.json"
	if [[ -f "$baseline_file" ]] \
			&& [[ "$(jq -r '.skipped // false' "$baseline_file")" != "true" ]]; then
		local base_test base_lint base_type
		local test_cmd lint_cmd type_cmd
		base_test=$(jq -r '.test.exit // "null"' "$baseline_file")
		base_lint=$(jq -r '.lint.exit // "null"' "$baseline_file")
		base_type=$(jq -r '.typecheck.exit // "null"' "$baseline_file")
		test_cmd=$(jq -r '.test.cmd // ""' "$baseline_file")
		lint_cmd=$(jq -r '.lint.cmd // ""' "$baseline_file")
		type_cmd=$(jq -r '.typecheck.cmd // ""' "$baseline_file")

		local post_test="null" post_lint="null" post_type="null"
		[[ -n "$test_cmd" ]] && { bash -c "$test_cmd" >/dev/null 2>&1 && post_test=0 || post_test=$?; }
		[[ -n "$lint_cmd" ]] && { bash -c "$lint_cmd" >/dev/null 2>&1 && post_lint=0 || post_lint=$?; }
		[[ -n "$type_cmd" ]] && { bash -c "$type_cmd" >/dev/null 2>&1 && post_type=0 || post_type=$?; }

		local regressed=()
		[[ "$base_test" == "0" && "$post_test" != "0" && "$post_test" != "null" ]] && regressed+=("test")
		[[ "$base_lint" == "0" && "$post_lint" != "0" && "$post_lint" != "null" ]] && regressed+=("lint")
		[[ "$base_type" == "0" && "$post_type" != "0" && "$post_type" != "null" ]] && regressed+=("typecheck")

		if [[ ${#regressed[@]} -gt 0 ]]; then
			regression_note=$'\n\n⚠️  REGRESSION DETECTED: '"${regressed[*]}"' went from pass to fail during this loop.'
			final_exit=3
		fi
	fi

	# Advance the sticky base-sha to HEAD on a clean exit (no findings AND no
	# regression). Subsequent /loop-clean runs in this repo will then re-anchor
	# from HEAD, so the next chantier's diff scope is fresh — no re-auditing
	# everything that was already driven to CLEAN. On non-CLEAN exits we
	# deliberately leave the sticky in place so unresolved findings stay in
	# scope for the next run.
	local sticky_note=""
	if [[ "$last_action" == "EXIT_CLEAN" && "$final_exit" == 0 ]]; then
		local sticky_path new_sha
		if sticky_path=$(_session_base_sha_path 2>/dev/null) \
			&& new_sha=$(git rev-parse HEAD 2>/dev/null) \
			&& [[ -n "$new_sha" ]]; then
			mkdir -p "$(dirname "$sticky_path")"
			echo "$new_sha" > "$sticky_path"
			sticky_note=$'\n\nSticky base-sha advanced to '"$new_sha"' (CLEAN exit).'
		fi
	fi

	cat <<EOF
# loop-clean report

- Session: $SESSION_ID
- RUN_DIR: $RUN_DIR
- Iterations executed: $total_iters
- Final action: $last_action
- Total fixes applied: $total_fixes
- Total backlog items added: $total_backlog$regression_note$sticky_note

Per-iteration decisions: $RUN_DIR/iter-*/decision.json
Baseline: $RUN_DIR/baseline.json
EOF
	return "$final_exit"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

usage() {
	cat >&2 <<EOF
Usage:
  loop-clean.sh init [--scope=diff|audit]   # default: diff
  loop-clean.sh prepare-iter <N>
  loop-clean.sh test-gate <N>      # run project tests, emit runtime-gate.json
  loop-clean.sh commit-iter <N>    # commit iter N changes (opt-in via LOOP_CLEAN_COMMIT_PER_ITER=1)
  loop-clean.sh decide <N>
  loop-clean.sh finalize
  loop-clean.sh reset [--from <ref>]  # drop the per-repo sticky base-sha
                                      # (or seed it to <ref>); next init recomputes
  loop-clean.sh cleanup            # delete run dirs older than ${RETENTION_DAYS} days
  loop-clean.sh sweep-backlog      # archive [x] items older than \${LOOP_CLEAN_BACKLOG_ARCHIVE_DAYS:-30} days
EOF
	exit 2
}

main() {
	if [[ $# -lt 1 ]]; then usage; fi
	local cmd="$1"
	shift

	case "$cmd" in
		init)
			cmd_init "$@"
			;;
		prepare-iter)
			if [[ $# -lt 1 ]]; then usage; fi
			cmd_prepare_iter "$1"
			;;
		test-gate)
			if [[ $# -lt 1 ]]; then usage; fi
			cmd_test_gate "$1"
			;;
		commit-iter)
			if [[ $# -lt 1 ]]; then usage; fi
			cmd_commit_iter "$1"
			;;
		decide)
			if [[ $# -lt 1 ]]; then usage; fi
			cmd_decide "$1"
			;;
		finalize)
			cmd_finalize
			;;
		reset)
			cmd_reset "$@"
			;;
		cleanup)
			cmd_cleanup
			;;
		sweep-backlog)
			cmd_sweep_backlog
			;;
		*)
			usage
			;;
	esac
}

main "$@"
