---
name: git-pr
description: Guide pull request creation and merge strategies. Use when the user opens a PR, needs a PR template, asks about merge strategies (squash vs merge commit). Triggers include "PR", "pull request", "merge strategy", "template PR".
---

# Git PR

Créer et merger des pull requests proprement, même en solo.

## Trigger

L'utilisateur travaille avec des PRs. Signaux :
- "j'ouvre une PR"
- "template PR"
- "squash or merge commit?"
- "merge strategy"

## Pourquoi des PRs en solo ?

- **Historique propre** : chaque PR = un changement logique traçable
- **CI automatique** : les checks tournent avant le merge
- **Self-review** : revoir son propre diff avant de merger force à attraper des erreurs
- **Habitude** : si tu bosses un jour en équipe, le réflexe est déjà là

## Titre de PR

Même format qu'un sujet de commit (Conventional Commits) :

```
<type>(<scope>): <description>
```

Exemples :
```
feat(auth): add OAuth2 provider support
fix(export): handle empty dataset gracefully
chore(deps): upgrade React from 18 to 19
docs: add API reference for v2 endpoints
```

Important car **squash and merge** utilise le titre de PR comme message du commit final.

## Description de PR

Utiliser le template dans `templates/PULL_REQUEST_TEMPLATE.md`.

Quatre sections :

1. **Contexte** — Pourquoi ce changement existe. Lien vers l'issue/ticket.
2. **Changements** — Ce qui a été modifié, en résumé.
3. **Comment tester** — Étapes pour vérifier.
4. **Checklist** — Quality gates à cocher.

### Écrire une bonne description

- **Commencer par le POURQUOI** — le contexte que le diff ne montre pas
- **Garder scannable** — compréhensible en < 2 minutes
- **Lier l'issue** — toujours référencer le ticket/numéro
- **Signaler les risques** — tout ce qui est inhabituel ou mérite attention
- **Ne pas répéter le diff** — le code est là, la description ajoute le contexte

## Stratégies de merge

| Type de branche | Stratégie | Pourquoi |
|-----------------|----------|---------|
| `feature/`, `fix/`, `chore/`, `docs/` → `dev` | **Squash and merge** | Historique clean : un commit = un changement logique |
| `dev` → `main` | **Merge commit** (no fast-forward) | Préserve la topologie pour la traçabilité des releases |
| `hotfix/` → `main` | **Merge commit** (no fast-forward) | Préserve la topologie du hotfix |

### Squash and Merge

- Tous les commits de la branche sont compressés en un seul
- Le titre de PR devient le message de commit — donc le titre doit suivre Conventional Commits
- La description de PR peut être incluse dans le body du commit

### Merge Commit

- Crée un commit de merge explicite sur la branche cible
- Préserve l'historique complet de la branche
- Utile pour tracer ce qui faisait partie d'un hotfix

## Règles

### Avant d'ouvrir

1. **Rebase** sur `dev` (ou `main` pour les hotfixes) et résoudre les conflits sur ta branche
2. **Self-review** le diff — attraper les erreurs évidentes avant de merger
3. **CI doit être green** — pas de PR avec un pipeline cassé
4. Tous les items de checklist du template doivent être adressés

### Taille

- Viser **< 400 lignes changées** par PR
- Si c'est trop gros, split en PRs plus petites et séquencées
- Exceptions acceptables : gros refactors, migrations, code généré (le signaler explicitement)

### Après merge

1. **Supprimer** la branche source immédiatement (sauf `dev` évidemment)
2. Vérifier que le CI passe sur la branche cible post-merge
3. Si le merge introduit une régression, revert immédiatement
4. **Back-sync `dev` après un merge `dev → main`** — obligatoire si la stratégie était *Merge Commit* (no-ff). Le merge commit est créé sur `main` uniquement ; sans back-sync, `dev` et `main` divergent topologiquement et la divergence se cumule à chaque PR.

   Procédure (à lancer immédiatement après `gh pr merge … --merge`) :

   ```bash
   git checkout dev
   git pull origin main --ff-only   # ff-only est safe : le HEAD de dev est ancêtre du merge commit
   git push
   ```

   Si `--ff-only` échoue, c'est que dev a reçu de nouveaux commits entre-temps — dans ce cas, ouvrir une nouvelle PR plutôt que de merger à la main.

   Ne s'applique **pas** aux PRs *Squash and merge* (feature → dev) : le squash ne crée pas de merge commit, donc pas de divergence topologique à rappatrier.

## Anti-patterns

- **Draft PR qui reste draft pendant des semaines** → Soit la fermer, soit se fixer une deadline
- **PR sans description** → Toujours remplir le template
- **Merger avec un CI qui fail** → Jamais, sauf si le failure est sans rapport et documenté

## Guidelines

- **Générer la description de PR** quand l'utilisateur le demande — remplir le template à partir du diff et du contexte
- **Valider le titre** contre le format Conventional Commits
- **Signaler les PRs trop grosses** et suggérer comment les split
- **Rappeler le rebase** si la branche est derrière `dev`
