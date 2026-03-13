---
name: Code Review
description: Révise les changements de code pour détecter des bugs, des problèmes de style et vérifier les bonnes pratiques spécifiques à BMM.
---
# Code Review Skill v2 (BMM)

Compétence de revue chirurgicale focalisée sur la robustesse du backend Rust et l'excellence du frontend Glassmorphism.

## 🛠 Critères de Revue (Analyse Profonde)

### 1. Robustesse Backend (Rust)
- **Deadlock Prevention** : Vérifier l'ordre d'acquisition des locks dans `AppState`. Préférer `RwLock` quand les lectures sont fréquentes.
- **Async Hygiene** : Ne jamais bloquer le runtime `tokio` avec des opérations synchrones (utiliser `spawn_blocking`).
- **Semantic Error Handling** : Utiliser des types d'erreurs clairs et éviter les `.unwrap()` ou `.expect()` en production.
- **Log Integrity** : Vérifier que les logs contiennent assez de contexte pour le débogage de crash.

### 2. Excellence UI & UX (Premium)
- **Glassmorphism Check** : Vérifier l'usage de `backdrop-filter: blur()`, `rgba()` transparents et bordures subtiles.
- **Micro-interactions** : S'assurer que chaque bouton a un état `:hover` et `:active` fluide.
- **Responsive Layout** : Tester la résilience du layout aux changements de taille de fenêtre (flexbox/grid).

### 3. Standards de Projets & i18n
- **i18n Registry** : Vérifier la présence de `data-i18n` ou `t()`. Aucune chaîne en dur n'est tolérée.
- **JSON Consistency** : Triple vérification `en.json` / `fr.json` / `template.json`.
- **Naming Convention** : CamelCase pour JS, snake_case pour Rust, kebab-case pour CSS.

## 📝 Format du Rapport de Revue
1. **🚀 Performance & Sécurité** : Impact sur le runtime et la surface d'attaque.
2. **🎨 Esthétique & UX** : Conformité au style Premium de BMM.
3. **🧹 Tech Debt & Structure** : Clarté du code et modularité.

---
// turbo
## 🔍 Exécution
"Analyse ce fichier sous l'angle @code-review : [path]" 
*Version: 2.1.0 (Evolution Architect optimized)*
