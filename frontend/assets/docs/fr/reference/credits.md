# Crédits & la stack

BMM est construit par le projet Better* et ses contributeurs. L'écran **Crédits** dans l'app fait
référence pour la liste des personnes — il est généré depuis les données du projet, donc il reste juste
là où cette page dériverait.

- **Site & communauté :** [BetterCommunity](doc-page:features/community)
- **Sources & versions :** [github.com/FreeProject089](https://github.com/FreeProject089)
- **Cette doc :** [BMM-Docs](https://github.com/FreeProject089/BMM-Docs) — corrections bienvenues.

---

## Sur quoi BMM est construit

Chaque dépendance ci-dessous fait un travail précis, et plusieurs ont été choisies plutôt qu'une
alternative évidente pour une raison consignée dans [Architecture](doc-page:how-it-works/architecture).

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
[Architecture](doc-page:how-it-works/architecture) pour ce que ce choix apporte et ce qu'il n'apporte pas.

---

## Le site de doc

Ce site, c'est **MkDocs** avec le thème **Material**, bilingue via le plugin i18n (`page.md` +
`page.fr.md`), avec les diagrammes Mermaid rendus nativement et un petit hook Python qui réécrit les
directives `:::` façon BCWEB en admonitions Material. Voir
[Contribuer à la doc](doc-page:how-it-works/extending).

---

## Licence

BMM est un **logiciel libre**, publié sous la **Licence publique générale GNU, version 3**
(GPL-3.0). Le texte complet est dans [`LICENSE.md`](https://github.com/FreeProject089), à la
racine du dépôt.

| | |
|---|---|
| **Licence** | GNU GPL v3.0 — [gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0.html) |
| **Auteur** | FreeProject089 |
| **Sources** | [github.com/FreeProject089](https://github.com/FreeProject089) |
| **Cette doc** | [BMM-Docs](https://github.com/FreeProject089/BMM-Docs) |

### Ce que la GPL change pour toi

Ce n'est pas un avis juridique — c'est le texte de la licence qui fait foi — mais voici
l'essentiel, parce que presque personne ne le lit :

- **Utilise-le pour ce que tu veux**, y compris commercialement, sans payer ni demander.
- **Lis et modifie le code.** C'est l'objet même de la licence, pas une faille dedans.
- **Redistribue-le**, modifié ou non — mais celui à qui tu le donnes reçoit les quatre mêmes
  libertés que toi. C'est ça, le *copyleft*.
- **Publie tes modifications sous GPL aussi** si tu distribues un BMM modifié, et indique ce
  que tu as changé. Garder un fork privé pour toi, aucun souci ; en diffuser un sans ses
  sources, non.
- **Aucune garantie.** BMM écrit dans tes dossiers de jeu. Il est conçu pour tenir tes mods à
  l'écart du danger, mais la licence exclut toute responsabilité — garde quand même des
  sauvegardes.

### Composants tiers

Chaque dépendance listée plus haut garde sa propre licence — surtout MIT et Apache-2.0,
compatibles GPL. L'écran **Crédits** de l'app renvoie aux mentions tierces complètes, générées
depuis les données de dépendances du projet plutôt que tenues à la main.

!!! info "À voir dans l'app"
    Crédits → **Voir la stack technique**, qui ouvre la même liste générée depuis les données du projet.
