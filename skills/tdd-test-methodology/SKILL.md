---
name: tdd-test-methodology
description: Test-Driven Development methodology — tests are ALWAYS written before code. Use when the user mentions "TDD", "vérifie les tests", "TDD check", "check test coverage", "audit TDD", "test-driven", "tests d'abord", or any variant requesting TDD workflow or TDD compliance review. NOT applied automatically — only when TDD is explicitly requested or mentioned.
---

# Tests — Méthodologie TDD

S'applique à tous les langages. Le framework de test et les outils spécifiques
sont précisés dans le CLAUDE.md du projet.

## Activation

Cette méthodologie n'est **pas** appliquée automatiquement.
Elle s'active uniquement quand l'utilisateur mentionne TDD ou demande explicitement un workflow test-first.
Invocation manuelle : `/tdd-test-methodology`.

---

## Principe : Test-Driven Development

Le cycle de développement suit **TOUJOURS** l'ordre TDD :

1. **Rouge** — Écrire le test d'abord (basé sur la spec ou le comportement attendu).
   Le lancer. Il échoue.
2. **Vert** — Écrire le minimum de code pour faire passer le test.
3. **Refactor** — Nettoyer le code (réorganiser sans changer le comportement),
   relancer le test pour vérifier qu'il passe toujours.

Répéter pour chaque comportement attendu.

**Claude Code ne doit JAMAIS écrire du code puis les tests après. Les tests viennent en premier.**

---

## D'où viennent les tests

### Tests de conformité
Traduits directement des spécifications du projet (si elles existent).
Si la spec dit "une entrée vide DOIT lever une erreur", le test vérifie exactement ça.
Ces tests sont **sacrés** : on ne les modifie que si la spec change.

### Tests unitaires
Vérifient qu'une fonction isolée produit la bonne sortie pour une entrée donnée.

### Tests de propriété
Vérifient qu'une règle est toujours vraie, quelle que soit l'entrée.
Exemple : "sérialiser puis désérialiser un objet donne toujours un objet identique à l'original."
Utiliser un framework de property-based testing adapté au langage du projet.

### Tests d'intégration
Vérifient que plusieurs modules fonctionnent ensemble (quand les modules existent).

---

## Organisation

- Les tests **mirrorent la structure du code source** :
  `src/domain/services/payment` → `tests/unit/domain/services/test_payment`
- Tests de conformité dans `tests/conformance/`, alignés sur les specs.
- Nommage des tests : `test_<ce_qui_est_testé>_<condition>_<résultat_attendu>`

---

## Checklist de fin de tâche

Avant de considérer une tâche terminée, Claude Code **DOIT** vérifier **TOUS** ces points :

### Qualité du code

- Lancer les tests → tous passent.
- Lancer le linter → zéro erreur.
- Lancer le vérificateur de types (si applicable) → zéro erreur.
- **Les trois doivent passer sans erreur. Si l'un échoue, corriger avant de conclure.**

### Cohérence structurelle

- Chaque nouveau fichier a un nom qui décrit fidèlement tout son contenu.
- Pas de logique métier dans la couche infrastructure. Pas d'imports externes dans le domaine.
- Pas de code dupliqué (si la même logique existe ailleurs, factoriser).

### Commentaires et documentation

- Les comportements implémentés depuis une spec ont un commentaire citant la section.
- La documentation des fonctions publiques est présente et à jour.
- Aucun commentaire obsolète (ne correspond plus au code).

### Conformité

- Le code respecte la spec applicable (si elle existe). En cas de doute, signaler.
- Les valeurs définies par les specs sont en dur. Les valeurs d'environnement sont externalisées.

### Portabilité et sécurité

- Si les dépendances ont changé → mettre à jour le manifeste de dépendances, le fichier
  de lock et le fichier de conteneurisation (si applicable).
- Aucun chemin absolu dans le code.
- Aucun secret (clé API, token, mot de passe) dans le code ou les fichiers versionnés.

### TDD respecté

- Les tests ont été écrits **AVANT** le code (pas après).
- Chaque fonction publique a au minimum un test.
