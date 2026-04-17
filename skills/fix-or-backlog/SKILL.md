---
name: fix-or-backlog
description: >
  Triage automatique des findings d'une senior review. Classe chaque finding
  en FIX NOW ou BACKLOG selon deux axes (code frais vs pre-existant,
  correctness vs hygiene), applique les fixes immediats, et ajoute les items
  backlog dans /backlog.md. Invoque apres /senior-review ou manuellement.
---

# Fix or Backlog

Skill de triage post-review. Prend les findings d'une senior review, decide
quoi fixer maintenant et quoi backlog, applique les fixes, et persiste les
items backlog. Le but : que le mainteneur n'ait pas a trier manuellement.

## Declenchement

- L'utilisateur tape `/fix-or-backlog` apres une review
- L'utilisateur demande "quoi fix et quoi backlog", "dis moi quoi fix",
  "trie les findings", ou toute variante

## Inputs

### Mode standalone (comportement par defaut)

1. **Les findings** de la senior review la plus recente dans la conversation.
   Si aucune review n'est visible dans le contexte, demander a l'utilisateur
   de la fournir ou de lancer `/senior-review` d'abord.
2. **Le diff courant** (`git diff --name-only`) pour determiner quels
   fichiers sont "code frais" vs "code pre-existant".

### Mode orchestre (invoque depuis loop-clean)

Si les variables d'environnement `LOOP_CLEAN_RUN_DIR` et `LOOP_CLEAN_ITERATION`
sont definies, le skill ne lit PAS les findings depuis le contexte conversationnel.
Il lit les JSON produits par les 3 skills de l'iteration courante :

- `$LOOP_CLEAN_RUN_DIR/iter-<ITER>/senior-review.json`
- `$LOOP_CLEAN_RUN_DIR/iter-<ITER>/dedup-codebase.json`
- `$LOOP_CLEAN_RUN_DIR/iter-<ITER>/spec-drift.json`

ou `<ITER>` est la valeur de `LOOP_CLEAN_ITERATION` zero-paddee sur 3 digits
(ex: `iter-000`, `iter-001`). Tous les `findings[]` des 3 fichiers sont
agreges et trites comme une seule liste.

### Ancrage du diff sur BASE_SHA

Si `$LOOP_CLEAN_BASE_SHA` est defini, TOUS les `git diff` utilises par
le skill pour determiner "code frais vs pre-existant" deviennent :

```bash
git diff "$LOOP_CLEAN_BASE_SHA" --name-only
git diff "$LOOP_CLEAN_BASE_SHA" -- <file>
```

Rationale : sans ancrage, apres quelques iterations, fix-or-backlog classerait
tout comme "code frais" car chaque iteration produit de nouveaux commits.
Avec l'ancrage, "code frais" = code modifie depuis le debut de la boucle,
stable sur la duree de la session.

Si `LOOP_CLEAN_BASE_SHA` n'est pas defini, comportement standalone :
`git diff --name-only` nu.

## Framework de decision

Evaluer chaque finding sur DEUX axes :

### Axe 1 — Code frais ou code pre-existant ?

| Type | Definition |
|------|-----------|
| **Code frais** | Code ecrit ou modifie dans la tache en cours (le diff actuel) |
| **Code pre-existant** | Code qui existait avant et n'a pas ete touche |

Determiner via `git diff` : si le fichier et la zone du finding apparaissent
dans le diff, c'est du code frais. Sinon, c'est pre-existant.

### Axe 2 — Correctness ou hygiene ?

| Type | Definition |
|------|-----------|
| **Correctness** | Bugs logiques, edge cases qui produisent des resultats faux, error handling qui avale silencieusement les echecs, tests qui ne testent pas ce qu'ils pretendent |
| **Hygiene** | Dead code, JSDoc, nommage, formatting cosmetique, micro-optimisations de perf, couverture de tests sur du code non touche |

### Matrice de decision

|                     | Code frais | Code pre-existant |
|---------------------|------------|-------------------|
| **Correctness**     | FIX NOW | FIX NOW si rapide (<5 min), sinon BACKLOG |
| **Hygiene**         | FIX NOW si rapide (<10 min), sinon BACKLOG | BACKLOG |

### Regles "toujours fix" (override la matrice)

- Severite `critical` ou `major` → toujours FIX NOW
- Bug de correctness sur du code frais → toujours FIX NOW
- Test qui ne teste pas ce qu'il pretend (spy qui absorbe au lieu de throw,
  assertion trivialement vraie, test negatif manquant sur un nouveau
  comportement) → toujours FIX NOW
- ≤5 findings, tous sur du code frais et tous rapides → batch-fix tout,
  pas la peine de backlog
- Duplication de code (logique repetee, copier-coller, code duplique entre
  fichiers) → toujours FIX NOW. La codebase bouge trop frequemment :
  une seule copie mise a jour = regression silencieuse.
- Fichier oversized (`axis=oversized-file`) sur code frais ET plan de
  decoupage self-contained (≤3 nouveaux fichiers resultants, pas de
  modif cross-module) → FIX NOW. Un fichier qui vient d'etre cree ou
  fortement modifie et depasse deja le seuil est plus facile a splitter
  maintenant que plus tard. Si le split plan necessite >3 fichiers ou
  touche d'autres modules → BACKLOG (trop gros scope pour fix-or-backlog).

### Regles "toujours backlog" (override la matrice)

- Hygiene pre-existante (dead code dans des vieux fichiers, JSDoc manquant
  sur des fonctions non touchees, couverture sur du vieux code)
- Optimisations de perf qui n'affectent pas la correctness
- Findings qui necessitent >30 min ou touchent plusieurs systemes → tache
  separee
- Style/convention dans du code pre-existant

## Procedure

1. **Collecter les findings** depuis la senior review dans le contexte
   (ou les JSON en mode orchestre).
2. **Identifier le code frais** via `git diff --name-only` (et `git diff`
   pour les zones specifiques si necessaire).
3. **Classer chaque finding** selon la matrice et les regles override.
4. **Afficher le verdict** au format ci-dessous.
5. **Appliquer tous les FIX NOW** immediatement, sans demander confirmation :

   **5a. Construire les clusters de fichiers** (union-find sur les fichiers touches) :
   - Pour chaque finding FIX NOW, extraire `files[]` (l'ensemble des fichiers
     que le fix touche — un seul pour un fix single-file, plusieurs pour un
     fix cross-file comme `duplication-inter`, `cross-ref-impact`, etc.).
   - Fusionner les findings qui partagent au moins un fichier en commun, de
     maniere transitive : si finding A touche `{a.ts, b.ts}` et finding B
     touche `{b.ts, c.ts}`, ils sont dans le meme cluster `{a.ts, b.ts, c.ts}`
     avec les findings A et B associes.
   - Resultat : une liste de clusters disjoints, chacun avec `scope_files[]`
     et `findings[]`.

   **5b. Dispatcher selon le nombre de clusters** :
   - **Si ≥2 clusters** : lancer **un sub-agent `fix-file` par cluster en
     parallele** via :
     ```
     Agent({
       subagent_type: "fix-file",
       description: "Fix cluster {basename_list}",
       prompt: "Scope: {scope_files}\n\nFindings a appliquer :\n{liste des findings du cluster, avec finding_id, severity, axis, files[], line_start/end par fichier, problem, evidence, fix_proposal}"
     })
     ```
     L'agent `fix-file` a son model (**Opus 4.6**), son effort (**xhigh**) et
     ses outils pinnes via frontmatter dans `~/.claude/agents/fix-file.md`.
     Il retourne un JSON `{ scope_files, fixes_applied[], fixes_skipped[], notes[] }`.
   - **Si 1 seul cluster avec 1 seul fichier** (cas degenere) : l'orchestrateur
     applique directement via Edit/Write, sans spawner de sub-agent.
   - **Si 1 seul cluster mais multi-file** : quand meme lancer un sub-agent
     `fix-file` (l'agent est concu pour ca et applique les fixes cross-file
     dans l'ordre correct).

   **5c. Parallelisme garanti** : comme les clusters sont disjoints par
   construction (aucun fichier partage entre clusters), les sub-agents ne
   peuvent pas se marcher dessus meme en parallele.

   **5d. Determinisme** : ne PAS passer de `model` ou `effort` override dans
   l'appel `Agent(...)` — laisser le frontmatter de l'agent decider.
   L'orchestrateur du skill reste sur le model de la session parent ; seuls
   les sub-agents sont pinnes sur Opus 4.6 / effort xhigh.
6. **Ajouter les items BACKLOG** dans `/backlog.md` a la racine du repo.
7. Si un finding est reellement ambigu entre fix et backlog, escalader
   uniquement celui-la.
8. **Consolider les retours des sub-agents `fix-file`** : aggreger les
   `fixes_applied[]` de tous les clusters pour remplir le champ
   `fix_now_applied[]` du JSON d'emission. Chaque entree `fix_now_applied`
   doit refleter `files_touched[]` (potentiellement plusieurs fichiers pour
   un fix cross-file). Reporter les `fixes_skipped[]` dans
   `escalated[]` si ils signalent un cas qui necessite attention humaine
   (call site hors scope, fix necessitant un fichier non inclus, etc.).

8b. **Consolider les `notes[]` des sub-agents** : concatener les
    `notes[]` retournees par chaque sub-agent `fix-file` / `backlog-fix`,
    dedupliquer (meme chaine exacte), trier alphabetiquement. Le resultat
    remplit le champ `notes[]` du JSON d'emission. Ce champ est
    lu par `loop-clean.sh commit-iter` pour enrichir le message de
    commit ; sans ca, les observations cross-ref restent invisibles au
    reviewer humain post-autonomie.

## Format de sortie

```
FIX NOW:
- #1 (notable) — [raison en une ligne]
- #3 (minor) — [raison en une ligne]

BACKLOG:
- #2 (minor) — [raison en une ligne]
- #4 (nit) — [raison en une ligne]
```

Chaque ligne justifie la decision par reference a la matrice ou a une regle
override.

## Backlog file

Le fichier backlog est a `backlog.md` a la racine du repo.

- Si le fichier n'existe pas, le creer avec un header `# Backlog`.
- **Avant d'ajouter un item, verifier qu'il n'existe pas deja** : grep dans
  `backlog.md` sur la sous-chaine `Fichier:ligne — <40 premiers caracteres
  de la description>`. Si match (coche `[x]` ou non coche `[ ]`) → skip
  l'append. L'item est deja suivi ; re-l'ajouter creerait un doublon. Si
  le bug revient reellement, senior-review le re-detectera en frais et
  un nouvel item sera backlog'd avec une description/ligne potentiellement
  differente.
- Sinon, ajouter a la fin du fichier.
- Format de chaque item :

```markdown
- [ ] [SEVERITE] Fichier:ligne — Description courte du finding (date: YYYY-MM-DD, source: review de [nom de la tache/PR])
```

### Dedup pratique

Avant chaque append, executer le check dedup **uniquement contre les items
non coches `- [ ]`**. Un `[x]` signifie que l'item a ete traite dans un
run passe ; si le probleme re-apparait (regression), il merite une
nouvelle ligne avec date recente — ne pas masquer sous pretexte que la
cle match un historique `[x]`.

```bash
# Construire la cle de dedup : "file:line — desc[0:40]"
# IMPORTANT: dedup uniquement contre les items NON coches. Un [x] est
# historique ; si le bug revient, on veut une nouvelle ligne [ ] avec
# date recente pour que le reviewer voie la regression.
key="src/foo.ts:42 — extractBlocks ignores CRLF line "
if ! grep -E "^- \[ \]" backlog.md 2>/dev/null | grep -qF "$key"; then
    echo "- [ ] [notable] src/foo.ts:42 — extractBlocks ignores CRLF line endings (date: 2026-04-17, source: senior-review)" >> backlog.md
fi
```

Le skill applique cette regle pour chaque item a ajouter — pas de doublons
entre sessions, mais les regressions restent visibles.

## Anti-patterns

- Ne PAS tout backlog parce que "0 critical, 0 major". Les notables sur du
  code frais doivent quasi toujours etre fixes.
- Ne PAS tout fixer. L'hygiene pre-existante n'est pas le probleme du jour.
- Ne PAS demander pour chaque finding. Le skill decide. Escalader seulement
  les cas reellement ambigus.
- Ne PAS "split the difference" (fixer la moitie, backlog la moitie sans
  raison). Chaque decision doit etre justifiee par la matrice.

---

## Emission JSON (orchestration loop-clean)

Si la variable d'environnement `LOOP_CLEAN_JSON_OUT` est definie, ecrire
egalement le JSON structure ci-dessous au chemin indique, en plus du
rapport humain standard.

### Schema

```json
{
  "skill": "fix-or-backlog",
  "fix_now_applied": [
    {
      "finding_id": "string",
      "file": "string",
      "change_summary": "string"
    }
  ],
  "backlog_added": [
    {
      "finding_id": "string",
      "file": "string",
      "severity": "critical" | "major" | "notable" | "minor" | "nit"
    }
  ],
  "escalated": [
    {
      "finding_id": "string",
      "reason": "string"
    }
  ],
  "notes": ["string"]
}
```

- `fix_now_applied` : findings classes FIX NOW qui ont ete appliques dans ce
  pass. Un finding est ici SSI le fichier a ete modifie.
- `backlog_added` : findings classes BACKLOG qui ont ete ajoutes a `backlog.md`.
- `escalated` : findings reellement ambigus, remontes au mainteneur. Liste
  vide si aucun.
- `notes` : observations consolidees des sub-agents `fix-file` / `backlog-fix`
  (leurs `notes[]` sont aggregees + dedupliquees ici pour qu'un reviewer
  humain voie l'ensemble des call-sites hors scope, impacts cross-ref non
  resolus, sans ouvrir chaque sortie de sub-agent). Utilise par
  `loop-clean.sh commit-iter` pour enrichir le message de commit.

Chaque entree reference le finding par son `id` (depuis le JSON d'origine
senior-review, dedup-codebase ou spec-drift). Pour un finding spec-drift,
utiliser l'id synthetique defini par spec-drift.ts (`sha256("spec-drift|" +
name + "|" + spec_file + "|" + src_file).slice(0,16)`).

### Interaction avec la boucle loop-clean

- Si `fix_now_applied` et `backlog_added` sont tous deux vides a l'iteration N,
  et que total_findings a l'iteration N+1 vaut 0, `loop-clean.sh decide N+1`
  declenche `EXIT_CLEAN`.
- Si les memes finding_ids reviennent a l'iteration suivante (hash identique),
  c'est une oscillation et la boucle exit.
