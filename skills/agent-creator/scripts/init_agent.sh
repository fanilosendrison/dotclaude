#!/usr/bin/env bash
# init_agent.sh — scaffold un nouvel agent Claude Code depuis le template.
#
# Usage:
#   init_agent.sh <name> --scope user|project
#
# Exemples:
#   init_agent.sh my-reviewer --scope user       # → ~/.claude/agents/my-reviewer.md
#   init_agent.sh my-fixer --scope project       # → ./.claude/agents/my-fixer.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../assets/template-agent.md"

usage() {
  cat <<EOF
Usage: init_agent.sh <name> --scope user|project

Arguments:
  <name>            kebab-case (a-z, 0-9, -), max 64 chars. Doit être unique.
  --scope user      écrit dans ~/.claude/agents/<name>.md
  --scope project   écrit dans ./.claude/agents/<name>.md (cwd)

Le fichier de sortie contient le template prêt à éditer (frontmatter + squelette
de prompt). Remplir les TODO, ajuster tools/model/effort selon la mission.
EOF
  exit 1
}

[[ $# -eq 3 ]] || usage
[[ "$2" == "--scope" ]] || usage

NAME="$1"
SCOPE="$3"

# Validation nom : kebab-case, max 64 chars
if ! [[ "$NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "❌ Nom invalide : '$NAME'. Exige kebab-case (a-z, 0-9, -)." >&2
  exit 1
fi
if [[ ${#NAME} -gt 64 ]]; then
  echo "❌ Nom trop long (${#NAME} > 64 chars)." >&2
  exit 1
fi

# Résolution du dossier de sortie
case "$SCOPE" in
  user)    OUT_DIR="$HOME/.claude/agents" ;;
  project) OUT_DIR="$PWD/.claude/agents" ;;
  *)       echo "❌ --scope doit être 'user' ou 'project' (reçu: '$SCOPE')." >&2; exit 1 ;;
esac

OUT_FILE="$OUT_DIR/$NAME.md"

if [[ -e "$OUT_FILE" ]]; then
  echo "❌ Agent déjà existant : $OUT_FILE" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE" ]]; then
  echo "❌ Template introuvable : $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
sed "s/{{name}}/$NAME/g" "$TEMPLATE" > "$OUT_FILE"

echo "✅ Agent créé : $OUT_FILE"
echo ""
echo "Prochaines étapes :"
echo "  1. Éditer $OUT_FILE : remplir les TODO (description, mission, méthode, format)."
echo "  2. Ajuster frontmatter : tools (allowlist), model + effort (si déterminisme requis), color."
echo "  3. Tester via Agent({ subagent_type: \"$NAME\", prompt: \"...\" })."
