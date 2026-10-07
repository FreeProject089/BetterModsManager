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
| `zip`, `sevenz-rust2`, `unrar`, `tar`, `flate2` | les archives, lues depuis leur index et jamais décompressées dans le dossier mods |
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

### Verrous, clés et dépôts distants

| Crate | Rôle |
|---|---|
| `aes-gcm`, `argon2`, `zeroize` | le verrou par phrase de passe d'un export de données et d'une liste de mods qui porte des identifiants ; les clés sont effacées à la libération |
| `russh`, `russh-sftp` | publier un dépôt par SSH / SFTP |
| `keyring` | la clé qui scelle la clé de créateur dans le trousseau de l'OS, hors Windows (DPAPI sous Windows) |

### Laya, l'IA hors ligne

| Composant | Rôle |
|---|---|
| `convaiinnovations/laya-multilingual` | le modèle classifieur, Apache-2.0, épinglé à une révision dans `laya-model.lock.json` |
| ONNX Runtime (Microsoft, MIT) | fait tourner le modèle ; la DLL officielle est livrée dans le pack du modèle et chargée après vérification de son SHA-256 |
| `ort` | la liaison Rust vers ONNX Runtime, épinglée exactement (une version candidate) |
| `tokenizers` | le tokenizer de Hugging Face, la même version que celle de la référence Python |

Laya **classe** du texte ; il n'en génère jamais. Tout ce dont il a besoin tourne sur ton PC.

### Le frontend

Du TypeScript compilé 1:1 vers `frontend/js/`, **sans bundler et sans framework**. Ce que la fenêtre
charge est embarqué à côté, jamais récupéré sur un CDN : **DOMPurify** (chaque markdown affiché est
assaini), **marked**, **Prism** (coloration), **KaTeX** (maths), **Mermaid** (diagrammes),
**rrweb** (replay de session), **GSAP** (animation), **svg-pan-zoom** et **Cropper.js**. Les données
du sélecteur d'icônes viennent de **Lucide** et **Simple Icons** ; les polices sont **Inter** et
**JetBrains Mono**. Voir [Architecture](doc-page:how-it-works/architecture) pour ce que ce choix apporte
et ce qu'il n'apporte pas.

### BetterInstaller et le site

**BetterInstaller**, l'installeur et le programme de mise à jour, est en Rust avec une interface
**Slint** : une fenêtre native sans moteur de navigateur. Le site **BetterCommunity** est en React et
Vite devant une API Fastify sur PostgreSQL, avec un bot discord.js.

!!! tip "La liste complète, avec versions et licences"

    Crédits → **Stack technique** liste chaque composant de chaque groupe ci-dessus (coquille de
    l'app, interface, cœur Rust, IA, polices et icônes, cette doc, BetterInstaller, le site, outils
    de compilation), chacun avec la version livrée et sa licence. Elle est générée à la compilation
    par `scripts/gen-credits.mjs` à partir des manifestes eux-mêmes (`Cargo.lock`,
    `package-lock.json`, le bandeau de licence de chaque fichier embarqué, `laya-model.lock.json`),
    et une vérification CI échoue dès qu'elle ne leur correspond plus : elle ne peut pas dériver
    comme une liste écrite à la main.

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

Les **icônes isométriques** (`:icon[iso:…]`, l'onglet *Isométrique* du sélecteur d'icônes)
viennent de trois jeux sous MIT, redistribués sans modification hormis un passage de nettoyage :

| Jeu | Icônes | Licence |
|---|---|---|
| [Isoflow isopack](https://github.com/markmanx/isopacks) | `iso:<nom>` | MIT © 2023 Mark Mankarious |
| [MI2 — My Isometric Icons](https://github.com/richbl/isometric-icons) | `iso:cube-<nom>` | MIT © 2018 Rich ; ses glyphes sont les Material Design Icons de Google, Apache-2.0 |
| [Jolloficons](https://github.com/gbmillz/jolloficons) | `iso:solid-<nom>` | MIT © 2018 Gbolahan Fawale |

Les textes complets des licences et la liste fichier par fichier sont livrés avec l'app, dans
`frontend/assets/icons/iso/LICENSES.txt`.

!!! info "À voir dans l'app"
    Crédits → **Voir la stack technique**, qui ouvre la même liste générée depuis les données du projet.
