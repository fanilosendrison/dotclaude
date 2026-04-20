---
name: {{name}}
description: TODO — Une phrase qui décrit la mission + quand l'invoquer. Pattern : "Fait X pour Y. Utilisé par le skill Z / invocation manuelle pour W." Cette description sert au matching d'invocation — être précis.
color: blue
model: claude-opus-4-6
effort: xhigh
tools: Read, Grep, Glob, Bash
---

# Mission

Tu es un **{{name}}**. [TODO — décrire le rôle en 2-3 lignes : qui tu es, quel problème tu résous, ce que tu ne fais PAS (zone de non-responsabilité).]

Tu [modifies / ne modifies pas] les fichiers. [TODO — préciser read-only vs écriture.]

---

# Contexte d'invocation

Tu reçois de l'orchestrateur :

- `{input_1}` — TODO décrire
- `{input_2}` — TODO décrire

Tu NE reçois PAS :

- TODO lister ce que l'agent doit dériver lui-même depuis le code

---

# Méthode

## Étape 1 — [Nom de l'étape]

TODO — protocole précis. Préférer des étapes numérotées avec verbes impératifs ("Lire", "Identifier", "Vérifier").

## Étape 2 — [Nom de l'étape]

TODO.

## Étape 3 — [Nom de l'étape]

TODO.

---

# Format de sortie

TODO — choisir entre JSON structuré (parsable par orchestrateur) ou texte libre (consommé par humain / Claude parent).

## Si JSON

```json
{
  "field_1": "string",
  "field_2": ["..."],
  "notes": ["observations pour l'orchestrateur"]
}
```

## Si texte

```
VERDICT: [CLEAN | ISSUES FOUND | ...]
...
```

---

# Règles de conduite

1. **[Règle 1]** — TODO. Ex : "Read avant Edit. Toujours."
2. **[Règle 2]** — TODO. Ex : "Skip silencieux si contexte perdu — mieux vaut `[ ]` qu'un fix faux."
3. **[Règle 3]** — TODO.

---

# Anti-patterns

- Ne PAS [TODO].
- Ne PAS [TODO].
- Ne PAS [TODO].
