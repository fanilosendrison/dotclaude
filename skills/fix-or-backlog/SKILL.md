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
6. **Router les items BACKLOG selon leur severite** (routage normatif, pas optionnel) :

   - Si `severity` ∈ {`critical`, `major`, `notable`, `minor`, `nit`} → appender dans `backlog.md` avec le format standard (cf. section **Backlog file**). Dedup par `file:line — desc[0:40]` ou par `drift_id:` pour les findings spec-drift.
   - Si `severity` == `design` → appender dans `design-queue.md` avec le format natif design (cf. section **Design-queue file**). Dedup par `design_id:`. **Ne JAMAIS** ecrire un item `design` dans `backlog.md`.

   Le JSON d'emission (cf. section **Emission JSON**) doit refleter le split via deux champs distincts : `backlog_added[]` (severites auto-fixables) et `design_queue_added[]` (severite `design`).
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

## Deux files distinctes : `backlog.md` et `design-queue.md`

Le skill maintient deux files a la racine du repo avec des roles orthogonaux :

- **`backlog.md`** — items auto-fixables. Tout item ici est suppose etre traitable par `backlog-fix` (re-discovery + fix atomique + verification observable). Severites : `critical`, `major`, `notable`, `minor`, `nit`.
- **`design-queue.md`** — items qui exigent un arbitrage humain. Ces items ne sont jamais traites par `backlog-fix`. Severite : `design`. Alimentee aussi par l'escalade automatique des items `backlog.md` qui ont ete skippes 2x (cf. `backlog-crush.sh escalate-stuck`).

### Routage par severite

Dans la phase 6 de la procedure (ajout BACKLOG) :

- Si `severity` ∈ {`critical`, `major`, `notable`, `minor`, `nit`} → ajouter a `backlog.md` avec le format standard ou le format `spec-drift[...]`.
- Si `severity` == `design` → ajouter a `design-queue.md` (voir format ci-dessous).

Un item avec `severity: design` n'entre **jamais** dans le flux auto-fix — il attend une decision humaine.

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
- Format de chaque item (findings senior-review et dedup-codebase) :

```markdown
- [ ] [SEVERITE] Fichier:ligne — Description courte du finding (date: YYYY-MM-DD, source: review de [nom de la tache/PR])
```

### Granularite — regle normative

**Un finding = une ligne backlog. Jamais de consolidation.**

Si plusieurs findings touchent le meme fichier ou le meme concept, ils
restent des lignes separees dans `backlog.md`. Consolider (ex: "19 derives
sur src/types.ts" au lieu de 19 lignes) casse le workflow `backlog-fix` :
le sub-agent est concu pour traiter 1 item atomique par cycle, il skip
systematiquement les meta-items.

Anti-pattern a eviter explicitement :

```markdown
# ❌ JAMAIS — meta-item consolide
- [ ] [major] src/types.ts — 19 derives spec-drift : ProviderBinding sans provider, parseResponse signature, readonly vs mutable, ...

# ✅ TOUJOURS — 1 line par drift/finding
- [ ] [notable] spec-drift[ProviderBinding] — src/bindings/types.ts:52 <-> specs/NIB-S-LLMRUNTIME.md:530 — 'provider' missing (drift_id: 88ed555f)
- [ ] [notable] spec-drift[ParsedProviderResponse] — src/bindings/types.ts:18 <-> specs/NIB-S-LLMRUNTIME.md:473 — signature divergence (drift_id: a1b2c3d4)
- [ ] [notable] spec-drift[AdapterConfig] — src/types.ts:276 <-> specs/NIB-S-LLMRUNTIME.md:347 — retry optional vs required (drift_id: e5f6g7h8)
```

### Format specifique pour les findings spec-drift

Le skill `spec-drift` emet un JSON dont chaque entree `drift[]` contient
`id` (sha256 synthetique stable), `name` (type TypeScript), `spec_file`,
`spec_line`, `src_file`, `detail` (message tsc tronque). Une ligne backlog
par entree `drift[]`, au format :

```markdown
- [ ] [severite] spec-drift[TypeName] — src_file:src_line_or_? <-> spec_file:spec_line — <detail_court_1_ligne> (date: YYYY-MM-DD, drift_id: <id 16 chars>)
```

Regles :

- Severite par defaut : `notable` (drift de types = correctness, pas critical).
- `detail_court` : premiere ligne utile du `detail` tsc, troncature ≤ 120 chars.
- `drift_id` : copier-coller depuis le JSON (champ `id`), 16 chars.
- **Ne jamais lire `checked_count`** pour compter les drifts dans un resume :
  `checked_count` = total types verifies (OK + DRIFT). Utiliser
  `drift.length` ou filtrer `status === "DRIFT"`.

### Dedup pratique

Avant chaque append, executer le check dedup **uniquement contre les items
non coches `- [ ]`**. Un `[x]` signifie que l'item a ete traite dans un
run passe ; si le probleme re-apparait (regression), il merite une
nouvelle ligne avec date recente — ne pas masquer sous pretexte que la
cle match un historique `[x]`.

Deux strategies de dedup selon le type de finding :

**Findings senior-review et dedup-codebase** — cle : `file:line — desc[0:40]`

```bash
key="src/foo.ts:42 — extractBlocks ignores CRLF line "
if ! grep -E "^- \[ \]" backlog.md 2>/dev/null | grep -qF "$key"; then
    echo "- [ ] [notable] src/foo.ts:42 — extractBlocks ignores CRLF line endings (date: 2026-04-17, source: senior-review)" >> backlog.md
fi
```

**Findings spec-drift** — cle : `drift_id:` (exact, stable cross-session)

```bash
# Le drift_id est unique pour (name, spec_file, src_file) — collision impossible
# entre drifts distincts, meme si 19 drifts touchent tous src/types.ts.
drift_id="88ed555f52e1e1c4"
if ! grep -E "^- \[ \]" backlog.md 2>/dev/null | grep -qF "drift_id: $drift_id"; then
    echo "- [ ] [notable] spec-drift[EmbeddingBinding] — src/bindings/types.ts:? <-> specs/NIB-M-BINDING-EMBEDDING.md:40 — 'provider' is missing in type (date: 2026-04-18, drift_id: $drift_id)" >> backlog.md
fi
```

Le skill applique ces regles pour chaque item a ajouter — pas de doublons
entre sessions, mais les regressions restent visibles.

## Design-queue file

Le fichier est a `design-queue.md` a la racine du repo.

- Si le fichier n'existe pas, le creer avec un header et une section explicative.
- Header minimum :

```markdown
# Design queue

Items qui necessitent un arbitrage humain avant d'etre traduits en fix atomique. Ces items ne sont **pas** traites par `/backlog-crush` ou `/backlog-deep-crush`.

Deux origines :

1. **Findings natifs design** : severite `design` emise par senior-review quand l'auteur ne peut pas formuler d'`observable_change` credible (trade-off ergonomie/strictness, choix semver, clarification NIB, scope cross-cutting).
2. **Escalades auto depuis backlog** : items de `backlog.md` atteints par `skipped 2x` et migres automatiquement par `backlog-crush.sh escalate-stuck` ou `backlog-deep-crush.sh escalate-stuck` au moment d'`EXIT_STABLE`.

Quand un item est resolu (decision prise + implementation si applicable), le cocher `[x]` comme dans `backlog.md`. La dedup cross-session fonctionne par `design_id` (natif) ou `origin_id` (escalade).
```

### Format d'item (finding natif `design`)

```markdown
- [ ] [design] <file>:<line> — <problem> (date: YYYY-MM-DD, source: /senior-review iter-N, design_id: <16 hex>)
  - **FIX propose** : <fix_proposal>
  - **Pourquoi design** : <ce qui empeche la formulation d'observable_change — trade-off, choix semver, spec ambigue, scope>
  - **Decision requise** : <question precise a trancher>
```

### Format d'item (escalade depuis backlog)

```markdown
- [ ] [escalated] <file>:<line> — <problem_original> (date_first_seen: YYYY-MM-DD, date_escalated: YYYY-MM-DD, origin_severity: <critical|major|notable|minor|nit>, origin_id: <id ou "n/a">, skipped_count: N)
  - **Fix original propose** : <fix_proposal_original>
  - **Raison du skip recurrent** : <reason du dernier skip de backlog-fix>
  - **Decision requise** : <question deduite — souvent "valider scope" ou "accepter breaking change" ou "arbitrer spec vs code">
```

### Dedup design-queue

- Items natifs : dedup sur `design_id:` (stable si le finding revient avec meme (source, axis, file, problem)).
- Escalades : dedup sur `origin_id:` si present, sinon sur `file:line — problem_original[0:40]`.

Ne jamais supprimer un `[x]` pour regression — ajouter une nouvelle ligne comme pour `backlog.md`.

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
  "design_queue_added": [
    {
      "finding_id": "string",
      "file": "string",
      "reason_why_design": "string (pourquoi observable_change n'a pas pu etre formule)"
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
- `backlog_added` : findings `critical|major|notable|minor|nit` ajoutes a `backlog.md`. **Ne contient JAMAIS** de severite `design`.
- `design_queue_added` : findings `severity == "design"` ajoutes a `design-queue.md`. File humaine — aucun traitement auto en aval.
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

- Si `fix_now_applied`, `backlog_added` et `design_queue_added` sont tous vides a l'iteration N,
  et que total_findings a l'iteration N+1 vaut 0, `loop-clean.sh decide N+1`
  declenche `EXIT_CLEAN`.
- Si les memes finding_ids reviennent a l'iteration suivante (hash identique),
  c'est une oscillation et la boucle exit.
