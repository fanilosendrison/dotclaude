#!/usr/bin/env bun
import { join } from "node:path";
import { type OrchestratorConfig, runOrchestrator } from "turnlock";

import { checkPrerequisites } from "../required-tools-checker/required-tools-checker";
import { installTools } from "../tools-installer/tools-installer";
import {
	createPhaseCheck,
	createPhaseConsumeAgentResult,
	createPhaseInstall,
	createPhaseRecheck,
	initialState,
	type State,
} from "./phases";

const REQUIRED_TOOLS_CONFIG_PATH = join(
	import.meta.dir,
	"..",
	"required-tools-checker",
	"required-tools.json",
);

const realCheckPrerequisites = (): ReturnType<typeof checkPrerequisites> =>
	checkPrerequisites({
		configPath: REQUIRED_TOOLS_CONFIG_PATH,
		platform: process.platform,
	});

const config: OrchestratorConfig<State> = {
	name: "new-cc-project-onboarder",
	initial: "check",
	phases: {
		check: createPhaseCheck({ checkPrerequisites: realCheckPrerequisites }),
		install: createPhaseInstall({ installTools }),
		"consume-agent-result": createPhaseConsumeAgentResult(),
		recheck: createPhaseRecheck({ checkPrerequisites: realCheckPrerequisites }),
	},
	initialState,
	resumeCommand: (runId) =>
		`bun ${import.meta.path} --run-id ${runId} --resume`,
};

if (import.meta.main) {
	await runOrchestrator(config);
}
