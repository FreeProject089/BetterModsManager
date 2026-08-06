# Install BMM

BMM is a **Windows** application. Installing it takes three steps:

1. Download the latest release — the installer is a Windows `.exe` (NSIS), with an `.msi` also
   available.
2. Run it. Windows may show a SmartScreen prompt the first time (it does that for any new
   publisher) — choose **More info → Run anyway**.
3. Launch BMM.

That's it: no account to create, nothing to configure beforehand. You do your first setup *inside*
the app — see [First launch](doc-page:getting-started/first-launch).

!!! tip "Pick an install location you control"

    Install BMM somewhere you own (your user folder, a games drive), not deep inside `Program Files`
    if you'd rather avoid Windows' permission prompts when it updates itself. BMM never touches your
    game folders until *you* activate a mod.

---

## What you need

| | |
|---|---|
| **OS** | Windows 10 or 11 |
| **WebView2** | Required. Already present on Windows 11 and on up-to-date Windows 10; the installer pulls it in if it isn't |
| **Disk** | The app itself is small. Plan for your **mods**, and remember that BMM deploys by **copying** — an enabled mod exists twice, once in your mods folder and once in the game folder |
| **Admin rights** | Only if you install into a protected location |

BMM ships as a native app around the OS webview, not a bundled browser, so the download and the
memory footprint are both a fraction of an Electron-based manager. See
[Architecture](doc-page:how-it-works/architecture).

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

An update is verified before it can touch your install: when the update channel supplies a publisher
key, the package **must** carry a valid Ed25519 signature for that key or it is refused *before* the
install directory is touched. The installer then snapshots and rolls back if the install itself
fails. See [Security](doc-page:how-it-works/security).

!!! note "Rate-limited on GitHub?"

    Update and download checks hit GitHub. If you ever see rate-limit errors, add an optional
    **GitHub token** in **Settings → Identity & API** — it raises the limit. It only needs read
    scope, it is stored locally, and it is never sent anywhere but GitHub. Purely optional; most
    people never need it.

---

## Next

- [First launch](doc-page:getting-started/first-launch) — create your first profile and add a mod.
- [Troubleshooting](doc-page:reference/troubleshooting) — if something is already odd.
