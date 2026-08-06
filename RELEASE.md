# Releasing BMM

BMM ships through **BetterInstaller**. NSIS and MSI are no longer built.

---

## The commands

```bash
npm run ci                # the ten gates — run this before anything else
npm run build             # the app itself (no installer)
npm run build:installer   # the installer, from whatever npm run build produced
npm run release           # both, in order
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

Upload **all three** to the GitHub release: `BMM-Setup.exe`, `bmm.bpkg` and `update.json`. The
`.bpkg` and `update.json` are what installed copies read to auto-update; without them the setup
works but nobody gets an update.

To check what you built before shipping it:

```bash
BetterInstaller/target/release/bpkg.exe verify --key BetterInstaller/examples/bmm/keys/public.key Release/bmm.bpkg
```

---

## Where the configuration lives

| What | File |
|---|---|
| Installer identity, components, setup options, updater URL | `BetterInstaller/examples/bmm/installer.toml` |
| App identity, resources, window, plugins | `src-tauri/tauri.conf.json` |
| Version | `package.json` — and it must equal `installer.toml`'s `[app].version` |

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

`npm run ci` now checks it, along with the version and the main executable name. It is the tenth
gate, and it skips cleanly if BetterInstaller is not checked out beside this repo.

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

`src-tauri/src/commands/autoupdate.rs` picks between them by looking for the maintenance binary, so
there is nothing to configure per install.

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

- [ ] `npm run ci` green
- [ ] Version bumped in `package.json` **and** `installer.toml`
- [ ] `npm run release`
- [ ] `bpkg verify` passes on `Release/bmm.bpkg`
- [ ] Install it on a clean machine and check the setup choices actually applied
- [ ] Upload `BMM-Setup.exe`, `bmm.bpkg` **and** `update.json` to the release
- [ ] Check that an older installed copy sees the update
