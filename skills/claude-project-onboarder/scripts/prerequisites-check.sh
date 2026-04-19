#!/usr/bin/env bash
# prerequisites-check.sh — Vérifie OS, flags et outils requis pour le workflow onboarder
# Usage: bash prerequisites-check.sh [--force] [--dry-run] [--light]
# Output: JSON sur stdout, exit 0 si OK, exit 1 si outil manquant

set -euo pipefail

# --- Parse flags ---
flag_force=false
flag_dry_run=false
flag_light=false

for arg in "$@"; do
  case "$arg" in
    --force)   flag_force=true ;;
    --dry-run) flag_dry_run=true ;;
    --light)   flag_light=true ;;
  esac
done

# --- Detect OS ---
raw_os="$(uname -s)"
raw_arch="$(uname -m)"

case "$raw_os" in
  Darwin)       platform="darwin";  os_label="macOS" ;;
  Linux)        platform="linux";   os_label="Linux" ;;
  MINGW*|MSYS*) platform="windows"; os_label="Windows" ;;
  *)            platform="unknown"; os_label="$raw_os" ;;
esac

case "$raw_arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64)        arch="x86_64" ;;
  *)             arch="$raw_arch" ;;
esac

# --- Check tools ---
missing=()
tools_json=""

check_tool() {
  local name="$1"
  local version_cmd="$2"
  local install_darwin="$3"
  local install_linux="$4"

  if command -v "$name" &>/dev/null; then
    local version
    version="$($version_cmd 2>&1 | head -1)"
    tools_json="${tools_json}\"${name}\": {\"found\": true, \"version\": \"${version}\"},"
  else
    tools_json="${tools_json}\"${name}\": {\"found\": false, \"version\": null},"

    local install_hint
    case "$platform" in
      darwin)  install_hint="$install_darwin" ;;
      linux)   install_hint="$install_linux" ;;
      *)       install_hint="Install $name manually" ;;
    esac

    missing+=("{\"name\": \"${name}\", \"install\": \"${install_hint}\"}")
  fi
}

check_tool "git" "git --version" \
  "xcode-select --install" \
  "sudo apt install git"

check_tool "gh" "gh --version" \
  "curl -sS https://webi.sh/gh | sh" \
  "curl -sS https://webi.sh/gh | sh"

check_tool "bun" "bun --version" \
  "curl -fsSL https://bun.sh/install | bash" \
  "curl -fsSL https://bun.sh/install | bash"

# Remove trailing comma from tools_json
tools_json="${tools_json%,}"

# --- Build missing array ---
missing_json="[]"
if [ ${#missing[@]} -gt 0 ]; then
  missing_json="[$(IFS=,; echo "${missing[*]}")]"
fi

# --- Check skill dependencies ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_YAML="${SCRIPT_DIR}/../workflow.yaml"
SKILLS_DIR="$HOME/.claude/skills"

if command -v yq &>/dev/null && [ -f "$WORKFLOW_YAML" ]; then
  skill_count=$(yq -r '.dependencies.skills | length // 0' "$WORKFLOW_YAML" 2>/dev/null || echo 0)
  for (( i=0; i<skill_count; i++ )); do
    skill_name=$(yq -r ".dependencies.skills[$i]" "$WORKFLOW_YAML")
    if [ ! -f "${SKILLS_DIR}/${skill_name}/SKILL.md" ]; then
      tools_json="${tools_json},\"skill:${skill_name}\": {\"found\": false, \"version\": null}"
      missing+=("{\"name\": \"skill:${skill_name}\", \"install\": \"Install skill: ~/.claude/skills/${skill_name}/\"}")
    else
      tools_json="${tools_json},\"skill:${skill_name}\": {\"found\": true, \"version\": \"installed\"}"
    fi
  done
fi

# --- Detect skill project ---
is_skill=false
if [ -f "$PWD/SKILL.md" ]; then
  is_skill=true
fi

# --- Determine status ---
status="ok"
if [ ${#missing[@]} -gt 0 ]; then
  status="missing_tools"
fi

# --- Output JSON ---
cat <<EOF
{
  "status": "${status}",
  "os": {
    "platform": "${platform}",
    "arch": "${arch}",
    "label": "${os_label} ${arch}"
  },
  "is_skill": ${is_skill},
  "flags": {
    "force": ${flag_force},
    "dryRun": ${flag_dry_run},
    "light": ${flag_light}
  },
  "tools": {${tools_json}},
  "missing": ${missing_json}
}
EOF

# --- Exit code ---
if [ "$status" != "ok" ]; then
  exit 1
fi
