# dotclaude

Personal Claude Code vendor repo — source for `~/.claude/{skills,agents,scripts,helpers}/`.

## Loop-clean migration to dotagents

**Effective 2025-08-01**, `loop-clean` and its dependencies have been migrated to
[dotagents](https://github.com/fanilosendrison/dotagents), the canonical `.agents`
source. The corresponding entries under `~/.claude/skills/`, `~/.claude/agents/`,
and `~/.claude/scripts/` are now a **locally-generated symlink facade** pointing
to `~/.agents/`.

**This repository does not version the facade.** The canonical sources live in
dotagents. The facade is generated locally in `~/.claude/` by the installer.

### Affected resources (canonical source → dotagents)

| Category | Entries |
|----------|---------|
| Skills | `loop-clean`, `coding-standards`, `senior-review`, `dedup-codebase`, `fix-or-backlog`, `backlog-crush`, `backlog-deep-crush`, `lib/backlog-common.sh` |
| Agents | `loop-clean-orchestrator`, `backlog-crush-orchestrator`, `backlog-deep-crush-orchestrator`, `backlog-fix`, `coding-standards-file`, `dedup-inter`, `dedup-intra`, `fix-file`, `senior-review-file` |
| Scripts | `coding-standards-scanner`, `coding-standards-consolidate`, `lib/coding-standards-schema`, `lib/stack-tools` |

### Facade installation

After a fresh clone, the facade must be generated locally. The installer lives in
dotagents at `~/.agents/scripts/claude-facade/`.

```bash
# Create the facade (idempotent — safe to re-run)
bun ~/.agents/scripts/claude-facade/src/cli.ts install

# Verify the facade is correct (read-only)
bun ~/.agents/scripts/claude-facade/src/cli.ts check

# Repair broken or misdirected symlinks
bun ~/.agents/scripts/claude-facade/src/cli.ts install --repair
```

**Safety contract:**
- The installer never overwrites real files or directories — collisions cause an
error.
- Wrong or broken symlinks are reported but not silently replaced (use `--repair`).
- The installer is idempotent: running it multiple times is safe.
- No existing data is ever deleted automatically.

## Purpose

1. **Multi-machine portability** : clone on any Mac to get the same Claude Code setup.
2. **Nightly-clean automation** : cloned into `.claude/` by the [`cc-ci`](https://github.com/fanilosendrison/cc-ci) callable workflow at each nightly run, so the cloud runner has access to the same skills, agents, and helpers as local.

## Contents

```
dotclaude/
├── skills/      # Claude Code skills (~/.claude/skills/) — loop-clean resources are facade symlinks to ~/.agents/
├── agents/      # Sub-agents (~/.claude/agents/) — loop-clean agents are facade symlinks to ~/.agents/
├── scripts/     # Bash/TS helpers (~/.claude/scripts/) — migrated scripts are facade symlinks to ~/.agents/
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
