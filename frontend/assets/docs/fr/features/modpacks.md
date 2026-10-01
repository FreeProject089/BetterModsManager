# Modpacks


Un modpack est un **lot de mods nommé, activable en un clic**. Là où un
[profil](doc-page:features/profiles) répond à « ma configuration pour ce jeu », un modpack répond à « ce
groupe de mods, ensemble » — et l'écran de BMM appelle l'action *Quick Apply* : un clic
active ou désactive le pack.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/modpacks.bmmreplay" data-page="features/modpacks" data-title="Créer et appliquer un modpack"></div>


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

**Mode de dépendances** — ce qu'il advient des dépendances des mods choisis. La boîte de
dialogue s'ouvre sur **Manuel**, donc rien n'est entraîné sans votre accord :

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

## L'ordre dans un pack

La liste d'un pack est un **ordre** : les flèches sur chaque mod de l'éditeur le montent ou le
descendent. Quand le pack est appliqué, ses mods sont activés puis placés dans l'ordre
d'activation du profil en un seul bloc, dans la séquence du pack : là où deux mods du pack
partagent un fichier, celui plus bas dans le pack gagne.

L'endroit où va le bloc, c'est le champ **Ordre d'activation** du pack dans l'éditeur :

| Choix | Effet |
|---|---|
| **Par défaut (réglage)** | Le réglage **Activation groupée** de la vue de l'ordre (ils gagnent, sauf si vous l'avez changé). |
| **Ils gagnent (placés en dernier)** | Le pack gagne ce qu'il partage avec les mods que le profil avait déjà. |
| **Les vôtres gagnent (placés en premier)** | Les mods que vous aviez continuent de gagner. |
| **Rien ne bouge** | Les mods déjà actifs gardent leur place. |

Le choix voyage avec le pack (export `.bmp`, listes `.mm`, dépôts). Une tâche planifiée ou un lien
`bmm://modpack/enable?order=` peut le remplacer le temps d'une exécution. Voir
[Ordre d'activation](doc-page:how-it-works/load-order).

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
