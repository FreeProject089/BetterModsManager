# 🗓️ Publier un catalogue d'automatisations

Un catalogue d'automatisations est une liste de tâches planifiées partageables. Quelqu'un suit
son adresse dans BMM, voit ce que vous avez publié, et en installe une.

BMM sait les lire depuis un moment. Il sait désormais en **écrire** un : **Paramètres →
Planificateur → Depuis un catalogue… → Publier les miennes…**

---

## 🧱 Ce qu'il écrit

Un dossier, pas un fichier :

```text
mes-automatisations/
├── catalog.json
├── Nettoyage-nocturne.bmmpa
├── Sauvegarde-hebdo.bmmpa
└── Sync-et-lancement.bmmpa
```

Un `.bmmpa` signé par automatisation, et un `catalog.json` qui les liste. Téléversez le dossier
entier sur n'importe quel hébergement statique — un dépôt GitHub, GitHub Pages, un bucket S3,
votre propre serveur — et donnez aux gens l'adresse du `catalog.json`.

C'est tout le mécanisme. Aucun compte à créer, rien à enregistrer.

---

## 🔗 Pourquoi les adresses sont relatives

Les entrées écrites par BMM ressemblent à ceci :

```json
{ "id": "nettoyage-nocturne", "name": "Nettoyage nocturne", "download_url": "Nettoyage-nocturne.bmmpa" }
```

`Nettoyage-nocturne.bmmpa`, pas `https://…/Nettoyage-nocturne.bmmpa`. BMM la résout par rapport
à l'endroit d'où il a récupéré le `catalog.json`.

C'est délibéré. Un catalogue qui nomme son propre hébergeur cesse de fonctionner dès qu'il est
déplacé, copié ou forké — et être forké est la vie normale d'un dossier sur GitHub. Avec des
adresses relatives, celui qui forke votre dépôt a un catalogue fonctionnel à sa propre adresse,
et vous pouvez changer d'hébergeur sans rien modifier.

**Quand mettre une adresse complète :** uniquement si les `.bmmpa` vivent vraiment ailleurs
qu'à côté du `catalog.json` — un CDN, une page de release. Le constructeur demande cette
adresse de base et la laisse vide par défaut.

Tout ce qui n'est pas `http://` ou `https://` **après résolution** est refusé. Ce contrôle
porte sur le **résultat**, pas sur ce que vous avez tapé, parce qu'une adresse absolue en
`javascript:` traverse la résolution intacte.

---

## 📦 Ce qui voyage avec une automatisation

Tout ce qu'elle appelle, suivi de proche en proche :

| Elle utilise | Ce qui est emporté |
|---|---|
| `Exécuter une autre tâche` | cette tâche, et tout ce qu'*elle* appelle |
| `Appeler un bloc partagé` | les étapes du bloc |
| `Lancer un launch pack` | le launch pack |
| `Appliquer un plugin` | le plugin |
| Une action modpack | le modpack |

Une tâche qui en lance deux autres se publie donc comme une automatisation qui marche, pas
comme un tiers d'automatisation.

Deux automatisations du même nom reçoivent des noms de fichier différents
(`Nettoyage-nocturne`, `Nettoyage-nocturne-2`). Sans cela, la seconde écraserait la première
pendant que le catalogue liste les deux — une entrée servant en silence le contenu d'une autre,
ce qui se lit comme *la mauvaise automatisation publiée*, pas comme un conflit de noms.

---

## 🔐 Ce que reçoit la personne qui installe

**Pas vos permissions.** Une automatisation importée depuis un catalogue — ou depuis n'importe
quel `.bmmpa`, ou depuis un `.bmmscript` partagé — arrive **désactivée**, avec les quatre
autorisations retirées : lancer des programmes externes, exécuter des scripts, déclencher des
deeplinks, arrêter un programme.

BMM lui dit ensuite ce que le fichier demandait, pour qu'elle accorde ce qu'elle veut vraiment.

Cela vous concerne en tant qu'éditeur : **une automatisation qui a besoin d'exécuter un script
ne fonctionnera pas tant que la personne n'aura pas activé cette permission.** Dites-le dans la
description. Une tâche qui a l'air de ne rien faire est une tâche qu'on supprime.

Les `.bmmpa` sont signés à l'export, donc la personne qui importe peut voir si le fichier est
toujours ce que vous avez écrit.

---

## 📋 Le format du flux

Si vous voulez écrire ou générer le `catalog.json` vous-même :

```json
{
  "version": "1.0",
  "name": "Mes automatisations",
  "presets": [
    {
      "id": "nettoyage-nocturne",
      "name": "Nettoyage nocturne",
      "description": "Scanner, puis désactiver ce qui est énorme",
      "author": "vous",
      "version": "1.0",
      "download_url": "Nettoyage-nocturne.bmmpa",
      "tags": ["maintenance"],
      "tasks": 1
    }
  ]
}
```

| Champ | Requis | Notes |
|---|---|---|
| `id` | oui | Unique dans le catalogue. Listé deux fois, le premier gagne. |
| `name` | oui | Ce que les gens voient. |
| `download_url` | oui | Relatif de préférence. `downloadUrl` est aussi accepté. |
| `description` | non | Une ou deux lignes. |
| `author` · `version` · `tags` | non | Affichés à côté de l'entrée. |
| `tasks` | non | Combien d'automatisations sont dedans. Omis veut dire *non précisé*, ce qui n'est pas zéro et n'est pas affiché comme tel. |

Une entrée sans adresse utilisable est **écartée**, pas montrée comme une ligne qu'on ne peut
pas installer — et BMM indique combien il en a écarté et pourquoi.

---

## 🌐 Le publier sur BetterCommunity

Un catalogue hébergé chez nous est un catalogue `PRESET` sur un projet **BMM**. L'entrée pointe
vers un `.bmmpa` exactement comme ci-dessus. Voir la page *Proposer du contenu* sur le site.

---

## ❓ FAQ

**Puis-je mettre à jour une automatisation après publication ?**
Remplacez le `.bmmpa` à la même adresse. Ceux qui suivent le catalogue obtiennent la nouvelle
version à la prochaine installation. Les copies déjà installées leur appartiennent et ne sont
pas touchées.

**La personne reçoit-elle mes noms de profils, mes chemins ou mes jetons ?**
Uniquement ce qui se trouve dans les tâches que vous avez choisies. Exportez-en une et lisez-la
avant de publier — un `.bmmpa` est du JSON en clair. Les chemins tapés dans une étape y sont.

**Puis-je mélanger automatisations et autre contenu dans un catalogue ?**
Non. Un catalogue, un type. Utilisez un **index de catalogues** pour donner une seule adresse
qui en ramène plusieurs, de types différents.
