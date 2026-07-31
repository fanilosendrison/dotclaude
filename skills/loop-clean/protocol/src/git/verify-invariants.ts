import {
	captureGitInvariants,
	type GitBaseline,
	GitBaselineSchema,
} from "./capture-invariants.ts";

export interface GitInvariantVerification {
	readonly head_changed: boolean;
	readonly index_changed: boolean;
}

export class GitInvariantViolationError extends Error {
	readonly verification: GitInvariantVerification;

	constructor(verification: GitInvariantVerification) {
		const violations: string[] = [];
		if (verification.head_changed) violations.push("HEAD changed");
		if (verification.index_changed) violations.push("index changed");
		super(violations.join("; "));
		this.name = "GitInvariantViolationError";
		this.verification = verification;
	}
}

export async function verifyGitInvariants(
	repositoryRoot: string,
	baselineValue: GitBaseline | unknown,
): Promise<GitInvariantVerification> {
	const baseline = GitBaselineSchema.parse(baselineValue);
	const current = await captureGitInvariants(repositoryRoot);
	const verification = {
		head_changed: current.head !== baseline.head,
		index_changed: current.index_digest !== baseline.index_digest,
	};
	if (verification.head_changed || verification.index_changed) {
		throw new GitInvariantViolationError(verification);
	}
	return verification;
}
