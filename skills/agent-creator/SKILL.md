---
name: agent-creator
description: Crée un nouvel agent Claude Code (sub-agent) dans `~/.claude/agents/` (user scope) ou `.claude/agents/` (project scope). Scaffold un fichier `.md` unique avec frontmatter (name, description, tools, color, model, effort) + squelette de prompt (mission, méthode, format de sortie, règles de conduite). Use when the user says "crée un agent", "nouveau agent", "scaffold agent", "agent-creator", "create agent", or any variant requesting the creation of a new sub-agent. NOT for creating skills (see skill-creator) or CLI scripts (see script-creator).
---

# Agent Creator

L'agent que tu crées est un **exécutant, pas un lecteur curieux**. Chaque ligne de son prompt doit : (a) donner un ordre clair, (b) ancrer un jugement qualitatif qu'aucun ordre ne peut substituer, ou (c) cadrer le mindset. Tout le reste — justification, historique, coordination avec skills adjacents — est du noise à supprimer.

## Agent vs Skill — choisir avant de scaffolder

Avant de créer un agent, confirmer que la tâche justifie l'isolation d'un sub-agent. Sinon → préférer un skill (plus simple, pas de nouveau contexte).

| Besoin | Outil |
|---|---|
| Procédure réutilisable qui s'exécute **dans** le contexte courant | **Skill** |
| Délégation avec **context window isolé** (grosse exploration → résumé revient) | Agent |
| **Parallélisme** (dispatcher N instances en même temps, ex : par fichier) | Agent |
| Besoin de **pinner un modèle/effort** indépendamment de la session parent (déterminisme) | Agent |
| Allowlist de tools restreinte pour la tâche | Agent |

Si aucune de ces raisons ne s'applique → **skill**, pas agent.

## Process de création

### Step 1 — Clarifier la mission

Répondre à ces questions avant d'écrire quoi que ce soit :

- **Qui invoque l'agent ?** Skill orchestrateur, invocation directe par Claude parent, ou les deux ?
- **Quels inputs ?** Liste exhaustive (paths, IDs, paramètres). Ce que l'orchestrateur fournit vs ce que l'agent dérive.
- **Quel output ?** JSON (si consommé par script/skill) ou texte (si consommé par humain/Claude). Préciser le schéma.
- **Read-only ou écriture ?** Conditionne `tools`.
- **Parallélisable ?** Si oui → l'agent DOIT être stateless (pas d'effets croisés entre instances).
- **Besoin de déterminisme ?** Si oui → pinner `model` + `effort`.

### Step 2 — Choisir le scope

- **user** (`~/.claude/agents/`) — agent réutilisable sur tous les projets.
- **project** (`.claude/agents/` du cwd) — agent spécifique au projet courant.

En cas de doute → user.

### Step 3 — Scaffolder

```bash
scripts/init_agent.sh <name> --scope user|project
```

Le script :

- Valide le nom (kebab-case, ≤64 chars, unique dans le scope).
- Crée le fichier `.md` depuis `assets/template-agent.md` avec substitution `{{name}}`.
- Refuse si un agent de même nom existe déjà dans le scope.

### Step 4 — Remplir le template

Ouvrir le `.md` généré et remplir chaque TODO. Les sections canoniques du body sont définies dans `assets/template-agent.md` — source unique de vérité pour la structure.

Pendant la rédaction, appliquer les **Principes de rédaction** (référence ci-dessous) et consulter les **Few-shot** (référence ci-dessous) pour les patterns courants.

### Step 5 — Tester

Invoquer l'agent depuis une session Claude Code :

```
Agent({
  subagent_type: "<name>",
  description: "Test run",
  prompt: "..."
})
```

Vérifier :

- L'agent respecte sa mission (pas de scope creep).
- Le format de sortie est stable.
- Les `tools` déclarés suffisent (pas de tool manquant qui force Claude à improviser).

Si itération nécessaire → éditer le `.md` directement, pas besoin de re-scaffolder.

## Référence — Anatomy du frontmatter

Un agent = **un seul fichier `.md`** dans `~/.claude/agents/<name>.md` (user) ou `.claude/agents/<name>.md` (project).

```yaml
---
name: my-agent                     # kebab-case, doit matcher le nom de fichier
description: Phrase unique qui décrit mission + quand invoquer (matching d'invocation)
color: blue                        # optionnel — couleur d'affichage
model: claude-opus-4-6             # optionnel — pin du modèle
effort: xhigh                      # optionnel — pin de l'effort (low|medium|high|xhigh)
tools: Read, Grep, Glob, Bash      # allowlist — liste des tools autorisés
---
```

**Règles de sélection :**

- **`name`** — kebab-case, ≤64 chars, unique. Doit matcher le nom de fichier (sans `.md`).
- **`description`** — premier critère de matching quand Claude parent choisit `subagent_type`. Doit contenir : qui est l'agent, ce qu'il fait, qui l'invoque.
- **`tools`** — minimum viable. `Read, Grep, Glob` pour read-only ; ajouter `Edit, Write, Bash` si l'agent modifie ou exécute.
- **`model` + `effort`** — à pinner si le sub-agent doit produire une qualité déterministe indépendante du modèle de la session parent (cas typique : orchestrateurs de boucles qualité, reviewers hostiles).
- **`color`** — cosmétique uniquement.

La structure des sections du body (Mission / Contexte / Méthode / Format de sortie / Règles de conduite / Anti-patterns) vit dans `assets/template-agent.md`. Éditer le template, pas cette page.

## Référence — Principes de rédaction du prompt

### Contenu

- **Zéro noise pédagogique.** Supprimer les justifications ("Pourquoi cette règle existe"), les contextes historiques, les explications de la structure du doc. L'agent exécute, il n'assimile pas.
- **Zéro coupling downstream.** Ne pas mentionner les skills/agents/orchestrateurs qui consomment la sortie de l'agent. Un périmètre stand-alone est plus robuste et plus facile à faire évoluer.
- **Instructions, pas descriptions.** Un bullet descriptif ("Assertions tautologiques") n'est pas actionnable ; un trigger d'émission ("Émettre un finding pour chaque assertion tautologique") l'est. Convertir systématiquement.
- **Test d'actionnabilité.** Si retirer une ligne ne change pas l'exécution, la retirer.

### Structure

- **Zéro forward reference.** Tout ce dont une section a besoin doit venir AVANT elle. Calibration, sévérités, gates, glossaire → en tête, pas en annexe. Les sections d'exécution sont lues quand leurs outils sont déjà connus.
- **Cadrage en TOP.** Mindset (hostile, méfiant, strict, read-only), règles de conduite, zone de non-responsabilité → dès le début. Ce qui colore toute la lecture se lit d'abord, pas en conclusion.
- **Grouper par phase d'exécution**, pas par liste plate d'items. Une séquence (récolte → analyse → émission → consolidation) donne à l'agent un workflow mental au lieu d'une énumération fatigante.
- **Pas de scratch mental pour un LLM.** Un signal qui doit persister entre sections doit être émis dans les tokens générés (ex : phase "Récolte" qui produit un inventaire explicite). Les LLMs n'ont pas de scratchpad invisible — ce qui n'est pas écrit se perd.

### Langage

Registre hybride calibré, pas normatif intégral ni purement qualitatif :

- **Normatif strict** (DOIT / NE DOIS PAS) pour les règles dures : conduite, gates, conditions bloquantes, zone de non-responsabilité.
- **Impératif avec trigger** ("Émettre X pour chaque Y") pour les sections d'exécution qualitative. Transforme une description passive en obligation d'action.
- **Question de protocole** ("Le déclencheur est-il plausible ?") répondue par l'agent via une sortie structurée, pas par un jugement implicite.

Règles additionnelles :

- **Bannir les questions rhétoriques.** "Le code gère-t-il les cas limites ?" invite l'agent à répondre "oui" et passer. Remplacer par instruction d'émission.
- **Minimiser les termes subjectifs** ("raisonnable", "plausible", "adjacent"). Les garder uniquement là où le jugement EST l'essence de la tâche (calibration hostile, review). Sinon, remplacer par critère testable.

### Calibration (si l'agent classifie, score, ou priorise)

- **Heuristique > liste d'exceptions.** Cas spéciaux → générer une heuristique générale (ex : plausibilité × impact) plutôt qu'une liste d'exceptions qui dérive à chaque nouveau cas. L'heuristique est maintenable, la liste non.
- **Gate explicite séparée de la calibration.** Une condition d'exclusion (ex : output non formulable → catégorie X) se nomme et précède la calibration, pas fusionnée dedans. Nommer la gate évite que l'agent la mélange avec les règles de score.
- **Asymétrie assumée entre sections.** Un protocole long ≠ une importance haute. Avertir l'agent explicitement : longueur ≠ pondération.
- **Délimitation positive ET négative.** Sur une frontière ambiguë entre deux catégories, fournir un exemple valide + un contre-exemple hors-périmètre. Les deux pôles ancrent la frontière.

### Few-shot (exemples dans le prompt)

- **Ajouter des exemples uniquement où le prior du modèle est faible** — sections spécialisées, frontières ambiguës, formats de sortie inhabituels. Zéro exemple sur les sections à prior fort : dilution sans signal.
- **Localité (proximité > groupage).** Un few-shot est inline dans la section qu'il ancre, pas groupé en annexe loin de son usage. Un exemple utile dans la section 3 stocké en section 10 est invisible au moment d'exécuter la section 3.
- **Exemples réels**, tirés du domaine visé, pas synthétiques. Calibre sur le domaine spécifique, pas sur des patterns génériques.
- **Exemples complets** : tous les champs du format de sortie + calibration explicitée ("plausibilité haute × corruption silencieuse → critical").

### Architecture du prompt

- **Séparation orchestration/exécution.** L'agent ne connaît pas son pipeline downstream (orchestrateur, hashes d'oscillation, consommateurs JSON). Tout ce qui est downstream est invisible à l'agent.
- **Source unique de vérité.** Si une info existe à deux endroits (frontmatter + body, SKILL + template, body + annexe), en choisir un (le plus proche du producteur) et référencer depuis l'autre.
- **Critère d'inclusion d'une section.** Une section mérite d'exister si : (a) classe distincte de failure modes ou de tâches, (b) requiert lecture sémantique non couverte ailleurs, (c) produit une sortie atomique formulable. Sinon → fusionner ou supprimer.
- **Dispatch vs monolithique.** Split en plusieurs agents quand les sous-tâches sont naturellement indépendantes (ex : un sub-agent par fichier). Garder monolithique quand les sections partagent des signaux (récolte commune, corrélations cross-section).

### Opérationnel (model, effort, coût)

- **Model et effort définis par la tâche, pas par défaut.** Analyser la charge cognitive réelle (multi-sections, mindset adversarial, savoir spécialisé, méta-raisonnement) avant de choisir.
- **Coût × fréquence > gain marginal.** Un upgrade modèle qui améliore de 5 % mais coûte 2× sur une tâche invoquée 100× par jour : pas rentable. Mesurer le volume réel avant d'upgrade.
- **Cohérence cross-pipeline.** Si tous les agents critiques d'un pipeline sont sur le même model, garder cette cohérence sauf justification forte (éviter les variances inter-agents sur les hashes d'oscillation).

### Méta

- **Mesure empirique > optimisation de wording.** Au-delà d'un certain point, les gains viennent de mesurer en prod (faux négatifs/positifs, oscillations, taux d'émission) pas de continuer à tight le wording.
- **Diff baseline après refactor.** Après restructuration non-triviale, diff le contenu vs l'état précédent. Préserver : labels, règles de conduite, phrases canoniques. Restructurer ≠ perdre du contenu.
- **Rotation > réécriture.** Pour réorganiser, privilégier le move de blocs existants plutôt que la réécriture. Diff lisible, perte minimisée.

## Référence — Few-shot : 3 agents réels

Trois patterns récurrents. Extraits de production — frontmatter complet + ouverture du body pour ancrer le registre.

### Pattern 1 — Sub-agent au service d'un skill

Reçoit un scope strict (liste de fichiers, liste d'items) via un orchestrateur. Produit un JSON parsable. Règles de conduite strictes (pas d'Edit hors scope). `model` + `effort` pinnés.

Exemple : `backlog-fix` (au service de `backlog-crush`) :

```yaml
---
name: backlog-fix
description: Applique les fixes d'items backlog (critical/major) depuis une description minimale. Reçoit scope_files + items avec {id, severity, file, line, description}. Effectue un re-discovery du problème depuis le code avant de fixer. Utilisé par le skill backlog-crush comme sub-agent par cluster de fichiers.
color: purple
model: claude-opus-4-6
effort: xhigh
tools: Read, Edit, Write, Grep, Glob, Bash
---
```

Ouverture du body :

> Tu es un **backlog-fix applier** au service du skill `backlog-crush`. Tu reçois de l'orchestrateur un **scope de fichiers** `{scope_files}` et une liste d'items backlog à corriger. [...] Ta tâche : **re-découvrir le problème** depuis le code puis appliquer le fix, en introduisant **zéro régression**.

Noter : registre tutoiement, inputs nommés entre `{}`, objectif final en gras, contraintes absolues en gras.

### Pattern 2 — Explorer / researcher

Read-only. Input = question ouverte, output = synthèse texte. Pas d'effets secondaires. Thoroughness paramétrable.

Exemple : `explore-codebase` :

```yaml
---
name: explore-codebase
description: Use this agent whenever you need to explore the codebase to realize a feature.
color: yellow
model: opus
---
```

Ouverture du body :

> You are a codebase exploration specialist. Your only job is to find and present ALL relevant code and logic for the requested feature.

Noter : pas de `tools` déclaré (allowlist par défaut), pas de `effort`, rôle phrasé en "your only job" → zone de non-responsabilité implicite. Registre sobre car agent générique à prior fort.

### Pattern 3 — Orchestrateur de boucle

Pinne `model` + `effort` pour isoler du model parent. Tools larges (inclut `Agent` pour dispatcher). Exécute un pipeline avec script bash de décision (séparation sémantique / technique).

Exemple : `loop-clean-orchestrator` :

```yaml
---
name: loop-clean-orchestrator
description: Agent orchestrateur du skill /loop-clean. Exécute la boucle post-implémentation coding-standards → senior-review → dedup-codebase → spec-drift → fix-or-backlog jusqu'à convergence CLEAN, détection d'oscillation, ou plafond d'itérations. Model et effort pinnés pour qualité déterministe indépendante du model de session parent.
color: blue
model: claude-opus-4-6
effort: xhigh
tools: Bash, Read, Edit, Write, Grep, Glob, Agent
---
```

Ouverture du body :

> Tu es l'**agent orchestrateur du skill `/loop-clean`**. Tu prends en charge la boucle complète de nettoyage post-implémentation et tu retournes un rapport markdown final à l'appelant. Ton model et ton effort sont pinnés (Opus 4.6, xhigh) pour garantir une qualité déterministe même si la session parent utilise un autre model.

Noter : la description liste la séquence exacte du pipeline + les conditions d'arrêt. Le body explicite **pourquoi** le pin (qualité déterministe cross-session) — seule place légitime pour une justification, car c'est un invariant critique de l'agent.

## Anti-patterns

### Frontmatter / périmètre

- **Description vague** — "Helps with code review" est inutile. Dire qui invoque, quoi, comment.
- **Tools trop larges** — ne donner `Edit, Write, Bash` que si vraiment nécessaire. Principe du moindre privilège.
- **Pas de format de sortie** — un agent sans schéma de sortie produit du texte inconsommable par son parent.
- **Périmètre cross-cutting** — un agent qui "fait plusieurs choses" → split en plusieurs agents spécialisés.
- **Prompt > 500 lignes** — signal que la mission est trop large ou mal découpée.
- **Effets croisés** si parallélisable — un agent dispatché en parallèle doit être stateless (pas d'écriture sur un fichier partagé, pas de mutation d'état global).

### Rédaction du prompt

- **Noise pédagogique** — justifications, historique, méta-commentaires sur la structure → supprimer.
- **Coupling downstream** — mention de l'orchestrateur, des hashes, du pipeline consommateur → supprimer.
- **Descriptions passives au lieu d'instructions** — "Assertions tautologiques" (description) vs "Émettre un finding pour chaque assertion tautologique" (instruction).
- **Forward reference** — utiliser une notion (sévérité, gate, glossaire) avant de la définir → re-ordonner pour tout poser en amont.
- **Questions rhétoriques** — "Le code gère-t-il les cas limites ?" invite à dire "oui" et passer → convertir en instruction d'émission.
- **Few-shot groupé loin de son usage** — un exemple utile dans la section 3 stocké en annexe = invisible au moment d'exécuter.
- **Duplication de règles** — même règle répétée dans frontmatter + body + template = 3 sources de vérité qui divergent. Choisir UNE source, référencer depuis les autres.
- **Termes subjectifs là où un critère testable existe** — "raisonnable", "plausible", "adjacent" n'ont leur place que là où le jugement EST l'essence de la tâche.

### Artefacts à ne pas créer

Pas de `README.md`, `CHANGELOG.md`, `INSTALLATION_GUIDE.md` à côté du fichier agent. L'agent est un seul `.md`, pas un projet.
