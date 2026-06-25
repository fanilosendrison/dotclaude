---
name: extracting-transcripts-from-yt
description: Lance l'outil `yt-transcript` (projet `/Users/famillesendrison/Developper/Projects/youtube-to-text`) sur une URL YouTube fournie en argument. L'URL peut être une vidéo, une playlist, ou une chaîne — l'outil détecte le type et organise les transcripts dans `/Users/famillesendrison/Documents/transcripts-from-youtube/<channel>/[<playlist>/]`. Use when the user says "extracting-transcripts-from-yt", "extract transcript", "transcribe youtube", "transcrit cette vidéo youtube", "transcript de cette chaîne", "transcript playlist", or pastes a YouTube URL with the intent of getting its transcript.
---

# Extracting Transcripts from YouTube

Slash command qui exécute l'outil local `yt-transcript` sur une URL YouTube.

## Argument

Une URL YouTube unique. Trois formes acceptées :

- **Vidéo** : `https://www.youtube.com/watch?v=...`, `https://youtu.be/...`, `/shorts/`, `/live/`, `/embed/`
- **Playlist** : `https://www.youtube.com/playlist?list=PL...`
- **Chaîne** : `https://www.youtube.com/@...`, `/channel/UC...`, `/c/...`, `/user/...`

L'utilisateur peut aussi coller une URL "sale" avec `&list=`, `&t=`, `?si=` — l'outil canonicalise.

## Action

Exécuter cette commande unique avec l'URL passée en argument :

```bash
cd /Users/famillesendrison/Developper/Projects/youtube-to-text && PYTHONPATH=src .venv/bin/python -m yt_transcript.cli "<URL>" --lang auto
```

`--lang auto` est **toujours** passé par défaut (préférence utilisateur durable : il se fout du FR, veut juste la première piste de sous-titres dispo dans n'importe quelle langue ; évite aussi les 429 quand FR n'existe pas et que l'outil retry en boucle). Autres défauts de l'outil :

- Output dir : `/Users/famillesendrison/Documents/transcripts-from-youtube/<channel>/[<playlist>/]`
- Model Whisper : `medium`
- Skip-existing : on (idempotent)
- Shorts/Live : exclus
- Limit : illimité

Si l'utilisateur demande une variante supplémentaire (`--limit N`, `--force-whisper`, etc.), passer le flag en plus. S'il demande explicitement une autre langue (`--lang fr`, `--lang en`), remplacer `--lang auto`.

**Anti-rate-limit (recommandé en cas de 429 récurrents)** : ajouter `--cookies-from-browser safari` (ou chrome/firefox/edge). Ça fait passer les requêtes pour un user loggué → quotas YouTube plus généreux. Si l'utilisateur dit "j'ai un 429" / "rate limit" / "ça bloque" / "trop de requests", proposer ce flag automatiquement.

## Sortie

Après exécution, rapporter brièvement à l'utilisateur :

- Le path du fichier `.md` produit (ou les paths pour playlist/chaîne)
- Combien de vidéos traitées / skippées / échouées
- Le temps écoulé

Si la commande échoue, montrer l'erreur exacte de l'outil. Ne pas paraphraser.

## Règles

- **Ne pas modifier** le code du projet `youtube-to-text` depuis ce skill — c'est juste un wrapper d'invocation.
- **Ne pas lancer** sans URL : si l'argument manque ou est vide, demander l'URL à l'utilisateur.
- **Ne pas re-traiter** une vidéo déjà transcrite (le skip-existing s'en charge ; ne pas ajouter `--overwrite` sans demande explicite).
- **Pour `--batch`** (liste d'URLs dans un fichier) : utiliser le flag `--batch <chemin>` au lieu de l'argument positionnel.
