---
name: snapshot-results-from-csw-benchmark
description: Snapshote les résultats de benchmarks (results.json + results-flat.csv) dans benchmarks/snapshots/{tag}/ pour suivi de régression entre versions du pipeline md-structural-normalizer. Détermine automatiquement le tag name à partir du dernier tag git et des commits depuis.
user_invocable: true
trigger:
  - snapshot-results-from-csw-benchmark
  - snapshot benchmark
  - snapshote les résultats
  - tag benchmark results
---

# snapshot-results-from-csw-benchmark

## Contexte

Crée un snapshot versionné des résultats de benchmarks dans `benchmarks/snapshots/{tag}/` et pose un git tag annoté. Le tag name est déterminé automatiquement.

## Pré-requis

`benchmarks/results.json` et `benchmarks/results-flat.csv` doivent exister (via `/generate-results-from-csw-benchmark` ou `bun scripts/tools/run-benchmarks.ts --results`). Si absents, demander à l'utilisateur de les générer d'abord.

## Exécution

### 1. Déterminer le tag name

1. Lire le dernier tag git : `git describe --tags --abbrev=0`
2. Lire les commits depuis ce tag : `git log <last-tag>..HEAD --oneline`
3. S'il n'y a aucun commit depuis le dernier tag, **stopper** : "Aucun commit depuis le dernier tag, rien à snapshotter."
4. Déterminer le niveau de bump (patch/minor/major) en appliquant le skill `/semver-convention` sur les commits listés. En résumé :
   - `fix:` → patch
   - `feat:` → minor
   - `BREAKING CHANGE` ou `!:` → major
   - `chore:`, `refactor:`, `perf:` → patch
   - En cas de mix, le plus haut gagne
5. Composer le suffixe descriptif : résumer le thème dominant des commits en un slug kebab-case court (2-4 mots max). Exemples : `post-prompt-tuning`, `post-fence-aware-cascade`, `pre-perspan-rollback`.
6. Composer le tag final : `v{bumped_version}-{slug}`
7. Afficher le tag proposé et demander validation à l'utilisateur avant de continuer.

### 2. Créer le snapshot

```bash
bun scripts/tools/snapshot-benchmarks.ts --tag <tag-name>
```

Vérifier que `benchmarks/snapshots/<tag-name>/` contient : `results.json`, `results-flat.csv`, `snapshot-meta.json`.

### 3. Commit + tag

1. Commit le snapshot via `/git-commits-push`. Message : `chore(benchmarks): snapshot results <tag-name>`
2. Créer le git tag annoté :
   ```bash
   git tag -a <tag-name> -m "Benchmark snapshot: <tag-name>"
   ```

### 4. Résumé

Afficher : tag créé, commit SHA, nombre de documents et de runs dans le snapshot (lire depuis le `results.json` copié).
