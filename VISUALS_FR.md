# BMM en images

[English](VISUALS.md) · **Français**

Une visite de Better Mod Manager en images, domaine par domaine. Chaque image est la vraie
application, lancée dans l'aperçu navigateur avec des données de démonstration (aucun profil,
chemin ni compte réel), composée comme sur un bureau : la fenêtre, avec Tasky sur son coin
supérieur gauche. Interface en anglais.

De courts clips d'usage (GIF, avec une copie MP4) sont en cours d'enregistrement pour la 1.0.3.
Ils apparaîtront dans `.github/gifs/` une fois relus ; d'ici là, chacun est signalé ci-dessous
comme *à venir*, son lien gardé en commentaire.

- [Bibliothèque et profils](#bibliothèque-et-profils)
- [Dépôts serveur](#dépôts-serveur)
- [Catalogues et applications](#catalogues-et-applications)
- [Activité et outils](#activité-et-outils)
- [Thèmes](#thèmes)
- [Plugins et API](#plugins-et-api)
- [Paramètres](#paramètres)

## Bibliothèque et profils

| | |
|---|---|
| ![Bibliothèque de mods](.github/screenshots/library.png)<br>**Bibliothèque** : mods étiquetés, filtres, ordre de chargement et un interrupteur par mod. | ![Profils](.github/screenshots/profiles.png)<br>**Profils** : une configuration par jeu, ou plusieurs par jeu. |
| ![Bibliothèque, thème clair](.github/screenshots/library-light.png)<br>**La même Bibliothèque** avec le thème clair intégré (Daylight). | |

*Clip à venir* : **Résoudre un conflit**, d'un badge de la bibliothèque à la vue des conflits :
« Make Enhanced Textures win », les fichiers qui changent de main, Apply.
<!-- ![Résoudre un conflit](.github/gifs/resolve-conflict.gif) -->

## Dépôts serveur

| | |
|---|---|
| ![Serveur Repo, Se synchroniser](.github/screenshots/repo-sync.png)<br>**Se synchroniser** : collez l'adresse d'un `repo.json`, prévisualisez, puis synchronisez. | ![Serveur Repo, Héberger](.github/screenshots/repo-host.png)<br>**Héberger** : des étapes numérotées et la carte du serveur en marche. |

*Clip à venir* : **Suivre un dépôt**, Followed repos → « Follow a repo » : une adresse du réseau
local est saisie, testée (nom, version, signature, contenu) puis suivie.
<!-- ![Suivre un dépôt](.github/gifs/follow-repo.gif) -->

## Catalogues et applications

| |
|---|
| ![Catalogue d'applications](.github/screenshots/apps.png)<br>**Catalogue d'applications** : chaque carte indique son état et l'action suivante. |

## Activité et outils

| | |
|---|---|
| ![Centre d'activité](.github/screenshots/activity.png)<br>**Centre d'activité** : chaque tâche en cours, avec Annuler, et ce qui s'est terminé récemment. | ![Outils BMM](.github/screenshots/tools.png)<br>**Outils BMM** : des vérifications en lecture seule, ici l'espace disque par profil et par mod. |

*Clips à venir* :

- **Centre d'activité** : les tâches remplissent l'anneau de la barre de titre, le panneau les
  suit en direct, l'une est annulée.
  <!-- ![Centre d'activité](.github/gifs/activity-centre.gif) -->
- **Outils BMM** : Ctrl+K → BMM Tools, recherche « disk », Disk usage, copie du résultat.
  <!-- ![Outils BMM](.github/gifs/bmm-tools.gif) -->
- **Notifications** : des notifications arrivent, la cloche ouvre le centre groupé par source,
  une entrée est mise en pause pour une heure, Ne pas déranger s'active.
  <!-- ![Notifications](.github/gifs/notifications.gif) -->

## Thèmes

BMM fournit quatorze thèmes intégrés ; [THEMES_FR.md](THEMES_FR.md) les montre tous avec leur
identifiant et explique l'éditeur et le format de fichier. Quelques-uns :

| | | |
|---|---|---|
| ![Default](.github/themes/bmm-default.png)<br>**Default** · sombre | ![Daylight](.github/themes/bmm-white.png)<br>**Daylight** · clair | ![Pure Black](.github/themes/bmm-void.png)<br>**Pure Black** · sombre |
| ![Newsprint](.github/themes/bmm-brutal.png)<br>**Newsprint** · clair | ![Arctic](.github/themes/bmm-arctic.png)<br>**Arctic** · sombre | ![Blossom](.github/themes/bmm-sakura.png)<br>**Blossom** · clair |
| ![Ember](.github/themes/bmm-orange.png)<br>**Ember** · sombre | ![Cobalt](.github/themes/bmm-cobalt.png)<br>**Cobalt** · sombre | ![BMM Logo](.github/themes/bmm-logo.png)<br>**BMM Logo** · clair |

*Clip à venir* : **Éditeur de thème**, partir d'un thème intégré, générer une palette à partir
d'une couleur, corriger le contraste signalé par l'éditeur, enregistrer comme nouveau thème.
<!-- ![Éditeur de thème](.github/gifs/theme-editor.gif) -->

## Plugins et API

Pas encore d'image fixe pour ce domaine.

*Clip à venir* : **Créer un plugin**, Plugins & API → Create : un modèle, l'identité (la carte
d'aperçu suit en direct), les permissions demandées, avec leur niveau de risque.
<!-- ![Créer un plugin](.github/gifs/create-plugin.gif) -->

## Paramètres

| |
|---|
| ![Paramètres](.github/screenshots/settings.png)<br>**Paramètres** : un index de toutes les cartes, avec recherche (Ctrl+F). |

*Clip à venir* : **Paramètres**, Ctrl+F trouve un réglage ; l'index modifie la mise en page (une
carte masquée, une autre déplacée), puis se replie.
<!-- ![Paramètres](.github/gifs/settings.gif) -->

---

Les images sont produites par l'outil de version (`tools/release/`, étape media) depuis l'aperçu
navigateur ; voir [tools/release/README_FR.md](tools/release/README_FR.md).
