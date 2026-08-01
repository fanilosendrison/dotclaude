# dotclaude

Personal Claude Code vendor repo — source for `~/.claude/{skills,agents,scripts,helpers}/`.

## Loop-clean migration to dotagents

**Effective 2025-08-01**, `loop-clean` and its dependencies have been migrated to
[dotagents](https://github.com/fanilosendrison/dotagents), the canonical `.agents`
source. The corresponding entries under `~/.claude/skills/`, `~/.claude/agents/`,
and `~/.claude/scripts/` are now a **locally-generated symlink facade** pointing
to `~/.agents/`. There are no real copies remaining in this repository.

### Affected resources (canonical source → dotagents)

| Category | Entries |
|----------|---------|
| Skills | `loop-clean`, `coding-standards`, `senior-review`, `dedup-codebase`, `fix-or-backlog`, `backlog-crush`, `backlog-deep-crush`, `lib/backlog-common.sh` |
| Agents | `loop-clean-orchestrator`, `backlog-crush-orchestrator`, `backlog-deep-crush-orchestrator`, `backlog-fix`, `coding-standards-file`, `dedup-inter`, `dedup-intra`, `fix-file`, `senior-review-file` |
| Scripts | `coding-standards-scanner`, `coding-standards-consolidate`, `lib/coding-standards-schema`, `lib/stack-tools` |

### Facade installation

The facade is created by a local, idempotent installer that replaces each legacy
real directory/file with a symlink to `~/.agents/`. Re-run the installer after
a fresh clone to recreate the facade.

## Purpose

1. **Multi-machine portability** : clone on any Mac to get the same Claude Code setup.
2. **Nightly-clean automation** : cloned into `.claude/` by the [`cc-ci`](https://github.com/fanilosendrison/cc-ci) callable workflow at each nightly run, so the cloud runner has access to the same skills, agents, and helpers as local.

## Contents

```
dotclaude/
├── skills/      # Claude Code skills (~/.claude/skills/) — loop-clean resources are symlinks to ~/.agents/
├── agents/      # Sub-agents (~/.claude/agents/) — loop-clean agents are symlinks to ~/.agents/
├── scripts/     # Bash/TS helpers (~/.claude/scripts/) — migrated scripts are symlinks to ~/.agents/
├── helpers/     # Shared prompt snippets
└── README.md
```

## Loop-clean protocol

`/loop-clean` operates on every non-ignored, uncommitted change in the nearest
Git repository. Staged, unstaged, untracked, renamed, and deleted paths share one
manifest per iteration. Four canonical producers run against that manifest, with
the runtime gate completing before canonical collection and decision. The loop
never changes HEAD or the Git index and writes deferred items only to ledger paths
resolved from the Git root.

## Status

Personal workspace — published for CI/CD reuse, not maintained as a project.

- No support, no issues triage, no PR review guaranteed.
- Patterns and skill APIs may change without notice.
- Skills may reference private instructions from `~/.claude/CLAUDE.md` (not included) and may not work standalone.

## NOT mirrored

These stay local-only (machine-specific, credentials, session data) :

- `~/.claude/settings.local.json`, `settings.json`
- `~/.claude/CLAUDE.md` (personal global instructions)
- `~/.claude/TEMPLATES.md`
- `~/.claude/keybindings.json`
- `~/.claude/MEMORY.md` + `memory/`
- `~/.claude/projects/` (session transcripts)

## License

MIT — free to fork, adapt, reuse. No warranty. See [LICENSE](LICENSE).
