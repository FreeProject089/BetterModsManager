<div align="center">

  <img src=".github/screenshots/hero.png" alt="Better Mod Manager 1.0.2" width="100%" />

  # Better Mod Manager

  **A universal mod manager for Windows: profiles, a mod library, modpacks and Server Repo sync.**

  ![Version](https://img.shields.io/badge/version-1.0.2-blue.svg?style=flat-square)
  ![License](https://img.shields.io/badge/license-GPL--3.0-green.svg?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-important?style=flat-square)
  ![Rust](https://img.shields.io/badge/built%20with-Rust-orange?style=flat-square&logo=rust)
  ![Tauri](https://img.shields.io/badge/framework-Tauri%20v2-24C8D8?style=flat-square&logo=tauri)

  [Download](https://github.com/FreeProject089/BetterModsManager/releases/latest) •
  [Documentation](https://bettercommunity.ch/docs) •
  [Discord](https://discord.gg/CTaaEF9R75) •
  [Ko-fi](https://ko-fi.com/I2I31ZIPPG) •
  [Français](README_FR.md)

</div>

---

## What it is

Better Mod Manager (BMM) keeps your mods and your setups apart. The **Library** holds every mod
you own; a **Profile** decides which of them are on, and in what order, for one game. Turning a
mod on copies its files into the game, backs up what it replaces and records SHA-256 hashes, so
a profile can always be switched back off cleanly and a game update or reinstall never takes
your mods with it.

On top of that: modpacks, shareable `.MM` lists, repositories you can sync from or host
yourself, an app catalogue, an optional offline AI helper, a scheduler, plugins, themes, and a
CLI, an MCP server and a local API for scripting.

## Screenshots

| | |
|---|---|
| ![Mod Library](.github/screenshots/library.png) **Mod Library**: tagged mods, filters, load order, one switch per mod. | ![Profiles](.github/screenshots/profiles.png) **Profiles**: one setup per game, or several per game. |
| ![Server Repo, Sync](.github/screenshots/repo-sync.png) **Server Repo, Sync**: paste a `repo.json` address, preview, then sync. | ![Server Repo, Host](.github/screenshots/repo-host.png) **Server Repo, Host**: numbered steps and the running server's card. |
| ![Activity centre](.github/screenshots/activity.png) **Activity centre** (new in 1.0.2): every running task, with Cancel. | ![BMM Tools](.github/screenshots/tools.png) **BMM Tools** (new in 1.0.2): read-only checks, here disk usage per profile. |
| ![App Catalog](.github/screenshots/apps.png) **App Catalog**: each card shows its state and next action. | ![Settings](.github/screenshots/settings.png) **Settings**: an index of every card, with search (Ctrl+F). |

<p align="center"><img src=".github/screenshots/library-light.png" alt="Mod Library, light theme" width="70%" /><br/><sub>The same Library in the built-in light theme. Screenshots use demo data.</sub></p>

More pictures, area by area: [VISUALS.md](VISUALS.md).

## Features

- **Library**: every mod you own, with tags, search, filters, SHA-256 integrity checks and conflict detection before anything is written.
- **Profiles**: a game folder, a mods folder, a backup folder and a set of enabled mods per profile; switch in one click.
- **Modpacks and `.MM` lists**: toggle a whole bundle at once, or hand your exact setup (links included) to someone else.
- **Server Repo**: sync mods from a `repo.json`, follow a repo for updates, or host your own repo from BMM or with the standalone mini-server.
- **App Catalog**: the tools around modding, installed, launched and updated from one page.
- **Mapper**: fix a mod whose folders do not match what the game expects.
- **Laya (optional AI)**: suggests a mod's details and checks bug reports; the built-in offline model sends nothing anywhere.
- **Scheduler and BMMScript**: tasks with triggers, conditions and loops, written in the editor or as BMMScript; risky steps need permissions you grant one by one.
- **Plugins and API**: extend BMM with plugins, deeplinks (`bmm://`) and a local HTTP API.
- **Themes**: built-in themes (dark and light), a theme editor and a theme catalogue.
- **CLI and MCP**: `bmm-mcp-server.exe` drives BMM from scripts or from an AI agent over MCP.
- **Help built in**: bilingual articles, interactive tutorials and a command palette (Ctrl+K).

## What's new in 1.0.2

The full list is in the [1.0.2 changelog](Update/changelog_v1.0.2_EN.md). The highlights:

- **One-click updates that work again**: download, check against the release's signed manifest, install. Stable or pre-release channel, optional background check.
- **Activity centre**: a title-bar button listing every running task (activation, downloads, sync, scans, exports, Laya jobs…) with progress and Cancel, plus the last 30 finished ones.
- **BMM Tools**: duplicate finder, conflict summary, disk usage, profile comparison, missing and orphaned mods, hash checker, manifest and catalogue validator; results export to JSON or CSV.
- **Server Repo, simpler**: guided steps for Sync and Host, an « Advanced tools » area, followed repos, an Atom feed, repo format versions, and a standalone mini-server with a status page and scheduled jobs.
- **Settings**: an index of every card, search, and a layout you can rearrange from the index.
- **App Catalog and catalogues**: clearer cards, filters by install state, one versioned catalogue format.
- **My consents**: every answer about the Terms, the Privacy Policy and telemetry leaves a tamper-evident receipt you can view and export.
- **Start-up**: the classic Tasky intro is back and lighter (Classic, Logo or Off); new built-in theme « BMM Logo ».

## Install

1. Download **`BMM-Setup.exe`** from the [latest release](https://github.com/FreeProject089/BetterModsManager/releases/latest).
2. Run it. Windows may show SmartScreen the first time: **More info → Run anyway**.
3. Launch BMM.

Requirements: Windows 10 or 11 with WebView2 (present on Windows 11 and up-to-date Windows 10).
`BMM-Setup.exe` is built with [BetterInstaller](https://github.com/FreeProject089/BetterInstaller):
it checks the package's Ed25519 signature before writing anything, installs per user by default,
and doubles as the maintenance tool (update, repair, uninstall).

**Updating**

| You have | What to do |
|---|---|
| 1.0.x | Accept the update BMM offers. A BetterInstaller install updates with no questions: BMM runs `BMM-Setup.exe --update`, which waits for BMM to close, installs over it keeping your folder and choices, and starts it again. |
| 0.9.11 | Accept the update to **0.9.12** (a bridge release), then the update to 1.0.2 it offers next. |
| Older | Download `BMM-Setup.exe` from the release page and run it. Your data is kept. |

The same updater can be run by hand or from a script; see the
[BetterInstaller command line](https://github.com/FreeProject089/BetterInstaller/blob/master/GUIDE.md#command-line-unattended-install-update-repair-modify-uninstall).

## Privacy

BMM needs no account and shows no ads; your profiles, mods and settings stay on your PC. Telemetry
is **off until you say yes**, in the installer or on BMM's consent screen, and can be turned off
again in Settings → Privacy. Some connections are on by default (update checks, the link list,
connectivity checks, fonts and icons); each one is listed with its off-switch in the
[Privacy Policy](PRIVACY.md). Every answer you give leaves a versioned, hashed consent receipt,
kept on your PC and listed under Settings → Privacy → **My consents**.

## Documentation and help

- **Documentation**: <https://bettercommunity.ch/docs> (user guide, how it works, API, CLI and MCP reference, in English and French)
- **In the app**: **Help & other**, and **Ctrl+K** to search everything
- **Discord**: <https://discord.gg/CTaaEF9R75>
- **Releases**: <https://github.com/FreeProject089/BetterModsManager/releases>
- **Bug reports**: [GitHub Issues](https://github.com/FreeProject089/BetterModsManager/issues), or **Settings → Feedback & bug reports** in BMM
- **Contributing**: [Repository map](REPO_MAP.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)

## Build from source

You need Windows 10 or 11, [Node.js](https://nodejs.org/) 22 (the version CI uses), the
[Rust](https://www.rust-lang.org/tools/install) stable toolchain and the
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/FreeProject089/BetterModsManager.git
cd BetterModsManager
npm install
npm run dev     # TypeScript watch + the app in development mode
npm run build   # checks, compiles the frontend, builds the app (no installer)
npm run ci      # every gate, in the order CI runs them
```

The installer is built separately with BetterInstaller (`npm run build:installer`). Every
command is listed in the [commands reference](https://freeproject089.github.io/BMM-Docs/reference/commands/).

## License

Better Mod Manager is free software under the **GNU General Public License v3.0**. See
[LICENSE.md](LICENSE.md).
