import { describe, expect, it } from "bun:test";
import { extractFirstHeading, parseFrontmatter } from "../src/lib/frontmatter";

describe("parseFrontmatter", () => {
	it("should parse complete frontmatter", () => {
		const content = `---
id: SPEC-001
version: 2.3
scope: OAuth2 + session management
status: approved
depends_on: [SPEC-002, SPEC-004]
validates: [src/auth/*, src/session/*]
---

# Auth Flow
Content here...`;

		const result = parseFrontmatter(content);
		expect(result).not.toBeNull();
		expect(result?.id).toBe("SPEC-001");
		expect(result?.version).toBe("2.3");
		expect(result?.scope).toBe("OAuth2 + session management");
		expect(result?.status).toBe("approved");
		expect(result?.depends_on).toEqual(["SPEC-002", "SPEC-004"]);
		expect(result?.validates).toEqual(["src/auth/*", "src/session/*"]);
	});

	it("should parse minimal frontmatter (id + version only)", () => {
		const content = `---
id: SPEC-005
version: 1.0
---

Some content`;

		const result = parseFrontmatter(content);
		expect(result).not.toBeNull();
		expect(result?.id).toBe("SPEC-005");
		expect(result?.version).toBe("1.0");
		expect(result?.depends_on).toEqual([]);
		expect(result?.validates).toEqual([]);
	});

	it("should handle numeric version", () => {
		const content = `---
id: SPEC-010
version: 3
---`;

		const result = parseFrontmatter(content);
		expect(result).not.toBeNull();
		expect(result?.version).toBe("3");
	});

	it("should return null when no frontmatter present", () => {
		const content = "# Just a heading\n\nSome content";
		expect(parseFrontmatter(content)).toBeNull();
	});

	it("should return null when frontmatter is incomplete (missing id)", () => {
		const content = `---
version: 1.0
scope: something
---`;

		expect(parseFrontmatter(content)).toBeNull();
	});

	it("should return null when frontmatter is incomplete (missing version)", () => {
		const content = `---
id: SPEC-001
scope: something
---`;

		expect(parseFrontmatter(content)).toBeNull();
	});

	it("should return null for empty frontmatter block", () => {
		const content = `---
---

Content`;

		expect(parseFrontmatter(content)).toBeNull();
	});

	it("should handle single-element arrays", () => {
		const content = `---
id: SPEC-001
version: 1.0
depends_on: [SPEC-002]
validates: [src/auth/*]
---`;

		const result = parseFrontmatter(content);
		expect(result).not.toBeNull();
		expect(result?.depends_on).toEqual(["SPEC-002"]);
		expect(result?.validates).toEqual(["src/auth/*"]);
	});

	it("should strip surrounding quotes from inline array items", () => {
		const content = `---
id: SPEC-001
version: 1.0
depends_on: ["SPEC-002", "SPEC-003"]
validates: ["src/auth/**", 'tests/auth.test.ts']
---`;

		const result = parseFrontmatter(content);
		expect(result).not.toBeNull();
		expect(result?.depends_on).toEqual(["SPEC-002", "SPEC-003"]);
		expect(result?.validates).toEqual(["src/auth/**", "tests/auth.test.ts"]);
	});

	it("should ignore comment lines in frontmatter", () => {
		const content = `---
# This is a comment
id: SPEC-001
version: 1.0
---`;

		const result = parseFrontmatter(content);
		expect(result).not.toBeNull();
		expect(result?.id).toBe("SPEC-001");
	});

	it("should handle colons in values", () => {
		const content = `---
id: SPEC-001
version: 1.0
scope: OAuth2: token management
---`;

		const result = parseFrontmatter(content);
		expect(result).not.toBeNull();
		expect(result?.scope).toBe("OAuth2: token management");
	});
});

describe("extractFirstHeading", () => {
	it("should extract heading from plain markdown", () => {
		const content = "# My Heading\n\nContent";
		expect(extractFirstHeading(content)).toBe("My Heading");
	});

	it("should extract heading after frontmatter", () => {
		const content = `---
id: SPEC-001
version: 1.0
---

# Auth Flow Specification

Content here`;

		expect(extractFirstHeading(content)).toBe("Auth Flow Specification");
	});

	it("should extract h2 heading", () => {
		const content = "## Sub Heading\n\nContent";
		expect(extractFirstHeading(content)).toBe("Sub Heading");
	});

	it("should return null when no heading", () => {
		const content = "Just plain text\nNo headings here";
		expect(extractFirstHeading(content)).toBeNull();
	});
});
