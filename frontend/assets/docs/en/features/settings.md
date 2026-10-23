# Settings

Settings is a long page, but most of it you set once and forget. This tour starts with the
handful that change how BMM *feels*, then walks the rest section by section so nothing is a
mystery.



## Finding a setting

The top of the page is an **index** of every card, in seven groups: **Appearance**,
**Library**, **Automation**, **Performance**, **Accounts and services**, **Privacy and
security**, **Application** (anything else sits under **Other**). Click a name to jump to its
card.

**Search settings** (:kbd[Ctrl+F] while Settings is open) hides every card that does not match
what you type and says how many sections still do. Clear the box to see everything again.

**Hide the index** (the button beside the search) gives the cards the full width; the **Index**
button above the cards brings it back. BMM remembers the choice, and :kbd[Ctrl+F] brings the
index back to search. On a narrow window the index stays the strip above the cards.

Every card has the same anatomy: an icon on a quiet tile, the title and the card's actions,
**one sentence** under the title saying what the card is for, then the settings as **rows** (a
label and its control), a footer for the buttons that apply or export, and, when something cannot
be undone, a **danger zone** at the bottom. A small **Learn more** link on a card opens the page of
this documentation that explains it, at the right section.

The cards are ordered by what you reach for most, group by group:

| Group | Cards, in order |
|---|---|
| **Appearance** | Themes, Language, Interface and notifications, Graphics and display, Keyboard shortcuts |
| **Library** | Scanning and mod updates, Tags, Catalogue index, Integrity (SHA) |
| **Automation** | Launch Packs, Scheduling and automation |
| **Performance** | Storage, Benchmark |
| **Accounts and services** | Identity & API, GitHub token, Discord Rich Presence |
| **Privacy and security** | Privacy and telemetry, Optional AI, Security (plugin trust), Security |
| **Application** | Auto update, Data, Old installations, Feedback, Crash reports, Session recorder, Debug |

**Edit layout** (beside the search) lets you make the page yours: drag a card, or press
:kbd[Alt+Up] / :kbd[Alt+Down], to move it within its group, and use the eye to hide a card from the
page (search still finds it). **Done** leaves the mode; **Share layout** copies a code or a
`bmm://` link you can import on another PC, and **Reset** brings the default order back.

## Panels in their own window

The **theme editor**, the **Translation studio** and the **task debugger** can leave BMM's
window: press **Open in its own window** in their header, or drag the header past the edge of
BMM's window and let go. The panel becomes a window of its own that you can put anywhere, on
another screen too, beside what it works on instead of over it.

Everything keeps working from there and stays in step with BMM: the panel still runs in BMM, the
window shows it and sends your clicks and typing back. It follows the theme, light or dark.

- Each panel's window remembers its size and place.
- **Back into BMM's window** puts the panel back where it was; its close button closes the panel.
  Closing the window any other way (:kbd[Alt+F4], the taskbar) also puts the panel back.
- In that window, lists of choices open as the system's own list, and dragging things inside the
  panel (reordering, resizing) is done in BMM's window.

## The four that matter most

### Themes & Appearance

The explanation boxes across the app — the coloured callout tips — can be hidden app-wide
with **Show tips** in the Tasky tab of Interface and notifications, once you know your way around. Warnings are exempt by
design: hiding tips never hides anything load-bearing.

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

The **Auto Update** card: check for a new BMM version at start-up or not, pick the **update
channel** (**Stable** or **Pre-release**), and choose a **background check** while BMM stays
open (**Off**, **Every 6 h**, **Daily**). It shows when the last check ran. What happens when
a version is found, and how the installer is checked before it runs, is in
[Updating BMM](doc-page:getting-started/install#updating-bmm).

A separate control checks your *mods* for updates (see [Server Repo](doc-page:features/repo)), distinct from
updating the app itself.

### Data

Export everything, import it back. Use export before anything you're not sure about — it's the
cheapest insurance in the app.

Two shapes, and the difference matters:

| | |
|---|---|
| **`.DATABMM`** | A ZIP holding your settings and profiles **plus the files** — themes, launch packs, automations, session recordings, your navbar and every custom page. Signed, so a reader can tell it is still the archive BMM wrote. |
| **JSON** | Settings and profiles only. Smaller, diffable, and readable by every older BMM — which is why it is still offered. |

A JSON backup cannot carry files: inlining a 40&nbsp;MB recording turns it into a 55&nbsp;MB
base64 string inside a document nothing can stream. That is the whole reason `.DATABMM` exists.

Tick only the sections you want; each one reports what it **actually took**, so a section you
asked for that turned out empty is something you find out now rather than the day you need it.

!!! tip "Navigation is three places, and a backup needs all three"

    Your navbar layout, each custom page's source, and each page's permissions and stored data
    live separately. The **Navigation & custom pages** section takes all three. Two out of three
    restores something broken — buttons pointing at pages that are gone, or a page that lost the
    permissions it was written against and fails at the first thing it tries to do.

### Putting one back

**Restore a `.DATABMM`** opens the archive and shows you what is in it *before* it writes
anything: each section, its size, and whether the file is still the one BMM wrote. You tick
what you want back. Nothing is ticked for you — a restore dialog that arrives pre-armed is one
you can confirm without reading.

Two things behave differently from the rest, and both on purpose:

| | |
|---|---|
| **Profiles, mods & settings** | **Replaces** what you have; it is not merged into it. A merge would have to invent an answer for two profiles with the same name and different folders. Your current `data.json` is copied aside first, to a timestamped file, and the message names where. Each profile's activation order comes back with it. |
| **Crash reports & diagnostics** | Listed, and never restored. They describe what happened to one installation on one machine — putting last year's into this one gives you a support folder that lies about the app it sits in. |

An **unsigned** archive restores normally: everything written before signing existed is
unsigned. The one worth stopping for is *changed since it was signed*, which the screen says in
those words.

BMM reloads afterwards, because half the app reads its state at startup.

!!! note "It is still an ordinary ZIP"

    The extension says it belongs to BMM; the contents are a plain archive, deliberately, so
    you can always open it with anything and take out one file by hand.

!!! danger "Factory reset"

    The Debug section can wipe BMM back to zero. It asks first. There is no undo — export your
    data before you go near it.

## Everything else, section by section

### Language

Switch BMM's interface language. Languages are plain JSON files in the app's `Lang/` folder —
adding one requires **no rebuild**. The card gives you everything: a **Guide**, a downloadable
**template**, an **Import** button, and the **Translation studio**, which has [its own
page](doc-page:features/translation-studio): a floating window (that can also pop out) to translate key by key,
check variables, see your drafts live in the whole app, and import or export a language file.

Keep the `_info` block (name + flag shown in the picker) and the `_synonyms` groups (they power
semantic search in your language). **French is the base**: an untranslated key falls back to
FR; a key missing everywhere shows its raw id. `en`, `fr` and the template can't be deleted.

<a id="graphics"></a>
### Graphics & display
> How BMM's own window is drawn. It only concerns the interface, never your games or your mods.

BMM's interface is a web view (Microsoft WebView2), which draws with a graphics card like a browser
does. The card has a **Learn more** link and is reachable from the command palette
(*Graphics & display*).

| Choice | What BMM does | When to pick it |
|---|---|---|
| **Automatic** (the default) | Adds nothing: WebView2 and Windows choose. A choice made for WebView2 in Windows **Settings → Display → Graphics** still applies | Almost always |
| **Power saving** | Starts WebView2 with `--force_low_power_gpu` | A laptop with two graphics chips, to save battery and heat |
| **High performance** | Starts WebView2 with `--force_high_performance_gpu` | A PC with two graphics chips where the window's animations stutter |
| **Off** | Starts WebView2 with `--disable-gpu --disable-gpu-compositing`: the processor draws | Only when the window turns black, freezes or flickers because of a broken driver |

**Off** is the former *Hardware acceleration* switch: one control now, not two. A choice saved by
an older BMM keeps its meaning.

- The choice is read **before the window exists**, so it applies at the **next start**. The card
  says which choice this session started with, and offers **Restart BMM now** (after asking: a
  restart stops a deploy or an install in progress).
- On a PC with **one** graphics card, Power saving and High performance both use it; the card says
  how many cards it found.
- **Drawing the window right now** names the card that really draws BMM, read from the window
  itself (WebGL). If it says *the processor* although the PC has a card and the choice is not
  **Off**, WebView2 has fallen back to software drawing, usually because the driver is blocked or
  crashed: updating the graphics driver fixes it in most cases.
- **Reduce animations** ends transitions and effects at once, whatever the theme (a theme can also
  do it with `--bmm-anim-speed: 0`; either one is enough). Progress spinners keep turning, slowly.
  It applies immediately. Windows' own *show fewer animations* setting is honoured too.
- **Start-up animation** (Classic with Tasky, Logo, or Off) is shown while BMM starts; a click or any key
  skips it. It follows **only** BMM's own **Reduce animations** switch and the **Off** style, not
  Windows' *Animation effects* setting, and a fast start plays the whole entrance instead of cutting
  it short.
- Folded underneath: the hardware BMM detected (processor instructions, graphics cards, each
  disk's bus).
- If you set the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable yourself, BMM leaves
  it and all its arguments alone, and the choice is greyed out.
- The file behind it is `boot-flags.json` in BMM's app-data folder. It holds a switch and one of
  three words; nothing in it is ever pasted into the arguments, and a damaged file means Automatic.

### Identity & API

Found in **Accounts and services**, not under Automation.

> All your important credentials in one place. Click the eye icon to reveal a value.

Your **creator ID**, the local **API token**, the API **URL and port**, and the app version.
The [local API](doc-page:reference/api) binds to `127.0.0.1` on port **51274** by default; you can
change the port here (it takes effect after a restart). This is also where you reveal or reset
the API token that plugins and scripts authenticate with.

### Privacy & Telemetry

Opt in or out of anonymous usage data, and manage the sub-options (session replays, full
capture, benchmark sharing) independently. Everything is off unless you turn it on, and the
page spells out exactly what each toggle sends.

**My consents** lists every answer you gave about the Terms, the Privacy Policy and telemetry,
with a proof for each: see [Privacy](doc-page:features/privacy-telemetry#proof-of-consent-my-consents).

### Security (plugin trust)

Choose how much freedom plugins get: **full access** or a **limited/sandboxed** mode. This is
the global backstop for the per-plugin permissions you grant in
[Plugins & API](doc-page:features/plugins) — tighten it if you run plugins you don't fully trust.

The card names the mode **in force** in its header (a green pill for full access, an accent one
for limited), and the two rows below are the choice: the active one carries the accent rail and
a lit icon. Picking the other row only enables **Apply** — nothing changes until you press it,
and the pill updates when it has.

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

Manage your custom mod tags — the labels you filter the [Library](doc-page:features/library) by. Create,
edit and remove them here in one place.

A tag is more than a coloured word:

| | |
|---|---|
| **Icon** | Pick from 2000+ [Lucide](https://lucide.dev) glyphs, 3400+ brand icons, or upload your own small image. The same picker serves profile icons and plugin creation. |
| **Gradient** | Tick *gradient* to give the tag a second colour — the chip fades from one to the other instead of a flat tint. |
| **Edit** | The pencil on a chip loads it back into the form; the button becomes *Save*, and *Cancel* backs out without touching it. |

The icon travels with the tag: because it is stored as a plain reference, a tag keeps its
glyph through every share path — an exported profile, a [server repo](doc-page:features/repo), a catalog —
with nothing extra to do.

### Interface and notifications

One card with four tabs: **Notifications** (below), **Tasky** (the mascot and the explanation
tips), **Sound** (UI sounds and their volume) and **Toolbar** (the buttons of the Library
toolbar). Each tab shows its everyday rows first; **More options** unfolds the rest and **Fewer
options** folds them back.

### Notifications

Everything BMM tells you lands in **one notification centre** (the bell), with one unread count,
also shown on the taskbar icon. Messages are grouped by where they come from:

| Group | What it holds |
|---|---|
| **Updates** | New BMM versions, update checks |
| **Followed repos** | Repos you follow: new mods, downloads |
| **Scheduler** | Your automations and their results |
| **Background jobs** | Long jobs (15 seconds or more) that finish while BMM is in the background |
| **BetterCommunity** | Messages from your BetterCommunity account |
| **BMM** | Everything else BMM tells you |

**How each kind of notification reaches you** sets each group to **In the app**, **In the app
and as a system notification** (the system one only when BMM is in the background), or **Off
(kept in the list)**. The old per-source switches carry over. **Send a test notification**
shows what a popup looks like.

**Do not disturb**, from the bell or here, pauses popups until you switch it off. **Quiet hours
every day** (From … to …) does the same on a schedule. While quiet, nothing pops up and no system
notification is sent. **Errors still show in the app, and everything stays in the notification
centre**: an error nobody is shown and nobody thinks to look for is an app that failed quietly.

In the centre, each message can be **opened** (when it leads somewhere, for example an available
update or a followed repo), **snoozed** (1 hour, 4 hours, tomorrow 9:00) or dismissed. A snoozed
message comes back unread when its time comes, or at once with **Show it again now**. The same
event twice is one popup and one entry with a count, not a stack of copies; an update found again
by a later check refreshes its entry. The list keeps the last 200 messages and nothing older than
30 days.

Keyboard in the centre: :kbd[Up] and :kbd[Down] move between messages, :kbd[Enter] opens,
:kbd[Delete] dismisses, :kbd[S] snoozes for an hour, :kbd[Escape] closes and returns to the bell.

### Sound

Toggle UI sounds. The volume is a row of the same table: the slider fills up to its level, and
the figure on the right is the value that gets saved (it applies as you drag, no Save button).

### Keyboard shortcuts

A searchable table of every shortcut, where you can rebind a command or add your own shortcut for
a Settings card, a profile, a modpack or an automation. Everything about it is in [Command palette
& shortcuts](doc-page:features/command-palette#keyboard-shortcuts).

### Navigation & custom pages

**Customize navigation** (the pencil at the bottom of the sidebar) rearranges the sidebar and adds your
own buttons and pages. It has [its own page](doc-page:features/navigation). The whole layout travels as a
`bmm://` code or a bundle — see the backup note above: the layout, each page's source and its
permissions are three separate things.

Importing a `.bmmnav` someone shared creates its pages with **no permission**: a review lists
what each page asks for, nothing ticked, and only what you tick is granted — see
[Security model](doc-page:how-it-works/security#custom-pages-review).

### Session recorder (local)

Found in **Application**, beside the crash reports.

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

Replay the interactive in-app tutorials at any time. New to BMM? Start here. The tutorial guide can
**pop out into its own window**, so you can keep it beside BMM while you follow the steps. Every
tutorial was rewritten for 1.0.4, and there are new parts: following a repo, conflicts and
activation order, notifications, creating a plugin, and BMM Tools. The Automations tutorial now
lives in Plugins & API.

### Debug & developer tools

Diagnostics, crash-report tools, and the **factory reset** noted above. Handy when something's
wrong; the reset is the one control in the whole app with no undo, so it's fenced behind a
confirmation. The developer tools also hold the [BMM Tools](doc-page:features/tools) and the
[Replay and Animation studios](doc-page:features/tools#replay-studio-and-animation-studio).
