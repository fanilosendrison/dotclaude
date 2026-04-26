---
name: checking-required-tools-for-cc-project-onboarder
description: Vérifie que les outils requis par claude-project-onboarder sont installés sur le poste (macOS uniquement). Lance le script `required-tools-checker.ts` et restitue son verdict. Use when the user says "checking-required-tools-for-cc-project-onboarder", "check required tools", "vérifie les prérequis", "required tools check", "préchèque l'onboarder", or any variant requesting a prerequisites check before running `claude-project-onboarder`. Also trigger automatically as the first step of `claude-project-onboarder`.
---

# Checking Required Tools (CC project onboarder)

Wrapper minimal autour de `~/.claude/scripts/new-cc-project-onboarder/src/required-tools-checker/required-tools-checker.ts`.

## Workflow

1. Lancer la commande :

   ```bash
   bun ~/.claude/scripts/new-cc-project-onboarder/src/required-tools-checker/required-tools-checker.ts
   ```

2. Afficher le stdout tel quel à l'utilisateur (le script produit déjà un rapport humain markdown).

3. Propager le verdict via l'exit code :
   - `0` → tous les prérequis sont là, l'utilisateur peut enchaîner sur `claude-project-onboarder`.
   - `1` → outils manquants ou plateforme non supportée, **ne pas** enchaîner.
   - `2` → erreur d'usage (ne devrait pas arriver depuis ce skill).

## Règles

- **Read-only** : ne modifier aucun fichier, ne rien installer. Le skill rapporte, l'utilisateur installe.
- **Pas de re-formattage** : le script est la source de vérité du rapport humain. Ne pas reformater son stdout.
- **Pas de flag** : ce skill cible toujours le format humain. Pour la sortie JSON (orchestrateurs, automation), appeler le script directement avec `--format json`.
