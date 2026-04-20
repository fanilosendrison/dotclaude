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

En mode audit `loop-clean` (voir section ci-dessous) : **ne PAS émettre de findings
sur cette section** — la duplication est couverte par le skill `dedup-codebase`
qui tourne dans le même pipeline. Double-émission = bruit redondant.

---

## Emission JSON (orchestration loop-clean)

En mode audit manuel standard, coding-standards produit le rapport humain
classique (fichier:ligne / règle / fix). En complément, si la variable
d'environnement `LOOP_CLEAN_JSON_OUT` est définie, écrire aussi un JSON
structuré au chemin indiqué. Si la variable n'est pas définie, ne rien écrire
(invocation standalone, comportement inchangé).

### Schema

```json
{
  "skill": "coding-standards",
  "verdict": "CLEAN" | "ISSUES_FOUND",
  "findings": [
    {
      "id": "string (16 hex chars)",
      "source": "coding-standards",
      "axis": "string (un des 6 labels canoniques)",
      "severity": "critical" | "major" | "notable" | "minor" | "nit" | "design",
      "file": "string (chemin relatif repo)",
      "line_start": number | null,
      "line_end": number | null,
      "problem": "string",
      "evidence": "string",
      "fix_proposal": "string",
      "observable_change": "string (≤ 2 lignes ; chaîne vide UNIQUEMENT si severity=design)"
    }
  ],
  "summary": {
    "critical": number, "major": number, "notable": number,
    "minor": number, "nit": number, "design": number
  },
  "blocking": boolean
}
```

`blocking` = `true` si au moins un finding est `critical` ou `major`.

### Formule canonique de `id`

```
id = sha256([source, file, String(line_start ?? ""), axis, problem.slice(0,80)].join("|")).slice(0,16)
```

Stable inter-invocations — condition nécessaire pour la détection d'oscillation
par `loop-clean.sh`.

### Axes canoniques (6 labels)

- `naming` — abréviations cryptiques, noms trop vagues, identifiants incompréhensibles sans contexte
- `typing` — types génériques faibles (`any`, `Object`, `interface{}`, `dynamic`) sans justification, annotations manquantes
- `maintainability` — code malin illisible, patterns incohérents, fonctions trop longues ou faisant plusieurs choses, complexité cyclomatique > 10
- `comments` — commentaires qui décrivent le QUOI au lieu du POURQUOI, docstrings manquants sur API publique, référence spec manquante, commentaires morts
- `error-handling` — erreurs silencieuses, erreurs génériques, codes d'erreur non traçables
- `immutability` — mutations sur structures de données du domaine, fonctions du domaine non pures

**Section `## Pas de duplication` : non émise en mode audit** (couverte par dedup-codebase).

### Calibration de sévérité

Avant d'assigner une sévérité :

1. **La violation introduit-elle un risque bug actif sur un chemin atteignable en prod ?** (ex : `catch: pass` qui avale une erreur de persistance, `any` qui laisse passer un type incorrect dans un calcul money) → `major` voire `critical` si corruption silencieuse.

2. **La violation rend-elle le code structurellement fragile mais sans bug déclenché aujourd'hui ?** (ex : complexité 15 hors hot path, fonction 80 lignes pas encore problématique, fonction domaine impure) → `notable`.

3. **Violation à faible impact — style, lisibilité, doc manquante sur API peu utilisée ?** → `minor`.

4. **Pure cosmétique — format docstring, commentaire mort, préférence stylistique ?** → `nit`.

5. **Préoccupation réelle mais sans `observable_change` formulable** (décision d'arbitrage, trade-off, clarification de règle) → `design`.

Défaut des findings coding-standards : **la majorité sont `notable`/`minor`/`nit`**. `major` uniquement sur risque bug actif. `critical` exceptionnel.

### Règle du `observable_change`

Chaque finding DOIT avoir un `observable_change` formulable comme :
- une assertion de linter/grep qui bascule FAIL → PASS (ex : `grep -nE '\bany\b' file.ts` ne retourne plus cette ligne),
- ou une métrique structurelle mesurable (ex : complexité cyclomatique de `foo` passe de 15 à 8, fonction `bar` passe de 80 à 30 lignes),
- ou une vérification post-fix reproductible.

≤ 2 lignes. Si impossible à formuler → `severity = design`.

### Stabilité du `problem`

Pour un même finding, la chaîne `problem` DOIT être identique entre invocations
(même formulation). Format canonique : `{règle} violated in {contexte concret}`,
phrase affirmative, sans modalité. Ex stable : `weak type "any" used in foo return signature`.
Ex non stable : `Il se pourrait que foo utilise any...`.

### Scope de l'audit en mode loop-clean

- Auditer **uniquement les fichiers modifiés** (`git diff --name-only`), pas
  le repo entier, pour éviter de noyer le pipeline loop-clean de findings
  pré-existants non liés à l'itération courante.
- Skipper la section `## Pas de duplication` (dedup-codebase s'en charge).
- Les findings pré-existants (sur code non-frais) seront routés vers `backlog.md`
  par `fix-or-backlog` selon la matrice frais/pré-existant × correctness/hygiene.

### Emplacement d'écriture

```bash
[[ -n "$LOOP_CLEAN_JSON_OUT" ]] && echo "$JSON_CONTENT" > "$LOOP_CLEAN_JSON_OUT"
```

Le LLM produit le JSON via l'outil `Write` directement sur le chemin donné par
la variable. Le fichier doit être valide JSON (parseable par `jq`).
