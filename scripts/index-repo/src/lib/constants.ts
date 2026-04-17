// Glob patterns per scan axis
export const AXIS_PATTERNS = {
	code: [
		"src/**/*.{ts,tsx,js,jsx,py,go,rs,java}",
		"lib/**/*.{ts,tsx,js,jsx,py,go,rs,java}",
		"app/**/*.{ts,tsx,js,jsx,py,go,rs,java}",
	],
	specs: ["docs/**/*.md", "specs/**/*.md", "*.spec.md"],
	config: [
		"*.json",
		"*.yaml",
		"*.yml",
		"*.toml",
		"Dockerfile",
		"Dockerfile.*",
		"docker-compose.yml",
		"docker-compose.yaml",
		"docker-compose.*.yml",
		"docker-compose.*.yaml",
	],
	tests: [
		"tests/**/*.{ts,tsx,js,jsx,py,go,rs,java}",
		"test/**/*.{ts,tsx,js,jsx,py,go,rs,java}",
		"__tests__/**/*.{ts,tsx,js,jsx,py,go,rs,java}",
		"**/*.test.{ts,tsx,js,jsx,py}",
		"**/*.spec.{ts,tsx,js,jsx,py}",
	],
	scripts: ["scripts/**/*", "Makefile", "Justfile"],
} as const;

// Directories/patterns always excluded from scan
export const EXCLUDED_DIRS = [
	"node_modules",
	"dist",
	"build",
	".git",
	"vendor",
	".next",
	".cache",
	".turbo",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
];

// Token estimation: ~1 token per 4 characters
export const CHARS_PER_TOKEN = 4;
export const TOKEN_WARNING_THRESHOLD = 10_000;

// Staleness: ratio of changed files above which we force a full rebuild
export const INCREMENTAL_THRESHOLD = 0.3;

// State file version (for future migrations)
export const STATE_VERSION = 1 as const;

// Output file names
export const PROJECT_INDEX_FILE = "PROJECT_INDEX.md";
export const SPEC_MANIFEST_FILE = "SPEC_MANIFEST.md";
export const INDEX_STATE_FILE = ".index-state.json";
