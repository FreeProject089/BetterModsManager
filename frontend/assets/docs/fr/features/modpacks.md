# Modpacks


Un modpack est un **lot de mods nommé, activable en un clic**. Là où un
[profil](doc-page:features/profiles) répond à « ma configuration pour ce jeu », un modpack répond à « ce
groupe de mods, ensemble » — et l'écran de BMM appelle l'action *Quick Apply* : un clic
active ou désactive le pack.

![L'écran Modpacks](assets/docs/media/screens/modpacks.annotated.png)

| | | |
|---|---|---|
| **1** | **Carte du pack** | Le clic active ou désactive tout le pack. |
| **2** | **Exporter** | Produit un fichier à transmettre. |
| **3** | **Importer** | Lit le pack de quelqu'un d'autre. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/modpacks.bmmreplay" data-page="features/modpacks" data-title="Construire et appliquer un modpack (clip placeholder)"></div>

*Enregistrement placeholder — un clip ciblé de cet écran le remplacera.*

## Modpack ou profil ?

Ils résolvent des problèmes différents, et se tromper est la confusion habituelle :

| | Profil | Modpack |
|---|---|---|
| Répond à | « Quels mods sont actifs pour ce jeu ? » | « Quels mods vont ensemble ? » |
| Portée | Un jeu, une configuration | Un groupe, réutilisable |
| Bascule | Change toute ta configuration | N'active que ce groupe |

Un modpack peut aussi **mélanger des mods de profils différents** — l'option *multi-profil*
existe précisément pour le pack qui n'appartient pas à une seule configuration.

## Les options qui comptent à la création

Deux réglages du dialogue de création/export changent le comportement d'un pack — chacun
mérite un choix délibéré :

**Mode de dépendances** — ce qu'il advient des dépendances des mods choisis :

| Mode | Inclut |
|---|---|
| **Toutes** | Toutes les dépendances de tous les mods du pack, automatiquement. Le plus sûr pour partager. |
| **Manuel** | Tu décides par mod. Pour quand tu sais exactement ce que tu veux, sans extras tirés au passage. |
| **Aucune** | Aucune dépendance auto. Le pack, c'est *seulement* les mods cochés. |

**Ignorer la vérification d'intégrité** — coupée par défaut, et mieux vaut la laisser ainsi.
Activée, l'application du pack **saute la vérification des fichiers** (plus rapide) mais BMM ne
détectera ni ne réparera un mod cassé. Ne l'active que pour un pack de confiance appliqué
souvent ; laisse-la coupée quand la justesse compte.

!!! tip "Tu partages ? Mode de dépendances : Toutes"

    Un pack que tu envoies doit porter ses propres dépendances, sinon il s'importera avec la
    moitié de ses mods « non installés ». `Toutes` est le défaut sûr pour tout ce qui quitte ta
    machine ; garde `Manuel`/`Aucune` pour les packs perso où tu gères les dépendances
    toi-même.

## Le partager : tout repose sur le hash

À l'export, BMM n'envoie pas les mods — il envoie une **signature** :

> BMM crée une signature unique (hash) pour chaque mod. Quand un ami importe ton pack, BMM
> reconnaît les mods exacts.

Le fichier reste donc léger, et « le même mod » veut dire identique à l'octet près, pas
« même nom, sans doute ». C'est ce qui fait qu'un import fonctionne exactement, ou te dit la
vérité :

> Les mods suivants ne sont pas installés sur ce PC.

Tu obtiens la liste. Rien ne s'applique à moitié en silence.

## Réparation

Si les mods d'un pack disparaissent ou se corrompent, la carte le dit — *Certains mods sont
manquants ou corrompus* — et propose **Réparer**. Utilise-le avant de déboguer le jeu : un
pack qui ne s'applique pas entièrement est une explication bien plus probable que le jeu
lui-même.

(C'est aussi le filet de sécurité que **Ignorer la vérification d'intégrité** désactive — une
raison de plus de la laisser active sauf motif précis.)
