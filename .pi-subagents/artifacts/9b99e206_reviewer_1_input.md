# Task for reviewer

[Read from: /Users/famillesendrison/Developper/Projects/dotclaude/plan.md, /Users/famillesendrison/Developper/Projects/dotclaude/progress.md]

READ-ONLY architecture/requirements review. Do not edit files. In /Users/famillesendrison/Developper/Projects/dotclaude, inspect the current loop-clean implementation, orchestrator, producer skills/agents, fix-or-backlog, backlog consumers, and scripts/package.json. Compare them to the user's detailed target contract. Identify conflicts, ambiguous requirements, hidden dependencies, migration risks, and an implementation sequence that preserves RED→GREEN. Pay special attention to shell/TypeScript boundary, unborn HEAD, porcelain v2 -z, runtime-gate discovery, digest/canonicalization, deferred findings, routing identity, and no-Git-write defenses.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```