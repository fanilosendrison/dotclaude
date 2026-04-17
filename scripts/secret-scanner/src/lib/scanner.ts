import type { Finding, ScanResult } from "./types";

interface SecretPattern {
	name: string;
	pattern: RegExp;
	/** Optional post-check: return true if the match is a real secret (not false positive) */
	confirm?: (content: string) => boolean;
}

const PASSWORD_PLACEHOLDERS = [
	"changeme",
	"password",
	"placeholder",
	"example",
	"xxx",
	"xxxxxxxx",
	"todo",
	"fixme",
];

/**
 * Extracts the assigned value from a `key = "value"` or `key = value` line.
 * Strips surrounding quotes.
 */
function extractAssignedValue(content: string): string {
	const match = content.match(/[:=]\s*['"]?(.*?)['"]?\s*$/);
	if (!match) return "";
	return match[1].replace(/^['"]|['"]$/g, "");
}

const SECRET_PATTERNS: SecretPattern[] = [
	// AWS
	{ name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/ },
	{
		name: "AWS Secret Key",
		pattern: /(?:aws_secret_access_key|aws_secret_key)\s*=\s*\S{20,}/i,
	},

	// Private keys
	{
		name: "Private Key",
		pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
	},

	// GitHub
	{ name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },

	// Slack
	{
		name: "Slack Token",
		pattern: /xox[baprs]-[0-9]{10,}-[a-zA-Z0-9-]+/,
	},

	// Connection strings with credentials
	{
		name: "Connection String",
		pattern:
			/(?:mongodb|postgres|postgresql|mysql|redis):\/\/[^\s:]+:[^\s@]+@[^\s]+/,
	},

	// Generic API key (assignment with long value)
	{
		name: "Generic API Key",
		pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?\S{20,}/i,
	},

	// Generic token (assignment with long value)
	{
		name: "Generic Token",
		pattern: /(?:auth_token|access_token|refresh_token)\s*[:=]\s*['"]?\S{20,}/i,
	},

	// .env-style KEY=value for known secret variable names
	{
		name: "Env Secret",
		pattern:
			/(?:SECRET_KEY|PRIVATE_KEY|STRIPE_API_KEY|STRIPE_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|SENDGRID_API_KEY)\s*=\s*\S{16,}/,
	},

	// Password assignment — post-check filters out empty values and placeholders
	{
		name: "Password / Secret",
		pattern:
			/(?:password|passwd|pwd|DB_PASSWORD|MYSQL_PASSWORD|POSTGRES_PASSWORD)\s*=\s*/i,
		confirm: (content: string) => {
			const value = extractAssignedValue(content);
			if (value.length < 8) return false;
			return !PASSWORD_PLACEHOLDERS.includes(value.toLowerCase());
		},
	},
];

/** Env var reference patterns — not actual secrets */
const FALSE_POSITIVE_PATTERNS = [
	/process\.env[\.\[]\w+/,
	/os\.environ\[/,
	/\$\{?\w+\}?/, // shell variable reference
	/getenv\(/,
	/requireEnv\(/,
	/getApiKey\(/,
];

/**
 * Scans a unified diff string for secrets in added lines only.
 * Lines starting with '+' (but not '+++') are considered additions.
 */
export function scanDiff(diff: string): ScanResult {
	if (!diff.trim()) {
		return { clean: true, findings: [] };
	}

	const findings: Finding[] = [];
	const lines = diff.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Only scan added lines
		if (!line.startsWith("+")) continue;
		// Skip diff file headers
		if (line.startsWith("+++")) continue;

		const content = line.slice(1); // Remove the leading '+'

		// Skip lines that are just env var references
		if (FALSE_POSITIVE_PATTERNS.some((p) => p.test(content))) continue;

		for (const { name, pattern, confirm } of SECRET_PATTERNS) {
			if (pattern.test(content)) {
				// If a confirm function exists, run it to filter false positives
				if (confirm && !confirm(content)) continue;
				findings.push({ name, line: content.trim(), lineNumber: i + 1 });
				break; // One finding per line is enough
			}
		}
	}

	return { clean: findings.length === 0, findings };
}
