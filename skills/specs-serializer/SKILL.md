---
name: specs-serializer
description: Ajoute OU répare le frontmatter YAML des specs markdown normatives pour qu'il passe le schéma du repo-indexer. Idempotent et safe à relancer. Use when the user says "serialize specs", "sérialise les specs", "ajoute les frontmatter", "répare les frontmatter", "frontmatter specs", "specs-serializer", or any variant requesting to add or fix YAML frontmatter on spec files. Also trigger when repo-indexer reports missing OR invalid frontmatter on spec files.
---

# Specs Serializer

Ajouter un frontmatter YAML standardisé aux fichiers spec markdown normatifs d'un projet.

## Workflow

### 1. Découvrir les fichiers spec

Glob ces patterns dans le projet courant :
- `docs/**/*.md`
- `specs/**/*.md`
- `*.spec.md`

### 2. Trier chaque fichier

Pour chaque fichier trouvé, lire le contenu et classifier en probant le frontmatter avec le même schéma que le scanner (`SpecFrontmatterSchema` dans `~/.claude/scripts/index-repo/src/lib/types.ts`) :

| Cas | Action |
|-----|--------|
| Frontmatter valide (passe le schéma zod complet) | **SKIP** — déjà conforme |
| Bloc `---...---` présent mais invalide (champ hors enum, type faux, requis manquant) | → **REPAIR** (step 2b) |
| Pas de bloc `---...---` | → **CREATE** (steps 3–6) |

### 2b. Réparer un frontmatter invalide

But : transformer un bloc existant pour qu'il passe `SpecFrontmatterSchema`, sans perdre l'information. **Ne pas** réécrire le fichier entier — modifier uniquement les lignes du bloc frontmatter.

Pour chaque erreur de validation remontée par le schéma :

1. **`status` hors enum** (`draft | approved | deprecated`) → mapper :
   - `active`, `stable`, `released`, `published`, `final` → `approved`
   - `wip`, `in-progress`, `in_progress`, `proposed`, `rfc` → `draft`
   - `obsolete`, `superseded`, `archived`, `removed` → `deprecated`
   - valeur inconnue → `draft` (safe default)
2. **`version` manquant** → ajouter `version: "0.1.0"`
3. **`version` sous forme de number** (ex: `version: 1`) → la citer (`version: "1"`) — le schéma accepte number mais normaliser en string améliore la cohérence
4. **`id` manquant** → générer depuis le path (voir step 4) et l'ajouter en tête du bloc
5. **`depends_on` / `validates` en forme non-array** (string scalaire) → convertir en array inline `[]`
6. **Champ inconnu qui ressemble à un standard** (ex: `dependencies` au lieu de `depends_on`, `tests` au lieu de `validates`) → renommer uniquement si le mapping est non-ambigu
7. **Champs custom non reconnus** (ex: `consumers`, `superseded_by`, `referenced_by`, `type`, `dependency_version`) → **LAISSER INTACTS**. Le schéma les ignore silencieusement, ils n'empêchent pas la validation.

Après réparation, re-probe le bloc. Si toujours invalide → **WARNING** et lister les erreurs résiduelles, ne pas commit de réparation partielle.

### 3. Décider si le contenu est normatif

- **Normatif** = prescrit des règles, comportements, contrats, specs à implémenter, architecture obligatoire, interfaces, protocoles
- **Non-normatif** = informatif pur (guide, README, note, journal, changelog, tutorial, documentation utilisateur)

Si non-normatif → **SKIP** et log la raison.

### 4. Générer l'ID depuis le path

1. Retirer `.md`
2. Retirer le suffix `.spec` si présent
3. Retirer le préfixe répertoire connu (`docs/`, `specs/`)
4. Remplacer `/` par `-`
5. UPPER-CASE
6. Préfixer `SPEC-`

```
specs/auth-flow.md      → SPEC-AUTH-FLOW
docs/api/endpoints.md   → SPEC-API-ENDPOINTS
payment.spec.md         → SPEC-PAYMENT
docs/sub/deep/file.md   → SPEC-SUB-DEEP-FILE
```

### 5. Détecter les collisions d'ID

Collecter tous les IDs existants (fichiers déjà sérialisés au step 2). Si l'ID généré est déjà pris → suffixer `-2`, `-3`, etc.

### 6. Prépend le frontmatter

Utiliser Edit pour ajouter en tête du fichier :

```yaml
---
id: SPEC-AUTH-FLOW
version: "0.1.0"
scope: <texte du premier heading du fichier, ou omis si absent>
status: draft
---
```

- `depends_on` et `validates` : **ne pas inclure** (pas devinables, enrichissement manuel)
- `status: draft` : signale "auto-généré, à valider"
- `version: "0.1.0"` : SemVer 3 segments, toujours entre guillemets (string, pas number)

### 7. Résumé final

Afficher un tableau récapitulatif :

```
## Résultat specs-serializer

| Fichier | Action | ID |
|---------|--------|----|
| docs/auth.md | ✅ Créé | SPEC-AUTH |
| specs/flow.md | 🔧 Réparé (status: active → approved) | SPEC-FLOW |
| docs/guide.md | ⏭️ Non-normatif | — |
| specs/api.md | ⏭️ Déjà conforme | SPEC-API |
| docs/notes.md | ⚠️ Réparation incomplète — erreurs : ... | — |
```

## Règles

- **Idempotence** : ne toucher que les fichiers dont le frontmatter est absent ou invalide. Sur un repo déjà conforme, relancer ne change rien.
- **Réparation minimale** : au step 2b, ne modifier que les lignes du bloc frontmatter qui empêchent la validation. Jamais réécrire le fichier entier, jamais toucher le body.
- **Préserver les champs custom** : les clés inconnues du schéma (ex: `consumers`, `superseded_by`, `type`) ne bloquent pas la validation — les laisser intactes.
- **Pas de création de fichier** : modifier uniquement des fichiers existants.
- **Si aucun fichier spec trouvé** : le dire et terminer.
- **Si tous déjà conformes** : le dire et terminer.

## Référence

- Patterns specs : `AXIS_PATTERNS.specs` dans `~/.claude/scripts/index-repo/src/lib/constants.ts`
- Schema frontmatter : `SpecFrontmatterSchema` dans `~/.claude/scripts/index-repo/src/lib/types.ts` (id + version requis, scope/status/depends_on/validates optionnels)
