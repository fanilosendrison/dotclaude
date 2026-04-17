#!/usr/bin/env bash
# enroll.sh — Enroll the current repo for a nightly-clean cloud Routine.
#
# Vendor mode: the target repo tracks only 2 helper scripts. Skills, agents,
# and scripts are cloned at Routine runtime from a central private repo
# (fanilosendrison/cc-skills), keeping the target repo clean.
#
# Usage:
#   bash enroll.sh init          # Write helpers + update .gitignore
#   bash enroll.sh sync-vendor   # Push ~/.claude/{skills,agents,scripts}/ to cc-skills
#   bash enroll.sh status        # Show enrollment state
#   bash enroll.sh uninstall     # Remove helpers (keep .gitignore entries)

set -euo pipefail

# --- Configuration -----------------------------------------------------------

readonly VENDOR_REPO="fanilosendrison/cc-skills"
readonly VENDOR_BRANCH="dev"

readonly TARGET_CLAUDE=".claude"
readonly ROUTINE_SETUP=".claude/routine-setup.sh"
readonly NIGHTLY_RUNNER=".claude/nightly-clean-run.sh"
readonly GITIGNORE=".gitignore"

# Vendor working copy (for sync-vendor). One per user, shared across repos.
readonly VENDOR_WORK="${HOME}/.cache/cc-skills-vendor"

# --- Helpers -----------------------------------------------------------------

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

# .gitignore policy: ignore contents of .claude/ except our two helpers.
# CRITICAL: use `.claude/*` (glob), NOT `.claude/` (directory). With the
# directory form, Git doesn't descend and the `!` negations have no effect.
# See https://git-scm.com/docs/gitignore ("It is not possible to re-include
# a file if a parent directory of that file is excluded.")
_ensure_gitignore() {
	if [[ ! -f "$GITIGNORE" ]]; then
		touch "$GITIGNORE"
	fi

	# Detect pre-existing plain `.claude/` entry that would neutralize our
	# negations. Abort with clear instructions rather than silently fail.
	if grep -qE '^\.claude/\s*$' "$GITIGNORE"; then
		_err "$GITIGNORE contains a plain '.claude/' entry which blocks negations. Change it to '.claude/*' (glob) manually, then re-run."
	fi

	local marker="# ---------- nightly-clean enrollment ----------"
	if grep -qF "$marker" "$GITIGNORE"; then
		_info "$GITIGNORE already has nightly-clean block"
		return 0
	fi

	if [[ -s "$GITIGNORE" ]] && [[ -n "$(tail -c 1 "$GITIGNORE")" ]]; then
		printf '\n' >> "$GITIGNORE"
	fi

	cat >> "$GITIGNORE" <<EOF

$marker
.claude/*
!$ROUTINE_SETUP
!$NIGHTLY_RUNNER
EOF
	_ok "appended nightly-clean block to $GITIGNORE"
}

# routine-setup.sh runs at the start of every nightly Routine. It installs
# required CLIs, clones the cc-skills vendor repo, and patches path references
# from ~/.claude/ to .claude/ since the cloud env has no ~/.claude/ directory.
_write_routine_setup() {
	mkdir -p "$(dirname "$ROUTINE_SETUP")"
	cat > "$ROUTINE_SETUP" <<SETUP
#!/usr/bin/env bash
# routine-setup.sh — Runs at the start of every nightly-clean Routine.
# 1. Hard-fail without GH_TOKEN (required for gh CLI + cc-skills clone).
# 2. Install missing CLIs: gh, jq, node.
# 3. Clone fanilosendrison/cc-skills into .claude/ (skills, agents, scripts).
# 4. Patch ~/.claude/... refs to .claude/... in all .md files.
set -euo pipefail

if [[ -z "\${GH_TOKEN:-}" ]]; then
	echo "ERROR: GH_TOKEN env var not set. Set it in the Routine's env vars (scope: repo)." >&2
	exit 1
fi

# Install gh via direct binary download (bypass apt entirely).
# The cloud env has pre-installed node/jq; broken 3rd-party PPAs
# (deadsnakes, ondrej/php) cause \`apt-get update\` to fail with 403.
# Pinned version avoids github.com API rate limits on shared cloud IPs
# (anon GitHub API = 60 req/h per IP). Bump GH_VERSION manually.
readonly GH_VERSION="2.64.0"
if ! command -v gh >/dev/null 2>&1; then
	echo "Installing gh CLI \${GH_VERSION} via direct binary download..."
	GH_ARCH="\$(dpkg --print-architecture 2>/dev/null || uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
	GH_TARBALL="gh_\${GH_VERSION}_linux_\${GH_ARCH}"
	curl -fsSL "https://github.com/cli/cli/releases/download/v\${GH_VERSION}/\${GH_TARBALL}.tar.gz" -o /tmp/gh.tar.gz
	tar -xzf /tmp/gh.tar.gz -C /tmp
	sudo install "/tmp/\${GH_TARBALL}/bin/gh" /usr/local/bin/gh
	rm -rf /tmp/gh.tar.gz "/tmp/\${GH_TARBALL}"
	echo "gh installed: \$(gh --version | head -1)"
fi

# jq and node should be pre-installed on Anthropic cloud env.
for bin in gh jq node; do
	command -v "\$bin" >/dev/null 2>&1 || {
		echo "ERROR: \$bin missing from cloud env and cannot be auto-installed reliably." >&2
		exit 1
	}
done

# Clone cc-skills vendor repo fresh each run. Path into .claude/ directly so
# references like .claude/skills/loop-clean/loop-clean.sh resolve naturally.
rm -rf .claude/.vendor .claude/skills .claude/agents .claude/scripts
git clone --depth 1 --branch "$VENDOR_BRANCH" \\
	"https://x-access-token:\${GH_TOKEN}@github.com/$VENDOR_REPO.git" \\
	.claude/.vendor 2>&1 | tail -3

mv .claude/.vendor/skills .claude/skills
mv .claude/.vendor/agents .claude/agents
mv .claude/.vendor/scripts .claude/scripts
rm -rf .claude/.vendor

# Patch ~/.claude/ refs to .claude/ project-local (cloud has no home dir).
find .claude/skills .claude/agents -type f -name '*.md' -exec sed -i \\
	-e 's|~/\\.claude/skills/|.claude/skills/|g' \\
	-e 's|~/\\.claude/scripts/|.claude/scripts/|g' \\
	-e 's|~/\\.claude/agents/|.claude/agents/|g' \\
	-e 's|\$HOME/\\.claude/skills/|.claude/skills/|g' \\
	-e 's|\$HOME/\\.claude/scripts/|.claude/scripts/|g' \\
	-e 's|\$HOME/\\.claude/agents/|.claude/agents/|g' \\
	{} +

echo "routine-setup: cc-skills cloned + patched"
SETUP
	chmod +x "$ROUTINE_SETUP"
	_ok "wrote $ROUTINE_SETUP"
}

# nightly-clean-run.sh handles git orchestration around the semantic steps.
# Pure T-operation (no LLM decisions). Subcommands: pre, post.
_write_nightly_runner() {
	mkdir -p "$(dirname "$NIGHTLY_RUNNER")"
	cat > "$NIGHTLY_RUNNER" <<'RUNNER'
#!/usr/bin/env bash
# nightly-clean-run.sh — Pre/post git orchestration for nightly-clean Routine.
#
# Subcommands:
#   pre  — skip-check, fetch, create/reset claude/nightly-clean from default.
#          Exits 1 if skip conditions met, >=2 on hard failures.
#   post — commit scoped changes, tag archive (fallback log), force-push with
#          lease, upsert PR.
#
# Env vars:
#   GH_TOKEN                — required (PR metadata, tag push).
#   NIGHTLY_BRANCH          — override branch name (default: claude/nightly-clean).
#   ARCHIVE_RETENTION_DAYS  — GC threshold for archive tags (default: 14).
#   CLAUDE_COMMITTER_EMAIL  — author email (default: claude-nightly@anthropic.com).

set -euo pipefail

readonly BRANCH="${NIGHTLY_BRANCH:-claude/nightly-clean}"
readonly RETENTION_DAYS="${ARCHIVE_RETENTION_DAYS:-14}"
readonly SKIP_LABEL="wip-review"
readonly TODAY="$(date -u +%Y-%m-%d)"
readonly ARCHIVE_TAG="nightly-clean-archive-${TODAY}"

# Parse owner/repo from origin URL (ssh or https). `gh pr *` defaults to
# auto-detection but that fails in sandboxed cloud envs where the git remote
# doesn't resolve against a known GitHub host — pass --repo explicitly.
_repo_slug() {
	local url
	url=$(git config --get remote.origin.url 2>/dev/null || echo "")
	echo "$url" | sed -E 's|^git@github\.com:||; s|^https?://github\.com/||; s|\.git$||'
}
readonly REPO_SLUG="$(_repo_slug)"

_log() { echo "[nightly-clean-run] $*"; }
_warn() { echo "[nightly-clean-run] WARN: $*" >&2; }
_err() { echo "[nightly-clean-run] ERROR: $*" >&2; exit 2; }

_default_branch() {
	local ref out
	ref=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
	if [[ -n "$ref" ]]; then
		out="${ref#refs/remotes/origin/}"
	else
		git remote set-head origin -a >/dev/null 2>&1 || true
		ref=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
		if [[ -n "$ref" ]]; then
			out="${ref#refs/remotes/origin/}"
		else
			out=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF; exit}')
		fi
	fi
	[[ -z "$out" || "$out" == "(unknown)" ]] && return 1
	echo "$out"
}

_current_pr_number() {
	gh pr list --repo "$REPO_SLUG" --head "$BRANCH" --state open --json number \
		--jq '.[0].number // empty' 2>/dev/null || true
}

_has_skip_label() {
	local pr="$1"
	[[ -z "$pr" ]] && return 1
	gh pr view "$pr" --repo "$REPO_SLUG" --json labels --jq ".labels[].name" 2>/dev/null \
		| grep -qxF "$SKIP_LABEL"
}

_has_non_claude_commits() {
	local bot_email="${CLAUDE_COMMITTER_EMAIL:-claude-nightly@anthropic.com}"
	if ! git fetch origin "$BRANCH" 2>/dev/null; then
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

	git fetch origin --prune --prune-tags --tags >/dev/null 2>&1 || {
		_err "git fetch origin failed"
	}

	if ! git rev-parse --verify "origin/$default" >/dev/null 2>&1; then
		_err "origin/$default not found after fetch"
	fi

	# Skip conditions (only relevant if branch already exists remotely).
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

	git checkout -B "$BRANCH" "origin/$default"
	_log "reset $BRANCH to origin/$default"

	# GC old archive tags.
	local cutoff_ts
	if date -u -d "${RETENTION_DAYS} days ago" +%s >/dev/null 2>&1; then
		cutoff_ts=$(date -u -d "${RETENTION_DAYS} days ago" +%s)
	else
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
	command -v gh >/dev/null 2>&1 || _err "gh CLI not installed"
	[[ -z "$REPO_SLUG" ]] && _err "cannot parse owner/repo from origin URL"

	local default
	default=$(_default_branch) || _err "cannot determine default branch in post"

	# Stage all modifications to already-tracked files (src, tests, lib, docs,
	# config, etc.). `-u` only touches tracked paths — safe from accidental
	# adds of stray files produced by the agent.
	git add -u
	# Additionally add expected new/untracked files (backlog.md may be new,
	# nightly-runs.log may be created by the tag-fallback path below).
	for extra in backlog.md .claude/nightly-runs.log; do
		[[ -f "\$extra" ]] && git add "\$extra"
	done

	if git diff --cached --quiet; then
		_log "no changes produced by nightly run — nothing to push"
		local pr
		pr=$(_current_pr_number)
		if [[ -n "\$pr" ]]; then
			gh pr comment "\$pr" --repo "\$REPO_SLUG" --body "Nightly run produced no changes on \$TODAY." \
				>/dev/null 2>&1 || _warn "gh pr comment failed"
		fi
		return 0
	fi

	local author_name author_email
	author_name="${GIT_AUTHOR_NAME:-Claude Nightly}"
	author_email="${GIT_AUTHOR_EMAIL:-${CLAUDE_COMMITTER_EMAIL:-claude-nightly@anthropic.com}}"
	export CLAUDE_COMMITTER_EMAIL="$author_email"

	# Archive fallback log written BEFORE commit to avoid brittle amend.
	local prev_sha="" archive_fallback_written=0
	if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
		prev_sha=$(git rev-parse "origin/$BRANCH" 2>/dev/null || true)
		if [[ -n "$prev_sha" ]]; then
			if ! git tag -a "$ARCHIVE_TAG" "$prev_sha" \
					-m "Archive of $BRANCH before nightly run $TODAY" 2>/dev/null; then
				_log "FALLBACK: tag create failed; writing to .claude/nightly-runs.log"
				mkdir -p .claude
				echo "$TODAY archive_sha=$prev_sha" >> .claude/nightly-runs.log
				git add .claude/nightly-runs.log
				archive_fallback_written=1
			fi
		fi
	fi

	git -c "user.name=$author_name" -c "user.email=$author_email" \
		commit -m "chore(nightly-clean): cleanup run $TODAY" \
		-m "Automated /loop-clean + /backlog-deep-crush sweep."
	_log "committed nightly changes"

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
				_warn "amend failed; continuing without log in commit"
			fi
		fi
	fi

	# --force-with-lease: reject if origin moved since cmd_pre's fetch.
	local lease_ref="refs/heads/$BRANCH"
	if [[ -n "$prev_sha" ]]; then
		if ! git push --force-with-lease="$lease_ref:$prev_sha" origin "$BRANCH"; then
			_err "push rejected: origin/$BRANCH changed since fetch. Aborting to preserve that work."
		fi
	else
		git push origin "$BRANCH"
	fi
	_log "force-pushed $BRANCH (with lease)"

	# Upsert PR.
	local pr
	pr=$(_current_pr_number)
	if [[ -z "\$pr" ]]; then
		if gh pr create --repo "\$REPO_SLUG" --base "\$default" --head "\$BRANCH" \\
				--title "chore(nightly-clean): cleanup run \$TODAY" \\
				--body "Automated nightly cleanup. Review and merge if looks good." \\
				>/dev/null 2>&1; then
			_log "opened new PR"
		else
			_warn "gh pr create failed; checking again"
			pr=\$(_current_pr_number)
			[[ -n "\$pr" ]] && _log "PR #\$pr detected on retry" || _err "gh pr create failed and no PR exists"
		fi
	else
		gh pr edit "\$pr" --repo "\$REPO_SLUG" \\
			--title "chore(nightly-clean): cleanup run \$TODAY" \\
			--body "Automated nightly cleanup. Latest run: \$TODAY." \\
			>/dev/null 2>&1 || _warn "gh pr edit failed for PR #\$pr"
		_log "updated PR #\$pr"
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

# --- Commands ----------------------------------------------------------------

cmd_init() {
	_require_git_repo
	echo "==> Writing helpers"
	_write_routine_setup
	_write_nightly_runner
	echo "==> Updating $GITIGNORE"
	_ensure_gitignore
	echo ""
	echo "✅ Enrollment complete for $(basename "$PWD")"
	echo ""
	echo "Vendor repo: $VENDOR_REPO (branch: $VENDOR_BRANCH)"
	echo "  - Cloned cloud-side at each Routine run by $ROUTINE_SETUP"
	echo "  - To push updates: bash ~/.claude/skills/nightly-clean-enroll/enroll.sh sync-vendor"
	echo ""
	echo "Next steps:"
	echo "  1. Commit and push the 2 helpers + .gitignore"
	echo "  2. Create Routine (via /schedule or UI) with:"
	echo "     - cron: 0 2 * * *"
	echo "     - setup script: contents of $ROUTINE_SETUP"
	echo "     - env var: GH_TOKEN=<token with repo scope>"
}

# Sync ~/.claude/{skills,agents,scripts}/ to cc-skills vendor repo.
# Clones the vendor once into ~/.cache/, rsyncs with exclusions, commits, pushes.
cmd_sync_vendor() {
	if [[ ! -d "$VENDOR_WORK/.git" ]]; then
		echo "==> Cloning $VENDOR_REPO into $VENDOR_WORK"
		mkdir -p "$(dirname "$VENDOR_WORK")"
		git clone "git@github.com:$VENDOR_REPO.git" "$VENDOR_WORK" 2>&1 | tail -2
	else
		echo "==> Pulling latest $VENDOR_BRANCH in $VENDOR_WORK"
		(cd "$VENDOR_WORK" && git checkout "$VENDOR_BRANCH" >/dev/null 2>&1 && git pull --ff-only 2>&1 | tail -2)
	fi

	# Unified exclude list. data/ catches any runtime state dir (e.g.
	# statusline/data/, command-validator/data/); .cache/ catches bun/npm
	# caches; .claude/ catches nested local-state dirs in script monorepos.
	local -a sync_excludes=(
		--exclude='.DS_Store'
		--exclude='.index-state.json'
		--exclude='node_modules/'
		--exclude='__pycache__/'
		--exclude='*.pyc'
		--exclude='*.log'
		--exclude='bun.lockb'
		--exclude='package-lock.json'
		--exclude='data/'
		--exclude='.cache/'
		--exclude='.claude/'
	)

	echo "==> Syncing ~/.claude/ → $VENDOR_WORK"
	rsync -a --delete "${sync_excludes[@]}" "${HOME}/.claude/skills/" "$VENDOR_WORK/skills/"
	rsync -a --delete "${sync_excludes[@]}" "${HOME}/.claude/agents/" "$VENDOR_WORK/agents/"
	rsync -a --delete "${sync_excludes[@]}" "${HOME}/.claude/scripts/" "$VENDOR_WORK/scripts/"

	echo "==> Committing + pushing"
	(
		cd "$VENDOR_WORK"
		git add -A
		if git diff --cached --quiet; then
			echo "  • no changes to sync"
			exit 0
		fi
		local changed
		changed=$(git diff --cached --name-only | wc -l | tr -d ' ')
		git commit -m "chore: sync from ~/.claude/ ($changed files, $(date -u +%Y-%m-%d))" >/dev/null
		git push 2>&1 | tail -2
		echo "  ✓ pushed $changed file(s) to $VENDOR_REPO"
	)
}

cmd_status() {
	echo "Repo: $(basename "$PWD")"
	echo ""
	echo "Vendor mode (helpers only tracked; skills cloned at Routine runtime):"
	[[ -f "$ROUTINE_SETUP" ]] && echo "  ✓ $ROUTINE_SETUP" || echo "  ✗ $ROUTINE_SETUP (missing)"
	[[ -f "$NIGHTLY_RUNNER" ]] && echo "  ✓ $NIGHTLY_RUNNER" || echo "  ✗ $NIGHTLY_RUNNER (missing)"
	echo ""
	if [[ -f "$GITIGNORE" ]] && grep -qF "nightly-clean enrollment" "$GITIGNORE"; then
		echo "  ✓ $GITIGNORE has nightly-clean block"
	else
		echo "  ✗ $GITIGNORE missing nightly-clean block"
	fi
	echo ""
	echo "Vendor repo: $VENDOR_REPO (branch: $VENDOR_BRANCH)"
	if [[ -d "$VENDOR_WORK/.git" ]]; then
		local last_sync
		last_sync=$(cd "$VENDOR_WORK" && git log -1 --format='%ai %s' 2>/dev/null || echo "(empty)")
		echo "  Local clone: $VENDOR_WORK"
		echo "  Last commit: $last_sync"
	else
		echo "  Local clone: (not yet cloned — run 'sync-vendor')"
	fi
}

cmd_uninstall() {
	_require_git_repo
	echo "==> Removing enrollment helpers"
	_remove_if_exists "$ROUTINE_SETUP"
	_ok "removed $ROUTINE_SETUP"
	_remove_if_exists "$NIGHTLY_RUNNER"
	_ok "removed $NIGHTLY_RUNNER"
	echo ""
	echo "Note: .gitignore block kept (harmless). Cloud Routine must be deleted"
	echo "manually at https://claude.ai/code/routines otherwise it will keep firing."
}

usage() {
	cat >&2 <<EOF
Usage:
  enroll.sh init          # Write helpers + update .gitignore (first time for a repo)
  enroll.sh sync-vendor   # Push ~/.claude/{skills,agents,scripts}/ to $VENDOR_REPO
  enroll.sh status        # Show enrollment state
  enroll.sh uninstall     # Remove helpers (keep .gitignore, delete cloud Routine manually)
EOF
	exit 2
}

main() {
	[[ $# -lt 1 ]] && usage
	case "$1" in
		init) cmd_init ;;
		sync-vendor) cmd_sync_vendor ;;
		status) cmd_status ;;
		uninstall) cmd_uninstall ;;
		*) usage ;;
	esac
}

main "$@"
