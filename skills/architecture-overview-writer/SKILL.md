---
name: architecture-overview-writer
description: Generate a docs/architecture_overview.md for a project by reading its CLAUDE.md, STACK_EVAL.yaml, and normative specs. Produces target file tree, spec-to-code mapping, data flow diagrams (Mermaid + pseudo-code), dependency graph, injection points, and domain/infra boundary. Use when the user says "architecture overview", "crée l'architecture", "module map", "arborescence cible", "architecture du projet", "overview architecture", "carte des modules", "flux de données", or when starting implementation on a spec-driven project that lacks a docs/architecture_overview.md.
---

# Architecture Overview Writer

## But

Produire un `architecture_overview.md` à la racine du projet qui fait le pont entre les
spécifications normatives et le code. Ce document est **informatif** (pas normatif) — il guide
les choix structurels de Claude Code sans se substituer aux specs.

## Quand l'utiliser

- Démarrage d'implémentation sur un projet piloté par des specs
- Aucun `architecture_overview.md` n'existe encore
- L'arborescence `src/` doit être décidée avant de coder
- Le mainteneur demande un module map, une arborescence, ou un overview d'architecture

## Lecture prealable

Lire ces fichiers dans l'ordre :

1. **CLAUDE.md** (racine projet) — principes structurels, séparation domain/infra, conventions de nommage
2. **STACK_EVAL.yaml** (racine projet) — langage, runtime, contraintes d'outillage
3. **specs/** — toutes les spécifications normatives
4. **PROJECT_INDEX.md** / **SPEC_MANIFEST.md** (si existants) — cross-references existantes

## Output

Un fichier unique : `docs/architecture_overview.md`.

Le document est **informatif**. En cas de conflit avec les specs (`specs/`), les specs prévalent.

## Template

Le document DOIT contenir ces sections, dans l'ordre :

### § 1. Arborescence cible

Arbre `src/` complet avec chaque fichier et sa responsabilité en une ligne.
Inclure aussi l'arborescence `tests/` avec le mapping vers les fichiers source.

```
src/<package>/
├── __init__.py
├── fichier.py              # Responsabilité
├── domain/
│   ├── __init__.py
│   ├── types.py            # Responsabilité
│   ...
├── infra/
│   ├── __init__.py
│   ...
```

### § 2. Mapping spec → code → tests

Tableau associant chaque spec à ses fichiers d'implémentation et de test :

| Spec | Domaine fonctionnel | Fichier(s) code | Fichier(s) test |
|------|---------------------|-----------------|-----------------|

Chaque spec DOIT avoir au moins un fichier code mappé (sauf les specs transversales).

### § 3. Flux de données

Deux formats obligatoires :

1. **Diagramme Mermaid** — flux visuel de l'entrée à la sortie
2. **Pseudo-code** — étape par étape avec références aux sections des specs

Si le flux comporte des sous-flux (ex: traitement par module dans un pipeline),
les séparer en diagrammes distincts.

### § 4. Graphe de dépendances internes

Pour chaque fichier source :
- Ce qu'il importe
- Ce qu'il n'importe **PAS** (frontières explicites)

### § 5. Points d'injection

Pour chaque Protocol (interface) nécessaire à la testabilité :

- **Nom** et **localisation**
- **Signature** (paramètres, types, retour)
- **Implémentation par défaut** (localisation dans `infra/`)
- **Comment les tests le substituent**

### § 6. Séparation domain / infra

Tableau de chaque fichier avec sa couche et sa justification :

| Fichier | Couche | Justification |
|---------|--------|---------------|

## Directives

- **Lire les specs en entier** avant d'écrire — ne rien inventer qui ne soit pas dans les specs
- **Informatif, pas normatif** — le document guide, il ne remplace pas les specs
- **Explicite > implicite** — chaque choix structurel doit être justifié
- **Un fichier = un concept** — si un fichier couvrirait plusieurs concepts, le découper
- **Pureté du domaine** — domain/ ne DOIT jamais importer de dépendances externes
- **Après création** — proposer d'ajouter une référence au document dans le CLAUDE.md du projet

## Checklist qualité

Avant de finaliser :

- [ ] Chaque spec a au moins un fichier code mappé
- [ ] Chaque fichier code a une responsabilité claire et non chevauchante
- [ ] Les fichiers domain/ n'importent que la stdlib
- [ ] Les fichiers infra/ implémentent des Protocols du domain/
- [ ] Le flux de données couvre le chemin complet entrée → sortie
- [ ] Tous les points d'injection ont un Protocol + implémentation par défaut
- [ ] Aucun comportement de spec n'a été inventé — tout trace vers une spec
