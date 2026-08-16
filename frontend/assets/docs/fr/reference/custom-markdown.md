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

## Deux moteurs, un seul format

BMM et BetterCommunity partagent le format et le style, mais pas tout le jeu. L'application
affiche les blocs nécessaires pour écrire de la documentation ; le site ajoute ceux dont une
page de présentation ou de feuille de route a besoin.

| Bloc | Dans BMM | Sur le site |
|---|---|---|
| Encadrés — `note` `tip` `info` `success` `warning` `danger` | Oui | Oui |
| `steps` + `step` | Oui | Oui |
| `columns` + `column` | Oui | Oui |
| `details` (repliable) | Oui | Oui |
| `replay` (lecteur `.bmmreplay`) | Oui | Oui |
| Tableaux, code en blocs, listes, citations | Oui | Oui |
| `cards` + `card` | — | Oui |
| `roadmap` + `stage` | — | Oui |
| `file` (ligne de téléchargement) | — | Oui |
| `:badge` `:icon` `:kbd` (en ligne) | — | Oui |
| `::toc` | — | Oui |

Un bloc que le moteur ne connaît pas est laissé en texte brut : un bloc réservé au site, mis
dans la doc d'un plugin, s'affiche donc `:::roadmap` au lieu de disparaître. C'est voulu — une
erreur visible est une erreur réparable.

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

## Les blocs en plus du site

Ceux-ci s'affichent sur BetterCommunity — billets de blog, pages de doc, réponses de FAQ, pages
de projet — et sont affichés en texte brut par l'app.

La liste complète du site, avec tous les attributs, est dans le dépôt BCWEB à
`guides/reference/CUSTOM_MARKDOWN.md`, et sur le site sous **Docs → Rédaction → Blocs de
documentation**.
