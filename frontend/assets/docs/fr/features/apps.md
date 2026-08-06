# App Catalog


> Parcours et installe des apps en un clic.

Les outils *autour* du modding — ceux qu'il faudrait sinon dénicher sur cinq sites différents.
L'App Catalog liste les apps compagnons et utilitaires, les installe pour toi, garde en tête
la version que tu as, et les lance — sans que tu gères les téléchargements à la main.

![L'App Catalog](assets/docs/media/screens/apps.annotated.png)

| | | |
|---|---|---|
| **1** | **Catalogue** | Ce qui est disponible. |
| **2** | **Installer** | Un clic. |
| **3** | **Sources** | D'où vient le catalogue. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/apps.bmmreplay" data-page="features/apps" data-title="Installer une app depuis le catalogue (clip placeholder)"></div>

*Enregistrement placeholder — un clip ciblé de cet écran le remplacera.*

## Lire une carte

Chaque app montre l'essentiel d'un coup d'œil : une vignette, sa **catégorie** (jeu,
utilitaire ou autre), une étiquette de **prix** (gratuit, freemium ou payant), une courte
description, sa version, et jusqu'à trois tags. Des badges de confiance accompagnent le nom :

| Badge | Signification |
|---|---|
| **Officiel** | L'entrée vient du catalogue de BMM lui-même. |
| **Partenaire** | L'entrée vient d'un catalogue que l'officiel cautionne. |
| *(aucun)* | Une source communautaire ou ajoutée par toi — utilisable, juste pas cautionnée. |

Ces badges sont attribués par BMM selon **l'origine du catalogue**, jamais selon ce que
prétend le JSON — un catalogue communautaire ne peut pas se badger « Officiel » lui-même.

## Installer

Clique **Installer** et BMM télécharge l'app, **la vérifie contre la somme de contrôle de
l'éditeur quand elle est fournie** (une non-correspondance est signalée et l'installation
bloquée par défaut, pour qu'un téléchargement altéré ou corrompu ne s'exécute pas), et
enregistre la version installée pour proposer des mises à jour plus tard.

Ce que « installer » veut dire dépend du type de téléchargement :

| Type | Ce que fait BMM |
|---|---|
| `zip` | L'extrait. Si l'archive *est* l'app → portable, BMM choisit l'exécutable principal. Si elle ne contient qu'un installeur (`setup.exe`, `*install*`, `.msi`) → BMM lance cet installeur et auto-détecte le résultat via le registre Windows. |
| `exe` | Si le nom de fichier ressemble à un installeur (`setup`, `install`) → le lance, puis auto-détecte l'app installée via le registre. Sinon traité comme un exécutable portable. |
| `msi` | Le lance via `msiexec`, puis auto-détecte via le registre. |
| `script` | L'enregistre et le définit comme cible de lancement. Le lancement l'exécute avec le bon interpréteur : `.ps1`→PowerShell, `.bat`/`.cmd`→cmd, `.py`→python, `.vbs`→wscript, `.sh`→bash. |

Pour tout chemin d'installeur, BMM prend un instantané de tes dossiers d'installation et du
registre *avant* de le lancer et compare après — c'est comme ça qu'il trouve le vrai
exécutable et le désinstalleur correspondant, sans clic de ta part au-delà de l'assistant de
l'app.

!!! warning "Installer exécute du code"

    Une entrée d'app pointe vers un exécutable ou un installeur qui tourne sur ta machine.
    N'installe que depuis des sources de confiance — les badges **Officiel** et **Partenaire**
    existent justement pour repérer d'un coup d'œil quelles entrées sont cautionnées.

## Lancer

Les apps installées montrent une action **Lancer** sur leur carte. La plupart se lancent
directement. Quand une app livre plus d'un fichier exécutable, BMM demande plutôt que de
deviner :

> Cette app contient plusieurs exécutables. Choisis celui à lancer, ou garde la détection
> automatique de BMM.

Choisis explicitement quand une app livre un lanceur *et* le vrai binaire — la détection
automatique a raison la plupart du temps, pas tout le temps.

## Mettre à jour & désinstaller

Quand une source publie une version plus récente que la tienne, la carte propose une **Mise à
jour**.

La désinstallation dépend de comment l'app est arrivée :

- Les installations **gérées par BMM** (BMM a créé le dossier) sont retirées proprement — le
  dossier part.
- Les apps **installées de l'extérieur** (un assistant les a mises ailleurs, à sa façon) sont
  retirées via leur propre désinstalleur quand BMM en a trouvé un ; sinon BMM se contente de
  lâcher sa référence et laisse les fichiers, pour ne jamais supprimer ce qu'il n'a pas créé.

## Détection d'exécutables

Pour les apps que tu as installées **hors** de BMM, le catalogue peut détecter l'exécutable
existant et basculer la carte en « installé » au lieu de proposer un téléchargement en double
— pour qu'un outil que tu as déjà ne réapparaisse pas en demandant à être récupéré.

## Ajouter une source

> Ajoute les URL JSON brutes de catalogues communautaires.

Un catalogue n'est qu'un fichier JSON hébergé par quelqu'un. Ouvre **Sources**, colle une URL
de catalogue, et ses apps fusionnent dans la liste ; retire celles qui échouent à charger. Le
catalogue officiel peut aussi **importer automatiquement** des catalogues communautaires :
souvent, tu n'as rien à ajouter à la main. Les chaînes de catalogues importés sont suivies
jusqu'à un total de **30 sources**, pour qu'une grande toile communautaire de catalogues reste
bornée.

## Créer le tien

> Construis un `catalog.json` que tu peux héberger sur GitHub et partager.

Si tu maintiens un ensemble d'outils pour un jeu ou une communauté, c'est comme ça que tu les
transmets en une liste au lieu de dix liens. Un catalogue est un simple fichier JSON : des
métadonnées au niveau du catalogue plus un tableau `apps`, où chaque app porte un id, un
titre, une catégorie, un prix, des tags, et un bloc `download` (URL, type de fichier, taille
et SHA-256 optionnels). Héberge le fichier brut n'importe où de public et partage son URL, ou
héberge-le sur BetterCommunity en catalogue public ou sur invitation.

Vois la référence développeur *app-catalog format* pour le schéma complet et le tableau de
comportement des `file_type`.
