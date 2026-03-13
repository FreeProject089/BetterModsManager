---
description: Workflow pour garantir une interface premium (Glassmorphism, animations, cohérence)
---

Ce workflow assure que chaque aspect visuel de BMM reste à un niveau de qualité "Premium".

## 1. Audit Visuel
- **Couleurs** : Vérifier le respect de la palette (HSL tailored, pas de couleurs primaires brutes).
- **Effets** : Contrôler la présence de glassmorphism (backdrop-filter, bordures subtiles).
- **Typographie** : Vérifier que les polices (Inter, JetBrains Mono) sont correctement appliquées partout.

## 2. Micro-animations
- **Boutons** : Vérifier les effets de hover, active et les transitions fluides.
- **Chargements** : S'assurer que les skeletons ou spinners sont élégants.
- **Transitions** : Contrôler la fluidité des ouvertures de modales et changements de vue.

## 3. Audit Responsive
- **Action** : Tester l'affichage sur différentes tailles de fenêtres Tauri.
- **Flexibilité** : S'assurer que le texte ne déborde pas et que les grilles s'adaptent.

## 4. Rapport & Correction
- **Action** : Documenter les défauts visuels dans `findings.md`.
- **CSS** : Appliquer les correctifs dans `main.css` en utilisant des variables CSS.

---
// turbo
## 🔍 Utilisation
Lancez ce workflow en disant : "/ui_premium_polish"
