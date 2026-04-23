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
| **Couche d'orchestration** | Unité (skill ou agent) dont l'une des opérations **traverse une frontière de process LLM** : dispatch vers une ou plusieurs sub-unités (`Agent(...)`, `Skill(...)`), boucle avec condition de sortie qui ré-invoque une sub-unité, branchement conditionnel entre délégations, **consolidation de résultats venant de sub-unités distinctes**. |
| **Frontière de process LLM** | Passage d'un contexte LLM à un autre (spawn de sub-agent, invocation de skill, re-entry via `--resume`). Une opération qui reste dans le même contexte LLM ne constitue PAS une frontière. |
| **Agent feuille** | Agent qui ne traverse aucune frontière de process : pas de spawn, pas d'invocation de skill externe, pas de re-entry. Une **consolidation intra-contexte** (ex : dedup / format / counts des findings que l'agent vient lui-même d'émettre dans le même run) est **tolérée** et ne disqualifie pas l'agent comme feuille. |
| **Étape mécanique** | Transformation déterministe sans jugement LLM : read, diff, parse, glob, groupBy, count, dedup par hash, format, sha, compteur, plafond |
| **Étape de jugement** | Décision sémantique qui nécessite un LLM (classification, analyse hostile, synthèse qualitative, dedup sémantique cross-angles) |

## Procédure

### Étape 0 — Charger le registry de models (préalable)

Avant toute évaluation économique, rafraîchir et charger le registry de models :

```bash
bun run ~/.claude/models/refresh.ts   # TTL 24h — no-op si frais
```

Puis lire `~/.claude/models/models.json`. Le registry expose :
- **Tiers** (haiku / sonnet / opus) avec `current_id` à jour (ex : `claude-haiku-4-5`)
- **`relative_cost`** normalisé sur haiku=1 (synchronisé depuis LiteLLM)
- **`efforts`** (low / medium / high / xhigh) — dimension orthogonale au tier

Si `"stale": true` dans la réponse, le fetch LiteLLM a échoué — les prix datent du dernier refresh réussi. Signaler `prix potentiellement obsolètes` dans le verdict final.

Utiliser systématiquement les **current_id** du registry dans les recommandations concrètes ("descendre à `claude-haiku-4-5`"), pas les tiers génériques seuls.

### Étape 1 — Identifier la pile d'orchestration

1. Lire le fichier du skill/agent d'entrée (`.claude/skills/X/SKILL.md` ou `.claude/agents/X.md`)
2. Pour chaque sub-agent ou skill invoqué, lire son fichier et vérifier s'il contient lui-même de l'orchestration
3. Construire la liste **ordonnée** des couches d'orchestration trouvées : `[L1 (entrée), L2, ...]`
4. Pour chaque couche, noter : son rôle, ses étapes mécaniques, ses étapes de jugement

Si une couche contient à la fois jugement ET orchestration → noter les deux séparément (elles seront séparées en §5.3 Temps 1 si adoption).

### Étape 2 — Appliquer C0 (nécessité structurelle)

**Pré-requis critique.** B1/B2/B3 exigent tous qu'un **état mécanique traverse une frontière de process LLM**. Une consolidation ou agrégation qui reste dans le même contexte LLM (ex : un agent qui dedup / format / compte les findings qu'il vient lui-même d'émettre) ne matche aucun pattern — ce n'est pas du fan-in au sens de C0, c'est du post-processing intra-LLM. Ne pas confondre.

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

Si C0 est NON, l'évaluation se fait en **deux temps** pour éviter les verdicts paresseux ("NON" sans raisonnement).

#### Étape 3a — Énumérer les candidats de décomposition

Lister **explicitement** toutes les étapes ou sous-étapes qui *pourraient en principe* descendre à un model moins cher (haiku/sonnet) ou à du TS pur. Pour chaque candidat, noter :
- Ce qu'il ferait (l'opération précise)
- Quelle cible (haiku/sonnet/TS pur)
- Pourquoi c'est plus cheap que le status quo

**Si aucun candidat identifiable** → C0' = NON *pour absence de décomposition*. Noter "aucun candidat" dans le verdict.

#### Étape 3b — Passer chaque candidat aux deux gates quantitatifs

Pour **chaque** candidat énuméré à 3a, évaluer les deux conditions **cumulatives (AND)** :

1. **Volume ≥ 2-5k tokens** (input + output du candidat) — sinon l'overhead de spawn mange le gain → *killed sur volume*.
2. **Fréquence × complexité-debt justifie le ROI** — le parent est-il invoqué assez souvent pour amortir la dette de complexité (FSM + skill-consumer + protocole) ? Sinon → *killed sur fréquence*.

Gain potentiel à rechercher : se calcule à partir des `relative_cost` du registry (§ Étape 0). Exemple actuel (à vérifier dans models.json en live) — haiku=1, sonnet≈3, opus≈5 → descendre opus→haiku sur une étape triviale rapporte ~5× sur le segment concerné. Le gain total d'une décomposition se calcule en pondérant par la fraction de tokens de chaque étape. Sources d'hétérogénéité exploitables : **tier** (haiku/sonnet/opus), **effort** (low/medium/high/xhigh — orthogonal au tier), **isolation de contexte** (sub-agent frais au lieu de traîner l'historique main).

#### Verdict C0'

- **Au moins un candidat survit aux deux gates** → **C0' OUI → turnlock opportuniste** (cost engineering)
- **Tous les candidats sont killed** → **C0' NON → fallback : skill pré-turnlock (+ script terminal/initial si mécanique auto-contenue)**. Indiquer *sur quoi* chaque candidat a été killed (volume ou fréquence).

**Règle de formulation stricte.** Le verdict C0' NE DOIT PAS contenir un "NON" sans justification explicite : soit "aucun candidat identifiable" (3a vide), soit "candidat X killed sur volume/fréquence" (3b). Un verdict C0' NON non justifié est un signal d'évaluation paresseuse — retourner à 3a.

#### Exemple canonique de verdict C0' NON (pour calibration)

Cas : `/git-commits-push` (skill qui rédige un commit message + push).

**3a — Candidats énumérés :**
- **C1** : "sonnet lit le diff staged et rédige le message Conventional Commits" (descendre du model du caller à sonnet)
- **C2** : "haiku vérifie les règles syntaxiques (type valide, impératif, 72 chars)" (descendre à haiku)

**3b — Passage aux gates :**
- C1 : volume input ≈ diff staged (souvent < 2k tokens sur un commit bien découpé) + output ≈ 50-500 tokens → **killed sur volume**
- C2 : la vérification est déjà triviale inline, descente à haiku = overhead de spawn sans gain mesurable → **killed sur volume** (output < 100 tokens)

**Verdict** : C0' NON — 2 candidats identifiés, tous deux killed sur volume. La fréquence haute (invocation avant chaque commit) ne compense pas.

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

#### Statuts possibles par Cx

Chaque Cx se voit attribuer **un** des trois statuts :

- **OK** — la condition tient en l'état actuel, sans intervention préalable
- **OK-WITH-PRECONDITION** — la condition tiendra après une modification **triviale et bornée** du code existant (ex: formaliser un output JSON déjà 1-à-1 avec les champs existants, extraire 3 lignes mécaniques d'une phase hybride). La précondition doit être nommable en une phrase actionnable et ne change **pas** la fonction sémantique de la cible.
- **KO** — la condition échoue et la levée demande un vrai travail (élucidation d'un couplage conversationnel caché, redesign d'une phase, refactor non-trivial). Turnlockisation bloquée tant que pas résolu.

**Règle de distinction OK vs OK-WITH-PRECONDITION** : si la précondition tient en ≤ ~50 lignes de code avec aucun changement de contrat externe, c'est OK-WITH-PRECONDITION. Sinon, c'est KO.

#### Verdict C1-C4

- **Les 4 en OK** → *turnlockisabilité faisable sans précondition*
- **Au moins un OK-WITH-PRECONDITION, zéro KO** → *turnlockisabilité faisable moyennant préconditions* (listées dans la section dédiée du format de sortie)
- **Au moins un KO** → *turnlockisabilité bloquée par Cx* ; indiquer lequel et ce qu'il faut élucider/redesign avant

### Étape 5 — Produire le verdict

## Format de sortie

Toujours produire ce bloc structuré, dans cet ordre :

```markdown
## Verdict turnlockability — <nom de la cible>

**Décision** : turnlock obligatoire | turnlock opportuniste | non-justifié (skill pré-turnlock + script) | bloqué par turnlockisabilité
**Turnlockisabilité** : faisable | faisable moyennant préconditions | bloquée par Cx (…)

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

**3a — Candidats énumérés** :
- **C1** : <description précise + cible haiku/sonnet/TS pur + pourquoi cheap>
- **C2** : …
- (Si aucun → noter explicitement "aucun candidat identifiable")

**3b — Gates par candidat** :
- **C1** : volume ≈ <X> tokens (PASS/FAIL 2-5k) ; fréquence ≈ <Y> (PASS/FAIL ROI) → **survit** / **killed sur <volume|fréquence>**
- **C2** : …

**Verdict C0'** : OUI (au moins 1 survivant) / NON (tous killed ou aucun candidat) — avec raison explicite

## C1-C4 — Turnlockisabilité

(Évaluer seulement si C0 ou C0' = OUI)

Chaque Cx : **OK** | **OK-WITH-PRECONDITION** | **KO**.

- **C1 Décomposabilité** : <statut> — détail (si OK-WITH-PRECONDITION : nommer la précondition en une phrase actionnable)
- **C2 Autonomie** : <statut> — détail
- **C3 Agrégation** : <statut> — détail
- **C4 Schémas** : <statut> — détail

## Préconditions à lever avant turnlockisation

(Section affichée uniquement si au moins un Cx est OK-WITH-PRECONDITION. Consolide toutes les préconditions en checklist actionnable, dans l'ordre de levée recommandé.)

- [ ] **<nom court>** (C<x>) — <action concrète en une phrase> | <cible: fichier/module> | <estimation: ≤N lignes ou bornée par scope>
- [ ] **<nom court>** (C<x>) — …

Chaque item doit être :
- Un verbe d'action ("Formaliser la sortie JSON", "Extraire les 3 lignes mécaniques de la phase récolte", "Split la phase hybride 6")
- Rattaché au Cx qui l'exige
- Borné dans sa portée (pas de "refactor complet")

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
- "Turnlockiser directement : commencer par <phase TS pure initiale>"
- "Lever d'abord les préconditions <noms courts> (section ci-dessus), puis turnlockiser"
- "Ne pas turnlockiser : ajouter un script bash `finalize` en sortie pour la mécanique"
- "Débloquer C<x> avant tout : <quel couplage / quel redesign>"
```

## Règles de conduite

- **Ne jamais deviner la structure d'une couche** sans avoir lu le fichier source. Si un skill/agent n'est pas accessible → le signaler, ne pas inventer.
- **Citer les lignes précises** du skill/agent qui justifient un pattern B1/B2/B3 ou un échec de Cx. Pas d'affirmation en l'air.
- **Jamais de citation de mémoire pour une memory utilisateur.** Avant de citer une entrée de mémoire (`~/.claude/projects/*/memory/*.md` ou équivalent) comme justification d'un argument, lire son contenu complet et vérifier que son champ d'application couvre réellement le skill/agent évalué. Beaucoup de memories ont des clauses d'exclusion ("Ne vaut PAS pour : ...") qui invalident leur portée sur le cas courant. Si la memory n'est pas lisible → ne pas la citer, argumenter sur les mérites propres du cas.
- **Ne pas surestimer C0** : un skill qui enchaîne N étapes de jugement linéaires dans un même contexte n'est pas B1 (il n'y a pas de frontière de process). B1 implique **vraiment** une délégation à un ou plusieurs sub-agents/sub-skills avec agrégation mécanique.
- **Ne pas précipiter C0'** : un verdict C0' NON doit obligatoirement passer par l'énumération (3a) des candidats de décomposition. Un "aucun candidat cheap" lâché sans avoir mentalement listé les options (haiku sur diff, sonnet sur classification, TS pur sur mécanique) est une évaluation paresseuse. Le bon format d'un NON est soit "aucun candidat identifiable après énumération", soit "candidat X killed sur volume/fréquence".
- **Discipline OK-WITH-PRECONDITION** : utiliser ce statut pour les Cx dont la condition tient en l'état actuel moyennant un changement **trivial et borné** (≤ ~50 lignes, pas de changement de contrat externe). Ne pas en faire une cachette pour des refactors non-triviaux — si la précondition demande d'élucider un couplage caché, de redesigner une phase, ou touche plus que la cible évaluée, c'est KO, pas OK-WITH-PRECONDITION. Chaque précondition listée doit être nommable en une phrase d'action concrète et apparaître dans la section "Préconditions à lever" du verdict.
- **Demander en cas d'ambiguïté** : fréquence d'invocation, volume typique, contraintes de déterminisme non documentées. Ne pas deviner.
- **Ne pas coder la transformation** — uniquement l'évaluer et la projeter. La mise en œuvre est hors scope de ce skill.
- **Si la cible est déjà turnlockisée** : signaler et sortir — rien à évaluer.

## Références

Ce skill est dérivé de `docs/ADOPTION-FROM-SENIOR-REVIEW.md` du projet turnlock. En cas de doute ou d'évolution des critères, consulter ce doc comme source de vérité.
