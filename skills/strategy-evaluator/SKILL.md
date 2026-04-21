---
name: strategy-evaluator
description: "Evalue systematiquement toute strategie d'implementation proposee par l'agent avant execution. Produit un avis structure (GO / GAP / REJECT) base sur la tracabilite de chaque decision vers les contraintes normatives des specs en contexte. DOIT etre invoque avant toute implementation — meme niveau d'obligation que le linting. Ne modifie aucun fichier. Invoquer ce skill chaque fois que l'agent presente un plan, une strategie, ou une approche d'implementation."
---

# Strategy Evaluator

Worker semantique consultatif. Produit un avis structure sur une strategie
d'implementation. Ne modifie aucun fichier — ni code, ni spec, ni config.

## Declenchement

**Obligatoire** — meme niveau qu'un lint check. Se declenche quand l'agent :

- Propose un plan d'implementation multi-etapes
- Decrit une strategie de modification de code
- Presente une approche pour resoudre un probleme technique

**Ne se declenche PAS** pour :

- Corrections triviales (typos, formatting)
- Commandes d'execution simples (run tests, lint)
- Questions de clarification

## Contexte consulte

1. **Strategie proposee** : le texte complet de la proposition (plan, etapes, justifications)
2. **Specs en contexte** : tous les documents normatifs presents dans la session (Brief Systeme, Phase specs, test vectors, CLAUDE.md projet, etc.)
3. **Code existant** : l'etat actuel du codebase pertinent

## Workflow d'evaluation

1. Identifier chaque **decision** dans la strategie (choix technique, structure, approche, ordre des etapes)
2. Pour chaque decision, chercher la **contrainte normative** qui la justifie dans les specs en contexte
3. Classer le resultat :
   - Decision tracable a une contrainte existante → conforme
   - Decision non couverte par les specs → gap
   - Decision qui contredit une contrainte existante → violation
4. Appliquer la regle de verdict (voir ci-dessous)
5. Produire l'avis structure

## Regle de verdict

- Au moins une **violation** → `REJECT` (meme si le reste est conforme)
- Au moins un **gap** et zero violation → `GAP`
- Tout est tracable → `GO`

Un seul verdict. Jamais d'hybride.

---

## Branches de sortie

### GO

```
VERDICT: GO
TRACABILITE:
- [decision de la strategie] → [document, section, regle]
- [decision de la strategie] → [document, section, regle]
RISQUES RESIDUELS: [liste, ou "aucun"]
```

L'agent peut executer. Chaque decision est tracable a une contrainte normative.

### GAP

```
VERDICT: GAP
DIAGNOSTIC:
- SECTION CONCERNEE: [document + section precise de la spec]
- NATURE DU GAP: [ajout manquant | contradiction | ambiguite | cas non couvert]
- DESCRIPTION: [ce que la spec ne couvre pas ou contredit]
- IMPACT SUR LA STRATEGIE: [quelles etapes sont affectees et comment]
- SUGGESTION D'AJUSTEMENT: [proposition concrete de modification de la spec]
ELEMENTS CONFORMES: [parties de la strategie valides independamment du gap]
```

L'agent doit evaluer la suggestion, decider s'il l'applique, mettre a jour
la spec si necessaire, puis re-evaluer la strategie.

### REJECT

```
VERDICT: REJECT
VIOLATIONS:
- [document, section, regle] → [element de la strategie qui la viole]
RAISON: [pourquoi la strategie est incorrecte]
DIRECTION: [ce qui devrait changer pour qu'une strategie soit acceptable]
```

L'agent doit produire une nouvelle strategie.

---

## Regles d'evaluation

1. **La spec fait autorite.** Strategie contredit la spec → REJECT.
   Spec silencieuse → GAP. Jamais GO par defaut.

2. **Pas de rubber-stamping.** Ne pas valider parce que ca "a l'air bien".
   Verifier la tracabilite de chaque decision vers une contrainte normative.
   Decision non tracable → GAP.

3. **Precision des references.** Chaque point de tracabilite cite le document,
   la section, et la regle exacte. "Conforme a la spec" sans reference
   precise est interdit.

4. **Separation des concerns.** Le skill evalue la conformite normative.
   Il ne juge pas la qualite du code, ni l'elegance de l'approche.
   Plan laid mais conforme → GO. Plan elegant mais non tracable → GAP.

5. **Aucune modification.** Pas de fichier, pas de spec, pas de code.
   Il produit un avis. Point.

6. **Hypotheses factuelles.** Si la strategie repose sur une hypothese
   factuellement fausse (etat du code, comportement d'une dependance),
   c'est REJECT — pas GAP.

---

## Exemples

### GO

Strategie : "Implementer la promotion D1 en iterant sur les headings de
depth > 0 et en appliquant la table depth→level de la spec."

→ `VERDICT: GO`. La table depth→level est dans Phase_D.md §D1. Le mecanisme
d'iteration est prescrit dans le Brief Systeme §pipeline. Tracabilite complete.

### GAP

Strategie : "Ajouter heading_level aux decisions POSSIBLE_LIST_AS_SECTIONS
en demandant au LLM de choisir le niveau."

→ `VERDICT: GAP`. La spec Phase_E decrit les decisions pour
POSSIBLE_LIST_AS_SECTIONS mais ne mentionne pas de champ heading_level dans
le schema de reponse. Le LLM n'a pas de guidance pour choisir ce niveau.
Suggestion : ajouter heading_level au schema C5/C6 et une guidance dans
LLM_Prompts_Spec.

### REJECT

Strategie : "Utiliser un LLM pour decider quand passer de Phase D a Phase E."

→ `VERDICT: REJECT`. Viole le principe IFE : les transitions entre phases
sont deterministes et controlees par le code, jamais par un LLM
(Brief Systeme §orchestration, IFE bluepaper §6.1).
