# cc-skills

Personal Claude Code vendor repo — mirror of `~/.claude/{skills,agents,scripts}/`.

## Purpose

1. **Multi-machine portability** : clone + symlink on any Mac to get the same Claude Code setup.
2. **Nightly-clean Routines** : cloud-side cloned by `routine-setup.sh` at each run so the cloud env has access to orchestrator agents, cleanup skills, and helper scripts.

## Contents

```
cc-skills/
├── skills/      # Claude Code skills (~/.claude/skills/)
├── agents/      # Sub-agents (~/.claude/agents/)
├── scripts/     # Bash/TS helpers (~/.claude/scripts/)
└── README.md
```

## Sync from local `~/.claude/`

Run from anywhere :

```bash
bash ~/.claude/skills/nightly-clean-enroll/enroll.sh sync-vendor
```

Excludes : `node_modules/`, `__pycache__/`, `*.log`, runtime state (`statusline/data/`).

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
