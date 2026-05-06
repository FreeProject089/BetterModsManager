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

### 🌐 Infrastructure & Dépôts
*   `bmm_generate_repo` : Génère un dépôt de mods complet avec signature cryptographique Ed25519 authentique (nécessite `name`, `mod_ids`).
*   `bmm_start_repo_server` : Lance un serveur HTTP Warp + Tunnel Cloudflare automatique avec récupération de l'URL publique (nécessite `path`, `port`).
*   `bmm_generate_lightweight_server` : Génère un script `.bat` serveur autonome (Standalone Lightweight Server) avec toutes les options de configuration (nécessite `repo_path`, `port`, `auto_start`, `use_cloudflare`, `use_upnp`, `upload_limit`, `server_version`, `admin_password`).

### 📚 Documentation & Langues
*   `bmm_get_documentation_list` : Liste tous les fichiers de documentation interne (.md).
*   `bmm_read_documentation` : Lit un fichier de documentation spécifique (nécessite `file_name`).
*   `bmm_get_language_list` : Liste les langues d'interface disponibles (en, fr, etc.).
*   `bmm_read_language_file` : Lit un fichier de traduction (JSON) pour accéder aux textes et FAQ (nécessite `lang_code`).

### 🔍 Diagnostics & Rapports
*   `bmm_get_statistics` : Statistiques globales de l'installation.
*   `bmm_list_crash_reports` : Liste les archives de rapports de crash récents.
*   `bmm_analyze_crash_report` : Extrait les métadonnées et la stacktrace d'un crash zip.
*   `bmm_read_crash_report` : Lit le contenu brut d'un rapport de crash.
*   `bmm_generate_betahub_report` : Génère un rapport de diagnostic complet pour BetaHub (nécessite `title`, `description`).
*   `bmm_export_config` : Exporte le fichier `data.json` pour sauvegarde (nécessite `target_path`).

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
