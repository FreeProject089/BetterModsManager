# Recording plan — the clips still to make

Every clip the documentation needs, what it has to show, and where it lands. Two formats:

| Format | Use it for | Why |
|---|---|---|
| **`.bmmreplay`** (rrweb) | Anything happening *inside BMM* | It replays the **DOM**, so text stays selectable, it scales to any screen, it is a fraction of a video's size, and the same file plays in BMM Docs, in Help & other, and on BCWEB |
| **`.mp4`** | Anything rrweb cannot capture | Native dialogs, the installer, the game launching, the OS file picker, a UPnP router page — none of that is in BMM's DOM |

> [!IMPORTANT]
> **Record from the recording fixture, unmasked.** This is the opposite of the rule for a bug
> report, and the reason matters: masking replaces every mod and profile name with `••••`, which is
> exactly right when you are sending a recording to someone, and useless in a tutorial clip where
> the whole point is seeing *which* mod you enabled. The fixture contains nothing of yours, so
> unmasking it leaks nothing.
>
> `node scripts/record-take.mjs --setup-fixture` creates it: a normal profile called **Recording
> demo**, pointing at throwaway folders in temp, holding four example mods. Two of them share a
> file on purpose (so the conflicts clip is possible) and one is packed wrong (so the mapper clip
> is). Scan it once in BMM afterwards. `--teardown-fixture` removes it.
>
> **Not the 🎓 tutorial sandbox** — that was the obvious choice and it does not work. It exists
> only while a tutorial is running, so the tutorial overlay would be in every frame, and the engine
> deletes it when the tutorial ends or at the next start.
>
> Two clips must stay **masked**, because masking is what they demonstrate: `bmm-demo.bmmreplay` on
> the privacy page, and any clip about the *Full* switch.
>
> Masking is applied at capture — an unmasked recording cannot be masked afterwards, and a masked
> one cannot be unmasked. Decide before you press record.

---

## Current state

Thirteen `.bmmreplay` files exist and **all thirteen are byte-identical** — one 25.3 MB
general-purpose recording copied under thirteen names (~330 MB of git-lfs for one clip). Every
feature page therefore shows the same footage regardless of what it is documenting.

The goal below is to replace them with focused clips. **Pointing several pages at one file is fine
and costs nothing extra** — what is not fine is thirteen copies of the same bytes.

> [!TIP]
> When a real clip replaces a placeholder, delete the old file in the same commit and check
> `git lfs ls-files` — a `.bmmreplay` committed before `.gitattributes` covered it goes in as a
> normal blob.

---

## A. `.bmmreplay` — in-app clips

Each row: the file, the page(s) that embed it, and what the clip must actually show. Aim for
**40–90 seconds**. Move deliberately; a replay plays back at real speed and hesitation reads as
confusion.

### Priority 1 — the pages a new user hits first

| File | Pages | What to show |
|---|---|---|
| `profiles.bmmreplay` | `features/profiles`, `how-it-works/profiles-activation` | Create a profile (the three folders), then **switch profiles and show that nothing in the game folder changed** — this is the single most misunderstood behaviour in BMM. Then enable a mod so the contrast is visible |
| `library.bmmreplay` | `features/library` | Import a mod, enable it, show the file count and the integrity badge. Then enable a second mod that **conflicts**, and open the conflict view |
| `mapper.bmmreplay` | `features/mapper`, `how-it-works/mapper` | A badly packed archive (one folder too deep). Run the **Structure Diagnostic**, select the mod root, drop it into the right game folder, show the **virtual tree updating without anything moving yet**, then Save |
| `settings.bmmreplay` | `features/settings` | A tour: theme switch, language switch, the storage card, the shortcuts list. Keep it as an orientation clip, not a deep dive |

### Priority 2 — the features that sell the app

| File | Pages | What to show |
|---|---|---|
| `modpacks.bmmreplay` | `features/modpacks` | Build a modpack from a profile's active mods, disable everything, then apply the pack and watch the list come back |
| `repo.bmmreplay` | `features/repo`, `how-it-works/sync-repos` | Connect to a repo, sync, and — the point of the clip — **re-sync after a small change** so the transfer is a few MB, not the whole collection |
| `scheduler.bmmreplay` | `features/scheduler`, `reference/actions` | Build a task with a **condition and a branch**: benchmark a disk, and if it is below a threshold, show a notification. This is what separates the scheduler from a cron job |
| `storage.bmmreplay` | `features/storage` | **Currently missing** — the page temporarily points at `bmm-demo`. Show Smart I/O, run Auto-Calibration, apply a per-disk MB/s cap, and show free space per profile |
| `themes.bmmreplay` | `features/themes` | Apply two built-in themes, then open the theme editor and change one token so the live re-render is visible |

### Priority 3 — the rest

| File | Pages | What to show |
|---|---|---|
| `plugins.bmmreplay` | `features/plugins` | Install a plugin, grant it a permission, run a quick API test, then show the API log reacting to it |
| `apps.bmmreplay` | `features/apps` | Browse the catalog, install an app, launch it. Include the **checksum prompt** if you can trigger one — it is the interesting part |
| `community.bmmreplay` | `features/community` | Browse BetterCommunity, use a one-click install link, and show the confirmation dialog BMM raises |
| `modlist.bmmreplay` | `features/modlist` | Export a `.mmlist`, wipe a profile, import it back |
| `bmm-demo.bmmreplay` | `features/privacy-telemetry`, `reference/tips` | The general tour. **Keep this one masked and keep it generic** — it is the clip used to demonstrate what masking looks like, so `••••` needs to be visible on screen |

### Optional, but they document things nothing else does

| File | Where | What to show |
|---|---|---|
| `conflicts.bmmreplay` | `how-it-works/conflicts` | Two mods sharing a file. Enable A, enable B, show B won. Disable B, show A's file **coming back** — the three-way restore is impossible to convey in prose |
| `integrity.bmmreplay` | `how-it-works/integrity-hashing` | Run a check (passes), edit a file in the mod folder outside BMM, re-run, and show `modified` plus the persistent warning badge |

---

## B. `.mp4` — what rrweb cannot capture

rrweb records BMM's DOM. Anything drawn by Windows or by another program is **invisible** to it —
a replay of those moments shows a frozen BMM window and nothing else.

| Clip | Length | What to show |
|---|---|---|
| `install-windows.mp4` | ~60 s | Download → the SmartScreen prompt and how to get past it → install → first launch. The SmartScreen step is the one people get stuck on |
| `first-profile.mp4` | ~90 s | The whole first-run path including the **native folder pickers**, which a replay cannot show. Ends with a mod enabled and the game launched |
| `game-launch.mp4` | ~20 s | A launch pack starting the game plus its companion tools — the point is the apps appearing, which happens outside BMM |
| `repo-host.mp4` | ~90 s | Generate a standalone server, run it on a second machine, and connect a client. Involves a terminal and possibly a router page |
| `crash-report.mp4` | ~45 s | Trigger a crash, show the report, and the attached session replay. The report window and the file dialogs are native |

> [!NOTE]
> Record at **1920×1080**, keep BMM at its default window size, and use the default dark theme
> unless the clip is about theming. Mute system sounds. No cursor trails or click-highlight overlays
> — they date the footage badly.

---

## C. The harness — `scripts/record-take.mjs`

Arranging identical state before every take is the tedious half of this, and it is the half that
makes people not re-record. So it is scripted:

```bash
node scripts/record-take.mjs --setup-fixture    # once — creates the profile clips record against
node scripts/record-take.mjs --list
node scripts/record-take.mjs conflicts            # set state → arm recorder → wait → export
node scripts/record-take.mjs conflicts --dry-run  # print the plan, change nothing
node scripts/record-take.mjs themes --no-record   # just set the state up
```

It activates the right profile, clears the mods, fires any deeplink the clip needs, turns the
recorder on with the correct masking for that clip, then **stops and prints what you have to
perform**. Press Enter when you are done and it exports and turns the recorder off.

### Which clips can run unattended

BMM's recorder sets **`mousemove: false`** — pointer positions are never captured, as a size
optimisation. So **no BMM replay has a moving cursor, not even one filmed by hand.** What a human
take carries that an API-driven one cannot is narrower than it sounds: **click markers** (rrweb
keeps `mouseInteraction`), scroll, and typing. DOM changes are recorded either way, whatever caused
them.

That splits the list cleanly:

| | |
|---|---|
| **Unattended works** | The clip's content is a *result* — a sync transferring, a benchmark running, a scheduled task firing, a mod list filling in. Nothing was clicked, so no click marker is missing |
| **Needs a human** | A click-through tutorial. The click markers are the "here is where I pressed" affordance, and nothing else supplies them |

A scenario with a `drive` list runs end to end:

```bash
node scripts/record-take.mjs activation-auto --auto
```

`--auto` on a clip with no `drive` is refused, and so is running a `drive`-only clip without it.
Because driving enables and disables mods — which deploys and removes real files — combining
`--auto` with `--profile` needs `--allow-writes` as well. On the demo sandbox that is the point;
on your own profile it edits your game folder.

Practical notes:

- **BMM must be running.** If nothing answers, the harness says so and reminds you that a taken
  port disables the API for the whole session rather than moving to another one — restart BMM.
- The API token is read straight out of `data.json`; you never paste it, and it is never printed.
- Mod and profile names are fuzzy-matched, but an **ambiguous** name is an error listing the
  candidates rather than a guess — `HD Texture Pack` resolves, `HD` does not.
- Masking per scenario is already set the right way round (see the note at the top of this file);
  `privacy-masked` is the one that records masked on purpose.

Adding a clip is a block in the `SCENARIOS` map at the top of the file: the page it belongs to,
whether it is masked, the setup steps, and the `perform` lines you want printed back at you.

## D. Checklist per clip

- [ ] Recorded **masked** (unless the clip is about unmasking).
- [ ] Nothing personal on screen: real paths, account names, Discord handles, e-mail.
- [ ] Under 90 seconds, and it does **one** thing.
- [ ] Ends on a settled screen — not mid-animation, not on a toast that is about to vanish.
- [ ] `.bmmreplay`: plays back in the app (import it) **and** in the docs site before committing.
- [ ] `.bmmreplay`: committed through **git-lfs**; `git lfs ls-files` lists it.
- [ ] `.mp4`: H.264, no audio track unless it carries information.
- [ ] The page's caption no longer says "placeholder".
- [ ] `python -m mkdocs build --strict` still passes, and the CI replay guard is green.

---

## See also

- *Embedding replays & video* — the `:::replay` directive, the `bmm-replay` div, git-lfs setup.
- *Building BMM Docs — the site and the PDF* — the build, and the two silent failure modes the CI
  guards now catch.
