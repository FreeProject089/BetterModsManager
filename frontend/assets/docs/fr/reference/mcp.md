# Référence du serveur MCP

BMM embarque un **serveur MCP** : les mêmes capacités que l'application, exposées comme des
outils Model Context Protocol pour qu'une IA puisse piloter BMM directement — lister tes
mods, changer de profil, vérifier l'intégrité, déclencher une tâche planifiée.

C'est un exécutable séparé, posé à côté de `BetterModsManager.exe` dans le dossier
d'installation (`bmm-mcp-server.exe`, déclaré en `externalBin` dans la config Tauri de
l'app). Il parle **JSON-RPC sur stdio**, ce qu'attend n'importe quel client MCP : aucun port
à ouvrir, rien qui écoute sur le réseau.

!!! info "À ne pas confondre avec l'API locale"

    L'[API HTTP locale](doc-page:reference/api) est faite pour les **plugins** et les scripts : une surface
    REST sur `127.0.0.1`, avec jetons et permissions. Le serveur MCP est fait pour les
    **clients IA** : stdio, pas de jeton, et il lit directement les fichiers de données de
    BMM. Le recouvrement est voulu — le dernier outil de cette page, `bmm_api_call`, c'est
    le serveur MCP qui appelle l'API locale pour toi.

---

## Se connecter

Pointe ton client MCP sur l'exécutable. La forme est la même partout ; seul le fichier de
config change.

```json
{
  "mcpServers": {
    "bmm": {
      "command": "C:\Program Files\BetterModsManager\bmm-mcp-server.exe"
    }
  }
}
```

Aucun argument, aucune variable d'environnement. Le serveur trouve les données de BMM tout
seul.

---

## Outils hors ligne et outils « app ouverte »

C'est la distinction qui décide si un appel fonctionne, et elle mérite d'être comprise avant
de lire les tableaux.

La plupart des outils lisent le `data.json` de BMM directement sur le disque : ils répondent
**que BMM tourne ou non** — tu peux demander quels mods contient un profil avec l'app fermée.
Les outils marqués **app** agissent sur l'application en cours à la place : ils passent par
l'API locale et échouent sur une erreur de connexion si la fenêtre de BMM n'est pas ouverte.

| | Lit | Fonctionne BMM fermé |
|---|---|---|
| Outils simples | `data.json`, rapports de plantage, fichiers de langue, doc embarquée | oui |
| Outils marqués **app** | l'application en cours, via `127.0.0.1` | non |

---

## Les outils

59 au total. `*` marque un paramètre obligatoire ; une liste séparée par des barres obliques
donne les valeurs acceptées.

### Recherche

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_search` | `query`\*, `limit` |  | Cherche dans TOUT ce que BMM connaît en un appel : mods installés, profils et pages de doc embarquées |
| `bmm_search_mods` | `query`\* |  | Cherche parmi les mods |

### Profils

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_profiles` | — |  | Liste tous les profils BMM |
| `bmm_get_active_profile` | — |  | Renvoie le profil actif |
| `bmm_get_profile` | `profile_id`\* |  | Détaille un profil précis |
| `bmm_set_active_profile` | `profile_id`\* | app | Active un profil |

### Mods

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_mods` | `profile_id`, `filter` (all/enabled/disabled) |  | Liste les mods, avec filtres optionnels |
| `bmm_get_mod` | `mod_id`\* |  | Détaille un mod précis |
| `bmm_set_mod_enabled` | `mod_id`\*, `enabled`\* | app | Active ou désactive un mod |
| `bmm_delete_mod` | `mod_id`\*, `delete_files` | app | Retire un mod de BMM |
| `bmm_verify_mod_integrity` | `mod_id`\* |  | Vérifie les fichiers d'un mod sur disque contre ses empreintes SHA-256 stockées |
| `bmm_list_tags` | — |  | Liste les tags de mods personnalisés |
| `bmm_sync` | — | app | Synchronise les fichiers du profil actif (applique les mods) |

### Modpacks & Launch Packs

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_modpacks` | — |  | Liste les modpacks (nom, mods, réglages de partage) |
| `bmm_create_modpack` | `name`\*, `mod_ids`\* |  | Crée un modpack depuis une liste d'ids de mods |
| `bmm_list_launch_packs` | — |  | Liste les Launch Packs configurés |
| `bmm_create_launch_pack` | `name`\*, `executable_paths`\*, `icon_source_path` |  | Crée un Launch Pack (groupe d'applications à lancer) |
| `bmm_run_launch_pack` | `id`\* | app | Lance toutes les applications d'un Launch Pack |
| `bmm_delete_launch_pack` | `id`\* |  | Supprime un Launch Pack |
| `bmm_open_launch_pack_folder` | `id`\* |  | Ouvre le dossier contenant les fichiers du Launch Pack |

### Dépôts Serveur

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_connected_repos` | — |  | Liste les Dépôts Serveur connectés (nom, url, état de synchro) |
| `bmm_generate_repo` | `name`\*, `mod_ids`\* |  | Génère un dépôt depuis une liste de mods |
| `bmm_repo_extras` | `url`\*, `password` | app | Liste ce qu'un dépôt transporte en plus des mods — plugins, automatisations, thèmes, listes de mods, catalogues à suivre. Lit le manifeste ; ne télécharge rien. `locked: true` sur une liste signifie que son contenu est chiffré |
| `bmm_repo_extra_take` | `url`\*, `kind`\*, `id`\*, `password` | app | En installe UN. Un plugin ou une automatisation arrive **désactivé**, et un plugin sans aucune permission — en prendre un n'est pas une décision de l'exécuter. Un catalogue est suivi, pas téléchargé ; une liste de mods est enregistrée et son chemin renvoyé, parce que l'ouvrir pose des questions qui reviennent à une personne |
| `bmm_list_keys` | — | app | Les clés d'identité avec lesquelles BMM peut prouver : `{name, path}` et laquelle est active. **Noms et chemins uniquement** — aucun outil ne lit une clé privée |
| `bmm_create_key` | `name`\*, `kind` | app | Fabrique une paire de clés. Renvoie la ligne **publique** — celle à donner à qui gère une source protégée — et où la moitié privée a été écrite. La moitié privée n'est jamais renvoyée. `ed25519` sauf si un serveur dit le contraire |
| `bmm_start_repo_server` | `path`\*, `port`\* | app | Démarre le serveur de dépôt |
| `bmm_generate_lightweight_server` | `repo_path`\*, `port`\*, `auto_start`\*, `use_cloudflare`\*, `use_upnp`\*, `upload_limit`\*, `server_version`\*, `admin_password`\*, `enable_docker`, `docker_host_type`, `server_type` |  | Génère un script serveur autonome (.bat) pour un dépôt donné |

### Plugins & applications

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_plugins` | — |  | Liste les plugins BMM installés (id, nom, version, permissions, jeu ciblé) |
| `bmm_get_plugin` | `plugin_id`\* |  | Renvoie la fiche complète d'un plugin installé (manifeste, permissions, état) |
| `bmm_list_apps` | — |  | Liste l'état de l'App Catalog : applications installées, favoris, sources communautaires |
| `bmm_get_api_info` | `reveal` |  | Renvoie les infos de connexion de l'API locale (URL, port, jeton) |

### Thèmes

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_themes` | — |  | Liste les thèmes d'interface installés et lequel est actif |
| `bmm_apply_theme` | `theme_id`\* | app | Définit le thème BMM actif par son id (p. ex. bmm-discord, bmm-void, ou un thème personnalisé installé) |
| `bmm_get_theme` | `theme_id`\* |  | Lit la définition complète d'un thème personnalisé INSTALLÉ (variables, surcharges d'éléments) |

### Planification & benchmarks

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_schedules` | — |  | Liste les tâches de Planification & automatisation enregistrées (fonctionne hors ligne) |
| `bmm_create_schedule` | `task` | ✓ | Crée ou met à jour une automatisation (même forme que le builder in-app ; blocs if/repeat/doWhile/forEach/switch). Créée DÉSACTIVÉE sans enabled:true |
| `bmm_delete_schedule` | `id` | ✓ | Supprime une automatisation |
| `bmm_create_plugin_scaffold` | `manifest` | ✓ | Écrit un BROUILLON de plugin (plugin.json + README) dans plugin-drafts/ — autorat seulement, l'installation reste le flux normal de l'app |
| `bmm_run_schedule` | `id`\* | app | Déclenche une tâche du planificateur par son id, dans l'app BMM ouverte |
| `bmm_run_benchmark` | `dataset` (sandbox/real), `size` (S/M/L/XL/CUSTOM), `mb`, `sources`, `profiles`, `mode` (manual/auto) | app | Lance un benchmark BMM dans l'app ouverte |

### Confidentialité, enregistreur & sessions

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_telemetry_consent` | `enabled`\* | app | Active ou coupe le consentement à la télémétrie anonyme dans l'app ouverte (opt-in RGPD) |
| `bmm_telemetry_settings` | `replay`, `full`, `bench` | app | Règle les sous-options Confidentialité & télémétrie dans l'app ouverte |
| `bmm_recorder_set` | `on`, `full`, `rust`, `js` | app | Configure l'enregistreur de session local dans l'app BMM ouverte |
| `bmm_list_sessions` | — |  | Liste les rapports de session enregistrés (les zips produits par l'enregistreur) |

### Diagnostic

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_list_crash_reports` | `limit` |  | Liste les rapports de plantage |
| `bmm_read_crash_report` | `report_path`\* |  | Lit le contenu brut d'un rapport de plantage |
| `bmm_analyze_crash_report` | `report_path`\* |  | Analyse un rapport de plantage |
| `bmm_generate_betahub_report` | `title`\*, `description`\* |  | Génère un rapport pour BetaHub |
| `bmm_get_statistics` | — |  | Renvoie les statistiques globales |

### Documentation & langues

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_get_documentation_list` | — |  | Liste la documentation .md interne |
| `bmm_read_documentation` | `file_name`\* |  | Lit un fichier de documentation interne |
| `bmm_get_language_list` | — |  | Liste les langues d'interface disponibles |
| `bmm_read_language_file` | `lang_code`\* |  | Lit un fichier de langue (textes d'interface / FAQ) |
| `bmm_get_language_template` | — | app | Télécharge le modèle de traduction JSON depuis l'app ouverte (traduis-le, puis importe avec bmm_import_language) |
| `bmm_import_language` | `path`\* | app | Importe un fichier de langue .json traduit dans l'app ouverte |

### Données & porte de sortie

| Outil | Paramètres | Requiert | Ce que ça fait |
|---|---|---|---|
| `bmm_export_config` | `target_path`\* |  | Exporte le data.json de BMM |
| `bmm_api_call` | `method`\* (GET/POST), `path`\*, `body` | app | Appelle l'API locale de l'app BMM EN COURS D'EXÉCUTION (l'app doit être ouverte) |

---

## `bmm_api_call`, la porte de sortie

Tous les autres outils sont une capacité nommée avec un schéma. `bmm_api_call` est la porte
brute : il exécute un `GET` ou un `POST` sur l'API locale de l'app en cours, donc tout ce que
l'API sait faire reste atteignable même là où aucun outil dédié n'existe encore.

```json
{ "method": "POST", "path": "/api/mods/enable", "body": { "mod_id": "abc123" } }
```

Il est volontairement étroit : seulement `GET` et `POST`, et seulement vers
`127.0.0.1/api/*`. On ne peut pas le pointer sur un autre hôte.

!!! warning "Deux appels méritent un temps d'arrêt"

    `bmm_delete_mod` avec `delete_files=true` supprime le dossier du mod sur le disque, et
    c'est irréversible. Sans ce drapeau, il retire seulement l'entrée et laisse les fichiers.

    `bmm_get_api_info` avec `reveal=true` renvoie le **jeton complet de l'API locale**, pas un
    aperçu masqué. Ce jeton vaut des droits admin — voir l'avertissement sur
    [`GET /api/data`](doc-page:reference/api). Tout ce qui peut le lire peut s'accorder tout le reste.

---

## Comment cette page reste juste

Les tableaux ci-dessus sont générés depuis les déclarations `Tool::new(...)` de
`src-tauri/src/mcp/server.rs` — celles-là mêmes que le serveur enregistre au démarrage —
plutôt qu'écrits à la main, parce que 59 outils avec leurs paramètres, c'est exactement le
genre de liste qui pourrit dès qu'on en ajoute un.

Une vérification vaut le coup après chaque changement : tout outil **déclaré** par le serveur
doit aussi être **dispatché**, sinon un client voit un outil qui échoue à l'appel. À l'heure
où ces lignes sont écrites, les deux ensembles font 59 et sont identiques.

---

## Voir aussi

- [API locale &amp; deeplinks](doc-page:reference/api) — la surface REST, ses jetons et ses permissions
- [Référence des actions](doc-page:reference/actions) — ce que les plugins et le planificateur peuvent déclencher
- [Étendre BMM](doc-page:how-it-works/extending) — la place du serveur MCP dans la conception
