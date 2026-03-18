---
description: Aide à la création et à l'intégration de nouveaux diagrammes interactifs.
---

# 🎨 Workflow /diagram_generator

Ce workflow vous accompagne dans la création d'un nouveau diagramme interactif pour documenter un système de l'application.

## 📝 Protocole de Création

1. **Analyse du Système** :
   - Lire le code source ou la documentation du système visé.
   - Identifier les étapes clés, les décisions (diamants) et les groupes logiques.

2. **Génération Mermaid** :
   - Écrire le code Mermaid en suivant les [Standards de Diagrammes](file:///e:/Travaille/CodageAutres/Better Project/BetterModsManager/.Assets/.md/docs_diagram_guide.md).
   - Utiliser des identifiants de nœuds parlants.

3. **Intégration Code** :
   - Créer un nouveau fichier dans `frontend/js/diagrams/nom-du-systeme.js`.
   - L'importer dans `frontend/js/interactive-docs.js` et l'ajouter au registre `diagrams`.
   - Créer les traductions dans `Lang/fr.json` et `Lang/en.json`.

4. **Liaison UI** :
   - Identifier où placer le bouton "Explorer le système" dans l'UI (HTML).
   - Tester l'ouverture et les explications de Tasky.

---

## 💡 Astuce Tasky
"N'oublie pas de bien nommer tes clusters pour que je puisse expliquer les grandes sections d'un coup d'œil !" 🐱
