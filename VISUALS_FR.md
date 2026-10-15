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
- [Parcours : BMM utilisé pour de vrai](#parcours--bmm-utilisé-pour-de-vrai)

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

## Parcours : BMM utilisé pour de vrai

Chaque clip suit un objectif de bout en bout, sans tutoriel à l'écran. Les mêmes prises sont des enregistrements interactifs (`.bmmreplay`) sur le [site de documentation](https://freeproject089.github.io/BMM-Docs/), dans la page de la fonctionnalité.

- **Installer un nouveau jeu**: Un profil pour Northwind Saga, trois mods ajoutés depuis leurs archives, activés, le conflit qu’ils créent réglé, et les fichiers dans le dossier du jeu.
  ![Installer un nouveau jeu](.github/gifs/new-game.gif)
- **Partager une config avec des amis**: Le profil devient un modpack, le modpack est hébergé en Server Repo sur le réseau local, un ami le suit par son adresse et se synchronise.
  ![Partager une config avec des amis](.github/gifs/share-setup.gif)
- **Personnaliser BMM**: Un thème créé dans l’éditeur de thèmes, une barre de navigation réorganisée avec une page personnalisée, et une chaîne traduite dans le studio de traduction.
  ![Personnaliser BMM](.github/gifs/make-it-yours.gif)
- **Automatiser les corvées**: Une tâche planifiée qui vérifie les repos suivis et sauvegarde les profils chaque soir, prévisualisée avant d’être enregistrée.
  ![Automatiser les corvées](.github/gifs/automate.gif)
- **Créer un plugin avec une liste de mods**: Plugins & API → Créer : un plugin qui fournit une liste de mods, ses permissions, l’aperçu en direct et le plugin enregistré sur ce PC.
  ![Créer un plugin avec une liste de mods](.github/gifs/build-plugin.gif)
- **Écrire un tutoriel interactif**: Un tutoriel à vous pour vos amis : des étapes qui pointent l’interface, une vérification qui attend une action, l’essai, puis l’export.
  ![Écrire un tutoriel interactif](.github/gifs/create-tutorial.gif)
- **Réparer un mod mal empaqueté**: Un mod dont l’archive range ses fichiers un dossier trop bas : le Mapper montre où ils arriveraient, la racine est déplacée, le résultat vérifié et le mod mis à jour.
  ![Réparer un mod mal empaqueté](.github/gifs/fix-a-mod.gif)
- **Partager une liste de mods et un ordre**: Un ordre d’activation réglé et gardé en liste nommée avec son code de partage ; les mods exportés en liste .MM, importés dans un autre profil avec le plan de ce qui est nouveau, installés, puis activés dans l’ordre enregistré.
  ![Partager une liste de mods et un ordre](.github/gifs/share-list.gif)
- **Trouver des applis et du contenu dans les catalogues**: L’App Catalog : parcourir et chercher, les détails d’une appli, d’où vient la liste, et son propre catalogue construit dans l’onglet Créer.
  ![Trouver des applis et du contenu dans les catalogues](.github/gifs/catalogues.gif)
- **Les raccourcis du quotidien**: La palette de commandes trouve un mod et lance une commande, BMM Tools mesure le disque, un launch pack démarre le jeu avec ses outils, et la doc répond sans quitter l’app.
  ![Les raccourcis du quotidien](.github/gifs/everyday.gif)

---

Les images sont produites par l'outil de version (`tools/release/`, étape media) depuis l'aperçu
navigateur ; voir [tools/release/README_FR.md](tools/release/README_FR.md).
