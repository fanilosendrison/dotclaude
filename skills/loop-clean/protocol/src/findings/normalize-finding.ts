import { computeFindingId } from "./finding-id.ts";
import {
	type Finding,
	FindingSchema,
	type FindingSource,
} from "./findings-schema.ts";

export function normalizeFinding(
	value: unknown,
	expectedSource: FindingSource,
): Finding {
	const finding = FindingSchema.parse(value);
	if (finding.source !== expectedSource) {
		throw new Error(
			`finding ${finding.id} has source ${finding.source}; expected ${expectedSource}`,
		);
	}
	const expectedId = computeFindingId(
		finding.source,
		finding.file,
		finding.line_start,
		finding.axis,
		finding.problem,
	);
	if (finding.id !== expectedId) {
		throw new Error(
			`finding id ${finding.id} is not canonical; expected ${expectedId}`,
		);
	}
	return finding;
}
