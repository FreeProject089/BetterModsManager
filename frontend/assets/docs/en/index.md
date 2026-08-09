# BetterModsManager

BMM installs, organises and shares your mods — across games, without ever touching the
original files more than it has to.

If you're new, read this page. It's short, and it explains the one idea the rest of the app
is built on. Skipping it is why people get lost on screen three.

!!! tip "Two ways to read these docs"
    The **Getting started** and **Features** sections teach you how to *use* BMM. The new
    **[How it works](doc-page:how-it-works/index)** section is for the curious and for contributors —
    it explains *why* BMM behaves the way it does, with diagrams. Read whichever half you came for.

## The one idea: your mods and your setups are separate things

Most mod managers put mods *in the game*. BMM keeps them apart:

- The **[Library](doc-page:features/library)** holds every mod you own. It's a shelf. A mod sitting
  there does nothing.
- A **[Profile](doc-page:features/profiles)** decides which of those mods are *on*, and in what
  order, for one game.

That split is the whole point. As BMM puts it on its own empty-profile screen:

> A profile is your safety net: enable, disable and reorder mods freely, and a game update
> or reinstall never wipes your setup again.

Because the mods live in the Library, a game update, a reinstall, or a bad mod can't take
them with it. You rebuild by switching a profile back on, not by re-downloading anything.

This is also why **uninstalling a mod from a profile doesn't delete it**. It goes back to
being a mod on a shelf, ready for another profile. Newcomers expect a delete; BMM gives them
an undo.

## What each screen is for

| Screen | Use it when |
|---|---|
| **[Library](doc-page:features/library)** | You want to see, add, or verify the mods you own. |
| **[Profiles](doc-page:features/profiles)** | You want a setup per game — or several per game (vanilla-ish, heavy, testing). |
| **[.MM Lists](doc-page:features/modlist)** | You want to hand your exact setup to someone, links included. |
| **[Modpacks](doc-page:features/modpacks)** | You want to toggle a whole bundle of mods on and off at once. |
| **[Server Repo](doc-page:features/repo)** | You want a source that tells BMM when a mod has an update. |
| **[Plugins & API](doc-page:features/plugins)** | You want BMM to do something it doesn't do out of the box. |
| **[App Catalog](doc-page:features/apps)** | You want the tools *around* modding, installed in one click. |
| **[Mapper](doc-page:features/mapper)** | A mod's folders don't match what the game expects. |
| **[BetterCommunity](doc-page:features/community)** | You want news and posts from the project's blogs. |
| **[Settings](doc-page:features/settings)** | Themes, updates, storage limits, data export. |

## Conflicts, in one paragraph

Two mods that ship the same file are in **conflict** — whichever is activated last wins, and
overwrites the other. BMM detects this before you commit, tells you exactly which files
overlap, and lets you decide the order. You'll meet this the first time you enable two big
mods, so it's worth knowing the word now. See [Library](doc-page:features/library#conflicts).

## Where to go next

1. **[Install BMM](doc-page:getting-started/install)** — a few minutes.
2. **[First launch](doc-page:getting-started/first-launch)** — create a profile, add a mod, turn it on.
3. Then pick whichever screen matches what you're trying to do.

!!! tip "There's a tutorial *inside* the app"

    **Help & other → Interactive Tutorial Hub** teaches BMM step by step with a built-in
    practice sandbox (an example profile, example mods and a modpack, cleaned up automatically)
    so you can practise without risking a real install. If you learn by doing rather than
    reading, start there and use this site as reference.

## Reading this site next to the app

These docs and BMM's own **Help & other** hub are two views of the same material, and they are
wired to each other on purpose:

- Every in-app article has a **Read full docs** button that opens *its* page here — not the
  homepage. The in-app version is the short answer next to the buttons that do the thing; this
  site is the long one, with the diagrams and the reference tables.
- Pages here carry an **Open in BMM** link that jumps straight to the matching screen or article
  in the app.

### How the `bmm://` links work

An *Open in BMM* link is a **deeplink** — a URL your OS hands to BMM, the same mechanism the
one-click install buttons on BetterCommunity use.

| | |
|---|---|
| **BMM must already be running** | The link is delivered to the open window; it will not start the app for you |
| **Nothing happens silently** | Every deeplink shows a toast when it arrives, and the ones that could surprise you — connecting a repo, subscribing to a catalog, any non-`GET` API call — ask first |
| **Your browser will ask once** | The first time, it wants permission to open an external application. That prompt is the browser's, not BMM's |
| **You can turn them all off** | A global kill switch refuses every deeplink |

The complete list of what a deeplink can do — 49 of them, plus every HTTP endpoint — is in the
[API & deeplink reference](doc-page:reference/api).
