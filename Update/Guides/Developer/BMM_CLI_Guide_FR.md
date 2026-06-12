# BMM CLI — Guide Complet

Le binaire `bmm-mcp-server` intègre un **CLI (Command Line Interface)** complet qui permet de gérer Better Mods Manager directement depuis un terminal, sans ouvrir l'interface graphique.

## 🚀 Démarrage Rapide

```bash
# Afficher l'aide générale
bmm-mcp-server --help

# Afficher la version
bmm-mcp-server --version

# Informations sur l'environnement BMM
bmm-mcp-server info
```

---

## 📂 Gestion des Profils

```bash
# Lister tous les profils
bmm-mcp-server profiles

# Voir le profil actif
bmm-mcp-server active-profile

# Changer le profil actif
bmm-mcp-server set-profile <PROFILE_ID>
```

### Exemple de sortie (`profiles`)
```
┌───┬───────────┬───────────────────────┬──────┬─────────────────────────────────┐
│   ┆ ID        ┆ Name                  ┆ Game ┆ Mods Path                       │
╞═══╪═══════════╪═══════════════════════╪══════╪═════════════════════════════════╡
│ ► ┆ 3d616b84… ┆ Dcs_Root_Folder       ┆ DCS  ┆ E:\Mods\Dcs_Mods\Root_Mods      │
│   ┆ 4e33387d… ┆ Dcs_SavedGames_Folder ┆ DCS  ┆ E:\Mods\Dcs_Mods\SavedGame_Mods │
└───┴───────────┴───────────────────────┴──────┴─────────────────────────────────┘
```

---

## 📦 Gestion des Mods

```bash
# Lister tous les mods
bmm-mcp-server mods

# Lister uniquement les mods activés
bmm-mcp-server mods --filter enabled

# Lister les mods désactivés d'un profil spécifique
bmm-mcp-server mods --profile <PROFILE_ID> --filter disabled

# Détails d'un mod
bmm-mcp-server mod <MOD_ID>

# Rechercher un mod
bmm-mcp-server search "ECHO"

# Activer un mod
bmm-mcp-server enable <MOD_ID>

# Désactiver un mod
bmm-mcp-server disable <MOD_ID>

# Synchroniser (appliquer les changements)
bmm-mcp-server sync
```

---

## 🌐 Infrastructure & Dépôts

### Générer un dépôt de mods (avec signature cryptographique)

```bash
bmm-mcp-server generate-repo --name "Mon_Depot" --mod-ids id1,id2,id3
```

Le dépôt est automatiquement signé avec votre clé Ed25519 (`creator_v2.key`), garantissant le statut "Verified" dans le client BMM.

### Démarrer le serveur HTTP + Tunnel Cloudflare

```bash
bmm-mcp-server start-server --path "C:\Chemin\Vers\Depot" --port 8080
```

### Générer un serveur autonome (Standalone Lightweight)

```bash
bmm-mcp-server generate-lightweight \
  --repo-path "C:\Chemin\Vers\Depot" \
  --port 8000 \
  --cloudflare \
  --upnp \
  --server-version 2 \
  --password "monMotDePasse"
```

| Option | Description | Défaut |
|---|---|---|
| `-d, --repo-path` | Chemin vers le dossier du dépôt | **Requis** |
| `-p, --port` | Port du serveur | `8000` |
| `--auto-start` | Démarrer avec Windows (registre) | `false` |
| `--cloudflare` | Activer le Tunnel Cloudflare | `false` |
| `--upnp` | Activer le transfert de port UPnP | `false` |
| `--upload-limit` | Limite d'upload en KB/s (0 = illimité) | `0` |
| `-v, --server-version` | Version du serveur (1 = hybrid, 2 = Lux v2) | `2` |
| `--password` | Mot de passe administrateur | `admin` |

---

## 🔍 Diagnostics & Rapports

```bash
# Statistiques globales (JSON)
bmm-mcp-server stats

# Lister les crash reports (10 par défaut)
bmm-mcp-server crashes

# Limiter à 5 rapports
bmm-mcp-server crashes --limit 5

# Analyser un crash report spécifique
bmm-mcp-server crash "C:\...\crash_2026-05-06.zip"

# Exporter la configuration BMM
bmm-mcp-server export-config "C:\backup\data.json"
```

---

## 🚀 Launch Packs (Multi-Apps)

```bash
# Lister les packs configurés
bmm-mcp-server launchpacks

# Lancer un pack (par ID ou nom)
bmm-mcp-server run-pack "Mon Pack"

# Supprimer un pack
bmm-mcp-server delete-pack <PACK_ID>

# Ouvrir le dossier d'un pack
bmm-mcp-server open-pack <PACK_ID>
```

---

## 🔌 Plugins, API & App Catalog

```bash
# Lister les plugins installés (id, nom, version, permissions)
bmm-mcp-server plugins

# Afficher l'URL, le port & le token de l'API Plugin locale (token masqué)
bmm-mcp-server api

# Afficher le token API complet (pour les scripts / plugins)
bmm-mcp-server api --reveal

# Afficher l'état de l'App Catalog (applis installées, favoris, sources communautaires)
bmm-mcp-server apps
```

> [!NOTE]
> `plugins`, `apps` et le `api` masqué lisent les données BMM sur disque : ils fonctionnent même BMM fermé. L'API elle-même ne répond que si BMM est **lancé** (port `51274` par défaut, configurable dans Paramètres → Identité & API).

---

## 🔄 Mode MCP (pour agents IA)

Le mode MCP est activé par défaut (sans argument) ou explicitement :

```bash
# Démarrage du serveur MCP (JSON-RPC sur stdin/stdout)
bmm-mcp-server
bmm-mcp-server serve
```

Ce mode est conçu pour les clients IA comme Claude Desktop, Cursor ou Gemini. Voir [MCP_Tools_List_FR.md](./MCP_Tools_List_FR.md) pour la liste complète des outils MCP.

---

> [!TIP]
> Ajoutez le dossier `binaries/` de BMM à votre variable d'environnement `PATH` pour utiliser `bmm-mcp-server` depuis n'importe quel terminal.
