# BetterModsManager

BMM installe, organise et partage tes mods — sur plusieurs jeux, sans jamais toucher aux
fichiers d'origine plus qu'il ne le faut.

Si tu débutes, lis cette page. Elle est courte, et elle explique l'idée unique sur laquelle
tout le reste est bâti. La sauter, c'est la raison pour laquelle on se perd au troisième
écran.

!!! tip "Deux façons de lire cette doc"
    Les sections **Premiers pas** et **Fonctionnalités** t'apprennent à *utiliser* BMM. La
    nouvelle section **[Comment ça marche](doc-page:how-it-works/index)** s'adresse aux curieux et aux
    contributeurs — elle explique *pourquoi* BMM se comporte ainsi, avec des diagrammes. Lis la
    moitié qui t'intéresse.

## L'idée unique : tes mods et tes configurations sont deux choses distinctes

La plupart des gestionnaires de mods mettent les mods *dans le jeu*. BMM les garde à part :

- La **[Bibliothèque](doc-page:features/library)** contient chaque mod que tu possèdes. C'est une
  étagère. Un mod qui y dort ne fait rien.
- Un **[Profil](doc-page:features/profiles)** décide lesquels sont *actifs*, et dans quel ordre,
  pour un jeu donné.

Cette séparation est tout l'intérêt. Comme BMM le dit lui-même sur son écran de profil vide :

> Un profil, c'est votre filet de sécurité : activez, désactivez et réordonnez vos mods
> librement, et une mise à jour ou réinstallation du jeu n'efface plus jamais votre setup.

Parce que les mods vivent dans la Bibliothèque, une mise à jour, une réinstallation ou un
mod foireux ne peuvent pas les emporter. Tu reconstruis en rallumant un profil, pas en
retéléchargeant quoi que ce soit.

C'est aussi pour ça que **désinstaller un mod d'un profil ne le supprime pas**. Il redevient
un mod sur une étagère, prêt pour un autre profil. Les débutants s'attendent à une
suppression ; BMM leur offre une annulation.

## À quoi sert chaque écran

| Écran | Quand l'utiliser |
|---|---|
| **[Bibliothèque](doc-page:features/library)** | Voir, ajouter ou vérifier les mods que tu possèdes. |
| **[Profils](doc-page:features/profiles)** | Une configuration par jeu — ou plusieurs par jeu (léger, chargé, test). |
| **[Listes .MM](doc-page:features/modlist)** | Transmettre ta configuration exacte à quelqu'un, liens compris. |
| **[Modpacks](doc-page:features/modpacks)** | Activer/désactiver tout un lot de mods d'un coup. |
| **[Dépôt Serveur](doc-page:features/repo)** | Une source qui prévient BMM quand un mod a une mise à jour. |
| **[Plugins & API](doc-page:features/plugins)** | Faire faire à BMM ce qu'il ne fait pas d'origine. |
| **[App Catalog](doc-page:features/apps)** | Les outils *autour* du modding, installés en un clic. |
| **[Mapper](doc-page:features/mapper)** | Les dossiers d'un mod ne correspondent pas à ce qu'attend le jeu. |
| **[BetterCommunity](doc-page:features/community)** | Les actus et articles des blogs du projet. |
| **[Paramètres](doc-page:features/settings)** | Thèmes, mises à jour, limites de disque, export des données. |

## Les conflits, en un paragraphe

Deux mods qui livrent le même fichier sont en **conflit** — le dernier activé gagne et
écrase l'autre. BMM le détecte *avant* que tu valides, te dit exactement quels fichiers se
chevauchent, et te laisse décider de l'ordre. Tu croiseras ça dès que tu activeras deux gros
mods : autant connaître le mot maintenant. Voir [Bibliothèque](doc-page:features/library#conflicts).

## Et ensuite

1. **[Installer BMM](doc-page:getting-started/install)** — quelques minutes.
2. **[Premier lancement](doc-page:getting-started/first-launch)** — créer un profil, ajouter un mod, l'activer.
3. Puis va à l'écran qui correspond à ce que tu cherches à faire.

!!! tip "Il y a un tutoriel *dans* l'app"

    **Help & other → Interactive Tutorial Hub** t'apprend BMM pas à pas avec un bac à sable
    intégré (profil d'exemple, mods d'exemple et un modpack, nettoyés automatiquement) pour
    t'entraîner sans risquer une vraie installation. Si tu apprends en faisant plutôt qu'en
    lisant, commence là et garde ce site en référence.

## Lire ce site à côté de l'app

Cette doc et le hub **Aide & autres** de BMM sont deux vues du même contenu, et elles sont reliées
l'une à l'autre exprès :

- Chaque article in-app a un bouton **Lire la doc complète** qui ouvre *sa* page ici — pas
  l'accueil. La version in-app est la réponse courte, juste à côté des boutons qui font la chose ;
  ce site est la réponse longue, avec les diagrammes et les tables de référence.
- Les pages d'ici portent un lien **Ouvrir dans BMM** qui saute directement à l'écran ou à l'article
  correspondant dans l'app.

### Comment marchent les liens `bmm://`

Un lien *Ouvrir dans BMM* est un **deeplink** — une URL que ton OS remet à BMM, le même mécanisme que
les boutons d'installation en un clic de BetterCommunity.

| | |
|---|---|
| **BMM doit déjà tourner** | Le lien est remis à la fenêtre ouverte ; il ne lancera pas l'app pour toi |
| **Rien ne se passe en silence** | Chaque deeplink affiche un toast à l'arrivée, et ceux qui pourraient te surprendre — connecter un dépôt, s'abonner à un catalogue, tout appel d'API autre que `GET` — demandent d'abord |
| **Ton navigateur demandera une fois** | La première fois, il veut la permission d'ouvrir une application externe. Cette demande vient du navigateur, pas de BMM |
| **Tu peux tous les couper** | Un coupe-circuit global refuse chaque deeplink |

La liste complète de ce qu'un deeplink peut faire — 49, plus chaque endpoint HTTP — est dans la
[Référence API & deeplinks](doc-page:reference/api).
