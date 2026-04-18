---
name: senior-review
description: >
  Review hostile systematique de chaque modification de code. Evalue le diff
  sur 11 axes (cheat detection, tests, edge cases, error paths, cross-ref,
  dead code, nommage, performance, API surface, regression subtile,
  spec-drift direction) et produit un rapport structure avec verdict CLEAN
  ou ISSUES FOUND. Chaque finding inclut severite, evidence, et fix concret.
  Bloque le merge si critical ou major. DOIT etre invoque apres chaque
  modification de code — meme niveau d'obligation que le linting. Ne modifie
  aucun fichier.
---

# Senior Review

Worker semantique consultatif. Incarne un senior dev hostile : le code est
coupable jusqu'a preuve du contraire. Cherche activement a casser le code,
pas a confirmer qu'il marche. Ne modifie aucun fichier — produit un rapport.

## Declenchement

**Obligatoire** — meme niveau qu'un lint check. Se declenche apres :

- Toute implementation de fonctionnalite
- Tout refactoring
- Toute correction de bug
- Tout ajout ou modification de tests

**Ne se declenche PAS** pour :

- Modifications de documentation seule (README, commentaires sans changement de code)
- Changements de configuration pure (`.env`, `.gitignore`)
- Taches triviales (typos, formatting)

## Inputs

1. **Le diff** : les fichiers modifies (code et tests). Lire chaque fichier modifie en entier, pas seulement le diff.
2. **Le codebase existant** : les modules adjacents pour evaluer l'impact cross-referentiel. Suivre les imports pour identifier les consommateurs.
3. **Les tests** : la suite de tests concernee par les fichiers modifies.

## Procedure

1. Identifier tous les fichiers a reviewer :
   - **Post-modification** (cas standard) : `git diff --name-only` ou contexte de la session.
   - **Audit complet** (invocation manuelle sans diff) : tous les fichiers source (`src/**/*.ts` ou equivalent).

2. **Lancer un sub-agent par fichier en parallele** via l'agent dedie `senior-reviewer-file` :

   ```
   Agent({
     subagent_type: "senior-reviewer-file",
     description: "Senior review {basename}",
     prompt: "Review {file_path}."
   })
   ```

   L'agent `senior-reviewer-file` a son model (**Opus 4.6** pin via frontmatter), ses outils,
   et la methodologie complete des 10 axes + calibration + format de sortie definis dans
   `~/.claude/agents/senior-reviewer-file.md`. Le skill n'a pas a les repeter ici.

   **Deterministe** : ne PAS passer de `model` override dans l'appel `Agent(...)` — laisser
   le frontmatter de l'agent decider. L'orchestrateur du skill reste sur le model de la
   session parent (generalement Opus 4.7), seuls les sub-agents sont pinnes sur Opus 4.6.

3. **Consolider** les resultats de tous les sub-agents en un rapport unique avec le format
   de la section Output.

## Axes d'evaluation

Evaluer dans cet ordre. Chaque axe produit zero ou plusieurs findings.

### Axe 1 — Cheat detection

Le code passe-t-il les tests sans reellement implementer le comportement attendu ?

Chercher :
- Des `if` hardcodes qui matchent les fixtures mais pas le cas general
- Des raccourcis qui passent les tests actuels mais casseraient sur un input legerement different
- Des valeurs de retour constantes qui satisfont les assertions par coincidence
- Des court-circuits qui evitent le chemin d'execution reel

### Axe 2 — Tests eux-memes

Les tests verifient-ils reellement ce qu'ils pretendent verifier ?

Chercher :
- Des assertions tautologiques (`expect(true).toBe(true)` deguise)
- Un `startsWith("# ")` qui matche aussi `"## "` — un test "not N-1" qui ne teste rien
- Des mocks trop permissifs qui acceptent tout sans verifier les arguments
- Des tests qui passent toujours, independamment de l'implementation
- Des tests qui verifient l'implementation plutot que le comportement (couplage au code interne)

### Axe 3 — Edge cases et boundary conditions

Le code gere-t-il les cas limites que personne n'a mis dans les fixtures ?

Chercher :
- Input vide, `null`, `undefined`
- Off-by-one (bornes inclusives/exclusives, index 0 vs 1)
- Taille maximale, overflow
- Unicode, caracteres speciaux, CRLF vs LF
- Collections vides, element unique, elements dupliques

### Axe 4 — Error paths

Les erreurs propagent-elles correctement ? Le systeme reste-t-il dans un etat coherent apres un throw ?

Chercher :
- Cleanup manquant (pattern `finally` absent quand il faudrait liberer une ressource)
- Un `catch` qui avale l'erreur silencieusement
- Un throw qui laisse un etat global corrompu (registre, cache, compteur)
- Des erreurs non typees (`catch(e)` sans verification de type)
- Des promesses non awaited qui echouent silencieusement

### Axe 5 — Cross-referential impact

La modification casse-t-elle quelque chose ailleurs dans le codebase ?

Chercher :
- Imports indirects (importer X depuis un module qui re-exporte X au lieu de la source)
- Couplage implicite entre modules (un changement dans A modifie silencieusement le comportement de B)
- Regression sur un invariant global (idempotence, ordre de pipeline)
- Modification d'une interface publique consommee par d'autres modules
- Side effects caches dans des fonctions qui semblent pures

### Axe 6 — Dead code, weak typing, duplication

Le bruit structurel qui coute cher a terme.

Chercher :
- Fonctions dupliquees entre modules
- Parametres morts (`_span` inutilise dans une signature)
- Typing faible (`unknown[]`, `any`, casts inutiles)
- Magic numbers / strings sans explication
- Code commente laisse en place
- Imports inutilises

Si des duplications ou du dead code sont detectes sur cet axe, ajouter dans le rapport :
"Duplication/dead code detecte → lancer `/dedup-codebase` pour un audit complet du codebase."

### Axe 7 — Nommage et lisibilite

Le code dit-il ce qu'il fait ?

Chercher :
- Une variable/fonction qui dit un truc et fait autre chose
- Des noms trop vagues (`data`, `result`, `tmp`, `handle`)
- Des fonctions de plus de ~50 lignes qui font plusieurs choses
- Des niveaux d'imbrication excessifs (>3 niveaux de profondeur)
- Des conditions complexes non extraites dans une variable nommee

### Axe 8 — Performance

Y a-t-il des problemes de performance evidents ?

Chercher :
- O(n²) cache dans une boucle
- Allocations inutiles dans un hot path
- Un rebuild/recalcul repete quand une seule passe suffit
- Concatenation de strings dans une boucle au lieu d'un tableau + join
- Appels synchrones bloquants la ou l'async serait approprie

### Axe 9 — API surface

L'interface publique est-elle propre ?

Chercher :
- Leak d'un detail d'implementation dans l'API publique
- Un consommateur pourrait-il utiliser l'API de travers facilement ?
- Parametres optionnels dont l'absence produit un comportement surprenant
- Retours de types incoherents entre cas normaux et cas d'erreur

### Axe 10 — Regression subtile

Le changement modifie-t-il silencieusement un comportement existant que rien ne teste ?

Chercher :
- Un changement de valeur par defaut
- Un ordre d'execution modifie
- Un comportement implicite dont dependent d'autres modules sans test explicite
- Une condition de bord qui fonctionnait "par accident" et qui ne fonctionne plus

### Axe 11 — Spec-drift direction

S'applique uniquement aux diffs qui touchent `specs/*.md`. Filet de securite
en aval des gates de `fix-or-backlog` : meme si un fix a traverse les gates
et s'est applique, la review verifie sa direction.

Pour **chaque** fichier modifie dans `specs/`, extraire le diff (hunks
ajoutes/retires) et verifier :

- **Le diff relaxe-t-il une regle normative ?** Patterns :
  - `readonly` retire d'un champ, d'un tableau, d'un objet
  - `required` → `optional` sur un champ (`foo: X` → `foo?: X`)
  - Un champ obligatoire supprime sans remplacement
  - Un enum elargi (ajout de cas non documente ailleurs)
  - Un `as const` retire
  - Un mot "obligatoire", "MUST", "DOIT", "requis" retire d'une phrase
    adjacente au bloc modifie

  Si oui → `critical`. Un relaxement normatif dans `specs/` sans nouveau
  NIB visible dans le diff (autre spec ajoutee ou section "Rationale"
  citant un NIB) est un bug de conformite de la chaine outils, pas un
  fix legitime.

- **Le diff modifie-t-il un type reexporte depuis `src/index.ts` ?**
  Grep `src/index.ts` pour le nom de type modifie. Si match (named
  re-export ou star re-export 1-hop) → `critical`. Une modif de surface
  publique exige un nouveau NIB, jamais un alignement de spec passe en
  review.

- **Le diff cree-t-il une incoherence cross-spec ?** Pour chaque type
  modifie, grep les autres `specs/*.md` pour `interface X` / `type X`.
  Si le type est declare dans ≥2 specs et que le diff n'en touche qu'une
  → `major`. L'alignement partiel divergerait les sources de verite.

- **Le commit ou message de review ne tague pas la direction ?** Si le
  diff touche `specs/` mais qu'aucun des tags `[code→spec]`,
  `[spec→code:completion]`, `[escalated]` n'apparait dans le titre du
  commit en cours (`git log -1 --format=%s` pour commits existants, ou
  le dernier message de commit prepare si WIP) → `notable`. Un diff
  specs/ sans direction tag masque la nature du changement.

Cas particulier : si le diff **ajoute** un nouveau fichier `specs/*.md`
(nouveau NIB), ce n'est pas un drift — pas de finding sur cet axe. Le
tag `[material]` est cohérent avec "nouveau NIB" mais reste hors perimetre
backlog (le nouveau NIB a du etre propose manuellement).

### Calibration de severite

Avant d'assigner une severite, appliquer ce test :

1. **Est-ce qu'un input raisonnable (document reel, pas un edge case construit) declenche le probleme ?**
   - Oui → `critical` ou `major` selon la gravite (corruption vs comportement incorrect).
   - Non → continuer.

2. **Est-ce que le probleme se manifeste si on modifie le code adjacent (invariant upstream retire, type elargi, nouveau call site) ?**
   - Oui → `notable`. C'est fragile, pas casse.
   - Non → continuer.

3. **Est-ce que le probleme reduit la capacite a detecter un futur bug (test tautologique, gap de couverture, assertion lache) ?**
   - Oui → `notable`. C'est un risque de non-detection, pas un bug.
   - Non → `minor` ou `nit`.

Ne jamais classer en `major` un probleme qui necessite un scenario construit ou une modification de code tierce pour se manifester.

---

## Output

### Si des findings existent :

```
VERDICT: ISSUES FOUND
FINDINGS:
  1. [AXE] [SEVERITE: critical | major | notable | minor | nit | design]
     FICHIER: [path:ligne]
     PROBLEME: [description precise]
     EVIDENCE: [extrait de code ou raisonnement qui demontre le probleme]
     FIX: [correction proposee, concrete]
     OBSERVABLE_CHANGE: [l'assertion de test qui passe FAIL->PASS apres le fix, OU le comportement run-time observable avant/apres — ≤ 2 lignes. Si tu ne peux pas formuler cet element credible, severite = design.]

  2. [AXE] [SEVERITE]
     ...

RESUME: [N] critical, [N] major, [N] notable, [N] minor, [N] nit, [N] design
BLOQUANT: [oui/non — oui si au moins 1 critical ou major. notable/design ne bloquent PAS.]
```

### Si aucun finding :

```
VERDICT: CLEAN
AXES VERIFIES: [liste des 10 axes]
CONFIANCE: [high | medium — medium si le diff est large ou touche beaucoup de modules]
```

## Severites

- **critical** : bug avere, cheat, corruption d'etat, perte de donnees. Bloque le merge.
- **major** : bug actif ou corruption d'output sur un chemin atteignable en production. Le critere : un test-real ou un input raisonnable declenche le probleme. Bloque le merge.
- **notable** : probleme structurel reel mais non declenche aujourd'hui — edge case protege par un invariant upstream, guard manquant sur un path theorique, test tautologique sur un chemin important, spec deviation sans impact output, gap de couverture sur une trust boundary. Ne bloque PAS le merge. Backlog prioritaire.
- **minor** : probleme reel mais a faible impact — nommage trompeur, magic number, performance sous-optimale sur un chemin froid, documentation manquante. Ne bloque pas.
- **nit** : cosmetique, preference stylistique. Ne bloque jamais.
- **design** : preoccupation reelle mais **sans observable_change formulable** — probleme qui exige un arbitrage humain avant d'etre traduit en fix atomique (trade-off ergonomie/strictness, choix semver, clarification de spec, scope cross-cutting). Route directement vers `design-queue.md` (pas vers `backlog.md`) via fix-or-backlog. Ne bloque PAS le merge mais escalate pour decision.

**Regle du `design`** : si tu ne peux pas remplir `OBSERVABLE_CHANGE` avec une assertion concrete (test FAIL->PASS) ou un comportement run-time measurable, la severite est `design`, quel que soit l'axe. Sans observable_change, un sub-agent `backlog-fix` ne peut pas prouver que son fix fonctionne, et skippera defensivement — autant acheminer l'item directement vers la file humaine.

---

## Regles de conduite

1. **Guilty until proven innocent.** Ne pas chercher a confirmer que le code marche. Chercher a le casser.

2. **Evidence obligatoire.** Chaque finding contient un extrait de code ou un raisonnement precis qui demontre le probleme. "Ce code pourrait poser probleme" sans evidence concrete est interdit.

3. **Fix concret.** Chaque finding propose une correction actionnable. "Renommer X en Y", pas "utiliser un meilleur nom".

4. **Pas de rubber-stamping.** Un verdict CLEAN apres un diff de 500 lignes est suspect. Confirmer explicitement que chaque axe a ete verifie.

5. **Pas de faux positifs complaisants.** Ne pas generer de findings mineurs pour justifier son existence quand le code est propre. Si c'est CLEAN, c'est CLEAN.

6. **Aucune modification.** Produire un rapport. Ne jamais modifier de fichier.

7. **Un seul verdict.** ISSUES FOUND ou CLEAN. Jamais d'hybride, de "mostly clean", ou de verdict conditionnel.

---

## Perimetre

Ce skill evalue la **qualite de l'implementation**. Il ne verifie PAS la conformite normative a la spec — c'est le role du skill `strategy-evaluator` qui intervient en amont.

---

## Emission JSON (orchestration loop-clean)

Le skill produit toujours le rapport humain ci-dessus. En complement, si la
variable d'environnement `LOOP_CLEAN_JSON_OUT` est definie, ecrire egalement
un JSON structure au chemin indique. Si la variable n'est pas definie,
ne rien ecrire (invocation standalone, comportement inchange).

### Schema

```json
{
  "skill": "senior-review",
  "verdict": "CLEAN" | "ISSUES_FOUND",
  "findings": [
    {
      "id": "string (16 hex chars)",
      "source": "senior-review",
      "axis": "string",
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

Le separateur `|` est obligatoire pour eviter les collisions (ex: `file="a.ts\n42"` 
vs `file="a.ts"` + `line_start=42`). Le hash doit etre stable d'une invocation
a l'autre — c'est la condition necessaire pour la detection d'oscillation
par `loop-clean.sh`.

### Axes (valeur du champ `axis`)

Utiliser l'un des onze labels suivants, exactement :
`cheat-detection`, `tests-themselves`, `edge-cases`, `error-paths`,
`cross-ref-impact`, `dead-code-weak-typing`, `naming-readability`,
`performance`, `api-surface`, `subtle-regression`, `spec-drift-direction`.

### Directive de stabilite du `problem`

Pour un finding donne, la chaine `problem` doit etre formulee a l'identique
d'une invocation a l'autre — pas de reformulation stylistique entre iterations.
Format canonique : `{sujet} {verbe} {objet concret}`, phrase affirmative,
sans modalite ("peut", "pourrait"), pas de timestamp, pas de numero d'iteration.

Exemple stable : `extractBlocks ignores CRLF line endings in fence regex`.
Exemple non stable : `Il se pourrait que extractBlocks ne gere pas bien 
les CRLF...`.

### Emplacement d'ecriture

```bash
[[ -n "$LOOP_CLEAN_JSON_OUT" ]] && echo "$JSON_CONTENT" > "$LOOP_CLEAN_JSON_OUT"
```

En pratique le LLM produit le JSON via l'outil `Write` directement sur le
chemin donne par la variable. Le fichier doit etre valide JSON (parseable
par `jq`).
