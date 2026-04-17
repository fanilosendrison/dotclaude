import { describe, expect, test } from "bun:test";
import { scanDiff } from "../lib/scanner";

describe("scanDiff", () => {
	describe("clean diffs", () => {
		test("passes normal code changes", () => {
			const diff = `+const x = 42;
+function hello() { return "world"; }
+export default hello;`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(true);
			expect(result.findings).toHaveLength(0);
		});

		test("passes empty diff", () => {
			const result = scanDiff("");
			expect(result.clean).toBe(true);
		});

		test("ignores removed lines (starting with -)", () => {
			const diff = `-const API_KEY = "sk-1234567890abcdef1234567890abcdef";
+const API_KEY = process.env.API_KEY;`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(true);
		});

		test("passes variable names containing 'key' or 'token'", () => {
			const diff = `+const primaryKey = rows[0].id;
+const tokenCount = tokens.length;
+const keyboardShortcut = "ctrl+s";`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(true);
		});

		test("passes environment variable references", () => {
			const diff = `+const apiKey = process.env.API_KEY;
+const secret = process.env.SECRET;
+const token = os.environ["TOKEN"];`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(true);
		});
	});

	describe("AWS keys", () => {
		test("detects AWS access key ID", () => {
			const diff = `+aws_access_key_id = AKIAIOSFODNN7EXAMPLE`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("AWS Access Key");
		});

		test("detects AWS secret key assignment", () => {
			const diff = `+aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("AWS Secret Key");
		});
	});

	describe("private keys", () => {
		test("detects RSA private key header", () => {
			const diff = `+-----BEGIN RSA PRIVATE KEY-----`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("Private Key");
		});

		test("detects generic private key header", () => {
			const diff = `+-----BEGIN PRIVATE KEY-----`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
		});

		test("detects EC private key header", () => {
			const diff = `+-----BEGIN EC PRIVATE KEY-----`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
		});
	});

	describe("API keys and tokens", () => {
		test("detects hardcoded api_key assignment", () => {
			const diff = `+const api_key = "sk-1234567890abcdef1234567890abcdef";`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("Generic API Key");
		});

		test("detects apiKey with camelCase", () => {
			const diff = `+const apiKey = "abcdef1234567890abcdef1234567890";`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
		});

		test("detects auth_token assignment", () => {
			const diff = `+auth_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijk";`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("Generic Token");
		});

		test("detects GitHub personal access token", () => {
			const diff = `+const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("GitHub Token");
		});

		test("detects Slack token", () => {
			const diff = `+const slack = "xoxb-1234567890-1234567890123-abcdefghijklmn";`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("Slack Token");
		});
	});

	describe("passwords", () => {
		test("detects password assignment", () => {
			const diff = `+password = "super_secret_password_123"`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("Password / Secret");
		});

		test("detects DB_PASSWORD in config", () => {
			const diff = `+DB_PASSWORD=my_database_password_here`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
		});

		test("ignores password placeholder/empty", () => {
			const diff = `+password = ""
+PASSWORD = "changeme"`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(true);
		});
	});

	describe("connection strings", () => {
		test("detects MongoDB connection string with credentials", () => {
			const diff = `+const uri = "mongodb://admin:password123@cluster.example.com:27017/db";`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings[0].name).toBe("Connection String");
		});

		test("detects PostgreSQL connection string", () => {
			const diff = `+DATABASE_URL=postgres://user:pass@host:5432/mydb`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
		});
	});

	describe("multiple findings", () => {
		test("reports all findings in a diff", () => {
			const diff = `+const apiKey = "sk-1234567890abcdef1234567890abcdef";
+aws_access_key_id = AKIAIOSFODNN7EXAMPLE
+-----BEGIN RSA PRIVATE KEY-----`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
			expect(result.findings.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("context lines (not additions)", () => {
		test("only scans added lines (starting with +)", () => {
			const diff = ` const old_secret = "sk-1234567890abcdef1234567890abcdef";
-const removed_key = AKIAIOSFODNN7EXAMPLE;
 unchanged line with password = "secret123456"`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(true);
		});
	});

	describe(".env file patterns", () => {
		test("detects .env-style SECRET_KEY assignment", () => {
			const diff = `+SECRET_KEY=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
		});

		test("detects .env-style API key", () => {
			const diff = `+STRIPE_API_KEY=sk_live_1234567890abcdef1234567890`;
			const result = scanDiff(diff);
			expect(result.clean).toBe(false);
		});
	});
});
