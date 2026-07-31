#!/usr/bin/env bun
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");

interface MutationDefinition {
	readonly name: string;
	readonly testFile: string;
	readonly apply: (mutantRoot: string) => Promise<void>;
}

async function replaceExactly(
	path: string,
	oldText: string,
	newText: string,
): Promise<void> {
	const contents = await readFile(path, "utf8");
	const first = contents.indexOf(oldText);
	if (first < 0 || contents.indexOf(oldText, first + oldText.length) >= 0) {
		throw new Error(
			`mutation target must occur exactly once in ${path}: ${oldText}`,
		);
	}
	await writeFile(path, contents.replace(oldText, newText));
}

async function copyMutantRepository(): Promise<string> {
	const mutantRoot = await mkdtemp(join(tmpdir(), "loop-clean-mutant-"));
	await mkdir(join(mutantRoot, "scripts"), { recursive: true });
	for (const directory of ["skills", "agents", "helpers"]) {
		await cp(join(repositoryRoot, directory), join(mutantRoot, directory), {
			recursive: true,
		});
	}
	await cp(
		join(repositoryRoot, "scripts/loop-clean-protocol"),
		join(mutantRoot, "scripts/loop-clean-protocol"),
		{ recursive: true },
	);
	await cp(
		join(repositoryRoot, "scripts/package.json"),
		join(mutantRoot, "scripts/package.json"),
	);
	await symlink(
		join(repositoryRoot, "scripts/node_modules"),
		join(mutantRoot, "scripts/node_modules"),
		"dir",
	);
	return mutantRoot;
}

const mutations: readonly MutationDefinition[] = [
	{
		name: "untracked paths removed from scope",
		testFile: "scope.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"scripts/loop-clean-protocol/src/scope/parse-porcelain-v2.ts",
				),
				'\t\tif (record.startsWith("? ")) {',
				'\t\tif (false && record.startsWith("? ")) {',
			);
		},
	},
	{
		name: "iteration history command reintroduced",
		testFile: "static-contract.test.ts",
		apply: async (root) => {
			const path = join(root, "skills/loop-clean/loop-clean.sh");
			const contents = await readFile(path, "utf8");
			await writeFile(
				path,
				`${contents}\ncmd_commit_iter() { git -C "$LOOP_CLEAN_REPO_ROOT" commit -m mutant; }\n`,
			);
		},
	},
	{
		name: "backlog path made relative to cwd",
		testFile: "static-contract.test.ts",
		apply: async (root) => {
			const path = join(root, "skills/fix-or-backlog/SKILL.md");
			const contents = await readFile(path, "utf8");
			await writeFile(path, `${contents}\n\`echo mutant >> backlog.md\`\n`);
		},
	},
	{
		name: "coding-standards source removed from aggregation",
		testFile: "findings.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"scripts/loop-clean-protocol/src/findings/findings-schema.ts",
				),
				'\t"coding-standards",\n',
				"",
			);
		},
	},
	{
		name: "runtime gate moved after decision",
		testFile: "static-contract.test.ts",
		apply: async (root) => {
			const path = join(root, "agents/loop-clean-orchestrator.md");
			await replaceExactly(
				path,
				"5. `runtime-gate`\n6. `collect-findings`\n7. `decide`",
				"5. `collect-findings`\n6. `decide`\n7. `runtime-gate`",
			);
		},
	},
	{
		name: "scope digest check disabled",
		testFile: "findings.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"scripts/loop-clean-protocol/src/findings/collect-findings.ts",
				),
				"\t\tif (report.scope_digest !== scope.digest) {",
				"\t\tif (false && report.scope_digest !== scope.digest) {",
			);
		},
	},
	{
		name: "forgotten routing ID accepted",
		testFile: "routing.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"scripts/loop-clean-protocol/src/routing/validate-routing.ts",
				),
				"\tif (missingIds.length > 0) {",
				"\tif (false && missingIds.length > 0) {",
			);
		},
	},
	{
		name: "removed package script restored",
		testFile: "static-contract.test.ts",
		apply: async (root) => {
			const path = join(root, "scripts/package.json");
			const packageJson = JSON.parse(await readFile(path, "utf8"));
			packageJson.scripts["spec-drift:test"] = "bun test spec-drift";
			await writeFile(path, `${JSON.stringify(packageJson, null, 2)}\n`);
		},
	},
];

export async function runMutationSuite(): Promise<readonly string[]> {
	const detected: string[] = [];
	for (const mutation of mutations) {
		const mutantRoot = await copyMutantRepository();
		try {
			await mutation.apply(mutantRoot);
			const processHandle = Bun.spawn(
				[
					"bun",
					"test",
					join(
						mutantRoot,
						"scripts/loop-clean-protocol/test",
						mutation.testFile,
					),
				],
				{
					cwd: mutantRoot,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(processHandle.stdout).text(),
				new Response(processHandle.stderr).text(),
				processHandle.exited,
			]);
			if (exitCode === 0) {
				throw new Error(
					`mutation survived: ${mutation.name}\n${stdout}\n${stderr}`,
				);
			}
			detected.push(mutation.name);
		} finally {
			await rm(mutantRoot, { recursive: true, force: true });
		}
	}
	return detected;
}

if (import.meta.main) {
	const detected = await runMutationSuite();
	for (const name of detected) process.stdout.write(`DETECTED ${name}\n`);
	process.stdout.write(
		`MUTATION_RESULT ${detected.length}/${mutations.length}\n`,
	);
}
