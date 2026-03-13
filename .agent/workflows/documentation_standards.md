---
description: Standards de rédaction pour les documentations techniques dans .Assets/.md/
---
# BMM Agent Workflow : Standards de Documentation (/documentation_standards)

Conformément au workflow `/feature_delivery`, chaque fonctionnalité majeure doit posséder son propre document de référence.

## 📝 Structure Standard d'un Document de Feature

Chaque fichier `.md` dans `.Assets/.md/` doit suivre cette structure :

### 1. Objectif (Le "Pourquoi")
Expliquer le problème résolu.

### 2. Fonctionnement Technique (Le "Comment")
*   **Backend** : Commandes Tauri, modules Rust, Models.
*   **Frontend** : Modules JS, changements UI.

### 3. Sécurité et Performance
Mutex, Disk limiter, Sanitization.

### 4. Schéma de Données
Exemple de JSON ou struct Rust.

## 🔄 Lien avec `/docs_maintenance`
Une fois le document spécifique créé :
1.  Ouvrez `/docs_maintenance`.
2.  Reportez les points clés dans `Technical_Analysis.md`.
3.  Mettez à jour `App_Features.md`.

---
// turbo
5. Vérifier l'emplacement :
`dir .Assets\.md\`
