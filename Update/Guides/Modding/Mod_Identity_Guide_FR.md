# Guide d'identité des mods (bmm.json)

Better Mod Manager (BMM) peut attribuer une **identité stable et universelle** à votre mod. Cela permet à BMM de reconnaître le même mod sur différentes installations, Server Repos et chez d'autres utilisateurs — peu importe le nom du dossier.

C'est entièrement **optionnel**. BMM fonctionne parfaitement sans ça.

---

## Pourquoi est-ce utile ?

Sans identité déclarée, BMM calcule un ID à partir des noms et tailles des fichiers de votre mod. Ça marche dans la plupart des cas, mais peut poser problème si :

- Quelqu'un renomme le dossier du mod
- Un fichier est ajouté ou supprimé (ex : un fichier de config personnel)
- Le mod est téléchargé depuis un Server Repo puis re-scanné

Un fichier `bmm.json` fixe l'identité de façon permanente.

---

## Comment l'ajouter

Créez un fichier nommé `bmm.json` à la **racine de votre dossier de mod** :

```
VotreDossierMod/
  bmm.json        ← ici
  ... vos fichiers de mod
```

Contenu minimal (un seul champ suffit) :

```json
{
  "id": "com.votrenom.votremod"
}
```

---

## Schéma complet

```json
{
  "id": "com.votrenom.votremod",
  "name": "Nom affiché de votre mod",
  "version": "1.2.0",
  "author": "VotreNom",
  "description": "Une courte description de ce que fait ce mod."
}
```

| Champ | Requis | Notes |
|---|---|---|
| `id` | **Oui** (pour être utile) | Globalement unique. Minuscules, sans espaces. |
| `name` | Non | Remplace le nom du dossier dans BMM |
| `version` | Non | Affiché dans BMM |
| `author` | Non | Affiché dans BMM |
| `description` | Non | Affiché dans BMM |

---

## Convention de nommage des IDs

Utilisez le style **reverse-DNS** : `com.nomauteur.nommod`

```
com.alice.meilleureherbe
com.teamrocket.overhaul-hardcore
io.github.bob.monmod
```

Règles :
- Minuscules uniquement
- Pas d'espaces (les tirets et points sont autorisés)
- Doit être globalement unique — incluez votre nom ou pseudo

---

## Ce que BMM fait sans bmm.json

BMM calcule automatiquement un ID à partir de la liste des fichiers et de leurs tailles dans votre dossier de mod. Cet ID est :

- **Stable** tant que la liste de fichiers ne change pas
- **Différent** d'une machine à l'autre si le dossier est renommé ou si des fichiers sont ajoutés/supprimés
- **Non lisible** par un humain (c'est un hash hexadécimal)

Pour les mods simples qui ne changent pas, cet ID automatique est suffisant.  
Pour les mods distribués via des **Server Repos** ou conçus pour fonctionner avec les **Plugins BMM**, `bmm.json` est fortement recommandé.

---

## Statut dans BMM

BMM affiche le statut d'identité dans le panneau de détail du mod :

| Statut | Signification |
|---|---|
| `DECLARED` | `bmm.json` trouvé — le plus fiable |
| `PRECISE` | Hash de contenu calculé — fiable |
| `APPROXIMATE` | Path+taille uniquement — peut changer si des fichiers sont modifiés |
| `NOT COMPUTED` | Cliquez ↻ dans le panneau de détail pour calculer |
