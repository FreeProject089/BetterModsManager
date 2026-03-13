---
description: Workflow pour la gestion et la résolution des problèmes critiques identifiés lors des code reviews
---

# /review_resolution — Standard BMM pour la résolution des revues

Ce workflow s'enclenche immédiatement après qu'une skill de code review (comme `@/code-review`) a identifié des problèmes **CRITIQUES** ou des **POINTS D'ATTENTION** majeurs.

## 1. Analyse et Planification (PLANNING)
1. **Classifier les problèmes** : Séparer les correctifs immédiats (Sécurité, i18n, Bugs) des refactorisations (Styling, Optimisation).
2. **Créer un Plan d'Implémentation** : Documenter chaque modification prévue dans `implementation_plan.md`.
3. **Mise à jour de `task.md`** : Ajouter les sous-tâches spécifiques pour chaque point soulevé par la revue.

## 2. Exécution des Correctifs (EXECUTION)
Appliquer les corrections dans cet ordre de priorité :

### A. Sécurité & Stabilité
- Corriger les vulnérabilités (ex: `rel="noopener noreferrer"`, échappement XSS, thread safety).
- Résoudre les bugs bloquants identifiés.

### B. Internationalisation (i18n)
- Remplacer les chaînes en dur par des attributs `data-i18n`.
- Synchroniser `en.json`, `fr.json` et `template.json`.
- Utiliser le workflow `/translation_quality` si nécessaire.

### C. Refactorisation & Design
- Déplacer les styles inline vers `main.css`.
- Appliquer les standards de nommage BMM.
- Utiliser le workflow `/bmm_standard`.

## 3. Vérification (VERIFICATION)
1. **Contrôle Qualité** : Relancer la recherche pour vérifier qu'aucune chaîne n'est restée en dur ou qu'aucun lien n'est resté non sécurisé.
2. **Preuve de Travail** : Mettre à jour `walkthrough.md` avec les corrections effectuées.
3. **Capture d'Écran/Vidéo** : Si l'UI a changé, fournir une preuve visuelle via `generate_image` ou enregistrement.

## 4. Clôture
- Demander la validation finale à l'utilisateur via `notify_user`.
- Marquer les tâches comme terminées dans `task.md`.
