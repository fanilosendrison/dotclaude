#!/usr/bin/env bash
# loop-clean-test.sh — Smoke tests for cmd_commit_iter.
#
# Runs a set of scenarios, each setting up a fresh git repo + RUN_DIR +
# fix-or-backlog.json fixture, then invoking `bash loop-clean.sh commit-iter N`
# and asserting on git log output.
#
# Run: bash loop-clean-test.sh
# Exit: 0 if all pass, 1 if any fails. Prints "PASS <name>" / "FAIL <name>".
#
# Not wired into a CI (~/.claude/ is not a git repo); run manually after
# touching cmd_commit_iter. Validates the 4 scenarios called out in the
# senior-review for this function:
#   (A) Old-format JSON (no source/direction fields)
#   (B) Empty bracket guard (source=spec-drift but direction=null)
#   (C) Full breakdown (multiple directions + gates)
#   (D) design-queue.md staging when items were routed there

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOOP_CLEAN_SH="$SCRIPT_DIR/loop-clean.sh"
PASS=0
FAIL=0

setup_fixture() {
	local root="$1" iter="$2"
	(
		cd "$root"
		git init -q
		git config user.email "test@example.com"
		git config user.name "Test"
		# Disable the commit-msg hook for fixture setup — otherwise the
		# conventional-commits validator rejects the init commit and the
		# test git repo has no HEAD, which then makes
		# `git diff --cached --quiet` return 0 (no diff) inside
		# cmd_commit_iter. Use --no-verify explicitly for the fixture
		# init only; the commit that cmd_commit_iter makes later uses
		# the real skill's Conventional Commits format.
		echo ".claude/run/" > .gitignore
		git add .gitignore
		git -c commit.gpgsign=false commit -q --no-verify -m "chore: init"
	)
	local iter_padded
	iter_padded=$(printf '%03d' "$iter")
	local iter_dir="$root/.claude/run/loop-clean/test/iter-$iter_padded"
	mkdir -p "$iter_dir"
	echo "$iter_dir"
}

# Invoke cmd_commit_iter in a fresh bash subshell from inside the fixture repo.
# loop-clean.sh requires being inside the target git repo (git diff --cached
# operates on $PWD). RUN_DIR is absolute so the script resolves iter-NNN
# deterministically regardless of cwd.
run_commit_iter() {
	local root="$1" n="$2"
	local out
	out=$(
		cd "$root"
		SESSION_ID="test" RUN_DIR="$root/.claude/run/loop-clean/test" \
			LOOP_CLEAN_COMMIT_PER_ITER=1 \
			bash "$LOOP_CLEAN_SH" commit-iter "$n" 2>&1
	)
	# If the script skipped instead of committing, dump git state so the
	# failure is diagnosable.
	if [[ "$out" == SKIPPED* ]]; then
		echo "[test] run_commit_iter output: $out" >&2
		echo "[test] RUN_DIR=$root/.claude/run/loop-clean/test" >&2
		echo "[test] ls RUN_DIR:" >&2
		ls -laR "$root/.claude/run/loop-clean/test" 2>&1 | head -20 >&2
		echo "[test] git status -s:" >&2
		(cd "$root" && git status -s) >&2
	fi
	echo "$out"
}

assert_title_matches() {
	local root="$1" name="$2" expected_re="$3" actual_title
	actual_title=$(cd "$root" && git log -1 --format=%s)
	if [[ "$actual_title" =~ $expected_re ]]; then
		echo "PASS $name (title: $actual_title)"
		PASS=$((PASS + 1))
	else
		echo "FAIL $name"
		echo "  expected title to match: $expected_re"
		echo "  actual title:            $actual_title"
		FAIL=$((FAIL + 1))
	fi
}

assert_body_matches() {
	local root="$1" name="$2" expected_re="$3" actual_body
	actual_body=$(cd "$root" && git log -1 --format=%B)
	if [[ "$actual_body" =~ $expected_re ]]; then
		echo "PASS $name"
		PASS=$((PASS + 1))
	else
		echo "FAIL $name"
		echo "  expected body to contain: $expected_re"
		echo "  actual body:"
		echo "$actual_body" | sed 's/^/    /'
		FAIL=$((FAIL + 1))
	fi
}

assert_body_does_not_match() {
	local root="$1" name="$2" forbidden_re="$3" actual_body
	actual_body=$(cd "$root" && git log -1 --format=%B)
	if [[ "$actual_body" =~ $forbidden_re ]]; then
		echo "FAIL $name"
		echo "  body contained forbidden pattern: $forbidden_re"
		echo "  actual body:"
		echo "$actual_body" | sed 's/^/    /'
		FAIL=$((FAIL + 1))
	else
		echo "PASS $name"
		PASS=$((PASS + 1))
	fi
}

# -----------------------------------------------------------------------------
# Scenario A: Old-format JSON (no source/direction/design_queue_added fields).
# Title must NOT contain any "[spec-drift: ...]" bracket and body must NOT
# contain the "Spec-drift direction breakdown:" block.
# -----------------------------------------------------------------------------
scenario_a_old_format() {
	local root
	root=$(mktemp -d)
	trap "rm -rf '$root'" RETURN
	local iter_dir
	iter_dir=$(setup_fixture "$root" 0)
	cat > "$iter_dir/fix-or-backlog.json" <<'EOF'
{
  "fix_now_applied": [
    {"finding_id": "legacy1", "file": "src/foo.ts", "change_summary": "legacy fix"}
  ],
  "escalated": [],
  "backlog_added": []
}
EOF
	(cd "$root" && echo "content" > src-foo-proxy.ts && git add src-foo-proxy.ts)
	run_commit_iter "$root" 0 >/dev/null
	assert_title_matches "$root" "A1 old-format title has no spec-drift bracket" \
		'^chore\(loop-clean\): iter 0'
	assert_body_does_not_match "$root" "A2 old-format body has no breakdown block" \
		'Spec-drift direction breakdown'
}

# -----------------------------------------------------------------------------
# Scenario B: source=spec-drift but direction=null. Guard must suppress the
# breakdown block entirely (no "Spec-drift direction breakdown:" header).
# -----------------------------------------------------------------------------
scenario_b_null_direction() {
	local root
	root=$(mktemp -d)
	trap "rm -rf '$root'" RETURN
	local iter_dir
	iter_dir=$(setup_fixture "$root" 1)
	cat > "$iter_dir/fix-or-backlog.json" <<'EOF'
{
  "fix_now_applied": [
    {"finding_id": "sd1", "file": "src/foo.ts", "source": "spec-drift", "direction": null}
  ],
  "escalated": [],
  "backlog_added": [],
  "design_queue_added": []
}
EOF
	(cd "$root" && echo "content" > src-foo-proxy.ts && git add src-foo-proxy.ts)
	run_commit_iter "$root" 1 >/dev/null
	assert_body_does_not_match "$root" "B1 null-direction suppresses breakdown header" \
		'Spec-drift direction breakdown'
}

# -----------------------------------------------------------------------------
# Scenario C: Full breakdown with code→spec, spec→code:completion, direction-
# block gate, and a different gate. Body should list all four counts.
# -----------------------------------------------------------------------------
scenario_c_full_breakdown() {
	local root
	root=$(mktemp -d)
	trap "rm -rf '$root'" RETURN
	local iter_dir
	iter_dir=$(setup_fixture "$root" 2)
	cat > "$iter_dir/fix-or-backlog.json" <<'EOF'
{
  "fix_now_applied": [
    {"finding_id": "sd1", "file": "src/a.ts", "source": "spec-drift", "direction": "code→spec"},
    {"finding_id": "sd2", "file": "src/b.ts", "source": "spec-drift", "direction": "code→spec"},
    {"finding_id": "sd3", "file": "specs/n.md", "source": "spec-drift", "direction": "spec→code:completion"}
  ],
  "escalated": [],
  "backlog_added": [],
  "design_queue_added": [
    {"finding_id": "d1", "gate_triggered": "direction-block"},
    {"finding_id": "d2", "gate_triggered": "single-layer"}
  ]
}
EOF
	(cd "$root" && echo "x" > src-a.txt && git add src-a.txt)
	run_commit_iter "$root" 2 >/dev/null
	assert_body_matches "$root" "C1 breakdown shows code→spec: 2" \
		'code→spec: 2'
	assert_body_matches "$root" "C2 breakdown shows spec→code:completion: 1" \
		'spec→code:completion: 1'
	assert_body_matches "$root" "C3 breakdown shows escalated (direction-block): 1" \
		'escalated \(direction-block\): 1'
	assert_body_matches "$root" "C4 breakdown shows other gates: 1" \
		'other gates.*: 1'
}

# -----------------------------------------------------------------------------
# Scenario D: design-queue.md is staged when gate escalations occurred.
# -----------------------------------------------------------------------------
scenario_d_design_queue_staged() {
	local root
	root=$(mktemp -d)
	trap "rm -rf '$root'" RETURN
	local iter_dir
	iter_dir=$(setup_fixture "$root" 3)
	cat > "$iter_dir/fix-or-backlog.json" <<'EOF'
{
  "fix_now_applied": [],
  "escalated": [],
  "backlog_added": [],
  "design_queue_added": [
    {"finding_id": "d1", "gate_triggered": "direction-block"}
  ]
}
EOF
	(
		cd "$root"
		echo "# Design queue" > design-queue.md
		echo "- [ ] item" >> design-queue.md
	)
	# Do not pre-add — let cmd_commit_iter pick it up.
	run_commit_iter "$root" 3 >/dev/null
	# After commit, design-queue.md should have been committed.
	local in_commit dq_diff
	in_commit=$(cd "$root" && git show --stat HEAD 2>/dev/null | grep -c "design-queue.md" || true)
	dq_diff=$(cd "$root" && git diff -- design-queue.md 2>/dev/null || true)
	if [[ -z "$dq_diff" && "$in_commit" -ge 1 ]]; then
		echo "PASS D1 design-queue.md staged and committed"
		PASS=$((PASS + 1))
	else
		echo "FAIL D1 design-queue.md not properly staged"
		echo "  in_commit count: $in_commit"
		echo "  unstaged diff: $dq_diff"
		FAIL=$((FAIL + 1))
	fi
}

# -----------------------------------------------------------------------------
scenario_a_old_format
scenario_b_null_direction
scenario_c_full_breakdown
scenario_d_design_queue_staged

echo ""
echo "=== $PASS pass, $FAIL fail ==="
[[ "$FAIL" -eq 0 ]] || exit 1
