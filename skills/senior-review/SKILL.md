---
name: senior-review
description: >
  Review hostile d'un ensemble de fichiers. Orchestrateur qui identifie le
  scope (fichiers modifies ou audit complet) et dispatche un sub-agent
  `senior-review-file` par fichier, puis consolide les rapports en un
  verdict unique CLEAN ou ISSUES FOUND. Consomme principalement par
  `loop-clean` comme etape 1 de son pipeline post-implementation. Invocation
  manuelle ponctuelle possible pour un audit cible. Ne modifie aucun fichier.
---

# Senior Review (orchestrateur)

Ce skill **n'implemente pas** la methodologie de review. Son role est strict :

1. Identifier le scope (fichiers a reviewer).
2. Dispatcher un sub-agent `senior-review-file` par fichier, en parallele.
3. Consolider les rapports per-file en un verdict unique.
4. Emettre le JSON consolide si `LOOP_CLEAN_JSON_OUT` est defini.

La methodologie (11 axes, calibration, severites detaillees, regle
`observable_change`, stabilite du `problem`, regles de conduite, format per-file)
est la **source unique de verite** dans `~/.claude/agents/senior-review-file.md`.

## Declenchement

**Consommateur principal : `loop-clean`.** Le skill est appele comme etape 1
du pipeline `senior-review → dedup-codebase → spec-drift → fix-or-backlog`.
La regle « post-implementation → invoquer /loop-clean avant commit » vit sur
`loop-clean` (cf. CLAUDE.md global) et les conditions de skip (doc seule,
config pure, typo) sont gerees a ce niveau. Ce skill ne les re-evalue pas.

**Invocation manuelle : rare.** Cas legitimes :
- Audit cible d'un fichier ou d'un sous-dossier specifique, hors pipeline.
- Debug : verifier un diff isole sans declencher la boucle complete.

Sinon, passer par `/loop-clean`.

## Procedure

### 1. Identifier le scope

- **En mode loop-clean** : lire la variable d'environnement `LOOP_CLEAN_SCOPE`
  emise par `prepare-iter`. Valeurs : `diff` (fichiers modifies, cas standard)
  ou `all` (audit repo complet en mode `/loop-clean audit`).
- **Invocation manuelle** : `git diff --name-only` (post-modification) ou
  scope complet (`src/**/*.ts` + `specs/*.md` si applicable) selon l'intention.

En l'absence de `LOOP_CLEAN_SCOPE` (invocation manuelle), le defaut est `diff`.

Resolution concrete :
- `LOOP_CLEAN_SCOPE=diff` :
  - Si `$LOOP_CLEAN_BASE_SHA` est defini → `git diff "$LOOP_CLEAN_BASE_SHA" --name-only`
    (ancrage au debut de la run loop-clean — stable a travers les iterations
    meme si l'orchestrateur fait des commits intermediaires).
  - Sinon → `git diff --name-only` + `git diff --cached --name-only`
    (working tree + staged, cas standalone).
- `LOOP_CLEAN_SCOPE=all` → tous les fichiers source du repo (plus `specs/*.md`
  si applicable).

Dans tous les cas : filtrer les fichiers source et de tests (skip `.md` doc
pure, `.env`, `.gitignore`, etc.).

### 2. Dispatcher les sub-agents en parallele

Un sub-agent par fichier. Dans un seul message, emettre N appels `Agent(...)` :

```
Agent({
  subagent_type: "senior-review-file",
  description: "Senior review {basename}",
  prompt: "Review {file_path}."
})
```

**Deterministe** : ne PAS passer de `model` override. Le frontmatter de
`senior-review-file` est la source unique de verite pour le model pin —
l'orchestrateur reste sur le model de la session parent.

### 3. Consolider

Collecter les rapports per-file. Pour chaque finding retourne par un sub-agent :
- propager tel quel les champs (axe, severite, fichier, ligne, probleme,
  evidence, fix, observable_change) ;
- calculer le champ `id` via la formule canonique (§ Formule canonique de `id`
  ci-dessous).

Calculer les totaux par severite et la regle de blocage.

Emettre le rapport consolide (format ci-dessous).

---

## Output consolide

### Si des findings existent :

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
BLOQUANT: [oui/non — oui si au moins 1 critical ou major. notable/design ne bloquent PAS.]
```

### Si aucun finding :

```
VERDICT: CLEAN
FICHIERS REVIEWES: [liste]
CONFIANCE: [high | medium — medium si le diff est large ou touche beaucoup de modules]
```

## Regles de blocage par severite

Les definitions completes et la procedure de calibration sont dans
`senior-review-file.md`. Ici, juste ce qu'il faut pour calculer le resume et
la regle de blocage :

| severity | bloque_merge | route vers      |
|----------|--------------|-----------------|
| critical | oui          | backlog.md      |
| major    | oui          | backlog.md      |
| notable  | non          | backlog.md      |
| minor    | non          | backlog.md      |
| nit      | non          | backlog.md      |
| design   | non          | design-queue.md |

`BLOQUANT = true` ssi au moins un finding consolide a `bloque_merge = oui`.

## Axes (labels canoniques)

Les sub-agents emettent l'un de ces douze labels dans le champ `axis` du JSON.
L'orchestrateur les propage tels quels. La description detaillee de chaque axe,
leur regroupement en phases d'execution, et la procedure d'audit per-file
vivent dans `senior-review-file.md`.

`cheat-detection`, `edge-cases`, `subtle-regression` (phase 1 — Correctness) ;
`error-paths`, `performance`, `substrate-resilience`, `input-contract-boundary`
(phase 2 — Robustness) ;
`tests-substance` (phase 3 — Tests) ;
`cross-ref-impact`, `naming-readability`, `api-surface`, `spec-drift-direction`
(phase 4 — Interface & coherence).

Les preoccupations suivantes ne sont PAS auditees par senior-review — elles
sont couvertes par d'autres skills du pipeline `loop-clean` :

- **Duplication / dead code / imports inutilises** → `dedup-codebase`.
- **Weak typing / magic numbers / nommage stylistique / complexite cyclomatique** → `coding-standards` (mode audit).

Si un sub-agent rencontre ces preoccupations, il **ne doit pas** emettre de
finding — double-emission = bruit dans le pipeline.

---

## Emission JSON (orchestration loop-clean)

Le skill emet toujours le rapport humain ci-dessus. Si `LOOP_CLEAN_JSON_OUT`
est defini, il ecrit aussi un JSON structure au chemin indique :

```bash
[[ -n "$LOOP_CLEAN_JSON_OUT" ]] && echo "$JSON_CONTENT" > "$LOOP_CLEAN_JSON_OUT"
```

En pratique le LLM produit le JSON via l'outil `Write` directement sur le
chemin donne par la variable. Le fichier doit etre valide JSON (parseable
par `jq`). Si la variable n'est pas definie, rien de plus — mode standalone.

### Schema

```json
{
  "skill": "senior-review",
  "verdict": "CLEAN" | "ISSUES_FOUND",
  "findings": [
    {
      "id": "string (16 hex chars)",
      "source": "senior-review",
      "axis": "string (un des 12 labels canoniques)",
      "severity": "critical" | "major" | "notable" | "minor" | "nit" | "design",
      "file": "string (chemin relatif repo)",
      "line_start": number | null,
      "line_end": number | null,
      "problem": "string",
      "evidence": "string",
      "fix_proposal": "string",
      "observable_change": "string (assertion FAIL->PASS ou comportement run-time, ≤ 2 lignes ; chaine vide UNIQUEMENT si severity=design)"
    }
  ],
  "summary": {
    "critical": number, "major": number, "notable": number,
    "minor": number, "nit": number, "design": number
  },
  "blocking": boolean
}
```

`blocking` = `true` si au moins un finding est `critical` ou `major`.

### Formule canonique de `id`

```
id = sha256([source, file, String(line_start ?? ""), axis, problem.slice(0,80)].join("|")).slice(0,16)
```

Le separateur `|` est obligatoire pour eviter les collisions (ex : `file="a.ts\n42"`
vs `file="a.ts"` + `line_start=42`). Le hash doit etre stable d'une invocation
a l'autre — c'est la condition necessaire pour la detection d'oscillation par
`loop-clean.sh`.

L'orchestrateur ne reformule jamais `problem` — propager tel quel.

