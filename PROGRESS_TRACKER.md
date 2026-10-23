# BMM Progress Tracker System

Ce fichier progress.json est le cœur du système de suivi d'avancement de Better Mod Manager. Il permet de mettre à jour automatiquement le site web officiel sans avoir à modifier le code du site.

## Fonctionnement

1. Source de Vérité : Ce dépôt (BetterModsManager) contient le fichier progress.json.
2. Remote Fetching : Le site web (BMM_Web) récupère ce fichier en temps réel via l'URL GitHub Raw.
3. Mise à jour Auto : À chaque git push sur ce dépôt, les statistiques du site sont mises à jour (après un léger délai de cache GitHub).

## Comment mettre à jour l'avancement ?

Ouvrez progress.json et modifiez les valeurs suivantes :

- lastUpdate : Changez la date pour indiquer le jour de la modification.
- art / code : Les pourcentages globaux affichés dans les grands cercles.
- percent : Le pourcentage d'avancement d'une tâche spécifique (0 à 100).
- status : Voir le tableau des statuts ci-dessous.

## Types de Statuts

| Valeur JSON   | Badge affiché | Couleur de la barre | Usage recommandé                        |
|---------------|---------------|---------------------|-----------------------------------------|
| `"complete"`  | COMPLETE      | 🟢 Vert             | Tâche terminée à 100%                   |
| `"progress"`  | IN PROGRESS   | 🟡 Jaune/Amber      | Tâche en cours de développement         |
| `"testing"`   | TESTING       | 🔵 Bleu             | Tâche développée, en phase de test      |
| `"planned"`   | PLANNED       | ⚫ Gris             | Tâche planifiée, pas encore commencée   |

## Support Multilingue

Chaque texte (name, label, lastUpdate) est un objet contenant une version en (Anglais) et fr (Français). Assurez-vous de remplir les deux pour garder le site international.

---
*Note: Ce système a été mis en place pour la version 1.0 de BMM.*
