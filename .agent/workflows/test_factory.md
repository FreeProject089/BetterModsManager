---
description: Génération automatique de tests unitaires pour le code JS et Rust
---

Ce workflow automatise la création de suites de tests pour sécuriser les nouvelles fonctionnalités.

## 1. Analyse du Code Cible
- **Action** : Analyser le fichier source fourni (JS ou Rust).
- **Identification** : Extraire les fonctions critiques, les points d'entrée API et les cas limites (edge cases).

## 2. Génération des Tests
- **Frontend (JS)** : Créer un fichier de test (ex: `tests/[filename].test.js`) en utilisant un framework compatible (ex: Vitest ou Jest si configuré).
- **Backend (Rust)** : Ajouter un module de test `#[cfg(test)]` à la fin du fichier `.rs` ou créer un fichier dans `src-tauri/src/tests/`.

## 3. Scénarios à Couvrir
- **Succès** : Cas nominaux.
- **Erreur** : Gestion des inputs invalides, erreurs réseau, erreurs d'I/O.
- **i18n** : Vérifier que les fonctions de traduction renvoient les bonnes clés.

## 4. Exécution & Validation
- **Action** : Lancer les tests (`npm test` ou `cargo test`).
- **Correction** : Ajuster le code source si les tests révèlent des régressions.

---
// turbo
## 🔍 Utilisation
Lancez ce workflow en disant : "/test_factory sur [fichier]"
