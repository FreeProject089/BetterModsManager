# Index de catalogues — une seule adresse pour plusieurs catalogues

Un **catalogue** liste des choses à installer. Un **index** liste des catalogues.

Sans lui, suivre une communauté oblige à récupérer une URL pour son catalogue d'apps, une
autre pour ses plugins, une autre pour ses thèmes, et à coller chacune dans un écran
différent. Un index est une seule adresse qui les amène toutes, et qui continue de marcher
quand ils en publient une nouvelle.

BMM lit un index dans **Réglages → Index de catalogues**. Colle l'adresse, puis au choix :

- **Voir le contenu** — affiche chaque catalogue listé par l'index, avec son type, son nom
  et le nombre d'éléments, et marque ceux que tu suis déjà. Ça lit et ça montre, ça
  n'ajoute rien. Chaque ligne a son propre **Ajouter**, donc tu peux en prendre trois sur
  trente.
- **Tout ajouter** — suit l'index entier d'un coup. Il récupère l'adresse lui-même, tu n'as
  pas besoin de regarder le contenu d'abord.

Deux volets dessous répondent aux questions qui viennent après :

- **Catalogues que tu suis** — tous les catalogues communautaires que BMM récupère au
  démarrage, des cinq types, quelle que soit leur provenance : un index, un lien profond, ou
  un autre panneau de réglages. Chacun peut être **désactivé** ou retiré ici. C'est le seul
  écran où les cinq types se rejoignent.
- **Historique** — ce qui a été suivi et retiré, quand, et depuis quel index. Tout ce que tu
  as retiré et que tu ne suis plus a un bouton **Remettre**, donc annuler un retrait ne veut
  pas dire retrouver l'adresse. Les lignes peuvent être retirées une par une.

## Désactivé n'est pas retiré

Une source **désactivée** reste dans la liste et n'est pas récupérée. Une source **retirée**
est oubliée. La différence compte quand un index amène six catalogues et que tu en veux cinq :
retirer le sixième veut dire retrouver son adresse si tu changes d'avis, donc les gens gardent
des catalogues dont ils ne veulent pas plutôt que de les perdre.

L'interrupteur est à quatre endroits en plus des Réglages, sur le panneau qui possède chaque
type de source :

| Où | Panneau |
|---|---|
| Apps | Sources de catalogues communautaires |
| Plugins | Catalogues communautaires |
| Automatisations | la colonne Sources du catalogue d'automatisations |
| Dépôts | les pastilles de catalogue au-dessus de la liste |

Ces panneaux affichent aussi désormais **via <hôte>** sur toute source amenée par un index :
un catalogue ajouté à la main et un arrivé avec un index se distinguent enfin — et c'est
exactement la question que tu te poses en allant là pour en retirer un. Les thèmes n'ont pas
de panneau de sources à eux ; passe par Réglages → Index de catalogues.

Retirer une source depuis n'importe lequel de ces panneaux fait les trois mêmes choses que les
Réglages : oublier sa provenance, effacer son interrupteur, et écrire la ligne d'historique qui
permet de la remettre.

---

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
      "description": "Les plugins que nous maintenons.",
      "url": "https://example.com/plugins.json",
      "owner": "Quelqu’un",
      "items": 12,
      "updatedAt": "2026-08-13T09:20:00.000Z",
      "sha256": "9e2daaa8…"
    }
  ]
}
```

Seul `catalogs` est obligatoire, et à l'intérieur seuls **`type`** et **`url`**. Le reste
améliore ce que le lecteur peut t'afficher ; rien d'autre ne change ce qu'il fait.

### Champs d'une entrée

| Champ | Obligatoire | Signification |
|---|---|---|
| `type` | **oui** | `app`, `plugin`, `theme`, `preset`, `modpack`, `repo` ou `tutorial`. Tout autre est écarté. |
| `url` | **oui** | Le catalogue lui-même. `http` ou `https` uniquement. |
| `app` | non | Pour quel produit Better\* — `bmm`, `bsm`, `installer`. |
| `name` | non | Affiché dans l'aperçu. |
| `description` | non | Affichée dans l'aperçu. |
| `owner` | non | Qui le publie. |
| `items` | non | Combien de choses il contient. |
| `updatedAt` | non | Dernière modification. |
| `sha256` | non | Empreinte du contenu, pour distinguer « inchangé » de « re-téléchargé ». |
| `official` | non | **Ignoré.** Voir plus bas. |

---

## Trois choses que le lecteur refuse de faire, et pourquoi

**Il ignore `official`.** BMM décide de la confiance d'après l'URL depuis laquelle un
catalogue a été récupéré, pas d'après ce que le catalogue dit de lui-même. Un index
capable d'accorder ce badge serait un contournement de la règle, pas une partie d'elle —
le champ est donc jeté même s'il est présent.

**Il écarte un `type` inconnu au lieu de deviner.** « plugins » ressemble à « plugin » ;
c'est en devinant qu'un catalogue de presets finit dans la liste des thèmes.

**Il écarte tout ce qui n'est pas `http`/`https`.** Un index est une liste d'adresses
remise à un téléchargeur. Une entrée `file://` est refusée, pas transmise en espérant
qu'elle échoue.

Tout ce qui est écarté est compté et montré dans l'aperçu — on te le dit, on ne te donne
pas silencieusement moins que ce que le fichier contenait.

---

## `app` : comment un client ignore ce qui ne le concerne pas

Un index peut lister des catalogues pour plusieurs produits Better\*. BMM garde une entrée
si :

- son `app` vaut `bmm`, **ou**
- elle n'a **aucun `app`**.

Une entrée disant `bsm` est écartée, avec un motif.

L'asymétrie est voulue. Absent signifie « le publieur ne l'a pas dit » — l'état de tout
catalogue écrit avant l'existence du champ. Les jeter viderait l'index pour ceux-là mêmes
qui s'en servent depuis le plus longtemps. Un désaccord explicite est une affirmation ;
une valeur manquante n'en est pas une.

---

## Où va chaque type

| `type` | Atterrit dans |
|---|---|
| `app` | Catalogue d'apps → Sources |
| `plugin` | Catalogues de plugins |
| `theme` | Catalogues de thèmes |
| `preset` | Planificateur → *Depuis un catalogue…* |
| `modpack` | Modpacks → *Catalogues* |
| `repo` | Parcourir les Server-Repos |
| `tutorial` | Hub des tutoriels → *Catalogues…* |

Un catalogue de repos est un document de la forme `repos.json` — voir le guide Server-Repo.
Les entrées qu'il amène sont taguées **community** par BMM, quoi que prétende le fichier.

---

## Ce que publie BetterCommunity

Un seul générateur, plusieurs adresses :

```
https://bettercommunity.ch/api/catalogs.json                     tout
https://bettercommunity.ch/api/catalogs.json?scope=official      seulement les nôtres
https://bettercommunity.ch/api/catalogs.json?scope=community     seulement ceux publiés par des gens
https://bettercommunity.ch/api/catalogs.json?app=bmm             seulement pour BMM
https://bettercommunity.ch/api/catalogs.json?type=plugin         seulement les catalogues de plugins
```

`scope`, `app` et `type` se combinent.

Deux précisions honnêtes sur ce flux :

- Les entrées des catalogues **de BetterCommunity** portent `type`, `app`, `official`,
  `name`, `description`, `url` et `owner` — elles ne portent **pas** `items`, `updatedAt`
  ni `sha256`. Ceux-là n'apparaissent que sur les entrées communautaires.
- Un flux n'est proposé que si quelque chose y est réellement publié. Une entrée d'index
  menant à un document vide apprendrait aux gens à ne plus faire confiance à l'index.

---

## Publier le tien

Sers le JSON à une adresse `https` stable. Rien d'autre n'est requis — pas de compte, pas
d'inscription. Un index écrit à la main fonctionne exactement comme un index généré ;
`kind` suffit à lui seul pour être reconnu, mais n'est pas obligatoire.

Si tu colles un index dans une boîte « ajouter une source » ordinaire par erreur, BMM le
remarque et te renvoie vers les Réglages. Il ne l'ajoute pas là : importer un index ajoute
plusieurs sources d'un coup, ce qui est une action plus grande que celle demandée.
