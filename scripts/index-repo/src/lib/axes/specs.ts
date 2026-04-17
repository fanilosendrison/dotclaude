import { AXIS_PATTERNS } from "../constants";
import { extractFirstHeading, probeFrontmatter } from "../frontmatter";
import type { SpecAxisResult, SpecFile } from "../types";
import { computeAxisHash, globFiles } from "./shared";

export async function scanSpecs(cwd: string): Promise<SpecAxisResult> {
	const paths = await globFiles(cwd, AXIS_PATTERNS.specs);
	const specFiles: SpecFile[] = [];

	for (const path of paths) {
		const content = await Bun.file(`${cwd}/${path}`).text();
		const probe = probeFrontmatter(content);
		const firstHeading = extractFirstHeading(content);
		const file: SpecFile = {
			path,
			frontmatter: probe.kind === "ok" ? probe.data : null,
			firstHeading,
		};
		if (probe.kind === "invalid") file.frontmatterError = probe.error;
		specFiles.push(file);
	}

	const hash = await computeAxisHash(cwd, paths);
	return { files: specFiles, count: specFiles.length, hash };
}
