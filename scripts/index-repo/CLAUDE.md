# index-repo — Project Indexer

Scanner déterministe qui indexe un projet : structure, specs normatives, cross-references spec→code→test.

## Usage

```bash
bun ~/.claude/scripts/index-repo/src/cli.ts "$PWD"
```

## Architecture

- `src/cli.ts` — Entry point CLI (pas stdin, pas un hook)
- `src/lib/axes/` — 5 scanners indépendants (code, specs, config, tests, scripts)
- `src/lib/frontmatter.ts` — Parser YAML frontmatter regex-based (zero dep)
- `src/lib/cross-references.ts` — Matching spec→code→test (explicite + convention)
- `src/lib/validation.ts` — Détection gaps, orphelins, estimation tokens
- `src/lib/manifest-writer.ts` — Génère SPEC_MANIFEST.md (déterministe)
- `src/lib/staleness.ts` — git write-tree pour détection fraîcheur
- `src/lib/state.ts` — Read/write .index-state.json

## Flow

1. Détection fraîcheur via `git write-tree`
2. Scan des 5 axes (code, specs, config, tests, scripts)
3. Cross-reference spec→code→test
4. Validation (gaps, orphelins, estimation tokens)
5. Génération SPEC_MANIFEST.md

## Invariants

- SPEC_MANIFEST.md est **toujours** déterministe : même input → même output
- Le script ne fait **jamais** d'appel réseau, jamais d'IA
- Stdout est **toujours** du JSON valide
- Exit 0 = succès, exit 1 = erreur

## Output

- Stdout : JSON (résultat du scan)
- Fichier : `SPEC_MANIFEST.md` (déterministe)
- Fichier : `.index-state.json` (état interne)

## Workflow dev

1. `bun test index-repo` — tous les tests doivent passer
2. `biome check --write index-repo` — lint
3. Fixtures dans `fixtures/sample-project/` pour les tests d'intégration

## Convention frontmatter specs

```yaml
---
id: SPEC-001          # Requis
version: 2.3          # Requis
scope: Description    # Optionnel
status: approved      # Optionnel (draft | approved | deprecated)
depends_on: [SPEC-002] # Optionnel
validates: [src/auth/*] # Optionnel — glob patterns
---
```
