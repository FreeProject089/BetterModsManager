---
description: Identification et nettoyage de la dette technique et du code mort
---

Ce workflow aide à maintenir une base de code propre en identifiant les éléments inutilisés ou obsolètes.

## 1. Analyse Statique
- **Backend (Rust)** : Lancer `cargo check` ou `cargo build` et noter tous les warnings `unused`.
- **Frontend (JS)** : Utiliser un linter ou une analyse manuelle pour trouver les imports non utilisés et les fonctions orphelines.

## 2. Rapport de Dette
- **Action** : Documenter les trouvailles dans l'artifact de session `findings.md`.
- **Priorisation** : Classer les éléments par risque (ex: warning de compilateur = Urgent).

## 3. Nettoyage (EXECUTION)
- **Suppression** : Supprimer le code mort identifié.
- **Refactorisation** : Simplifier les fonctions trop complexes ou redondantes.

## 4. Validation
- **Compilation** : S'assurer que le projet compile sans erreurs ni warnings majeurs.
- **Vérification** : Confirmer qu'aucune fonctionnalité n'a été cassée par mégarde.

---
// turbo
## 🔍 Utilisation
Lancez ce workflow en disant : "/tech_debt_cleanup"
