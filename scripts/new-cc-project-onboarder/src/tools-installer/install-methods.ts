/**
 * Per-tool install methods, tried in order.
 *
 * Each tool lists its known methods from "most likely to work" to "fallback".
 * `tools-installer` iterates methods until one succeeds (or all fail, in which
 * case the orchestrator's fallback agent takes over for genuinely novel cases).
 *
 * NOTE — bun is intentionally absent here. bun is the runtime that runs this
 * orchestrator: if bun is missing, the script never starts in the first place,
 * so an "install bun" branch is dead code. Bun is a hard prerequisite of the
 * orchestrator, not something it can install for you. Distribute to users who
 * already have Claude Code (which itself requires bun) and the prerequisite is
 * met by construction.
 *
 * Constraint reminder (macOS Monterey 12.7.6):
 * - Homebrew is forbidden (unsupported on this macOS version).
 * - `xcode-select --install` is forbidden (GUI installer, not autonomous).
 * - Allowed: pipe-to-shell install scripts, GitHub releases tarballs, etc.
 */

import { type InstallMethod, shellCmd } from "./tools-installer";

export const INSTALL_METHODS: Record<string, InstallMethod[]> = {
	git: [
		{ id: "webi", run: shellCmd("curl -sS https://webi.sh/git | sh") },
	],
	gh: [
		{ id: "webi", run: shellCmd("curl -sS https://webi.sh/gh | sh") },
	],
};
