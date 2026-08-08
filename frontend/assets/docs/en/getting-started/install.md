# Install BMM

BMM is a **Windows** application. Installing it takes three steps:

1. Download **`BMM-Setup.exe`** from the latest release:
   [GitHub releases](https://github.com/FreeProject089/BetterModsManager/releases/latest) ·
   [BetterCommunity](https://bettercommunity.ch/p/bmm) — same file, either source.
2. Run it. Windows may show a SmartScreen prompt the first time (it does that for any new
   publisher) — choose **More info → Run anyway**.
3. Launch BMM.

No account to create. The installer asks you a handful of setup questions on the way through and
BMM picks them up on first launch, so you land in a configured app rather than an empty one — see
[First launch](doc-page:getting-started/first-launch).

!!! tip "Pick an install location you control"

    Install BMM somewhere you own (your user folder, a games drive), not deep inside `Program Files`
    if you'd rather avoid Windows' permission prompts when it updates itself. BMM never touches your
    game folders until *you* activate a mod.

---

## What you need

| | |
|---|---|
| **OS** | Windows 10 or 11 |
| **WebView2** | Required by BMM itself. Present on Windows 11 and on up-to-date Windows 10. If it is missing, install the [Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) — the installer does not bundle it (the installer's own window is native and needs nothing) |
| **Disk** | The app itself is small. Plan for your **mods**, and remember that BMM deploys by **copying** — an enabled mod exists twice, once in your mods folder and once in the game folder |
| **Admin rights** | Only if you install into a protected location |

BMM ships as a native app around the OS webview, not a bundled browser, so the download and the
memory footprint are both a fraction of an Electron-based manager. See
[Architecture](doc-page:how-it-works/architecture).

---

## The installer

`BMM-Setup.exe` is built with **[BetterInstaller](https://github.com/FreeProject089/BetterInstaller)**,
the project's own installer engine. It replaced the NSIS and MSI bundles BMM used to publish. One file, no runtime to install first: the
installer's window is native, not a web view.

What it does beyond copying files:

| | |
|---|---|
| **Checks the signature** | The package carries an Ed25519 signature and the installer refuses to install one that does not match its embedded public key — before anything is written |
| **Registers `bmm://`** | So deeplinks from BetterCommunity and from these docs reach the app |
| **Installs per-user** | Into `%LOCALAPPDATA%\Programs\Better Mods Manager` by default — no admin prompt. **Browse…** picks another folder |
| **Doubles as the updater** | Run it again on an installed BMM and it becomes a maintenance screen: update, repair, uninstall |

### The optional pieces

Three components, ticked or unticked on the way through:

| Component | Default | What it is |
|---|---|---|
| **Better Mods Manager** | required | The app itself |
| **MCP AI server** | on | The sidecar that lets an AI assistant drive BMM — see the [MCP reference](doc-page:reference/mcp) |
| **CLI tools** | off | `bmm-cli.exe`, for command-line automation |

Leaving one out is not permanent: re-run the installer and tick it.

### The questions it asks

This is the part that is easy to miss. The installer asks for your **language**, whether to accept
the terms, and a few preferences — telemetry, Discord Rich Presence, Smart I/O, sound effects,
whether to skip the interactive tutorial. It writes those answers next to BMM's data, and **BMM
reads them once on first launch**.

So a setting you chose in the installer is already applied the first time the app opens. Every one
of them is also in **Settings** afterwards; nothing the installer asks is a one-time decision you
are stuck with.

---

## Where BMM puts things

Worth knowing before you back anything up or move machines:

| What | Where |
|---|---|
| The app | wherever you installed it |
| `data.json` — profiles, mods, settings, tokens | `%APPDATA%\com.bettermm.desktop\` |
| Crash logs | `%APPDATA%\com.bettermm.desktop\Crashes\` |
| API activity log | `%APPDATA%\com.bettermm.desktop\api-activity.log` |
| Session replays, caches | under the same folder |
| Your mods, games, backups | **wherever your profiles point** — BMM never relocates them |

`data.json` keeps a rolling `.bak`, and if the main file is ever unreadable BMM recovers from the
backup rather than resetting; a corrupt file is preserved as `data.corrupt-<timestamp>.json` instead
of being deleted.

!!! note "Upgrading from 0.9.x — your data moves itself"

    The bundle identifier changed (`com.bettermm.app` → `com.bettermm.desktop`) and Windows derives
    the app-data folder from it, so a fresh 1.0 install would otherwise look in a brand-new empty
    folder while your real data sat under the old name. BMM copies it across **once, before anything
    reads `data.json`** — and it *copies* rather than moves, so the old folder stays as a safety net.
    The migration is guarded: it only runs when the new folder has no data and the old one clearly
    does, and it skips any file that already exists, so a retried migration can never clobber
    something newer.

---

## Uninstalling

Uninstalling removes the application. It does **not** touch:

- your mods, games or backups — those live in your own folders,
- anything BMM already deployed into a game folder.

That second point matters: because BMM deploys real copies rather than links, a mod that was enabled
when you uninstalled **stays enabled** in the game. If you want a clean game folder, disable your
mods *before* uninstalling — BMM will restore each original file from `_original/` as it goes. See
[Conflicts](doc-page:how-it-works/conflicts).

Your `%APPDATA%` folder is also left in place, so reinstalling later picks up exactly where you left
off. Delete it by hand if you really want a blank slate — and **export first**, from Settings → Data.

---

## Which build?

**Stable**, unless you have a reason. In **Settings → Updates** you can opt into **pre-releases**:
they get fixes first and bugs first. That's a real trade, which is why it's a toggle and not the
default. If you like being early and don't mind reporting the occasional rough edge, turn it on; if
you just want your mods to work, leave it off.

---

## Auto-update

On by default. BMM checks, tells you, and updates itself. You can turn it off in the same place — but
then update by hand, because a mod manager that's a year behind the repos it reads will eventually
disagree with them.

An update is verified before it can touch your install: the package **must** carry a valid Ed25519
signature for the publisher key baked into the installer, or it is refused *before* the install
directory is touched. The installer then snapshots and rolls back if the install itself fails. See
[Security](doc-page:how-it-works/security).

Where it looks, in order: the manifest on
[GitHub releases](https://github.com/FreeProject089/BetterModsManager/releases/latest), then the
mirror on BetterCommunity. It fetches every source it can reach and takes the newest version any of
them advertises, so one being down never blocks an update. When the release offers a delta, only the
changed parts are downloaded.

!!! note "Rate-limited on GitHub?"

    Update and download checks hit GitHub. If you ever see rate-limit errors, add an optional
    **GitHub token** in **Settings → Identity & API** — it raises the limit. It only needs read
    scope, it is stored locally, and it is never sent anywhere but GitHub. Purely optional; most
    people never need it.

---

## Next

- [First launch](doc-page:getting-started/first-launch) — create your first profile and add a mod.
- [Troubleshooting](doc-page:reference/troubleshooting) — if something is already odd.

## Where to get it

| | |
|---|---|
| **Releases** | [github.com/FreeProject089/BetterModsManager/releases](https://github.com/FreeProject089/BetterModsManager/releases) — every version, with its changelog |
| **BetterCommunity** | [bettercommunity.ch/p/bmm](https://bettercommunity.ch/p/bmm) — the project page: download, news, and the community around it |
| **Source** | [the repository](https://github.com/FreeProject089/BetterModsManager) — GPL-3.0, see [Credits](doc-page:reference/credits) |
