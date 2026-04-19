# TEMPLATE — CLAUDE.md projet

Ce fichier est un template. Le mainteneur le remplit à partir de `EVAL_STACK.yaml`
(déjà présent à la racine du projet) et du contexte du projet, puis le renomme en `CLAUDE.md`.

Les règles universelles sont dans `~/.claude/CLAUDE.md` et `~/.claude/skills/`.

Deux types de champs à remplir :
- `[YAML]` → recopie directe depuis `EVAL_STACK.yaml → decisions.*`
- `[INFER]` → déduire du projet, des specs, ou demander au mainteneur

---

## Contexte

[INFER] Déduire du contenu du projet, des specs, ou demander au mainteneur.

**Nom du projet :**
**Description :**

Exemples :
- my-service — Backend HTTP pour l'app X
- budget-tracker — API de gestion de budgets personnels

**Propriétés fondamentales** (guident tous les arbitrages, voir `~/.claude/CLAUDE.md` §Arbitrages) :
-
-
-

Exemples :
- Moteur auditable : reproductibilité, auditabilité cryptographique, immutabilité
- App grand public : temps de réponse < 200ms, sécurité des données, accessibilité

---

## Stack technique

[YAML] Recopier depuis `EVAL_STACK.yaml → decisions.*`

| Clé YAML | Valeur |
|-----------|--------|
| `language` | |
| `runtime` | |
| `package_manager` | |
| `framework` | none si absent |
| `containerization` | DOCKER ou NO-DOCKER |
| `database` | none si absent |
| `test_runner` | |
| `linter` | |
| `sast` | none si absent |
| `ci` | none si absent |

[INFER] Les champs ci-dessous ne sont pas dans EVAL_STACK.yaml.
Déduire de l'écosystème du langage ou demander au mainteneur.
Écrire "non requis" ou "intégré au langage" si non applicable.

| Rôle | Outil |
|------|-------|
| Tests de propriété | |
| Vérification de types | |

Exemples par écosystème :
- TS : fast-check, tsc --noEmit
- Python : hypothesis, mypy
- Rust : proptest, (intégré)
- Go : gopter, (intégré)

**Commandes de vérification** — Claude Code les lance avant de conclure toute tâche :

```bash
#
```

Exemples (le préfixe dépend du package_manager) :
- Bun/TS : `bun test` / `bunx biome check src/` / `tsc --noEmit`
- Python/uv : `uv run pytest tests/ -v` / `uv run ruff check src/` / `uv run pyright src/`
- Python/poetry : `poetry run pytest tests/ -v` / `poetry run ruff check src/`
- Python/pip : `.venv/bin/pytest tests/ -v` / `.venv/bin/ruff check src/`
- Python + SAST : ajouter `<prefix> bandit -r src/` ou `<prefix> semgrep scan src/`
- Rust : `cargo test` / `cargo clippy`

---

## Structure du projet

[INFER] Adapter l'arborescence ci-dessous. C'est un point de départ, pas un dogme.
Supprimer ce qui ne s'applique pas, ajouter ce qui manque.
`decisions.containerization` dans EVAL_STACK.yaml indique si les fichiers conteneur sont requis.

Si `src/` n'existe pas encore (projet doc-only) → ne pas inventer de structure code.
Lister uniquement les fichiers existants + un placeholder pour `src/`.

```
<nom-du-projet>/
│
│   # ── Code source (la structure interne de src/ est libre) ──
├── src/
│   ├── domain/              # Logique métier pure — ZÉRO dépendance externe
│   ├── infra/               # Implémentations concrètes, I/O, APIs externes
│   └── ...                  # Ajouter selon le projet : engine/, app/, api/, cli/, etc.
│
│   # ── Tests (REQUIS) ──
├── tests/
│   ├── unit/
│   ├── integration/         # Optionnel au démarrage
│   └── conformance/         # Optionnel — si le projet a des specs formelles
│
│   # ── Documentation ──
├── docs/                    # Optionnel
├── specs/                   # Optionnel — si le projet a des specs formelles
│
│   # ── Configuration projet ──
├── <manifeste dépendances>  # REQUIS — déduit de decisions.package_manager
├── <fichier de lock>        # REQUIS — déduit de decisions.package_manager
├── <fichier conteneur>      # Seulement si decisions.containerization = DOCKER
├── <fichier orchestration>  # Seulement si decisions.containerization = DOCKER
├── .gitignore               # REQUIS
├── .env.example             # REQUIS si le projet utilise des secrets
├── EVAL_STACK.yaml          # Lecture seule
├── CLAUDE.md                # Ce fichier
└── README.md                # REQUIS
```

Exemples de structures `src/` adaptées :

```
# Séparation moteur / application
src/
├── engine/
│   ├── domain/
│   └── infra/
└── app/

# API simple
src/
├── domain/
├── infra/
└── api/

# CLI avec logique métier
src/
├── domain/
├── infra/
└── cli/

# Monorepo
packages/
├── core/src/
├── cli/src/
└── web/src/
```

### Principes structurels

Ces principes s'appliquent quelle que soit l'organisation choisie :

- **Séparation domain / infra** : `domain/` n'importe JAMAIS de dépendance externe.
  Seule la bibliothèque standard du langage est autorisée.
  `infra/` implémente les interfaces définies par le domaine.
- **Un fichier = un concept cohérent.** Test : si le nom du fichier décrit fidèlement
  tout son contenu, c'est bon. Si du contenu ne correspond plus au nom, découper.
- **L'arborescence est un choix explicite.** Claude Code ne doit pas inventer une
  structure — suivre celle définie ici. Si elle ne convient plus, le signaler
  au mainteneur avant de réorganiser.

---

## Conventions de nommage

[INFER] Dépend de `decisions.language` mais les conventions exactes sont un choix d'équipe.

| Élément | Convention |
|---------|-----------|
| Fichiers | |
| Classes/Types | |
| Fonctions/Méthodes | |
| Variables | |
| Constantes | |
| Interfaces | |

Conventions courantes par langage :
- Python : fichiers `snake_case.py`, classes `PascalCase`, fonctions `snake_case`, constantes `UPPER_SNAKE_CASE`, interfaces préfixe `I`
- TypeScript : fichiers `kebab-case.ts`, classes `PascalCase`, fonctions `camelCase`, constantes `UPPER_SNAKE_CASE`, interfaces préfixe `I`
- Rust : fichiers `snake_case.rs`, structs `PascalCase`, fonctions `snake_case`, constantes `UPPER_SNAKE_CASE`, traits sans préfixe
- Go : fichiers `snake_case.go`, types `PascalCase`, fonctions `camelCase` (exported `PascalCase`), constantes `PascalCase`

---

## Spécifications

[INFER] Si le projet n'a pas de specs formelles, supprimer cette section entière.

Exemples de projets avec specs :
- "Piloté par SN-CORE-01 à SN-CORE-07+"
- "Suit la spec OpenAPI définie dans specs/api.yaml"
- "Implémente le protocole MCP v1.2"

Projets sans specs (supprimer la section) : side project, PoC exploratoire, outil interne sans doc formelle.

Si la section est conservée, ces règles s'appliquent :

- Doute sur le comportement attendu → consulter la spec avant de coder.
- Spec ambiguë → signaler au mainteneur, ne pas interpréter librement.
- Les specs sont dans `specs/` et sont en lecture seule.
- Les valeurs définies par les specs sont en dur dans le code, c'est voulu.

---

## Règles spécifiques au projet

[INFER] Règles propres à CE projet, qui ne s'appliquent pas aux autres.
Écrire "Aucune pour l'instant." si rien de spécifique.

Exemples par type de projet :

Moteur auditable :
- Les logs d'exécution doivent être associables à un RunSpec
- Toute opération crypto utilise SHA-256, jamais d'alternative
- Les artefacts produits sont immutables, jamais modifiés après création

API :
- Les réponses suivent le format JSON:API
- Chaque endpoint a un test d'intégration avec un cas nominal + un 4xx
- Rate limiting obligatoire sur les routes publiques

CLI :
- Toute commande a un --help et un --json pour les sorties machine
- Exit codes documentés dans docs/exit-codes.md
