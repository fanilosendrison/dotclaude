---
name: prerequisites-check
version: "0.2.0"
description: "Run prerequisites-check.sh to verify OS, flags and required tools (git, gh, bun)"
allowed_tools:
  - Bash
inputs: []
outputs:
  - name: flags
    description: "Parsed flags object: { force: bool, dryRun: bool, light: bool }"
  - name: os
    description: "Detected OS info: { platform: 'darwin'|'linux'|'windows', arch: 'arm64'|'x86_64', label: 'macOS arm64' }"
parameters:
  flags:
    - "--force"
    - "--dry-run"
    - "--light"
---

# Step 01 — Prerequisites Check

Exécuter le script `scripts/prerequisites-check.sh` qui vérifie l'OS, parse les flags et contrôle les outils requis.

## 1. Lancer le script

```bash
bash ~/.claude/skills/claude-project-onboarder/scripts/prerequisites-check.sh [flags]
```

Transmettre les flags reçus par le workflow (`--force`, `--dry-run`, `--light`).

Le script retourne un JSON sur stdout :

```json
{
  "status": "ok | missing_tools",
  "os":    { "platform": "darwin", "arch": "x86_64", "label": "macOS x86_64" },
  "flags": { "force": false, "dryRun": false, "light": false },
  "tools": {
    "git": { "found": true, "version": "git version 2.x" },
    "gh":  { "found": true, "version": "gh version 2.x" },
    "bun": { "found": true, "version": "1.x" }
  },
  "missing": []
}
```

## 2. Interpréter le résultat

- **Exit 0** (`status: "ok"`) → stocker `os` et `flags` dans les outputs, afficher le résumé compact, enchaîner Step 02 sans validation.
- **Exit 1** (`status: "missing_tools"`) → **abort**. Afficher chaque outil manquant avec sa commande d'installation (fournie dans `missing[].install`).

## 3. Résumé compact attendu

```
OS: macOS x86_64
Prerequisites OK: git v2.37.1, gh v2.86.0, bun v1.3.9
Flags: [none | --force | --dry-run | --light]
```
