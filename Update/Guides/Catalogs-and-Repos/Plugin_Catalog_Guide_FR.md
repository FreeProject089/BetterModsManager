# BMM Plugin Catalog — Guide de structure et de publication

> Ce guide explique comment structurer, héberger et référencer des plugins communautaires dans le catalogue **BetterModsManager_Plugins** afin qu'ils apparaissent dans l'onglet **Catalogue** de BMM.

> **Pas envie d'écrire le JSON à la main ?** Dans BMM, ouvre **Plugins & API → Catalogue →
> « Mes catalogues »** pour *construire* un catalogue visuellement : ajoute des entrées
> directement depuis tes plugins installés (id / nom / version / auteur / description
> préremplis), puis **Exporte** le `catalog.json` ou **« Exporter & ajouter comme source »**
> pour le tester tout de suite. Pour le partager publiquement, héberge le fichier n'importe
> où (GitHub raw, etc.) et ajoute son URL comme source — ou héberge-le sur **BetterCommunity**
> (`/submit → Héberger mon propre catalogue`), où tu peux le rendre **public ou privé**
> (privé = protégé par IP / creator id / BC id / e-mail / Discord). BMM envoie ton identité
> automatiquement quand il récupère un catalogue privé BetterCommunity — ça marche dès que
> tu es sur la liste.

---

## 1. Vue d'ensemble

Le catalogue est un fichier JSON hébergé sur GitHub à l'adresse suivante :

```
https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/catalog.json
```

BMM récupère ce fichier lorsque l'utilisateur ouvre l'onglet **Catalogue**. Tout plugin listé dans `catalog.json` y sera affiché avec un bouton **Installer**.

---

## 2. Structure du dépôt

```
BetterModsManager_Plugins/
├── catalog.json              ← Index du catalogue (obligatoire)
├── plugins/
│   ├── mon-serveur-pack/
│   │   ├── plugin.json       ← Manifeste du plugin
│   │   ├── icon.png          ← Icône optionnelle (40×40 px recommandé)
│   │   └── mon-serveur-pack.bmmplug   ← Fichier plugin packagé (ZIP)
│   └── autre-plugin/
│       └── ...
└── README.md
```

---

## 3. Format de catalog.json

```json
{
  "version": "1",
  "plugins": [
    {
      "id": "mon-serveur-pack",
      "name": "Mon Server Modpack",
      "version": "1.2.0",
      "author": "VotreNomGitHub",
      "game": "DCS World",
      "description": "Mods requis pour Mon Serveur — mis à jour pour la v2.9",
      "official": false,
      "tags": ["dcs", "multijoueur", "serveur"],
      "download_url": "https://github.com/BetterDCS/BetterModsManager_Plugins/raw/main/plugins/mon-serveur-pack/mon-serveur-pack.bmmplug",
      "icon_url": "https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/plugins/mon-serveur-pack/icon.png"
    }
  ]
}
```

### Référence des champs

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `id` | string | ✅ | Identifiant unique — minuscules, tirets uniquement (ex. `mon-serveur`) |
| `name` | string | ✅ | Nom affiché dans BMM |
| `version` | string | ✅ | Version SemVer (ex. `1.0.0`) |
| `author` | string | ✅ | Nom de l'auteur ou pseudo GitHub |
| `game` | string | — | Jeu cible (ex. `DCS World`) |
| `description` | string | — | Courte description (affichée dans la fiche plugin) |
| `official` | boolean | — | `true` = plugin officiel BMM (badge étoile dorée). Laisser `false` pour les plugins communautaires. |
| `tags` | string[] | — | Tags de recherche (ex. `["dcs", "otan", "multijoueur"]`) |
| `download_url` | string | ✅ | URL directe vers le fichier `.bmmplug` |
| `icon_url` | string | — | URL directe vers l'image de l'icône du plugin |

---

## 4. Le format .bmmplug

Un fichier `.bmmplug` est une **archive ZIP** renommée avec l'extension `.bmmplug`. Il doit contenir :

```
mon-plugin.bmmplug  (ZIP contenant)
├── plugin.json     ← Obligatoire — le manifeste du plugin
└── icon.png        ← Optionnel — affiché dans les fiches plugin (40×40 recommandé)
```

### Structure de plugin.json

```json
{
  "id": "mon-serveur-pack",
  "name": "Mon Server Modpack",
  "version": "1.2.0",
  "author": "VotreNom",
  "game": "DCS World",
  "description": "Mods requis pour Mon Serveur",
  "official": false,
  "permissions": ["mods.write"],
  "tags": ["dcs", "multijoueur"],
  "website": "https://monserveur.example.com",
  "modlist": {
    "strict": false,
    "required_mods": [
      { "name": "NomExactDuDossierMod", "optional": false },
      { "name": "ModOptionnel",          "optional": true  }
    ]
  }
}
```

> **Important :** `required_mods[].name` doit correspondre **exactement au nom du dossier** du mod (la correspondance est insensible à la casse). C'est le nom du dossier tel qu'il apparaît dans la bibliothèque de mods de BMM.

---

## 5. Comment les mods sont appariés

Lorsqu'un utilisateur clique sur **Comparer** ou **Appliquer**, BMM vérifie chaque entrée de `required_mods` :

1. Il recherche parmi tous les mods installés un nom qui **correspond sans tenir compte de la casse**
2. Si `trouvé = true` et `actif = false` → le mod est **inactif** (Appliquer l'activera)
3. Si `trouvé = false` et `optional = false` → le mod est **manquant** (bloquant)
4. Si `trouvé = false` et `optional = true` → le mod est **optionnellement manquant** (non bloquant)
5. En **mode strict** : les mods non listés qui sont actuellement actifs sont signalés comme **extra** (Appliquer les désactivera)

---

## 6. Mode strict vs non-strict

| Mode | Comportement |
|------|--------------|
| `"strict": false` | Active uniquement les mods requis. Ne touche **pas** aux autres mods actifs. |
| `"strict": true` | Active les mods requis **et désactive** tous les autres mods actifs absents de la liste. |

Utilisez le mode strict pour les serveurs compétitifs où seuls des mods spécifiques sont autorisés.

---

## 7. Publier votre plugin

1. **Créez** votre plugin dans l'onglet **Créer** de BMM et exportez-le en `.bmmplug`
2. **Testez-le** : importez le fichier dans BMM, comparez et appliquez-le
3. **Forkez** le dépôt [BetterDCS/BetterModsManager_Plugins](https://github.com/BetterDCS/BetterModsManager_Plugins)
4. Ajoutez votre fichier `.bmmplug` dans `plugins/votre-plugin-id/`
5. Mettez à jour `catalog.json` pour inclure l'entrée de votre plugin
6. Ouvrez une **Pull Request** — elle sera révisée et fusionnée par les mainteneurs
7. Une fois fusionné, votre plugin apparaîtra dans l'onglet Catalogue de BMM pour tous les utilisateurs

---

## 8. Mettre à jour un plugin existant

- Incrémentez le champ `version` dans `plugin.json` et dans `catalog.json`
- Ré-exportez le fichier `.bmmplug` et remplacez l'ancien dans votre PR
- BMM affiche la nouvelle version dans le Catalogue — les installations existantes **ne sont pas** mises à jour automatiquement (l'utilisateur doit réinstaller)

---

## 9. Permissions

Déclarez les permissions dont votre plugin a besoin dans `plugin.json` :

| Permission | Ce qu'elle permet |
|-----------|------------------|
| `mods.write` | Activer / désactiver / éditer / supprimer des mods |
| `profiles.write` | Créer / activer / éditer / supprimer des profils |
| `modpacks.write` | Créer / activer / désactiver / éditer / supprimer des modpacks |
| `plugins.read` | Comparer une modlist (`POST /api/plugins/compare`) |
| `plugins.write` | Appliquer une modlist (`POST /api/plugins/apply`) |
| `repo.write` | Connecter / déconnecter / synchroniser / générer un dépôt serveur |
| `app.read` · `app.write` | Lire les apps installées · installer / lancer / désinstaller |
| `catalog.read` · `catalog.write` | Lire le catalogue local · créer / éditer / supprimer des entrées |

Ce sont les seules valeurs que BMM applique — voir `require_permission(...)` dans
`src-tauri/src/api/mod.rs`. Toute autre valeur placée dans `permissions` est stockée telle
quelle et ne contrôle rien : une faute de frappe échoue donc silencieusement.

**Ne demandez pas de permission de lecture — il n'y en a pas.** `GET /api/mods`,
`/api/profiles` et `/api/plugins` ne demandent ni token ni permission : un plugin qui se
contente de lire doit déclarer `"permissions": []`. Seuls `app`, `catalog` et `plugins`
contrôlent une lecture.

BMM demandera à l'utilisateur d'accorder les permissions la première fois.

---

*Guide version 1.0 — Système de plugins BetterModsManager*
