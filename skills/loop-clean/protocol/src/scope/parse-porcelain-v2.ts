import type { ScopeEntry, ScopeKind } from "./scope-schema.ts";

export type ParsedScopeEntry = Omit<
	ScopeEntry,
	"exists" | "eligible_for_audit" | "exclusion_reason"
>;

function decodeUtf8(bytes: Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("git status contains a path that is not valid UTF-8");
	}
}

function takeFixedFields(
	record: string,
	fieldCount: number,
): { readonly fields: string[]; readonly remainder: string } {
	const fields: string[] = [];
	let cursor = 0;
	for (let index = 0; index < fieldCount; index += 1) {
		const delimiter = record.indexOf(" ", cursor);
		if (delimiter < 0)
			throw new Error(`malformed porcelain v2 record: ${record}`);
		fields.push(record.slice(cursor, delimiter));
		cursor = delimiter + 1;
	}
	const remainder = record.slice(cursor);
	if (remainder.length === 0)
		throw new Error(`porcelain v2 record has an empty path: ${record}`);
	return { fields, remainder };
}

function kindFromStatus(
	indexStatus: string,
	worktreeStatus: string,
): ScopeKind {
	if (indexStatus === "U" || worktreeStatus === "U") return "unmerged";
	if (indexStatus === "R" || worktreeStatus === "R") return "renamed";
	if (indexStatus === "C" || worktreeStatus === "C") return "copied";
	if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
	return "tracked";
}

function splitNullRecords(input: Uint8Array): string[] {
	const records: string[] = [];
	let start = 0;
	for (let index = 0; index < input.length; index += 1) {
		if (input[index] !== 0) continue;
		records.push(decodeUtf8(input.subarray(start, index)));
		start = index + 1;
	}
	if (start < input.length) {
		throw new Error(
			"git status --porcelain=v2 -z output is not NUL terminated",
		);
	}
	return records;
}

export function parsePorcelainV2(input: Uint8Array): ParsedScopeEntry[] {
	const rawRecords = splitNullRecords(input);
	const entries: ParsedScopeEntry[] = [];
	for (let index = 0; index < rawRecords.length; index += 1) {
		const record = rawRecords[index];
		if (record.length === 0 || record.startsWith("# ")) continue;
		if (record.startsWith("! ")) continue;
		if (record.startsWith("? ")) {
			const path = record.slice(2);
			if (path.length === 0)
				throw new Error("untracked porcelain record has an empty path");
			entries.push({
				path,
				original_path: null,
				kind: "untracked",
				index_status: "?",
				worktree_status: "?",
			});
			continue;
		}
		if (record.startsWith("1 ")) {
			const { fields, remainder: path } = takeFixedFields(record, 8);
			const status = fields[1];
			if (status.length !== 2)
				throw new Error(`invalid XY status in record: ${record}`);
			entries.push({
				path,
				original_path: null,
				kind: kindFromStatus(status[0], status[1]),
				index_status: status[0],
				worktree_status: status[1],
			});
			continue;
		}
		if (record.startsWith("2 ")) {
			const { fields, remainder: path } = takeFixedFields(record, 9);
			const status = fields[1];
			const score = fields[8];
			const originalPath = rawRecords[index + 1];
			if (status.length !== 2 || !originalPath) {
				throw new Error(`malformed rename/copy porcelain record: ${record}`);
			}
			index += 1;
			entries.push({
				path,
				original_path: originalPath,
				kind: score.startsWith("C") ? "copied" : "renamed",
				index_status: status[0],
				worktree_status: status[1],
			});
			continue;
		}
		if (record.startsWith("u ")) {
			const { fields, remainder: path } = takeFixedFields(record, 10);
			const status = fields[1];
			if (status.length !== 2)
				throw new Error(`invalid unmerged XY status: ${record}`);
			entries.push({
				path,
				original_path: null,
				kind: "unmerged",
				index_status: status[0],
				worktree_status: status[1],
			});
			continue;
		}
		throw new Error(`unknown porcelain v2 record type: ${record}`);
	}
	return entries;
}
