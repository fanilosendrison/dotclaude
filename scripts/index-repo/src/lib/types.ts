import { z } from "zod";

// --- Frontmatter ---

export const SpecFrontmatterSchema = z.object({
	id: z.string().min(1),
	version: z.union([z.string(), z.number()]).transform(String),
	scope: z.string().optional(),
	status: z.enum(["draft", "approved", "deprecated"]).optional(),
	depends_on: z.array(z.string()).optional().default([]),
	validates: z.array(z.string()).optional().default([]),
});

export type SpecFrontmatter = z.infer<typeof SpecFrontmatterSchema>;

// --- Scan Results ---

export interface SpecFile {
	path: string; // relative to project root
	frontmatter: SpecFrontmatter | null;
	firstHeading: string | null; // fallback scope from first # heading
	frontmatterError?: string; // populated when a `---...---` block exists but fails schema validation
}

export interface AxisResult {
	files: string[]; // relative paths
	count: number;
	hash: string; // SHA-256 of sorted(path:size)
}

export interface SpecAxisResult extends Omit<AxisResult, "files"> {
	files: SpecFile[];
}

export interface ScanResult {
	code: AxisResult;
	specs: SpecAxisResult;
	config: AxisResult;
	tests: AxisResult;
	scripts: AxisResult;
	totalFiles: number;
}

// --- Cross References ---

export interface CrossReference {
	specId: string;
	specPath: string;
	specVersion: string;
	scope: string | null;
	dependsOn: string[];
	implementedBy: string[];
	validatedBy: string[];
	gaps: string[];
	matchStrategy: "explicit" | "convention" | "mixed";
}

export type CrossReferenceMap = Map<string, CrossReference>;

// --- Validation ---

export interface ValidationReport {
	orphanCodeFiles: string[]; // code files not referenced by any spec
	specsWithoutTests: string[];
	specsWithoutCode: string[];
	specsWithoutFrontmatter: string[];
	specsWithInvalidFrontmatter: Array<{ path: string; error: string }>;
	totalSpecs: number;
	specsWithTests: number;
	testCoveragePct: number;
	estimatedTokens: number;
	tokenWarning: boolean;
}

// --- State ---

export type AxisName = "code" | "specs" | "config" | "tests" | "scripts";

export const IndexStateSchema = z.object({
	treeHash: z.string(),
	timestamp: z.string(),
	axisHashes: z.record(
		z.enum(["code", "specs", "config", "tests", "scripts"]),
		z.string(),
	),
	version: z.literal(1),
});

export type IndexState = z.infer<typeof IndexStateSchema>;

// --- CLI Output ---

export type CliOutput =
	| { status: "FRESH"; treeHash: string; timestamp: string }
	| {
			status: "STALE";
			scanResult: ScanResult;
			crossReferences: Record<string, CrossReference>;
			validation: ValidationReport;
	  }
	| { status: "ERROR"; error: string };
