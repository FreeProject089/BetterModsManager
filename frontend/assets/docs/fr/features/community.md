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

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/community.bmmreplay" data-page="features/community" data-title="Lire le blog communautaire"></div>


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

## L'écran qui s'ouvre au démarrage

Au premier lancement de BMM — et aux suivants, tant que tu ne dis pas le contraire — une courte
fenêtre présente BetterCommunity : ce qu'est le site, ce que tu peux y faire, et ce que fait le
bot Discord. Elle porte trois boutons (ouvrir le site, rejoindre le Discord, ajouter le bot à
ton propre serveur) et une case **Ne plus afficher au démarrage**.

Cocher cette case est retenu au moment où tu la coches, pas à la fermeture — donc la cocher
puis appuyer sur `Échap` compte quand même. Rien là-dedans n'est obligatoire : BMM installe et
gère tes mods hors ligne, sans compte, et la fenêtre le dit elle-même.

Ce n'est **pas** volontairement réservé au premier lancement. Un avis unique est un contrôle qui
ne sert à rien pour quelqu'un qui l'a balayé sans le lire le jour de l'installation — et c'est
exactement la personne qui pourrait vouloir le lire la deuxième fois.

Deux choses se laissent la place, pour qu'un lancement n'empile jamais deux surcouches : la
fenêtre n'apparaît pas pendant le [tutoriel](doc-page:getting-started/first-launch.fr), et quand elle
apparaît elle prend l'unique interruption du lancement, laissant les autres avis pour une
prochaine fois.

Pour la revoir après l'avoir masquée, ouvre-la depuis l'écran Communauté ou la palette de
commandes (`Ctrl+K`) — ouverte exprès, elle perd la case à cocher : il n'y a rien à masquer
dans quelque chose que tu viens de demander.

## BetterCommunity v2

BMM 1.0.3 est prêt pour BetterCommunity v2 et le livre **désactivé** : tant que l'interrupteur
n'est pas mis, BMM parle à BetterCommunity v1 exactement comme la 1.0.2.

**L'interrupteur** est lu une fois au démarrage, dans cet ordre : ton
[`app.cfg`](doc-page:reference/app-cfg) (`BCApiVersion`, `BCv2Base`), puis le
[fichier de liens](doc-page:reference/links-and-updates) publié par BetterCommunity (`bc_api`,
`bc_v2_base`), puis la v1. Le jour où la v2 ouvre, son équipe bascule `bc_api` et les copies
installées suivent sans nouvelle version. Un `BCApiVersion=v1` explicite dans `app.cfg` garde
une installation sur la v1 quoi que dise le fichier de liens.

**Le contrôle de santé.** La v2 n'est utilisée qu'après avoir répondu à `GET <base>/v2/health`
avec `ok` ou `degraded` pendant cette session. Si elle ne répond pas, BMM reste sur la v1 pour la
session et écrit la raison dans son journal. Tant que le contrôle n'a pas répondu, BMM est sur la
v1.

### Le compte lié

Quand la session tourne sur la v2, les *Paramètres* affichent une carte **Compte BetterCommunity
lié**. **Se connecter avec BetterCommunity** affiche un code court ; ouvre la page, vérifie
qu'elle affiche le même code, et approuve-le sur le site. **Aucun mot de passe n'est saisi dans
BMM.** La connexion est gardée comme BMM garde ses autres secrets : protégée par Windows pour ton
compte utilisateur (le trousseau du système sur macOS et Linux). Si aucun des deux ne marche,
elle dure jusqu'à la fermeture de BMM, et la carte le dit. BMM ne l'affiche jamais, et ne l'envoie
qu'à l'adresse BetterCommunity v2 qui l'a émise. **Se déconnecter** la révoque sur le site et
l'oublie sur ce PC. En mode v1, la carte est masquée et la liaison de compte existante marche
comme avant.

### Ce qui passe en v2, et ce qui reste en v1

En v2 : les retours, rapports de bug et de plantage (en tant que ton compte quand tu es connecté,
sinon avec la clé d'application publique de BMM) ; les reçus de consentement et les réponses aux
Conditions et à la Politique de confidentialité (même règle d'autorisation qu'avant) ; une version
plus récente des Conditions ou de la Politique publiée par la v2 est montrée avec **Accepter**,
**Refuser** ou **Plus tard** ; les notifications BetterCommunity (lues avec ta connexion, pas de
clé API à coller) ; le journal Communauté de cet écran ; les suggestions BetterCommunity de Laya ;
le flux de secours de la vérification des mises à jour et la liste des crédits (chaque mise à jour
est toujours vérifiée contre le manifeste signé de la version) ; le téléchargement du modèle
hors ligne de Laya (même empreinte SHA-256) ; et la télémétrie anonyme, si tu l'as activée, avec
seulement les catégories que tu as acceptées. Le replay de session reste sur le serveur de
télémétrie actuel.

**Toujours en v1** : les avatars, les annonces de lancement, la recherche d'auteur par identifiant
de créateur et le lien Discord. BetterCommunity v2 ne les sert pas encore.

## Comment ça s'articule avec le reste de BMM

Le blog est la partie visible de BetterCommunity. La même plateforme :

- héberge les **catalogues communautaires** auxquels l'[App Catalog](doc-page:features/apps) peut s'abonner ;
- soutient les **[Dépôts Serveur](doc-page:features/repo)** partageables d'où tu synchronises les mods ;
- est là où les projets publient les notes de version que tu vois aussi sous **Quoi de neuf**
  dans BMM.

Donc un article ici annonçant « nouveau dépôt disponible » ou « catalogue mis à jour » pointe
vers des fonctions sur lesquelles tu agis ailleurs dans l'app — cet écran est là où tu
l'apprends en premier.
