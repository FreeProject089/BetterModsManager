# Releasing BMM

BMM ships through **BetterInstaller**. NSIS and MSI are no longer built.

---

## The commands

```bash
npm run ci                # the eleven gates — run this before anything else
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

Two paths exist, and they are not rivals:

- **Installed by BetterInstaller** — BMM finds the maintenance binary next to itself
  (`<install>/uninstall.exe`) and delegates the check to it. That path handles repair, update and
  uninstall, and can apply a binary delta instead of the full package.
- **Anything else** (dev runs, portable copies) — BMM's own incremental updater reads
  `update-manifest.json` from the GitHub release, which `npm run build` generates.

`update-manifest.json` is **signed**. `npm run build` writes it unsigned into
`dist/release-assets-v<version>/`; the release workflow then signs it with the publisher key
(`node scripts/sign-update-manifest.mjs sign <file> --key private.key`), checks it against the key
BMM pins (`… verify <file>`) and uploads it with the files it names. BMM refuses an unsigned,
foreign, expired or not-newer manifest (`autoupdate.rs`, `verify_manifest_text`).

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
release. **Decision (1.0.2): keep publishing every one of them alongside the signed manifest**,
rather than a one-off bridge release. They cost a few kilobytes per release, and dropping one
strands every copy that reads only it.

| Installed | What it does on « update » | What it needs on the release |
|---|---|---|
| **0.9.11** and older | GitHub `/releases/latest`; no major-version guard; downloads the first `.msi`, else the first `.exe`, and runs it through `cmd /C start` (no signature, no hash) | `BMM-Setup.exe` as the **only** `.exe`/`.msi` asset, on a release marked **Latest** |
| **1.0.0 / 1.0.1**, installed by BetterInstaller | `uninstall.exe --check-update` / `--update` reads `releases/latest/download/update.json` and fetches `bmm.bpkg` | `update.json` signed for the new version **at publish time** (it expires 7 days after signing) and the matching `bmm.bpkg` |
| **1.0.0 / 1.0.1**, other installs | `download_and_install_update`: needs `update-manifest.json` whose signed `installers` lists the **exact** URL of the asset it picked (`…/v<version>/BMM-Setup.exe`), then runs it with `open::that` | the signed `update-manifest.json` with `installers = [BMM-Setup.exe]` |
| **1.0.2+** | the same two paths; resumable verified download with progress; ShellExecuteExW launch with the real Windows error; « Download from the release page » on any failure | the same |

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
- Publish as **Latest**, not a pre-release, with only `BMM-Setup.exe` as installer asset.
- Re-sign `update.json` and `update-manifest.json` at publish time; `resign-manifests.yml` keeps them fresh afterwards.
- Changelog: `Update/changelog_v1.0.2_EN.md` / `_FR.md`. Release comms drafts: `Release/1.0.2/`.
