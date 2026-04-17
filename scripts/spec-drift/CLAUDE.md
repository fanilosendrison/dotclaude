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
      "detail": "Property 'level' is missing in type..."
    }
  ],
  "missing_count": 3
}
```

Le champ `id` est un hash synthétique stable :
`sha256("spec-drift|" + name + "|" + spec_file + "|" + src_file).slice(0,16)`.
Il permet à `loop-clean.sh` de détecter l'oscillation entre itérations.

Le fichier est écrit même en cas de skip silencieux (pas de `specs/` ou
`src/`) : dans ce cas `checked_count=0`, `drift=[]`, `exit_code=0`.

## Flow

1. Parse args : `--specs-dir`, `--src-dir`, `--show-missing`. Défauts : `<cwd>/specs` et `<cwd>/src`.
2. Si un des deux dossiers absent → exit 0 silencieux avec notice "not a spec-driven project".
3. Walk `src/` récursif, indexe tout `export interface`/`export type` → Map<nom, file>.
4. Pour chaque `specs/*.md`, extrait les blocs ```typescript``` (sauf ceux marqués `// spec-only`) et renomme chaque type avec un préfixe unique `B0001_`, `B0002_`, ... pour éviter les collisions entre specs.
5. Génère un fichier temporaire d'assertions bidirectionnelles : pour chaque type `Foo` déclaré dans une spec ET exporté dans `src/`, écrit `const _a: Spec_B0001_Foo = {} as Actual_B0001_Foo;` et l'inverse.
6. Lance `ts.createProgram` en mode strict sur le fichier temporaire ; les diagnostics mentionnant un préfixe unique classent le type correspondant comme DRIFT.
7. Imprime un rapport : `N OK, M DRIFT`, puis liste les drifts avec le message tsc tronqué à 8 lignes.
8. Nettoie le fichier temporaire (best-effort).

## Invariants

- Exit `0` = pas de drift (ou projet non spec-driven) ; exit `1` = drift détecté.
- Idempotent : aucune écriture dans le projet, seulement un fichier dans `tmpdir()` supprimé en fin d'exécution.
- Cwd-agnostic : tout chemin est résolu depuis `process.cwd()` ou args absolus.
- Les blocs ```typescript``` contenant `// spec-only` sont ignorés (types qui n'existent volontairement pas dans `src/`).
- Types déclarés dans les specs mais absents de `src/` → classés MISSING (silencieux sauf `--show-missing`), pas bloquant.

## Output

- Stdout : `Spec drift report: N OK, M DRIFT` + sections `=== DRIFT ===` et optionnellement `=== MISSING IN CODE ===`.
- Stderr : réservé aux erreurs d'exécution.
- Exit code : `0` = clean ou skip, `1` = drift.
