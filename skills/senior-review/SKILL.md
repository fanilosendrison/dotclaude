---
name: senior-review
description: >
  Review hostile d'un ensemble de fichiers. Orchestrateur qui identifie le
  scope (fichiers modifies ou audit complet) et dispatche un sub-agent
  `senior-reviewer-file` par fichier, puis consolide les rapports en un
  verdict unique CLEAN ou ISSUES FOUND. Consomme principalement par
  `loop-clean` comme etape 1 de son pipeline post-implementation. Invocation
  manuelle ponctuelle possible pour un audit cible. Ne modifie aucun fichier.
---

# Senior Review (orchestrateur)

Ce skill **n'implemente pas** la methodologie de review. Son role est strict :

1. Identifier le scope (fichiers a reviewer).
2. Dispatcher un sub-agent `senior-reviewer-file` par fichier, en parallele.
3. Consolider les rapports per-file en un verdict unique.
4. Emettre le JSON consolide si `LOOP_CLEAN_JSON_OUT` est defini.

La methodologie (11 axes, calibration, severites detaillees, regle
`observable_change`, stabilite du `problem`, regles de conduite, format per-file)
est la **source unique de verite** dans `~/.claude/agents/senior-reviewer-file.md`.

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

## Inputs

1. **Le diff** : fichiers modifies (code et tests). L'orchestrateur le resout via
   `git diff --name-only` ou le contexte de la session.
2. **Le codebase existant** : disponible en lecture pour les sub-agents qui en
   ont besoin pour l'axe cross-ref.

## Procedure

### 1. Identifier le scope

- **Post-modification** (cas standard) : `git diff --name-only` — filtrer les
  fichiers source et de tests (skip `.md` doc pure, `.env`, `.gitignore`, etc.).
- **Audit complet** (invocation manuelle sans diff) : tous les fichiers source
  (`src/**/*.ts` ou equivalent) plus `specs/*.md` si applicable.

### 2. Dispatcher les sub-agents en parallele

Un sub-agent par fichier. Dans un seul message, emettre N appels `Agent(...)` :

```
Agent({
  subagent_type: "senior-reviewer-file",
  description: "Senior review {basename}",
  prompt: "Review {file_path}."
})
```

**Deterministe** : ne PAS passer de `model` override. Le frontmatter de
`senior-reviewer-file` est la source unique de verite pour le model pin —
l'orchestrateur reste sur le model de la session parent.

### 3. Consolider

Collecter les rapports per-file. Pour chaque finding retourne par un sub-agent,
conserver l'integralite des champs (axe, severite, fichier, ligne, probleme,
evidence, fix, observable_change). Calculer les totaux par severite et la
regle de blocage.

Emettre le rapport consolide (format ci-dessous) et, si
`LOOP_CLEAN_JSON_OUT` est defini, ecrire le JSON consolide.

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

## Severites (reference courte pour consolidation)

Les definitions completes et la procedure de calibration sont dans
`senior-reviewer-file.md`. Ici, juste ce qu'il faut pour calculer le resume et
la regle de blocage :

- **critical** — bloque le merge.
- **major** — bloque le merge.
- **notable** — ne bloque pas. Backlog prioritaire.
- **minor** — ne bloque pas.
- **nit** — ne bloque jamais.
- **design** — ne bloque pas. Route vers `design-queue.md` (pas `backlog.md`).

`BLOQUANT = true` ssi au moins un finding consolide est `critical` ou `major`.

## Axes (labels canoniques)

Les sub-agents emettent l'un de ces onze labels dans le champ `axis` du JSON.
L'orchestrateur les propage tels quels. La description detaillee de chaque axe
vit dans `senior-reviewer-file.md`.

`cheat-detection`, `tests-themselves`, `edge-cases`, `error-paths`,
`cross-ref-impact`, `dead-code-weak-typing`, `naming-readability`,
`performance`, `api-surface`, `subtle-regression`, `spec-drift-direction`.

Si un ou plusieurs findings remontent sur `dead-code-weak-typing`, l'orchestrateur
ajoute dans le rapport consolide : "Duplication/dead code detecte → lancer
`/dedup-codebase` pour un audit complet du codebase."

---

## Emission JSON (orchestration loop-clean)

Le skill produit toujours le rapport humain ci-dessus. En complement, si la
variable d'environnement `LOOP_CLEAN_JSON_OUT` est definie, ecrire egalement
un JSON structure au chemin indique. Si la variable n'est pas definie, ne
rien ecrire (invocation standalone, comportement inchange).

### Schema

```json
{
  "skill": "senior-review",
  "verdict": "CLEAN" | "ISSUES_FOUND",
  "findings": [
    {
      "id": "string (16 hex chars)",
      "source": "senior-review",
      "axis": "string (un des 11 labels canoniques)",
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

La stabilite inter-invocations du champ `problem` est garantie cote sub-agent
(regle decrite dans `senior-reviewer-file.md`). L'orchestrateur la propage
sans reformulation.

### Emplacement d'ecriture

```bash
[[ -n "$LOOP_CLEAN_JSON_OUT" ]] && echo "$JSON_CONTENT" > "$LOOP_CLEAN_JSON_OUT"
```

En pratique le LLM produit le JSON via l'outil `Write` directement sur le chemin
donne par la variable. Le fichier doit etre valide JSON (parseable par `jq`).
