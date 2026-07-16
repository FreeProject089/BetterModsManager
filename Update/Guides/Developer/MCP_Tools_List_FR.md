# Serveur MCP BMM — Liste des Outils & Configuration

Le **Serveur MCP de Better Mods Manager (BMM)** est une console d'administration professionnelle qui permet aux agents IA d'interagir directement avec le backend de BMM. Ce guide répertorie tous les outils disponibles et fournit un exemple de configuration.

## 🛠 Outils Disponibles

### 📂 Gestion des Profils
*   `bmm_list_profiles` : Liste tous les profils BMM avec des statistiques sommaires.
*   `bmm_get_active_profile` : Récupère les informations détaillées du profil actif.
*   `bmm_get_profile` : Détails complets d'un profil spécifique (nécessite `profile_id`).
*   `bmm_set_active_profile` : Change le profil actif (nécessite `profile_id`).

### 📦 Gestion des Mods
*   `bmm_list_mods` : Liste les mods d'un profil (filtres : `all`, `enabled`, `disabled`).
*   `bmm_get_mod` : Récupère les détails techniques d'un mod (nécessite `mod_id`).
*   `bmm_search_mods` : Recherche des mods par nom, auteur ou description (nécessite `query`).
*   `bmm_set_mod_enabled` : Active ou désactive un mod (nécessite `mod_id` et un booléen `enabled`).
*   `bmm_sync` : Applique les changements au dossier du jeu (Moteur de copie physique).
*   `bmm_delete_mod` : Supprime un mod de BMM (nécessite `mod_id` ; passez `delete_files: true` pour aussi supprimer son dossier du disque — irréversible).
*   `bmm_verify_mod_integrity` : Vérifie les fichiers d'un mod sur le disque contre ses hachages SHA-256 stockés ; renvoie ok/corrompu par fichier (nécessite `mod_id`).
*   `bmm_list_tags` : Liste les tags de mods personnalisés de l'utilisateur.

### 🎁 Modpacks
*   `bmm_list_modpacks` : Liste les modpacks de l'utilisateur (nom, mods, réglages de partage).
*   `bmm_create_modpack` : Crée un modpack à partir d'une liste d'ids de mods (nécessite `name` ; `mod_ids` optionnel).

### 🌐 Infrastructure & Dépôts
*   `bmm_generate_repo` : Génère un dépôt de mods complet avec signature cryptographique Ed25519 authentique (nécessite `name`, `mod_ids`).
*   `bmm_start_repo_server` : Lance un serveur HTTP Warp + Tunnel Cloudflare automatique avec récupération de l'URL publique (nécessite `path`, `port`).
*   `bmm_generate_lightweight_server` : Génère un script `.bat` serveur autonome (Standalone Lightweight Server) avec toutes les options de configuration (nécessite `repo_path`, `port`, `auto_start`, `use_cloudflare`, `use_upnp`, `upload_limit`, `server_version`, `admin_password`).
*   `bmm_list_connected_repos` : Liste les Server-Repos auxquels ce BMM est connecté (nom, url, état de synchro).

### 📚 Documentation & Langues
*   `bmm_get_documentation_list` : Liste tous les fichiers de documentation interne (.md).
*   `bmm_read_documentation` : Lit un fichier de documentation spécifique (nécessite `file_name`).
*   `bmm_get_language_list` : Liste les langues d'interface disponibles (en, fr, etc.).
*   `bmm_read_language_file` : Lit un fichier de traduction (JSON) pour accéder aux textes et FAQ (nécessite `lang_code`).
*   `bmm_get_language_template` : Télécharge le modèle de traduction JSON depuis l'app en cours d'exécution (traduisez-le, puis importez avec `bmm_import_language`).
*   `bmm_import_language` : Importe un fichier de langue `.json` traduit dans l'app en cours d'exécution (nécessite `path`).

### 🔍 Diagnostics & Rapports
*   `bmm_get_statistics` : Statistiques globales de l'installation.
*   `bmm_list_crash_reports` : Liste les archives de rapports de crash récents.
*   `bmm_analyze_crash_report` : Extrait les métadonnées et la stacktrace d'un crash zip.
*   `bmm_read_crash_report` : Lit le contenu brut d'un rapport de crash.
*   `bmm_generate_betahub_report` : Génère un rapport de diagnostic complet pour BetaHub (nécessite `title`, `description`).
*   `bmm_export_config` : Exporte le fichier `data.json` pour sauvegarde (nécessite `target_path`).
*   `bmm_run_benchmark` : Lance un benchmark dans l'app en cours d'exécution. `dataset` : `sandbox` (généré) ou `real` (vos mods) ; `size` : `S|M|L|XL|CUSTOM` (`mb` requis pour CUSTOM) ; `sources`/`profiles` ajoutent de vrais dossiers de mods ; `mode` : `manual` (ouvre l'UI pré-remplie) ou `auto` (exécute maintenant, renvoie les résultats).
*   `bmm_list_sessions` : Liste les rapports de session enregistrés (les zips produits par l'enregistreur de sessions).

### 🚀 Launch Packs
*   `bmm_list_launch_packs` : Liste tous les Launch Packs configurés.
*   `bmm_create_launch_pack` : Crée un nouveau pack (nécessite `name`, `executable_paths`, `icon_source_path` optionnel).
*   `bmm_run_launch_pack` : Lance les applications d'un pack (nécessite `id`).
*   `bmm_delete_launch_pack` : Supprime un pack (nécessite `id`).
*   `bmm_open_launch_pack_folder` : Ouvre le dossier contenant les fichiers d'un pack (nécessite `id`).

### 🔌 Plugins & API
*   `bmm_list_plugins` : Liste les plugins BMM installés (id, nom, version, permissions, jeu cible).
*   `bmm_get_api_info` : Donne les infos de connexion à l'API Plugin locale — URL de base, port et token. Passez `reveal: true` pour obtenir le token complet au lieu d'un aperçu masqué.
*   `bmm_get_plugin` : Récupère la fiche complète d'un plugin installé — manifeste, permissions, état (nécessite `plugin_id`).
*   `bmm_api_call` : Appelle l'API locale de l'app EN COURS D'EXÉCUTION (nécessite que BMM soit ouvert). Couvre toutes les fonctions live sans outil dédié (nécessite `method`, `path` ; `body` optionnel). Uniquement GET/POST vers `127.0.0.1/api/*`.

### 🛍 App Catalog
*   `bmm_list_apps` : Liste l'état de l'App Catalog — applis compagnons installées, favoris, et vos sources de catalogue communautaires.

### 🎨 Thèmes
*   `bmm_list_themes` : Liste les thèmes d'interface installés et lequel est actif.
*   `bmm_get_theme` : Lit la définition complète d'un thème personnalisé installé — variables, surcharges d'éléments (nécessite `theme_id`).
*   `bmm_apply_theme` : Définit le thème actif par id, ex. `bmm-discord`, `bmm-void`, ou un thème personnalisé installé (nécessite `theme_id` ; s'applique quand BMM recharge les thèmes).

### ⏰ Planification & Automatisation
*   `bmm_list_schedules` : Liste les tâches de Planification & automatisation enregistrées (fonctionne hors ligne).
*   `bmm_run_schedule` : Déclenche une tâche planifiée enregistrée par id dans l'app en cours d'exécution (nécessite `id`).

### 🔒 Confidentialité & Télémétrie
*   `bmm_recorder_set` : Configure l'enregistreur de sessions local dans l'app en cours d'exécution. Tous les champs optionnels : `on` (interrupteur principal), `full` (capture de session complète), `rust` (traces côté Rust), `js` (traces frontend).
*   `bmm_telemetry_consent` : Active/désactive le consentement à la télémétrie d'usage anonyme dans l'app en cours d'exécution (nécessite un booléen `enabled`).
*   `bmm_telemetry_settings` : Définit les sous-options de télémétrie dans l'app en cours d'exécution ; les champs omis restent inchangés : `replay`, `full`, `bench` (booléens).

---

## ⚙️ Exemple de Configuration (mcp_config.json)

Pour utiliser BMM avec un agent IA (comme Claude Desktop ou Gemini), ajoutez ce qui suit à votre fichier de configuration :

```json
{
  "mcpServers": {
    "bmm": {
      "command": "C:/Chemin/Vers/BMM/binaries/bmm-mcp-server-x86_64-pc-windows-msvc.exe",
      "args": [],
      "env": {}
    }
  }
}
```

> [!TIP]
> Assurez-vous de remplacer `C:/Chemin/Vers/BMM/` par le chemin réel où Better Mods Manager est installé sur votre système.

> [!NOTE]
> Le binaire MCP supporte également un mode CLI complet. Consultez le guide [BMM_CLI_Guide_FR.md](./BMM_CLI_Guide_FR.md) pour les commandes en ligne de commande.
