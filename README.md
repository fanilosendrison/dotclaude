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

## NOT mirrored

These stay local-only (machine-specific, credentials, session data) :

- `~/.claude/settings.local.json`, `settings.json`
- `~/.claude/CLAUDE.md` (personal global instructions)
- `~/.claude/TEMPLATES.md`
- `~/.claude/keybindings.json`
- `~/.claude/MEMORY.md` + `memory/`
- `~/.claude/projects/` (session transcripts)

## License

Personal use only.
