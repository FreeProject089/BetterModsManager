# Astuces, contrôles & raccourcis

Les fonctionnalités ont leur propre page. Celle-ci parle des *interactions* — les clics,
touches et petites commodités qu'on ne devine pas tant que quelqu'un ne les montre pas.
Parcours-la une fois ; elle se rentabilise vite.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/bmm-demo.bmmreplay" data-page="reference/tips" data-title="Une session BMM enregistrée"></div>

*Clique sur **Lecture** ci-dessus pour voir une vraie session BMM, reconstruite dans ton
navigateur — pas une vidéo, l'interface réelle rejouée.*

## Raccourcis clavier

BMM a quatre raccourcis globaux, tous `Ctrl` + une touche. Ils sautent au bon écran et ouvrent
la bonne chose en une pression :

| Raccourci | Effet |
|---|---|
| `Ctrl + N` | Nouveau profil. |
| `Ctrl + M` | Ajouter un mod. |
| `Ctrl + E` | Exporter une liste `.MM`. |
| `Ctrl + I` | Importer une liste `.MM`. |

Les lettres sont **personnalisables** dans **Paramètres → Raccourcis clavier** — réassigne-les
à ce que tes doigts connaissent déjà.

## La souris dans la Bibliothèque

La [Bibliothèque](doc-page:features/library) est là où tu passeras le plus de temps, et elle
récompense quelques gestes :

| Fais ça | Pour… |
|---|---|
| **Clic simple** sur une carte | La sélectionner et ouvrir son **panneau détail** (plus bas). |
| **Double-clic** sur une carte | Activer / désactiver le mod instantanément — le plus rapide. |
| **Clic droit** sur une carte *pendant son activation* | Ouvrir un petit menu pour **annuler** l'opération en cours. |
| **Glisser-déposer** un `.zip` ou un dossier sur la fenêtre | L'ajouter à la Bibliothèque — sans dialogue, BMM devine le jeu. |
| Boutons de la carte | Activer, éditer, ouvrir le dossier du mod, ou le retirer — cliquer dessus ne déclenche jamais la sélection/activation. |

## Le panneau détail de mod

Sélectionne un mod et le panneau latéral se remplit de tout ce que BMM sait de lui. Bien plus
qu'un nom :

| Section | Ce qu'elle t'apprend |
|---|---|
| **Identité / Content ID** | L'id stable et cross-machine du mod, avec un bouton **copier**. Un badge de statut dit à quel point BMM est sûr : `DECLARED` (un `bmm.json` le fixe — le plus fiable), `PRECISE` (un hash de contenu), `APPROXIMATE` (chemin + taille seulement, peut dériver), ou `NOT COMPUTED`. Un mod destiné au partage veut `DECLARED`. |
| **Conflits** | Chaque autre mod qui livre un fichier que celui-ci livre aussi, étiqueté **Intra** (même profil) ou **Extra** (autre profil), et **Actif** ou non, avec le nombre de fichiers en chevauchement. Clique pour rejoindre la vue globale des conflits. |
| **Dépendances** | Les mods dont celui-ci dépend — éditables, avec suggestions au fil de la frappe. |
| **Vérification d'intégrité** | Vérifie les fichiers du mod sur le disque contre leurs hachages SHA-256 stockés ; BMM signale tout fichier modifié ou manquant. |
| **Explorer l'archive** | Regarde dans un mod zippé sans l'extraire à la main. |
| **Tags** | Tes propres libellés pour filtrer la Bibliothèque (avec une petite limite par mod). |

Rien de tout ça n'est un devoir. Le premier jour tu actives des mods et tu passes à autre
chose — le panneau est là pour le jour où un mod déraille et où tu veux savoir *pourquoi*.

## Sélectionner plusieurs mods d'un coup

Le clic simple sélectionne un mod à la fois dans la Bibliothèque. Quand tu as vraiment besoin
d'un lot — par exemple pour construire un [modpack](doc-page:features/modpacks) — utilise le
**modal de sélection** : il liste tes mods avec des cases à cocher et un **tout sélectionner**,
tu coches un ensemble et tu valides d'un coup. Importer une [liste `.MM`](doc-page:features/modlist)
marche pareil : tu peux installer toute la liste ou cocher seulement les parties voulues avec
**Installer la sélection**.

## Le pick tool de l'éditeur de thèmes

Dans l'[Éditeur de thèmes](doc-page:features/themes), pas besoin de chercher la bonne variable
CSS. Clique la **pipette**, puis clique **n'importe quel élément dans BMM** — l'éditeur saute
directement à cet élément pour que tu restyles exactement ce que tu as pointé. C'est le plus
rapide pour répondre à « comment je change *ce* bouton ».

## Petites habitudes qui te sauvent

!!! tip "Exporte avant tout ce qui est risqué"

    **Paramètres → Données → Exporter** écrit toute ta config dans un fichier en un clic.
    Fais-le avant un gros import, avant d'essayer le modpack de quelqu'un, et toujours avant la
    réinitialisation d'usine. C'est l'assurance la moins chère de l'app — et un tutoriel
    [Données & Sauvegarde](doc-page:features/settings) t'accompagne.

!!! tip "Laisse les imports créer leur propre profil"

    Quand tu importes une liste `.MM` ou un dépôt, coche **profil auto**. BMM lui construit un
    [profil](doc-page:features/profiles) dédié au lieu de le mélanger à ta config actuelle — ce
    qui est presque toujours ce qu'on veut en essayant la configuration de quelqu'un d'autre.

!!! tip "Un dossier de jeu par profil"

    Deux profils pointant vers le même dossier de jeu, c'est la première cause de « un mod que
    j'ai désactivé est toujours actif ». Donne à chaque profil son propre dossier et toute
    cette catégorie de problème disparaît.
