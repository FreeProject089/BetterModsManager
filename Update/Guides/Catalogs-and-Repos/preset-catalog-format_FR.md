# Catalogue de presets — partager des automatisations BMM

> **« Preset » désigne deux choses sur BetterCommunity.** Un preset **BSM** est un unique
> fichier JSON de réglages audio — voir *Preset catalog (BSM)* dans la doc BetterCommunity.
> Un preset **BMM** est une automatisation planifiée. Les deux se publient en
> `kind=PRESET` ; c'est le champ `app` qui les distingue, et BMM ne lit que les entrées
> marquées `bmm` ou non marquées. Cette page traite du type BMM.

Un preset BMM est une automatisation planifiée construite par quelqu'un d'autre : une
synchro de dépôt nocturne, un rangement après la fermeture d'un jeu, une sauvegarde
hebdomadaire. BMM les exporte déjà en fichiers `.bmmpa`. Un **catalogue de presets** en est
une liste publiée.

Ouvre-le dans BMM via **Planificateur → nouvelle tâche → *Depuis un catalogue…***.

---

## Le document

```json
{
  "version": "1.0",
  "name": "Mes automatisations",
  "presets": [
    {
      "id": "synchro-nocturne",
      "name": "Synchro de dépôt nocturne",
      "description": "Synchronise un dépôt à 3h et te dit ce qui a changé.",
      "author": "Quelqu’un",
      "version": "1.2",
      "download_url": "https://example.com/nocturne.bmmpa",
      "tags": ["depot", "synchro"],
      "tasks": 2
    }
  ]
}
```

| Champ | Obligatoire | Signification |
|---|---|---|
| `id` | **oui** | Unique dans le catalogue. Un doublon est écarté, le premier gagne. |
| `download_url` | **oui** | Le `.bmmpa`. `http`/`https` uniquement. `downloadUrl` accepté aussi. |
| `name` | non | Retombe sur l'`id`. |
| `description` | non | Affichée dans la liste. |
| `author` | non | Affiché dans la liste. |
| `version` | non | Affichée dans la liste. |
| `tags` | non | Jusqu'à 8. |
| `tasks` | non | Combien d'automatisations sont dedans. |

### Pourquoi une entrée pointe vers un fichier au lieu de le décrire

Un `.bmmpa` est ce que BMM exporte et importe déjà. Un catalogue qui détaillerait ses
tâches en JSON serait un second format décrivant la même chose, et les deux divergeraient
— le catalogue porte donc l'adresse, et le fichier porte le contenu.

### `tasks` — dis-le ou omets-le

L'omettre signifie « non précisé ». BMM n'affiche rien plutôt que `0`, parce que « le
publieur ne l'a pas dit » et « il ne contient rien » sont deux affirmations différentes sur
le travail de quelqu'un d'autre.

---

## Un catalogue qui porte ses propres fichiers

Tout ce qui précède suppose que les `.bmmpa` vivent quelque part où une URL peut les
atteindre. Ce n'est pas obligatoire. **Publier les miennes…** propose une option *emballer
le tout dans un seul fichier* : BMM écrit le dossier comme d'habitude, puis un unique `.bmmbundle`
contenant `catalog.json` et chaque automatisation qu'il nomme. C'est toi qui choisis où va
ce fichier ; rien n'est laissé ailleurs.

Envoie ce seul fichier à quelqu'un. Dans le panneau des catalogues d'automatisations,
**Ouvrir un fichier bundle…** le suit — pas d'hébergeur, pas d'adresse, rien à maintenir en
vie.

Le format n'est volontairement pas nouveau. C'est un zip avec sa propre extension : `catalog.json`
à la racine et les fichiers à côté. Renomme-le en `.zip` et n'importe quel outil l'ouvre —
l'extension existe pour qu'on distingue un catalogue d'une archive de mod d'un coup d'œil. N'importe qui avec un outil zip peut regarder dedans sans
BMM, et le dézipper redonne exactement le dossier qui aurait été publié.

Deux choses à savoir :

- **Une entrée dans un bundle peut quand même pointer ailleurs.** Un `download_url` en
  `https://…/gros.bmmpa` fonctionne dans un bundle exactement comme dans un catalogue
  hébergé : les petites automatisations voyagent avec le fichier, une grosse reste sur un
  CDN.
- **Seul ce que le catalogue utilise est emballé.** Le bundle contient `catalog.json` et
  exactement les fichiers que ses entrées nomment — pas ce qui traînait dans le dossier.
- **Un bundle ne peut pas avoir d'adresse de base.** L'option est refusée si tu as rempli
  l'adresse de base, parce qu'un catalogue dont les fichiers vivent ailleurs n'a rien à
  emballer — et emballer un zip vide en silence serait pire que de le dire.

L'emballage te dit, par leur nom, si le catalogue nomme un fichier absent du dossier. Un
catalogue qui promet trois automatisations et en porte deux, c'est une chose à apprendre
pendant que tu as encore le dossier ouvert, pas de la bouche de celui à qui tu l'as envoyé.

---

## Rien ne s'installe sans avoir été lu d'abord

Chaque ligne du navigateur se termine par **Inspecter**, jamais par *Installer*. Le choisir
télécharge le `.bmmpa` et montre ce qu'il contient :

- ce que ferait chaque tâche, et quand elle se déclencherait
- **ce qu'elle s'accorde** — exécuter des programmes externes, exécuter des scripts,
  déclencher des liens `bmm://`, arrêter des programmes
- **ce qu'elle atteint hors de BMM**, y compris ce qui est enfoui dans une boucle ou une
  branche
- le **texte intégral de chaque script**, pour lire le vrai code
- chaque programme, chemin et URL qu'elle nomme, imprimés tels quels et jamais résolus

C'est seulement ensuite que tu peux l'importer. Télécharger n'est pas importer.

C'est le même lecteur que le bouton **Inspecter un .BMMPA**, avec les mêmes règles : un
preset venu d'un catalogue ne mérite pas plus de confiance qu'un fichier qu'on t'a envoyé —
il est juste arrivé plus commodément.

---

## Publier

Sers le JSON à une adresse `https` stable et ajoute-le à ton index de catalogues avec
`"type": "preset"`, ou partage l'adresse pour que les gens l'ajoutent à la main.

Une entrée sans adresse de téléchargement utilisable est écartée de la liste **avec un
motif**, plutôt qu'affichée en ligne sur laquelle personne ne peut agir.

BetterCommunity publie le sien à :

```
https://bettercommunity.ch/api/catalog.json?project=bmm&kind=PRESET
```
