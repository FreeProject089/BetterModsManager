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
    `BMM.exe "bmm://schedule/run?id=…"` at the right time; BMM handles the `bmm://` scheme,
    so Windows starts it and the deep-link router runs that one task. The app opens — this
    wakes BMM up rather than running behind its back.

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

**Files… → Publish my own…** picks your automations and writes a folder: one signed `.bmmpa`
per automation plus a `catalog.json` beside them. Upload the folder anywhere static — a GitHub
repository, GitHub Pages, your own server — and give people the address of the `catalog.json`.

Each automation is either **packed** into the catalogue or **linked** to an address you give,
chosen per entry — so one catalogue can carry the small ones and point at the large one
somebody already hosts. Tick *Publish it as ONE file* and you get a single `.bmmbundle`
instead of a folder: the catalogue and every automation it packs, in one thing you can send
somebody, with nothing to host and no address to keep alive.

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
