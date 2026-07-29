# Compiler & publier BMM (avec BetterInstaller)

Comment compiler BMM, produire `BMM-Setup.exe` avec **BetterInstaller**, et configurer le flux
de mise à jour automatique pour que les copies installées récupèrent la version.

> [!IMPORTANT]
> BMM a **deux canaux de mise à jour indépendants**. Ne les confonds pas — schémas, producteurs
> et consommateurs différents :
>
> | | Produit par | Fichier | Consommé par |
> |---|---|---|---|
> | **Canal installeur** | `release.ps1` | `update.json` | BetterInstaller (`.bpkg` + deltas bsdiff) |
> | **Canal intégré** | `scripts/gen-update-manifest.mjs` | `update-manifest.json` | BMM lui-même (`autoupdate.rs`, API GitHub Releases) |

---

## 1. Prérequis

- **Node 20+** et **Rust stable** (chaîne MSVC sous Windows).
- `npm ci` à la racine du dépôt BMM. `@tauri-apps/cli` est une **dev-dependency**, donc la CLI
  s'appelle `npx tauri …` — *pas* `cargo tauri …`.
- Un clone de BetterInstaller pour l'étape d'empaquetage (voir plus bas).
- `frontend/src/features/betahub/betahub-config.local.ts` — copie-le depuis
  `betahub-config.example.ts` si tu n'as pas le vrai ; sans lui le build échoue.

---

## 2. Compiler BMM

```bash
npm run build
```

Ce seul script est tout le pipeline (`package.json`) :

```bash
node scripts/security-guard.mjs        # refuse de compiler sur un motif connu comme dangereux
tsc --project frontend                 # frontend/src/**/*.ts  →  frontend/js/
npx tauri build
node scripts/gen-update-manifest.mjs   # écrit dist/release-assets-v<version>/
```

> [!REMARQUE]
> `tauri.conf.json` a un **`beforeBuildCommand` vide** — Tauri n'exécute *pas* `tsc` pour toi.
> Si tu lances `npx tauri build` directement, compile le frontend d'abord ou tu livres du JS
> périmé. L'app exécute `frontend/js/`, jamais les `.ts`.

**Artéfacts**

| Chemin | Contenu |
|---|---|
| `src-tauri/target/release/better-mods-manager.exe` | l'exécutable brut |
| `src-tauri/target/release/bundle/nsis/*.exe` | installeur NSIS |
| `src-tauri/target/release/bundle/msi/*.msi` | MSI WiX |
| `dist/release-assets-v<version>/` | `update-manifest.json`, `lang-*.json`, `links.json` + les installeurs |

> [!ASTUCE]
> `bundle.targets` vaut `"all"`, donc chaque build produit **NSIS et MSI**. Une fois passé à
> `BMM-Setup.exe` c'est du poids mort — utilise `npx tauri build --no-bundle` pendant les
> itérations et laisse BetterInstaller faire l'empaquetage.

### Vérifications rapides (sans bundle)

```bash
npm run typecheck     # tsc --noEmit
npm run ci            # security-guard + parité i18n + lint couleurs en dur + tsc + check kit
```

`npm run ci` est exactement ce que lance `.github/workflows/ci.yml`, plus `cargo check` dans `src-tauri`.

### Le sidecar MCP

`bmm-mcp-server` est un **`[[example]]`** cargo, volontairement pas un `[[bin]]` — en bin il
entrait en collision avec l'`externalBin` embarqué et cassait le MSI avec
`LGHT0091 Duplicate symbol`. Recompile-le seulement s'il a changé :

```bash
cargo build --release --example bmm-mcp-server
copy target\release\examples\bmm-mcp-server.exe binaries\bmm-mcp-server-x86_64-pc-windows-msvc.exe
```

---

## 3. Empaqueter & publier avec BetterInstaller

BetterInstaller est un **dépôt séparé** (workspace Rust à 3 crates : `bpkg-core`, `bpkg-cli`,
`installer` — une GUI Slint maintenue sous ~5 Mo).

```bash
# dans le clone BetterInstaller
cargo build --release -p bpkg-cli -p installer
```

Puis lance le script de release BMM **depuis la racine de BetterInstaller** :

```powershell
./examples/bmm/release.ps1 -Version 1.1.0 -BmmRoot "E:\...\BetterModsManager" -Notes "Better Mods Manager 1.1.0" -Publish
```

Il fait, dans l'ordre :

:::steps
1. **Incrémente la version dans trois fichiers** — `examples/bmm/installer.toml`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. **Compile BMM**, puis empaquette la charge utile en `bmm.bpkg` (zstd), **SHA-256 par fichier**.
3. **Signe** le paquet avec la clé privée Ed25519.
4. **Génère les deltas bsdiff** vers les versions précédentes → `Release/releases/<prev>-to-<new>.patch`.
5. **Écrit `update.json`** (le manifeste du canal installeur).
6. Avec `-Publish`, **téléverse la release GitHub**.
:::

La sortie atterrit dans `<BmmRoot>/Release/` : `BMM-Setup.exe`, `bmm.bpkg`, `update.json`,
`releases/*.patch`.

> [!ATTENTION]
> **La clé de signature n'est pas remplaçable.** `[security].public_key` est épinglée dans chaque
> copie installée ; une mise à jour signée avec une autre clé est rejetée. Garde `BMM_PRIVATE_KEY`
> en lieu sûr — la perdre signifie qu'aucun client installé ne pourra plus jamais se mettre à jour.

### À la main

```bash
bpkg keygen --out keys                                              # première fois seulement
bpkg pack  --root payload --config installer.toml --out app.bpkg
bpkg sign  --key keys/private.key app.bpkg
bpkg build --installer ./target/release/betterinstaller.exe \
           --config installer.toml --package app.bpkg --out BMM-Setup.exe
```

Utile : `bpkg info app.bpkg`, `bpkg verify app.bpkg --key keys/public.key`,
`bpkg delta --old <a> --new <b> --out <patch>`.

### Release en CI

`.github/workflows/release.yml` se déclenche sur un tag `v*` (ou manuellement). Il clone les deux
dépôts, compile `bpkg-cli` + `installer`, restaure la clé depuis le secret `BMM_PRIVATE_KEY`, et
appelle le même `release.ps1 … -Publish`.

Secrets : **`BMM_PRIVATE_KEY`** (obligatoire — doit être *la* clé existante), `BETAHUB_CONFIG`
(optionnel, retombe sur l'exemple commité).

```bash
git tag v1.1.0 && git push origin v1.1.0
```

---

## 4. Configurer la mise à jour automatique

### 4a. Canal installeur — `[update]` dans `installer.toml`

```toml
[update]
manifest_url  = "https://github.com/FreeProject089/BetterModsManager/releases/latest/download/update.json"
manifest_urls = []          # miroirs optionnels ; la version la plus haute parmi les sources vivantes gagne
auto_check    = true
allow_delta   = true        # préférer un patch bsdiff à un re-téléchargement complet
```

Schéma de `update.json` :

```json
{
  "version": "1.1.0",
  "url": "https://…/releases/latest/download/bmm.bpkg",
  "notes": "Better Mods Manager 1.1.0",
  "deltas": [{ "from": "1.0.0", "url": "https://…/releases/download/v1.1.0/1.0.0-to-1.1.0.patch" }]
}
```

Comportement :

- La comparaison de version est **numérique composant par composant**, donc `1.10.0 > 1.9.0`
  (pas une comparaison de chaînes).
- Avec `manifest_urls`, les miroirs morts sont ignorés ; erreur seulement si **toutes** les
  sources échouent.
- Si un delta correspond à la version installée il est utilisé, sinon le `.bpkg` complet est récupéré.
- **La signature est vérifiée avant toute écriture**, et échoue en mode fermé. Le dossier
  d'installation est d'abord sauvegardé en `<nom>.bak` ; la moindre erreur efface et restaure.

Vérification sans interface (c'est ainsi qu'une app installée interroge) :

```bash
betterinstaller.exe --check-update    # code 10 = MàJ dispo · 0 = à jour · 2 = erreur
betterinstaller.exe --update          # mode maintenance, démarre la mise à jour
```

> [!REMARQUE]
> BetterInstaller met à jour **l'app installée**, pas lui-même. Il n'y a pas d'auto-mise-à-jour
> de l'installeur.

### 4b. Canal intégré — GitHub Releases

BMM n'utilise **pas** `tauri-plugin-updater`. `src-tauri/src/commands/autoupdate.rs` appelle
directement l'API GitHub Releases :

- pré-versions ON → `…/releases?per_page=20`, première non-brouillon ; OFF → `…/releases/latest`
- le chemin incrémental exige un asset nommé exactement **`update-manifest.json`**
- repli : le premier asset finissant en `.exe` / `.zip` (réinstallation complète)

`update-manifest.json` (produit par `scripts/gen-update-manifest.mjs`) :

```json
{ "version": "1.1.0",
  "files": [{ "path": "_up_/…", "sha256": "…", "download_url": "…", "size": 1234 }] }
```

> [!AVERTISSEMENT]
> Chaque `path` **doit commencer par `_up_/`** — Tauri place les ressources libres sous ce
> dossier, et Rust résout la racine d'installation comme `resource_dir()` moins un niveau. Un
> chemin sans le préfixe écrit au mauvais endroit.

**Redirection d'endpoint.** La base d'API vient de `frontend/assets/links.json`, récupéré
**BCWEB d'abord** (`https://bettercommunity.ch/api/assets/links.json`) → copie GitHub → fichier
local embarqué. Clé : `"autoupdate_api"`. Tu peux donc rediriger les mises à jour sans livrer de build.

**Coupe-circuit.** `app.cfg` (embarqué comme ressource) porte `DisableUpdate`, `Prod`, `PTB`,
`BCTestMode`, `BCTestBase`.

---

## 5. Pièges connus

> [!ATTENTION]
> **1. Les identifiants de bundle ne correspondent pas.** `installer.toml` utilise
> `[app].id = "com.bettermm.app"`, alors que `tauri.conf.json` utilise
> `identifier = "com.bettermm.desktop"`. L'installeur écrit donc son handoff dans
> `%APPDATA%\com.bettermm.app\installer-handoff.json`, mais BMM lit
> `%APPDATA%\com.bettermm.desktop\`. Ça ne fonctionne aujourd'hui que grâce à la copie de
> migration héritée dans `src-tauri/src/main.rs`, qui ne s'exécute **que si le nouveau dossier
> n'a pas de `data.json`** — donc à la première installation. Aligne les deux ids, ou sache que
> tu dépends de cette migration.

Autres aspérités à connaître :

- **La version de `package.json` racine n'est jamais incrémentée** — `release.ps1` ne touche que
  `installer.toml`, `src-tauri/Cargo.toml` et `tauri.conf.json`. Elle dérive ; ne t'y fie pas.
- **`productName` vaut `"Better Mod Manager"`** (« Mod » au singulier) alors que tout le reste dit
  « Mods ». Les noms de fichiers d'installeur dérivent de `productName`.
- **`bundle.targets: "all"`** compile NSIS *et* MSI à chaque build de release alors que
  BetterInstaller remplace les deux.

---

## 6. Le contrat de handoff

BetterInstaller enregistre les choix de configuration de l'utilisateur et BMM les applique au
premier lancement.

- **Écrit dans** `%APPDATA%\<[app].id>\installer-handoff.json`, de façon atomique (temp + rename).
- **Forme** (`schema: 1`) : `source` (toujours `"betterinstaller"` — BMM rejette tout le reste),
  `installer_version`, `app_version`, `installed_at`, `components[]`, `install_dir`, `settings{}`.
- Les clés de `settings` viennent du `maps_to` de chaque `[[setup_option]]` — ex.
  `settings.language`, `settings.telemetry`, `settings.smart_io`, `settings.session_recorder`,
  `settings.fs_security_mode`.
- BMM le lit une fois puis le renomme en `installer-handoff.consumed.json`.

Pour ajouter une option, ajoute un bloc `[[setup_option]]` (`id`, `type`, `label`, `default`,
`maps_to`) et traite sa clé `maps_to` dans `src-tauri/src/commands/installer_handoff.rs`.
