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
  un autre panneau de réglages. Chacun est retirable ici. C'est le seul écran où les cinq
  types se rejoignent.
- **Historique** — ce qui a été suivi et retiré, quand, et depuis quel index. Les listes de
  sources sont de simples tableaux sans dates : sans ça, un catalogue que tu ne te souviens
  pas d'avoir ajouté n'a de trace nulle part — et un que tu as retiré et que tu veux
  récupérer non plus.

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
| `type` | **oui** | `app`, `plugin`, `theme`, `preset` ou `repo`. Tout autre est écarté. |
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
| `repo` | Parcourir les Server-Repos |

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
