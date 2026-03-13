---
description: Workflow pour le cycle de vie complet d'une nouvelle feature
---

# BMM Agent Workflow : Livraison de Feature

Ce workflow définit les étapes obligatoires pour chaque nouvelle fonctionnalité ajoutée à Better Mods Manager. L'objectif est de garantir que la feature est bien codée, documentée, aide l'utilisateur (FAQ), est introduite dès le départ (Onboarding) et est bilingue.

## 0. Initialisation (PLANNING)
- **Traçabilité** : Créer `findings.md` (recherches/contraintes) et `progress.md` (checklist) dans l'artifact de session.
- **Analyse** : Définir clairement l'objectif et les impacts potentiels.

## 0. Initialisation (PLANNING)
- **Traçabilité** : Créer `findings.md` et `progress.md` (via l'artifact de session) avant toute modification technique.
- **Analyse** : Documenter les contraintes de design et les pré-fixes.

## 1. Implémentation de la Feature
- **Code** : Suivre le `bmm_standard.md` (Rust/JS/CSS).
- **Sécurité** : S'assurer de gérer correctement le `last_session_clean` et le `StateManager`.
- **Tests** : Vérifier le build en local (`npm run dev`).

## 2. Documentation Technique et Utilisateur
- **Règle** : Chaque nouveau système (ex: P2P, Hybrid, Security) DOIT être documenté.
- **Action** : Suivre le workflow `docs_maintenance.md` pour mettre à jour `Technical_Analysis.md` et `App_Features.md`.
- **Dédié** : Créer un fichier `.md` spécifique dans `.Assets/.md/` pour les systèmes complexes.
- **Contenu** : Expliquer le "Pourquoi", le "Comment ça marche" et les structures de données clés.

## 3. Mise à jour de la documentation utilisateur (FAQ)
- **Action** : Ajouter au moins une question/réponse utile dans la FAQ de la documentation interne de l'app.
- **Utilité** : Anticiper les blocages des utilisateurs sur cette nouvelle fonctionnalité.

## 4. Intégration à l'Onboarding
- **Action** : Si la feature change la manière dont l'utilisateur démarre ou utilise l'app, mettre à jour le système d'Onboarding (`js/onboarding.js`).
- **Objectif** : Que l'utilisateur découvre la feature naturellement lors de sa première utilisation.

## 5. Traduction Intégrale (i18n)
- **Action** : Suivre le `translation_quality.md`.
- **Vérification** : Aucun hardcoding, synchronisation parfaite `en.json` / `fr.json`.

## 6. Communication (Walkthrough)
- **Action** : Mettre à jour le `walkthrough.md`.
- **Clôture** : Valider `progress.md` et archiver l'artifact.
- **Clôture** : Finaliser `progress.md` et archiver les `findings.md`.

---
// turbo-all
7. Vérifications finales :
- `npm run dev` (Build check)
- `grep -r "data-i18n" frontend` (i18n check)