#!/usr/bin/env bun
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../../..");

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

async function requireTestPasses(
	mutantRoot: string,
	testFile: string,
	label: string,
): Promise<void> {
	const processHandle = Bun.spawn(
		["bun", "test", join(mutantRoot, "skills/loop-clean/protocol/test", testFile)],
		{
			cwd: join(mutantRoot, "skills/loop-clean/protocol"),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`${label} baseline failed before mutation was applied:\n${stdout}\n${stderr}`,
		);
	}
}

async function runMutatedTest(
	mutantRoot: string,
	testFile: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const processHandle = Bun.spawn(
		["bun", "test", join(mutantRoot, "skills/loop-clean/protocol/test", testFile)],
		{
			cwd: join(mutantRoot, "skills/loop-clean/protocol"),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	return { stdout, stderr, exitCode };
}

// ── Portable mutations: copy only skills/loop-clean/ ──

async function copyPortableMutant(): Promise<string> {
	const mutantRoot = await mkdtemp(join(tmpdir(), "loop-clean-mutant-portable-"));
	await mkdir(join(mutantRoot, "skills"), { recursive: true });
	await cp(
		join(repositoryRoot, "skills/loop-clean"),
		join(mutantRoot, "skills/loop-clean"),
		{
			recursive: true,
			filter: (src) => !src.includes("node_modules"),
		},
	);
	const protocolDir = join(mutantRoot, "skills/loop-clean/protocol");
	const installResult = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
		cwd: protocolDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (installResult.exitCode !== 0) {
		throw new Error(
			`portable mutant dependency install failed: ${installResult.stderr.toString()}`,
		);
	}
	return mutantRoot;
}

// ── Repository mutations: copy minimal dotclaude fixture ──

async function copyRepositoryMutant(): Promise<string> {
	const mutantRoot = await mkdtemp(
		join(tmpdir(), "loop-clean-mutant-repo-"),
	);
	await mkdir(join(mutantRoot, "skills"), { recursive: true });
	await mkdir(join(mutantRoot, "scripts"), { recursive: true });

	// Copy loop-clean skill (excluding node_modules)
	await cp(
		join(repositoryRoot, "skills/loop-clean"),
		join(mutantRoot, "skills/loop-clean"),
		{
			recursive: true,
			filter: (src) => !src.includes("node_modules"),
		},
	);

	// Copy agents
	await cp(join(repositoryRoot, "agents"), join(mutantRoot, "agents"), {
		recursive: true,
	});

	// Copy skills referenced by static-contract — these must exist
	for (const skill of [
		"fix-or-backlog",
		"coding-standards",
		"senior-review",
		"dedup-codebase",
		"backlog-crush",
		"backlog-deep-crush",
		"lib",
	]) {
		const src = join(repositoryRoot, "skills", skill);
		const dst = join(mutantRoot, "skills", skill);
		if (!existsSync(src)) {
			throw new Error(`required skill fixture missing: ${src}`);
		}
		await cp(src, dst, { recursive: true });
	}

	// Copy scripts referenced by static-contract — these must exist
	for (const scriptDir of [
		"coding-standards-scanner",
		"coding-standards-consolidate",
	]) {
		const src = join(repositoryRoot, "scripts", scriptDir);
		if (existsSync(src)) {
			await cp(src, join(mutantRoot, "scripts", scriptDir), { recursive: true });
		}
	}

	const packageJsonSrc = join(repositoryRoot, "scripts/package.json");
	if (!existsSync(packageJsonSrc)) {
		throw new Error(`required fixture missing: scripts/package.json`);
	}
	await cp(packageJsonSrc, join(mutantRoot, "scripts/package.json"));

	// Install protocol dependencies
	const protocolDir = join(mutantRoot, "skills/loop-clean/protocol");
	const installResult = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
		cwd: protocolDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (installResult.exitCode !== 0) {
		throw new Error(
			`repository mutant dependency install failed: ${installResult.stderr.toString()}`,
		);
	}

	return mutantRoot;
}

// ── Mutation definitions ──

const portableMutations: readonly MutationDefinition[] = [
	{
		name: "untracked paths removed from scope",
		testFile: "portable/scope.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"skills/loop-clean/protocol/src/scope/parse-porcelain-v2.ts",
				),
				'\t\tif (record.startsWith("? ")) {',
				'\t\tif (false && record.startsWith("? ")) {',
			);
		},
	},
	{
		name: "coding-standards source removed from aggregation",
		testFile: "portable/findings.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"skills/loop-clean/protocol/src/findings/findings-schema.ts",
				),
				'\t"coding-standards",\n',
				"",
			);
		},
	},
	{
		name: "scope digest check disabled",
		testFile: "portable/findings.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"skills/loop-clean/protocol/src/findings/collect-findings.ts",
				),
				"\t\tif (report.scope_digest !== scope.digest) {",
				"\t\tif (false && report.scope_digest !== scope.digest) {",
			);
		},
	},
	{
		name: "forgotten routing ID accepted",
		testFile: "portable/routing.test.ts",
		apply: async (root) => {
			await replaceExactly(
				join(
					root,
					"skills/loop-clean/protocol/src/routing/validate-routing.ts",
				),
				"\tif (missingIds.length > 0) {",
				"\tif (false && missingIds.length > 0) {",
			);
		},
	},
];

const repositoryMutations: readonly MutationDefinition[] = [
	{
		name: "iteration history command reintroduced",
		testFile: "repository/static-contract.test.ts",
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
		testFile: "repository/static-contract.test.ts",
		apply: async (root) => {
			const path = join(root, "skills/fix-or-backlog/SKILL.md");
			const contents = await readFile(path, "utf8");
			await writeFile(path, `${contents}\n\`echo mutant >> backlog.md\`\n`);
		},
	},
	{
		name: "runtime gate moved after decision",
		testFile: "repository/static-contract.test.ts",
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
		name: "removed package script restored",
		testFile: "repository/static-contract.test.ts",
		apply: async (root) => {
			const path = join(root, "scripts/package.json");
			const packageJson = JSON.parse(await readFile(path, "utf8"));
			packageJson.scripts["spec-drift:test"] = "bun test spec-drift";
			await writeFile(path, `${JSON.stringify(packageJson, null, 2)}\n`);
		},
	},
];

const allMutations = [...portableMutations, ...repositoryMutations];
export const mutationNames = allMutations.map((m) => m.name) as readonly string[];

async function runMutationBatch(
	mutations: readonly MutationDefinition[],
	copyFn: () => Promise<string>,
	label: string,
): Promise<readonly string[]> {
	// Establish baseline: the unmutated fixture must pass
	const baselineRoot = await copyFn();
	try {
		const baselineTest = mutations[0].testFile;
		await requireTestPasses(baselineRoot, baselineTest, `${label} baseline`);
	} finally {
		await rm(baselineRoot, { recursive: true, force: true });
	}

	const detected: string[] = [];
	for (const mutation of mutations) {
		const mutantRoot = await copyFn();
		try {
			await mutation.apply(mutantRoot);
			const { stdout, stderr, exitCode } = await runMutatedTest(
				mutantRoot,
				mutation.testFile,
			);
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

export async function runMutationSuite(): Promise<readonly string[]> {
	const portableDetected = await runMutationBatch(
		portableMutations,
		copyPortableMutant,
		"portable",
	);
	const repositoryDetected = await runMutationBatch(
		repositoryMutations,
		copyRepositoryMutant,
		"repository",
	);
	return [...portableDetected, ...repositoryDetected];
}

if (import.meta.main) {
	const detected = await runMutationSuite();
	for (const name of detected) process.stdout.write(`DETECTED ${name}\n`);
	process.stdout.write(
		`MUTATION_RESULT ${detected.length}/${allMutations.length}\n`,
	);
}
