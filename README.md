# dotclaude

Personal Claude Code vendor repo — mirror of `~/.claude/{skills,agents,scripts,helpers}/`.

## Purpose

1. **Multi-machine portability** : clone on any Mac to get the same Claude Code setup.
2. **Nightly-clean automation** : cloned into `.claude/` by the [`cc-ci`](https://github.com/fanilosendrison/cc-ci) callable workflow at each nightly run, so the cloud runner has access to the same skills, agents, and helpers as local.

## Contents

```
dotclaude/
├── skills/      # Claude Code skills (~/.claude/skills/)
├── agents/      # Sub-agents (~/.claude/agents/)
├── scripts/     # Bash/TS helpers (~/.claude/scripts/)
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
