import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function canonicalValue(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("canonical JSON rejects non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalValue(entry)).join(",")}]`;
	}
	if (typeof value === "object") {
		const object = value as Record<string, unknown>;
		const entries = Object.keys(object)
			.filter((key) => object[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`);
		return `{${entries.join(",")}}`;
	}
	throw new Error(`canonical JSON rejects ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
	return canonicalValue(value);
}

export async function readJsonFile(path: string): Promise<unknown> {
	let contents: string;
	try {
		contents = await readFile(path, "utf8");
	} catch (error) {
		throw new Error(
			`${basename(path)} is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		return JSON.parse(contents);
	} catch (error) {
		throw new Error(
			`${basename(path)} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function writeJsonAtomic(
	path: string,
	value: unknown,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = join(
		dirname(path),
		`.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
	);
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
	await rename(temporaryPath, path);
}
