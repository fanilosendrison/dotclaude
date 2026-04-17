---
name: daily-summarizer
description: Orchestre le debrief de fin de journée — envoie /session-debriefer à toutes les sessions Claude Code tmux, attend la complétion, puis synthétise le journal du jour. Use when the user says "ferme le journal de bord", "clos le journal", "résumé de la journée", "daily summary", "journal du jour", "summarize the day", or any variant requesting a synthesis of the day's work sessions.
---

# Daily Summarizer

## Workflow

### 1. Exécuter le script d'orchestration

```bash
bash ~/.claude/skills/daily-summarizer/scripts/summarize-the-day.sh
```

Le script envoie `/session-debriefer` à chaque session tmux `claude-*` (sauf la courante), attend qu'elles soient idle, les ferme, et retourne un JSON sur stdout.

### 2. Agir selon le status retourné

- **`no_sessions`** : Informer l'utilisateur qu'aucune autre session n'a été trouvée. Demander s'il veut quand même lancer la synthèse du journal (il y a peut-être des entries raw de sessions fermées manuellement plus tôt).
- **`ok`** : Confirmer le nombre de sessions debriefées et le temps écoulé. Enchaîner directement avec l'étape 3.
- **`timeout`** : Signaler combien d'entries sont arrivées vs attendues. Demander à l'utilisateur s'il veut continuer avec les entries partielles ou attendre.

### 3. Synthétiser le journal du jour

#### 3a. Lire les fichiers raw du jour

```
~/.claude/journal/raw/YYYY-MM-DD_*.raw.md
```

- Lire tous les fichiers correspondant au pattern (un par session), triés par nom
- Si aucun fichier trouvé → signaler "Pas de débriefs enregistrés aujourd'hui, rien à synthétiser." et **ne rien générer**
- Utiliser la date du jour (pas un argument)

#### 3b. Générer le journal synthétisé

Écrire dans `~/.claude/journal/YYYY-MM-DD.md` :

```markdown
# Journal — <date en français, ex: 15 février 2026>

## Ce que j'ai fait
Résumé narratif des accomplissements concrets, regroupés par projet.
Pas une liste de fichiers — ce qui a été accompli fonctionnellement.

## Ce que j'ai appris
Compétences, concepts, outils découverts ou maîtrisés aujourd'hui.
Distinguer ce qui est nouveau de ce qui est approfondi.

## Décisions architecturales
Les choix qui engagent un projet. Pourquoi cette option et pas une autre.
C'est la mémoire de raisonnement — la plus précieuse à long terme.

## Points ouverts
Ce qui reste en suspens, à reprendre demain.
Sert de point d'entrée pour la prochaine journée.

## Signal portfolio
Ce qui aujourd'hui pourrait être montré à un recruteur technique
dans le cadre d'une candidature pour un poste d'architecte (5-10k EUR).
Un problème résolu élégamment, une spec finalisée, un pattern maîtrisé.
```

#### 3c. Contraintes de synthèse

- **Ton** : professionnel mais pas rigide, première personne
- **Longueur** : 200-500 mots max
- **Ne pas inventer** : section vide → l'omettre plutôt que broder
- **Le raw est conservé** : le journal propre ne remplace pas les fichiers raw

#### 3d. Push vers Notion

Après écriture du fichier journal, le pousser automatiquement vers Notion sous la page parente **Journal de bord Claude Code**.

1. Extraire le titre du journal (premier `# heading`) → propriété `title`
2. Retirer la ligne titre du contenu (Notion l'affiche déjà comme titre de page)
3. Appliquer les conversions Notion-flavored Markdown si nécessaire (cf. skill `md-to-notion` pour les règles : tables → XML, blockquotes multi-lignes → `<br>`, H5/H6 → H4)
4. Appeler `mcp__claude_ai_Notion__notion-create-pages` :

```json
{
  "parent": { "page_id": "3094357ef5ea8095bc26cca45399b074" },
  "pages": [
    {
      "properties": { "title": "<titre du journal>" },
      "content": "<contenu converti>"
    }
  ]
}
```

- **Page parente fixe** : `3094357ef5ea8095bc26cca45399b074` (Journal de bord Claude Code)
- Si le push échoue → signaler l'erreur mais ne pas bloquer (le fichier local est la source de vérité)

### 4. Confirmation

Afficher un résumé : nombre de sessions synthétisées, chemin du fichier produit, URL de la page Notion créée.

## Règles

- **Ne PAS debriefer cette session** : la session de synthèse ne se debriefe pas elle-même
- **Ne PAS exécuter /session-debriefer manuellement** : le script s'en charge via tmux
- Confirmer chaque étape à l'utilisateur avant de passer à la suivante
