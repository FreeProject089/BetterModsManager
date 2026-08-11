# Settings

Settings is a long page, but most of it you set once and forget. This tour starts with the
handful that change how BMM *feels*, then walks the rest section by section so nothing is a
mystery.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/settings.bmmreplay" data-page="features/settings" data-title="A tour of Settings"></div>


## The four that matter most

### Themes & Appearance

> Customise every colour, font and element of BMM. Share themes in one click.

Not a light/dark toggle — a theme editor. You can replace BMM's built-in images (logo,
wallpaper, even the Tasky mascot), and *add your own buttons, banners, badges or widgets
anywhere in BMM*. Themes export as a file and import as one, and a catalog of themes works
like the [App Catalog](doc-page:features/apps). See [Themes](doc-page:features/themes) for the whole engine.

Start from one of the built-in presets and tweak. The editor's own advice: hover a label for
help, click **?** for the MDN docs on that CSS property.

### Storage & Smart I/O

The setting to know if BMM ever makes your PC feel sluggish while activating mods:

> Limit the read/write speed on your disks during mod activation to prevent system lag.
> (0 = unlimited)

**Auto-Calibration** benchmarks your drives and sets an I/O limit for each. It is **on by
default and runs itself** — a couple of seconds after BMM starts, and again the moment you
switch it back on. There is no button to press.

It only measures the disks your profiles actually use, and sets a per-disk limit, so a fast
NVMe and a slow external drive get their own ceilings. It's the difference between "mods
activate in the background" and "my machine froze for thirty seconds".

### Updates

Check for a new BMM version, opt into **pre-releases**, or turn **auto-update** off.
Pre-releases get fixes first and bugs first — the toggle is there so it's your call, not a
surprise. A separate control checks your *mods* for updates (see [Server Repo](doc-page:features/repo)),
distinct from updating the app itself.

### Data

Export everything, import it back. Use export before anything you're not sure about — it's the
cheapest insurance in the app.

!!! danger "Factory reset"

    The Debug section can wipe BMM back to zero. It asks first. There is no undo — export your
    data before you go near it.

## Everything else, section by section

### Language

Switch BMM's interface language. Languages are plain JSON files in the app's `Lang/` folder —
adding one requires **no rebuild**. The card gives you everything: a **Guide**, a downloadable
**template**, an **Import** button, and the **Translation Sandbox**.

The comfortable way to translate is the **Sandbox**:

- **Create new language** — give it a code (`de`, `pt-br`…), optionally seeded from an
  existing language.
- Translate key by key with search, a **progress bar**, a "**next missing**" jump, and
  side-by-side reference from other languages.
- Preview any string **live** (toast / tooltip / swapped into the real UI), and **pick from
  screen**: click any text in BMM to jump straight to its key.
- Edits auto-save to the sandbox (never the live app); **Export** downloads the finished JSON —
  import it to make it live.

Keep the `_info` block (name + flag shown in the picker) and the `_synonyms` groups (they power
semantic search in your language). **French is the base**: an untranslated key falls back to
FR; a key missing everywhere shows its raw id. `en`, `fr` and the template can't be deleted.

### Identity & API

> All your important credentials in one place. Click the eye icon to reveal a value.

Your **creator ID**, the local **API token**, the API **URL and port**, and the app version.
The [local API](doc-page:reference/api) binds to `127.0.0.1` on port **51274** by default; you can
change the port here (it takes effect after a restart). This is also where you reveal or reset
the API token that plugins and scripts authenticate with.

### Privacy & Telemetry

Opt in or out of anonymous usage data, and manage the sub-options (session replays, full
capture, benchmark sharing) independently. Everything is off unless you turn it on, and the
page spells out exactly what each toggle sends.

### Security (plugin trust)

Choose how much freedom plugins get: **full access** or a **limited/sandboxed** mode. This is
the global backstop for the per-plugin permissions you grant in
[Plugins & API](doc-page:features/plugins) — tighten it if you run plugins you don't fully trust.

### Discord Rich Presence

Show what you're doing in BMM on your Discord profile, or turn it off. Purely cosmetic.

### Launch Packs

A Launch Pack is a **named list of executables that start together**. Give it a name, add the
`.exe` paths (a game, a voice-attack tool, a map app…), pick an icon, and one click — or one
[deeplink](doc-page:reference/api), or a [scheduled task](doc-page:features/scheduler) — fires all of them.

!!! tip "Build your 'sit down to play' routine"

    The point isn't launching apps; it's launching *your setup* in the right order without
    hunting for five shortcuts. Make one pack per game. Pair it with the [Scheduler](doc-page:features/scheduler)
    (a Launch Pack is a schedulable action) and "6pm: enable my multiplayer modpack, then start
    everything" becomes a single automation.

### Scheduling & automation

Save tasks — apply a modpack, run a launch pack, export your data — and trigger them on a
schedule or on demand. It goes well beyond a timer: conditions, loops, and "wait until" steps
let you build real workflows. See [Scheduler](doc-page:features/scheduler) for the full picture.

### Storage Manager & benchmark

Two related tools live here, both about how BMM moves files.

**Smart I/O limits** (above) pace mod activation so it doesn't hog your disk. The **Storage
Manager** is where you set the per-disk ceilings, and **SHA recalculation** rebuilds the
per-file hashes the [integrity](doc-page:features/library) check compares against — run it if you've edited a
mod's files outside BMM and want its hashes to match reality again.

The **benchmark** is the tool worth understanding. It doesn't run a generic disk speed test —
it runs BMM's **actual activation, deactivation and cancel operations** against a controlled
workspace and reports the real throughput. That's why **Auto-Calibration** uses it to set your
I/O limits: it measures the exact work mod activation does, on your exact hardware.

!!! tip "Sandbox vs real, and when to run it"

    Run the benchmark on the **sandbox** dataset (synthetic, safe, reproducible) to compare
    hardware or settings; run it on **real** (your active profile's mods) to see what a big
    activation actually costs *you*. Sizes go **S → XL**, or **Custom** for an exact dataset
    size. Run it once after a hardware change, let Auto-Calibration set your limits, and forget
    it.

### Tags

Manage your custom mod tags — the labels you filter the [Library](doc-page:features/library) by. Rename or
remove them here in one place.

### Sound & keyboard shortcuts

Toggle UI sounds, and review the keyboard shortcuts BMM responds to.

### Session recorder (local)

Records what happens on screen — your actions plus the JS and Rust logs — so a problem can be
replayed and analysed instead of described. **Nothing is sent anywhere:** the recording stays
on this machine and you export it yourself if you want to share it. Distinct from the
telemetry above, which is opt-in and goes to a server; this one produces a file and stops
there.

Sensitive fields are masked as they are captured, so the unmasked values never enter the
recording — see [Privacy & telemetry](doc-page:features/privacy-telemetry).

### Scanning & mod updates

How aggressively BMM rescans your mods folder and checks the repos your mods came from. Worth
a look if you have a very large library and want startup to do less work.

### GitHub token

An optional personal access token, used when BMM talks to GitHub (release checks, raw
downloads) to avoid the stricter anonymous rate limit. Optional — only add one if you hit rate
limits.

### Tutorial

Replay the interactive in-app tutorials at any time. New to BMM? Start here.

### Debug & developer tools

Diagnostics, crash-report tools, and the **factory reset** noted above. Handy when something's
wrong; the reset is the one control in the whole app with no undo, so it's fenced behind a
confirmation.
