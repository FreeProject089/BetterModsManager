---
title: BetterModsManager
hide:
  - navigation
  - path
---

<div class="bmm-hero" markdown>

![](assets/docs/media/bmm-logo-tile.svg)

<div class="bmm-hero__body" markdown>

# BetterModsManager

BMM installe, organise et partage tes mods — sur plusieurs jeux, sans jamais toucher aux
fichiers d'origine plus qu'il ne le faut.
{ .bmm-hero__tagline }

<div class="bmm-hero__actions" markdown>

[:material-download: Télécharger](https://github.com/FreeProject089/BetterModsManager/releases/latest)
[:material-rocket-launch-outline: Commencer](doc-page:getting-started/install)

</div>

Libre et open source · GPL-3.0 · English & français
{ .bmm-hero__meta }

</div>
</div>

<div class="bmm-hero-shot" markdown>

![BMM 1.0.2 : la Bibliothèque, avec des mods étiquetés et un interrupteur par mod](assets/docs/media/screenshots/library.png)

</div>

<div class="bmm-new" markdown>

<span class="bmm-badge-new">Nouveau en 1.0.2</span> Le [Centre d'activité](doc-page:features/activity) montre tout ce que BMM est
en train de faire, les [Outils BMM](doc-page:features/tools) vérifient ta bibliothèque sans rien
modifier, et la page [Serveur Repo](doc-page:features/repo) te guide étape par étape pour te
synchroniser à un dépôt ou en héberger un.

<div class="bmm-gallery" markdown>

<figure markdown="span">
  ![Le Centre d'activité, ouvert au-dessus de la Bibliothèque](assets/docs/media/screenshots/activity.png)
  <figcaption>Le Centre d'activité, ouvert au-dessus de la Bibliothèque</figcaption>
</figure>

<figure markdown="span">
  ![Serveur Repo, onglet Héberger, avec la carte du serveur en marche](assets/docs/media/screenshots/repo-host.png)
  <figcaption>Serveur Repo, onglet Héberger, avec la carte du serveur en marche</figcaption>
</figure>

</div>
</div>

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

<div class="grid cards bmm-features" markdown>

-   :material-bookshelf:{ .bmm-ico } **[Bibliothèque](doc-page:features/library)**

    Voir, ajouter ou vérifier les mods que tu possèdes.

-   :material-account-switch-outline:{ .bmm-ico } **[Profils](doc-page:features/profiles)**

    Une configuration par jeu — ou plusieurs par jeu (léger, chargé, test).

-   :material-format-list-bulleted-square:{ .bmm-ico } **[Listes .MM](doc-page:features/modlist)**

    Transmettre ta configuration exacte à quelqu'un, liens compris.

-   :material-package-variant-closed:{ .bmm-ico } **[Modpacks](doc-page:features/modpacks)**

    Activer/désactiver tout un lot de mods d'un coup.

-   :material-server-network:{ .bmm-ico } **[Dépôt Serveur](doc-page:features/repo)**

    Une source qui prévient BMM quand un mod a une mise à jour.

-   :material-puzzle-outline:{ .bmm-ico } **[Plugins & API](doc-page:features/plugins)**

    Faire faire à BMM ce qu'il ne fait pas d'origine.

-   :material-apps:{ .bmm-ico } **[App Catalog](doc-page:features/apps)**

    Les outils *autour* du modding, installés en un clic.

-   :material-sitemap-outline:{ .bmm-ico } **[Mapper](doc-page:features/mapper)**

    Les dossiers d'un mod ne correspondent pas à ce qu'attend le jeu.

-   :material-account-group-outline:{ .bmm-ico } **[BetterCommunity](doc-page:features/community)**

    Les actus et articles des blogs du projet.

-   :material-cog-outline:{ .bmm-ico } **[Paramètres](doc-page:features/settings)**

    Thèmes, mises à jour, limites de disque, export des données.

-   :material-pulse:{ .bmm-ico } **[Centre d'activité](doc-page:features/activity)**

    Tu veux voir, ou arrêter, tout ce que BMM fait en ce moment.

-   :material-toolbox-outline:{ .bmm-ico } **[Outils BMM](doc-page:features/tools)**

    Tu veux trouver des doublons, des conflits, des orphelins, ou vérifier un fichier ou un manifeste.

</div>

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
