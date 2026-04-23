#!/bin/bash
# workflow-orchestrator.sh — Dispatch d'un step de workflow vers Claude Code
#
# Contrat :
#   - Lit un workflow.yaml qui liste des steps (chacun = fichier .md avec frontmatter YAML)
#   - Sélectionne le step cible par son `name:` (frontmatter), pas par nom de fichier
#   - Émet l'intégralité du .md sur stdout — Claude lit la sortie et exécute le step
#   - Passe les flags (--force / --dry-run / --light) dans l'en-tête pour que le step les voie
#
# Usage :
#   workflow-orchestrator.sh <workflow.yaml> --only <step-name> [--force] [--dry-run] [--light]
#   workflow-orchestrator.sh <workflow.yaml> --list
#   workflow-orchestrator.sh <workflow.yaml> --validate
#   workflow-orchestrator.sh --help
#
# Exit codes :
#   0  OK
#   1  workflow.yaml manquant / illisible / vide
#   2  --only absent, inconnu ou step introuvable dans le workflow
#   3  fichier de step manquant ou sans frontmatter `name:`
#   4  erreur d'usage (flag inconnu, args mutually exclusives)

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Usage:
  $SCRIPT_NAME <workflow.yaml> --only <step-name> [--force] [--dry-run] [--light]
  $SCRIPT_NAME <workflow.yaml> --list
  $SCRIPT_NAME <workflow.yaml> --validate
  $SCRIPT_NAME --help

Dispatch d'un step : émet son markdown sur stdout pour que Claude l'exécute.

Modes (mutuellement exclusifs) :
  --only <name>   Émet le step dont le frontmatter 'name:' vaut <name>
  --list          Liste les steps découverts (tab-separated: name\tfile) et sort
  --validate      Valide le workflow.yaml + tous les steps, sort 0 si OK

Flags passthrough (affichés dans l'en-tête du dispatch) :
  --force         Re-générer les artefacts existants
  --dry-run       Diagnostic seulement, pas d'écriture
  --light         Sauter les steps optionnels

Exit codes :
  0 OK  1 workflow error  2 step not found  3 step file error  4 usage error
EOF
}

err() { printf '%s: error: %s\n' "$SCRIPT_NAME" "$*" >&2; }

# ----- Parse args -----
workflow_file=""
only_step=""
list_mode=false
validate_mode=false
flag_force=false
flag_dry_run=false
flag_light=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --only)
      [[ $# -ge 2 ]] || { err "--only requires a step name"; usage >&2; exit 4; }
      only_step="$2"
      shift 2
      ;;
    --list)
      list_mode=true
      shift
      ;;
    --validate)
      validate_mode=true
      shift
      ;;
    --force)
      flag_force=true
      shift
      ;;
    --dry-run)
      flag_dry_run=true
      shift
      ;;
    --light)
      flag_light=true
      shift
      ;;
    --*)
      err "unknown flag: $1"
      usage >&2
      exit 4
      ;;
    *)
      if [[ -z "$workflow_file" ]]; then
        workflow_file="$1"
        shift
      else
        err "unexpected positional arg: $1"
        usage >&2
        exit 4
      fi
      ;;
  esac
done

# ----- Validate args -----
if [[ -z "$workflow_file" ]]; then
  err "workflow.yaml path is required"
  usage >&2
  exit 4
fi

modes=0
[[ -n "$only_step" ]] && modes=$((modes + 1))
$list_mode && modes=$((modes + 1))
$validate_mode && modes=$((modes + 1))

if [[ $modes -eq 0 ]]; then
  err "one of --only <name>, --list, or --validate is required"
  usage >&2
  exit 4
fi
if [[ $modes -gt 1 ]]; then
  err "--only, --list, and --validate are mutually exclusive"
  exit 4
fi

# ----- Load workflow.yaml -----
if [[ ! -f "$workflow_file" ]]; then
  err "workflow file not found: $workflow_file"
  exit 1
fi
if [[ ! -r "$workflow_file" ]]; then
  err "workflow file not readable: $workflow_file"
  exit 1
fi

workflow_dir="$(cd "$(dirname "$workflow_file")" && pwd)"
workflow_abs="$workflow_dir/$(basename "$workflow_file")"

# Extract top-level `name:` (optional — used only in header/diagnostics)
workflow_name="$(
  awk '
    /^name:[[:space:]]*/ {
      sub(/^name:[[:space:]]*/, "")
      gsub(/["\047]/, "")
      sub(/[[:space:]]+$/, "")
      print
      exit
    }
  ' "$workflow_abs"
)"
workflow_name="${workflow_name:-<unnamed>}"

# Extract relative step file paths from the `steps:` list.
# Expected YAML shape:
#   steps:
#     - file: steps/01-foo.md
#     - file: steps/02-bar.md
#   <next top-level key>:
step_files_raw="$(
  awk '
    BEGIN { in_steps = 0 }
    /^steps:[[:space:]]*$/ { in_steps = 1; next }
    in_steps {
      # A non-indented line that starts with a graph char (not "-") ends the block.
      if ($0 ~ /^[^[:space:]-]/) { in_steps = 0; next }
      if ($0 ~ /^[[:space:]]*-[[:space:]]+file:[[:space:]]*/) {
        sub(/^[[:space:]]*-[[:space:]]+file:[[:space:]]*/, "")
        sub(/[[:space:]]+$/, "")
        gsub(/["\047]/, "")
        if (length($0) > 0) print
      }
    }
  ' "$workflow_abs"
)"

if [[ -z "$step_files_raw" ]]; then
  err "no steps found in $workflow_file (expected a top-level 'steps:' list with '- file: ...' entries)"
  exit 1
fi

# ----- Extract each step's frontmatter `name:` -----
read_step_name() {
  local path="$1"
  awk '
    BEGIN { in_fm = 0; seen_open = 0 }
    NR == 1 && /^---[[:space:]]*$/ { in_fm = 1; seen_open = 1; next }
    in_fm && /^---[[:space:]]*$/ { exit }
    in_fm && /^name:[[:space:]]*/ {
      sub(/^name:[[:space:]]*/, "")
      gsub(/["\047]/, "")
      sub(/[[:space:]]+$/, "")
      print
      exit
    }
    END { if (!seen_open) exit 0 }
  ' "$path"
}

names=()
files=()

while IFS= read -r relpath; do
  [[ -z "$relpath" ]] && continue
  abspath="$workflow_dir/$relpath"
  if [[ ! -f "$abspath" ]]; then
    err "step file referenced by workflow is missing: $relpath"
    exit 3
  fi
  if [[ ! -r "$abspath" ]]; then
    err "step file not readable: $relpath"
    exit 3
  fi
  step_name="$(read_step_name "$abspath")"
  if [[ -z "$step_name" ]]; then
    err "step file has no frontmatter 'name:' field: $relpath"
    exit 3
  fi
  names+=("$step_name")
  files+=("$abspath")
done <<< "$step_files_raw"

# ----- --list -----
if $list_mode; then
  for i in "${!names[@]}"; do
    rel="${files[$i]#"$workflow_dir"/}"
    printf '%s\t%s\n' "${names[$i]}" "$rel"
  done
  exit 0
fi

# ----- --validate -----
if $validate_mode; then
  printf 'workflow: %s\n' "$workflow_name"
  printf 'file:     %s\n' "$workflow_abs"
  printf 'steps:    %d\n' "${#names[@]}"
  for i in "${!names[@]}"; do
    rel="${files[$i]#"$workflow_dir"/}"
    printf '  [%02d] %-32s %s\n' "$((i + 1))" "${names[$i]}" "$rel"
  done
  # Detect duplicate step names (would make --only ambiguous)
  dup="$(printf '%s\n' "${names[@]}" | sort | uniq -d)"
  if [[ -n "$dup" ]]; then
    printf 'status:   FAIL — duplicate step names:\n' >&2
    printf '  %s\n' "$dup" >&2
    exit 1
  fi
  printf 'status:   OK\n'
  exit 0
fi

# ----- --only -----
target_idx=-1
for i in "${!names[@]}"; do
  if [[ "${names[$i]}" == "$only_step" ]]; then
    target_idx=$i
    break
  fi
done

if [[ $target_idx -lt 0 ]]; then
  err "step '$only_step' not found in workflow '$workflow_name'"
  printf 'Available steps:\n' >&2
  for i in "${!names[@]}"; do
    printf '  %s\n' "${names[$i]}" >&2
  done
  exit 2
fi

target_file="${files[$target_idx]}"
target_name="${names[$target_idx]}"
target_rel="${target_file#"$workflow_dir"/}"

# ----- Build active flags list -----
active_flags=()
$flag_force && active_flags+=("--force")
$flag_dry_run && active_flags+=("--dry-run")
$flag_light && active_flags+=("--light")
if [[ ${#active_flags[@]} -eq 0 ]]; then
  flags_str="<none>"
else
  flags_str="${active_flags[*]}"
fi

# ----- Emit header + step markdown -----
cat <<EOF
<!-- workflow-orchestrator dispatch -->
# Step Dispatch

| Field    | Value |
|----------|-------|
| workflow | $workflow_name |
| step     | $target_name |
| file     | $target_rel |
| flags    | $flags_str |

Execute the instructions below. Honor the flags above (they are the effective
runtime flags — ignore any default flag hints inside the step body).

---

EOF

cat "$target_file"

exit 0
