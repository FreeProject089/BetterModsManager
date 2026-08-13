# Système de Thèmes

> 📚 **Docs canoniques :** le [site BMM Docs — Thèmes & Apparence](https://freeproject089.github.io/BMM-Docs/features/themes/) et l'article **Help & other → Thèmes** dans l'app (tokens, format `.bmmtheme`, liens de partage `bmm://`, contraste WCAG). Ce fichier est un tour rapide.

BMM embarque un moteur de thèmes complet : **100 % de l'interface est personnalisable sans aucune connaissance CSS** — et les utilisateurs avancés gardent accès au CSS brut.

## Ouvrir l'éditeur

Ouvrez l'**éditeur de thèmes** (panneau flottant). Il a quatre onglets :

| Onglet | Rôle |
|---|---|
| **Simple** | Presets, générateur auto-palette, groupes de tokens, suivi des modifications |
| **+ Éléments** | Ajoutez vos propres boutons/bannières/widgets n'importe où dans BMM |
| **CSS** | CSS libre, global ou limité à une page |
| **Installés** | Gérer, appliquer, exporter et supprimer vos thèmes |

## Démarrage rapide

1. Choisissez un des **11 presets intégrés** (BMM Default, Sombre, Void/Noir, Full White, Discord, Orange/Noir, Spotify Green, Brutalist, Clay, Nord, Sakura), ou
2. Utilisez l'**auto-palette** : choisissez une couleur → *Générer sombre* / *Générer clair* construit un thème complet et cohérent.
3. Ajustez ce que vous voulez dans les groupes repliables (Fond, Accent, Texte, Typographie, Forme, Effets, Boutons, Graphes, Diagrammes, Intro & Outro…).
4. **Enregistrer sous…** pour le garder (vous pouvez stocker autant de thèmes que vous voulez).

## Éditer n'importe quel élément

- Cliquez la **pipette**, puis **clic droit sur n'importe quel élément** de BMM (clic molette aussi, Échap annule).
- L'éditeur d'élément permet de changer les **couleurs texte / fond / bordure**, les états **survol et actif**, d'ajouter du **CSS libre**, de **définir/remplacer une image**, ou même de **remplacer le SVG d'une icône**.
- Vous préférez une liste ? Le groupe **Modals & éléments** offre des cibles en un clic pour chaque page, modal, type de bouton, dropdown, toast, scrollbar…

## Suivi des modifications

Le panneau **Vos modifications** liste chaque édition (token, override d'élément, asset, swap d'icône) avec un **revert individuel** et un *Tout annuler*. *Discard* restaure le thème actif à l'ouverture de l'éditeur.

## Fonctionnement (sous le capot)

- Un thème est un JSON de **tokens CSS** `--bmm-*` + overrides d'éléments, éléments custom, assets et polices optionnels. Appliquer un thème injecte des blocs `<style>` — **les fichiers sources ne sont jamais modifiés**, tout est réversible.
- Un **patcheur inline** (MutationObserver) réécrit les couleurs inline codées en dur sur le contenu généré dynamiquement pour qu'il suive aussi le thème.
- Sur les thèmes clairs, le **moteur de contraste auto** assombrit les textes/surfaces clairs qui seraient illisibles (désactivable dans l'onglet Simple).
- Les **graphes** du benchmark et les **diagrammes** interactifs lisent aussi les tokens du thème.

## Partage

- **Exporter** produit un `.bmmtheme` (ZIP avec theme.json + assets/polices intégrés).
- **Partager** copie un lien d'installation en un clic (`bmm://theme/import-inline?...`).
- Le **catalogue de thèmes** liste les thèmes des sources officielles, partenaires et communautaires.
