#!/bin/bash
# git-preflight.sh — Checks and initializes git repo + GitHub remote
# Idempotent: safe to run multiple times, skips steps already done

set -euo pipefail

PROJECT_DIR="${1:-.}"
cd "$PROJECT_DIR"
PROJECT_NAME=$(basename "$PWD")

# Templates directory
TEMPLATES_DIR="$(dirname "$0")/templates"

# Patterns de fichiers sensibles ou générés à ne jamais commit
SENSITIVE_PATTERNS=(
  ".env"
  ".env.*"
  "*.key"
  "*.pem"
  "*.p12"
  "*.pfx"
  "credentials.json"
  "service-account*.json"
  "*secret*"
  ".secret*"
  "*.secrets"
  "id_rsa"
  "id_ed25519"
  ".npmrc"
  ".pypirc"
  "STACK_EVAL.yaml"
  "PROJECT_INDEX.md"
  "SPEC_MANIFEST.md"
  ".index-state.json"
)

STATUS="ok"
ACTIONS=()

# --- Step 1: gh auth ---
if ! gh auth status &>/dev/null; then
  echo "FAIL: gh auth — GitHub CLI not authenticated"
  echo "ACTION: run 'gh auth login' first"
  exit 1
fi
echo "OK: gh auth"

# --- Step 2: git init ---
if [ -d ".git" ]; then
  echo "OK: git init (already initialized)"
else
  echo "NEED: git init"
  ACTIONS+=("git-init")
fi

# --- Step 3: branch main ---
if [ -d ".git" ]; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [ "$BRANCH" = "main" ]; then
    echo "OK: branch is main"
  else
    echo "NEED: rename branch to main (current: ${BRANCH:-none})"
    ACTIONS+=("branch-main")
  fi
else
  ACTIONS+=("branch-main")
fi

# --- Step 4: .gitignore ---
if [ -f ".gitignore" ]; then
  echo "OK: .gitignore exists"
  # Check completeness: verify key categories are covered
  GITIGNORE_GAPS=()
  grep -q "node_modules" .gitignore 2>/dev/null || GITIGNORE_GAPS+=("dependencies (node_modules/)")
  grep -q "\.DS_Store" .gitignore 2>/dev/null || GITIGNORE_GAPS+=("OS files (.DS_Store)")
  grep -q "\.idea\|\.vscode" .gitignore 2>/dev/null || GITIGNORE_GAPS+=("IDE files (.idea/, .vscode/)")
  grep -q "coverage" .gitignore 2>/dev/null || GITIGNORE_GAPS+=("coverage/")
  grep -q "\.log\|logs/" .gitignore 2>/dev/null || GITIGNORE_GAPS+=("logs (*.log, logs/)")
  if [ ${#GITIGNORE_GAPS[@]} -gt 0 ]; then
    echo "WARN: .gitignore may be incomplete, missing:"
    for gap in "${GITIGNORE_GAPS[@]}"; do
      echo "  - $gap"
    done
    ACTIONS+=("gitignore-enrich")
  fi
else
  echo "NEED: create .gitignore (template: $TEMPLATES_DIR/.gitignore-base)"
  ACTIONS+=("gitignore-create")
fi

# --- Step 5: .gitattributes ---
if [ -f ".gitattributes" ]; then
  echo "OK: .gitattributes exists"
else
  echo "NEED: create .gitattributes (template: $TEMPLATES_DIR/.gitattributes)"
  ACTIONS+=("gitattributes-create")
fi

# --- Step 6: scan sensitive files ---
SENSITIVE_FOUND=()
for pattern in "${SENSITIVE_PATTERNS[@]}"; do
  # Find matching files (not in node_modules, .git, etc.)
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    # Check if already in .gitignore
    if [ -f ".gitignore" ] && grep -qF "$(basename "$file")" .gitignore 2>/dev/null; then
      continue
    fi
    if [ -f ".gitignore" ] && grep -qF "$pattern" .gitignore 2>/dev/null; then
      continue
    fi
    SENSITIVE_FOUND+=("$file")
  done < <(find . -maxdepth 3 -name "$pattern" \
    -not -path "./.git/*" \
    -not -path "./node_modules/*" \
    -not -path "./.next/*" \
    -not -path "./dist/*" \
    -not -path "./build/*" \
    2>/dev/null)
done

if [ ${#SENSITIVE_FOUND[@]} -gt 0 ]; then
  echo "NEED: add to .gitignore:"
  for f in "${SENSITIVE_FOUND[@]}"; do
    echo "  - $f"
  done
  ACTIONS+=("gitignore-secrets")
else
  echo "OK: no unprotected sensitive files"
fi

# --- Step 7: initial commit ---
if [ -d ".git" ] && git log --oneline -1 &>/dev/null; then
  echo "OK: initial commit exists"
else
  echo "NEED: initial commit"
  ACTIONS+=("initial-commit")
fi

# --- Step 8: GitHub remote ---
if [ -d ".git" ] && git remote get-url origin &>/dev/null; then
  echo "OK: GitHub remote exists"
else
  echo "NEED: create GitHub repo ($PROJECT_NAME --private)"
  ACTIONS+=("gh-create")
fi

# --- Step 9: dev branch ---
if [ -d ".git" ] && git branch --list dev | grep -q dev 2>/dev/null; then
  echo "OK: dev branch exists"
  # Check if we're on dev
  CURRENT=$(git branch --show-current 2>/dev/null || echo "")
  if [ "$CURRENT" != "dev" ]; then
    echo "NEED: switch to dev branch (current: $CURRENT)"
    ACTIONS+=("switch-dev")
  else
    echo "OK: on dev branch"
  fi
else
  echo "NEED: create and switch to dev branch"
  ACTIONS+=("create-dev")
fi

# --- Step 10: branch protection on main ---
if [ -d ".git" ] && git remote get-url origin &>/dev/null; then
  REPO_FULL=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
  if [ -n "$REPO_FULL" ]; then
    # Check if branch protection exists on main
    PROTECTION=$(gh api "repos/$REPO_FULL/branches/main/protection" 2>/dev/null || echo "")
    if [ -n "$PROTECTION" ] && [ "$PROTECTION" != "" ]; then
      echo "OK: branch protection on main"
    else
      echo "NEED: set branch protection on main (block force-push + delete)"
      ACTIONS+=("branch-protection")
    fi
  fi
fi

# --- Step 11: gitleaks pre-commit hook ---
if [ -d ".git" ]; then
  if [ -f ".git/hooks/pre-commit" ] && grep -q "gitleaks" .git/hooks/pre-commit 2>/dev/null; then
    echo "OK: gitleaks pre-commit hook"
  else
    if command -v gitleaks &>/dev/null; then
      echo "NEED: install gitleaks pre-commit hook (gitleaks binary found)"
      ACTIONS+=("gitleaks-hook")
    else
      echo "NEED: install gitleaks + pre-commit hook"
      ACTIONS+=("gitleaks-install")
    fi
  fi
fi

# --- Step 12: git-cliff / cliff.toml ---
if [ -f "cliff.toml" ]; then
  echo "OK: cliff.toml exists (changelog autogeneration)"
else
  if command -v git-cliff &>/dev/null; then
    echo "NEED: generate cliff.toml (git-cliff binary found)"
    ACTIONS+=("cliff-init")
  else
    echo "NEED: install git-cliff + generate cliff.toml"
    ACTIONS+=("cliff-install")
  fi
fi

# --- Step 13: README.md ---
if [ -f "README.md" ]; then
  echo "OK: README.md exists"
else
  echo "NEED: create README.md (minimum: project name)"
  ACTIONS+=("readme-create")
fi

# --- Step 14: .gitmessage (commit template) ---
if [ -f ".gitmessage" ]; then
  echo "OK: .gitmessage exists"
  # Check if configured as commit template
  if [ -d ".git" ] && git config --local commit.template &>/dev/null; then
    echo "OK: commit template configured"
  else
    echo "NEED: configure .gitmessage as commit template"
    ACTIONS+=("gitmessage-config")
  fi
else
  echo "INFO: .gitmessage not found (optional — see git-commits-push skill)"
  ACTIONS+=("gitmessage-create")
fi

# --- Summary ---
echo ""
if [ ${#ACTIONS[@]} -eq 0 ]; then
  echo "STATUS: ALL GOOD — repo fully initialized"
else
  echo "STATUS: NEEDS SETUP — actions required:"
  for action in "${ACTIONS[@]}"; do
    echo "  - $action"
  done
fi
