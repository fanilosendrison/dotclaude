import { expect, test } from "bun:test";
import { mutationNames, runMutationSuite } from "../mutation-runner.ts";

test(
	"the protocol test suite kills every registered mutation",
	async () => {
		const detected = await runMutationSuite();
		expect(detected).toEqual(mutationNames);
	},
	300_000,
);
