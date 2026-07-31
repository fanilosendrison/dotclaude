import { sha256 } from "../shared/hash.ts";

export function computeFindingId(
	source: string,
	file: string,
	lineStart: number | null,
	axis: string,
	problem: string,
): string {
	return sha256(
		[source, file, String(lineStart ?? ""), axis, problem.slice(0, 80)].join(
			"|",
		),
	).slice(0, 16);
}
