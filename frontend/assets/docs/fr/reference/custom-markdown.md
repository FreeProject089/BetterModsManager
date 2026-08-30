# B.MD — better.markdown


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
moteur de l'application. **L'onglet Communauté et les notes de version** affichent des articles
écrits sur BetterCommunity. Les deux répondent désormais à tout le vocabulaire du site : un
article écrit une fois se lit pareil dans le navigateur et dans l'app, ce qui est tout l'intérêt
d'avoir une seule liste au lieu de deux.

Une différence demeure, et elle est voulue. Le moteur de la documentation n'a pas de
dictionnaire — il ne sait pas parler la langue du lecteur — donc les rares blocs qui écrivent
une phrase à eux (le titre d'une carte d'horaires, le libellé d'un bouton de téléchargement)
sont remplis après le rendu plutôt que par le moteur. Rien de ce que vous écrivez n'en dépend.

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
| Maths — `$$E = mc^2$$` | Oui | Oui | Oui |
| Raccourcis emoji — `:rocket:` `:warning:` | Oui | Oui | Oui |
| `cards` + `card` | Oui | Oui | Oui |
| `file` (ligne de téléchargement) | Oui | Oui | Oui |
| `:button` `:link` | Oui | Oui | Oui |
| `:badge` `:icon` (en ligne) | Oui | Oui | Oui |
| `center` `left` `right` | Oui | Oui | Oui |
| `::toc` | Oui | Oui | Oui |

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

## Maths

Encadrez du TeX avec `$$` :

```
La relation masse-énergie s'écrit $$E = mc^2$$, et Pythagore dit

$$
a^2 + b^2 = c^2
$$
```

Seule sur ses lignes, la formule est centrée ; dans une phrase, elle reste dans la ligne. Un
seul `$` n'est **pas** des maths, volontairement : cette application cite des prix, et « $5 et
$10 » serait sinon composé comme une formule, en silence, parce qu'un prix ne lève pas
d'erreur. Une formule illisible est affichée telle que vous l'avez écrite plutôt qu'en message
d'erreur : vous pouvez corriger la source, personne ne peut corriger un message.

## Emoji

`:rocket:` devient 🚀. Les mêmes 380 et quelques noms que le site connaît, donc le même document
se lit pareil des deux côtés. Un nom inconnu reste tel que vous l'avez tapé plutôt que de
disparaître, et un nom pris dans un mot (`path:rocket:x`) ou dans une heure (`10:30:45`) n'est
jamais touché.

Coller le caractère lui-même a toujours marché ; le raccourci existe parce qu'aucun clavier n'a
🚀 dessus.

## D'où vient un document, et ce que ça change

Une page de cette documentation est la nôtre. **La documentation d'un plugin ne l'est pas** :
elle arrive avec le plugin, écrite par qui l'a fait, et elle s'affiche dans une fenêtre qui
peut appeler les commandes de l'application.

B.MD dans BMM rend donc en mode **non fiable** sauf mention contraire de l'appelant :

- Le HTML brut n'est plus laissé tel quel. Un `README.md` qui commence par `<` était remis à
  la page mot pour mot ; il est désormais assaini comme le reste.
- Chaque lien, image, téléchargement et enregistrement est vérifié avant d'être écrit.
  `javascript:`, `data:text/html`, `vbscript:` et un `//hôte` sans protocole sont refusés — ce
  dernier compte parce qu'il n'a pas de schéma, donc un contrôle qui ne regarde que les
  schémas le laisse passer.
- Un lien refusé garde son texte et perd sa destination, plutôt que de devenir un bouton qui
  mène quelque part que personne n'a choisi.

Rien ne change pour écrire un document. Ceci concerne ceux que vous n'avez pas écrits.

## La liste complète du site

Tous les blocs ci-dessus s'affichent des deux côtés. La liste complète avec tous les attributs
est dans le dépôt BCWEB à `guides/reference/CUSTOM_MARKDOWN.md`, et sur le site sous
**Docs → Rédaction → Blocs de documentation**.
