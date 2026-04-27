---
name: new-cc-project-onboarder
description: Lance l'orchestrateur turnlock new-cc-project-onboarder qui vérifie les outils requis (git, gh, bun), les installe mécaniquement si manquants, délègue à un batch de sub-agents `installing-missing-tools-fallback` en cas d'échec mécanique, puis re-vérifie. Use when the user says "new-cc-project-onboarder", "onboard ce projet", "prépare la machine pour Claude Code", "install les prérequis", or any variant requesting host-machine bootstrapping for Claude Code project onboarding. Le main agent drive le protocole turnlock (parse stdout, dispatch sub-agents, écrit résultats, ré-invoque avec --resume) jusqu'à terminaison.
---

# /new-cc-project-onboarder — turnlock host driver

Tu es le **host** d'un orchestrateur turnlock. Ton rôle : lancer le binaire, parser ses sorties protocolaires `@@TURNLOCK@@`, exécuter les délégations qu'il demande, et le ré-invoquer jusqu'à terminaison clean.

## Binaire à lancer

```bash
bun ~/.claude/scripts/new-cc-project-onboarder/src/turnlock-orchestrator/main.ts
```

Initial run : pas de flags. Resume : `--run-id <id> --resume` (la commande exacte est fournie par le binaire dans chaque bloc `DELEGATE`).

## Protocole `@@TURNLOCK@@`

Chaque sortie du binaire contient **0 ou 1** bloc protocolaire entre `@@TURNLOCK@@` et `@@END@@`. Format :

```
@@TURNLOCK@@
version: 1
run_id: "<ulid>"
orchestrator: "new-cc-project-onboarder"
action: DELEGATE | DONE | ERROR | ABORTED
<champs spécifiques>
@@END@@
```

Tu dois capturer **exactement** ce bloc dans le stdout du binaire (les autres lignes sont du log à ignorer).

## Boucle de driver

Répéter jusqu'à `DONE`, `ERROR`, ou `ABORTED` :

1. Lance le binaire (initial run au 1er tour, sinon avec le `resume_cmd` du tour précédent).
2. Parse le stdout pour trouver le bloc `@@TURNLOCK@@`.
3. Branche selon `action:`

### action: DONE

Le binaire indique succès. Champ `output:` contient `{"ok":true}`. Affiche un résumé court à l'utilisateur ("✅ Onboarder terminé : tous les prérequis sont installés"), termine la skill.

### action: ERROR

Le binaire a rencontré une erreur fatale. Champs `error_kind:`, `message:`, `phase:`. Affiche le diagnostic à l'utilisateur (ex: "❌ Phase recheck a échoué : tools still missing after fallback: gh"). Termine la skill, n'appelle pas `git-commits-push` ou autre.

### action: ABORTED

Le binaire a été interrompu (SIGINT/SIGTERM). Indique à l'utilisateur qu'il peut reprendre via `bun ... --run-id <id> --resume`. Termine la skill.

### action: DELEGATE — le cœur du job

Champs à lire dans le bloc :
- `manifest:` — chemin absolu vers le JSON qui décrit le travail demandé
- `kind:` — `agent` | `agent-batch` | `skill` (pour cet orchestrateur, ce sera **toujours `agent-batch`**)
- `resume_cmd:` — la commande exacte à lancer après avoir écrit les résultats

**Étape D1 — Lire le manifest**

```bash
cat <manifest_path>
```

Le manifest est un JSON. Pour `kind: agent-batch` il contient (champs importants) :
- `agentType` — le nom du sub-agent à spawner (toujours `installing-missing-tools-fallback` ici)
- `jobs` — array de `{ id: string, prompt: string }`. Un par tool en échec.

**Étape D2 — Calculer le runDir**

`runDir = dirname(dirname(manifest_path))`. Tu en auras besoin pour écrire les résultats.

**Étape D3 — Spawner les sub-agents en parallèle**

**Une seule réponse, plusieurs invocations Agent** — c'est crucial pour le parallélisme. Émets dans le **même message** un appel `Agent(...)` par job :

```
Agent({
  subagent_type: <agentType du manifest>,
  description: "Install <job.id>",
  prompt: <job.prompt>
})
```

**Étape D4 — Extraire le JSON de chaque réponse**

Chaque sub-agent retourne un message markdown qui se termine par un bloc JSON (cf. son SKILL.md). Extrais ce bloc — c'est l'objet `{ name, status, version, method_used, error }`.

Si l'extraction échoue (JSON invalide ou absent), considère le sub-agent comme un échec et fabrique manuellement `{ name: <job.id>, status: "failed", version: null, method_used: "agent output unparseable", error: "<extrait du message>" }`.

**Étape D5 — Écrire les résultats sur disque**

Pour chaque job, écris son JSON à :

```
<runDir>/results/<label>-<attempt>/<job.id>.json
```

Où :
- `<label>` est lu depuis le manifest (`label` field, sera `"tools-fallback-batch"`)
- `<attempt>` est lu depuis le manifest (`attempt` field, généralement `0` au premier essai)
- `<job.id>` est le nom du tool

Crée le dossier intermédiaire si nécessaire : `mkdir -p <runDir>/results/<label>-<attempt>`.

**Étape D6 — Lancer le `resume_cmd`**

Le binaire reprend, lit les résultats du disque (validés par Zod), et continue les phases.

Retour à l'étape 1.

## Garde-fous

- **Limite de tours** : si la boucle dépasse 10 itérations sans terminer, stoppe et signale "boucle anormale" à l'utilisateur.
- **Stdout corrompu** : si tu ne trouves pas de bloc `@@TURNLOCK@@` valide, traite ça comme `ERROR`.
- **Sub-agent qui timeout** : tolère, marque-le `failed` et continue (le recheck final tranchera).
- **Ne reformate jamais** le `prompt` d'un job en sortie d'Étape D3 — passe-le verbatim au sub-agent. C'est le payload typé que l'agent attend.

## Hors scope

- Tu ne lances PAS les commandes `install_command` toi-même. C'est le job de l'orchestrateur (phase install).
- Tu n'interroges PAS l'utilisateur. L'install fallback est full-autonomous.
- Tu ne modifies PAS le state.json sur disque. Le runtime turnlock le gère.
- Tu n'invoques PAS d'autre skill / orchestrateur depuis ici (single-FSM).
