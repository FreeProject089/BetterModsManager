# Deux ids, et la différence est le sujet

Tout ce que BMM contient a un **id local** — le nom que cette machine lui a donné. Neuf types
ont aussi un **id de contenu**, qui nomme *ce que la chose est*. Ils répondent à deux
questions différentes, et se tromper est la raison pour laquelle deux personnes qui comparent
leurs installations n'arrivent à rien.

| | Id local | Id de contenu |
|---|---|---|
| Ressemble à | `sched-1755269...`, un uuid, `my-tools` | `bmmc1:9f2a…` |
| Identique sur deux machines ? | non | **oui**, si le contenu correspond |
| À utiliser pour | un lien `bmm://`, un appel API, une étape d'automatisation | demander à quelqu'un « tu as ça ? » |
| Change quand | jamais | le contenu change |

Le préfixe est voulu. Un id local de modpack est un uuid et un id de tâche est
`sched-<millis>` ; un id de contenu ne ressemble ni à l'un ni à l'autre, ce qui compte la
première fois qu'on en colle un dans le mauvais champ.

## Ce que chaque type hache

La règle est partout la même : **hacher ce que la chose EST, jamais le nom qu'elle porte ici.**

| Type | Est | N'est pas |
|---|---|---|
| Modpack | ses membres — le sha256 de chacun, ou son id de mod à défaut | son nom, sa description, l'ordre d'ajout |
| Liste de mods | pareil | pareil |
| Plugin | son id déclaré, et chaque fichier de son dossier **avec les octets de ce fichier** | là où il est installé |
| Bundle | le sha256 du `.bmmbundle` lui-même | ce que dit le catalogue à l'intérieur |
| Automatisation | ses étapes, en JSON canonique | son id, `lastRun`, `lastResult`, `history`, `enabled`, `osSchedule`, `createdAt` |
| Profil | le jeu et ce qui est activé | son nom, sa couleur, son icône, et ses trois chemins |
| Launch pack | ses programmes, par **nom de fichier** | l'endroit où ils se trouvent |
| Thème | ses tokens | son nom, auteur, description, version |
| Application | la somme de contrôle du téléchargement, à défaut son URL | quel catalogue la listait |
| Repo | ce qu'il publie | son adresse |

Deux points méritent une seconde lecture.

**Les membres sont triés, les étapes non.** Un pack dont les mods ont été ajoutés dans un
autre ordre est le même pack ; une automatisation dont les étapes sont dans un autre ordre est
une autre automatisation.

**Un launch pack ignore les chemins exprès.** `D:\Games\DCS\bin\DCS.exe` et
`C:\DCS\bin\DCS.exe` sont un seul lanceur sur deux machines. Un id qui ne serait pas d'accord
là-dessus ne correspondrait jamais nulle part, ce qui revient à ne pas en avoir.

## Est-ce toujours le même si le fichier n'a pas changé ?

Oui — c'est toute la promesse, et elle tient dans les deux sens : le même contenu donne le
même id, et un contenu différent en donne un autre.

La seconde moitié n'était pas vraie pour les plugins jusqu'à récemment. L'id pliait les **noms**
de fichiers, donc un plugin dont le script était réécrit de fond en comble gardait le même id
de contenu, et deux plugins aux noms de fichiers identiques et au code entièrement différent
en partageaient un. Il plie désormais le chemin de chaque fichier *et ses octets*, parcourus
depuis le dossier du plugin plutôt que lus dans le manifeste — ce que l'auteur déclare est une
affirmation, ce qui est dans le dossier est ce que le plugin livre. Modifier un script, en
renommer un, ou déposer un fichier de plus à côté changent tous la réponse.

Quelques conséquences à connaître :

- **Un modpack** suit les sommes de ses membres : il change quand le fichier principal d'un mod
  change, et pas quand vous renommez le pack.
- **Un bundle** est un seul fichier, donc son id est le sha256 de ce fichier. Lire le catalogue
  à l'intérieur et plier ses entrées garderait l'id quand une charge empaquetée change — la
  même erreur que faisait l'id de plugin.
- **Une automatisation** ignore si elle a déjà tourné. Deux personnes avec les mêmes étapes ont
  le même id, même si l'une l'a lancée cent fois.
- **Un fichier qu'un plugin déclare sans l'avoir** contribue son chemin avec une empreinte
  vide. « Déclaré, absent » est un état réel, différent de « absent » comme de « présent avec
  du contenu ».

Rien là-dedans n'est aléatoire et rien ne dépend de la machine : les mêmes octets sur deux
ordinateurs plient vers le même id, ce qui est la seule raison de le citer à quelqu'un.

## En copier un

Chaque carte qui a des ids montre deux petits boutons à côté du nom — le simple copie l'id
local, celui avec un point copie l'id de contenu. L'id de contenu est **calculé au clic**, pas
stocké, donc il peut échouer pour une vraie raison : un pack dont les membres n'ont pas encore
d'empreinte, un plugin désinstallé entre l'affichage et le clic. Il dit laquelle.

## Depuis un script

`POST /api/content-id` avec `{ "kind": "modpack", "doc": { … } }` renvoie le même id que le
bouton copie. Il prend le **document**, pas un id — c'est pourquoi un simple jeton suffit et
non la portée de lecture de chaque type : l'appelant fournit ce qui est haché, donc la
réponse ne révèle rien de cette installation. Une variante par id serait un oracle
« cette machine a-t-elle X ? ».

!!! note "Un id de contenu n'a rien d'un secret"

    C'est un hachage de contenu : quiconque a le même contenu peut le calculer. Il prouve que
    deux choses sont identiques ; il ne prouve rien sur qui vous êtes, et ce n'est pas un
    identifiant d'authentification.
