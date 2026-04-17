#!/usr/bin/env bash
# enroll.sh — Enroll the current repo for a nightly-clean cloud Routine.
#
# Copies the required skills + scripts from ~/.claude/ into the repo's
# .claude/ directory, patches SKILL.md references from user-home to
# project-local (Routines have no ~/.claude), writes the routine-setup.sh
# and nightly-clean-run.sh helpers, and updates .gitignore.
#
# Usage (driven by nightly-clean-enroll/SKILL.md):
#   bash enroll.sh init     # Full setup (first time)
#   bash enroll.sh refresh  # Re-copy latest skills from ~/.claude/
#   bash enroll.sh status   # Show what's installed
#   bash enroll.sh uninstall # Remove all enrollment artifacts

set -euo pipefail

# Skills required by the nightly prompt. Order matters: dependencies first.
readonly SKILLS=(
	senior-review
	dedup-codebase
	fix-or-backlog
	loop-clean
	backlog-crush
	backlog-deep-crush
)

# Scripts referenced by skills (node/bash helpers living outside skills/).
readonly SCRIPTS=(
	spec-drift
)

# Sub-agents invoked by copied skills via `subagent_type: "<name>"`, plus
# transitive sub-agents invoked by orchestrator agents themselves.
# Without these copied into the repo's .claude/agents/, the Routine cloud env
# will fail at the first Agent() call that references them.
#
# Dependency graph (why each agent is here):
#   /loop-clean            → loop-clean-orchestrator → senior-reviewer-file
#   /senior-review         → senior-reviewer-file
#   /dedup-codebase        → dedup-intra + dedup-inter
#   /fix-or-backlog        → fix-file
#   /backlog-crush         → backlog-crush-orchestrator → backlog-fix + loop-clean-orchestrator
#   /backlog-deep-crush    → backlog-deep-crush-orchestrator → backlog-fix + loop-clean-orchestrator
readonly AGENTS=(
	loop-clean-orchestrator
	backlog-crush-orchestrator
	backlog-deep-crush-orchestrator
	senior-reviewer-file
	backlog-fix
	fix-file
	dedup-intra
	dedup-inter
)

readonly SOURCE_HOME="$HOME/.claude"
readonly TARGET_SKILLS=".claude/skills"
readonly TARGET_SCRIPTS=".claude/scripts"
readonly TARGET_AGENTS=".claude/agents"
readonly ROUTINE_SETUP=".claude/routine-setup.sh"
readonly NIGHTLY_RUNNER=".claude/nightly-clean-run.sh"
readonly GITIGNORE=".gitignore"
readonly RUN_DIR_ENTRY=".claude/run/"

_err() { echo "ERROR: $*" >&2; exit 1; }
_info() { echo "  • $*"; }
_ok() { echo "  ✓ $*"; }
_warn() { echo "  ⚠ $*" >&2; }

_require_git_repo() {
	git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
		|| _err "Not inside a git repository. Run enroll from the target repo root."
}

_remove_if_exists() {
	local path="$1"
	[[ -e "$path" ]] || return 0
	if command -v trash >/dev/null 2>&1; then
		trash "$path" 2>/dev/null || rm -rf "$path"
	else
		rm -rf "$path"
	fi
}

# Patch absolute ~/.claude/ references in all .md files under `dir` to
# project-local paths. Required because the Routine cloud env has no
# ~/.claude/ directory. Also handles $HOME/.claude/ and ${HOME}/.claude/
# variants. Applied to both copied SKILL.md (skill dirs) and agent .md files
# (agent orchestrators reference skill scripts via ~/.claude/skills/...).
_patch_paths() {
	local target="$1"
	[[ -e "$target" ]] || return 0
	# Detect sed dialect once. GNU sed (Linux) has `--version`; BSD sed (macOS)
	# does not and requires `-i ''` for in-place. Cache the argv as an array.
	local -a sed_inplace
	if sed --version >/dev/null 2>&1; then
		sed_inplace=(-i)
	else
		sed_inplace=(-i '')
	fi
	# Find any .md file under target (covers SKILL.md in skill dirs, and
	# <agent>.md when target is a single agent file).
	local find_args
	if [[ -d "$target" ]]; then
		find_args=(find "$target" -type f -name '*.md' -print0)
	else
		# Single file: wrap in find -f-like via explicit path.
		find_args=(find "$target" -maxdepth 0 -type f -print0)
	fi
	"${find_args[@]}" \
		| while IFS= read -r -d '' file; do
			# Escape the literal dot in ~/.claude to avoid matching ~Xclaude/.
			sed "${sed_inplace[@]}" \
				-e 's|~/\.claude/skills/|.claude/skills/|g' \
				-e 's|~/\.claude/scripts/|.claude/scripts/|g' \
				-e 's|~/\.claude/agents/|.claude/agents/|g' \
				-e 's|\$HOME/\.claude/skills/|.claude/skills/|g' \
				-e 's|\$HOME/\.claude/scripts/|.claude/scripts/|g' \
				-e 's|\$HOME/\.claude/agents/|.claude/agents/|g' \
				-e 's|\${HOME}/\.claude/skills/|.claude/skills/|g' \
				-e 's|\${HOME}/\.claude/scripts/|.claude/scripts/|g' \
				-e 's|\${HOME}/\.claude/agents/|.claude/agents/|g' \
				"$file"
		done
}

_copy_skill() {
	local name="$1"
	local src="$SOURCE_HOME/skills/$name"
	local dst="$TARGET_SKILLS/$name"
	[[ -d "$src" ]] || _err "Source skill missing: $src"
	mkdir -p "$TARGET_SKILLS"
	_remove_if_exists "$dst"
	cp -R "$src" "$dst"
	_patch_paths "$dst"
	_ok "skill $name"
}

_copy_script() {
	local name="$1"
	local src="$SOURCE_HOME/scripts/$name"
	local dst="$TARGET_SCRIPTS/$name"
	if [[ ! -d "$src" ]]; then
		_warn "script $name not found at $src, skipping"
		return 0
	fi
	mkdir -p "$TARGET_SCRIPTS"
	_remove_if_exists "$dst"
	cp -R "$src" "$dst"
	_ok "script $name"
}

_copy_agent() {
	local name="$1"
	local src="$SOURCE_HOME/agents/$name.md"
	local dst="$TARGET_AGENTS/$name.md"
	[[ -f "$src" ]] || _err "Required sub-agent missing: $src (see AGENTS array in enroll.sh for the nightly workflow dependency graph)"
	mkdir -p "$TARGET_AGENTS"
	_remove_if_exists "$dst"
	cp "$src" "$dst"
	# Orchestrator agents reference ~/.claude/skills/*.sh and ~/.claude/scripts/
	# in their system prompt — patch those to project-local paths too.
	_patch_paths "$dst"
	_ok "agent $name"
}

_ensure_gitignore() {
	if [[ ! -f "$GITIGNORE" ]]; then
		touch "$GITIGNORE"
	fi
	if grep -qxF "$RUN_DIR_ENTRY" "$GITIGNORE"; then
		_info "$GITIGNORE already contains $RUN_DIR_ENTRY"
		return 0
	fi
	# Ensure file ends with a newline before appending, otherwise our entry
	# would stick to the previous line and grep -qxF would fail on re-run,
	# causing infinite re-appends.
	if [[ -s "$GITIGNORE" ]] && [[ -n "$(tail -c 1 "$GITIGNORE")" ]]; then
		printf '\n' >> "$GITIGNORE"
	fi
	echo "$RUN_DIR_ENTRY" >> "$GITIGNORE"
	_ok "added $RUN_DIR_ENTRY to $GITIGNORE"
}

_write_routine_setup() {
	mkdir -p "$(dirname "$ROUTINE_SETUP")"
	cat > "$ROUTINE_SETUP" <<'SETUP'
#!/usr/bin/env bash
# routine-setup.sh — Runs at the start of every nightly-clean Routine.
# Installs required CLIs and validates GH_TOKEN.
set -euo pipefail

# Hard-fail if GH_TOKEN missing — downstream PR upsert depends on it, and
# silently running without it produces no PR (invisible failure mode).
if [[ -z "${GH_TOKEN:-}" ]]; then
	echo "ERROR: GH_TOKEN env var not set. Set it in the Routine's env vars (scope: repo)." >&2
	exit 1
fi

# Install missing dependencies. The runner needs: gh (PR upsert), jq (skill
# scripts), node (spec-drift.ts), sha256sum (backlog item IDs — usually present).
_need_install=()
command -v gh >/dev/null 2>&1 || _need_install+=(gh)
command -v jq >/dev/null 2>&1 || _need_install+=(jq)
command -v node >/dev/null 2>&1 || _need_install+=(nodejs)

if [[ ${#_need_install[@]} -gt 0 ]]; then
	echo "Installing: ${_need_install[*]}"
	if ! command -v apt-get >/dev/null 2>&1; then
		echo "ERROR: apt-get not available; cannot auto-install ${_need_install[*]}. Add to Routine env." >&2
		exit 1
	fi
	sudo apt-get -qq update

	# gh needs its own apt source.
	if [[ " ${_need_install[*]} " == *" gh "* ]]; then
		type -p curl >/dev/null || sudo apt-get -qq install -y curl
		sudo mkdir -p -m 755 /etc/apt/keyrings
		curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
			| sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
		sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
		echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
			| sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
		sudo apt-get -qq update
	fi
	sudo apt-get -qq install -y "${_need_install[@]}"
fi

# Final verification. If any binary is still missing, the Routine will fail
# cryptically later — prefer a clear error here.
for bin in gh jq node; do
	if ! command -v "$bin" >/dev/null 2>&1; then
		echo "ERROR: $bin still not available after install. Aborting." >&2
		exit 1
	fi
done
SETUP
	chmod +x "$ROUTINE_SETUP"
	_ok "wrote $ROUTINE_SETUP"
}

_write_nightly_runner() {
	mkdir -p "$(dirname "$NIGHTLY_RUNNER")"
	cat > "$NIGHTLY_RUNNER" <<'RUNNER'
#!/usr/bin/env bash
# nightly-clean-run.sh — Pre/post git orchestration for nightly-clean Routine.
#
# Invoked by the Routine prompt around the /loop-clean + /backlog-deep-crush
# block. Pure T-operation: no semantic decisions.
#
# Subcommands:
#   pre  — skip-check, fetch, create/reset claude/nightly-clean from default.
#          Exits 1 if skip conditions met (caller must stop).
#   post — commit changes (if any), tag archive, force-push, upsert PR.
#
# Env vars (set by Routine):
#   GH_TOKEN       — required for gh CLI calls (PR metadata, PR upsert).
#   NIGHTLY_BRANCH — override branch name (default: claude/nightly-clean).
#   ARCHIVE_RETENTION_DAYS — GC threshold for archive tags (default: 14).

set -euo pipefail

readonly BRANCH="${NIGHTLY_BRANCH:-claude/nightly-clean}"
readonly RETENTION_DAYS="${ARCHIVE_RETENTION_DAYS:-14}"
readonly SKIP_LABEL="wip-review"
readonly TODAY="$(date -u +%Y-%m-%d)"
readonly ARCHIVE_TAG="nightly-clean-archive-${TODAY}"

_log() { echo "[nightly-clean-run] $*"; }
_warn() { echo "[nightly-clean-run] WARN: $*" >&2; }
_err() { echo "[nightly-clean-run] ERROR: $*" >&2; exit 2; }

_default_branch() {
	local ref out
	ref=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
	if [[ -n "$ref" ]]; then
		out="${ref#refs/remotes/origin/}"
	else
		# Fallback: set HEAD from remote (network), then query symbolic-ref again.
		git remote set-head origin -a >/dev/null 2>&1 || true
		ref=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
		if [[ -n "$ref" ]]; then
			out="${ref#refs/remotes/origin/}"
		else
			out=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF; exit}')
		fi
	fi
	# Reject "(unknown)" or empty — git CLI returns these when HEAD is not set remotely.
	if [[ -z "$out" || "$out" == "(unknown)" ]]; then
		return 1
	fi
	echo "$out"
}

_current_pr_number() {
	# Returns PR number if an open PR exists from BRANCH → default, else empty.
	gh pr list --head "$BRANCH" --state open --json number \
		--jq '.[0].number // empty' 2>/dev/null || true
}

_has_skip_label() {
	local pr="$1"
	[[ -z "$pr" ]] && return 1
	gh pr view "$pr" --json labels --jq ".labels[].name" 2>/dev/null \
		| grep -qxF "$SKIP_LABEL"
}

_has_non_claude_commits() {
	# Detects commits on the remote branch that were not authored by the
	# runner itself. Exact email match against CLAUDE_COMMITTER_EMAIL (the
	# same email the runner uses to commit) avoids substring false-positives
	# (e.g. "claudette@company.com") and false-negatives (bot email without
	# "claude" substring).
	local bot_email="${CLAUDE_COMMITTER_EMAIL:-claude-nightly@anthropic.com}"
	if ! git fetch origin "$BRANCH" 2>/dev/null; then
		# Fetch failed: cannot determine. Fail safe = assume non-Claude commits
		# exist (skip), rather than forcing push over potentially-valuable state.
		_warn "fetch of origin/$BRANCH failed; assuming non-Claude commits present"
		return 0
	fi
	local commits
	commits=$(git log "origin/$BRANCH" --pretty='%ae|%s' 2>/dev/null || true)
	[[ -z "$commits" ]] && return 1
	while IFS='|' read -r email subject; do
		if [[ "$email" != "$bot_email" ]] && [[ ! "$subject" =~ nightly-clean ]]; then
			return 0
		fi
	done <<< "$commits"
	return 1
}

cmd_pre() {
	local default
	if ! default=$(_default_branch); then
		_err "cannot determine default branch (origin/HEAD not set and remote lookup failed)"
	fi
	_log "default branch: $default"
	_log "nightly branch: $BRANCH"

	# --prune-tags AND --prune so both refs and tags are cleaned up.
	git fetch origin --prune --prune-tags --tags >/dev/null 2>&1 || {
		_err "git fetch origin failed (network issue?) — aborting to avoid acting on stale refs"
	}

	# Verify the default branch ref is actually available locally post-fetch.
	if ! git rev-parse --verify "origin/$default" >/dev/null 2>&1; then
		_err "origin/$default not found after fetch"
	fi

	# Skip conditions (only relevant if branch already exists remotely).
	# On first run, this entire block is skipped — proceed directly to branch reset.
	if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
		local pr
		pr=$(_current_pr_number)
		if [[ -n "$pr" ]] && _has_skip_label "$pr"; then
			_log "SKIP: open PR #$pr has label $SKIP_LABEL"
			exit 1
		fi
		if _has_non_claude_commits; then
			_log "SKIP: non-Claude commits detected on origin/$BRANCH"
			exit 1
		fi
	else
		_log "first run detected (origin/$BRANCH does not exist yet)"
	fi

	# Create/reset local branch from the latest default.
	git checkout -B "$BRANCH" "origin/$default"
	_log "reset $BRANCH to origin/$default"

	# GC old archive tags (purely local; force-push handles remote).
	local cutoff_ts
	if date -u -d "${RETENTION_DAYS} days ago" +%s >/dev/null 2>&1; then
		cutoff_ts=$(date -u -d "${RETENTION_DAYS} days ago" +%s)
	else
		# BSD date fallback (macOS runner).
		cutoff_ts=$(date -u -v "-${RETENTION_DAYS}d" +%s 2>/dev/null || echo 0)
	fi
	if [[ "$cutoff_ts" -gt 0 ]]; then
		git tag -l 'nightly-clean-archive-*' | while read -r tag; do
			local tag_date="${tag#nightly-clean-archive-}"
			local tag_ts
			tag_ts=$(date -u -d "$tag_date" +%s 2>/dev/null \
				|| date -u -j -f "%Y-%m-%d" "$tag_date" +%s 2>/dev/null \
				|| echo 0)
			if [[ "$tag_ts" -gt 0 && "$tag_ts" -lt "$cutoff_ts" ]]; then
				git tag -d "$tag" >/dev/null 2>&1 || true
				git push origin --delete "$tag" >/dev/null 2>&1 || true
				_log "GC: deleted tag $tag"
			fi
		done
	fi
}

cmd_post() {
	# gh is required for PR upsert — fail fast if missing rather than push
	# without a PR (which would leave the nightly branch drifting silently).
	command -v gh >/dev/null 2>&1 || _err "gh CLI not installed — cannot upsert PR. Check routine-setup.sh ran successfully."

	local default
	if ! default=$(_default_branch); then
		_err "cannot determine default branch in post"
	fi

	# Detect per-iteration commits produced by loop-clean.sh commit-iter during
	# the loop. If present, skip the bulk commit — commits already carry
	# segmented, reviewable history. Only the archive/push/PR steps remain.
	local iter_commits=0
	if git rev-parse --verify "origin/$default" >/dev/null 2>&1; then
		iter_commits=$(git log "origin/$default..HEAD" --pretty='%s' 2>/dev/null \
			| grep -c '^chore(loop-clean): iter' || true)
	fi

	# Scope `git add` to known cleanup targets instead of `-A`. Broad `-A`
	# in a cloud env with write permissions is an attack surface (credentials,
	# editor swaps, node_modules). Extend this list ONLY with dirs the
	# cleanup skills legitimately touch.
	local -a scoped_paths=(
		backlog.md
		.claude/nightly-runs.log
	)
	# Also stage anything under source directories the user's repo uses.
	# Use a guard: stage each path only if it exists OR if it's in the diff.
	git add "${scoped_paths[@]}" 2>/dev/null || true
	# Source code changes: stage known src-like directories if present.
	for dir in src lib app pkg internal; do
		[[ -d "$dir" ]] && git add "$dir" 2>/dev/null || true
	done

	local has_staged=1
	if git diff --cached --quiet; then
		has_staged=0
	fi

	# Three exit paths based on (iter_commits, has_staged):
	# 1. No iter commits + no staged → nothing to do (original behavior)
	# 2. Iter commits exist + no staged → skip bulk commit, proceed to push
	# 3. Anything staged → bulk commit leftovers, proceed to push
	if [[ "$iter_commits" -eq 0 && "$has_staged" -eq 0 ]]; then
		_log "no changes produced by nightly run — nothing to push"
		local pr
		pr=$(_current_pr_number)
		if [[ -n "$pr" ]]; then
			gh pr comment "$pr" --body "Nightly run produced no changes on $TODAY." \
				>/dev/null 2>&1 || _warn "gh pr comment failed"
		fi
		return 0
	fi

	if [[ "$iter_commits" -gt 0 && "$has_staged" -eq 0 ]]; then
		_log "detected $iter_commits per-iteration commit(s); skipping bulk commit"
	fi

	# Prepare author identity. Use a github-verifiable email format where
	# possible; the Routine can override via GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL
	# or CLAUDE_COMMITTER_EMAIL to match whatever GitHub considers verified.
	local author_name author_email
	author_name="${GIT_AUTHOR_NAME:-Claude Nightly}"
	author_email="${GIT_AUTHOR_EMAIL:-${CLAUDE_COMMITTER_EMAIL:-claude-nightly@anthropic.com}}"
	export CLAUDE_COMMITTER_EMAIL="$author_email"

	# Archive fallback log: write BEFORE the main commit so it ends up in
	# the same commit instead of a brittle post-commit amend.
	local prev_sha="" archive_fallback_written=0
	if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
		prev_sha=$(git rev-parse "origin/$BRANCH" 2>/dev/null || true)
		if [[ -n "$prev_sha" ]]; then
			# Try tag first in dry-run mode (no push yet). If tag creation
			# itself fails (permission, already exists), fall back to log file.
			if ! git tag -a "$ARCHIVE_TAG" "$prev_sha" \
					-m "Archive of $BRANCH before nightly run $TODAY" 2>/dev/null; then
				_log "FALLBACK: tag create failed (already exists for today?); writing to .claude/nightly-runs.log"
				mkdir -p .claude
				echo "$TODAY archive_sha=$prev_sha" >> .claude/nightly-runs.log
				git add .claude/nightly-runs.log
				archive_fallback_written=1
			fi
		fi
	fi

	# Bulk commit only if there's something staged (may include the archive
	# fallback log added above). If per-iter commits already cover the run
	# and archive tag succeeded, the staging area may be empty — skip cleanly.
	if ! git diff --cached --quiet; then
		git -c "user.name=$author_name" -c "user.email=$author_email" \
			commit -m "chore(nightly-clean): cleanup run $TODAY" \
			-m "Automated /loop-clean + /backlog-deep-crush sweep."
		_log "committed nightly changes"
	else
		_log "no staged changes — skipping bulk commit (per-iter commits or clean run)"
	fi

	# Attempt to push the archive tag (if we successfully created one above).
	# If push fails (proxy restriction), fall back to log file via an amend —
	# but tolerate amend failure (hooks, empty diff) without aborting the run.
	if [[ -n "$prev_sha" && "$archive_fallback_written" -eq 0 ]]; then
		if git push origin "$ARCHIVE_TAG" 2>/dev/null; then
			_log "pushed archive tag $ARCHIVE_TAG"
		else
			_log "FALLBACK: tag push blocked; appending to .claude/nightly-runs.log"
			git tag -d "$ARCHIVE_TAG" >/dev/null 2>&1 || true
			mkdir -p .claude
			echo "$TODAY archive_sha=$prev_sha" >> .claude/nightly-runs.log
			git add .claude/nightly-runs.log
			if ! git -c "user.name=$author_name" -c "user.email=$author_email" \
					commit --amend --no-edit >/dev/null 2>&1; then
				_warn "amend failed (hook rejection?); continuing without log file in the commit"
			fi
		fi
	fi

	# --force-with-lease rather than --force: rejects the push if someone
	# pushed between cmd_pre (fetch) and cmd_post, preserving their work.
	local lease_ref="refs/heads/$BRANCH"
	local lease_expected
	if [[ -n "$prev_sha" ]]; then
		lease_expected="$prev_sha"
	else
		# First run: no prior ref — lease against empty so the push succeeds
		# only if the branch still doesn't exist remotely.
		lease_expected=""
	fi
	if [[ -n "$lease_expected" ]]; then
		if ! git push --force-with-lease="$lease_ref:$lease_expected" origin "$BRANCH"; then
			_err "push rejected: origin/$BRANCH changed since fetch. Another push intervened — aborting to preserve that work. Investigate and retry next run."
		fi
	else
		# First push of a new branch: no lease needed.
		git push origin "$BRANCH"
	fi
	_log "force-pushed $BRANCH (with lease)"

	# Upsert the PR.
	local pr
	pr=$(_current_pr_number)
	if [[ -z "$pr" ]]; then
		if gh pr create --base "$default" --head "$BRANCH" \
				--title "chore(nightly-clean): cleanup run $TODAY" \
				--body "Automated nightly cleanup. Review and merge if looks good." \
				>/dev/null 2>&1; then
			_log "opened new PR"
		else
			_warn "gh pr create failed (already exists? eventual consistency?); checking again"
			pr=$(_current_pr_number)
			[[ -n "$pr" ]] && _log "PR #$pr detected on retry" || _err "gh pr create failed and no PR exists"
		fi
	else
		gh pr edit "$pr" \
			--title "chore(nightly-clean): cleanup run $TODAY" \
			--body "Automated nightly cleanup. Latest run: $TODAY." \
			>/dev/null 2>&1 || _warn "gh pr edit failed for PR #$pr"
		_log "updated PR #$pr"
	fi
}

usage() {
	cat >&2 <<EOF
Usage:
  nightly-clean-run.sh pre
  nightly-clean-run.sh post
EOF
	exit 2
}

main() {
	[[ $# -lt 1 ]] && usage
	case "$1" in
		pre) cmd_pre ;;
		post) cmd_post ;;
		*) usage ;;
	esac
}

main "$@"
RUNNER
	chmod +x "$NIGHTLY_RUNNER"
	_ok "wrote $NIGHTLY_RUNNER"
}

cmd_init() {
	_require_git_repo
	echo "==> Copying skills to $TARGET_SKILLS/ (with path patching)"
	for s in "${SKILLS[@]}"; do _copy_skill "$s"; done
	echo "==> Copying scripts to $TARGET_SCRIPTS/"
	for s in "${SCRIPTS[@]}"; do _copy_script "$s"; done
	echo "==> Copying sub-agents to $TARGET_AGENTS/"
	for a in "${AGENTS[@]}"; do _copy_agent "$a"; done
	echo "==> Writing helpers"
	_write_routine_setup
	_write_nightly_runner
	echo "==> Updating $GITIGNORE"
	_ensure_gitignore
	echo ""
	echo "✅ Enrollment complete for $(basename "$PWD")"
	echo ""
	echo "Next steps (manual, UI side):"
	echo "  1. Commit and push the .claude/ additions"
	echo "  2. Create a Routine at https://claude.ai/code/routines"
	echo "     — Trigger: Planification, cron '0 2 * * *'"
	echo "     — Setup script: .claude/routine-setup.sh"
	echo "     — Env vars: GH_TOKEN=<gh token with repo scope>"
	echo "     — Prompt: see nightly-clean-enroll/SKILL.md Etape 3"
}

cmd_refresh() {
	_require_git_repo
	echo "==> Refreshing skills from $SOURCE_HOME/skills"
	for s in "${SKILLS[@]}"; do _copy_skill "$s"; done
	for s in "${SCRIPTS[@]}"; do _copy_script "$s"; done
	for a in "${AGENTS[@]}"; do _copy_agent "$a"; done
	_write_routine_setup
	_write_nightly_runner
	_ensure_gitignore
	echo "✅ Refresh complete"
}

cmd_status() {
	echo "Repo: $(basename "$PWD")"
	echo ""
	echo "Skills copied in $TARGET_SKILLS/:"
	for s in "${SKILLS[@]}"; do
		if [[ -d "$TARGET_SKILLS/$s" ]]; then
			echo "  ✓ $s"
		else
			echo "  ✗ $s (missing)"
		fi
	done
	echo ""
	echo "Scripts copied in $TARGET_SCRIPTS/:"
	for s in "${SCRIPTS[@]}"; do
		if [[ -d "$TARGET_SCRIPTS/$s" ]]; then
			echo "  ✓ $s"
		else
			echo "  ✗ $s (missing)"
		fi
	done
	echo ""
	echo "Sub-agents copied in $TARGET_AGENTS/:"
	for a in "${AGENTS[@]}"; do
		if [[ -f "$TARGET_AGENTS/$a.md" ]]; then
			echo "  ✓ $a"
		else
			echo "  ✗ $a (missing)"
		fi
	done
	echo ""
	[[ -f "$ROUTINE_SETUP" ]] && echo "  ✓ $ROUTINE_SETUP" || echo "  ✗ $ROUTINE_SETUP"
	[[ -f "$NIGHTLY_RUNNER" ]] && echo "  ✓ $NIGHTLY_RUNNER" || echo "  ✗ $NIGHTLY_RUNNER"
	if [[ -f "$GITIGNORE" ]] && grep -qxF "$RUN_DIR_ENTRY" "$GITIGNORE"; then
		echo "  ✓ $GITIGNORE contains $RUN_DIR_ENTRY"
	else
		echo "  ✗ $GITIGNORE missing $RUN_DIR_ENTRY"
	fi
}

cmd_uninstall() {
	_require_git_repo
	echo "==> Removing enrollment artifacts"
	for s in "${SKILLS[@]}"; do
		_remove_if_exists "$TARGET_SKILLS/$s"
		_ok "removed skill $s"
	done
	for s in "${SCRIPTS[@]}"; do
		_remove_if_exists "$TARGET_SCRIPTS/$s"
		_ok "removed script $s"
	done
	for a in "${AGENTS[@]}"; do
		_remove_if_exists "$TARGET_AGENTS/$a.md"
		_ok "removed agent $a"
	done
	_remove_if_exists "$ROUTINE_SETUP"
	_remove_if_exists "$NIGHTLY_RUNNER"
	# Keep .gitignore entry — harmless.
	echo "✅ Uninstall complete. Remember to delete the cloud Routine manually."
}

usage() {
	cat >&2 <<EOF
Usage:
  enroll.sh init       # Full setup (first time for a repo)
  enroll.sh refresh    # Re-copy latest skills from ~/.claude/
  enroll.sh status     # Show what's installed
  enroll.sh uninstall  # Remove all enrollment artifacts
EOF
	exit 2
}

main() {
	[[ $# -lt 1 ]] && usage
	case "$1" in
		init) cmd_init ;;
		refresh) cmd_refresh ;;
		status) cmd_status ;;
		uninstall) cmd_uninstall ;;
		*) usage ;;
	esac
}

main "$@"
