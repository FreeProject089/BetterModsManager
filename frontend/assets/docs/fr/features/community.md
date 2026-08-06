# BetterCommunity


> Actus et articles des blogs BetterCommunity, lus sans quitter BMM.

L'écran **BetterCommunity** est le blog du projet, ramené dans l'app : annonces, notes de
version, et articles des gens qui construisent BMM et ses outils frères. Pas besoin de compte
ni de navigateur pour lire — BMM récupère les articles à chaque ouverture de la page, donc ce
que tu vois est à jour sans redémarrer.

C'est aussi la porte d'entrée d'une plateforme plus large. BetterCommunity est le service web
derrière les [Dépôts Serveur](doc-page:features/repo) et les catalogues communautaires que lit l'[App
Catalog](doc-page:features/apps) ; cet écran en montre le blog, pas la totalité.

<!-- TODO(capture) : une capture annotée de cet écran, en
     ../assets/screens/community.annotated.png, comme les autres pages de fonctionnalité. Le
     texte ci-dessous décrit la même chose ; la capture est un bonus, pas un bloquant. -->

## Ce qu'il y a à l'écran

Quatre choses, de haut en bas :

| | |
|---|---|
| **Les puces de filtre** | Une par espace de blog — **BMM**, **BSM**, **Installer**, **Community** — plus **Tout**, où la page démarre. Rien n'est masqué par défaut |
| **La recherche** | Filtre les articles déjà chargés, sur le titre, l'extrait *et* le nom de l'auteur. Elle restreint ce qui est affiché ; elle n'interroge pas le serveur |
| **L'article en vedette** | Le plus récent, avec une carte large à lui |
| **La grille** | Tout le reste, du plus récent au plus ancien |

La carte en vedette n'apparaît que si tu navigues sans filtre et sans recherche. C'est
volontaire : une carte héros dit « voici la dernière actu », et ce serait faux si ce n'était que
la première ligne à correspondre par hasard à ta recherche.

Il y a aussi un **sélecteur de langue pour les articles**, distinct de celui de BMM. Le contenu
du blog existe en anglais et en français ; si BMM est dans une troisième langue, les articles
retombent sur l'anglais, et tu peux quand même les basculer à la main.

## Quand il n'y a rien à montrer

Trois états vides différents, parce que trois choses différentes peuvent être vraies :

- **Rien dans cette section, mais des articles existent ailleurs** — tu obtiens un bouton
  *Voir tous les articles* plutôt qu'un cul-de-sac.
- **Rien du tout pour l'instant** — un message simple.
- **Chargement impossible** — un bouton *Réessayer*. Le fil vient du réseau, c'est donc l'état
  que tu verras hors ligne, et il le dit au lieu de faire croire que le blog est vide.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/community.bmmreplay" data-page="features/community" data-title="Lire le blog communautaire (clip placeholder)"></div>

*Enregistrement placeholder — un clip ciblé de cet écran le remplacera.*

## Le fil

Ouvrir la page charge tous les articles dans un fil unique et défilable, du plus récent au
plus ancien. Chaque carte montre le titre de l'article, un extrait, ses auteurs, le projet
auquel il appartient, et ses compteurs de réactions et de commentaires. Clique une carte pour
ouvrir l'article complet.

BMM **recharge le fil à chaque entrée sur la page** : un article fraîchement publié apparaît
donc à ta prochaine visite — pas de bouton « rafraîchir » à chercher. Si la récupération
échoue (hors ligne, ou plateforme injoignable), la page le dit et propose **Réessayer** au
lieu d'afficher une liste vide ou périmée.

### Filtrer par projet

BetterCommunity porte les blogs de toute la famille d'outils, donc le fil se filtre via une
rangée de puces en haut :

| Puce | Affiche |
|---|---|
| **Tout** | Les articles de tous les projets (par défaut — rien à cliquer). |
| **BMM** | Better Mods Manager. |
| **BSM** | BetterSaveManager. |
| **Installer** | BetterInstaller. |
| **Communauté** | Articles à l'échelle de la plateforme et de la communauté. |

Le filtre **Tout** est sélectionné à l'arrivée, volontairement : le cas courant est « quoi de
neuf partout », donc rien n'est caché tant que tu ne choisis pas de restreindre.

### Recherche

Le champ de recherche filtre la liste courante au fil de la frappe, en cherchant dans le
**titre**, l'**extrait** et le **nom des auteurs** de chaque article. Recherche et filtre par
projet se combinent — pour chercher seulement dans *BMM*, choisis d'abord la puce, puis tape.

## Lire un article

Cliquer une carte ouvre l'article complet : le corps rendu (images et vidéo incluses), la
rangée d'auteurs, et les contrôles d'interaction en dessous. La vue article gère son propre
écran, pour une lecture confortable ; en la quittant tu reviens au fil là où tu l'avais
laissé.

### Réactions

Un article peut recevoir une réaction parmi dix icônes — 👍 pouce, ❤️ cœur, 🔥 feu, 🎉 fête,
⭐ étoile, 🚀 fusée, 😂 rire, 🙂 sourire, ✨ étincelles, et ✅ validé. Les réactions sont un
signal rapide et léger ; les compteurs sur une carte sont les totaux de toutes les personnes
ayant réagi.

### Commentaires

Les articles portent un fil de commentaires : une note de version ou une annonce peut donc
accueillir une conversation sur place, au lieu de l'éparpiller ailleurs.

### Historique d'édition

Les articles ne sont pas figés une fois publiés. Quand un article a été modifié, BMM peut te
montrer **ce qui a changé** — un diff ligne à ligne entre versions, avec les lignes ajoutées
et supprimées marquées. Une correction ou une annonce mise à jour est ainsi transparente : tu
vois l'avant et l'après, pas seulement le texte final.

!!! note "Articles co-écrits"

    Un article peut lister **plusieurs auteurs**. La rangée d'auteurs montre chaque
    contributeur, pour qu'une annonce collaborative crédite tous ceux qui y ont travaillé, pas
    seulement celui qui a cliqué sur publier.

## Comment ça s'articule avec le reste de BMM

Le blog est la partie visible de BetterCommunity. La même plateforme :

- héberge les **catalogues communautaires** auxquels l'[App Catalog](doc-page:features/apps) peut s'abonner ;
- soutient les **[Dépôts Serveur](doc-page:features/repo)** partageables d'où tu synchronises les mods ;
- est là où les projets publient les notes de version que tu vois aussi sous **Quoi de neuf**
  dans BMM.

Donc un article ici annonçant « nouveau dépôt disponible » ou « catalogue mis à jour » pointe
vers des fonctions sur lesquelles tu agis ailleurs dans l'app — cet écran est là où tu
l'apprends en premier.
