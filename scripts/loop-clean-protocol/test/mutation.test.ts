import { expect, test } from "bun:test";
import { runMutationSuite } from "./mutation-runner.ts";

test("every mandatory loop-clean mutant is killed", async () => {
	const detected = await runMutationSuite();
	expect(detected).toHaveLength(8);
}, 120_000);
