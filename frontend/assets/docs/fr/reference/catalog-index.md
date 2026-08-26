# Le format d'index de catalogues


Un **catalogue** liste des choses à installer. Un **index** liste des catalogues.

Sans lui, suivre une communauté oblige à trouver une URL pour ses applis, une autre pour
ses plugins, une autre pour ses thèmes, et à coller chacune dans un écran différent. Un
index est une seule adresse qui les amène toutes, et qui continue de marcher quand ils en
publient une nouvelle.

Tout ce qui suit est tiré de `frontend/src/features/catalogs/catalog-index.ts` (le lecteur)
et de `BCWEB/apps/api/src/routes/catalogs.mjs` (le générateur). En cas de désaccord avec
cette page, ce sont eux qui ont raison et cette page est un bug.

## Le document

```json
{
  "version": "1.0",
  "kind": "catalog-index",
  "name": "Mes catalogues communautaires",
  "description": "Tout ce que nous publions pour BMM.",
  "generatedAt": "2026-08-14T12:00:00.000Z",
  "catalogs": [
    {
      "type": "plugin",
      "app": "bmm",
      "name": "Notre catalogue de plugins",
      "url": "https://example.com/plugins.json",
      "owner": "Quelqu’un",
      "items": 12,
      "updatedAt": "2026-08-13T09:20:00.000Z",
      "sha256": "9e2daaa8…"
    }
  ]
}
```

Seul `catalogs` est obligatoire, et dans chaque entrée seuls `type` et `url`. Le reste
améliore ce que l'aperçu peut montrer ; rien de tout cela ne change ce qui se passe.

| Champ | Obligatoire | Signification |
|---|---|---|
| `type` | oui | `app`, `plugin`, `theme`, `preset`, `modpack`, `repo`, `tutorial` ou `list`. Tout le reste est ignoré. |
| `url` | oui | le catalogue lui-même, `http`/`https` uniquement |
| `app` | non | `bmm`, `bsm`, `installer` — pour quel produit |
| `name` `description` `owner` | non | affichés dans l'aperçu |
| `items` | non | combien de choses il contient |
| `updatedAt` | non | dernière modification |
| `sha256` | non | empreinte de son contenu |
| `official` | non | **ignoré** — voir plus bas |

## Ce que le lecteur refuse, et pourquoi

Ces trois règles ne sont pas de la validation pour la validation. Chacune existe parce que
l'alternative fait quelque chose de pire qu'échouer.

**`official` est toujours jeté.** BMM décide de la confiance d'après l'adresse depuis
laquelle un catalogue a été récupéré — `apply_trust`, dans
`src-tauri/src/commands/apps.rs`, écrase ce qu'un catalogue d'apps prétend de lui-même. Un
index capable d'accorder ce badge serait un contournement de cette règle, pas une partie
d'elle : le champ est donc écarté même s'il est présent.

**Un `type` inconnu est écarté, jamais deviné.** « plugins » ressemble à « plugin ». C'est
en devinant qu'un catalogue de presets finit dans la liste des thèmes.

**Tout ce qui n'est pas `http` ou `https` est écarté.** Un index est une liste d'adresses
remise à un téléchargeur. Une entrée `file://` est refusée, pas transmise en espérant
qu'elle échoue plus tard.

Tout ce qui est écarté est compté et montré dans l'aperçu. On vous le dit ; on ne vous donne
pas silencieusement moins que ce que le fichier contenait.

## `app`, et pourquoi « absent » n'est pas « faux »

Un index peut lister des catalogues pour plusieurs produits Better\*. BMM garde une entrée
dont l'`app` vaut `bmm`, **ou qui n'a aucun `app`**. Une entrée disant `bsm` est écartée,
avec un motif.

L'asymétrie est voulue. Absent signifie « le publieur ne l'a pas dit » — l'état de tout
catalogue écrit avant l'existence du champ. Les jeter viderait l'index pour ceux-là mêmes
qui s'en servent depuis le plus longtemps. Un désaccord explicite est une affirmation ; une
valeur manquante n'en est pas une.

## Où va chaque type

| `type` | Atterrit dans |
|---|---|
| `app` | Catalogue d'apps → Sources |
| `plugin` | Catalogues de plugins |
| `theme` | Catalogues de thèmes |
| `preset` | Planificateur → *Mes catalogues…* |
| `modpack` | Modpacks → *Catalogues* |
| `repo` | Parcourir les Server-Repos |
| `tutorial` | Hub des tutoriels → *Catalogues* |
| `list` | Listes de mods → *Catalogues…* — listes `.mm` partagées |

Une entrée `repo` pointe vers un document de la forme `repos.json` — voir
[le format de dépôt](doc-page:reference/repo-format.fr). Les entrées qu'elle amène sont taguées
**community** par BMM quoi que prétende le fichier, pour la même raison qu'`official` est
ignoré.

!!! note "Deux mots qui désignent deux choses"

    Un **preset** est ici une automatisation BMM — un fichier `.bmmpa`. BSM emploie le même
    mot pour un preset audio, et les deux se publient en `kind=PRESET` sur BetterCommunity ;
    c'est `app` qui les distingue.

## En lire un

**Réglages → Index de catalogues.** Collez l'adresse et appuyez sur **Prévisualiser** : il
indique ce qu'il ajouterait, combien vous en suivez déjà, et combien d'entrées il a
refusées. Rien n'est importé tant que vous n'appuyez pas sur Importer.

Plusieurs index peuvent être suivis à la fois. Chaque catalogue de vos listes indique quel
index l'a amené, ce qui permet d'arrêter d'en suivre un sans chasser ses entrées.

Si vous collez un index dans une boîte « ajouter une source » ordinaire par erreur, BMM le
remarque et vous renvoie aux Réglages. Il ne l'ajoute pas là : importer un index ajoute
plusieurs sources d'un coup, ce qui est une action plus grande que celle demandée.

## En publier un

Servez le JSON à une adresse `https` stable. Ni compte ni inscription — un index se
reconnaît à sa forme. `kind: "catalog-index"` suffit à lui seul, mais un document avec un
tableau `catalogs` d'entrées `{type, url}` est reconnu sans lui.

BetterCommunity publie le sien depuis un seul générateur à plusieurs adresses ; `scope`,
`app` et `type` se combinent :

```
https://bettercommunity.ch/api/catalogs.json
https://bettercommunity.ch/api/catalogs.json?scope=official
https://bettercommunity.ch/api/catalogs.json?scope=community
https://bettercommunity.ch/api/catalogs.json?app=bmm
https://bettercommunity.ch/api/catalogs.json?type=plugin
```

Deux choses à savoir sur ce flux en particulier : les entrées de BetterCommunity elle-même
ne portent ni `items`, ni `updatedAt`, ni `sha256` — ceux-là n'apparaissent que sur les
entrées communautaires — et un flux n'est listé que si quelque chose y est réellement
publié, parce qu'une entrée d'index menant à un document vide apprend aux gens à ne plus
faire confiance à l'index.

## Un catalogue sur un serveur SSH

Une URL de source peut être `ssh://<cible>/<chemin>` au lieu de `https://…`, pour un catalogue
de n'importe quel type — app, plugin, thème ou preset. `<cible>` est le nom d'une cible SSH
enregistrée dans **Dépôt Serveur → Publier par SSH** ; `<chemin>` est le fichier sous le
dossier distant de cette cible.

```
ssh://prod/catalogs/plugins.json
ssh:///catalogs/plugins.json      # trois barres = la cible nommée « default »
```

L'URL ne porte ni hôte, ni utilisateur, ni clé, et c'est délibéré : tout cela vit dans la
cible enregistrée. Une URL de catalogue que tu colles, partages ou reçois ne peut donc jamais
diriger BMM vers une machine de son choix.

Seul BMM lit ces adresses : elles ne veulent rien dire pour un navigateur, ni pour
BetterCommunity. Quelles clés fonctionnent, et comment la moitié publique arrive sur le
serveur, c'est dans [Dépôt Serveur](doc-page:features/repo.fr#quelles-cles-ssh-fonctionnent).

## Un catalogue protégé par mot de passe

Un catalogue hébergé sur BetterCommunity peut porter un **mot de passe de téléchargement**,
défini par son propriétaire depuis le tableau de bord. BMM le demande la première fois que le
catalogue répond `401`, le retient tant que l'application tourne, et ne l'écrit jamais sur le
disque — il est donc demandé une fois par session, pas à chaque lecture.

C'est le mécanisme qu'utilise déjà un Dépôt Serveur protégé (`X-Repo-Password`, ou
`?password=` pour un navigateur), ce qui explique que rien n'ait changé dans la façon de
s'abonner.


## Suivre un catalogue depuis l'extérieur de l'app

Les listes de sources vivent dans le stockage de l'interface, ce qui est le bon endroit pour
elles et un endroit que rien d'autre ne peut lire. Jusqu'à récemment ça avait une
conséquence : tout le sous-système des catalogues se pilotait à la souris, et par aucun
autre moyen.

### Lire — un miroir

BMM pousse toute la carte de ce qu'il suit après chaque changement, et l'API, la CLI et les
outils MCP lisent cette copie.

```bash
bmm catalogs
```

```json
{ "sources": { "theme": ["https://example.org/themes/catalog.json"], "plugin": [] },
  "written_at": "2026-08-26T10:14:00Z" }
```

!!! note "`written_at` est la partie qui compte"

    **Pas** de `written_at` signifie que BMM n'a rien poussé depuis que ça existe. Ce n'est
    pas le même fait que « ne suivre aucun catalogue », et un seul des deux mérite qu'on
    aille voir — la CLI affiche donc une phrase différente pour chacun.

### Écrire — en passant par l'app

```
bmm://catalog/follow?type=theme&url=https://example.org/themes/catalog.json
bmm://catalog/unfollow?type=theme&url=…
```

```bash
bmm follow --type theme https://example.org/themes/catalog.json
bmm follow --type theme https://example.org/themes/catalog.json --off
```

`POST /api/catalogs` (`catalog.write`) prend `{ type, url, follow }`, et les outils MCP sont
`bmm_list_catalogs` et `bmm_follow_catalog`.

!!! warning "Ça répond `202`, pas `200`"

    L'écriture passe par les écrans de l'app : la réponse veut dire *l'app a été prévenue*,
    pas *la liste dit maintenant ceci*. C'est voulu — un miroir qui pourrait être écrit de
    l'extérieur puis relu par l'app serait un second écrivain, et les deux seraient en
    désaccord dès que les deux changeraient.

    Passer par les écrans est aussi ce qui fait apparaître la source dans la liste des
    catalogues suivis, avec son origine, et la rend retirable par le même bouton que les
    autres.

`type` vaut `app` · `plugin` · `theme` · `preset` · `modpack` · `repo` · `tutorial` ·
`list`. `app` est l'exception dont les sources vivent côté backend plutôt que dans
l'interface ; c'est traité, et c'est la seule.
