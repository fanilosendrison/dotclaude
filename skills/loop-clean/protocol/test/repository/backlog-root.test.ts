import { afterEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	createRepository,
	parseShellExports,
	removeRepository,
	runProcess,
	writeRepositoryFile,
} from "../helpers/git-fixture.ts";

const repositoryRoot = resolve(import.meta.dir, "../../../../..");
const repositories: string[] = [];

afterEach(async () => {
	for (const root of repositories.splice(0)) await removeRepository(root);
});

describe("backlog consumers", () => {
	for (const variant of ["backlog-crush", "backlog-deep-crush"] as const) {
		test(`${variant} resolves backlog and runtime paths from Git root`, async () => {
			const root = await createRepository();
			repositories.push(root);
			await writeRepositoryFile(
				root,
				"backlog.md",
				"# Backlog\n\n- [ ] [major] src/example.ts:1 — Example (finding_id: example)\n",
			);
			const subdirectory = join(root, "nested", "work");
			await mkdir(subdirectory, { recursive: true });
			const script = join(repositoryRoot, "skills", variant, `${variant}.sh`);
			const environment =
				variant === "backlog-crush"
					? { BACKLOG_CRUSH_SESSION_ID: "root-test" }
					: {
							BACKLOG_DEEP_CRUSH_SESSION_ID: "root-test",
							DEEP_CRUSH_NOCTURNAL: "1",
						};
			const result = await runProcess(["bash", script, "init"], {
				cwd: subdirectory,
				env: environment,
			});
			expect(result.exitCode).toBe(0);
			const exports = parseShellExports(result.stdout);
			const runDirectory =
				exports.BACKLOG_CRUSH_RUN_DIR ?? exports.BACKLOG_DEEP_CRUSH_RUN_DIR;
			expect(runDirectory).toStartWith(join(root, ".claude/run/"));
			expect(await Bun.file(join(root, "backlog.md")).exists()).toBe(true);
			expect(await Bun.file(join(subdirectory, "backlog.md")).exists()).toBe(
				false,
			);
		});
	}

	test("resolved-item archive is written at Git root from a subdirectory", async () => {
		const root = await createRepository();
		repositories.push(root);
		await writeRepositoryFile(
			root,
			"backlog.md",
			"# Backlog\n\n- [x] [major] src/example.ts:1 — Resolved (finding_id: resolved)\n",
		);
		const subdirectory = join(root, "nested");
		await mkdir(subdirectory, { recursive: true });
		const script = join(
			repositoryRoot,
			"skills/backlog-crush/backlog-crush.sh",
		);
		const result = await runProcess(["bash", script, "sweep-resolved"], {
			cwd: subdirectory,
			env: { BACKLOG_CRUSH_SESSION_ID: "archive-root-test" },
		});
		expect(result.exitCode).toBe(0);
		expect(await Bun.file(join(root, "backlog.archive.md")).exists()).toBe(
			true,
		);
		expect(
			await Bun.file(join(subdirectory, "backlog.archive.md")).exists(),
		).toBe(false);
	});
});
