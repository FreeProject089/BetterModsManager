# BMM App Catalog — Guide du format JSON

Comment créer un catalogue que BMM peut lire pour afficher et installer des applications.

---

## Structure du dépôt

```
votre-repo/
└── catalog.json      ← seul fichier obligatoire
```

Hébergez-le sur GitHub et donnez à BMM l'URL **raw** :
```
https://raw.githubusercontent.com/VotreUser/VotreRepo/main/catalog.json
```

Ajoutez-la dans BMM sous **Catalogue Apps → Sources → Ajouter**.

---

## Modèle de confiance

Les badges (`Official`, `Partner`) sont attribués par BMM selon **l'origine du catalogue**, pas ce que le JSON déclare. Écrire `"official": true` dans un catalogue communautaire ne fait rien — BMM l'écrase.

| Source | Badge `Official` | Badge `Partner` |
|---|---|---|
| L'URL dans `links.json` (`apps_catalog`) | ✅ | ❌ |
| Une URL listée dans `official.partner_catalogs` | ❌ | ✅ |
| Tout autre catalogue (communautaire / ajouté par l'utilisateur) | ❌ | ❌ |

---

## catalog.json — champs racine

```json
{
  "version": "1.0",
  "name": "Mon Catalogue",
  "description": "Courte description.",
  "partner_catalogs": [],
  "community_imports": [],
  "apps": [ ... ]
}
```

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `version` | string | Non | Version du schéma, ex. `"1.0"` |
| `name` | string | Non | Nom affiché du catalogue |
| `description` | string | Non | Courte description |
| `partner_catalogs` | tableau d'URLs | Non | **Lu uniquement depuis le catalogue officiel.** Les URLs listées ici reçoivent le badge `Partner`. |
| `community_imports` | tableau d'URLs | Non | Autres catalogues à charger automatiquement — aucun badge accordé. |
| `apps` | tableau | **Oui** | Liste des entrées d'apps |

> `partner_catalogs` est silencieusement ignoré si votre catalogue n'est pas le catalogue officiel.

---

## Champs d'une entrée app

```json
{
  "id":           "mon-app-nom",
  "title":        "Mon Application",
  "description":  "Ce que ça fait en 1 à 3 phrases.",
  "version":      "1.2.0",
  "category":     "utility",
  "price":        "free",
  "tags":         ["dcs", "outil", "audio"],
  "requirements": "Windows 10+",
  "md_link":      "https://github.com/user/repo/blob/main/README.md",
  "images": {
    "thumb": "https://raw.githubusercontent.com/user/repo/main/thumb.png",
    "extra": [
      "https://raw.githubusercontent.com/user/repo/main/screen1.png"
    ]
  },
  "download": {
    "url":       "https://github.com/user/repo/releases/download/v1.2.0/app.exe",
    "file_type": "exe",
    "size":      15728640,
    "sha256":    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

### Obligatoires

| Champ | Type | Description |
|---|---|---|
| `id` | string | Slug unique — **sans espaces**, tirets uniquement. Utilisé comme nom de dossier. |
| `title` | string | Nom affiché |
| `description` | string | Courte description (1 à 3 phrases) |
| `category` | string | `"game"` · `"utility"` · `"other"` |
| `price` | string | `"free"` · `"freemium"` · `"paid"` |
| `tags` | tableau | Max **3** tags — utilisés pour la recherche et les filtres |
| `download.url` | string | Lien de téléchargement direct |
| `download.file_type` | string | `"zip"` · `"exe"` · `"msi"` · `"script"` |

### Optionnels

| Champ | Type | Description |
|---|---|---|
| `version` | string | Version affichée dans l'interface |
| `requirements` | string | Ex. `"Windows 10+, .NET 6"` |
| `md_link` | string | URL vers un README ou une page de documentation |
| `images.thumb` | string | Miniature de la carte — affichée dans la grille de navigation. Recommandé **16:9**, min 400×225 px. Doit être une URL HTTPS publique (GitHub raw, CDN…). |
| `images.extra` | tableau | Captures d'écran supplémentaires dans la galerie du modal de détail (bande de miniatures cliquables). Max ~5. Mêmes règles d'URL que thumb. |
| `download.size` | entier | Taille en octets (affichée avant le téléchargement) |
| `download.sha256` | chaîne | **Recommandé.** Somme de contrôle SHA-256 du fichier téléchargé. Si présente, BMM vérifie le téléchargement et avertit (modal, installation bloquée par défaut) en cas de non-correspondance — protège des fichiers altérés ou corrompus. |

> [!ASTUCE]
> Génère la somme avec `sha256sum app.exe` (Linux/macOS) ou `certutil -hashfile app.exe SHA256` (Windows), puis colle la valeur dans `download.sha256`.

### Héberger des images sur GitHub

Stockez les images dans votre repo et utilisez l'URL **raw** :
```
https://raw.githubusercontent.com/VotreUser/VotreRepo/main/images/thumb.png
```
Ou utilisez l'URL d'un asset GitHub Release (stable entre les branches) :
```
https://github.com/VotreUser/VotreRepo/releases/download/v1.0.0/thumb.png
```

> **N'incluez pas les champs `official` ou `partner`** — ils sont ignorés pour les catalogues communautaires et auto-assignés par BMM.

---

## Référence download.file_type

| Valeur | Comportement BMM |
|---|---|
| `"zip"` | Extrait dans `<dossier_install>/<id>/`. **S'il contient l'app directement** → portable, BMM choisit le `.exe` principal (meilleure correspondance de nom, ignore les désinstalleurs). **S'il contient seulement un installeur** (`setup.exe`, `*install*`, `.msi`) → BMM lance cet installeur et détecte le résultat via le registre Windows. |
| `"exe"` | Si le nom ressemble à un installeur (`setup`, `install`) → lancé, puis l'app installée est auto-détectée (registre `DisplayIcon` / `InstallLocation` / `UninstallString`). Sinon traité comme un exe portable. |
| `"msi"` | Lancé via `msiexec`, puis auto-détection via le registre. |
| `"script"` | Sauvegardé dans `<dossier_install>/<id>/` et défini comme cible de lancement. **Launch** l'exécute via le bon interpréteur : `.ps1`→PowerShell, `.bat`/`.cmd`→cmd, `.py`→python, `.vbs`→wscript, `.sh`→bash. Géré par BMM (la désinstallation supprime le dossier). |

> **Auto-détection (zéro action utilisateur) :** pour tout installeur, BMM prend un instantané des dossiers d'installation + du registre avant de le lancer, puis compare après pour trouver automatiquement le `.exe` à lancer et le désinstalleur correspondant. L'utilisateur clique seulement à travers l'assistant de l'app.

---

## Référence category

| Valeur | Couleur du badge |
|---|---|
| `"game"` | Bleu |
| `"utility"` | Violet |
| `"other"` | Gris |

---

## Template minimal prêt à copier-coller

```json
{
  "version": "1.0",
  "name": "Mon Catalogue",
  "apps": [
    {
      "id": "mon-app",
      "title": "Mon Application",
      "description": "Fait quelque chose d'utile pour DCS World.",
      "category": "utility",
      "price": "free",
      "tags": ["dcs", "outil"],
      "download": {
        "url": "https://example.com/mon-app.zip",
        "file_type": "zip",
        "size": 5242880
      }
    }
  ]
}
```

---

## Règles & conseils

- **Les IDs doivent être globalement uniques** dans tous les catalogues. Préfixez avec votre pseudo si nécessaire (`"monpseudo-monapp"`).
- **Tags** : minuscules, sans espaces, max 3.
- **Images** : utilisez des URLs raw GitHub ou un CDN public. Pas d'URLs nécessitant une authentification.
- **Size** : renseignez-la toujours — affichée à l'utilisateur avant le téléchargement.
- Les chaînes `community_imports` sont chargées récursivement jusqu'à 30 sources maximum.
