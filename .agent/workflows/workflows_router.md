---
description: Analyse la demande utilisateur pour choisir le meilleur workflow ou skill.
---

# 🚀 Workflow /workflows_router

Ce workflow analyse ton intention et te suggère l'outil (Workflow ou Skill) le plus adapté à ta tâche actuelle.

## 📝 Étapes à suivre

1. **Analyse du Contexte** : L'assistant examine le dernier message de l'utilisateur et les fichiers ouverts.
2. **Consultation du Registre** : L'assistant lit le fichier [workflows_help.md](file:///e:/Travaille/CodageAutres/Better Project/BetterModsManager/.agent/workflows/workflows_help.md) pour comparer la demande avec les outils disponibles.
3. **Recommandation** : L'assistant propose un ou deux outils avec une justification courte.
4. **Appel à l'Action** : L'assistant te propose de lancer le workflow suggéré immédiatement.

## 📋 Exemple de logique
- *Demande :* "Comment optimiser le temps de chargement ?"
- *Réponse :* Utilise le skill `@performance-analyst` ou le workflow `/ui_premium_polish`.

---
// turbo
### 🔍 Commande de consultation
`type e:\Travaille\CodageAutres\Better Project\BetterModsManager\.agent\workflows\workflows_help.md`
