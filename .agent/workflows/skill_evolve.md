---
description: Workflow pour l'audit et l'amélioration continue des compétences (Skills) de l'agent.
---

Ce workflow permet de s'assurer que les outils cognitifs de l'agent (Skills) restent à la pointe du projet.

## 1. Audit des Skills Actuels
- **Action** : Parcourir le dossier `C:\Users\FreeProject\.gemini\antigravity\skills\`.
- **Analyse** : Vérifier si les instructions dans `SKILL.md` sont toujours alignées avec les dernières technologies du projet (Tauri, standards CSS, etc.).

## 2. Identification des Lacunes
- **Feedback** : Analyser les interactions récentes pour voir si un Skill a manqué de précision ou a causé une erreur.
- **Nouveautés** : Identifier si une nouvelle bibliothèque ou un nouveau module nécessite une expertise dédiée.

## 3. Mise à jour (EXECUTION)
- **Refactoring** : Réécrire les sections obsolètes du `SKILL.md`.
- **Enrichissement** : Ajouter des exemples de réussite (best practices) spécifiques à Better Mods Manager.

## 4. Documentation & Aide
- **Action** : Mettre à jour `Agent_Architecture.md`.
- **Notification** : Informer l'utilisateur des nouvelles capacités acquises.

---
// turbo
## 🔍 Utilisation
Lancez ce workflow en disant : "/skill_evolve [nom_du_skill]"
