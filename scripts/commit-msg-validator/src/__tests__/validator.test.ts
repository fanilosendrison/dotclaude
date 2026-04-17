import { describe, expect, test } from "bun:test";
import {
	extractCommitMessage,
	isGitCommit,
	validateCommitMessage,
} from "../lib/validator";

// --- extractCommitMessage ---

describe("extractCommitMessage", () => {
	test("extracts message from -m double quotes", () => {
		expect(extractCommitMessage('git commit -m "feat: add login"')).toBe(
			"feat: add login",
		);
	});

	test("extracts message from -m single quotes", () => {
		expect(extractCommitMessage("git commit -m 'fix: resolve crash'")).toBe(
			"fix: resolve crash",
		);
	});

	test("extracts subject line from multiline -m (double quotes)", () => {
		const cmd = 'git commit -m "feat(api): add endpoint\n\nBody here"';
		expect(extractCommitMessage(cmd)).toBe("feat(api): add endpoint");
	});

	test("extracts subject from HEREDOC pattern", () => {
		const cmd = `git commit -m "$(cat <<'EOF'
feat(auth): add OAuth2 flow

Implements the full flow.
EOF
)"`;
		expect(extractCommitMessage(cmd)).toBe("feat(auth): add OAuth2 flow");
	});

	test("extracts subject from HEREDOC without quotes around EOF", () => {
		const cmd = `git commit -m "$(cat <<EOF
fix: handle empty input
EOF
)"`;
		expect(extractCommitMessage(cmd)).toBe("fix: handle empty input");
	});

	test("handles -m with extra flags before it", () => {
		expect(extractCommitMessage('git commit -a -m "chore: cleanup"')).toBe(
			"chore: cleanup",
		);
	});

	test("returns null when no -m flag", () => {
		expect(extractCommitMessage("git commit")).toBeNull();
	});

	test("returns null when no message after -m", () => {
		expect(extractCommitMessage("git commit -m")).toBeNull();
	});

	test("handles --amend with -m", () => {
		expect(extractCommitMessage('git commit --amend -m "fix: typo"')).toBe(
			"fix: typo",
		);
	});

	test("trims leading whitespace from HEREDOC lines", () => {
		const cmd = `git commit -m "$(cat <<'EOF'
   docs: update readme
EOF
)"`;
		expect(extractCommitMessage(cmd)).toBe("docs: update readme");
	});
});

// --- isGitCommit ---

describe("isGitCommit", () => {
	test("detects simple git commit", () => {
		expect(isGitCommit('git commit -m "msg"')).toBe(true);
	});

	test("detects git commit in chain", () => {
		expect(isGitCommit('git add . && git commit -m "msg"')).toBe(true);
	});

	test("rejects non-commit git commands", () => {
		expect(isGitCommit("git status")).toBe(false);
		expect(isGitCommit("git push")).toBe(false);
		expect(isGitCommit("git log")).toBe(false);
	});

	test("rejects commands containing 'commit' but not git commit", () => {
		expect(isGitCommit("echo commit")).toBe(false);
	});

	test("detects git commit with flags", () => {
		expect(isGitCommit("git commit --amend")).toBe(true);
	});
});

// --- validateCommitMessage ---

describe("validateCommitMessage", () => {
	describe("valid messages", () => {
		const validMessages = [
			"feat: add login endpoint",
			"fix(auth): resolve token refresh crash",
			"docs: add contributing guidelines",
			"style: run prettier",
			"refactor(api): extract validation logic",
			"perf: optimize query with index",
			"test: add unit tests for auth service",
			"build(deps): bump express from 4.18.2 to 4.19.0",
			"ci: add github actions workflow",
			"chore: remove unused scripts",
			"revert: feat(auth): add OAuth2 provider support",
			"feat(api)!: replace authentication endpoint schema",
		];

		for (const msg of validMessages) {
			test(`accepts: "${msg}"`, () => {
				const result = validateCommitMessage(msg);
				expect(result.valid).toBe(true);
				expect(result.errors).toHaveLength(0);
			});
		}
	});

	describe("invalid type", () => {
		test("rejects unknown type", () => {
			const result = validateCommitMessage("feature: add login");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("Type"))).toBe(true);
		});
	});

	describe("format errors", () => {
		test("rejects missing colon-space separator", () => {
			const result = validateCommitMessage("feat add login");
			expect(result.valid).toBe(false);
		});

		test("rejects capital letter after colon", () => {
			const result = validateCommitMessage("feat: Add login");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("majuscule"))).toBe(true);
		});

		test("rejects trailing period", () => {
			const result = validateCommitMessage("feat: add login.");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("point"))).toBe(true);
		});

		test("rejects subject line over 72 characters", () => {
			const longMsg = `feat: ${"a".repeat(68)}`;
			expect(longMsg.length).toBeGreaterThan(72);
			const result = validateCommitMessage(longMsg);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("72"))).toBe(true);
		});

		test("accepts subject line at exactly 72 characters", () => {
			const msg = `feat: ${"a".repeat(66)}`;
			expect(msg.length).toBe(72);
			const result = validateCommitMessage(msg);
			expect(result.valid).toBe(true);
		});
	});

	describe("imperative mood", () => {
		test("rejects past tense: added", () => {
			const result = validateCommitMessage("feat: added login");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("impératif"))).toBe(true);
		});

		test("rejects past tense: fixed", () => {
			const result = validateCommitMessage("fix: fixed crash");
			expect(result.valid).toBe(false);
		});

		test("rejects gerund: removing", () => {
			const result = validateCommitMessage("chore: removing old files");
			expect(result.valid).toBe(false);
		});

		test("accepts imperative: add, fix, remove", () => {
			expect(validateCommitMessage("feat: add login").valid).toBe(true);
			expect(validateCommitMessage("fix: resolve crash").valid).toBe(true);
			expect(validateCommitMessage("chore: remove old files").valid).toBe(true);
		});
	});

	describe("anti-patterns", () => {
		test("rejects vague messages", () => {
			const result = validateCommitMessage("fix: fix bug");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("vague"))).toBe(true);
		});

		test("rejects generic 'updates'", () => {
			const result = validateCommitMessage("chore: updates");
			expect(result.valid).toBe(false);
		});

		test("rejects generic 'stuff'", () => {
			const result = validateCommitMessage("feat: stuff");
			expect(result.valid).toBe(false);
		});

		test("rejects generic 'changes'", () => {
			const result = validateCommitMessage("chore: changes");
			expect(result.valid).toBe(false);
		});
	});

	describe("edge cases", () => {
		test("rejects empty string", () => {
			const result = validateCommitMessage("");
			expect(result.valid).toBe(false);
		});

		test("rejects whitespace only", () => {
			const result = validateCommitMessage("   ");
			expect(result.valid).toBe(false);
		});

		test("accepts scope with dots", () => {
			const result = validateCommitMessage("fix(api.v2): handle edge case");
			expect(result.valid).toBe(true);
		});

		test("accepts scope with hyphens", () => {
			const result = validateCommitMessage("feat(user-auth): add 2FA support");
			expect(result.valid).toBe(true);
		});

		test("accepts breaking change with bang", () => {
			const result = validateCommitMessage("feat!: drop Node 14 support");
			expect(result.valid).toBe(true);
		});
	});
});
