---
name: coding-standards
description: Applied automatically during all implementations. Can also be invoked manually with "/coding-standards [path]" to audit existing code against the standards. Use when the user says "audite le code", "vérifie les standards", "coding standards", "check code quality", or any variant requesting a code quality review.
---

# Coding Standards

S'applique à tous les langages. Les conventions spécifiques au langage choisi
(casing, extensions, idiomes) sont précisées dans le CLAUDE.md du projet.

## Application automatique

Ces standards sont appliqués **systématiquement** lors de toute implémentation.
Pas besoin d'invocation manuelle — la directive dans `~/.claude/CLAUDE.md` les rend obligatoires.

## Invocation manuelle : audit

Argument optionnel : `$ARGUMENTS` (fichier ou dossier cible)

### Workflow d'audit

1. Si un argument est fourni → auditer le fichier/dossier cible contre les standards
2. Si pas d'argument → auditer le répertoire courant
3. Pour chaque violation trouvée, lister :
   - **Fichier:ligne** — la localisation
   - **Règle** — quelle section des standards est violée
   - **Fix** — correction proposée
4. Prioriser par impact : erreurs silencieuses > typage manquant > nommage > commentaires
5. Appliquer les corrections uniquement si demandé explicitement
6. Si le projet a un CLAUDE.md avec des conventions spécifiques au langage, les combiner avec les standards globaux

---

## Nommage

- Suivre les conventions du langage du projet (définies dans le CLAUDE.md du projet).
- **INTERDIT partout** : abréviations cryptiques (`proc_dat`, `mgr`, `impl2`, `tmp2`).
- Écrire le nom complet même s'il est long. Le code est lu plus souvent qu'il est écrit.
- Les noms de fichiers, classes, fonctions et variables doivent être immédiatement
  compréhensibles sans contexte supplémentaire.

## Typage

- Tout est typé. Chaque fonction a des annotations/déclarations de type sur les
  paramètres ET le retour, dans la mesure où le langage le supporte.
- Jamais de types génériques faibles (`any`, `Object`, `interface{}`, `dynamic`, etc.)
  sauf cas exceptionnel justifié en commentaire.
- Préférer les structures de données immutables pour les modèles du domaine.

## Maintenabilité

- **Pas de code "malin"**. Si une astuce en une ligne est illisible, préférer une version
  plus longue mais limpide.
- **Patterns cohérents**. Si la première fonction retourne les erreurs d'une certaine
  manière, toutes les fonctions font pareil. Zéro surprise entre les fichiers.
- **Fonctions courtes et focalisées**. Une fonction fait un seul travail. Si elle en fait
  plusieurs, la découper en sous-fonctions nommées explicitement.
- **Complexité cyclomatique max : 10** par fonction. Nombre de chemins possibles
  dans une fonction (chaque `if`, `else`, boucle en ajoute un). Au-delà de 10 →
  découper.
- Utiliser l'outil de linting du projet pour vérifier automatiquement.

## Commentaires

**Règle : commenter le POURQUOI, jamais le QUOI.**

```
// MAUVAIS — décrit ce que le code fait (le code le dit déjà) :
// Calcule la remise

// BON — explique pourquoi ce choix a été fait :
// Taux plafonné à 30% pour éviter les marges négatives (règle métier §4.2)

// BON — signale un piège non évident :
// L'arrondi se fait APRÈS la somme, pas sur chaque ligne, sinon les centimes divergent
```

Autres règles :

- **Docstrings/JSDoc/Javadoc** : chaque classe et fonction publique a une documentation
  d'une ligne expliquant son rôle. Les docs longs ne sont nécessaires que si le
  comportement est non évident.
- **Références aux specs** : quand le code implémente un comportement spécifié
  dans un document du projet, le commentaire DOIT citer la spec et la section
  (ex: `// SPEC-AUTH §3.2` ou `// Règle métier §4.1`).
- **Pas de commentaires morts** : un commentaire qui ne correspond plus au code
  est pire que pas de commentaire. Mettre à jour ou supprimer.

## Gestion des erreurs

- Jamais d'erreurs silencieuses (pas de `catch` vide, pas de `except: pass`,
  pas de `_ = mayFail()`).
- Définir des exceptions/erreurs spécifiques au domaine, pas des messages génériques.
- Chaque erreur porte un code traçable.

## Immutabilité et pureté

- Les structures de données du domaine sont immutables (utiliser les mécanismes
  du langage : `frozen`, `readonly`, `const`, `final`, `record`, etc.).
- Les fonctions du domaine sont pures : même entrée → même sortie, aucun effet de bord.
- Cela garantit la prévisibilité et la testabilité du cœur métier.

## Pas de duplication

- Si la même logique existe à deux endroits → extraire dans une fonction commune.
- Si un pattern se répète → créer une abstraction.
- Avant de coder une nouvelle fonction, vérifier si elle existe déjà.
