# BMM in pictures

**English** · [Français](VISUALS_FR.md)

A visual tour of Better Mod Manager, area by area. Every picture is the real app, run in the
browser preview with demo data (no real profile, path or account), composed as it sits on a
desktop: the window, with Tasky on its top-left corner.

Short usage clips (GIF, with an MP4 copy) are being recorded for 1.0.3. They will appear under
`.github/gifs/` once they have been reviewed; until then each one is listed below as *coming*,
with its link kept in a comment.

- [Library and profiles](#library-and-profiles)
- [Server repos](#server-repos)
- [Catalogues and apps](#catalogues-and-apps)
- [Activity and tools](#activity-and-tools)
- [Themes](#themes)
- [Plugins and API](#plugins-and-api)
- [Settings](#settings)

## Library and profiles

| | |
|---|---|
| ![Mod Library](.github/screenshots/library.png)<br>**Mod Library**: tagged mods, filters, load order and one switch per mod. | ![Profiles](.github/screenshots/profiles.png)<br>**Profiles**: one setup per game, or several per game. |
| ![Mod Library, light theme](.github/screenshots/library-light.png)<br>**The same Library** in the built-in light theme (Daylight). | |

*Clip coming*: **Resolve a conflict**, from a library badge to the conflicts view: « Make Enhanced
Textures win », the files that change hands, Apply.
<!-- ![Resolve a conflict](.github/gifs/resolve-conflict.gif) -->

## Server repos

| | |
|---|---|
| ![Server Repo, Sync](.github/screenshots/repo-sync.png)<br>**Sync**: paste a `repo.json` address, preview, then sync. | ![Server Repo, Host](.github/screenshots/repo-host.png)<br>**Host**: numbered steps and the running server's card. |

*Clip coming*: **Follow a repo**, Followed repos → « Follow a repo »: a LAN address is typed,
tested (name, version, signature, content) and followed.
<!-- ![Follow a repo](.github/gifs/follow-repo.gif) -->

## Catalogues and apps

| |
|---|
| ![App Catalog](.github/screenshots/apps.png)<br>**App Catalog**: each card shows its state and its next action. |

## Activity and tools

| | |
|---|---|
| ![Activity centre](.github/screenshots/activity.png)<br>**Activity centre**: every running task, with Cancel, and what finished recently. | ![BMM Tools](.github/screenshots/tools.png)<br>**BMM Tools**: read-only checks, here disk usage per profile and per mod. |

*Clips coming*:

- **Activity centre**: jobs fill the title-bar ring, the panel lists them live, one is cancelled.
  <!-- ![Activity centre](.github/gifs/activity-centre.gif) -->
- **BMM Tools**: Ctrl+K → BMM Tools, search « disk », run Disk usage, copy the result.
  <!-- ![BMM Tools](.github/gifs/bmm-tools.gif) -->
- **Notifications**: toasts arrive, the bell opens the centre grouped by source, one entry is
  snoozed for an hour, Do not disturb goes on.
  <!-- ![Notifications](.github/gifs/notifications.gif) -->

## Themes

Fourteen built-in themes ship with BMM; [THEMES.md](THEMES.md) shows each one with its id and
explains the editor and the file format. A few of them:

| | | |
|---|---|---|
| ![Default](.github/themes/bmm-default.png)<br>**Default** · dark | ![Daylight](.github/themes/bmm-white.png)<br>**Daylight** · light | ![Pure Black](.github/themes/bmm-void.png)<br>**Pure Black** · dark |
| ![Newsprint](.github/themes/bmm-brutal.png)<br>**Newsprint** · light | ![Arctic](.github/themes/bmm-arctic.png)<br>**Arctic** · dark | ![Blossom](.github/themes/bmm-sakura.png)<br>**Blossom** · light |
| ![Ember](.github/themes/bmm-orange.png)<br>**Ember** · dark | ![Cobalt](.github/themes/bmm-cobalt.png)<br>**Cobalt** · dark | ![BMM Logo](.github/themes/bmm-logo.png)<br>**BMM Logo** · light |

*Clip coming*: **Theme editor**, start from a built-in theme, generate a palette from one colour,
fix the contrast the editor flags, save it as a new theme.
<!-- ![Theme editor](.github/gifs/theme-editor.gif) -->

## Plugins and API

No still picture yet for this area.

*Clip coming*: **Create a plugin**, Plugins & API → Create: a template, the identity (the live
preview card follows), the permissions it asks for, with their risk.
<!-- ![Create a plugin](.github/gifs/create-plugin.gif) -->

## Settings

| |
|---|
| ![Settings](.github/screenshots/settings.png)<br>**Settings**: an index of every card, with search (Ctrl+F). |

*Clip coming*: **Settings**, Ctrl+F finds a setting; the index edits the page layout (hide a
card, move one), then folds away.
<!-- ![Settings](.github/gifs/settings.gif) -->

---

The pictures are made by the release tool (`tools/release/`, media step) from the browser
preview; see [tools/release/README.md](tools/release/README.md#media).
