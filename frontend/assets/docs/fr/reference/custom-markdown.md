# Blocs de texte enrichi (markdown personnalisé)


Partout où du texte est affiché — la documentation d'un plugin, une page personnalisée, un
article de la communauté sur BetterCommunity — vous avez le Markdown ordinaire **plus** un jeu
de blocs.

Chaque bloc s'ouvre par `:::nom` et se ferme par un `:::` seul sur sa ligne :

```
:::tip[Titre optionnel]
Du markdown ordinaire ici — **gras**, listes, liens.
:::
```

Deux règles couvrent presque tous les problèmes rencontrés :

- **Laissez une ligne vide avant un bloc.** `:::note` collé sous un paragraphe est lu comme
  faisant partie de ce paragraphe et sort en texte brut.
- **Fermez ce que vous ouvrez.** Les blocs s'imbriquent librement, et chaque `:::` ferme le
  bloc le plus proche encore ouvert. Un bloc non fermé avale le reste de la page.

## Trois moteurs, un seul format

Il y a deux moteurs dans BMM, pas un, et ils n'ont pas le même jeu.

**La documentation** — pages fournies, doc d'un plugin, Aide &amp; autres — passe par le petit
moteur de l'application : tout ce qu'il faut pour expliquer un fonctionnement, et rien de ce
qui appartient à une page de présentation. **L'onglet Communauté et les notes de version**
affichent des articles écrits sur BetterCommunity : ils rendent donc presque tout le
vocabulaire du site.

| Bloc | Doc BMM | Onglet Communauté | Sur le site |
|---|---|---|---|
| Encadrés — `note` `tip` `info` `success` `check` `warning` `caution` `danger` `error` | Oui | Oui | Oui |
| `steps` + `step` | Oui | Oui | Oui |
| `columns` + `column` | Oui | Oui | Oui |
| `details` (repliable) | Oui | Oui | Oui |
| `roadmap` + `stage` | Oui | Oui | Oui |
| `replay` (lecteur `.bmmreplay`) | Oui | Oui | Oui |
| `tabs` + `tab` | Oui | Oui | Oui |
| `schedule` (horaires, dans un seul fuseau) | Oui | Oui | Oui |
| `:time` (un instant, dans le fuseau du lecteur) | Oui | Oui | Oui |
| `:kbd` (en ligne) | Oui | Oui | Oui |
| Tableaux, code en blocs, listes, citations | Oui | Oui | Oui |
| `cards` + `card` | — | Oui | Oui |
| `file` (ligne de téléchargement) | — | Oui | Oui |
| `:button` `:link` | — | Oui | Oui |
| `:badge` `:icon` (en ligne) | — | Oui | Oui |
| `center` `left` `right` | — | Oui | Oui |
| `::toc` | — | Oui | Oui |

Un bloc que le moteur ne connaît pas est laissé en texte brut : un bloc réservé au site, mis
dans la doc d'un plugin, s'affiche donc `:::cards` au lieu de disparaître. C'est voulu — une
erreur visible est une erreur réparable.

!!! note "Ce tableau est vérifié, pas entretenu"
    `scripts/check-md-doc-matrix.mjs` lit les deux moteurs et fait échouer le build si une
    ligne les contredit. Il existe parce que ce tableau affirmait que BMM n'affiche pas de
    roadmap depuis aussi longtemps que BMM en affiche une — sur la page même qui la
    documente, trois sections plus bas.

## Les blocs que BMM affiche

### Les encadrés

```
:::warning[Sauvegardez d'abord]
Ceci réécrit le fichier sur place.
:::
```

Six noms — `note`, `tip`, `info`, `success`, `warning`, `danger` — et un titre entre crochets si
vous en voulez un.

### Les étapes

```
:::steps
:::step[Installer]
Téléchargez et lancez l'installeur.
:::
:::step[Se connecter]
Utilisez votre compte BetterCommunity.
:::
:::
```

La numérotation est automatique. Ne numérotez pas les titres vous-même, sinon chaque étape se
lit « 1. 1. Installer ».

### Les colonnes

```
:::columns
:::column
À gauche.
:::
:::column
À droite.
:::
:::
```

Elles s'empilent sur une fenêtre étroite : n'écrivez donc jamais « le tableau à gauche » dans le
texte — écrivez « le tableau ci-dessus », ou nommez-le.

### Le bloc repliable

```
:::details[Voir la sortie complète]
Caché jusqu'au clic.
:::
```

### Le replay de session

```
:::replay{src="/api/assets/demo.bmmreplay" title="Installer un plugin"}
:::
```

Joue un enregistrement `.bmmreplay` dans la page. Préférez un fichier hébergé à côté de la page
— un replay en 404 laisse un cadre mort en plein milieu.

### Feuille de route

```
:::roadmap[Où on en est]
:::stage[Livré]{state=done}
- Questions en grille
- Vérificateur de recette
:::
:::stage[En cours]{state=doing percent=40}
- Feuilles de route dans le blog
:::
:::stage[Prévu]
- Parité MCP
:::
:::
```

Chaque puce sous une étape hérite de l'état de l'étape — `done`, `doing` ou `planned` — et
`percent=` remplit la barre d'une étape en cours. Un état que BMM ne reconnaît pas est lu comme
**prévu**, jamais comme terminé : une faute de frappe ne doit pas déclarer un travail livré.

Chaque étape indique son état de trois façons — le symbole, le mot et la couleur — pour rester
lisible par une personne daltonienne, et pour survivre à un copier-coller en texte brut.

!!! note "Dans l'app, la feuille de route dit ce que dit le document"
    La version du site accepte `src="…/progress.json"` et l'interroge. Dans BMM le bloc est
    statique : la documentation embarquée se lit hors ligne, et un suivi qui n'affiche
    silencieusement rien sans réseau est pire qu'un suivi qui affiche ce que la page a écrit.

### Les onglets

```
:::tabs
:::tab{title="Windows"}
Lancez `BetterModsManager.exe`.
:::
:::tab{title="Linux"}
Lancez `./better-mods-manager`.
:::
:::
```

Un panneau à la fois, avec la barre de titres au-dessus. C'est ce qu'il faut à une page qui a
un chemin Windows, un macOS et un Linux : sans ça les trois s'affichent et c'est au lecteur de
trouver le sien.

Le titre est sur le panneau, une seule fois. Un panneau sans titre est numéroté dans la barre
plutôt que laissé vide — ce qui vous dit lequel aller nommer.

### Les horaires

```
:::schedule[Support]{tz=Europe/Paris}
| Jour | Ouvert |
|---|---|
| Lun-Ven | 09:00-18:00 |
| Sam | 10:00-14:00 |
:::
```

Un ensemble de lignes qui se répètent, énoncées dans **un seul** fuseau. `:::hours` est le
même bloc.

**Les lignes ne sont pas converties, et c'est voulu.** « Lundi 09:00 Europe/Paris », c'est
09:00 à Paris toute l'année ; ce qui bouge au changement d'heure, c'est l'écart avec le
lecteur. Une ligne convertie serait juste aujourd'hui et fausse en mars, sans que rien sur la
page ne l'avoue. Le fuseau est donc nommé sur la carte, et en dessous le bloc dit de combien
vous en êtes éloigné **en ce moment** — la seule forme vraie de cette phrase, puisque la page
ne se redessine pas deux fois par an.

### Un instant précis

```
Le direct commence à :time[2026-09-01T20:00]{tz=Europe/Paris}.
```

Un moment unique n'a pas cette ambiguïté : il est donc *bien* converti, et s'affiche dans le
fuseau du lecteur, ce que vous avez tapé restant dans l'infobulle. `:at[...]` fait la même
chose.

Écrivez la date, pas seulement l'heure — c'est elle qui rend le calcul exact, parce qu'elle
décide de quel côté d'un changement d'heure le moment tombe. Une valeur illisible est
affichée telle que vous l'avez écrite, jamais en `Invalid Date`.

## Les blocs en plus du site

Ceux-ci s'affichent sur BetterCommunity — billets de blog, pages de doc, réponses de FAQ, pages
de projet — et sont affichés en texte brut par l'app.

La liste complète du site, avec tous les attributs, est dans le dépôt BCWEB à
`guides/reference/CUSTOM_MARKDOWN.md`, et sur le site sous **Docs → Rédaction → Blocs de
documentation**.
