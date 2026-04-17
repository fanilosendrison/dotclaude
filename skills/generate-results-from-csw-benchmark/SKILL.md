---
name: generate-results-from-csw-benchmark
description: Génère les fichiers results.json et results-flat.csv à partir des benchmarks existants du md-structural-normalizer.
user_invocable: true
trigger:
  - generate-results-from-csw-benchmark
  - génère les résultats
  - benchmark results
---

# generate-results-from-csw-benchmark

## Contexte

Ce skill lance la commande de génération des résultats agrégés (JSON + CSV) à partir des runs de benchmarks déjà exécutés dans `benchmarks/`.

## Exécution

1. Se placer dans le répertoire du projet `md-structural-normalizer`
2. Lancer la commande :

```bash
bun scripts/tools/run-benchmarks.ts --results
```

3. Vérifier que les fichiers suivants ont été mis à jour :
   - `benchmarks/results.json`
   - `benchmarks/results-flat.csv`

4. Afficher un résumé : nombre de documents traités, nombre total de runs agrégés.
