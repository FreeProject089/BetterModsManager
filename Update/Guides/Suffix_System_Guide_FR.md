# Guide du Système de Suffixes de Documentation

Ce guide explique comment BMM gère les fichiers localisés pour les Notes de Version et les Guides à l'aide d'une convention de nommage avec suffixes.

## Aperçu

Pour offrir une expérience multilingue fluide, BMM utilise un système de suffixes simple pour identifier et prioriser les fichiers en fonction de la langue actuelle de l'utilisateur.

## Convention de Nommage

Les fichiers doivent suivre ce modèle :
`[NomDuFichier]_[CODE_LANGUE].md`

- **Anglais** : `MonGuide_EN.md`
- **Français** : `MonGuide_FR.md`

## Fonctionnement

1. **Filtrage** : Lorsque la modal des Notes de Version ou de la Documentation est ouverte, BMM vérifie la langue active de l'utilisateur (ex: `FR`).
2. **Fichiers Masqués** : Tout fichier se terminant par un suffixe qui ne correspond **pas** à la langue actuelle (ex: `_EN.md` quand l'application est en français) est automatiquement masqué dans l'arborescence.
3. **Repli (Fallback)** : Si un fichier existe sans suffixe (ex: `GuideGeneral.md`), il sera visible pour toutes les langues par défaut.
4. **Synchronisation** : Lorsque vous changez de langue dans les paramètres, l'arborescence se met à jour instantanément pour afficher la version correcte des fichiers.

## Bonnes Pratiques

- **Cohérence** : Fournissez toujours les versions `_EN` et `_FR` pour les guides importants.
- **Fichiers Racines** : Gardez les images générales ou les ressources non textuelles dans leurs propres dossiers, mais nommez les points d'entrée `.md` en utilisant les suffixes.
- **Organisation** : Regroupez les documents liés dans des sous-dossiers ; le système de suffixes fonctionne de manière récursive dans tous les répertoires de `Update/`.

---
> [!TIP]
> Ce système évite d'encombrer l'interface avec des fichiers redondants pour des langues que l'utilisateur ne comprend pas.
