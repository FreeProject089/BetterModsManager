# Scheduling & automation


> Schedule BMM actions (one-time or recurring) — activate a mod, modpack, profile… with
> conditions (if/else), your own scripts and external programs. Tasks run while BMM is open.

Reachable from [Plugins & API](doc-page:features/plugins). This is the part of BMM that does things without
you driving it.

!!! warning "By default, BMM has to be running"

    The scheduler is a timer **inside the app**: it checks for due tasks every 20 seconds
    while the window is alive. Nothing fires while BMM is closed — a one-off whose time
    passes meanwhile runs the next time you open it, not at the moment you asked for.

    On Windows you can lift that. BMM registers a **Windows Scheduled Task** that launches
    `BMM.exe "bmm://schedule/run?id=…&k=…"` at the right time; BMM handles the `bmm://`
    scheme, so Windows starts it and the deep-link router runs that one task. The app opens
    — this wakes BMM up rather than running behind its back.

    `k=` is a key minted on your machine. The same link, without it, asks before running
    anything: a `bmm://` link can be written by any page you click, and task ids are
    timestamps, so they are guessable. The registered task is the one caller that can prove
    it is not a page.

![The scheduler](assets/docs/media/screens/scheduler.annotated.png)

| | | |
|---|---|---|
| **1** | **Trigger** | *When* it runs. |
| **2** | **Rules** | *Whether* it runs, and what it does. |
| **3** | **New task** | One task, one job. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/scheduler.bmmreplay" data-page="features/scheduler" data-title="Building a scheduled task"></div>


## A task has three parts

**Trigger → rules → action.** The trigger asks *when*, the rules ask *whether*, the action is
*what*.

### 1. Trigger — when

| Type | Runs |
|---|---|
| `once` | One time, at a date and time. |
| `interval` | Every N minutes. |
| `hourly` | Every N hours. |
| `dailyAt` | Every day at `HH:MM`. |
| `weeklyAt` | At a time, on the weekdays you pick. |
| `monthlyAt` | On a day-of-month (1–31) at a time. |
| `appStart` | Once per BMM launch (a few seconds after start). |
| `watchFile` | A file changed. |
| `manual` | Never on its own — only the ▶ **Run now** button or `bmm://schedule/run`. |

!!! warning "Time triggers only fire while BMM is awake"

    `dailyAt` / `weeklyAt` / `monthlyAt` are checked by BMM's own loop, which wakes about every 20
    seconds. If BMM is **closed** at that exact minute the run is missed and **not** backfilled.
    That's what *Run even when BMM is closed* (below) is for.

### 2. Rules — whether

A rule is `IF <condition> THEN <action>`, and this is where the scheduler stops being a
timer and starts being useful. Conditions:

| Condition | True when |
|---|---|
| `Always` | Unconditionally. |
| `Profile is active` | A given [profile](doc-page:features/profiles) is the current one. |
| `Mod is enabled` / `Mod is disabled` | A given mod's state. |
| `Modpack is active` | A [modpack](doc-page:features/modpacks) is applied. |
| `All active-profile mods are on` | Nothing in the profile is off. |
| `App is running` | A process is up — e.g. the game itself. |
| `Day of week` | Monday…Sunday. |
| `Time is within` | A time range. |
| `Value compare` | `if X > Y` — a numeric comparison. |
| `Command succeeds` | An external command exits 0. |

!!! warning "First match wins"

    From the scheduler's own empty state: *No rules — add one. **First matching row wins**
    (top to bottom).*

    Order your rules **most specific first**, exactly like firewall rules. A rule with
    `Always` at the top makes every rule below it dead code — and nothing will tell you,
    because as far as the scheduler is concerned it did its job.

### 3. Action — what

There are ~60 actions across eight groups:

| Group | A few of the actions |
|---|---|
| **Mods & profiles** | Activate a profile · enable/disable a mod · enable/disable a modpack · create a modpack · add a mod from a URL · export/import a mod list · enable/disable all · scan the folder · check mod updates |
| **Repo & sharing** | Connect · sync · generate · update · host a repo |
| **Apps & launch** | Launch an app · install an app · open a file/folder · **run a [Launch Pack](doc-page:features/launch-packs)** |
| **Appearance** | Set a theme |
| **Benchmarks & storage** | Run an app benchmark · **benchmark a disk** · **apply a disk speed limit** · toggle **Smart I/O** / **Auto-Calibration** · **check free disk space** (see [Storage](doc-page:features/storage)) |
| **Privacy & recorder** | Telemetry consent · session recorder · export/import a replay |
| **System & flow** | Show a notification · Discord RPC · export a data backup · set a variable · **run another scheduled task** · restart BMM · open a URL · **run an external program** · **run a script you wrote** · run a raw `bmm://` deeplink |
| **Logic & math** | Compute maths into a variable · ternary · decision table · a stop-task guard |

Many actions run by firing a canonical `bmm://` deeplink through the app's own handler — the same
plumbing the [Plugins & API](doc-page:features/plugins) page exposes, which is why the two systems can drive each
other.

## Running when BMM is closed

> Run even when BMM is closed.

This registers the task with **your operating system's scheduler**, not BMM's own loop. The
OS wakes it up on time whether or not the app is running — which is the whole point for
"prepare my modpack at 6am".

It also means the task lives outside BMM. Deleting it in BMM removes the OS task too; if you
go poking in your OS's task list, that's what those entries are.

## Running your own code

Two steps reach outside BMM. **Run external program** launches something with arguments.
**Run a script** takes code you write — PowerShell, CMD, Bash or Python — straight in the
task.

The script is saved to a temporary file and the interpreter is handed *the file*. Nothing you
type is ever placed on a command line, so there is no quoting to get right and a stray quote
can't change what runs. Inside a **For each**, `{item.name}` and `{item.id}` are substituted
before the script starts, so one script can act on every mod in turn.

Under *Advanced*, name a variable. The script's first output line becomes its value, and later
steps can test it:

```powershell
# counts .dll files; a later IF can branch on {dlls}
(Get-ChildItem -Recurse -Filter *.dll | Measure-Object).Count
```

Without that, a script could only report success or failure — "if the script says yes, then…"
had no way to be expressed.

## Permissions

Each task grants four things separately, and each says what it unlocks:

| Grant | What it allows |
|---|---|
| **Run external programs** | Launch a program with arguments |
| **Run scripts** | Run PowerShell / CMD / Bash / Python you wrote |
| **Fire deeplinks** | Trigger `bmm://` links |
| **Stop a program** | Terminate a running process |

All four are off until you turn them on, and a step whose permission is missing fails with a
message naming the one to grant — it never runs quietly.

Stopping a program is separate from launching one because the risk differs in kind: starting
something is undoable, killing something can lose unsaved work with nothing to undo.

!!! warning "Deeplinks are the widest of the four"

    A `bmm://` link reaches anything the app exposes, including actions that have no scheduler
    step of their own. It used to be gated by nothing at all.

!!! note "Upgrading from the old single checkbox"

    A task you built before the split keeps everything it already had — but none gains **Run
    scripts** or **Stop a program**. Neither capability existed when you ticked *Allow custom
    commands*, so granting them now would be inventing your consent rather than honouring it.

!!! danger "A task that arrives in a FILE gets none of them"

    Importing a `.bmmpa`, or adding a shared `.bmmscript` to your tasks, removes all four
    grants and leaves the task **disabled** — then tells you what the file had asked for.

    The automation is intact and one toggle away from working. What it cannot do is arrive
    already holding permission to run programs on a timer, which is what used to happen: only
    *Run even when BMM is closed* was cleared, and everything else came through as the author
    had set it.

## Example

The scheduler ships one, and it's a good shape to copy:

> Every hour, loop 3× and show a notification each time.

Start there, swap the notification for a real action, and add a condition so it only fires
when it should.

## Conditions — *whether*

A task can carry conditions so it only acts when the state is right. Each condition can be
**negated** ("*not* online"), and they're used two ways: to gate an action (`if`), or to hold
until something becomes true (`waitFor`, below).

| Condition | True when |
|---|---|
| `always` | Always — the default, no gate. |
| `profileActive` | A specific profile is the active one. |
| `modEnabled` · `modDisabled` | A specific mod is on / off. |
| `modpackActive` · `modpackInactive` | Every mod in a modpack is on / off. |
| `allModsActive` | Every mod in the active profile is on. |
| `appRunning` · `appNotRunning` | A process (by name) is / isn't running. |
| `online` | The machine has an internet connection. |
| `textIs` | A text variable is / is not / contains / matches / is empty. |
| `fileContains` | The last N KB of a file contain some text or match a pattern. |
| `dayOfWeek` | Today is one of the days you picked. |
| `timeRange` · `timeReached` | The clock is inside a range / has passed a time. |
| `fileExists` · `fileHash` · `fileSize` · `fileType` | File checks — a path exists, or its hash (blake3/sha256), size or type matches. |
| `commandSucceeds` | An external command runs and exits `0`. |
| `value` | A captured number compares against a threshold (below). |
| `all` · `any` | Every / at least one of the conditions inside it holds (below). |

### Groups — `all` and `any`

`all` and `any` hold a **list of other conditions**, so a gate can ask more than one question
without a staircase of nested ifs. "When the game is closed **and** it is after 18:00 **and**
a backup exists" is one `all`; swap in an `any` for an *or*. They are conditions themselves,
so they nest, and `negate` — which every condition already had — gives you *not*.

Two behaviours worth knowing, because they are what you would get wrong:

- A group **stops at the first answer that decides it**. `all` stops at the first false,
  `any` at the first true — so the conditions after it never run. That matters because a
  condition can run a command or reach the network: put the cheap check first.
- An **empty `all` is true**; an empty `any` is false. Adding a group and not filling it in
  yet does not block the task you are in the middle of writing.

### The `value` condition

`value` compares a number BMM captured earlier in the run — for example a disk's measured
write speed (`disk.write_mbps`) or a benchmark result (`benchmark.mbps`) — against a threshold
you set, using one of six operators:

`>` · `<` · `>=` · `<=` · `==` · `!=`

So "*if `disk.write_mbps` `<` 50, show a warning*" becomes a real rule. If the source value was
never captured, the condition is simply false — it won't fire on missing data.

## Loops & waiting

Beyond a flat list of actions, a task can branch and repeat:

| Block | What it does |
|---|---|
| **`if`** | Runs one set of steps when a condition holds, another (`else`) when it doesn't. |
| **`repeat`** | Runs its steps repeatedly — `while` a condition holds, `until` one does, or a fixed number of `times`. `everySec` sets the gap between iterations, and **`maxIters` is a hard safety cap** so a `while`/`until` loop can never run forever. |
| **`waitFor`** | Pauses until a condition becomes true, polling every `pollSec`, up to `timeoutSec`. On timeout it either **aborts** the task or **continues** anyway — your choice. |
| **`forEach`** | Runs its steps once **per item of a live collection** — enabled mods, disabled mods, all mods, profiles, modpacks or themes, fetched at run time. Inside the body, `{item.id}` / `{item.name}` (any field of the item) are substituted into every action parameter. Same `maxIters` cap and per-lap pause as `repeat`. |
| **`switch`** | Ordered cases, each with its own condition — the **first** that matches runs, else the `default` branch. Cleaner than a ladder of nested `if`s. |

`repeat` also has a **`do… while`** mode: the body runs FIRST, then the condition decides
another lap — the post-check loop, for "try once, keep going while it works".

The bundled example is a `repeat` in `times` mode (loop 3×). Swap the mode to `while`/`until`
and give it a `value` or `appRunning` condition, and you have automations like "*keep checking
until the game process exits, then export my data*".

## Everyday controls

Each task row carries: an **enable/disable** toggle, ▶ **Run now** (fires immediately, ignoring the
trigger), **Duplicate** (a copy is created **disabled** so it can't double-fire), **Edit** and
**Delete**. Inside the builder, **Test run** executes the current *unsaved* draft once, and the side
panel shows the last runs (time · OK/ERR · duration). While editing, :kbd[Ctrl+Z] / :kbd[Ctrl+Y]
undo and redo, and any single step has its own *run just this step* button.

## Starting from a preset

A new task opens with a **preset picker** and a **From a catalogue…** button.

Picking a preset **replaces the draft**, so the picker only appears on a blank new task —
choosing one by mistake then costs nothing, because there was nothing to lose. The
description appears under the picker as you select, before anything is applied.

| Preset | What it builds |
|---|---|
| Weekly backup | Exports your BMM data every Monday morning and says so |
| Tell me about updates | Checks daily, and notifies **only** when there is something |
| Warn me before the disk fills | Twice a day; silent above the threshold |
| Rescan mods when BMM opens | Picks up changes made outside BMM |
| Tidy up after the game closes | Housekeeping once you stop playing |
| Stop early if the disk is nearly full | A **guard** for the top of another task — stops *cleanly* under 10 GB |
| Rescan the library every morning | The same rescan, on a clock instead of on startup |
| Tell me when a server stops answering | Calls an address every 30 minutes; speaks up only on a non-200 |
| Share a value with your other tasks | Writes one shared variable as a starting point |

None of them arrives with a permission already granted. A preset that asked to run scripts
before you had read it would train you to grant that without looking, which is the opposite
of what splitting the permissions is for — the two that touch other programs say so in their
description and leave the box unticked.

## Automations other people published

**From a catalogue…** stays available while you edit, because it only ever opens a
**read-only report** — it never imports anything.

The window lists your sources down the left, each stating its own outcome. A catalogue that
is unreachable says so on its own row: an empty result with the reason folded away reads as
"you follow nothing", which is a different and discouraging thing from "the server is down".

The official feed comes from BMM's link registry, so it can be pointed at a different host —
a staging server or a tunnel — without shipping a new BMM. Community catalogues are followed
by pasting an address into the same panel. Everything a catalogue offers goes through
**Inspect** first: you see the trigger, the permissions it wants, everything it reaches
outside BMM, and the full text of every script and command it carries, before deciding.

## Share a set of tasks — `.BMMPA`

**Export .BMMPA** writes your whole task set to a JSON file; **Import .BMMPA** loads someone
else's. Each task row also has its **own** export, which writes just that one.

Exporting a single task matters more than it sounds: sharing one automation used to mean
exporting all of them and deleting the rest by hand in a text editor, which is how a private
path or an API token sitting in an unrelated task ends up in a file you meant to share. Both
buttons write the same shape — one task is a list of one — so anything that reads a .bmmpa
reads either.

!!! warning "A shared variable travels with the file"

    Values written with scope **Shared** are stored in plain text and are carried inside an
    exported .bmmpa. If one holds an API token, that token goes to whoever you send the file
    to. Check before you share.

!!! note "Imports never fire on their own"

    An imported task gets a fresh id, arrives **disabled**, has all four permission grants
    removed, and never registers an OS-level scheduled task. BMM then says what the file had
    asked for, so you can grant what you actually want rather than working out why an imported
    task does nothing. **Load example** drops in a ready-made (disabled) task you can dissect.

## Publish a catalogue of your own

**Files… → My catalogues…** is the same screen every other kind of catalogue uses: browse what
you follow, follow another one by address or by file, or make your own.

**Create one** picks your automations and writes **one file**, and you choose which of two. A
`.bmmbundle` holds the `catalog.json` and every automation packed into it — one thing to send
somebody, nothing to host, no address to keep alive. A `catalog.json` holds addresses only,
for automations already hosted somewhere.

Inside either, each automation is **packed** into the catalogue or **linked** to an address
you give, chosen per entry — so one catalogue can carry the small ones and point at the large
one somebody already hosts. Only what the catalogue names is packed, and you choose where the
file is saved.

The addresses it writes are **relative** (`nightly.bmmpa`, not a full URL). A catalogue that
names its own host stops working the moment it is moved, mirrored or forked — which is the
normal life of a folder on GitHub — so BMM resolves them against wherever it fetched the
catalogue from. An absolute base is offered for files that genuinely live somewhere else.

Everything an automation calls travels with it: sub-tasks, shared blocks, launch packs and
plugins. Two automations with the same name get different filenames, so one entry can never
quietly serve another's contents.


## Carrying values around

A task can keep values as it runs, and read them back by name with `{braces}`.

**Variables** hold one thing each. A step that captures output gives you both the text and, when
it looks like one, the number. `Set variable` writes one yourself, and its **scope** decides how
long it lives: *this run only*, or **shared** — kept between runs and visible to every task. The
sidebar lists every shared variable with its value, so you can see what is already taken before
you pick a name.

!!! note "Shared variables work in arithmetic too"
    They used to be invisible to it: `count + 1` on a shared counter read 0 and evaluated to 1
    on every run, while the same name substituted correctly into a message two lines above.

**Lists** hold several — the profiles you touched, the URLs a feed returned. `List — set it`
takes a JSON array or a plain `a, b, c` line; `add one item` appends. Read the size with
`{list.<name>.length}`, and walk one with **For each**, whose source picker offers your own
lists as well as the app's collections.

**Maps** answer *what goes with what* rather than *which ones* — the id a name belongs to, the
URL behind a label. `Map — set a key`, `read a key into a variable`, `empty it`. **For each** can
walk a map's keys.

!!! warning "A missing key is not an empty value"
    `map.get` on a key that is not there stores an empty value and sets `map.hit` to 0. Test
    `map.hit` when the difference matters — otherwise "not there" and "there and blank" look
    identical.

## Enums, and a Switch that tells you what you missed

Declare an **enum** in the sidebar — a name and its values, like `ok, failed, skipped`. A
condition can then test *variable is member X of enum E*, which is what gives a branch a subject
rather than a free-text comparison.

Once every case of a **Switch** tests the same enum, the block lists the members you have not
handled. The note is advisory: handling three of five on purpose and letting DEFAULT catch the
rest is a legitimate thing to write, so it never blocks a save.

## Reusable blocks

Steps written once and run from anywhere. Build them in a task, name them in the sidebar with
**Save these steps**, then drop **Run a block** wherever you need them.

A block runs **with the calling task's permissions**, never its own. That is deliberate: a
block is written once and called from many places, so permissions attached to it would be
granted in one place and spent in another — and importing a block would become a way to run
actions the calling task was refused.

!!! warning "Two refusals you will meet"
    Deleting a block a task still calls is refused, and a `Run a block` pointing at a name that
    no longer exists **stops the task** rather than skipping quietly. A call that silently does
    nothing is a task reporting success while half of it never ran. Blocks calling each other are
    capped at 20 levels deep.


## Reacting to a game

BMM cannot see you join a server. Nothing about a running game is visible to another process
except what that game **writes** — so that is what this is built on, and it is three pieces
plus one file for DCS.

### `watchFile` — something changed

Point it at a file. The task runs when that file's modified time or size changes.

!!! note "The first check after BMM starts never fires"

    It records the file and stops there. Without that, every watch task would run once at
    every launch, and a change made while BMM was closed would act on a session that ended
    hours ago.

    A file that does not exist is not a change either. A game that has never run has no log,
    and firing on its later appearance is right — firing on its absence now is not.

### `text.extract` — pull a value out

Runs a pattern over the **last few KB** of a file (a game log is appended to all session; what
just happened is at the end of it) or over a variable, and keeps what group 1 matched.

**The last match wins.** In a log the most recent line describes now; the first describes
whatever happened at startup.

The name you give it is yours — `server`, `mission`, anything — and the next steps read it
back as `{text.server}`. If the value happens to be a number it is also available to numeric
conditions, so you do not need a second action to convert it.

### `modlist.apply` — put the right mods on

Installs anything the list names that is not here, then turns exactly those on.

!!! warning "`exact` is the one with teeth"

    Off, the list is **added** to what is already active — which is what you want when you run
    two lists for two aircraft.

    On, the active set **becomes** the list and nothing else. That is what a strict server
    means by a mod list, and one extra mod is the same rejection as a missing one.

A locked list with no passphrase in the action **fails** rather than prompting. A scheduled
task cannot answer a dialog at four in the morning, and one nobody sees is a task that hangs
looking like it is working.

Mods it could not get are reported **by name**. "Applied" with three mods silently absent is
the report that gets somebody kicked at the loading screen without knowing why.

### DCS gets a real hook

DCS has a supported callback API, so it is **asked** rather than guessed at from a log.
**Set up DCS** (on the `watchFile` trigger, or the `game.watch` action) writes a small Lua file
to `Saved Games/DCS/Scripts/Hooks/bmm-serverwatch.lua`. It reports which multiplayer server
you are on, to a file BMM watches. It reads nothing else and sends nothing anywhere.

It goes into **every** DCS folder found — there are usually two, release and open beta —
because flying in the one you did not set up looks exactly like the feature not working.

!!! note "Why every call in it is wrapped"

    A GUI hook that raises is dropped by DCS for the rest of the session. One missing function
    in one build would silently stop the reporting rather than logging anything anybody sees,
    so every call inside it is inside a `pcall`.

### Two presets

**Starting from a preset** carries both:

- **DCS: the right mods for the server you joined** — sets up the hook, reads the server out
  of what it writes, applies the list.
- **Any game: mods for the server in the log** — the same shape, reading a log instead. The
  only thing that changes between games is the pattern.

Both arrive with the file path and the mod list **blank**. A preset that guessed would be a
task that looks configured, runs, finds nothing, and reports success.


## Backups, keys, catalogues and imports

Four things a task could not do at all, and one it did in the wrong format.

### Back up data — `data.backup`

The **same** archive the Export data screen writes: a `.DATABMM`, the sections you tick, and
a passphrase if you give one.

!!! warning "The old action wrote something else"

    "Export data (backup)" wrote a `.json` through a different command, so a nightly
    automation produced a smaller, different artefact with no choice of contents and no lock.
    It is still there, renamed to say `.json`, because existing tasks refer to it and an
    older BMM can read one.

Replays, crash reports and diagnostics are **off** by default: they are large and are
diagnostics rather than configuration, and a nightly backup that quietly grew to gigabytes
is a backup somebody turns off.

!!! danger "Identity keys refuse to travel without a passphrase"

    The field's hint changes to say REQUIRED the moment you tick that box, because it is the
    only section that changes what the field means. A nightly job writing unlocked private
    keys to a synced folder would do it *every night*, and the first anybody would know is
    when it had.

`{backup.bytes}` and `{text.backup.path}` are written, so a later step can warn when the
bundle suddenly triples — which is what a replays section left ticked by accident looks like.

### Make an identity key — `key.create`

A name already on the ring is **left alone, never replaced**. That is what makes it safe on a
schedule: a weekly task makes one key and then does nothing, instead of quietly replacing the
key you prove with and locking you out of every source that has your public line.

The public line lands in `{text.key.public}` and the file's path in `{text.key.path}`, and an
optional host binds it immediately — which is the whole reason to make one unattended: the
sync that needs it is the next step.

### Follow a catalogue — `catalog.follow`

Any of the eight types, repos included. It goes through the app's own screens, so the source
lands in the following list **with an origin** and is removable by the button that removes the
others.

### Import a file — `import.file`

A path or an address, read as whatever BMM format it is. What differs per kind is what
deserves to:

| Kind | Default |
|---|---|
| Mod list | **Read**, not applied. Applying is a separate tick — a task that wants the list in BMM should not start downloading mods because the action says "import". |
| Automation | Arrives **disabled, with permissions stripped**. Importing is not agreeing to run somebody's task. An id you already have is left alone. |
| Catalogue bundle | **Followed**, not unpacked — what a catalogue holds changes when its author republishes it. |
| Data backup | **Inspected**. Restoring is its own tick, because unattended it is the most destructive thing in the scheduler. |

Inspecting a backup is the useful half on a schedule anyway: it answers *did last night's
come out right?*

## Protected sources

A repo can want a download password, a signed proof from an identity key, or both; a locked
file wants a passphrase. Every action that reaches a source now asks the same way, in one
block.

Choosing a key **binds** it to that host. That is the honest behaviour rather than switching
a global "active key" for the duration: proofs are per-host, the binding persists, and the
next manual sync of the same repo uses the same key. It is applied *before* the manifest is
fetched, because on a protected repo the manifest is itself behind the gate.

!!! note "The password used to be under Destructive options"

    It is not a destructive option. It sits with the key and the passphrase now.

## Waiting for something outside BMM

### Until an address answers — `wait.http`

Polls, with a **ceiling**. The ceiling is the point: a wait with no end is a task that hangs
forever and a scheduler that never runs the next one — and "still waiting" looks exactly like
"working" from outside.

Any status counts as an answer by default, which is what makes *wait until it stops returning
503* expressible. Name an exact code when a service answers 503 while it is starting.

Giving up is said out loud with the last status, and stops the task unless you untick it —
otherwise the steps after this run against something that never came up. Check `{wait.ok}`
first if you do untick it.

### For a signal — `wait.hook`

Something posts to `POST /api/hook` with a name, and the wait ends.

```bash
curl -X POST http://127.0.0.1:51274/api/hook \
  -H "Authorization: Bearer <your API token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"build-done","data":{"version":"1.4"}}'
```

Whatever you send arrives as `{text.hook.data}`. A doorbell that could only say "somebody
rang" would need a second channel for the thing it rang about.

!!! note "It is a LOCAL doorbell"

    The API listens on 127.0.0.1 and the route needs the token, so a service on the internet
    cannot ring it without a tunnel you set up on purpose. What it is really for is the other
    things on this machine: a script, a game, another tool, the CLI.

    Only signals sent **after** the wait began count, so an hourly task does not fire
    instantly on last hour's. Reading does not consume them — two tasks can wait on the same
    doorbell.

    `GET /api/hook` lists what has arrived. "Is my webhook actually getting through?" is the
    first question when a wait never ends.

## A script's exit code is a result

A non-zero exit used to fail the whole step, so *exited 2 because there was nothing to do*
and *the interpreter is not installed* were the same outcome — and a script that wanted to
REPORT a state had no way to, because saying so failed the step that asked.

Tick **A non-zero exit is a result, not a failure** and it lands in `{script.code}`, with
`{text.script.stdout}` and `{text.script.stderr}` kept apart. Failing to *start* is still an
error, because then there is no exit code and nothing ran.

!!! danger "A script now has a deadline"

    Five minutes by default, set per step, at most two hours. Past it the script is stopped —
    on Windows along with anything it started — and the step fails saying it timed out rather
    than pretending it exited.

    Before this there was no limit at all. A `.ps1` reading from stdin, a `python` blocked on a
    socket, an installer that opened a dialog on a session nobody is looking at: the task held
    its place until BMM was closed, and the only symptom was a run that had been “in progress”
    since 3am.

    A step that genuinely needs longer than two hours is a program to START and then wait for
    with `wait until`, not something to hold inside one step where nothing can see it.

## Walking a task one step at a time

**Debug**, beside Test run. It runs the same steps in the same order with the same permissions,
and stops before each one to show you what the task is holding.

| | |
|---|---|
| **Step** | Run the step shown, then stop again. |
| **Continue** | Stop stopping. The panel keeps showing variables as they change. |
| **Stop** | End the run here. |

The variable list is the point. A name that is both text and a number appears once, marked as
both — a capture writes each, and two rows would read as two variables. A **shared** value shows
only when nothing in this run claims the name, because that is the one substitution will use.

!!! note "It is the real run"

    Not a simulation and not a second runner. A debugger that runs the task differently from how
    it really runs is a debugger that lies about the bug.

    It also means the steps really happen: mods really get enabled, files really get written.
    Debug a task on a profile you can afford to break, the same as a test run.

!!! warning "It does not step INTO a script"

    A `run a script` step hands its code to PowerShell, cmd, bash, Python, Node or Rust in
    another process. Stepping through that would mean writing a debugger for five languages, and
    pretending to would be worse than not offering it.

    The step is shown, run whole, and whatever it returned appears in the variables like
    anything else.

## Checking what a file is before acting on it

An automation that fetches something and then acts on it has one question first: **is what came
back the thing I asked for.** Without an answer it acts anyway — imports a theme as a mod list,
follows a login page as a catalogue — and the failure surfaces three steps later as something
unrelated.

```bmms
do http.request(url: "https://…/catalog.json", into: "body")
do data.validate(text: "{body}", expect: "bmmcat")
print "{valid.count} entries"
```

| Left behind | Is |
|---|---|
| `{valid.format}` | What it turned out to be, or empty |
| `{valid.ok}` | 1 when nothing is wrong with it |
| `{valid.count}` | Mods, tasks or entries — whatever that format counts |
| `{valid.problems}` | What is wrong, in words |

Naming an expected format makes the step **fail** when something else arrives. There is also a
`fileIsValid` condition, for `if` and `ensure`.

**It decides by SHAPE, never by what the document says about itself.** A file claiming
`format: "mm"` proves nothing, and a signed one that lies about its own type is the case this
exists for.

!!! note "“Not JSON” and “JSON I do not recognise” are different answers"

    They send you to different places. The first is almost always a web page a download
    returned instead of the file — a login redirect, an expired link, a 404 served with a 200.

!!! warning "It is deliberately shallow"

    It tells you what a document is and whether its own shape holds together. Whether every
    entry inside a catalogue actually resolves is decided by the thing that installs it, on the
    machine that will run it — a second opinion here would be wrong the day somebody adds a
    field.

    The one exception is a `.bmmpa` whose task calls a shared block the file does not carry:
    that answer IS inside the same document, and without the check the file imports perfectly
    and dies on that step.

## When BMM itself does something

Every other trigger watches the outside: a clock, a file another program wrote. This one
watches BMM.

| Event | Fires when |
|---|---|
| `bmm.mod.missing` | A mod a pack needs is not installed. One event per mod. |
| `bmm.mod.corrupt` | A mod's files do not match what they should be. |
| `bmm.modpack.incomplete` | A pack applied with something missing or corrupt. |
| `bmm.repo.synced` · `bmm.repo.syncFailed` | A sync finished, or did not. |
| `bmm.profile.activated` | A profile became the active one. |
| `bmm.error` | Anything BMM reported as an error. |

What the event carried arrives as `{event.…}`. For a missing mod that is `{event.id}`,
`{event.name}` and `{event.pack}` — which is the difference between a task that knows a mod is
missing and one that can go and fetch it.

```bmms
task "Repair" {
    on event "bmm.mod.missing"

    print "{event.name} is missing from {event.pack}"
    do mod.add(url: "https://…/{event.id}.zip", name: "{event.name}")
}
```

!!! note "It is the same ring as a webhook"

    Events ring the hooks `wait.hook`, `bmm://hook` and `POST /api/hook` already use. So a task
    can wait on a BMM event exactly the way it waits on something outside, the trigger accepts
    a name of your own, and anything built for one works for the other.

!!! warning "`bmm.error` does not fire while a task is running"

    Deliberately. A task triggered by `bmm.error` that itself fails would raise an error toast,
    which would fire `bmm.error`, which would run it again — forever, with nothing anywhere
    explaining it, because every individual step behaved correctly.

    An error raised while a task is running is that task's failure. It is already in its log and
    in the running panel, and it belongs there.

A task armed at 10:00 does not run for what happened at 09:00: the first poll learns where the
ring is, and acts from then on. And a burst — five missing mods in one pack — runs the task
**once**, with the most recent, rather than five times racing each other over the same folder.

## Which mod wins a shared file

BMM deploys by copying files into the game, so two active mods that ship the same path do not
merge — one of them is what is on disk. The rule is **last wins**, and the order is the order
the mods were activated in.

That order is visible now, and changeable. In a conflict view it names the winner and offers to
flip it; from a task it is the **Set which mod wins shared files** action.

```bmms
ensure modWins(id: "big-map-pack") {
    do mods.order(id: "big-map-pack", mode: "last")
}
```

That pairing is the point of both features. The task runs on its schedule, finds the mod still
winning, and does nothing — then puts it back the day something you installed took its files.

| | |
|---|---|
| `mode: "last"` | Make it win: deployed last. |
| `mode: "first"` | Make it lose: deployed first. |
| `order: "a, b, c"` | Those mods go last, in that order. Anything active you do not name keeps its place in front of them. |

`{order.moved}` is how many files changed hands. Zero is an ordinary answer and a useful one:
the order changed and nothing on disk did, so the mods that moved share no file.

!!! note "The files change immediately"

    Reordering re-copies the files that changed winner — only those, not every contested file.
    A list that said one thing while the disk said another would be worse than no list, because
    it is the one people would trust.

!!! warning "A new order must be the same set of mods"

    Not a subset, not with extras. A caller sending a stale list would otherwise drop a mod out
    of the deployment order while its files stay in the game, and the profile would be
    describing a state that does not exist. It is refused, and the message says why.

## Naming a place instead of typing where it is

Any field that offers **Browse** also offers **BMM…**. It lists the folders BMM already knows
about, and stores the one you pick as a **name** rather than as a path:

| Written | Means |
|---|---|
| `mods:` · `game:` · `backup:` | The active profile's folders — and they follow it when you switch profile |
| `plugin:my-tools` | Where that plugin is installed |
| `plugin:my-tools/bundle/presets` | A folder the plugin ships |
| `app:obs` | An app installed from the app catalogue |
| `profile:<id>` · `modpack:<id>` | That profile's mods folder |
| `appdata:` | BMM's own data folder |

A typed path is right on one machine, until the plugin is reinstalled, the profile switches or
the app data folder moves — and then it fails at 3am, inside a step, with a message about a
directory nobody recognises. A name keeps meaning the same thing, **and means it on somebody
else's machine**, which is what makes a task worth sharing.

You can type one by hand anywhere a path goes. It is resolved when the step runs.

!!! note "`C:\mods` is not a name"

    Every absolute Windows path has a colon in it, so "has a colon" would have quietly
    reinterpreted every path that works today. Only the words in that table start a name, and
    a drive letter is one character — which is the difference the check actually tests.

!!! warning "A name that cannot be resolved stops the step"

    A plugin that is not installed here, a profile that was deleted. The step fails and says
    which name it could not place, rather than passing `plugin:my-tools/bundle` on to something
    expecting a folder — which fails later, somewhere else, with a worse message.

    A **multi-profile modpack** has no folder: its mods live in two or more. Picking the first
    would be right about half the time, which is worse than nothing, because a task writing
    into the wrong profile's mods folder does not fail. Those packs are still reachable by id
    through the modpack actions.

## Two smaller things

**Every dropdown with twelve or more entries has a search box.** It matches the whole row, so
"kill" finds *Stop app / process* through its description.

**The reference is one click from the code editor.** It opens the generated page — built from
the registry, so it can never list an action this build does not have.
