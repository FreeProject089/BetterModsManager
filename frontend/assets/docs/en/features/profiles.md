# Profiles


A profile is a saved answer to "which mods are on, in what order, for this game". It's the
screen everything else leans on — BMM's own onboarding calls it *your starting point*.

Its real job is stated on the empty screen:

> A profile is your safety net: enable, disable and reorder mods freely, and a game update
> never wipes your setup again.

![The Profiles screen](assets/docs/media/screens/profiles.annotated.png)

| | | |
|---|---|---|
| **1** | **Profile card** | Click to make it active. Everything you enable lands here. |
| **2** | **Game folder** | Where this profile deploys. See the warning below. |
| **3** | **New profile** | One per *setup*, not one per game — you can have several. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/profiles.bmmreplay" data-page="features/profiles" data-title="Creating and switching profiles (placeholder clip)"></div>

*Placeholder recording — a focused clip of this screen will replace it.*

## Why several profiles per game

Because each profile is just a cheap record, and its mods already live in the
[Library](doc-page:features/library) — so keeping a few around costs almost nothing. Give each its **own mods
folder** (see the warning below) and they become genuinely separate loadouts. A typical split:

- **Vanilla-ish** — a couple of fixes, for when you want the real game.
- **Heavy** — the full stack, for when you don't.
- **Testing** — where a new mod goes first, so a bad one never touches the other two.

Switching profiles doesn't re-download anything: the mods already live in the
[Library](doc-page:features/library).

## The one mistake that hurts: sharing a folder

BMM warns about this explicitly, and it's worth repeating.

!!! danger "Two profiles, one game folder"

    From BMM's own warning: sharing the same folder between multiple profiles is *a major
    source of human error*.

    Both profiles deploy into the same place, and neither knows what the other put there.
    Files survive a profile switch, and you end up debugging a mod you thought was off. Give
    each profile its own folder unless you know exactly why you're not.

## Making them yours

Each profile takes an **accent colour**, an **icon** (a preset or your own image), and a
**background image** for the card (with a crop step to fit the format). This isn't decoration
for its own sake: with five profiles, a glance at a colour and icon beats reading five names —
and picking the wrong profile is the mistake this screen exists to prevent. Give your risky
*Testing* profile a colour you'll never confuse with your main one.

## Your first profile

The moment it's created, BMM tells you what just changed:

> Your first profile is ready! Everything you enable from now on is saved right here — safe
> from game updates and reinstalls.

That's the contract. From there, [add a mod](doc-page:features/library) and turn it on.

## Moving a profile somewhere else

There is no "export this profile" button, and that is deliberate — a profile is a *choice*
(which mods, in which order, pointed at which folder), not a package. Three things carry that
choice, and which one you want depends on who is on the other end:

| You want to | Use | What travels |
|---|---|---|
| Give someone the same setup, and they already have the mods | A [`.MM` list](doc-page:features/modlist) | The mod names, versions and order — a text file, kilobytes |
| Give someone the same setup, mods included | A [modpack](doc-page:features/modpacks) | The list *and* the files |
| Keep the same setup for a group, and keep it updated | A [server repo](doc-page:features/repo) | Everything, plus every later change |
| Move your whole BMM to another machine | **Settings → Export data** | Profiles, scanned mods, tags, settings, plugins — whatever you tick |

**Settings → Export data** is the one people miss. It writes a single file, and each part is a
separate switch: profiles, mods, tags, settings, plugins. Import reads the same file back.
That is a *backup*, not a share — it carries your paths, which will not match another machine.

!!! tip "Coming from another manager"
    BMM imports profiles from **OpenModManager** and **OVGME** directly, so you do not have to
    rebuild them by hand. It reads their profile files and creates the matching BMM profiles.

## The activity log

Every profile keeps its own record of what was done to its mods. Open it from the Library.

| It records | It does not record |
|---|---|
| Enabling a mod, and whether dependencies came with it | Anything you did on a *different* profile |
| Disabling one | Reading, searching, launching the game |
| Deleting one | File-level detail of what was written |
| Modifying one, with what changed | |

Each entry is a mod, an action, and a timestamp. It answers one question well: *when did this
profile last change, and to what?* — the question you actually ask when a game that worked
yesterday does not today.

Two things worth knowing, because neither is obvious:

- **The log lives next to the profile's backups**, in that profile's backup folder. If those
  sit on an external drive and the drive is unplugged, the log is unavailable until it is back —
  the same rule as the backups themselves.
- **Old entries are pruned when you open the log**, not on a timer. The retention period is a
  setting; entries older than it are dropped the next time the log is read, so a profile you
  never open keeps its history until you look at it.

You can clear a profile's log, and that clears only that profile's.
