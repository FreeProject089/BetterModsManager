# Publier une liste de dépôts ou un index de catalogues

La plupart des choses que tu publies sont des **collections d'items** : un catalogue de
plugins contient des plugins, un catalogue de thèmes contient des thèmes. Deux choses ne le
sont pas, et ce guide leur est consacré :

- une **liste de Server-Repos** — un fichier nommant des dépôts, que lit *Parcourir les
  Server-Repos* dans BMM ;
- un **index de catalogues** — un catalogue de catalogues, une seule adresse qui en ramène
  plusieurs d'un coup.

Ni l'un ni l'autre n'a d'items à envoyer. Chacun est un document JSON unique listant des
adresses servies par quelqu'un d'autre — c'est pourquoi l'hébergement en est gratuit.

---

## Construire le fichier dans BMM

Tu ne les écris pas à la main.

**Une liste de dépôts** — *Server Repo → Parcourir les Server-Repos → construire un
catalogue*. Récupère les dépôts que tu suis déjà, coche ceux que tu veux, enregistre. BMM
écrit :

```json
{
  "name": "Mon catalogue de dépôts",
  "generatedAt": "2026-08-24T10:00:00.000Z",
  "repos": [
    {
      "name": "Dépôt communautaire DCS",
      "url": "https://depot.exemple.com",
      "description": "Livrées et mods sonores.",
      "region": "eu",
      "category": "community"
    }
  ]
}
```

**Un index de catalogues** — *Paramètres → Index de catalogues → construire un index*.
Choisis parmi les catalogues que tu suis déjà, de tous types. BMM écrit :

```json
{
  "version": "1.0",
  "name": "Mon index",
  "description": "Tout ce que je publie.",
  "catalogs": [
    { "type": "plugin",   "url": "https://exemple.com/plugins.json",   "name": "Mes plugins" },
    { "type": "theme",    "url": "https://exemple.com/themes.json",    "name": "Mes thèmes" },
    { "type": "tutorial", "url": "https://exemple.com/tutoriels.json", "name": "Mes tutoriels" },
    { "type": "repo",     "url": "https://exemple.com/depots.json",    "name": "Mes dépôts" }
  ]
}
```

`type` peut valoir `app`, `plugin`, `theme`, `preset`, `modpack`, `repo` ou `tutorial`. Tout
autre est écarté par le lecteur plutôt que deviné.

---

## L'héberger sur BetterCommunity

**Proposer du contenu → Héberger mon propre catalogue**, puis dans *Type de catalogue*
choisis dans le groupe **Listes et index** :

| Type | Le fichier attendu |
|---|---|
| **Liste de Server-Repos** | un document avec un tableau `repos` |
| **Index de catalogues** | un document avec un tableau `catalogs` |

Le formulaire vérifie le **bon** tableau pour le type choisi et dit lequel manque le cas
échéant — une liste de dépôts envoyée comme index est attrapée à l'envoi, pas par un lecteur
des semaines plus tard.

Le mode d'hébergement est **brut**, et il n'y a pas d'autre option : il n'y a pas de charge
utile par entrée, donc rien à mettre dans un pool de stockage. C'est aussi pourquoi ça ne
coûte rien.

Tout le reste se comporte comme n'importe quel catalogue — visibilité, mot de passe de
téléchargement, clés autorisées, lien de partage privé. L'adresse obtenue est stable, et c'est
celle que tu distribues.

---

## L'héberger ailleurs

Ce sont des fichiers JSON servis en HTTP(S). GitHub Pages, un hébergement statique, ton propre
serveur — tout ce qui renvoie le fichier avec un type de contenu correct fonctionne. BMM n'a
besoin que de l'URL.

Si tu les sers depuis un **serveur généré par BMM**, ils sont soumis à l'`access.json` de ce
serveur comme n'importe quel autre fichier — voir *Fermer un serveur que tu as généré*.

---

## Ce qu'un lecteur en fait

**Une liste de dépôts** apparaît dans *Parcourir les Server-Repos* à côté de la liste
officielle. Les entrées qu'elle amène sont taguées **community** par BMM, quoi que prétende le
fichier — une liste ne peut pas promouvoir ses propres entrées.

**Un index** se colle dans *Paramètres → Index de catalogues*. Le lecteur peut **Regarder
dedans** — voir chaque catalogue avec son type et son nombre d'items, et les ajouter un par un
— ou **Tout ajouter**. Les catalogues arrivés par un index sont enregistrés avec l'index dont
ils viennent : *Historique* peut donc répondre « d'où vient celui-ci » et en restaurer un que
tu as retiré.

Une entrée d'index qui prétend `official: true` est **ignorée**. La confiance vient de l'URL
source avec laquelle BMM a été configuré, et un index capable de l'accorder serait un
contournement plutôt qu'une extension.

---

## Le tenir à jour

Les deux fichiers sont des instantanés. Reconstruis et réenvoie quand ce que tu publies change
— il n'y a pas de synchronisation retour depuis BMM.

Deux champs valent la peine d'être remplis sur les entrées d'index, même s'ils sont
facultatifs :

- `updatedAt` — quand le catalogue pointé a changé pour la dernière fois ;
- `items` — combien de choses il contient.

Les lecteurs voient les deux dans *Regarder dedans*, et un index dont les entrées ne portent
ni l'un ni l'autre n'est qu'une liste d'URL qu'il faut cliquer pour évaluer.

---

## Voir aussi

- **Index de catalogues — une adresse pour plusieurs catalogues** — le format complet, et
  comment BMM le lit
- **Fermer un serveur que tu as généré** — le contrôle d'accès d'un serveur auto-hébergé
- **Écrire un tutoriel interactif** — publier un catalogue de tutoriels, qu'un index peut lister
