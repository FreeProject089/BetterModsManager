# Releasing BMM

BMM ships through **BetterInstaller**. NSIS and MSI are no longer built.

---

## The commands

```bash
npm run ci                # every gate (includes check-release-versions) — run this before anything else
npm run build             # the app itself (no installer)
npm run build:installer   # the installer, from whatever npm run build produced
npm run release           # version gate, build, installer, then release:assets
npm run release:assets    # signed update-manifest.json listing Release/BMM-Setup.exe + SHA-256, then the artefact gate
npm run check:release     # one version everywhere (add --artifacts to check Release/ too)
```

`npm run build` ends with `tauri build --no-bundle`. That switch is the change: BMM used to build
an NSIS installer *and* an MSI on every release build — about 107 MB of artefacts nobody ships any
more, on top of the time to produce them.

`--no-bundle` still produces everything the installer needs. The resource trees BMM reads at
runtime live in `src-tauri/target/release/_up_/`, and those come from the *build* step, not the
bundler — you can confirm it by looking for `_up_` under `target/debug` after a `tauri dev`. The
only thing the bundler adds is `resources/icon.ico`, which nothing resolves at runtime (the window
icon is compiled into the executable).

---

## First time on this machine

You need **Node**, **Rust** (for BMM and for the installer engine) and **PowerShell**.
BetterInstaller must be checked out at `BetterInstaller/` inside this repo — it is a separate
git repository, not a submodule, so clone it there if it is missing.

Then:

```bash
npm install
npm run release
```

That is genuinely all. `build-installer.ps1` bootstraps what it needs:

- **the engine** — it runs `cargo build --release -p bpkg-cli -p installer` when
  `BetterInstaller/target/release/bpkg.exe` is not there yet (a few minutes, once);
- **the signing key** — if `BetterInstaller/examples/bmm/keys/private.key` does not exist it
  generates a keypair and tells you so.

!!! danger "If it generated a key, you have one more step"

    A fresh keypair does **not** match the `public_key` already in `installer.toml`, and
    `require_signature = true` means the installer refuses a package it cannot verify. The
    package builds, the setup builds, and the **install fails on the user's machine**.

    So after a keygen, copy the new key in:

    ```bash
    cat BetterInstaller/examples/bmm/keys/public.key
    # paste it into [security].public_key in BetterInstaller/examples/bmm/installer.toml
    ```

    Then check it before shipping anything — this is the one command that catches the mistake:

    ```bash
    BetterInstaller/target/release/bpkg.exe verify \
        --key BetterInstaller/examples/bmm/keys/public.key Release/bmm.bpkg
    ```

    A mismatch prints `Error: signature INVALID (does not match this key)`. A match prints
    `OK — Ed25519 signature valid.`

!!! warning "Back the private key up, off this machine"

    `keys/` is gitignored, so the private key exists in exactly one place. Lose it and you cannot
    sign an update that existing installs will accept — they verify against the public key baked
    into the setup they were installed from. There is no recovery from the user's side.

---

## What `build:installer` does

It runs `BetterInstaller/examples/bmm/build-installer.ps1` from the BetterInstaller root, in five
steps:

1. Build `bpkg` and the installer engine, if they are not built yet.
2. **Assemble the payload** — the exe, the MCP sidecar, the whole `_up_` resource tree, TOS and
   PRIVACY at the payload root (the installer's Terms step reads them from there), the sidebar
   logo, and the built-in themes under `presets/themes/` for the "Import themes" setup option.
3. Pack it into `Release/bmm.bpkg`.
4. **Sign it** with `BetterInstaller/examples/bmm/keys/private.key` (Ed25519).
5. Stamp the self-extracting `Release/BMM-Setup.exe`, and emit `Release/update.json`.

Then `npm run release:assets` writes `dist/release-assets-v<version>/`: `update-manifest.json`
(listing the language files **and** `BMM-Setup.exe` with its SHA-256) plus the files it names,
**signs it** with `BetterInstaller/examples/bmm/keys/private.key` (`--sign-key`), verifies it
against the key BMM pins, and runs `check-release-versions --artifacts`. An unsigned manifest
never leaves this step. `BetterInstaller/examples/bmm/release.ps1` does the same after building,
so both local paths and CI publish the signed manifest.

A release carries **all** of these, and nothing else that ends in `.exe` or `.msi`:

| Asset | Read by |
|---|---|
| `BMM-Setup.exe` | people; BMM 0.9.x (runs the first `.msi`/`.exe` of the release); the 1.0.x fallback |
| `bmm.bpkg` + `update.json` | copies installed by BetterInstaller (`uninstall.exe --update`) |
| `update-manifest.json` + `lang-*.json`, `links.json` | copies BetterInstaller did not install (Quick Update and the full-installer fallback) |

Without `update-manifest.json` every copy that takes the fallback says « Update refused: this
release publishes no signed update manifest » — that is what happened with v1.0.1, uploaded by
hand with the first three only.

What you get, in `Release/`:

| File | Size (v1.0.0) | What it is for |
|---|---|---|
| `BMM-Setup.exe` | ~62 MB | What people download and run |
| `bmm.bpkg` | ~88 MB uncompressed, 129 files | The signed package installed copies fetch to update |
| `update.json` | small | The manifest that tells them a newer version exists |

Check it before shipping:

```bash
BetterInstaller/target/release/bpkg.exe info Release/bmm.bpkg
BetterInstaller/target/release/bpkg.exe verify --key BetterInstaller/examples/bmm/keys/public.key Release/bmm.bpkg
```

`info` prints the identity and version as the engine parsed them — the cheapest way to catch a
wrong `app.id` before it ships, since that mismatch fails silently rather than loudly.

---

## Where the configuration lives

| What | File |
|---|---|
| Installer identity, components, setup options, updater URL | `BetterInstaller/examples/bmm/installer.toml` |
| App identity, resources, window, plugins | `src-tauri/tauri.conf.json` |
| Version | `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (+ `Cargo.lock`), `installer.toml` `[app].version` — `scripts/check-release-versions.mjs` fails on any mismatch |

The full field-by-field reference for `installer.toml` is
[BetterInstaller/GUIDE.md](BetterInstaller/GUIDE.md).

### The one that bites

`[app].id` in `installer.toml` must equal `identifier` in `tauri.conf.json`. It decides where the
installer writes `installer-handoff.json` — the file carrying every choice the user made during
setup — and BMM reads that file from its own app-data directory.

These drifted once already: BMM's identifier moved from `com.bettermm.app` to
`com.bettermm.desktop` and `installer.toml` kept the old one, so the handoff was written to a
folder BMM never reads. Nothing errored. Language, accepted terms, telemetry consent and theme
import were all silently discarded on any machine where BMM already had a `data.json`.

`npm run ci` now checks it, along with the version and the main executable name. That gate skips cleanly if BetterInstaller is not checked out beside this repo.

---

## Adding a setup option

A setup option is a question the installer asks and BMM applies on first launch. Declare it in
`installer.toml`:

```toml
[[setup_option]]
id          = "smart_io"
type        = "bool"                     # bool | select | license
label       = "Smart I/O (recommended)"
description = "Batches disk operations when enabling mods. On by default."
default     = true                       # MUST match BMM's own default
maps_to     = "settings.smart_io"
```

Then make sure `src-tauri/src/commands/installer_handoff.rs` knows what to do with `maps_to`.

**Make `default` match what BMM does when nobody touches anything.** Otherwise the installer
becomes a second place where BMM's defaults are decided, and the two drift. Anything absent from
the handoff must leave BMM's own default alone — that is the contract.

Write `description` as what actually happens, not as a pitch. It is the one moment a user decides
whether to allow something.

---

## Updates

From 1.0.2 one dialog does it all (« Download update » / « Install now »): BMM downloads
`BMM-Setup.exe`, checks it (see « Channels » below) and starts it.

- **Installed by BetterInstaller** — BMM runs the checked `BMM-Setup.exe --update --wait-pid <pid>
  --launch`, which updates the install in place. When the release cannot be read, BMM falls back
  to the maintenance binary next to itself (`<install>/uninstall.exe --update`), which reads
  `update.json` + `bmm.bpkg` and can apply a binary delta instead of the full package.
- **Anything else** (dev runs, portable copies) — the same download and check, then the installer
  runs interactively. Quick Update (interface and language files only) reads the language files
  and `links.json` that `update-manifest.json` lists.

`update-manifest.json` is **signed**, on every publish path. `npm run build` only writes an
unsigned draft into `dist/release-assets-v<version>/`. `npm run release:assets`, the release
workflow and `release.ps1` all rebuild it with `--installer Release/BMM-Setup.exe
--require-installer` (so it lists exactly one installer, `BMM-Setup.exe`, with its SHA-256), sign
it with the publisher key (`node scripts/sign-update-manifest.mjs sign <file> --key private.key`),
check it against the key BMM pins (`… verify <file>`) and run `check-release-versions --artifacts`
before anything is uploaded. BMM refuses an unsigned, foreign, expired or not-newer manifest
(`autoupdate.rs`, `verify_manifest_text`).

Both signed manifests — this one and BetterInstaller's `update.json` — expire after 7 days.
`.github/workflows/resign-manifests.yml` renews them twice a week (secret `BMM_PRIVATE_KEY`; the
BetterCommunity mirror upload also needs `BCWEB_ASSETS_TOKEN`, a BCWEB CI publish key minted in BCWEB
Admin → Downloads & assets → CI publish key, and is skipped without it). Run it by
hand from *Actions → Re-sign update manifests → Run workflow*. If it stops, installed copies stop
being offered updates after at most 7 days.

`src-tauri/src/commands/autoupdate.rs` picks between them by looking for the maintenance binary, so
there is nothing to configure per install.

---

## Bridging older installs

Three generations of BMM are out there, and each reads something different from the newest
release. **Decision (1.0.2): keep publishing every asset each of them reads, alongside the signed
manifest.** They cost a few kilobytes per release, and dropping one strands every copy that reads
only it. On top of that, 0.9.11 copies get a bridge release, **0.9.12**, published first (see
« Bridge 0.9.12 » below).

| Installed | What it does on « update » | What it needs on the release |
|---|---|---|
| **0.9.11** and older | GitHub `/releases/latest` (never a pre-release); no major-version guard; downloads the first asset ending in `.msi`, else the first ending in `.exe` **or `.zip`** (case-sensitive), and runs it through `cmd /C start` (no signature, no hash) | `BMM-Setup.exe` as the **only** `.exe`/`.msi` asset and **no `.zip`**, on a release marked **Latest** (`release.ps1` refuses anything else) |
| **0.9.12** (the bridge, see below) | the release **list**: newest stable, or a newer pre-release when opted in **or when it opens a newer major line** (1.0.x); installs the installer the signed `update-manifest.json` lists (signature + SHA-256, as 1.0.2), else checks `BMM-Setup.exe` against the release's signed `update.json`, else warns and asks; ShellExecuteExW launch, interactive | the signed `update-manifest.json` with `installers = [BMM-Setup.exe]` (or an `update.json` whose signed body lists it) |
| **1.0.0 / 1.0.1**, installed by BetterInstaller | `uninstall.exe --check-update` / `--update` reads `releases/latest/download/update.json` and fetches `bmm.bpkg` | `update.json` signed for the new version **at publish time** (it expires 7 days after signing) and the matching `bmm.bpkg` |
| **1.0.0 / 1.0.1**, other installs | `download_and_install_update`: needs `update-manifest.json` whose signed `installers` lists the **exact** URL of the asset it picked (`…/v<version>/BMM-Setup.exe`), then runs it with `open::that` | the signed `update-manifest.json` with `installers = [BMM-Setup.exe]` |
| **1.0.2+** | the same two paths; a **channel** (stable = `/releases/latest`, a « latest » that is a pre-release is not followed; pre-release = the highest non-draft of the list); resumable verified download with size, speed and time left; « install on next launch » (the verified installer is kept and verified again before it runs); ShellExecuteExW launch with the real Windows error; no signed manifest: checked against `update.json`, else a warning and the person's choice; a BetterInstaller install runs the downloaded `BMM-Setup.exe --update --wait-pid <pid> --launch`; « Download from the release page » on any failure | the same |

Two facts about the « 1.0.1 » release that this fixes:

- It announced itself as **1.0.0** everywhere (Cargo.toml and installer.toml were never bumped, so
  the setup, `bmm.bpkg` and `update.json` said 1.0.0). Installed 1.0.0 copies were never offered
  it. `check-release-versions.mjs` now fails the build on any disagreement, and CI refuses a tag
  that is not the version in `package.json`.
- It was published as a **pre-release**, which `/releases/latest` (the stable channel, and
  BetterInstaller's `manifest_url`) never returns. CI publishes with `--latest`; by hand, untick
  « Set as a pre-release » and tick « Set as the latest release ».

1.0.x copies that are not BetterInstaller installs still launch through `open::that` (a hidden
PowerShell `Start-Process`); where that fails on a machine, the person has to run
`BMM-Setup.exe` from the release page once. From 1.0.2 on, the launch goes through
`proc::shell_launch` and reports the Windows reason.

### Channels (1.0.2)

Settings → Auto Update → **Update channel**: *Stable* (default) or *Pre-release*
(`bmm_prerelease_enabled`). A build installed from a pre-release, or whose version carries a
pre-release tag (`1.1.0-beta.1`), keeps following the pre-release channel; it is offered the final
`1.1.0` too (`1.1.0` > `1.1.0-beta.1`). A BetterInstaller install on the pre-release channel gets
pre-releases through `BMM-Setup.exe`, because `uninstall.exe --update` reads the stable feed only.
So **publish a pre-release with the same assets as a release** (signed `update-manifest.json`
listing `BMM-Setup.exe`), just without `--latest`.

**One click, whatever the release carries** (stable and pre-release alike). « Install now »
downloads the installer, checks it and starts it; nobody is sent to GitHub. What vouches for the
file, in this order (`UpdateInfo.verification`, shown in the dialog):

1. **`signed`**: the release's signed `update-manifest.json` lists the installer with its SHA-256
   (the path above, unchanged, always preferred).
2. **`update-json`**: no `update-manifest.json`, so BMM re-reads the release from
   `api.github.com/…/releases/tags/<tag>` (nothing the dialog sends is reused), takes
   `BMM-Setup.exe` (else the only `.exe`, else the only `.msi`; two of a kind is refused), only
   from `https://github.com/FreeProject089/BetterModsManager/releases/download/`, and compares
   its SHA-256 with the one the release's **`update.json`** declares for that file. update.json is
   read the way BetterInstaller reads it with a pinned key: signature with the same publisher key
   (context `BetterInstaller update manifest v1`), app `com.bettermm.desktop`, at most 7 days
   valid and not expired, a version newer than the running one. The entry is
   `installers: [{ "path": "BMM-Setup.exe", "sha256": "<64 hex>" }]` **inside the signed body**.
3. **`unverified`**: no update.json, an invalid one, no entry for the installer, or bytes that do
   not match. BMM downloads the file, says in plain words what failed (GitHub's own `digest` for
   the asset is shown as extra information) and asks: **Cancel** (focused) or **Install anyway**.
   A file that does not match what the release declares, or differs from GitHub's digest, is shown
   in red as possibly corrupted or tampered with. Only the « Install anyway » button sends the
   SHA-256 of the exact bytes it showed (`confirm_sha256`); Rust runs those bytes (kept in memory,
   never on disk) and nothing else.

**To publish:** every publish path (`npm run release`, `release.ps1 -Publish`, the tag workflow)
ships the signed `update-manifest.json`, so a 1.0.2 release lands in case 1. BetterInstaller's
release script now also writes the `installers` entry (`BMM-Setup.exe`, SHA-256, size) inside the
signed body of `update.json` (`bpkg update-manifest --installer`), so case 2 holds too. Only the
already published v1.0.1 (no manifest, an `update.json` that describes only `bmm.bpkg` and says
`1.0.0`) lands in case 3: installable, with the warning.

**How the installer starts:** in a fresh `%TEMP%\bmm_update_<uuid>\` folder, through
ShellExecuteExW. When this copy was installed by BetterInstaller and the file is `BMM-Setup.exe`,
BMM runs `BMM-Setup.exe --update --wait-pid <BMM's pid> --launch` (updates the install in place
with no questions, waits for BMM to exit, starts it again); if it exits at once with code 3 (« no
existing install ») BMM starts it again interactively. Otherwise it runs with no arguments (a fresh
install needs the person's consent screens). A BetterInstaller install whose release could not be
read falls back to `<install>/uninstall.exe --update`. « Install on next launch » is offered only
for a signed installer (it is verified again at start).

---

## Bridge 0.9.12

A micro-release of 0.9.11 that changes **only its updater**, so 0.9.x copies can follow
pre-releases and install the BetterInstaller setup 1.0.2 ships, verified like 1.0.2 does it.

**Where it is:** git worktree `E:\Travaille\CodageAutres\Better Project\bmm-bridge-0.9.12`,
branch `bridge-0.9.12`, commit `85010e85`, based on commit `74d7fa95` (« 0.9.11 »). **The tag `v0.9.11` is wrong:**
it points at `90afd8b4`, the same commit as `V0.9.10`, whose `tauri.conf.json` says 0.9.9. The
0.9.11 that people run was built from `74d7fa95`. Nothing was pushed or tagged.

**What 0.9.11 does** (read at `74d7fa95`, `src-tauri/src/commands/autoupdate.rs` +
`frontend/src/ui/update-notes.ts`): `GET api.github.com/repos/FreeProject089/BetterModsManager/releases/latest`,
so it never sees a pre-release (that is why nobody on 0.9.11 was offered 1.0.1); it compares
dotted numbers; it takes the first asset whose name ends in `.msi`, else the first ending in `.exe`
or `.zip` (case-sensitive), downloads it into `%TEMP%\<asset name>` with no signature and no hash,
runs `cmd /C start "" <file>` and exits.

**What 0.9.12 changes** (`src-tauri/src/commands/autoupdate.rs`, `frontend/src/ui/update-notes.ts`,
one switch in `index.html`, six i18n keys, the version, its release notes):

- reads the release list (`/releases?per_page=30`) and offers the newest stable release, a newer
  pre-release when « Enable pre-releases » is on, and **always a release of a newer major line**
  (1.0.x) even marked pre-release; releases without `update-manifest.json` are skipped;
- installs only the installer the signed `update-manifest.json` lists (BMM-Setup.exe): Ed25519
  signature with the key 1.0.2 pins (`8e0647c2…168b`), the same context string, app id
  `com.bettermm.desktop`, at most 7 days valid and not expired, a newer version, then the
  SHA-256 of the bytes; written to a fresh `%TEMP%\bmm_update_<uuid>\` folder and started with
  ShellExecuteExW (the UAC prompt works);
- a release **without** `update-manifest.json` (the published 1.0.1) is offered and installed in
  the same click: the release is re-read by tag, its installer (`BMM-Setup.exe`, else the only
  `.exe`/`.msi`, from BMM's own GitHub releases only) is checked against the checksum the
  release's signed `update.json` declares, exactly as 1.0.2 does (see « Channels » above). When
  that is impossible or the file does not match, the dialog explains it and asks « Cancel »
  (focused) or « Install anyway »; a mismatch is shown in red. 0.9.12 always starts the installer
  interactively (no arguments: a 0.9.x copy is never a BetterInstaller install, and the fresh
  install needs the consent screens);
- the dialog shows what will check the file, the download progress, then « Checking the file »,
  then « Starting the installer »; a failure shows the reason with « Try again » and « Open the
  release page ».

Branch `bridge-0.9.12`; the updater work is commit `a44d1345` (on top of `1243ecc8`), followed by
dialog fixes up to `00c7b1df` (translated « could not be checked » reasons, the navbar « Check for
Updates » button).

**Build it** (in the worktree; it has no `node_modules` yet):

```bash
cd "E:\Travaille\CodageAutres\Better Project\bmm-bridge-0.9.12"
npm install
npm run build          # tsc + tauri build (Tauri 1): MSI + NSIS in src-tauri/target/release/bundle/
```

The `frontend/src/features/betahub/betahub-config.local.ts` that 0.9.11 was built with is
gitignored: copy it into the worktree before building, or tsc reports it missing.

**Publish, in this order:**

1. **0.9.12 first, as Latest, while 1.0.2 is not out yet.** Tag `v0.9.12` on branch
   `bridge-0.9.12`. Attach **one** installer, of the kind the 0.9.11 release carried (0.9.11 runs
   the first `.msi` it finds, so if the 0.9.11 release had an `.msi`, attach only
   `Better Mod Manager_0.9.12_x64_en-US.msi`), no `.zip`. Not a pre-release, « Set as the latest
   release » ticked. 0.9.11 copies then update to 0.9.12 the usual (unverified) 0.9.11 way.
   While 0.9.12 is Latest, 0.9.12 offers the existing 1.0.1 pre-release (a newer major line). It
   has no signed manifest and its update.json lists no installer checksum, so the person gets the
   « could not be checked » warning and decides; 1.0.x copies see nothing newer.
2. **Then 1.0.2, as Latest**, with `release.ps1 -Publish` or the tag workflow (`BMM-Setup.exe`,
   `bmm.bpkg`, `update.json`, signed `update-manifest.json`, `lang-*.json`, `links.json`; manifests
   signed the day you publish). It takes Latest from 0.9.12.
3. **Never mark 0.9.12 Latest after 1.0.2 is out**: `releases/latest/download/update.json` is how
   BetterInstaller installs of 1.0.x find their update, and 0.9.12 carries none.

**How a 0.9.x user reaches 1.0.2:**

| Installed | Path |
|---|---|
| 0.9.11 that updated during step 1 | 0.9.11 → 0.9.12 (its `.msi`/`.exe`) → 0.9.12 sees 1.0.2 → verified `BMM-Setup.exe` → 1.0.2 |
| 0.9.11 that did not | 0.9.11 sees 1.0.2 at `/releases/latest` → runs `BMM-Setup.exe` (the only `.exe`, unverified, as 0.9.11 always did) → 1.0.2 |
| 0.9.12, pre-release line later (1.1.0-beta) | offered automatically only if it is a newer major; otherwise with « Enable pre-releases » on |

1.0's first start copies the 0.9.x data (`%APPDATA%\com.bettermm.app` → `com.bettermm.desktop`).
BetterInstaller installs into `Program Files\Better Mods Manager`; the 0.9.x MSI/NSIS copy (Tauri 1,
`Better Mod Manager`) is **not** removed by it: check on a test machine whether both stay in
« Apps & features » and tell users to uninstall 0.9.x if so.

**Not verified:** a real 0.9.11 → 0.9.12 → 1.0.2 run on a machine (no installer was run while
preparing this); the 0.9.12 MSI build (only `cargo check` / `cargo test` and the frontend compile
ran in the worktree).

---

## The `bmm://` protocol

BetterInstaller registers `bmm://` at install time and **unregisters it on uninstall** — that is
`[install].protocol` in `installer.toml`.

BMM also claims the scheme at startup, as a fallback for dev and portable runs. Two rules keep the
two from fighting: a copy running from a temp directory never claims it, and a registration whose
target no longer exists is always taken over. That second rule is what repairs a machine where an
uninstalled or deleted build left the scheme pointing at nothing.

---

## Checklist

- [ ] The owner publishes: nobody else pushes a tag or creates a release
- [ ] `npm run ci` green (includes `check-release-versions`)
- [ ] Version bumped in `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml` (+ `Cargo.lock`) **and** `installer.toml`
- [ ] Changelog `Update/changelog_v<version>_EN.md` + `_FR.md` (CI uses the EN one as the release body)
- [ ] Push the tag `v<version>`: `release.yml` builds, signs both manifests, runs `check-release-versions --artifacts` and publishes everything in one `gh release create --latest`
- [ ] By hand instead: `npm run release` (signs `update-manifest.json`), or `BetterInstaller/examples/bmm/release.ps1 -Version <v> -Publish` (does everything, one `gh release create --latest`). Publishing another day: re-sign both **the day you publish** (`node scripts/sign-update-manifest.mjs sign <update-manifest.json> --key <private.key>`, `bpkg resign-manifest`), `node scripts/check-release-versions.mjs --artifacts`, then upload every asset listed in « What `build:installer` does », **not** as a pre-release, **as Latest**
- [ ] `bpkg verify` passes on `Release/bmm.bpkg`
- [ ] Install it on a clean machine and check the setup choices actually applied
- [ ] Check that an older installed copy sees the update (0.9.11, 1.0.x via BetterInstaller, 1.0.x other)

### 1.0.2

- Versions: 1.0.2 in all six sources (the gate is green).
- Order: **0.9.12 first, as Latest**, then **1.0.2 as Latest** (it takes Latest from 0.9.12). Never
  set 0.9.12 back to Latest afterwards (see « Bridge 0.9.12 »).
- Publish as **Latest**, not a pre-release, with only `BMM-Setup.exe` as installer asset.
- Every asset: `BMM-Setup.exe`, `bmm.bpkg`, `update.json`, signed `update-manifest.json`,
  `lang-*.json`, `links.json`. `check-release-versions --artifacts` passes on exactly these.
- Re-sign `update.json` and `update-manifest.json` at publish time (both expire 7 days after
  signing); `resign-manifests.yml` renews them twice a week afterwards.
- Changelog: `Update/changelog_v1.0.2_EN.md` / `_FR.md`. Release comms drafts: `Release/1.0.2/`.
