---
name: dedup-codebase
description: >
  Audit de duplication de code, dead code et taille de fichiers sur la codebase.
  Lance des sub-agents parallèles par fichier source pour détecter les
  duplications intra et inter-fichiers, le dead code (fonctions/variables/
  exports/imports inutilisés), vérifier la taille des fichiers, et proposer
  des refactors concrets (extraction, découpage, suppression, création de
  fichiers). Use when the user says "dedup", "duplication", "dedup-codebase",
  "code dupliqué", "dead code", "code mort", "fichiers trop gros",
  "refactor duplication", "audit dedup", "cleanup codebase",
  or any variant requesting a duplication, dead code, or file size audit.
---

# Dedup Codebase

Audit structurel de la codebase : duplication de code, dead code, taille de fichiers.
Produit un rapport actionnable avec des propositions de refactor concrètes.

## Paramètres

| Param | Default | Description |
|-------|---------|-------------|
| `path` | `src/` | Répertoire à auditer |
| `extensions` | `*.ts` | Glob des fichiers à inclure |
| `max_lines` | `400` | Seuil de lignes au-delà duquel un fichier doit être découpé |
| `min_dup_lines` | `5` | Nombre minimum de lignes similaires pour signaler une duplication |

L'utilisateur peut override via `/dedup-codebase src/ --max-lines 300`.

## Procédure

### Phase 1 — Inventaire

1. Lister tous les fichiers source via `Glob` sur `{path}/**/{extensions}`.
2. Compter les lignes de chaque fichier (`wc -l` via Bash, tous en parallèle).
3. Classer les fichiers en deux buckets :
   - **OVERSIZED** : > `max_lines` lignes
   - **OK** : ≤ `max_lines` lignes

### Phase 2 — Analyse intra-fichier (sub-agents parallèles)

Lancer **un sub-agent par fichier**, tous en parallèle, via :

```
Agent({
  subagent_type: "dedup-intra",
  description: "Dedup intra {basename}",
  prompt: "Analyse le fichier {file_path}. Seuil min_dup_lines = {min_dup_lines}."
})
```

Le sub-agent `dedup-intra` a son model (**Haiku**), ses outils, et sa méthodologie complète définis dans son frontmatter + system prompt (`~/.claude/agents/dedup-intra.md`). Le skill n'a plus à les répéter ici.

### Phase 3 — Analyse inter-fichiers (sub-agents parallèles)

**3a. Compter les fichiers à analyser** via `Glob {path}/**/{extensions}`.

**3b. Si ≤ 50 fichiers** : lancer **un seul** sub-agent `dedup-inter` sur tout `{path}` (comportement historique) :

```
Agent({
  subagent_type: "dedup-inter",
  description: "Dedup inter-files {path}",
  prompt: "Analyse la duplication de code entre fichiers dans {path}. Extensions : {extensions}. Seuil min_dup_lines = {min_dup_lines}."
})
```

**3c. Si > 50 fichiers** : partitionner par sous-répertoire de premier niveau sous `{path}`, et lancer **un sub-agent `dedup-inter` par partition en parallèle** :

- Énumérer les sous-répertoires directs de `{path}` via `Glob {path}/*/`.
- Pour chaque sous-répertoire `{sub}` qui contient ≥2 fichiers source : lancer un `dedup-inter` avec `path = {path}/{sub}`.
- Les fichiers directement sous `{path}` (hors sous-répertoires) forment une partition "root" qui reçoit son propre agent si elle contient ≥2 fichiers.

**3d. Passe cross-partition** (uniquement si >1 partition a été lancée) : lancer un **sub-agent `dedup-inter` supplémentaire** avec un prompt dédié :

```
Agent({
  subagent_type: "dedup-inter",
  description: "Dedup inter-files cross-partition",
  prompt: "Cross-partition pass. Les sous-répertoires {sub1, sub2, ...} ont été analysés séparément. Ta tâche : détecter les duplications ENTRE partitions (ex: même utilitaire implémenté dans {sub1}/utils.ts ET {sub2}/helpers.ts). Grep les top exports (fonctions, types, constantes publiques) de chaque partition et cherche les patterns dupliqués. Seuil min_dup_lines = {min_dup_lines}."
})
```

Cette passe est volontairement plus légère (patterns + top exports, pas chaque bloc de code) pour compenser le coût des N+1 agents.

Le sub-agent `dedup-inter` a son model (**Sonnet**), ses outils, et sa méthodologie complète définis dans son frontmatter + system prompt (`~/.claude/agents/dedup-inter.md`).

### Phase 4 — Propositions de découpage (fichiers oversized)

Pour chaque fichier OVERSIZED, proposer un plan de découpage :
- Identifier les responsabilités distinctes dans le fichier
- Proposer les fichiers cibles avec leur contenu attendu
- Lister les imports/exports à ajuster
- Estimer le nombre de lignes par fichier résultant

### Phase 5 — Rapport consolidé

Produire le rapport au format ci-dessous. Ne pas modifier de fichier.

## Format de sortie

```markdown
# Audit Dedup — {path}

**Date** : {date}
**Fichiers analysés** : {count}
**Seuil taille** : {max_lines} lignes

---

## Fichiers oversized

| Fichier | Lignes | Δ vs seuil |
|---------|--------|------------|
| {file} | {lines} | +{delta} |

### Découpage proposé : {file}

**Responsabilités identifiées** :
1. {responsabilité} (L{start}-L{end}, ~{n} lignes)
2. ...

**Fichiers cibles** :
- `{new_file_1}.ts` — {description} (~{n} lignes)
- `{new_file_2}.ts` — {description} (~{n} lignes)

**Imports à ajuster** : {liste des fichiers qui importent depuis {file}}

---

## Duplications intra-fichier

### {file}
- **L{start1}-L{end1} ↔ L{start2}-L{end2}** — {description}
  → Refactor : {proposition}

---

## Duplications inter-fichiers

### {file_a} ↔ {file_b}
- **{file_a}:L{range} ↔ {file_b}:L{range}** — {description}
  → Refactor : {proposition} → extraire dans `{target_file}`

---

## Dead code

### {file}
- **L{start}-L{end}** — {type: fonction/variable/import/export/code commenté} `{name}` — {raison: jamais appelé / jamais importé / inatteignable}
  → Supprimer

---

## Résumé

| Métrique | Valeur |
|----------|--------|
| Fichiers oversized | {n} |
| Duplications intra | {n} |
| Duplications inter | {n} |
| Dead code | {n} |
| Refactors proposés | {n} |
```

## Contraintes

- **Read-only** : ne modifier aucun fichier. Le skill produit uniquement un rapport.
- **Parallélisme maximal** : phases 2 et 3 lancées en parallèle. Sub-agents intra lancés tous en parallèle.
- **Models déterministes via agents dédiés** :
  - Phase 2 → `subagent_type: "dedup-intra"` (model Haiku codé dans le frontmatter de l'agent)
  - Phase 3 → `subagent_type: "dedup-inter"` (model Sonnet codé dans le frontmatter de l'agent)
  - Ne PAS passer de `model` override dans l'appel `Agent(...)` — laisser le frontmatter des agents décider. C'est ce qui rend le skill déterministe : le choix de model n'est pas laissé au jugement de l'orchestrateur.
  - Dépendance : les agents `dedup-intra` et `dedup-inter` doivent exister dans `~/.claude/agents/` (ou `.claude/agents/` du repo pour l'env cloud).
- **Pas de faux positifs sur les patterns légitimes** : ignorer les duplications qui sont structurellement nécessaires (ex: switch/case avec branches similaires, overloads de types).
- **Respecter le CLAUDE.md du projet** : si le projet a une structure flat by design (1 fichier = 1 phase), le signaler dans les propositions de découpage au lieu de proposer un découpage qui casserait la convention.

---

## Émission JSON (orchestration loop-clean)

Le skill produit toujours le rapport humain ci-dessus. En complément, si la
variable d'environnement `LOOP_CLEAN_JSON_OUT` est définie, écrire également
un JSON structuré au chemin indiqué. Si la variable n'est pas définie,
ne rien écrire (invocation standalone, comportement inchangé).

### Schéma

```json
{
  "skill": "dedup-codebase",
  "verdict": "CLEAN" | "ISSUES_FOUND",
  "findings": [
    {
      "id": "string (16 hex chars)",
      "source": "dedup-codebase",
      "axis": "duplication-intra" | "duplication-inter" | "dead-code" | "oversized-file",
      "severity": "critical" | "major" | "notable" | "minor" | "nit",
      "file": "string (chemin relatif repo)",
      "line_start": number | null,
      "line_end": number | null,
      "problem": "string",
      "evidence": "string",
      "fix_proposal": "string"
    }
  ],
  "summary": {
    "critical": number, "major": number, "notable": number,
    "minor": number, "nit": number
  },
  "blocking": boolean
}
```

### Normalisation des catégories en Finding

| Catégorie du rapport humain | Valeur de `axis`   | `severity` par défaut |
|------------------------------|--------------------|-----------------------|
| Duplication intra-fichier    | `duplication-intra`| `notable`             |
| Duplication inter-fichiers   | `duplication-inter`| `notable`             |
| Dead code                    | `dead-code`        | `minor`               |
| Fichier oversized            | `oversized-file`   | `notable`             |

Pour duplication inter-fichiers, `file` = le fichier cible principal
(la « source » de vérité ou le premier fichier dans l'ordre alphabétique),
et `evidence` cite les autres fichiers impliqués.

Pour oversized-file, `line_start = 1`, `line_end = nombre total de lignes`.

`blocking` = `false` par défaut (dedup ne bloque pas sauf cas `critical`/`major`
explicite — rare).

### Formule canonique de `id`

```
id = sha256([source, file, String(line_start ?? ""), axis, problem.slice(0,80)].join("|")).slice(0,16)
```

Le séparateur `|` est obligatoire. Le hash doit être stable d'une invocation
à l'autre — condition nécessaire pour la détection d'oscillation par
`loop-clean.sh`.

### Directive de stabilité du `problem`

Pour un finding donné, la chaîne `problem` doit être formulée à l'identique
d'une invocation à l'autre — pas de reformulation stylistique entre itérations.
Format canonique : `{sujet} {verbe} {objet concret}`, phrase affirmative,
sans modalité ("peut", "pourrait"), pas de timestamp, pas de numéro d'itération.

Exemples stables :
- `normalize-headings.ts duplicates levelFromDepth logic with promote-d1.ts`
- `buildAssertionFile exports unused after refactor`
- `spec-drift.ts exceeds max_lines (420 > 400)`

### Emplacement d'écriture

Le LLM produit le JSON via l'outil `Write` directement sur le chemin donné
par `LOOP_CLEAN_JSON_OUT`. Le fichier doit être valide JSON (parseable par
`jq`).
