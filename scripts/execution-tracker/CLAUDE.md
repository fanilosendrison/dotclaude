# execution-tracker — Mesure de durée d'exécution + push Notion

Script bash `start`/`stop` qui capture les métadonnées d'une exécution (repo, version, branch, timestamp) et émet un JSON consommable par Claude pour créer une page Notion de télémétrie.

Consommé par `claude-project-onboarder` (sections "Execution Tracking" et "Push Notion" de son `SKILL.md`). Réutilisable pour tout autre skill long qu'on veut tracker.

## Usage

```bash
# Avant la boucle d'exécution
bash ~/.claude/scripts/execution-tracker/execution-tracker.sh start --command "claude-project-onboarder"

# ... workflow tourne ...

# Après la boucle (ou sur abort)
bash ~/.claude/scripts/execution-tracker/execution-tracker.sh stop --status "success"

# Diagnostic
bash ~/.claude/scripts/execution-tracker/execution-tracker.sh peek
bash ~/.claude/scripts/execution-tracker/execution-tracker.sh reset
```

## Contrat

### `start --command <name>`

Capture l'état et le persiste dans le state file. Pas d'output stdout (stdout reste propre pour un futur consommateur programmatique).

Champs capturés :

| Champ | Source |
|---|---|
| `command` | `--command <name>` |
| `cwd` | `$PWD` |
| `repo` | `basename $(git rev-parse --show-toplevel)` si repo, sinon `basename $PWD` |
| `branch` | `git branch --show-current` (vide si pas un repo) |
| `version` | Première source trouvée dans : `package.json`, `pyproject.toml`, `Cargo.toml`, `VERSION`, `version.txt`, `workflow.yaml`, `git describe --tags` |
| `started_at_iso` | `date -u +%Y-%m-%dT%H:%M:%SZ` |
| `started_at_epoch` | `date +%s` |

Un message `tracker: started ...` part sur **stderr** pour traçabilité humaine.

### `stop --status <status>`

Status valide : `success` | `failure` | `partial`.

Lit le state file, calcule `ended_at_*`, `duration_seconds`, `duration_human`, émet le JSON consolidé sur **stdout**, puis purge le state file.

### JSON émis par `stop`

```json
{
  "command": "claude-project-onboarder",
  "cwd": "/Users/.../my-project",
  "repo": "my-project",
  "branch": "main",
  "version": "0.1.0",
  "started_at_iso": "2026-04-23T17:00:00Z",
  "ended_at_iso": "2026-04-23T17:03:42Z",
  "duration_seconds": 222,
  "duration_human": "3m 42s",
  "status": "success"
}
```

### `peek`

Affiche le state courant (`cat .tracker-state.json`). Exit 1 si pas de state actif. N'altère pas le state.

### `reset`

Supprime le state file. Idempotent.

## Fichiers

| Path | Description |
|---|---|
| `execution-tracker.sh` | Le script |
| `.tracker-state.json` | Écrit par `start`, consommé + effacé par `stop` (git-ignored) |
| `.tracker-config` | Config key=value, lu par Claude (git-ignored) — voir ci-dessous |
| `.gitignore` | Liste les fichiers générés à ne pas commit |

### `.tracker-config`

Fichier optionnel contenant les secrets/IDs nécessaires au push Notion. Format `KEY=VALUE`, une ligne par variable. Lu par **Claude** (pas par le script), donc pas de parsing strict — tolère les commentaires `#`.

Exemple :

```
# Notion data source ID du database "Execution Tracker"
NOTION_DATA_SOURCE_ID=abc123def456...
```

## Mapping vers la page Notion

Après `stop`, Claude lit le JSON sur stdout + `NOTION_DATA_SOURCE_ID` dans `.tracker-config`, puis crée une page Notion via MCP (`notion-create-pages`) :

| Propriété Notion | Source JSON |
|---|---|
| `Command` | `command` |
| `Repo` | `repo` |
| `Version` | `version` |
| `Branch` | `branch` |
| `Date` (datetime) | `started_at_iso` |
| `Duration (s)` | `duration_seconds` |
| `Duration` | `duration_human` |
| `Status` | `status` |

## Exit codes

| Code | Signification |
|---|---|
| `0` | OK |
| `1` | State error — `stop` sans `start` préalable, ou state file corrompu |
| `2` | Usage error — sous-commande inconnue, arg manquant, status invalide |

## Invariants

- **Start/stop séparés** : chaque appel est un process distinct. La coordination passe par le state file sur disque.
- **Un seul track à la fois** : `start` deux fois de suite **écrase** l'état précédent. Pas de stack d'invocations. OK pour l'usage single-user mono-workflow ; à retravailler si un jour on veut tracker des workflows concurrents.
- **Output discipline** : `start` → stderr seulement. `stop` → JSON sur stdout. Aucune autre sortie — le stdout de `stop` est directement parsable.
- **Zéro dep externe** : bash + coreutils + POSIX awk/sed/grep. Pas de `jq`, pas de `yq`.
- **Le script ne pousse pas sur Notion** : il produit le JSON. Claude consomme le JSON + `.tracker-config` et fait l'appel MCP lui-même.
