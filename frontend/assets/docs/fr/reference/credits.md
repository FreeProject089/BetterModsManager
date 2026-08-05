# Crédits & la stack

BMM est construit par le projet Better* et ses contributeurs. L'écran **Crédits** dans l'app fait
référence pour la liste des personnes — il est généré depuis les données du projet, donc il reste juste
là où cette page dériverait.

- **Site & communauté :** [BetterCommunity](doc-page:../features/community)
- **Sources & versions :** [github.com/FreeProject089](https://github.com/FreeProject089)
- **Cette doc :** [BMM-Docs](https://github.com/FreeProject089/BMM-Docs) — corrections bienvenues.

---

## Sur quoi BMM est construit

Chaque dépendance ci-dessous fait un travail précis, et plusieurs ont été choisies plutôt qu'une
alternative évidente pour une raison consignée dans [Architecture](doc-page:../how-it-works/architecture).

### La coquille

| Crate | Rôle |
|---|---|
| `tauri` (v2) + `tauri-build` | la coquille de l'app : fenêtre, IPC, bundling. Le webview de l'OS au lieu d'un Chromium embarqué |
| `tauri-plugin-*` | `cli`, `dialog`, `fs`, `notification`, `process`, `shell`, `single-instance` |
| `windows`, `windows-sys`, `winreg` | du Win32 direct là où une crate serait un détour — priorité I/O, `CREATE_NO_WINDOW`, registre |
| `embed-resource` | l'icône et le manifeste de l'exécutable |

### Faire le travail

| Crate | Rôle |
|---|---|
| `mimalloc` | l'allocateur — *« working set 30 à 60% plus petit »* que celui de Windows par défaut |
| `rayon` | parallélisme de données, avec un pool global **plafonné** et des piles de 512 Ko |
| `jwalk` | parcours de dossiers parallèle sur les chemins chauds (`walkdir` est gardé pour les froids) |
| `blake3` | hachage de contenu local — un hash en arbre, préfixé `b3:` |
| `sha2` | baselines legacy, format de transport des dépôts, et l'empreinte `content_id` |
| `zip`, `sevenz-rust`, `unrar`, `tar`, `flate2` | les archives, lues depuis leur index et jamais décompressées dans le dossier mods |
| `fs_extra`, `tempfile` | opérations fichiers en masse et espace de travail temporaire |
| `sysinfo` | le moniteur de ressources et les contrôles de processus |

### Parler au monde

| Crate | Rôle |
|---|---|
| `warp` | l'API HTTP locale sur `127.0.0.1:51274` |
| `reqwest` | le HTTP sortant — catalogues, dépôts, mises à jour |
| `tokio`, `tokio-util`, `futures` | le runtime async sous les deux |
| `rmcp` | le serveur MCP, livré comme `[[example]]` cargo — en `[[bin]]` il cassait le MSI |
| `igd`, `local-ip-address` | mapping de port UPnP et découverte d'adresse LAN pour l'hébergement de dépôt |
| `discord-rich-presence` | Discord RPC |

### Données, crypto, plomberie

| Crate | Rôle |
|---|---|
| `serde`, `serde_json`, `schemars` | `data.json`, chaque format de transport, et les schémas JSON |
| `ed25519-dalek` | vérification de signature des mises à jour — **fail closed** |
| `uuid`, `rand`, `hex`, `base64`, `percent-encoding` | ids, tokens, encodages |
| `chrono` | horodatages, planifications, modèles de noms de fichiers |
| `anyhow`, `thiserror` | gestion d'erreurs — `anyhow` en interne, erreurs typées aux frontières |
| `tracing`, `tracing-subscriber`, `backtrace` | diagnostics et rapports de crash |
| `regex`, `lazy_static`, `bytes` | parsing et statiques partagées |
| `image` | vignettes et fonds de profil |
| `clap`, `colored`, `comfy-table` | le CLI — parsing, couleur et tableaux |
| `open` | passer une URL ou un dossier à l'OS |

### Le frontend

Du TypeScript compilé 1:1 vers `frontend/js/`, **sans bundler et sans framework**. La seule dépendance
runtime notable est **rrweb** pour le replay de session. Voir
[Architecture](doc-page:../how-it-works/architecture) pour ce que ce choix apporte et ce qu'il n'apporte pas.

---

## Le site de doc

Ce site, c'est **MkDocs** avec le thème **Material**, bilingue via le plugin i18n (`page.md` +
`page.fr.md`), avec les diagrammes Mermaid rendus nativement et un petit hook Python qui réécrit les
directives `:::` façon BCWEB en admonitions Material. Voir
[Contribuer à la doc](doc-page:../how-it-works/extending).

---

## Licences

Chaque dépendance garde sa propre licence. La licence de BMM lui-même est dans le
[dépôt](https://github.com/FreeProject089) ; l'écran Crédits dans l'app renvoie aux mentions
tierces.

!!! info "À voir dans l'app"
    Crédits → **Voir la stack technique**, qui ouvre la même liste générée depuis les données du projet.
