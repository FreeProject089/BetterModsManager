# What's new in BMM 1.0

1.0 is the release that turned Better Mods Manager from a mod switcher into a platform: profiles that survive a game update, mods recognised by their content, an order you control, plugins and automations, catalogues and repos you can follow, and an optional assistant that never leaves your PC. This page tells the story of 1.0 as a whole (1.0.0, 1.0.1 and 1.0.2). The patch notes that come after it, 1.0.3 and later, are in the list beside it and matter less than this page does.

> Looking for one fix or one number? Pick a version in the list on the left. Looking for what BMM can do today? Read this page first, then the **User guide** in Help & other.

## [MAJOR] Your setup is yours, not the game's
- **Profiles** keep each game's mods, folders and backups apart. A game update or a reinstall no longer wipes what you built.
- **ContentID**: a mod is recognised by its files, not by its folder name. The same files give the same identity on any PC, so `.MM` lists, modpacks and repos match the right mods.
- **Integrity**: SHA-256 fingerprints and a deep audit. A mod with a missing or modified file shows a red shield and cannot be enabled by mistake.
- **Activation order**: when two mods ship the same file, the last one in the order wins. See it, drag it, share it as a code or a link, re-apply it. The **Conflicts view** (1.0.3) shows who wins each shared file.
- **Mapper**: a visual tree of any mod folder, to see why a game ignores a mod.

## [MAJOR] Share and follow
- **Modpacks** and **`.MM` lists** carry a setup to a friend, with the order and what the sources need.
- **Server Repo**: host a repo from a profile, a modpack or a folder, over HTTP, SSH or static files. A friend **follows** it, and BMM checks it on a schedule you choose, then notifies, downloads or applies the update (never while a game runs).
- **Catalogues** (apps, plugins, themes, tutorials, mod lists) share one screen and one format. Signed feeds and passphrases protect the ones you want protected.
- **App Catalog**: install and launch companion apps in one click.

## [MAJOR] Make it do more
- **Plugins**: a manifest, a mod list to apply, bundled scripts behind explicit permissions, installed from a catalogue or a `.bmmplug` file.
- **Scheduler and BMMScript**: automations as blocks or as text, with conditions, loops and parallel branches. A shared automation can never grant itself the right to run programs.
- **Local API, CLI and MCP server**: drive BMM from a Stream Deck, a script or an AI agent, with a token and per-plugin permissions.
- **Launch packs**: start a group of programs with one click, with no console flashing.

## [MAJOR] Learn, customise, understand
- **Interactive tutorials** that point at the real app, which you can also write, translate and share.
- **Help & other**: the User guide, interactive diagrams, the full documentation offline, Ask Laya and the command palette (Ctrl+K).
- **Themes**: a full theme editor, built-in themes, light and dark done properly. A customisable navigation bar and your own pages.
- **English and French**, complete, and a translation studio for the rest.

## [MAJOR] Laya, optional and local
- A classifier built into BMM suggests a mod's name, version, author, description and tags from its own files. Nothing is written until you tick and Apply.
- **Ask Laya** answers in plain words with the docs, settings and actions that exist.
- No Python, no server, nothing sent. Off until you turn it on.

## [MAJOR] Calm on your PC
- A **resource governor**: every heavy job goes through one queue with Pause, Resume and Cancel, and a work intensity you pick.
- **App mode**: BMM steps aside while the game or the program you mod is running.
- A **Storage Manager** for disks, speed limits and live activity.

## [NEW] Updating, privacy and trust (1.0.2)
- **One-click updates**: BMM downloads, checks the signed manifest and the SHA-256, then starts the installer, or tells you in words why it could not.
- **Activity centre** for every running task, **BMM Tools** for read-only checks, **My consents** for a tamper-evident receipt of every privacy answer.
- Telemetry is off until you agree, and the Privacy Policy lists every connection BMM makes.

## Where to go next
- The patch notes of each version are in the list on the left, newest first.
- 1.0.3 adds the notification centre, the Conflicts view, panels in their own window and calmer Settings.
- New to BMM? Open **Help & other** and start with the **User guide**: each task has short steps, a picture and a **Show me** button.
