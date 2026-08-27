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

## Un catalogue qui porte ses applications

Tous les autres types de catalogue BMM pouvaient déjà être un `.bmmbundle` — un zip avec
`catalog.json` à sa racine et les charges à côté. Les catalogues d'applications étaient le
seul type qui ne pouvait que pointer vers une adresse, ce qui voulait dire qu'en publier un
demandait toujours un hébergeur, et qu'en suivre un supposait que cet hébergeur soit toujours
là.

**Sources → Suivre un .bmmbundle…** en suit un depuis le disque. Il est ouvert avant d'être
suivi : un fichier qui n'est pas un catalogue d'applications échoue là, avec la raison, au
lieu de devenir une source qui n'apporte silencieusement rien.

Les deux formes se mélangent dans un même document, entrée par entrée. Un catalogue peut
porter les trois petits outils et pointer vers celui de 90&nbsp;Mo que quelqu'un héberge déjà.

!!! warning "Un bundle n'est pas plus fiable qu'un téléchargement"

    Une charge arrivée dans un bundle passe la même barrière de somme de contrôle qu'une
    charge récupérée sur le réseau — même fichier `.part`, même refus de renommer ou
    d'exécuter ce qui échoue. Elle n'est pas plus digne de confiance ; elle est juste plus
    proche.

    Une entrée dans un bundle ne peut nommer qu'un **voisin** : chemins absolus, lettres de
    lecteur, chemins UNC, segments `..` et tout schéma autre que http(s) sont refusés par la
    même règle qui garde les bundles de plugins et de listes de mods.

## En publier un

Dans **Créer**, une entrée prend une adresse *ou* un fichier. Confiez un fichier et BMM
remplit le type depuis son extension, la taille et la somme depuis ses octets — les deux
champs que personne ne peut produire à la main.

**Publier en un seul fichier (.bmmbundle)** prépare un dossier, copie chaque fichier confié à
côté du document, réécrit ces entrées pour qu'elles nomment leur voisin, et zippe le tout. Une
entrée avec une adresse la garde. Une entrée sans ni l'un ni l'autre est nommée plutôt
qu'écartée.

Le nom empaqueté vient de l'id de l'entrée, pas du nom du fichier source : les installeurs de
deux personnes peuvent tous deux s'appeler `setup.exe`, et l'id est déjà unique dans le
document.

!!! note "Vos chemins ne quittent jamais votre machine"

    Le fichier choisi est retenu comme chemin absolu pendant que vous travaillez, et cela est
    retiré du document publié. Un catalogue destiné à des inconnus ne doit pas transporter
    votre dossier personnel ni votre nom d'utilisateur.

## Le remplir, dans un ordre

**Créer** se lit en trois étapes numérotées — le nommer, y mettre des applis, le transmettre —
et l'éditeur derrière **Ajouter une appli** en compte trois de plus, dans l'ordre où les
réponses arrivent.

| | |
|---|---|
| **1 · Ce que c'est** | id et titre, tous deux marqués obligatoires, puis description, catégorie, prix et version. |
| **2 · D'où ça vient** | La seule décision de l'écran. Une **adresse** ou un **fichier sur ce PC**, posée comme une question à deux réponses ; choisir l'une masque le champ de l'autre. Puis le type, la taille et la somme de contrôle, avec les deux boutons de sonde. |
| **3 · Son allure dans la liste** | Tags, prérequis, images, lien de documentation. Marqué *tout est facultatif*, et déplacé à la fin. |

C'était quinze champs identiques en une colonne plate, avec deux fins séparateurs gris. Trois
décident si l'entrée fonctionne, douze relèvent du goût de l'auteur, et rien ne disait
lesquels — pendant que la seule décision se trouvait au **milieu**, sous dix champs
cosmétiques.

Le pied est collant et dit **ce qui manque encore** pendant la frappe. Le savoir obligeait
avant à enregistrer l'entrée, fermer l'éditeur, et lire une liste en bas de page. C'est la même
vérification que la liste de la page, pour que les deux ne puissent pas diverger sur le sens
de « terminé ».

!!! note "Choisir « une adresse » abandonne un fichier déjà choisi"

    La ligne qui nomme le fichier disparaît une fois basculé ; le laisser attaché
    enregistrerait une entrée portant un fichier que l'auteur venait de refuser — sans que ça
    se voie.

### Deux sorties, et ce ne sont pas des égales

Les quatre boutons de même poids en bas deviennent deux choix, parce que la différence entre
eux décide si tu as besoin d'un serveur web :

- **En un seul fichier** — tout dans un `.bmmbundle`, fichiers emballés compris. Rien à
  héberger, aucune adresse à maintenir en vie ; envoie-le comme n'importe quel fichier.
- **En `catalog.json`** — un document que tu héberges, et chaque appli qu'il contient doit
  déjà vivre à sa propre adresse. Télécharger, copier ou prévisualiser.

!!! tip "Une entrée avec un fichier n'est pas une entrée à problème"

    La page signalait une entrée dont la source est un **fichier** comme « *pas d'URL de
    téléchargement — tous les lecteurs jettent cette entrée en silence* ». C'est précisément ce
    à quoi sert le bouton fichier : il est emballé à la publication et l'adresse est écrite à
    ce moment-là. L'avertissement était alarmant, faux, et impossible à corriger sans défaire
    ce que l'auteur voulait. Il dit maintenant la chose vraie — un `catalog.json` simple ne
    porte aucune adresse pour cette entrée.

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
