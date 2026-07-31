#!/usr/bin/env bun
import { collectFindings } from "./findings/collect-findings.ts";
import {
	captureGitInvariants,
	GitBaselineSchema,
} from "./git/capture-invariants.ts";
import { verifyGitInvariants } from "./git/verify-invariants.ts";
import { validateRouting } from "./routing/validate-routing.ts";
import { runRuntimeGate } from "./runtime/run-runtime-gate.ts";
import { collectScope } from "./scope/collect-scope.ts";
import { readJsonFile, writeJsonAtomic } from "./shared/json.ts";

type Arguments = Record<string, string>;

function parseArguments(values: readonly string[]): Arguments {
	const parsed: Arguments = {};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (!value.startsWith("--"))
			throw new Error(`unexpected argument ${value}`);
		const equalsIndex = value.indexOf("=");
		if (equalsIndex >= 0) {
			parsed[value.slice(2, equalsIndex)] = value.slice(equalsIndex + 1);
			continue;
		}
		const key = value.slice(2);
		const next = values[index + 1];
		if (!next || next.startsWith("--"))
			throw new Error(`missing value for --${key}`);
		parsed[key] = next;
		index += 1;
	}
	return parsed;
}

function required(argumentsValue: Arguments, name: string): string {
	const value = argumentsValue[name];
	if (!value) throw new Error(`missing --${name}`);
	return value;
}

async function main(): Promise<void> {
	const [command, ...values] = process.argv.slice(2);
	if (!command) throw new Error("missing command");
	const args = parseArguments(values);
	switch (command) {
		case "scope": {
			const manifest = await collectScope(required(args, "repo-root"));
			await writeJsonAtomic(required(args, "output"), manifest);
			return;
		}
		case "collect": {
			await collectFindings({
				iterationDirectory: required(args, "iter-dir"),
				scopeFile: required(args, "scope"),
				deferredFile: required(args, "deferred"),
				outputFile: required(args, "output"),
			});
			return;
		}
		case "validate-routing": {
			const result = await validateRouting({
				findingsFile: required(args, "findings"),
				routingFile: required(args, "routing"),
				deferredOutputFile: required(args, "deferred-out"),
			});
			process.stdout.write(`${JSON.stringify(result)}\n`);
			return;
		}
		case "capture-git": {
			const baseline = await captureGitInvariants(required(args, "repo-root"));
			await writeJsonAtomic(required(args, "output"), baseline);
			return;
		}
		case "verify-git": {
			const baseline = GitBaselineSchema.parse(
				await readJsonFile(required(args, "baseline")),
			);
			await verifyGitInvariants(required(args, "repo-root"), baseline);
			return;
		}
		case "runtime-gate": {
			const report = await runRuntimeGate({
				repoRoot: required(args, "repo-root"),
				scopeFile: required(args, "scope"),
			});
			await writeJsonAtomic(required(args, "output"), report);
			process.stdout.write(`${report.status.toUpperCase()}\n`);
			return;
		}
		default:
			throw new Error(`unknown command ${command}`);
	}
}

main().catch((error: unknown) => {
	process.stderr.write(
		`ERROR_PROTOCOL: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(4);
});
