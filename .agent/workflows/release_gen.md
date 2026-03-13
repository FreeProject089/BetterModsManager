---
description: Génération automatique de notes de version et changelogs
---

Ce workflow automatise la compilation des changements effectués pour préparer une nouvelle release.

## 1. Collecte des Données
- **Action** : Analyser les fichiers `walkthrough.md`, `task.md` et les logs Git récents.
- **Extraction** : Identifier les nouvelles features, les bugs fixés et les améliorations techniques.

## 2. Génération du Rapport
- **Fichier** : Créer un nouveau document dans `Releases/vX.Y.Z.md` (remplacer par la version actuelle).
- **Structure** :
    - # Release vX.Y.Z
    - ## 🚀 Nouvelles Fonctionnalités
    - ## 🛠️ Améliorations Techniques
    - ## 🐛 Correctifs de Bugs
    - ## ⚠️ Notes Importantes (Breaking Changes, etc.)

## 3. Validation i18n
- **Action** : Vérifier que toutes les nouvelles chaînes ajoutées dans la version sont bien présentes dans `en.json` et `fr.json`.

## 4. Clôture de Version
- **Action** : Mettre à jour la version dans `package.json` et `src-tauri/tauri.conf.json`.
- **Archive** : Archiver le `walkthrough.md` actuel en le renommant `walkthrough_vX.Y.Z.md` si nécessaire.

---
// turbo
## 🔍 Utilisation
Lancez ce workflow en disant : "/release_gen [version]"
