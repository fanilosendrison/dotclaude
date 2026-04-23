---
name: evaluating-turnlockability
description: "Evalue si une couche d'orchestration (skill + sub-agents orchestrateurs) doit et peut etre turnlockise. Applique C0 (necessite structurelle), C0' (heterogeneite economique) et C1-C4 (turnlockisabilite) recursivement sur la pile d'orchestration visible depuis un point d'entree. Produit un verdict structure : turnlock obligatoire / opportuniste / non-justifie, avec diagnostic des conditions bloquantes. Ne modifie aucun fichier. Use when the user says 'evalue la turnlockability', 'turnlockise', 'faut-il turnlockiser X', 'eval turnlock', 'evaluating-turnlockability', 'adoption turnlock', or any variant requesting a turnlock adoption assessment for a skill or orchestration layer."
---

# Evaluating Turnlockability

Worker consultatif. Évalue si une couche d'orchestration doit (C0/C0') et peut (C1-C4) être remplacée par une FSM turnlock. Ne modifie aucun fichier — ni code, ni skill, ni spec.

## Déclenchement

L'utilisateur demande une évaluation d'adoption turnlock pour :
- Un skill existant (`/X`) qu'il se demande s'il faut turnlockiser
- Un sub-agent orchestrateur
- Une pile d'orchestration composite (skill + sub-agents imbriqués)

Skip si la question est purement informative ("c'est quoi turnlock ?") — utiliser le doc `docs/ADOPTION-FROM-SENIOR-REVIEW.md` du projet turnlock directement.

## Scope de l'évaluation — RÉCURSIF sur la pile d'orchestration

**Point critique.** La cible d'évaluation n'est PAS seulement le skill pré-turnlock d'entrée. C'est **l'union de tous les niveaux d'orchestration** visibles depuis le point d'entrée utilisateur :

- Le skill d'entrée lui-même (s'il contient de la logique de dispatch, boucle, consolidation)
- Tout sub-agent invoqué par ce skill qui contient lui-même de l'orchestration interne (enchaînement d'étapes typées, dispatch, consolidation)
- Récursivement : si un sub-agent spawn d'autres sub-agents, descendre

Une seule couche qui déclenche C0 suffit à justifier turnlock pour l'ensemble — les orchestrations imbriquées fusionnent en UNE FSM unique (turnlock ne nested pas les FSMs).

## Définitions opérationnelles

| Terme | Définition |
|---|---|
| **Couche d'orchestration** | Unité (skill ou agent) qui contient au moins un parmi : dispatch vers plusieurs sub-unités, boucle avec condition de sortie, branchement conditionnel entre délégations, consolidation/agrégation de résultats multiples |
| **Agent feuille** | Agent dont le rôle est purement du jugement atomique (zéro orchestration interne) |
| **Étape mécanique** | Transformation déterministe sans jugement LLM : read, diff, parse, glob, groupBy, count, dedup, format, hash, compteur, plafond |
| **Étape de jugement** | Décision sémantique qui nécessite un LLM (classification, analyse hostile, synthèse qualitative) |

## Procédure

### Étape 1 — Identifier la pile d'orchestration

1. Lire le fichier du skill/agent d'entrée (`.claude/skills/X/SKILL.md` ou `.claude/agents/X.md`)
2. Pour chaque sub-agent ou skill invoqué, lire son fichier et vérifier s'il contient lui-même de l'orchestration
3. Construire la liste **ordonnée** des couches d'orchestration trouvées : `[L1 (entrée), L2, ...]`
4. Pour chaque couche, noter : son rôle, ses étapes mécaniques, ses étapes de jugement

Si une couche contient à la fois jugement ET orchestration → noter les deux séparément (elles seront séparées en §5.3 Temps 1 si adoption).

### Étape 2 — Appliquer C0 (nécessité structurelle)

Pour **chaque couche**, vérifier si elle matche un des 3 patterns :

**B1. Fan-out / fan-in**
```
mécanique: list N items → délégation batch (N frontières) → mécanique: agréger
```
L'état traverse N+1 contextes distincts.

**B2. Boucle avec condition mécanique de sortie**
```
loop:
  délégation: work
  mécanique: hash, compare, counter, plafond, décider transition
```
Le LLM ne porte pas la mémoire fiable du compteur/hash entre itérations.

**B3. Branche conditionnelle entre délégations**
```
délégation 1 → mécanique: décider (if N>0 fix else done) → délégation 2 | done
```
L'état de la 1ère délégation doit survivre à la décision déterministe.

**Verdict C0 :**
- Au moins une couche coche un pattern → **C0 OUI → turnlock obligatoire**
- Aucune couche ne coche → **C0 NON → passer à C0'**

### Étape 3 — Appliquer C0' (hétérogénéité économique)

Si C0 est NON, évaluer les trois conditions **cumulatives (AND)** :

1. **Étape cheap déléguable existante** — au moins une étape de jugement triviale déléguable à un agent feuille bon marché (haiku + low effort). Sinon rien à gagner.
2. **Volume par étape ≥ 2-5k tokens** — sinon l'overhead de spawn mange le gain.
3. **Skill invoqué fréquemment** — sinon la dette de complexité (FSM + skill-consumer + protocole) n'est jamais remboursée.

Gain potentiel à rechercher : 5-20× sur le coût total, via hétérogénéité de **model** (haiku/sonnet/opus), d'**effort** (low/medium/high), ou d'**isolation de contexte** (sub-agent frais au lieu de traîner l'historique main).

**Verdict C0' :**
- Les 3 conditions satisfaites → **C0' OUI → turnlock opportuniste** (cost engineering, arbitrage perf/cost)
- Au moins une échoue → **C0' NON → fallback : skill pré-turnlock (+ script terminal/initial si mécanique auto-contenue)**

### Étape 4 — Appliquer C1-C4 (turnlockisabilité)

Applicable **uniquement si C0 ou C0' est OUI**. Vérifier les 4 conditions conjointes :

**C1 — Décomposabilité fine des étapes**
Chaque étape de l'orchestration peut être étiquetée dans **une** catégorie, pas d'hybride :
- Phase TS pure (zéro Claude)
- `delegateSkill` → skill-judgment (jugement dans contexte du caller)
- `delegateAgent` → agent feuille (1 spawn frais)
- `delegateAgentBatch` → agent feuille × N (parallèle)

Un hybride (étape qui mélange mécanique + jugement inséparables) bloque C1 — il faut la split avant.

**C2 — Autonomie des délégations**
Chaque délégation est stateless vis-à-vis des autres. Le contexte conversationnel implicite devient un `State` typé injecté dans chaque prompt.

Test : *« Si je ne passe que ce prompt à un Claude vierge, peut-il faire le travail ? »*

Si C2 échoue → couplage conversationnel caché à élucider avant turnlockisation.

**C3 — Agrégation mécanisable ou déléguable**
Le fan-in (réconciliation de N résultats) a un traitement explicite :
- Pur TS (groupBy, count, format, fingerprint dedup), OU
- Un agent feuille dédié de synthèse si jugement sémantique nécessaire

Pas de *« je synthétise de mémoire »*.

**C4 — Schémas de résultat stables**
Chaque délégation retourne un JSON validable par Zod. Imposer un format JSON côté agent feuille est une précondition — sinon `consumePendingResult` ne peut pas typer.

**Verdict C1-C4 :**
- Les 4 OK → **turnlockisabilité faisable**
- Au moins une échoue → **turnlockisabilité bloquée** ; indiquer laquelle et ce qu'il faut élucider avant

### Étape 5 — Produire le verdict

## Format de sortie

Toujours produire ce bloc structuré, dans cet ordre :

```markdown
## Verdict turnlockability — <nom de la cible>

**Décision** : turnlock obligatoire | turnlock opportuniste | non-justifié (skill pré-turnlock + script) | bloqué par turnlockisabilité
**Turnlockisabilité** : faisable | bloquée par Cx (…)

## Scope évalué (pile d'orchestration)

- **L1 — `<nom>`** (skill d'entrée) : rôle, étapes mécaniques, étapes de jugement
- **L2 — `<nom>`** (sub-agent orchestrateur) : rôle, étapes mécaniques, étapes de jugement
- (…)

## C0 — Nécessité structurelle

- **Coché** : OUI / NON
- **Pattern matché** : B1 fan-out/fan-in | B2 boucle | B3 branche | aucun
- **Couche concernée** : L1 | L2 | …
- **Evidence** : citer la ligne du skill/agent qui exhibe le pattern

## C0' — Hétérogénéité économique

(Évaluer seulement si C0 = NON)

- **Étape cheap déléguable** : OUI / NON + laquelle
- **Volume par étape ≥ 2-5k tokens** : OUI / NON + estimation
- **Skill invoqué fréquemment** : OUI / NON + signal (présence dans CLAUDE.md, chaînage auto, etc.)
- **Coché (AND des 3)** : OUI / NON

## C1-C4 — Turnlockisabilité

(Évaluer seulement si C0 ou C0' = OUI)

- **C1 Décomposabilité** : OK / KO — détail
- **C2 Autonomie** : OK / KO — détail
- **C3 Agrégation** : OK / KO — détail
- **C4 Schémas** : OK / KO — détail

## Transformation projetée (si adoption)

Si décision = turnlock (obligatoire ou opportuniste) :
- **Couches à fusionner** en FSM unique : L1, L2, …
- **Phases TS pures** projetées : liste
- **Délégations** projetées : `delegateSkill(...)`, `delegateAgent(...)`, `delegateAgentBatch(...)` avec cible
- **Agents feuilles à créer** : liste
- **skill-consumer à créer** : nom du slash command d'entrée
- **Agents / skills à dissoudre** : liste

## Prochaine étape recommandée

Une ligne, actionnable :
- "Turnlockiser : commencer par extraire <agent feuille X>"
- "Ne pas turnlockiser : ajouter un script bash `finalize` en sortie pour la mécanique"
- "Élucider C2 avant de continuer : <quel couplage>"
```

## Règles de conduite

- **Ne jamais deviner la structure d'une couche** sans avoir lu le fichier source. Si un skill/agent n'est pas accessible → le signaler, ne pas inventer.
- **Citer les lignes précises** du skill/agent qui justifient un pattern B1/B2/B3 ou un échec de Cx. Pas d'affirmation en l'air.
- **Ne pas surestimer C0** : un skill qui enchaîne N étapes de jugement linéaires dans un même contexte n'est pas B1 (il n'y a pas de frontière de process). B1 implique **vraiment** une délégation à un ou plusieurs sub-agents/sub-skills avec agrégation mécanique.
- **Ne pas précipiter C0'** : si la cible est invoquée rarement (< quelques fois par semaine) ou tous les steps sont de volume < 2k tokens, C0' ne passe pas même si hétérogénéité apparente.
- **Demander en cas d'ambiguïté** : fréquence d'invocation, volume typique, contraintes de déterminisme non documentées. Ne pas deviner.
- **Ne pas coder la transformation** — uniquement l'évaluer et la projeter. La mise en œuvre est hors scope de ce skill.
- **Si la cible est déjà turnlockisée** : signaler et sortir — rien à évaluer.

## Références

Ce skill est dérivé de `docs/ADOPTION-FROM-SENIOR-REVIEW.md` du projet turnlock. En cas de doute ou d'évolution des critères, consulter ce doc comme source de vérité.
