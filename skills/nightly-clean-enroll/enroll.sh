#!/usr/bin/env bash
# enroll.sh — Enroll the current repo for a nightly-clean GHA workflow.
#
# Writes .github/workflows/nightly-clean.yml (10-line caller to cc-ci).
# Everything else (skills, agents, scripts, prompt, orchestration) lives in
# fanilosendrison/cc-ci and fanilosendrison/dotclaude, cloned at workflow
# runtime. Zero Claude content tracked in the target repo.
#
# Usage:
#   bash enroll.sh init [--cron "M H * * *"] [--ref <branch|sha>]
#   bash enroll.sh status
#   bash enroll.sh uninstall

set -euo pipefail

# --- Configuration ---
readonly CC_CI_REPO="fanilosendrison/cc-ci"
readonly CALLABLE_PATH=".github/workflows/nightly-clean-callable.yml"
readonly CALLER_FILE=".github/workflows/nightly-clean.yml"
readonly GITIGNORE=".gitignore"

DEFAULT_CRON="0 0 * * *"
DEFAULT_REF="main"

# --- Helpers ---
_err()  { echo "ERROR: $*" >&2; exit 1; }
_info() { echo "  - $*"; }
_ok()   { echo "  ✓ $*"; }

_require_git_repo() {
	git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
		|| _err "Not inside a git repository. Run enroll from the target repo root."
}

_repo_slug() {
	local url
	url=$(git config --get remote.origin.url 2>/dev/null || echo "")
	echo "$url" | sed -E 's|^git@github\.com:||; s|^https?://github\.com/||; s|\.git$||'
}

_ensure_gitignore() {
	if [[ ! -f "$GITIGNORE" ]]; then
		touch "$GITIGNORE"
	fi
	if grep -qE '^\.claude/?\s*$' "$GITIGNORE"; then
		_info "$GITIGNORE already ignores .claude/"
		return 0
	fi
	if [[ -s "$GITIGNORE" ]] && [[ -n "$(tail -c 1 "$GITIGNORE")" ]]; then
		printf '\n' >> "$GITIGNORE"
	fi
	cat >> "$GITIGNORE" <<EOF

# ---------- Claude Code local state (nightly-clean uses GHA, clones dotclaude at runtime) ----------
.claude/
EOF
	_ok "added .claude/ to $GITIGNORE"
}

_write_caller() {
	local cron="$1"
	local ref="$2"
	mkdir -p "$(dirname "$CALLER_FILE")"
	cat > "$CALLER_FILE" <<EOF
name: nightly-clean

on:
  schedule:
    - cron: '$cron'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  call:
    uses: $CC_CI_REPO/$CALLABLE_PATH@$ref
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
EOF
	_ok "wrote $CALLER_FILE (cron: $cron, ref: $ref)"
}

# --- Commands ---

cmd_init() {
	_require_git_repo

	local cron="$DEFAULT_CRON"
	local ref="$DEFAULT_REF"
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--cron) cron="$2"; shift 2 ;;
			--ref)  ref="$2";  shift 2 ;;
			*) _err "Unknown flag: $1" ;;
		esac
	done

	local slug
	slug=$(_repo_slug)
	[[ -z "$slug" ]] && _err "Cannot parse owner/repo from origin URL"

	echo "==> Writing $CALLER_FILE"
	_write_caller "$cron" "$ref"

	echo "==> Updating $GITIGNORE"
	_ensure_gitignore

	cat <<EOF

✅ Enrollment complete for $slug

Next steps:
  1. Commit + push:
       git add $CALLER_FILE $GITIGNORE
       git commit -m "chore: enroll nightly-clean via GHA + cc-ci"
       git push

  2. Get an OAuth token (Pro/Max required):
       claude setup-token
     Copy the token that appears.

  3. Set the secret (use printf to avoid trailing newline):
       printf '%s' '<PASTE_TOKEN>' | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo $slug

  4. Enable GHA to create PRs on this repo (default is OFF for user-owned repos;
     the post step WILL FAIL with "GitHub Actions is not permitted to create or
     approve pull requests" without this):
       gh api -X PUT repos/$slug/actions/permissions/workflow \\
         -f default_workflow_permissions=read \\
         -F can_approve_pull_request_reviews=true

  5. Validate with a manual trigger:
       gh workflow run nightly-clean.yml --repo $slug
     Check the Actions tab — expect a PR on claude/nightly-clean after ~15-30 min.

Cron: $cron (UTC). Stagger with --cron "<M> <H> * * *" if you enroll multiple repos.
EOF
}

cmd_status() {
	_require_git_repo
	local slug
	slug=$(_repo_slug)

	echo "Repo: $slug"
	echo ""

	if [[ -f "$CALLER_FILE" ]]; then
		echo "  ✓ $CALLER_FILE present"
		grep -E "uses:|cron:" "$CALLER_FILE" | sed 's/^/    /'
	else
		echo "  ✗ $CALLER_FILE missing (run 'init')"
	fi

	echo ""
	if [[ -n "$slug" ]] && command -v gh >/dev/null 2>&1; then
		if gh secret list --repo "$slug" 2>/dev/null | grep -q "^CLAUDE_CODE_OAUTH_TOKEN"; then
			echo "  ✓ CLAUDE_CODE_OAUTH_TOKEN secret set"
		else
			echo "  ✗ CLAUDE_CODE_OAUTH_TOKEN secret missing"
		fi

		echo ""
		echo "  Recent runs:"
		gh run list --repo "$slug" --workflow nightly-clean.yml --limit 3 \
			--json status,conclusion,createdAt,displayTitle \
			--jq '.[] | "    \(.createdAt) - \(.status)/\(.conclusion // "...") - \(.displayTitle)"' \
			2>/dev/null || echo "    (no runs yet or gh not authenticated)"
	fi
}

cmd_uninstall() {
	_require_git_repo
	if [[ -f "$CALLER_FILE" ]]; then
		rm -f "$CALLER_FILE"
		_ok "removed $CALLER_FILE"
	else
		_info "$CALLER_FILE not present, nothing to remove"
	fi

	local slug
	slug=$(_repo_slug)
	cat <<EOF

Partial uninstall complete. To also delete the secret and close open PRs:
  gh secret delete CLAUDE_CODE_OAUTH_TOKEN --repo $slug
  gh pr list --repo $slug --head claude/nightly-clean --state open --json number --jq '.[].number' | xargs -I{} gh pr close {} --repo $slug
  gh api -X DELETE repos/$slug/git/refs/heads/claude/nightly-clean   # optional — may be blocked by branch protection
EOF
}

usage() {
	cat >&2 <<EOF
Usage:
  enroll.sh init [--cron "M H * * *"] [--ref <branch|sha>]
  enroll.sh status
  enroll.sh uninstall
EOF
	exit 2
}

main() {
	[[ $# -lt 1 ]] && usage
	local cmd="$1"
	shift
	case "$cmd" in
		init)      cmd_init "$@" ;;
		status)    cmd_status "$@" ;;
		uninstall) cmd_uninstall "$@" ;;
		*) usage ;;
	esac
}

main "$@"
