---
name: md-to-notion
description: Push a local .md file to Notion as a new page. Use when the user says "push to notion", "envoie sur notion", "md to notion", "md-to-notion", "push markdown notion", or any variant requesting to send a markdown file to their Notion workspace.
---

# md-to-notion — Push un fichier .md vers Notion

## Usage

```
/md-to-notion path/to/file.md
```

Argument : chemin absolu ou relatif vers un fichier `.md`.

## Flow

### 1. Valider l'entrée

- Vérifier que l'argument est fourni et que le fichier existe (Read tool).
- Si pas d'argument, demander le chemin du fichier.

### 2. Lire le fichier

- Lire le contenu complet du fichier `.md` avec le Read tool.

### 3. Extraire le titre

- Chercher le premier heading `# Titre` dans le contenu.
- Si trouvé : utiliser ce texte comme `title`, **retirer cette ligne du contenu** (Notion l'affiche déjà comme titre de page).
- Si pas de `# heading` : utiliser le nom du fichier sans extension comme titre.

### 4. Convertir en Notion-flavored Markdown

Le contenu doit être adapté au format Notion Markdown. Appliquer ces transformations :

#### Tables markdown → Tables XML Notion

Le markdown standard utilise des tables pipe (`| col1 | col2 |`). Notion utilise un format XML.

**Avant** (markdown standard) :
```
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |
```

**Après** (Notion markdown) :
```xml
<table header-row="true">
	<tr>
		<td>Header 1</td>
		<td>Header 2</td>
	</tr>
	<tr>
		<td>Cell 1</td>
		<td>Cell 2</td>
	</tr>
	<tr>
		<td>Cell 3</td>
		<td>Cell 4</td>
	</tr>
</table>
```

Règles de conversion des tables :
- La première ligne de données est le header → `header-row="true"`
- La ligne de séparateurs (`|---|---|`) est supprimée
- Chaque ligne de données → `<tr>` avec `<td>` pour chaque cellule
- Le contenu des cellules garde le rich text markdown (bold, italic, code, links)
- Utiliser des **tabs** pour l'indentation XML (pas des espaces)

#### Blockquotes multi-lignes

Notion interprète chaque `>` comme un blockquote séparé. Pour un blockquote multi-ligne, fusionner avec `<br>`.

**Avant** :
```
> Ligne 1
> Ligne 2
> Ligne 3
```

**Après** :
```
> Ligne 1<br>Ligne 2<br>Ligne 3
```

#### Headings 5 et 6

Notion ne supporte que H1-H4. Convertir `#####` et `######` en `####`.

#### Lignes vides

Les lignes vides standard sont supprimées par Notion. Si une ligne vide est intentionnelle (séparation visuelle), la remplacer par `<empty-block/>`.

En pratique : ne pas ajouter de `<empty-block/>` partout. La plupart des lignes vides entre blocs sont cosmétiques et Notion gère l'espacement automatiquement.

#### Ce qui marche tel quel (pas de conversion)

- `**bold**`, `*italic*`, `~~strikethrough~~`, `inline code`
- `[links](https://...)`
- Listes à puces (`-`) et numérotées (`1.`)
- Code blocks (` ``` `)
- Headings `#` à `####`
- Dividers `---`
- Checkboxes `- [ ]` et `- [x]`
- Images `![alt](url)` — **non supporté nativement**. Convertir en `<image source="url">alt</image>`

### 5. Push vers Notion

Appeler `mcp__claude_ai_Notion__notion-create-pages` avec :

```json
{
  "pages": [
    {
      "properties": { "title": "<titre extrait>" },
      "content": "<contenu converti>"
    }
  ]
}
```

Pas de `parent` → la page est créée comme page privée au workspace root.

### 6. Confirmer

Afficher à l'utilisateur :
- Le titre de la page créée
- L'URL Notion de la page (retournée par l'outil)
- Un résumé des conversions effectuées (tables converties, blockquotes fusionnés, etc.)

## Options avancées

Si l'utilisateur fournit une URL ou ID de page parente Notion :
```
/md-to-notion path/to/file.md --parent https://notion.so/...
```

Utiliser le `page_id` extrait de l'URL comme parent :
```json
{
  "parent": { "page_id": "<id>" },
  "pages": [...]
}
```

## Invariants

- Le fichier source n'est **jamais modifié**.
- Si le fichier est vide ou illisible, ne pas créer de page Notion — signaler l'erreur.
- Le titre est toujours présent (fallback sur le nom du fichier).
- Les code blocks ne sont **jamais** modifiés (pas d'échappement du contenu à l'intérieur).
