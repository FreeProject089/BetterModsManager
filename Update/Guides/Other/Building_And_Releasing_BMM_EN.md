# Building & releasing BMM (with BetterInstaller)

How to compile BMM, produce `BMM-Setup.exe` with **BetterInstaller**, and configure the
auto-update feed so installed copies pick the release up.

> [!IMPORTANT]
> BMM has **two independent update channels**. Do not confuse them — different schemas,
> different producers, different consumers:
>
> | | Produced by | File | Consumed by |
> |---|---|---|---|
> | **Installer channel** | `release.ps1` | `update.json` | BetterInstaller (`.bpkg` + bsdiff deltas) |
> | **In-app channel** | `scripts/gen-update-manifest.mjs` | `update-manifest.json` | BMM itself (`autoupdate.rs`, GitHub Releases API) |

---

## 1. Prerequisites

- **Node 20+** and **Rust stable** (MSVC toolchain on Windows).
- `npm ci` at the BMM repo root. `@tauri-apps/cli` is a **dev-dependency**, so the CLI is
  `npx tauri …` — *not* `cargo tauri …`.
- A BetterInstaller checkout for the packaging step (below).
- `frontend/src/features/betahub/betahub-config.local.ts` — copy it from
  `betahub-config.example.ts` if you don't have the real one; the build fails without it.

---

## 2. Build BMM

```bash
npm run build
```

That single script is the whole pipeline (`package.json`):

```bash
node scripts/security-guard.mjs        # refuses to build on a known-bad pattern
tsc --project frontend                 # frontend/src/**/*.ts  →  frontend/js/
npx tauri build
node scripts/gen-update-manifest.mjs   # writes dist/release-assets-v<version>/
```

> [!NOTE]
> `tauri.conf.json` has an **empty `beforeBuildCommand`** — Tauri does *not* run `tsc` for
> you. If you call `npx tauri build` directly, compile the frontend first or you ship stale
> JS. The app runs `frontend/js/`, never the `.ts`.

**Artifacts**

| Path | What |
|---|---|
| `src-tauri/target/release/better-mods-manager.exe` | the raw executable |
| `src-tauri/target/release/bundle/nsis/*.exe` | NSIS setup |
| `src-tauri/target/release/bundle/msi/*.msi` | WiX MSI |
| `dist/release-assets-v<version>/` | `update-manifest.json`, `lang-*.json`, `links.json` + the installer files |

> [!TIP]
> `bundle.targets` is `"all"`, so every build produces **both** NSIS and MSI. Once you've
> moved to `BMM-Setup.exe` those are dead weight — use `npx tauri build --no-bundle` while
> iterating and let BetterInstaller do the packaging.

### Faster checks (no bundling)

```bash
npm run typecheck     # tsc --noEmit
npm run ci            # security-guard + i18n parity + hardcoded-colour lint + tsc + kit check
```

`npm run ci` is exactly what `.github/workflows/ci.yml` runs, plus `cargo check` in `src-tauri`.

### The MCP sidecar

`bmm-mcp-server` is a cargo **`[[example]]`**, deliberately not a `[[bin]]` — as a bin it
collided with the bundled `externalBin` and broke the MSI with `LGHT0091 Duplicate symbol`.
Rebuild it only when it changed:

```bash
cargo build --release --example bmm-mcp-server
copy target\release\examples\bmm-mcp-server.exe binaries\bmm-mcp-server-x86_64-pc-windows-msvc.exe
```

---

## 3. Package & release with BetterInstaller

BetterInstaller is a **separate repo** (a 3-crate Rust workspace: `bpkg-core`, `bpkg-cli`,
`installer` — a Slint GUI kept under ~5 MB).

```bash
# in the BetterInstaller checkout
cargo build --release -p bpkg-cli -p installer
```

Then run the BMM release script **from the BetterInstaller root**:

```powershell
./examples/bmm/release.ps1 -Version 1.1.0 -BmmRoot "E:\...\BetterModsManager" -Notes "Better Mods Manager 1.1.0" -Publish
```

It does, in order:

:::steps
1. **Bumps the version in three files** — `examples/bmm/installer.toml`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
2. **Builds BMM**, then packs the payload into `bmm.bpkg` (zstd), **SHA-256 per file**.
3. **Signs** the package with the Ed25519 private key.
4. **Generates bsdiff deltas** against previous releases → `Release/releases/<prev>-to-<new>.patch`.
5. **Writes `update.json`** (the installer-channel manifest).
6. With `-Publish`, **uploads the GitHub release**.
:::

Output lands in `<BmmRoot>/Release/`: `BMM-Setup.exe`, `bmm.bpkg`, `update.json`, `releases/*.patch`.

> [!CAUTION]
> **The signing key is not rotatable.** `[security].public_key` is pinned inside every
> installed copy; an update signed with a different key is rejected. Keep `BMM_PRIVATE_KEY`
> safe — losing it means no installed client can ever update again.

### Doing it by hand

```bash
bpkg keygen --out keys                                              # first time only
bpkg pack  --root payload --config installer.toml --out app.bpkg
bpkg sign  --key keys/private.key app.bpkg
bpkg build --installer ./target/release/betterinstaller.exe \
           --config installer.toml --package app.bpkg --out BMM-Setup.exe
```

Useful: `bpkg info app.bpkg`, `bpkg verify app.bpkg --key keys/public.key`,
`bpkg delta --old <a> --new <b> --out <patch>`.

### CI release

`.github/workflows/release.yml` fires on a `v*` tag (or manual dispatch). It checks out both
repos, builds `bpkg-cli` + `installer`, restores the key from the `BMM_PRIVATE_KEY` secret,
and calls the same `release.ps1 … -Publish`.

Secrets: **`BMM_PRIVATE_KEY`** (required — must be *the* existing key), `BETAHUB_CONFIG`
(optional, falls back to the committed example).

```bash
git tag v1.1.0 && git push origin v1.1.0
```

---

## 4. Configuring auto-update

### 4a. Installer channel — `[update]` in `installer.toml`

```toml
[update]
manifest_url  = "https://github.com/FreeProject089/BetterModsManager/releases/latest/download/update.json"
manifest_urls = []          # optional mirrors; the highest version across all live sources wins
auto_check    = true
allow_delta   = true        # prefer a bsdiff patch over a full re-download
```

`update.json` schema:

```json
{
  "version": "1.1.0",
  "url": "https://…/releases/latest/download/bmm.bpkg",
  "notes": "Better Mods Manager 1.1.0",
  "deltas": [{ "from": "1.0.0", "url": "https://…/releases/download/v1.1.0/1.0.0-to-1.1.0.patch" }]
}
```

How it behaves:

- Version compare is **component-wise numeric**, so `1.10.0 > 1.9.0` (not a string compare).
- With `manifest_urls`, dead mirrors are skipped; it only errors if **every** source fails.
- If a delta matches the installed version it is used, else the full `.bpkg` is fetched.
- **Signature is checked before anything is written**, and it fails closed. The install dir is
  snapshotted to `<name>.bak` first; any error wipes and restores.

Headless check (this is how an installed app asks):

```bash
betterinstaller.exe --check-update    # exit 10 = update available · 0 = up to date · 2 = error
betterinstaller.exe --update          # maintenance mode, starts the update
```

> [!NOTE]
> BetterInstaller updates **the installed app**, not itself. There is no installer self-update.

### 4b. In-app channel — GitHub Releases

BMM does **not** use `tauri-plugin-updater`. `src-tauri/src/commands/autoupdate.rs` calls the
GitHub Releases API directly:

- pre-releases ON → `…/releases?per_page=20`, first non-draft; OFF → `…/releases/latest`
- the incremental path needs an asset named exactly **`update-manifest.json`**
- fallback: the first asset ending `.exe` / `.zip` (full reinstall)

`update-manifest.json` (from `scripts/gen-update-manifest.mjs`):

```json
{ "version": "1.1.0",
  "files": [{ "path": "_up_/…", "sha256": "…", "download_url": "…", "size": 1234 }] }
```

> [!WARNING]
> Every `path` **must start with `_up_/`** — Tauri bundles loose resources under that folder,
> and Rust resolves the install root as `resource_dir()` minus one level. A path without the
> prefix writes to the wrong place.

**Endpoint override.** The API base comes from `frontend/assets/links.json`, fetched
**BCWEB-first** (`https://bettercommunity.ch/api/assets/links.json`) → GitHub copy → the
bundled local file. Key: `"autoupdate_api"`. So you can repoint updates without shipping a build.

**Kill switch.** `app.cfg` (bundled as a resource) carries `DisableUpdate`, `Prod`, `PTB`,
`BCTestMode`, `BCTestBase`.

---

## 5. Known traps

> [!CAUTION]
> **1. The bundle ids don't match.** `installer.toml` uses `[app].id = "com.bettermm.app"`,
> while `tauri.conf.json` uses `identifier = "com.bettermm.desktop"`. The installer therefore
> writes its handoff to `%APPDATA%\com.bettermm.app\installer-handoff.json`, but BMM reads
> `%APPDATA%\com.bettermm.desktop\`. It only works today via the one-shot legacy-migration
> copy in `src-tauri/src/main.rs`, which runs **only when the new dir has no `data.json`** —
> i.e. on a first install. Align the two ids, or know you depend on that migration.

Other rough edges worth knowing:

- **Root `package.json` version is never bumped** — `release.ps1` touches only `installer.toml`,
  `src-tauri/Cargo.toml` and `tauri.conf.json`. It drifts; don't trust it as the version.
- **`productName` is `"Better Mod Manager"`** (singular "Mod") while everything else says
  "Mods". Installer filenames derive from `productName`.
- **`bundle.targets: "all"`** builds NSIS *and* MSI on every release build even though
  BetterInstaller replaces both.

---

## 6. The handoff contract

BetterInstaller records the user's setup choices and BMM applies them on first run.

- **Written to** `%APPDATA%\<[app].id>\installer-handoff.json`, atomically (temp + rename).
- **Shape** (`schema: 1`): `source` (always `"betterinstaller"` — BMM rejects anything else),
  `installer_version`, `app_version`, `installed_at`, `components[]`, `install_dir`,
  `settings{}`.
- `settings` keys come from each `[[setup_option]]`'s `maps_to` — e.g. `settings.language`,
  `settings.telemetry`, `settings.smart_io`, `settings.session_recorder`,
  `settings.fs_security_mode`.
- BMM reads it once and renames it to `installer-handoff.consumed.json`.

To add an option, add a `[[setup_option]]` block (`id`, `type`, `label`, `default`, `maps_to`)
and handle its `maps_to` key in `src-tauri/src/commands/installer_handoff.rs`.
