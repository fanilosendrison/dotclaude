import { extname } from "node:path";

/** File extensions considered "code" (trigger the hook). */
export const CODE_EXTENSIONS = new Set([
	".py",
	".ts",
	".tsx",
	".js",
	".jsx",
	".sh",
	".bash",
]);

/** Mapping: linter name → set of extensions it supports. */
export const LINTER_EXTENSIONS: Record<string, Set<string>> = {
	biome: new Set([".ts", ".tsx", ".js", ".jsx"]),
	eslint: new Set([".ts", ".tsx", ".js", ".jsx"]),
	ruff: new Set([".py"]),
	shellcheck: new Set([".sh", ".bash"]),
};

/** True if the file has a code extension that triggers the hook. */
export function isCodeFile(filePath: string): boolean {
	return CODE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/** True if the linter supports this file's extension. Unknown linters → true (try anyway). */
export function isLinterCompatible(linter: string, filePath: string): boolean {
	const supported = LINTER_EXTENSIONS[linter];
	if (!supported) return true; // Unknown linter — let it try
	return supported.has(extname(filePath).toLowerCase());
}
