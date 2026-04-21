import { createHash } from "node:crypto";

/**
 * Canonical finding id formula — MUST be identical to the one described in
 * agents/coding-standards-file.md, skills/coding-standards/SKILL.md and
 * loop-clean.sh's oscillation-detection code.
 *
 *   id = sha256([source, file, String(line_start ?? ""), axis,
 *                problem.slice(0, 80)].join("|")).slice(0, 16)
 *
 * Stability of this hash is a HARD REQUIREMENT: loop-clean.sh uses these
 * ids (plus a signature derived from axis/file/problem) for oscillation
 * detection between iterations. Changing any argument to this function —
 * including the order, the slice length, or the separator — will break
 * convergence detection silently.
 */
export function computeFindingId(
	source: string,
	file: string,
	lineStart: number | null,
	axis: string,
	problem: string,
): string {
	const key = [
		source,
		file,
		String(lineStart ?? ""),
		axis,
		problem.slice(0, 80),
	].join("|");
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
