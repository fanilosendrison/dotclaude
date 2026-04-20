---
name: agent-creator
description: Crée un nouvel agent Claude Code (sub-agent) dans `~/.claude/agents/` (user scope) ou `.claude/agents/` (project scope). Scaffold un fichier `.md` unique avec frontmatter (name, description, tools, color, model, effort) + squelette de prompt (mission, méthode, format de sortie, règles de conduite). Use when the user says "crée un agent", "nouveau agent", "scaffold agent", "agent-creator", "create agent", or any variant requesting the creation of a new sub-agent. NOT for creating skills (see skill-creator) or CLI scripts (see script-creator).
---

# Agent Creator

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

## Anatomy d'un agent Claude Code

Un agent = **un seul fichier `.md`** dans `~/.claude/agents/<name>.md` (user) ou `.claude/agents/<name>.md` (project).

Pas de dossier, pas de ressources bundlées, pas de scripts externes. Tout tient dans le prompt.

### Frontmatter YAML

```yaml
---
name: my-agent                     # kebab-case, doit matcher le nom de fichier
description: Phrase unique qui décrit mission + quand invoquer (matching d'invocation)
color: blue                        # optionnel — couleur d'affichage (blue, red, purple, green, yellow, cyan, orange)
model: claude-opus-4-6             # optionnel — pin du modèle (sinon hérite de la session parent)
effort: xhigh                      # optionnel — pin de l'effort (low|medium|high|xhigh)
tools: Read, Grep, Glob, Bash      # allowlist — liste des tools autorisés
---
```

**Règles de sélection :**

- **`name`** — kebab-case, ≤64 chars, unique. Doit matcher le nom de fichier (sans `.md`).
- **`description`** — premier critère de matching quand Claude parent choisit `subagent_type`. Doit contenir : qui est l'agent, ce qu'il fait, **qui l'invoque** (skill X / invocation manuelle). Être précis.
- **`tools`** — minimum viable. `Read, Grep, Glob` pour read-only ; ajouter `Edit, Write, Bash` si l'agent modifie ou exécute.
- **`model` + `effort`** — à pinner si le sub-agent doit produire une qualité déterministe **indépendante** du modèle de la session parent (cas typique : orchestrateurs de boucles qualité, reviewers hostiles).
- **`color`** — cosmétique uniquement.

### Body (prompt système de l'agent)

Sections canoniques observées dans les agents existants (cf. `senior-reviewer-file.md`, `backlog-fix.md`) :

1. **`# Mission`** — rôle, périmètre, zone de non-responsabilité, read-only vs écriture.
2. **`# Contexte d'invocation`** — ce que l'agent reçoit de l'orchestrateur, ce qu'il NE reçoit pas (doit dériver).
3. **`# Méthode`** — étapes numérotées, verbes impératifs, protocole précis.
4. **`# Format de sortie`** — JSON structuré (parsable) ou texte libre (consommé par humain/Claude parent).
5. **`# Règles de conduite`** — invariants que l'agent DOIT respecter (Read avant Edit, skip si contexte perdu, scope strict, etc.).
6. **`# Anti-patterns`** — ce que l'agent NE DOIT PAS faire.

Garder le prompt sous ~500 lignes. Si ça déborde, le périmètre est probablement trop large — split en plusieurs agents spécialisés.

## Process de création

### Step 1 — Clarifier la mission

Répondre à ces questions avant d'écrire quoi que ce soit :

- **Qui invoque l'agent ?** Skill orchestrateur (ex : `senior-review` → `senior-reviewer-file`), invocation directe par Claude parent, ou les deux ?
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

Ouvrir le `.md` généré et remplir chaque TODO :

- **Frontmatter** — ajuster `description`, `tools`, optionnel `model`/`effort`/`color`.
- **Mission** — 2-3 lignes denses.
- **Contexte d'invocation** — lister inputs attendus et ce qui est hors-scope.
- **Méthode** — étapes numérotées avec verbes impératifs.
- **Format de sortie** — schéma JSON ou format texte, exemples concrets.
- **Règles de conduite** — 3-8 règles invariantes.
- **Anti-patterns** — ce que l'agent ne doit jamais faire.

Supprimer les sections vides si non pertinentes (ex : si l'agent n'est pas invoqué par un orchestrateur, la section `Contexte d'invocation` peut être réduite).

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

## Patterns observés dans les agents existants

### Pattern 1 — Sub-agent au service d'un skill

Ex : `senior-reviewer-file` (au service de `senior-review`), `backlog-fix` (au service de `backlog-crush`), `fix-file` (au service de `fix-or-backlog`).

- Reçoit un scope strict (liste de fichiers, liste d'items).
- Produit un JSON parsable par le skill parent.
- Règles de conduite strictes sur scope (ne PAS Edit hors scope).
- `model` et `effort` pinnés pour qualité déterministe.

### Pattern 2 — Explorer / researcher

Ex : `explore-codebase`, `explore-docs`, `websearch`.

- Read-only (`tools: Read, Grep, Glob` ou équivalents).
- Input = question ouverte, output = synthèse texte.
- Pas d'effets secondaires.
- Thoroughness paramétrable en prompt.

### Pattern 3 — Orchestrateur de boucle

Ex : `loop-clean-orchestrator`, `backlog-crush-orchestrator`.

- Pinne `model` + `effort` pour isoler la qualité du modèle de la session parent.
- Tools larges (`Bash, Read, Edit, Write, Grep, Glob, Agent`).
- Exécute un pipeline déterministe avec script bash de décision.

## Anti-patterns à éviter

- **Description vague** — "Helps with code review" est inutile. Dire qui invoque, quoi, comment.
- **Tools trop larges** — ne donner `Edit, Write, Bash` que si vraiment nécessaire. Principe du moindre privilège.
- **Pas de format de sortie** — un agent sans schéma de sortie produit du texte inconsommable par son parent.
- **Périmètre cross-cutting** — un agent qui "fait plusieurs choses" → split en plusieurs agents spécialisés.
- **Prompt > 500 lignes** — signal que la mission est trop large ou mal découpée.
- **Effets croisés** si parallélisable — un agent dispatché en parallèle doit être stateless (pas d'écriture sur un fichier partagé, pas de mutation d'état global).

## Ne PAS créer (règle héritée de skill-creator)

Pas de README.md, CHANGELOG.md, INSTALLATION_GUIDE.md dans le skill lui-même. L'agent est un seul `.md`, pas un projet.
