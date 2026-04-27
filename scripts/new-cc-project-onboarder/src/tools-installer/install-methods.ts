/**
 * Per-tool install methods, tried in order.
 *
 * Each tool lists its known methods from "most likely to work" to "fallback".
 * `tools-installer` iterates methods until one succeeds (or all fail, in which
 * case the orchestrator's fallback agent takes over for genuinely novel cases).
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
	bun: [
		{ id: "bun-sh", run: shellCmd("curl -fsSL https://bun.sh/install | bash") },
		{ id: "webi", run: shellCmd("curl -sS https://webi.sh/bun | sh") },
	],
};
