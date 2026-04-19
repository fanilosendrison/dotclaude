#!/usr/bin/env bash
# install.sh — Crée le symlink vers ~/.claude/ pour que Claude Code trouve le skill.
# Usage : bash install.sh
# Idempotent : safe à relancer.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

ln -sfn "${REPO_DIR}" "${CLAUDE_DIR}/skills/claude-project-onboarder"

echo "Symlink créé :"
echo "  ${CLAUDE_DIR}/skills/claude-project-onboarder → ${REPO_DIR}/"
