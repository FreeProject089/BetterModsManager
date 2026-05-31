# Guide du Navigateur de Dépôts Serveurs

Ce guide explique comment ajouter votre dépôt serveur au navigateur Better Mods Manager.

## Structure de repos.json

Le fichier `repos.json` contient une liste de dépôts serveurs que les utilisateurs peuvent parcourir et auxquels ils peuvent se connecter. Chaque entrée de dépôt doit inclure les champs suivants :

### Champs Obligatoires

| Champ | Type | Description |
|-------|------|-------------|
| `name` | string | Nom d'affichage du dépôt |
| `url` | string | URL directe vers le fichier `repo.json` du dépôt |
| `id` | string | Identifiant unique pour le dépôt |
| `category` | string | Soit `"official"` ou `"partner"` |
| `mods_count` | number | Nombre total de mods dans le dépôt |
| `size` | number | Taille totale en octets |
| `version` | string | Chaîne de version du dépôt |
| `last_update` | string | Date de dernière mise à jour (format YYYY-MM-DD) |

### Champs Optionnels

| Champ | Type | Description |
|-------|------|-------------|
| `changelog_link` | string | URL vers le fichier markdown du changelog |
| `tags` | array | Tableau de tags (ex: `["DCS", "Stable"]`) |
| `region` | string | Région du serveur (ex: `"EU"`, `"US"`, `"SA"`, `"Asia"`, `"Africa"`, `"Oceania"`) |
| `ping` | number | Ping moyen en millisecondes |
| `description` | string | Brève description du dépôt |
| `website_link` | string | URL vers le site web du dépôt |
| `discord_link` | string | URL d'invitation Discord du dépôt |

## Exemple de repos.json

```json
[
  {
    "name": "Dcs Root Mod Folder Repo",
    "url": "https://your-server.com/repo.json",
    "id": "dcs-root-mod-folder",
    "category": "official",
    "mods_count": 10,
    "size": 5520129295,
    "version": "1.0",
    "last_update": "2026-05-15",
    "changelog_link": "https://your-server.com/changelog.md",
    "tags": ["DCS"],
    "region": "EU",
    "ping": 45,
    "description": "Dépôt officiel de mods DCS World avec structure de dossier racine",
    "website_link": "https://your-server.com",
    "discord_link": "https://discord.gg/your-invite"
  },
  {
    "name": "Community Mods",
    "url": "https://community-server.com/repo.json",
    "id": "community-mods-001",
    "category": "partner",
    "mods_count": 85,
    "size": 3221225472,
    "version": "2.1.0",
    "last_update": "2026-05-10",
    "changelog_link": "https://community-server.com/changelog.md",
    "tags": ["Community", "Experimental"],
    "region": "US",
    "ping": 120,
    "description": "Dépôt maintenu par la communauté avec des mods expérimentaux",
    "website_link": "https://community-server.com",
    "discord_link": "https://discord.gg/community-invite"
  }
]
```

## Comment Ajouter Votre Dépôt

1. **Générez votre dépôt** en utilisant la fonctionnalité "Server Repo" → "Generate Repo" dans BMM
2. **Hébergez votre dépôt** sur un serveur web ou GitHub Pages
3. **Obtenez l'URL de votre repo.json** (ex: `https://your-server.com/repo.json`)
4. **Créez une entrée** dans le fichier `repos.json` avec les détails de votre dépôt
5. **Soumettez une pull request** au dépôt BetterDCS/Better_ModManager_ServerBrowse

## Lignes Directrices de Région

Les valeurs acceptées pour le champ `region` sont :

| Valeur | Région |
|--------|--------|
| `EU` | Europe |
| `US` | Amérique du Nord |
| `SA` | Amérique du Sud |
| `Asia` | Asie |
| `Africa` | Afrique |
| `Oceania` | Océanie |

Utilisez ces codes exacts pour permettre aux utilisateurs de filtrer les dépôts par région dans le navigateur.

## Lignes Directrices de Catégorie

- **Official** : Dépôts maintenus par l'équipe BMM ou des partenaires officiels
- **Partner** : Dépôts maintenus par des membres de confiance de la communauté

## Ajout de Liens et Discord

Pour ajouter des liens vers votre site web et votre serveur Discord dans votre dépôt :

### Lien vers le Site Web

Ajoutez le champ `website_link` avec l'URL de votre site web :
```json
{
  "website_link": "https://your-server.com"
}
```

### Lien Discord

Ajoutez le champ `discord_link` avec l'URL d'invitation de votre serveur Discord :
```json
{
  "discord_link": "https://discord.gg/your-invite-code"
}
```

Ces liens seront affichés dans le navigateur de dépôts de BMM, permettant aux utilisateurs de visiter facilement votre site web ou rejoindre votre serveur Discord pour obtenir de l'aide ou des informations supplémentaires.

## Calcul de la Taille

Pour calculer la taille totale en octets, vous pouvez utiliser le fichier `Info.json` généré par BMM lors de l'export d'un dépôt. Le champ `total_size_bytes` contient cette valeur.

## Format du Changelog

Le changelog doit être un fichier markdown avec l'historique des versions :

```markdown
# Changelog

## v1.0.0 (2026-05-15)
- Version initiale
- Ajout de 10 mods
- Taille totale : 5.14 GB
```

## Options d'Hébergement

### GitHub Pages
1. Créez un dépôt avec vos fichiers de dépôt
2. Activez GitHub Pages dans les paramètres du dépôt
3. Utilisez l'URL GitHub Pages pour votre `repo.json`

### Serveur Web
1. Uploadez vos fichiers de dépôt sur votre serveur web
2. Assurez-vous que les en-têtes CORS sont configurés si nécessaire
3. Utilisez l'URL de votre serveur pour le `repo.json`

### Serveur BMM Intégré
1. Utilisez le bouton "Start Local Host" dans BMM
2. Configurez le port et les paramètres réseau
3. Partagez votre IP locale avec les utilisateurs de votre réseau

## Test de Votre Dépôt

Avant d'ajouter au navigateur, testez votre dépôt :
1. Ouvrez BMM
2. Allez dans "Server Repo" → "Synchronize from a Repository"
3. Entrez l'URL de votre dépôt
4. Cliquez sur "FETCH"
5. Vérifiez que les mods et les profils s'affichent correctement

## Support

Pour les problèmes ou questions, visitez le Discord BMM ou le dépôt GitHub.
