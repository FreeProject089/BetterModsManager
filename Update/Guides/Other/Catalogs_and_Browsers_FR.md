# Catalogues & Navigateurs — Comment BMM découvre du contenu

BMM possède quatre surfaces de « navigation » qui fonctionnent toutes pareil sous
le capot : un petit index JSON hébergé publiquement, récupéré à l'exécution, avec
**plusieurs sources** fusionnées en une seule liste. Ce guide explique chacune et,
surtout, **comment ajouter vos propres sources / plusieurs sources**.

> Toutes les URLs de source sont dans **`frontend/assets/links.json`** (et la copie
> hébergée sur GitHub). BMM charge les liens d'abord à distance, puis la copie
> embarquée, puis les valeurs par défaut — vous pouvez donc changer l'origine des
> catalogues sans recompiler l'app.

---

## 1. Navigateur de dépôts serveur (Server Repo)

**C'est quoi :** un annuaire de dépôts de mods publics depuis lesquels synchroniser.

**Fonctionnement**
- BMM récupère `server_browse` (un `repos.json`) listant les dépôts : nom, URL, propriétaire, description.
- Chaque entrée pointe vers un manifeste de dépôt (généré par *Generate Repo* / les outils serveur de BMM).
- En sélectionner un permet de parcourir ses mods et de les synchroniser dans un profil.

**Ajouter des dépôts**
- La liste de navigation est un seul fichier JSON (`repos.json`). Pour lister plusieurs dépôts, ajoutez plusieurs objets à son tableau :
  ```json
  [
    { "name": "DCS Core Mods", "url": "https://.../repoA/repo.json", "owner": "..." },
    { "name": "Community Skins", "url": "https://.../repoB/repo.json", "owner": "..." }
  ]
  ```
- Pour pointer BMM vers un *autre* index, changez `server_browse` dans `links.json`.
- Vous pouvez aussi coller une URL de dépôt unique directement dans la vue dépôt, sans index.

---

## 2. Catalogue Plugins & API

**C'est quoi :** le catalogue de plugins installables dans **Plugins & API → Catalogue**.

**Fonctionnement**
- BMM récupère `plugin_catalog` (un `catalog.json`) listant les plugins : id, nom, version, description, URL de téléchargement, permissions.
- L'installation récupère le `.bmmplug` et l'enregistre ; les permissions sont affichées avant qu'il puisse agir.

**Ajouter des plugins / sources**
- Un catalogue est un tableau JSON — ajoutez un objet par plugin pour en lister plusieurs :
  ```json
  {
    "plugins": [
      { "id": "auto-backup", "name": "Auto Backup", "version": "1.2.0", "url": "https://.../auto-backup.bmmplug" },
      { "id": "sync-bot",    "name": "Sync Bot",    "version": "0.4.1", "url": "https://.../sync-bot.bmmplug" }
    ]
  }
  ```
- Changez `plugin_catalog` dans `links.json` pour héberger votre propre catalogue.
- Vous pouvez toujours importer un fichier `.bmmplug` local directement (sans catalogue).

---

## 3. App Catalog

**C'est quoi :** applis & outils compagnons, dans la page **App Catalog** de la barre latérale.

**Fonctionnement**
- BMM fusionne plusieurs sources : l'`apps_catalog` officiel, des catalogues partenaires, et toute
  **URL communautaire** ajoutée dans l'onglet *Sources*.
- Chaque entrée : nom, description, icône, catégorie, prix, URL, checksum optionnel.
- L'installation télécharge (et vérifie, si un checksum est présent) l'appli et suit sa version ;
  les cartes installées proposent Lancer et Mettre à jour.

**Ajouter plusieurs sources**
- Ouvrez **App Catalog → Sources**, collez une URL de catalogue, et elle est fusionnée à la liste.
  Ajoutez autant d'URLs communautaires que vous voulez ; retirez celles qui échouent.
- Un fichier source liste plusieurs applis dans un tableau :
  ```json
  {
    "apps": [
      { "name": "Tool A", "url": "https://.../toolA.zip", "category": "utility", "sha256": "..." },
      { "name": "Tool B", "url": "https://.../toolB.msi", "category": "audio" }
    ]
  }
  ```
- Voir `Update/Guides/Catalogs-and-Repos/app-catalog-format_FR.md` pour le schéma complet.

> ⚠️ N'ajoutez que des sources de confiance — installer une appli exécute son installateur.

---

## 4. Catalogue de thèmes

**C'est quoi :** des thèmes d'interface partageables, dans **Éditeur de thèmes → Installés / catalogue**.

**Fonctionnement**
- Les thèmes sont du JSON de tokens `--bmm-*` + overrides d'éléments + assets, empaquetés en `.bmmtheme` (un ZIP).
- Le catalogue liste les thèmes des sources officielles, partenaires et communautaires.
- L'installation applique le thème instantanément (sans redémarrage) ; tout est réversible.

**Ajouter / partager des thèmes**
- **Exportez** un thème en fichier `.bmmtheme`, ou utilisez **Partager** pour copier un lien en un clic
  `bmm://theme/import-inline?data=…`.
- Pour lister plusieurs thèmes dans un catalogue, utilisez un tableau JSON d'entrées (id, nom, auteur, URL).

---

## Schéma commun (résumé)

| Navigateur | clé links.json | Fichier index | Ajouter via… |
|---|---|---|---|
| Dépôts serveur | `server_browse` | `repos.json` | ajouter des objets au tableau / coller une URL |
| Plugins & API | `plugin_catalog` | `catalog.json` | ajouter des objets plugin / importer `.bmmplug` |
| App Catalog | `apps_catalog` + URLs communautaires | `catalog.json` | onglet Sources → ajouter une URL |
| Thèmes | (catalogue de thèmes) | liste de thèmes | export/partage `.bmmtheme` / lien inline |

À retenir : **chaque catalogue n'est qu'une liste JSON hébergée, et « en ajouter plusieurs »
signifie ajouter plus d'entrées à ce JSON ou enregistrer plus d'URLs de source.** Changez les URLs
dans `links.json` pour héberger n'importe lequel vous-même.
