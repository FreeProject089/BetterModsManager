# Guide du catalogue de thèmes (BMM)

Les thèmes BMM re-stylisent l'interface de l'app. Ils se partagent via le **catalogue
de thèmes** et sont empaquetés dans un fichier `.bmmtheme` (un ZIP). Ce guide couvre
le format et la publication.

> **Construire un catalogue dans l'app :** ouvre le **Catalogue de thèmes** et clique sur
> **« Créer un catalogue de thèmes »** — coche les thèmes installés à inclure et **Exporte**
> le `catalog.json` (ou « Exporter & ajouter comme source » pour le tester tout de suite).
> Héberge le fichier n'importe où et ajoute son URL comme source communautaire, ou héberge-le
> sur **BetterCommunity** (`/submit → Héberger mon propre catalogue`) en catalogue public ou
> **privé** (sur invitation). Les fichiers locaux `.json`/`.bmmtheme` ajoutés comme sources
> sont lus directement (sans passer par le serveur).

---

## 1. Structure du paquet `.bmmtheme`

Un `.bmmtheme` est une archive ZIP contenant :

| Entrée | Requis | Rôle |
|---|---|---|
| `theme.json` | **Oui** | Le manifeste du thème — tokens + métadonnées |
| `assets/` | Non | Images/polices optionnelles utilisées par le thème |

### `theme.json`

```json
{
  "id": "midnight-orange",
  "name": "Midnight Orange",
  "author": "FreeProject089",
  "version": "1.0.0",
  "mode": "dark",
  "vars": {
    "--bmm-bg-base": "#0e0c09",
    "--bmm-bg-elevated": "#15171e",
    "--bmm-accent": "#f97316",
    "--bmm-text-primary": "#e2e6ee"
  },
  "element_overrides": [
    { "selector": ".sidebar", "props": { "border-radius": "14px" } }
  ]
}
```

| Champ | Type | Requis | Rôle |
|---|---|---|---|
| `id` | string | **Oui** | Slug unique (minuscules, tirets). Le seul champ strictement exigé par l'installateur. |
| `name` | string | Oui (en pratique) | Nom affiché dans la liste des thèmes |
| `author` | string | Non | Auteur / pseudo GitHub |
| `version` | string | Non | Version SemVer |
| `vars` | object | Non | Variables CSS `--bmm-*` → valeurs (c'est ce champ, **pas** `tokens`) |
| `element_overrides` | array | Non | CSS par sélecteur : `[{ "selector": "...", "props": { ... } }]` (un **tableau**, pas un objet) |
| `mode` | `"dark"`\|`"light"` | Non | Les thèmes clairs reçoivent des correctifs de contraste automatiques |

> Le moteur lit plusieurs autres champs optionnels — `description`, `preview`, `fonts`,
> `assets`, `global_css`, `pages` (surcharges par vue), `html_swaps`, `custom_elements`,
> `bmm_min_version`. Noms `--bmm-*` réels : `--bmm-bg-base`, `--bmm-bg-elevated`,
> `--bmm-bg-sidebar`, `--bmm-accent`, `--bmm-border`, `--bmm-text-primary/secondary/muted`.
> Le plus simple : laisser l'**Éditeur de thèmes** exporter un manifeste valide.

> [!ASTUCE]
> Pars de l'**Éditeur de thème** intégré — il exporte un `.bmmtheme` valide avec tous
> les tokens remplis, tu n'écris jamais le manifeste à la main.

---

## 2. Publier dans le catalogue

1. Ouvre **Tableau de bord → Soumettre du contenu**.
2. Projet = **BMM**, Type = **Thème**.
3. Choisis ton `.bmmtheme`, ajoute une description et jusqu'à 3 tags.
4. (Optionnel) **Générer un modèle** remplit un manifeste de départ.
5. Envoie — un modérateur vérifie avant publication.

L'entrée de catalogue stocke aussi un **deeplink `bmm://`** pour une installation en
un clic depuis le site.

---

## 3. Partager sans le catalogue

Tu peux aussi **Exporter** un thème en `.bmmtheme`, ou utiliser **Partager** pour
copier un lien `bmm://theme/import-inline?data=…` en un clic — sans catalogue.

L'installation applique le thème instantanément (sans redémarrage) et est
entièrement réversible.
