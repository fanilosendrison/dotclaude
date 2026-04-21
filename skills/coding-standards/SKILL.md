---
name: coding-standards
description: >
  Audit de qualite d'implementation sur 6 axes (naming, typing, maintainability,
  comments, error-handling, immutability). Orchestrateur qui identifie le scope
  (fichiers modifies ou audit cible), lance une passe mecanique (linters + grep
  rules) via le scanner Bun TS, dispatche un sub-agent `coding-standards-file`
  par fichier pour la passe semantique, puis consolide le tout en un rapport
  JSON canonique. Consomme principalement par `loop-clean` comme etape 2.2 de
  son pipeline post-implementation. Invocation manuelle ponctuelle possible
  pour un audit cible. Ne modifie aucun fichier.
---

# Coding Standards (orchestrateur)

Ce skill **n'implemente pas** la doctrine ni la methodologie d'audit. Son role est strict :

1. Resoudre le scope (fichiers a auditer).
2. Lancer la **passe mecanique** : `coding-standards-scanner` (Bun TS CLI) — linters configures via `STACK_EVAL.yaml` + grep rules portables.
3. Dispatcher la **passe semantique** : un sub-agent `coding-standards-file` par fichier, en parallele.
4. Consolider mecanique + semantique en un seul JSON via `coding-standards-consolidate` (Bun TS CLI).
5. Emettre le rapport humain + copier le JSON vers `$LOOP_CLEAN_JSON_OUT` s'il est defini.

La **doctrine** (les 6 axes, les criteres de calibration, les exclusions de perimetre) est la **source unique de verite** dans `~/.claude/agents/coding-standards-file.md`.

La **table de mapping linter-rule → axis** vit dans `scripts/coding-standards-scanner/src/lib/rule-mapping.ts` — c'est aussi la liste des exclusions mecaniques que l'agent ne doit pas re-signaler.

## Declenchement

**Consommateur principal : `loop-clean`.** Le skill est appele comme etape 2.2 du pipeline `coding-standards → senior-review → dedup-codebase → spec-drift → fix-or-backlog`. La regle « post-implementation → invoquer /loop-clean avant commit » vit sur `loop-clean` (cf. CLAUDE.md global) et les conditions de skip (doc seule, config pure, typo) sont gerees a ce niveau. Ce skill ne les re-evalue pas.

**Invocation manuelle : rare.** Cas legitimes :

- Audit cible d'un fichier ou d'un sous-dossier specifique, hors pipeline.
- Debug : verifier la passe mecanique + semantique sur un diff isole sans declencher la boucle complete.

Sinon, passer par `/loop-clean`.

## Procedure

### Etape 1 — Identifier le scope

- **En mode loop-clean** : lire la variable d'environnement `LOOP_CLEAN_SCOPE` emise par `prepare-iter`. Valeurs : `diff` (fichiers modifies, cas standard) ou `all` (audit repo complet en mode `/loop-clean audit`).
- **Invocation manuelle avec chemin** : utiliser le chemin fourni (`--scope=path --path=<dir>`).
- **Invocation manuelle sans argument** : `--scope=all`.

En l'absence de `LOOP_CLEAN_SCOPE` (invocation manuelle), le defaut est `diff`.

Dans tous les cas : filtrer les fichiers source (skip `.md` doc pure, `.env`, `.gitignore`, etc.).

Preparer un dossier de run `$RUN_DIR` (par defaut, un sous-dossier de `.claude/run/coding-standards/<pid>/`; en mode loop-clean, utiliser le `iter-*/` fourni par l'orchestrateur).

### Etape 2 — Passe mecanique (scanner)

```bash
bun ~/.claude/scripts/coding-standards-scanner/src/cli.ts \
  --scope="${LOOP_CLEAN_SCOPE:-diff}" \
  --output="$RUN_DIR/scanner.json"
```

(Substituer `--scope=path --path=<dir>` pour une invocation manuelle ciblee sur un sous-dossier.)

Le scanner :
- lit `STACK_EVAL.yaml` pour choisir entre `biome` et `eslint`,
- bucket les fichiers par langage (`.ts/.tsx/.js/.jsx` / `.py` / `.sh/.bash`),
- lance le linter de chaque bucket avec sortie JSON (fail-open si le linter n'est pas installe — warning stderr),
- applique les grep rules portables (debug statements, abreviations denylist, `any` sans justification en TS/TSX),
- map chaque finding vers un axe canonique, calcule un `id` sha256 stable, emet un JSON valide contre le schema `coding-standards-schema`.

### Etape 3 — Passe semantique (sub-agents)

Pour chaque fichier du scope, lancer un sub-agent `coding-standards-file` en parallele. Assigner a chaque sub-agent un chemin unique pour son JSON via la variable d'environnement `CODING_STANDARDS_FILE_JSON_OUT` :

```
Agent({
  subagent_type: "coding-standards-file",
  description: "Coding-standards audit {basename}",
  prompt: "CODING_STANDARDS_FILE_JSON_OUT=$RUN_DIR/files/file-{basename}-{hash}.json\nAudit {file_path}."
})
```

Conventions :
- Dossier `$RUN_DIR/files/` pour tous les JSONs per-file.
- Nom de fichier unique par sub-agent (`file-<basename>-<short-hash>.json`) pour eviter les collisions quand deux fichiers ont le meme basename.
- **Deterministe** : ne PAS passer de `model` override. Le frontmatter de `coding-standards-file` (Sonnet 4.6 medium) est la source unique de verite pour le model pin.

### Etape 4 — Consolidation

```bash
bun ~/.claude/scripts/coding-standards-consolidate/src/cli.ts \
  --scanner-json="$RUN_DIR/scanner.json" \
  --files-json-dir="$RUN_DIR/files/" \
  --output="$CONSOLIDATED_JSON"
```

(Ou directement `--output="$LOOP_CLEAN_JSON_OUT"` en mode loop-clean.)

Le consolidateur :
- valide le scanner JSON + chaque per-file JSON contre le schema (HARD FAIL, exit 4, si l'un est invalide),
- merge les findings dans une seule liste,
- dedupe defensivement par `id` (en cas de collision, garde la premiere occurrence et log un warning stderr),
- recalcule `summary` + `blocking`,
- emet le verdict CLEAN / ISSUES_FOUND,
- revalide l'output final contre le schema avant d'ecrire.

### Etape 5 — Rapport humain + copie JSON

Emettre le rapport humain (markdown) base sur le JSON consolide. Si `$LOOP_CLEAN_JSON_OUT` est defini, le CLI `consolidate` ecrit deja au bon chemin — aucune copie supplementaire necessaire.

---

## Output consolide

### Si findings :

```
VERDICT: ISSUES FOUND
FINDINGS:
  1. [AXE] [SEVERITE: critical | major | notable | minor | nit | design]
     FICHIER: [path:ligne]
     PROBLEME: [description precise]
     EVIDENCE: [extrait de code ou raisonnement]
     FIX: [correction proposee]
     OBSERVABLE_CHANGE: [assertion FAIL->PASS ou comportement run-time, ≤ 2 lignes.
                         Chaine vide UNIQUEMENT si severite=design.]

  2. ...

RESUME: [N] critical, [N] major, [N] notable, [N] minor, [N] nit, [N] design
BLOQUANT: [oui/non — oui si au moins 1 critical ou major.]
```

### Si aucun finding :

```
VERDICT: CLEAN
FICHIERS AUDITES: [liste]
CONFIANCE: [high | medium — medium si le diff est large ou touche beaucoup de modules]
```

## Regles de blocage par severite

Les definitions completes et la procedure de calibration sont dans `coding-standards-file.md`. Ici, juste ce qu'il faut pour le resume et la regle de blocage :

| severity | bloque_merge | route vers      |
|----------|--------------|-----------------|
| critical | oui          | backlog.md      |
| major    | oui          | backlog.md      |
| notable  | non          | backlog.md      |
| minor    | non          | backlog.md      |
| nit      | non          | backlog.md      |
| design   | non          | design-queue.md |

`BLOQUANT = true` ssi au moins un finding consolide a `bloque_merge = oui`.

## Axes canoniques (6 labels)

Les sub-agents + le scanner emettent l'un de ces labels dans le champ `axis` du JSON. L'orchestrateur les propage tels quels. La description detaillee de chaque axe (ce qui est audit mecanique vs semantique, exclusions, exemples) vit dans `coding-standards-file.md` et `scripts/coding-standards-scanner/src/lib/rule-mapping.ts`.

- `naming`
- `typing`
- `maintainability`
- `comments`
- `error-handling`
- `immutability`

**Hors perimetre de ce skill** (couverts ailleurs dans le pipeline `loop-clean`) :

- **Duplication / dead code / imports inutilises** → `dedup-codebase`.
- **Bugs / cheat / edge cases / substrate resilience / input contract / tests-substance / cross-ref / api-surface** → `senior-review`.
- **Conformite normative a la spec** → `spec-drift`.

---

## Emission JSON (orchestration loop-clean)

Le skill emet toujours le rapport humain ci-dessus. Si `LOOP_CLEAN_JSON_OUT` est defini, le CLI `consolidate` ecrit le JSON structure a ce chemin (pas le LLM directement — c'est une operation technique, pas semantique).

### Schema

```json
{
  "skill": "coding-standards",
  "verdict": "CLEAN" | "ISSUES_FOUND",
  "findings": [
    {
      "id": "string (16 hex chars)",
      "source": "coding-standards",
      "axis": "naming" | "typing" | "maintainability" | "comments" | "error-handling" | "immutability",
      "severity": "critical" | "major" | "notable" | "minor" | "nit" | "design",
      "file": "string (chemin relatif repo)",
      "line_start": number | null,
      "line_end": number | null,
      "problem": "string",
      "evidence": "string",
      "fix_proposal": "string",
      "observable_change": "string (≤ 2 lignes ; chaine vide UNIQUEMENT si severity=design)"
    }
  ],
  "summary": {
    "critical": number, "major": number, "notable": number,
    "minor": number, "nit": number, "design": number
  },
  "blocking": boolean
}
```

`blocking` = `true` ssi au moins un finding est `critical` ou `major`.

### Formule canonique de `id`

```
id = sha256([source, file, String(line_start ?? ""), axis, problem.slice(0,80)].join("|")).slice(0,16)
```

Stable inter-invocations — condition necessaire pour la detection d'oscillation par `loop-clean.sh`. Implementation canonique : `scripts/lib/coding-standards-schema/src/id-hash.ts` (consommee par le scanner et le consolidateur). Le sub-agent semantique calcule la meme formule a la main via `shasum -a 256` — la stabilite des deux implementations est un invariant du systeme.
