import type { ValidationResult } from "./types";

const VALID_TYPES = [
	"feat",
	"fix",
	"docs",
	"style",
	"refactor",
	"perf",
	"test",
	"build",
	"ci",
	"chore",
	"revert",
] as const;

// type(scope)!: description
const COMMIT_MSG_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s(.+)$/;

const PAST_TENSE_PATTERN =
	/^(added|fixed|removed|updated|changed|deleted|created|modified|moved|renamed|resolved|refactored|implemented|improved)\b/i;

const GERUND_PATTERN =
	/^(adding|fixing|removing|updating|changing|deleting|creating|modifying|moving|renaming|resolving|refactoring|implementing|improving)\b/i;

const VAGUE_DESCRIPTIONS = [
	"fix bug",
	"fix bugs",
	"bug fix",
	"bugfix",
	"updates",
	"update",
	"stuff",
	"things",
	"changes",
	"change",
	"wip",
	"temp",
	"misc",
	"minor",
];

/**
 * Checks if a bash command contains a git commit.
 */
export function isGitCommit(command: string): boolean {
	return /\bgit\s+commit\b/.test(command);
}

/**
 * Extracts the subject line (first -m value) from a git commit command.
 * Handles: -m "msg", -m 'msg', HEREDOC pattern.
 */
export function extractCommitMessage(command: string): string | null {
	// HEREDOC pattern: <<'EOF' or <<EOF
	const heredocMatch = command.match(/<<'?EOF'?\s*\n([\s\S]*?)\n\s*EOF/);
	if (heredocMatch) {
		const lines = heredocMatch[1]
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
		return lines[0] || null;
	}

	// -m "message" (possibly multiline)
	const doubleQuoteMatch = command.match(/-m\s+"([\s\S]*?)"/);
	if (doubleQuoteMatch) {
		return doubleQuoteMatch[1].split("\n")[0].trim() || null;
	}

	// -m 'message'
	const singleQuoteMatch = command.match(/-m\s+'([\s\S]*?)'/);
	if (singleQuoteMatch) {
		return singleQuoteMatch[1].split("\n")[0].trim() || null;
	}

	return null;
}

/**
 * Validates a commit message subject line against Conventional Commits rules.
 */
export function validateCommitMessage(message: string): ValidationResult {
	const trimmed = message.trim();
	if (!trimmed) {
		return { valid: false, errors: ["Message de commit vide"] };
	}

	const errors: string[] = [];

	const match = trimmed.match(COMMIT_MSG_REGEX);
	if (!match) {
		return {
			valid: false,
			errors: ["Format invalide. Attendu: <type>(<scope>): <description>"],
		};
	}

	const [, type, , , description] = match;

	// Validate type
	if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
		errors.push(
			`Type "${type}" invalide. Types autorisés: ${VALID_TYPES.join(", ")}`,
		);
	}

	// No capital letter after colon
	if (/^[A-Z]/.test(description)) {
		errors.push(
			"La description ne doit pas commencer par une majuscule après le deux-points",
		);
	}

	// No trailing period
	if (description.endsWith(".")) {
		errors.push("La description ne doit pas se terminer par un point");
	}

	// Subject line max 72 chars
	if (trimmed.length > 72) {
		errors.push(`Subject line trop long: ${trimmed.length}/72 caractères max`);
	}

	// Imperative mood (reject past tense and gerund)
	if (PAST_TENSE_PATTERN.test(description)) {
		errors.push(
			"Utiliser l'impératif présent (add, fix, remove) — pas le passé (added, fixed, removed)",
		);
	}

	if (GERUND_PATTERN.test(description)) {
		errors.push(
			"Utiliser l'impératif présent (add, fix, remove) — pas le gérondif (adding, fixing, removing)",
		);
	}

	// Reject vague descriptions
	if (VAGUE_DESCRIPTIONS.includes(description.toLowerCase())) {
		errors.push(
			`Description trop vague: "${description}". Être spécifique sur ce qui a changé`,
		);
	}

	return { valid: errors.length === 0, errors };
}
