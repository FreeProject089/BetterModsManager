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
    destination folders until *you* activate a mod.

---

## What you need

| | |
|---|---|
| **OS** | Windows 10 or 11 |
| **WebView2** | Required by BMM itself. Present on Windows 11 and on up-to-date Windows 10. If it is missing, install the [Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) — the installer does not bundle it (the installer's own window is native and needs nothing) |
| **Disk** | The app itself is small. Plan for your **mods**, and remember that BMM deploys by **copying** — an enabled mod exists twice, once in your mods folder and once in the destination folder |
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
- anything BMM already deployed into a destination folder.

That second point matters: because BMM deploys real copies rather than links, a mod that was enabled
when you uninstalled **stays enabled** in the game. If you want a clean destination folder, disable your
mods *before* uninstalling — BMM will restore each original file from `_original/` as it goes. See
[Conflicts](doc-page:how-it-works/conflicts).

Your `%APPDATA%` folder is also left in place, so reinstalling later picks up exactly where you left
off. Delete it by hand if you really want a blank slate — and **export first**, from Settings → Data.

---

## Which build?

**Stable**, unless you have a reason. **Settings → Auto Update → Update channel** has two
choices:

| Channel | What you get |
|---|---|
| **Stable** | Tested releases only. The default. |
| **Pre-release** | Beta builds too, before they are final: fixes first, and bugs first. |

A pre-release build you installed keeps following the pre-release channel, so it is never
offered an older stable build as an "update".

---

## Updating BMM

BMM checks for a new version when it starts. **Check in the background** (same card) adds a
check while it stays open: **Off**, **Every 6 h** or **Daily**. The card also shows when the
last check ran, and whether it failed.

When a version is available, BMM shows its notes and three choices:

| Button | What happens |
|---|---|
| **Install now** | Download, check, install. Everything happens in BMM: no trip to GitHub. |
| **Install on next launch** | Downloaded and checked now, installed the next time you start BMM (you get a few seconds to say **Not now** or **Discard**). |
| **Remind me tomorrow** | Nothing is downloaded. BMM asks again tomorrow. |

The window then shows the steps: **Download** (size, speed, time left), **Verify**, **Install**.

### What is checked before the installer runs

The installer is checked before it starts, in this order:

1. The release's signed **`update-manifest.json`**: it lists `BMM-Setup.exe` with its SHA-256,
   signed with the publisher's key built into BMM.
2. Otherwise, the release's signed **`update.json`**, which also lists `BMM-Setup.exe` with its
   SHA-256.
3. Otherwise, BMM says plainly what could not be checked (no `update.json`, an
   `update.json` it cannot trust, or no checksum for the installer) and you choose
   **Install anyway** or **Cancel**. **Cancel** is the default.

BetterInstaller then checks the package itself: it must carry a valid Ed25519 signature for the
publisher key built into the installer, or it is refused before the install folder is touched,
and a failed install is rolled back.

The window says which check passed. A downloaded file that does **not** match what the release
declares is shown in red: it may be corrupted or tampered with, and installing it is not
recommended.

:::note[If you installed BMM with BetterInstaller]
The update goes through BetterInstaller with no questions: BMM runs `BMM-Setup.exe --update`,
which waits for BMM to close, installs over it keeping your folder, components, shortcuts and
choices, and starts BMM again. The same updater can be run by hand or from a script: see the
[BetterInstaller command line](https://github.com/FreeProject089/BetterInstaller/blob/master/GUIDE.md#command-line-unattended-install-update-repair-modify-uninstall).
:::

### When it does not go through

A failure stays in the window, with the reason in words (permission prompt declined, file
still held by an antivirus, access denied by a security policy, an installer that closed at
once with an error code), and two buttons: **Try again** and **Download from the release page**.
An installer that needs administrator rights gets the normal Windows permission prompt.

### Coming from an older version

| You have | What happens |
|---|---|
| **1.0.x** | The normal update above. |
| **0.9.11** | Accept the update to **0.9.12**, then the update to 1.0.2 it offers next. 0.9.12 is a bridge release: only its updater changed, so that it sees the 1.0 line and checks the installer before running it. |
| **Anything older** | Download `BMM-Setup.exe` from the release page and run it. Your data is kept. |

A jump to a new major version (0.9 → 1.0) is always a full install with the installer, never a
file-by-file patch: the data folder moves, and BMM copies your data across on first launch
(see [Where BMM puts things](#where-bmm-puts-things)).

### Removing an old installation

An older BMM (the 0.9.x « Better Mod Manager », or the 1.0.0 test build) stays installed next to
1.0 until you remove it. BMM finds what is left over and offers to remove it; it is entirely
optional and nothing is removed without a click.

- **What it finds**: other BMM installs registered with Windows (NSIS or MSI), the old data folder
  `%APPDATA%\com.bettermm.app`, the old browser cache in `%LOCALAPPDATA%\com.bettermm.app`, and
  Start menu or desktop shortcuts that open a program that is gone or belongs to an old install.
  The BMM you are running is never listed.
- **When**: once at start-up, after your data was carried across (or when something new turns
  up), as a list where nothing is ticked. **Not now** keeps it for later, **Never ask again** stops
  the question. It is always in **Settings › Application › Old installations**, with **Scan again**.
- **How**: an old install is removed by its own uninstaller (tick *Silent* to skip its window).
  Shortcuts and caches are deleted after one confirmation. The old data folder is offered only
  once your data is in the new folder; BMM first offers to **back it up as a .zip** (on by default,
  into Documents or a folder you pick), then asks a second time, naming the folder and its size.
- **Safety**: BMM deletes only those exact folders, never through a link or junction, and never
  a path the scan did not find a moment before.

### Turning it off

Untick **Check for updates automatically** in **Settings → Auto Update**, and nothing is
checked at start-up. Then update by hand, because a mod manager a year behind the repos it
reads will eventually disagree with them. A build can also have updates switched off entirely
(`DisableUpdate` in [`app.cfg`](doc-page:reference/app-cfg)).

Where BMM looks: the release on
[GitHub](https://github.com/FreeProject089/BetterModsManager/releases), then the mirror on
BetterCommunity, and it keeps the newest version any of them advertises, so one being down
never blocks an update. The rules a signed manifest must pass are in
[Security](doc-page:how-it-works/security#bmms-own-quick-update-is-signed-too).

!!! note "Rate-limited on GitHub?"

    Update and download checks hit GitHub. If you ever see rate-limit errors, add an optional
    **GitHub token** in **Settings → Identity & API**: it raises the limit. It only needs read
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
