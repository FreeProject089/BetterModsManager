---
description: Workflow pour la mise à jour automatique des documentations techniques et utilisateur
---
# BMM Agent Workflow : Maintenance de la Documentation

Ce workflow garantit que les deux piliers de la documentation de BMM — technique (`Technical_Analysis.md`) et utilisateur (`App_Features.md`) — restent synchronisés avec les évolutions du code.

## 1. Analyse de l'Impact
Avant toute modification, identifier si le changement affecte :
- **L'Architecture** (ex: nouveau module Rust, changement d'IPC, nouveau moteur) -> Impacte `Technical_Analysis.md`.
- **Les Fonctionnalités** (ex: nouveau bouton UI, changement de comportement, nouvelle option) -> Impacte `App_Features.md`.

## 2. Mise à jour : Technical_Analysis.md
- **Emplacement** : `Update/Old_Update/Technical_Analysis.md`
- **Actions** :
    - Ajouter les nouveaux modules Rust dans la section appropriée (Backend Core, Data Models, etc.).
    - Mettre à jour les tableaux de structures de données (Field / Type / Description).
    - Expliquer les nouveaux mécanismes de sécurité ou d'I/O.
    - Mettre à jour la table de "Technical Specification Summary" si nécessaire.

## 3. Mise à jour : App_Features.md
- **Emplacement** : `Update/Old_Update/App_Features.md`
- **Actions** :
    - Ajouter la nouvelle fonctionnalité dans la section thématique correspondante (ex: Mod Library, Sharing, Safety).
    - Maintenir les tableaux de description (Feature / Description) ou (Operation / What Happens).
    - Utiliser un langage clair, orienté utilisateur.

## 4. Maintenance de la FAQ (index.html)
- **Actions** :
    - Analyser le code pour identifier les points obscurs ou les nouvelles fonctionnalités complexes.
    - Générer 1 à 3 questions/réponses claires et les ajouter à la section FAQ dans `index.html`.
    - S'assurer que les clés `data-i18n` sont créées dans `en.json` et `fr.json`.

## 5. Analyse Technique Approfondie
- **Expertise** : Ne pas se limiter aux changements de surface. Documenter les "edge cases" et les optimisations de performance qui pourraient ne pas être immédiatement visibles.
- **Transparence** : Expliquer les choix de design (ex: pourquoi ce Mutex ? pourquoi ce délai ?).

## 6. Standard de Rédaction
- **Garder la Structure** : Ne pas briser le format Markdown existant (headers, tables).
- **Style BMM** : Utiliser un ton professionnel, précis et axé sur la performance et la sécurité.
- **FAQ-In-App** : La FAQ interne doit être pédagogique (explication des bénéfices utilisateur).
- **Dernière Ligne** : S'assurer que le pied de page (auteur) reste intact.

---
// turbo
5. Scan final des documentations :
`dir Update/Old_Update/*.md`
