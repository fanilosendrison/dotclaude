#!/usr/bin/env bash
# Manual/nocturnal smoke test with the real Claude agents.
# Run explicitly: LOOP_CLEAN_LIVE=1 bash live-smoke.sh

set -euo pipefail

if [[ "${LOOP_CLEAN_LIVE:-0}" != "1" ]]; then
	echo "ERROR: set LOOP_CLEAN_LIVE=1 to run the billed live-agent smoke test" >&2
	exit 2
fi

if ! command -v claude >/dev/null 2>&1; then
	echo "ERROR: claude CLI is required" >&2
	exit 2
fi

REAL_GIT="${LOOP_CLEAN_LIVE_REAL_GIT:-$(git --exec-path)/git}"
if [[ ! -x "$REAL_GIT" ]]; then
	echo "ERROR: set LOOP_CLEAN_LIVE_REAL_GIT to the real Git executable" >&2
	exit 2
fi

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/loop-clean-live.XXXXXX")
WRAPPER_DIR=$(mktemp -d "${TMPDIR:-/tmp}/loop-clean-live-git.XXXXXX")
trap 'find "$ROOT" -depth -delete 2>/dev/null || true; find "$WRAPPER_DIR" -depth -delete 2>/dev/null || true' EXIT

random_suffix="$(date +%s)-$RANDOM"
function_suffix="$RANDOM"
"$REAL_GIT" -C "$ROOT" init --quiet
"$REAL_GIT" -C "$ROOT" config user.name "Loop Clean Live Test"
"$REAL_GIT" -C "$ROOT" config user.email "loop-clean-live@example.invalid"
printf '.claude/run/\nnode_modules/\n' > "$ROOT/.gitignore"
printf '{"name":"loop-clean-live","type":"module","scripts":{"test":"bun test"}}\n' > "$ROOT/package.json"
"$REAL_GIT" -C "$ROOT" add .gitignore package.json
"$REAL_GIT" -C "$ROOT" commit --quiet -m "fixture baseline"

mkdir -p "$ROOT/src" "$ROOT/test"
cat > "$ROOT/src/live-$random_suffix.ts" <<EOF
export function divideLive${function_suffix}(left: number, right: number): number {
  return left / right;
}

export function duplicatedAlpha${function_suffix}(values: number[]): number[] {
  return values.map((value) => value * 2).filter((value) => value > 3);
}

export function duplicatedBeta${function_suffix}(values: number[]): number[] {
  return values.map((value) => value * 2).filter((value) => value > 3);
}

export function debugLive${function_suffix}(value: any): unknown {
  console.log(value);
  return value;
}
EOF
cat > "$ROOT/test/live.test.ts" <<EOF
import { expect, test } from "bun:test";
import { divideLive${function_suffix} } from "../src/live-$random_suffix.ts";
test("division rejects a zero denominator", () => {
  expect(() => divideLive${function_suffix}(4, 0)).toThrow();
});
EOF
printf 'test_command: "bun test"\n' > "$ROOT/STACK_EVAL.yaml"

INITIAL_HEAD=$("$REAL_GIT" -C "$ROOT" rev-parse HEAD)
INITIAL_INDEX=$("$REAL_GIT" -C "$ROOT" ls-files --stage -z | shasum -a 256 | awk '{print $1}')
GIT_LOG="$WRAPPER_DIR/git.log"
cat > "$WRAPPER_DIR/git" <<EOF
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$GIT_LOG"
args=("\$@")
index=0
command_name=""
while (( index < \${#args[@]} )); do
  case "\${args[\$index]}" in
    -C|-c|--git-dir|--work-tree) index=\$((index + 2)) ;;
    --*) index=\$((index + 1)) ;;
    *) command_name="\${args[\$index]}"; break ;;
  esac
done
case "\$command_name" in
  rev-parse|status|diff|ls-files|show|cat-file|check-ignore)
    exec "$REAL_GIT" "\$@"
    ;;
  *)
    echo "BLOCKED_MUTATING_GIT_COMMAND \$command_name" >&2
    exit 97
    ;;
esac
EOF
chmod +x "$WRAPPER_DIR/git"

(
	cd "$ROOT"
	PATH="$WRAPPER_DIR:$PATH" claude --print --permission-mode acceptEdits "/loop-clean"
) | tee "$ROOT/live-output.txt"

FINAL_HEAD=$("$REAL_GIT" -C "$ROOT" rev-parse HEAD)
FINAL_INDEX=$("$REAL_GIT" -C "$ROOT" ls-files --stage -z | shasum -a 256 | awk '{print $1}')
[[ "$FINAL_HEAD" == "$INITIAL_HEAD" ]] || { echo "FAIL: HEAD changed" >&2; exit 1; }
[[ "$FINAL_INDEX" == "$INITIAL_INDEX" ]] || { echo "FAIL: index changed" >&2; exit 1; }
if grep -Eq '(^| )((add|commit|push|reset|restore|checkout|switch|stash|clean|merge|rebase|cherry-pick))( |$)' "$GIT_LOG"; then
	echo "FAIL: mutating Git command observed" >&2
	exit 1
fi

RUN_DIR=$(find "$ROOT/.claude/run/loop-clean" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
[[ -n "$RUN_DIR" ]] || { echo "FAIL: no loop-clean run directory" >&2; exit 1; }
find "$RUN_DIR" -name runtime-gate.json -print -quit | grep -q . || { echo "FAIL: runtime gate missing" >&2; exit 1; }
find "$RUN_DIR" -name findings.json -print -quit | grep -q . || { echo "FAIL: canonical findings missing" >&2; exit 1; }
if find "$RUN_DIR" -iname '*spec-drift*' -print -quit | grep -q .; then
	echo "FAIL: removed artifact was produced" >&2
	exit 1
fi

if ! (cd "$ROOT" && bun test >/dev/null 2>&1); then
	FINAL_ACTION=$(find "$RUN_DIR" -name decision.json -print0 | xargs -0 jq -r '.action' | tail -1)
	[[ "$FINAL_ACTION" != "EXIT_CLEAN" ]] || {
		echo "FAIL: broken test remained under a CLEAN result" >&2
		exit 1
	}
fi

if [[ -f "$ROOT/backlog.md" ]]; then
	grep -q '^# Backlog$' "$ROOT/backlog.md" || { echo "FAIL: invalid backlog header" >&2; exit 1; }
	grep -Eq 'finding_id: [^) ]+' "$ROOT/backlog.md" || { echo "FAIL: backlog ID missing" >&2; exit 1; }
fi

echo "LIVE_SMOKE_PASS root=$ROOT run_dir=$RUN_DIR"
