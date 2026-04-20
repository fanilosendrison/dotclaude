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
