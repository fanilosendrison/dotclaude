---
name: stack-evaluator
description: Use when the user says "évalue la stack", "quelle stack", "eval stack", "tech stack", "stack technique", "stack-evaluator", or any variant requesting a technical stack evaluation for a project. Reads repo files, evaluates the optimal stack across ~17 dimensions (11 tool choices + 6 hygiene validations), asks questions when signals are insufficient, and produces a machine-readable STACK_EVAL.yaml. Les libs applicatives (HTTP client, ORM, validation, auth, UI, logging, property testing, etc.) sont évaluées séparément par libs-evaluator.
---

# Stack Evaluator

Évalue la stack technique optimale d'un projet sur ~17 dimensions (11 choix d'outils + 6 validations d'hygiène) et produit un `STACK_EVAL.yaml` machine-readable à la racine.

**Scope** : `stack-evaluator` couvre uniquement les **méta-choix structurants** (langage, runtime, framework, DB, test runner, linter, SAST, type checker, conteneurisation, isolation, deploy target, CI, monorepo tool). Les libs applicatives (schema validation, ORM, HTTP client, auth, UI framework, styling, logging, property testing, etc.) sont évaluées par `libs-evaluator` en aval, qui consomme `STACK_EVAL.yaml`.

## Philosophie d'évaluation

**Claude Code automatise tout.** Les heuristiques ne prennent JAMAIS en compte :
- Le coût cognitif (Claude le porte)
- Le temps de setup (Claude le fait en secondes)
- La friction temporelle (Claude est infatigable)
- La vitesse d'exécution (non-critère sauf besoin explicite du projet)

Les heuristiques évaluent UNIQUEMENT sur :
- **Correctness technique** — c'est la bonne solution pour ce type de projet
- **Reproductibilité** — ça marchera sur une autre machine / dans 6 mois
- **Isolation** — protection contre les conflits de dépendances / d'environnement
- **Best practice** — le pattern standard du domaine le recommande
- **Sécurité** — réduction de la surface d'attaque
- **Scalabilité réelle** — si le projet grossit, on sera content de l'avoir fait dès le départ

Conséquence : le skill est **agressif** sur Docker, venv, CI, linting, etc. La solution techniquement supérieure est toujours préférée.

## Workflow

### 0. Vérifier si STACK_EVAL.yaml existe déjà

- Si `--force` passé en argument → ignorer le fichier existant, réévaluer tout
- Si le fichier existe et pas de `--force` → le lire, informer l'utilisateur, demander s'il veut réévaluer
- Si absent → continuer

### 1. Charger le contexte de l'index (si disponible)

Si `PROJECT_INDEX.md` et/ou `SPEC_MANIFEST.md` existent à la racine du projet, les lire **avant** le scan passif. Sur un repo sans code (uniquement docs/specs), ces fichiers sont la source principale de contexte pour déduire la stack :

- **SPEC_MANIFEST.md** → scope des specs, dépendances inter-specs, patterns `validates` → permet de déduire les modules, les besoins techniques (auth, DB, API, temps réel, etc.)
- **PROJECT_INDEX.md** → architecture visée, type de projet, modules principaux → permet de déduire `project_type`, `framework`, `database`, etc.

Si aucun des deux n'existe → passer directement au scan passif (step 2). Le skill fonctionne sans, mais avec moins de contexte sur les repos doc-only.

### 2. Scan exhaustif — Lire TOUS les fichiers du repo

**RÈGLE NON-NÉGOCIABLE : le contenu intégral de CHAQUE fichier texte du repo DOIT avoir été lu avant la déduction.** Ne pas se contenter d'une liste de fichiers-signal. Ne pas inférer le contenu d'un fichier sans l'avoir lu. Ne pas "résumer" en lisant 3-4 fichiers clés.

**Exception — contexte déjà chargé** : si le stack-evaluator est invoqué après le repo-indexer dans la même conversation (typiquement via `claude-project-setup`), les fichiers lus pendant l'indexation sont déjà dans le contexte. Dans ce cas, ne relire que les fichiers qui n'ont PAS été lus précédemment. Vérifier en comparant la liste `git ls-files` avec les fichiers déjà en contexte.

**Procédure** :

1. **Lister** tous les fichiers du repo : `git ls-files` (ou glob récursif si pas encore de commits)
2. **Classifier le repo** :
   - **Doc-only** : 0 fichiers code source, uniquement `specs/`, `docs/`, configs → aller au step 2 (optimisé)
   - **Avec code** : fichiers `.py`, `.ts`, `.go`, `.rs`, etc. présents → aller au step 2 (standard)
3. **Exclure** uniquement :
   - Fichiers binaires (images, fonts, `.woff`, `.png`, `.jpg`, `.ico`, `.pdf`, etc.)
   - Lockfiles volumineux (`bun.lockb`, `yarn.lock`, `pnpm-lock.yaml`, `package-lock.json`, `poetry.lock`, `Cargo.lock`) — pour ceux-ci, noter leur **présence** (c'est un signal) mais ne pas lire le contenu
   - Répertoires générés (`node_modules/`, `dist/`, `build/`, `.next/`, `__pycache__/`, `.venv/`, `target/`)
4. **Lire** le contenu intégral de tous les fichiers restants non encore en contexte — specs, docs, configs, code source, scripts, CI, Dockerfile, README, `.env.example`, `.gitignore`, etc.
5. **Déléguer la lecture à un agent** pour paralléliser et protéger le contexte principal :
   - Utiliser le **Task tool** avec `subagent_type: general-purpose` pour lire tous les fichiers en un seul appel
   - Le prompt de l'agent doit lister explicitement les fichiers à lire et demander un résumé structuré orienté "contraintes techniques" : types numériques, sérialisation, portabilité, dépendances, API surface, précision, concurrence
   - L'agent lit les fichiers en parallèle dans son propre contexte et renvoie une synthèse compacte
   - **Avantage** : les fichiers volumineux (specs de 15+ pages) ne polluent pas le contexte principal du stack-evaluator, seul le résumé structuré y entre
   - **Fallback** : si le repo a < 5 fichiers texte à lire, les lire directement avec Read (pas besoin d'agent pour si peu)

#### Optimisation doc-only

Sur un **repo doc-only** (0 fichiers code source), le scan peut être accéléré si `SPEC_MANIFEST.md` existe (généré par le repo-indexer au Step 2 de `claude-project-setup`) :

1. Lire `SPEC_MANIFEST.md` → liste exhaustive des specs avec scope, dépendances, et cross-refs
2. Lire `PROJECT_INDEX.md` → architecture visée, type de projet
3. **Ne déléguer à un agent QUE les specs normatives** (fichiers dans `specs/` avec frontmatter `status: approved`) — ce sont les seuls fichiers contenant des contraintes techniques exploitables
4. **Skip les docs explicatifs** (fichiers dans `docs/` sans frontmatter, ou avec `status: draft`) — ils contiennent du contexte stratégique/pédagogique, pas des contraintes techniques. Les lire uniquement si les specs normatives ne fournissent pas assez de signaux pour toutes les dimensions.
5. **Skip les configs déjà connues** (`.gitignore`, `cliff.toml`, `.gitattributes`) — aucun signal de stack dans ces fichiers.

**Gain** : sur un repo avec 8 specs normatives + 5 docs explicatifs, on ne lit que les 8 specs au lieu de 13 fichiers. Les specs étant les plus longues (15-30 pages chacune), l'économie de tokens est significative.

**Garde-fou** : si le résumé de l'agent ne couvre pas assez de dimensions (< 3 signaux trouvés), relire les docs explicatifs en fallback.

**Pourquoi tout lire (repos avec code)** : sur un repo avec du code, un fichier obscur peut contenir un signal décisif. Le coût de lecture est négligeable, le coût d'un signal manqué est une mauvaise décision de stack.

Consulter aussi `references/signals.md` pour la cartographie fichier → signal par dimension, mais ne pas s'y limiter — signals.md est un guide d'interprétation, pas une liste exhaustive de ce qu'il faut lire.

### 2b. Contraintes normatives — Filtres éliminatoires

**Si le projet contient des specs (`specs/`, `docs/` avec frontmatter, ou toute documentation normative), cette étape est OBLIGATOIRE avant la déduction.**

Scanner les specs pour des exigences techniques qui **éliminent** certains langages/runtimes ou **imposent** des choix de stack. Ces contraintes ont priorité absolue sur les heuristiques de recommandation — un langage éliminé par une spec ne peut pas être recommandé, même s'il est le meilleur choix sur toutes les autres dimensions.

**Patterns à chercher** (voir `references/signals.md` § "Spec-Derived Constraints" pour la liste complète) :

1. **Type system du runtime** — le runtime doit-il distinguer des types que certains langages unifient ? (int vs float, null vs undefined, etc.)
2. **Sérialisation/désérialisation native** — des contraintes sur le comportement de `JSON.parse`/`JSON.stringify` ou équivalent qui excluent certains runtimes ?
3. **Précision numérique** — contraintes sur les entiers au-delà de 2^53, sur la précision décimale, sur le comportement d'arrondi ?
4. **Modèle de concurrence** — le projet requiert-il du parallélisme réel, des goroutines, de l'async natif, du multi-threading ?
5. **Portabilité / distribution** — clone → run en une commande, binaire standalone, WASM, cross-compilation ?
6. **Dépendances système** — le projet interdit-il les dépendances non incluses dans le repo ?

**Procédure** :

1. Lire chaque spec (déjà fait au step 2) en cherchant les mots-clés : DOIT, INTERDIT, types, runtime, sérialisation, entier, flottant, int, float, précision, portabilité
2. Pour chaque contrainte trouvée, évaluer quels langages la respectent nativement vs nécessitent un contournement
3. Classer chaque langage impacté selon deux niveaux :
   - **`eliminates`** : le langage ne peut PAS respecter la contrainte, même avec un contournement raisonnable. Exemple : JS/TS n'a qu'un type `number` — impossible de distinguer int/float à la désérialisation JSON standard.
   - **`eliminates_with_caveat`** : le langage PEUT respecter la contrainte mais uniquement via un pattern non-standard qui ajoute de la complexité. Exemple : Go peut distinguer int/float via des structs typés, mais `json.Unmarshal` dans une `interface{}` perd la distinction. Le contournement existe mais n'est pas le chemin par défaut.
4. Si la spec interdit explicitement les conventions d'application → `eliminates_with_caveat` devient `eliminates`
5. Documenter les contraintes trouvées dans `rationale.spec_constraints` du STACK_EVAL.yaml

**Si aucune spec** → skip cette étape.
**Si specs sans contrainte technique détectée** → noter "aucune contrainte normative sur la stack" dans rationale et continuer.

### 3. Déduction — Appliquer les heuristiques

Pour chaque dimension (voir `references/decision-axes.md`), évaluer :
1. Quels signaux sont présents
2. Quelle valeur ils indiquent
3. Niveau de confiance : `high` | `medium` | `low`

**Règles de confiance** :
- `high` = signal explicite et sans ambiguïté (Dockerfile présent → DOCKER)
- `medium` = signaux indirects convergents (plusieurs indices pointent dans la même direction)
- `low` = aucun signal clair, ou signaux contradictoires

### 3b. Résolution de version — Language & Runtime

Après la déduction des dimensions `language` et `runtime`, résoudre leurs versions :

**Étape 1 : Scanner les signaux de version** (voir `references/signals.md` § "Language & Runtime Versions")
- Fichiers dédiés : `.nvmrc`, `.python-version`, `rust-toolchain.toml`, `.tool-versions`, etc.
- Manifestes : `package.json` → `engines`, `pyproject.toml` → `requires-python`, `go.mod` → directive `go`, etc.
- Docker/CI : `Dockerfile` → tag de l'image `FROM`, GitHub Actions → `*-version`

Si un signal est trouvé → `version_strategy: PINNED`, version = celle détectée, confiance = celle du signal.
Si plusieurs signaux contradictoires → signaler le conflit, recommander d'aligner.

**Étape 2 : Recherche web si aucun signal** (projet neuf ou version non déclarée)

Utiliser l'agent `websearch` (Task tool, `subagent_type: websearch`) pour chaque recherche. L'agent isole les résultats du contexte principal et peut fetch les pages officielles pour extraire la version exacte.

1. Déterminer la stratégie selon `project_type` :
   - `web-app` / `api` / `cli-tool` → `LTS`
   - `library` → `LTS` + `version_constraint` large
   - `script` → `LATEST`
2. Agent websearch → `"[runtime] current LTS version [année en cours]"` (ou `latest stable` si LATEST)
3. Si `deploy_target` est connu → agent websearch → `"[deploy_target] supported [runtime] versions [année en cours]"` → prendre min(LTS, max supportée par la plateforme). Si la plateforme impose une version inférieure à la LTS → `version_strategy: PINNED` et signaler la contrainte.
4. Recommander une version **majeure** (ex: `"22"`, pas `"22.11.0"`)

### 4. Évaluation proactive — Dimensions sans signal

Pour les dimensions sans signal (projet neuf, repo vide, pas de config), appliquer la recommandation par défaut de `references/decision-axes.md` basée sur le type de projet détecté.

### 5. Questions — Uniquement si nécessaire

Poser des questions UNIQUEMENT quand :
- Une dimension est en `low` confidence ET la décision a un impact structurel important
- Des signaux sont contradictoires
- Le projet est vide/neuf et l'objectif n'est pas clair

Utiliser `AskUserQuestion` avec des questions groupées par thème. Maximum 4 questions par round.

**Ne PAS poser de question si** :
- La confidence est `medium` ou `high`
- La dimension peut être inférée du contexte
- La valeur par défaut est safe et réversible

### 6. Écrire STACK_EVAL.yaml

Format strict :

```yaml
# Stack evaluation generated by stack-evaluator skill
# Do not edit manually — re-run /evaluate-stack to update

evaluated_at: "YYYY-MM-DDTHH:MM:SS"
project_type: "cli-tool | web-app | api | library | monorepo | script | other"
confidence: high | medium | low  # confidence globale (min des dimensions)

decisions:
  language:
    value: typescript
    version: "5.7"                   # version détectée ou recommandée
  runtime:
    value: bun
    version: "1.1"                   # version détectée ou recommandée
    version_strategy: LTS            # LTS | LATEST | PINNED
    version_constraint: ">=1.0"      # optionnel — surtout pour libraries
  package_manager: bun
  framework: none
  containerization: DOCKER | NO-DOCKER
  isolation: VENV | CONDA | DEVCONTAINER | NIX | NONE
  database: postgres | sqlite | mongo | redis | none
  test_runner: "bun:test"
  linter: biome
  sast: bandit | semgrep | none
  type_checker: tsc
  deploy_target: vercel | fly | railway | vps | local | none
  ci: github-actions | gitlab-ci | none
  monorepo_tool: turborepo | nx | lerna | none

validations:
  dependency_policy:
    manifest_present: true
    lock_file_present: true
    lock_used_in_docker: true  # ou N/A si NO-DOCKER
    dev_deps_separated: true
  secrets_management:
    no_secrets_in_code: true
    env_in_gitignore: true  # ou N/A si pas de .env
    env_example_present: true  # ou N/A si pas de secrets
  repo_hygiene:
    gitignore_present: true
    build_artifacts_ignored: true
    deps_ignored: true
    secrets_ignored: true
    ide_files_ignored: true
    system_files_ignored: true

spec_constraints:               # présent uniquement si step 2b a trouvé des contraintes
  - spec: "SPEC-NORMATIVE §5.7"
    constraint: "Runtime DOIT distinguer int/float nativement à la désérialisation JSON"
    eliminates: [typescript, javascript]
    eliminates_with_caveat:        # optionnel — langages éliminables mais avec contournement possible
      - language: go
        caveat: "json.Unmarshal dans interface{} perd int/float, mais structs typés le préservent"
    rationale: "JS n'a qu'un type number (IEEE 754 double), JSON.parse ne distingue pas 42 de 3.14"

rationale:
  spec_constraints: "§5.7 impose int/float distincts nativement → élimine JS/TS"
  language: "Explication courte de pourquoi ce choix"
  language_version: "TS 5.7 — dernière stable, decorators natifs"
  runtime: "..."
  runtime_version: "Bun 1.1 — LTS, compatible deploy target"
  containerization: "..."
  sast: "..."
  # une entrée par dimension (decisions + validations si issues détectées)
  # language_version et runtime_version expliquent le choix de version
  # spec_constraints explique les filtres éliminatoires issus des specs
```

**Règles d'écriture** :
- Les valeurs dans `decisions` sont toujours en minuscules sauf les flags binaires (DOCKER/NO-DOCKER) et les stratégies d'isolation (VENV/CONDA/DEVCONTAINER/NIX/NONE)
- Les flags binaires sont en SCREAMING_CASE pour être grep-friendly
- `rationale` contient une phrase par dimension, pas un paragraphe
- `project_type` est inféré, pas demandé (sauf repo vide)

### 7. Ajouter STACK_EVAL.yaml au .gitignore — OBLIGATOIRE

**CETTE ÉTAPE EST NON-NÉGOCIABLE. NE JAMAIS LA SKIP, QUELLE QUE SOIT LA RAISON.**

`STACK_EVAL.yaml` est un artefact local généré par un outil. Il ne doit JAMAIS être versionné. C'est le même principe qu'un `node_modules/` ou un `.env` — on ne commit pas les outputs d'outils.

**Règles strictes** :
- Si `.gitignore` existe → ajouter `STACK_EVAL.yaml` s'il n'y figure pas déjà. Aucune exception.
- Si `.gitignore` n'existe pas → ne pas le créer (c'est le job de git-preflight)
- Ne jamais écraser ou reformater le `.gitignore` existant — append only
- Ne JAMAIS inventer de justification pour ne pas le faire (ex: "le fichier est utile à l'équipe", "il pourrait servir en CI", etc.). Ces raisonnements sont FAUX.
- Si l'ajout échoue pour une raison technique → le signaler explicitement à l'utilisateur comme un problème à résoudre

### 8. Afficher le récap

Afficher un récap compact et scannable :

```
## Stack Evaluation

| Dimension | Décision | Version | Stratégie | Confiance |
|-----------|----------|---------|-----------|-----------|
| language  | typescript | 5.7 | — | high |
| runtime   | bun | 1.1 | LTS | high |
| ...       | ... | — | — | ... |

### Validations

| Critère | Statut |
|---------|--------|
| dependency_policy | ✅ manifest + lock |
| secrets_management | ⚠ .env.example manquant |
| repo_hygiene | ✅ .gitignore complet |

Écrit dans STACK_EVAL.yaml
```

## Arguments

- `--force` : réévaluer même si STACK_EVAL.yaml existe
- `--dry-run` : afficher les décisions sans écrire le fichier
- (sans argument) : comportement par défaut

## Consommation par d'autres outils

Ce fichier est conçu pour être lu par d'autres skills, commandes ou scripts :

```markdown
# Dans un autre skill .md
Lire STACK_EVAL.yaml à la racine du projet.
Si absent → demander à l'utilisateur de lancer /evaluate-stack d'abord.
Si `decisions.containerization` = DOCKER → inclure un Dockerfile dans le scaffold.
```

```bash
# Dans un script bash
CONTAINER=$(yq '.decisions.containerization' STACK_EVAL.yaml)
```

## Références

- `references/signals.md` — Cartographie fichier → signal par dimension
- `references/decision-axes.md` — Dimensions, valeurs possibles, critères d'évaluation, defaults
