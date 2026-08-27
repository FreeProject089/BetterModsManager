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

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/apps.bmmreplay" data-page="features/apps" data-title="Installer une application depuis le catalogue"></div>


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

!!! question "La somme de contrôle porte sur le téléchargement, pas sur l'app installée"

    C'est le sha256 des **octets à l'URL de téléchargement** — l'installeur si l'entrée pointe
    dessus, le zip si elle pointe sur un zip. Rien n'est encore installé au moment de la
    vérification, et c'est tout l'intérêt : BMM hache la charge pendant qu'elle s'écrit dans un
    fichier `.part` et refuse de le renommer ou de l'exécuter en cas d'écart.

    La somme change donc à chaque fois que l'éditeur revérse le fichier, et elle ne dit rien de
    ce qui atterrit ensuite dans `Program Files`.

    La carte indique quelles entrées en ont une. Une somme absente est courante et ne prouve
    rien en soi — c'est donc un contour discret, pas une alarme. Mais entre deux entrées qui
    proposent la même application, c'est la différence qu'on veut voir avant de cliquer plutôt
    que dans un avertissement après.

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

## Favoris & historique

Deux onglets faciles à rater parce que rien n'y renvoie.

**Favoris**, c'est l'étoile sur une carte — il rassemble les apps sur lesquelles tu reviens,
prises dans le catalogue, donc la liste survit à une désinstallation puis réinstallation.

**Historique**, c'est chaque installation, mise à jour et suppression faite sur cette machine,
la plus récente en premier. Utile pour la question « qu'est-ce que j'ai changé juste avant que
ça casse », sans réponse autrement.

## Ajouter une source

> Ajoute les URL JSON brutes de catalogues communautaires.

Un catalogue n'est qu'un fichier JSON hébergé par quelqu'un. Ouvre **Sources**, colle une URL
de catalogue, et ses apps fusionnent dans la liste ; retire celles qui échouent à charger. Le
catalogue officiel peut aussi **importer automatiquement** des catalogues communautaires :
souvent, tu n'as rien à ajouter à la main. Les chaînes de catalogues importés sont suivies
jusqu'à un total de **30 sources**, pour qu'une grande toile communautaire de catalogues reste
bornée.

## Créer le tien

Quand vous ajoutez une application, **Récupérer depuis l'URL** lit le fichier que les gens vont
réellement télécharger et remplit la taille et la somme de contrôle. *Depuis un fichier
local…* fait pareil pour l'installeur que vous avez sous la main et n'avez pas encore versé —
ce sont les mêmes octets, donc la même empreinte.

C'étaient deux champs de texte libre, ce qui laissait deux issues honnêtes : vide (aucune
vérification) ou mal tapé (toute installation refusée).

**http est autorisé, et affiché.** Beaucoup de petits catalogues sont servis depuis une machine
sans certificat, et les refuser signifie seulement que l'entrée n'arrive dans la liste de
personne. Ce qui n'est pas acceptable, c'est que ça soit invisible : en http clair, qui est sur
le chemin sert ce qu'il veut — un autre installeur *et* une somme de contrôle qui lui
correspond. Une adresse `http` porte donc un marqueur ambre `http` partout où elle apparaît :
dans **Sources**, sur la carte, et sur l'entrée pendant que vous l'écrivez. La sonde dit la
même chose d'une somme qu'elle vient de lire en http.

Seuls `http` et `https` sont lus. `file://` et les autres sont refusés plutôt que marqués — ce
n'est pas une façon plus faible de faire la même chose, c'est autre chose.

Une entrée n'a besoin que d'un `id`, d'un `title` et d'une URL. Tout le reste a un défaut
désormais — sans `tags`, serde refusait l'entrée, ce qui faisait refuser tout le
**catalogue** à `fetch_app_catalogs`, ce que le navigateur ne signalait que si *toutes* les
sources avaient échoué.

> Construis un `catalog.json` que tu peux héberger sur GitHub et partager.

Si tu maintiens un ensemble d'outils pour un jeu ou une communauté, c'est comme ça que tu les
transmets en une liste au lieu de dix liens. Un catalogue est un simple fichier JSON : des
métadonnées au niveau du catalogue plus un tableau `apps`, où chaque app porte un id, un
titre, une catégorie, un prix, des tags, et un bloc `download` (URL, type de fichier, taille
et SHA-256 optionnels). Héberge le fichier brut n'importe où de public et partage son URL, ou
héberge-le sur BetterCommunity en catalogue public ou sur invitation.

Vois la référence développeur *app-catalog format* pour le schéma complet et le tableau de
comportement des `file_type`.
