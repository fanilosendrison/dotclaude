# spec-drift — Détecte le drift entre types déclarés dans les specs et exports du code

## Usage

Étape 3 du workflow post-implémentation global. Skip silencieux si le projet
n'est pas spec-driven (pas de `specs/` ou pas de `src/` dans le cwd).

```bash
# Défaut : lit <cwd>/specs et <cwd>/src
node --experimental-strip-types ~/.claude/scripts/spec-drift/src/spec-drift.ts

# Override des paths
node --experimental-strip-types ~/.claude/scripts/spec-drift/src/spec-drift.ts \
  --specs-dir ./docs/specs --src-dir ./packages/core/src

# Afficher les types spec sans équivalent dans src/ (informationnel)
node --experimental-strip-types ~/.claude/scripts/spec-drift/src/spec-drift.ts --show-missing

# Émettre un rapport JSON machine-readable (pour loop-clean ou CI)
node --experimental-strip-types ~/.claude/scripts/spec-drift/src/spec-drift.ts \
  --json /tmp/spec-drift.json

# Masquer des drifts intentionnels via un ignore file (défaut <cwd>/.spec-drift-ignore)
node --experimental-strip-types ~/.claude/scripts/spec-drift/src/spec-drift.ts \
  --ignore-file ./config/spec-drift-ignore
```

### Flag `--json <path>`

Écrit un rapport structuré au chemin donné en plus du rapport console.
Le schéma :

```json
{
  "skill": "spec-drift",
  "exit_code": 0,
  "checked_count": 42,
  "drift": [
    {
      "id": "a1b2c3d4e5f60718",
      "name": "Heading",
      "spec_file": "specs/Phase_D.md",
      "spec_line": 128,
      "src_file": "src/types/heading.ts",
      "detail": "Property 'level' is missing in type...",
      "hints": {
        "normative_language": ["MUST", "obligatoire"],
        "api_surface": true,
        "cross_spec_files": ["NIB-M-X.md"]
      },
      "direction": "block",
      "direction_reason": "normative keywords near drift site: MUST, obligatoire; type exposed on public surface (src/index.ts); type declared in other specs: NIB-M-X.md"
    }
  ],
  "ignored_count": 1,
  "ignored": [
    {
      "id": "b2c3d4e5f6071889",
      "name": "LLMRequest",
      "spec_file": "specs/NIB-S.md",
      "spec_line": 257,
      "src_file": "src/types.ts",
      "reason": "I-11: readonly override in code, spec YAML imprécise"
    }
  ],
  "missing_count": 3
}
```

Le champ `id` est un hash synthétique stable :
`sha256("spec-drift|" + name + "|" + spec_file + "|" + src_file).slice(0,16)`.
Il permet à `loop-clean.sh` de détecter l'oscillation entre itérations.

### Champs `hints` + `direction` (anti-dérive spec↔code)

Chaque entrée `drift[]` inclut trois signaux déterministes calculés sur le
contenu du repo au moment du scan, plus une synthèse `direction` que les
consumers (fix-or-backlog) DOIVENT respecter.

**`hints.normative_language`** : liste des mots-clés normatifs trouvés dans
une fenêtre de ±10 lignes autour de `spec_line`. Patterns scannés :

- RFC 2119 majuscules : `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `REQUIRED`
- Français majuscules : `DOIT`, `DOIT PAS`, `NE DOIT PAS`, `DOIVENT`
- Français case-insensitive : `obligatoire(s)`, `requis(e)(s)`, `explicitement`

Liste non-vide = la spec assène une règle normative à proximité immédiate du
drift. Aligner spec au code reviendrait à relaxer cette règle — le skill
consumer DOIT router vers `design-queue.md` au lieu de `backlog.md`.

**`hints.api_surface`** : `true` si le type drifté est exporté depuis
`src/index.ts` (directement défini là, ou réexporté via `export { X }`,
`export type { X }`, `export * from './m.js'`, `export type * from './m.js'`).
La détection est 1-hop (pas de transitif). `true` = toute modif = breaking
change = nouveau NIB requis, pas un item backlog.

**`hints.cross_spec_files`** : paths relatifs des autres specs qui déclarent
le même `name` dans un bloc ```typescript```. Non-vide = aligner un seul côté
du drift crée une incohérence cross-spec — exiger un arbitrage humain.

**`direction`** : dérivé déterministiquement des hints.
- `"block"` : au moins un signal bloquant (≥1 hint non-vide). Consumer DOIT
  router en design-queue, jamais en auto-fix.
- `"ambiguous"` : aucun signal bloquant. Consumer peut procéder au flux
  standard (backlog notable + fix) mais doit classifier explicitement la
  direction du fix dans le commit message (`[code→spec]` vs
  `[spec→code:completion]`).

**`direction_reason`** : concaténation human-readable des signaux
déclenchant le block, séparés par `; `. Utilisable tel quel dans
`reason_why_design` lors du routage en design-queue.

Le fichier est écrit même en cas de skip silencieux (pas de `specs/` ou
`src/`) : dans ce cas `checked_count=0`, `drift=[]`, `ignored=[]`, `exit_code=0`.

**`drift.length` ≠ `checked_count`** : `drift.length` compte les divergences
réelles ; `checked_count` compte tous les types vérifiés (OK + DRIFT + IGNORED).
Un consumer qui affiche un résumé ("N drifts") doit lire `drift.length`, jamais
`checked_count`.

### Flag `--ignore-file <path>`

Pointe vers un fichier `.spec-drift-ignore` qui masque des drifts **intentionnels**
— cas où le code est délibérément plus strict que la spec YAML (ex: `readonly[]`
via un invariant normatif, discriminated union vs union plate pour sûreté de type).

Défaut : `<cwd>/.spec-drift-ignore`. Fichier absent = aucun ignore. Format :

```
# Commentaire — lignes vides et lignes commençant par # ignorées
TypeName @ spec_file_relative_path # Justification OBLIGATOIRE (cite un invariant)

# Exemples pour un projet spec-driven
LLMRequest @ specs/NIB-S-LLMRUNTIME.md # I-11: readonly override, spec YAML imprécise
LLMMessage @ specs/NIB-S-LLMRUNTIME.md # I-11: readonly arrays override
```

Règles :

- La justification après `#` est **obligatoire** et non vide. Sinon `throw`.
- Doit citer un invariant NIB, un DC, ou une décision produit documentée.
- Le matching se fait sur `(TypeName, spec_file_relative_path)` — exact, case-sensitive.
- Les entrées matchées sont déplacées de `drift[]` vers `ignored[]` dans le JSON,
  avec la `reason` préservée pour traçabilité.
- **Les IGNORED ne contribuent PAS à l'exit code** : exit 0 même s'il y a des
  IGNORED, du moment qu'il n'y a plus de `drift[]` non masqué.

Pourquoi c'est utile : sans ce mécanisme, un drift intentionnel revient à chaque
itération de `/loop-clean` et trigger oscillation ou re-backlog — le skill
consumer n'a pas moyen de distinguer "drift intentionnel" de "drift à résoudre".

## Flow

1. Parse args : `--specs-dir`, `--src-dir`, `--show-missing`, `--json`, `--ignore-file`. Défauts : `<cwd>/specs`, `<cwd>/src`, `<cwd>/.spec-drift-ignore`.
2. Si un des deux dossiers absent → exit 0 silencieux avec notice "not a spec-driven project".
3. Walk `src/` récursif, indexe tout `export interface`/`export type` → Map<nom, file>.
4. Pour chaque `specs/*.md`, extrait les blocs ```typescript``` (sauf ceux marqués `// spec-only`) et renomme chaque type avec un préfixe unique `B0001_`, `B0002_`, ... pour éviter les collisions entre specs.
5. Génère un fichier temporaire d'assertions bidirectionnelles : pour chaque type `Foo` déclaré dans une spec ET exporté dans `src/`, écrit `const _a: Spec_B0001_Foo = {} as Actual_B0001_Foo;` et l'inverse.
6. Lance `ts.createProgram` en mode strict sur le fichier temporaire ; les diagnostics mentionnant un préfixe unique classent le type correspondant comme DRIFT.
7. Parse `.spec-drift-ignore` (si présent) → pour chaque entrée, déplace le DRIFT matching vers status IGNORED avec la `reason` attachée.
8. Imprime un rapport : `N OK, M DRIFT, K IGNORED`, puis liste les drifts (puis les ignored) avec le message tsc tronqué à 8 lignes.
9. Pour chaque DRIFT restant (non IGNORED), calcule `hints` (normative language ±10 lignes, api surface via `src/index.ts`, cross-spec via grep des autres `specs/*.md`) puis dérive `direction` ∈ {`block`, `ambiguous`}. Les champs sont sérialisés dans le rapport JSON.
10. Nettoie le fichier temporaire (best-effort).

## Invariants

- Exit `0` = pas de drift (ou projet non spec-driven, ou tous les drifts sont masqués par `.spec-drift-ignore`) ; exit `1` = drift non-masqué détecté.
- Idempotent : aucune écriture dans le projet, seulement un fichier dans `tmpdir()` supprimé en fin d'exécution.
- Cwd-agnostic : tout chemin est résolu depuis `process.cwd()` ou args absolus.
- Les blocs ```typescript``` contenant `// spec-only` sont ignorés (types qui n'existent volontairement pas dans `src/`).
- Types déclarés dans les specs mais absents de `src/` → classés MISSING (silencieux sauf `--show-missing`), pas bloquant.
- `.spec-drift-ignore` parsing est **strict** : toute ligne non-blanche/non-comment doit respecter `TypeName @ spec_file # reason` avec une reason non-vide. Sinon le script throw (fail-closed sur un fichier mal formé plutôt que skip silencieusement).

## Output

- Stdout : `Spec drift report: N OK, M DRIFT[, K IGNORED][, L MISSING_IN_CODE]` + sections `=== DRIFT ===`, `=== IGNORED (masked by .spec-drift-ignore) ===` et optionnellement `=== MISSING IN CODE ===`.
- Stderr : réservé aux erreurs d'exécution.
- Exit code : `0` = clean, skip, ou tous drifts masqués ; `1` = drift non-masqué détecté.
