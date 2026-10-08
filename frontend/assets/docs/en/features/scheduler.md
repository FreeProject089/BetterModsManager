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

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/scheduler.bmmreplay" data-page="features/scheduler" data-title="Building a scheduled task"></div>


## A task has three parts

**Trigger → rules → action.** The trigger asks *when*, the rules ask *whether*, the action is
*what*.

In the editor every step is a card whose colour says its kind — blue for an action, amber for a
condition, purple for a loop, green for a wait — on its tag and on its left edge, and the steps
nested under a condition or a loop hang off a dashed guide. A disabled step keeps its place with
a dashed edge; a collapsed one keeps its tag so a long automation still reads as a flow chart.

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
| `onEvent` | BMM itself said something happened — a mod turned out to be missing, a sync failed. Also fires on anything that `POST`s to `/api/hook` with that name, so a webhook and a BMM event are the same thing. |
| `afterTask` | Another task finished. Optionally only when it succeeded, or only when it failed. |
| `condition` | One of the 34 conditions became true. |
| `script` | A script you wrote exited 0. |
| `rss` | A feed (RSS or Atom) has an item it did not have before — [below](#telling-the-outside-world-webhooks-discord-slack-feeds). |
| `manual` | Never on its own — only the ▶ **Run now** button or `bmm://schedule/run`. |

!!! warning "Time triggers only fire while BMM is awake"

    `dailyAt` / `weeklyAt` / `monthlyAt` are checked by BMM's own loop, which wakes about every 20
    seconds. If BMM is **closed** at that exact minute the run is missed and **not** backfilled.
    That's what *Run even when BMM is closed* (below) is for.


#### The three that wait on something BMM does not know about

`afterTask`, `condition` and `script` exist because the other triggers can only answer
questions BMM already knows the answer to.

**After another task.** Pick a task and, if you want, an outcome: *however it ended*, *only if
it succeeded*, *only if it failed*. What the other task did arrives as `{event.name}`,
`{event.ok}` and `{event.ms}`, so a repair task can say which run it is repairing.

It is not a special case bolted to the loop. Every finished run rings `bmm.task.done` on the
same hook ring `onEvent` and `wait.hook` read, and this trigger is a reader of it — which is
why you can also catch task completions with a plain `onEvent` if you want all of them.

!!! warning "A chain stops after 8 tasks"

    Two tasks each waiting for the other is a loop, and nothing else would end it: every
    individual step behaves correctly. So each run carries a hop count, and the ninth refuses
    with a message naming the task. A task waiting for **itself** is refused outright.

**When a condition becomes true.** The same 34 conditions an `IF` rule uses, as a *when*
instead of a *whether*: `when free space drops below 10 GB`, `when this app is not running`.

It fires on the **change**, not the state. A version that fired while the condition merely
held would start a hundred cleanups before the first had finished making room — so it fires
once on false→true, and not again until it has been false in between.

**When a script says so.** The free one: PowerShell, CMD, Bash, Python, Node or Rust, run on
an interval you choose.

**You choose what counts as "yes".** Four rules: it succeeded (exit 0), the exit code is
exactly N, it printed anything, or what it printed contains some text. This used to be exit 0
and nothing else, decided in the runner and written nowhere — so a probe that prints its
answer and exits 0 either way fired every interval, and a probe that signals by exiting 1
never fired at all. Both looked like a broken trigger rather than a rule nobody was told.

The code can be **written here or read from a file**. A file is re-read on every probe, so
editing it in your own editor changes what BMM watches for; the Load button next to the
editor takes a copy instead, which is a different promise and is why they are separate. A
file that has gone missing is not a fire.

What it printed arrives as `{event.stdout}`, and its exit code as `{event.exitCode}` — so a
probe can say WHICH thing it noticed, not only that it noticed something.

This trigger runs code, so it needs the **Run scripts** permission — checked before the probe
runs, not when the task does. Without that rule a task whose steps ask for nothing would still
execute its author's code every few minutes. A probe still running when the next one is due is
skipped rather than stacked.

In BMMScript the three are written:

```
task "Repair after the nightly sync" {
    after task "t-42" failed
}

task "Clean up when the disk fills" {
    when file exists "C:/games/.full"
}

task "Watch the server" {
    probe python every 5m {
        import sys, urllib.request
        n = len(urllib.request.urlopen("http://server/players").read().split())
        sys.exit(0 if n > 20 else 1)
    }
}
```

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

There are ~120 actions across ten groups:

| Group | A few of the actions |
|---|---|
| **Mods & profiles** | Activate a profile · **create / rename / delete a profile** · enable/disable a mod · **remove a mod** · enable/disable a modpack · create a modpack · **delete a modpack** · add a mod from a URL · export/import a mod list · enable/disable all · scan the folder · check mod updates |
| **Repo & sharing** | Connect · sync · generate · update · host a repo |
| **Apps & launch** | Launch an app · install an app · open a file/folder · **run a [Launch Pack](doc-page:features/launch-packs)** |
| **Appearance** | Set a theme |
| **Benchmarks & storage** | Run an app benchmark · **benchmark a disk** · **apply a disk speed limit** · toggle **Smart I/O** / **Auto-Calibration** · **check free disk space** (see [Storage](doc-page:features/storage)) · **set the resource preset**, **game mode**, **pause or resume the queue** (see [below](#how-hard-bmm-works)) |
| **Privacy & recorder** | Telemetry consent · session recorder · export/import a replay |
| **System & flow** | Show a notification · Discord RPC · export a data backup · set a variable · **run another scheduled task** · restart BMM · open a URL · **run an external program** · **run a script you wrote** |
| **Logic & math** | Compute maths into a variable · ternary · decision table · a stop-task guard |
| **Notifications & web** | Send a webhook · a Discord or Slack message · read a feed (see [below](#telling-the-outside-world-webhooks-discord-slack-feeds)) |
| **Laya (AI)** | Sort a text into your labels · run one of your Laya tasks · tag a mod · check the library · find the causes of new crashes · explain a crash · sort a report · read Laya's state (see [below](#laya-in-a-task)) |

Many actions run by firing a canonical `bmm://` deeplink through the app's own handler — the same
plumbing the [Plugins & API](doc-page:features/plugins) page exposes, which is why the two systems can drive each
other. Each of those steps builds its own link from its fields; no step fires a link you type.

The old generic *Run bmm:// deeplink* step is **removed**: it never did anything when it ran, and
the typed actions above cover what it was used for. A task saved with it still loads. The editor
shows the step as removed, with its old link, and the run skips it with a warning, so the rest of
the task runs as before. Pick a typed action in its place.

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

Each task grants nine things separately, and each says what it unlocks:

| Grant | What it allows |
|---|---|
| **Run external programs** | Launch a program with arguments |
| **Run scripts** | Run PowerShell / CMD / Bash / Python you wrote |
| **Fire deeplinks** | Run the steps that act through a `bmm://` link they build themselves: follow a catalogue, open a screen, export data… |
| **Stop a program** | Terminate a running process |
| **Delete things** | Delete a profile, a modpack, or a mod's folder |
| **Resources** | Change the resource preset, game mode and the queue ([below](#how-hard-bmm-works)) |
| **Other tasks** | Run, start or switch on another of your tasks (*Run another scheduled task*, *Start another task without waiting*, *Arm or disarm another task*) |
| **Network** | Send webhooks and Discord or Slack messages, and read a feed for the `rss` trigger — http(s) only, never a private address unless the step allows the local network ([below](#telling-the-outside-world-webhooks-discord-slack-feeds)) |
| **Laya (AI)** | Ask Laya on this PC: every `ai.*` step (sort a text, tag a mod, check the library, label crashes…) and the `aiAvailable` condition ([below](#laya-in-a-task)) |

All nine are off until you turn them on, and a step whose permission is missing fails with a
message naming the one to grant — it never runs quietly.

**Delete things** is the odd one out. Four of the others are about reaching *outside* BMM; this
one is about destroying your own data from the inside, where no external gate would ever see it. It
covers deleting a profile, deleting a modpack file, and — only when you tick the second box —
deleting a mod's folder from disk. Nothing here goes to the recycle bin.

**Resources** stays inside BMM too and destroys nothing, but a task holding it can make BMM work
flat out while you play, or hold every operation in the queue until something resumes it. That is
a decision about your machine, so it is a grant like the others.

Stopping a program is separate from launching one because the risk differs in kind: starting
something is undoable, killing something can lose unsaved work with nothing to undo.

**Other tasks** exists because running another task is acting with *that* task's permissions.
Without it, a task granted nothing could run, or switch on for its schedule, one of your own
tasks that may run programs or delete things. It is its own grant rather than part of **Fire
deeplinks**, so letting a task call its sub-task does not also let it follow catalogues, open
screens or export data through a link.

!!! warning "These links run as the scheduler"

    The steps under **Fire deeplinks** go through the same handler a web page's `bmm://` link
    reaches, but as the scheduler, which is trusted: nothing asks you at 3 a.m. The hard limits
    (no network path, no raw program path, no script carried by a link) still apply. A task
    cannot write a link of its own: every step builds a fixed one from its fields, and *Open a
    screen or a window* opens only the windows its list offers.

!!! note "Upgrading from the old single checkbox"

    A task you built before the split keeps everything it already had, running other tasks
    included — but none gains **Run
    scripts**, **Stop a program**, **Delete things** or **Resources**. None of those capabilities existed when
    you ticked *Allow custom commands*, so granting them now would be inventing your consent
    rather than honouring it.

!!! danger "A task that arrives in a FILE gets none of them"

    Importing a `.bmmpa`, or adding a shared `.bmmscript` to your tasks, removes every one of
    the grants and leaves the task **disabled** — then tells you what the file had asked for.

    The automation is intact and one toggle away from working. What it cannot do is arrive
    already holding permission to run programs on a timer, which is what used to happen: only
    *Run even when BMM is closed* was cleared, and everything else came through as the author
    had set it.

## Example

The scheduler ships one, and it's a good shape to copy:

> Every hour, loop 3× and show a notification each time.

Start there, swap the notification for a real action, and add a condition so it only fires
when it should.

## Picking an action or a condition

Both pickers open the same panel: a search box, then every kind grouped (mods & profiles, repo & sharing, apps, appearance, benchmarks & storage, privacy, logic, system — and for conditions: logic & values, mods, files, apps/network/tasks, time), each with its name and a one-line description of what it does. Type a word — *repo*, *file*, *stop* — and only the matching kinds stay; Enter takes the first one, Escape closes. The current kind is highlighted, and hovering the button in the step shows its description again.

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
| `gameRunning` · `resourcesPresetIs` · `queueIdle` | Game mode is on · the preset in force is the one you picked · BMM has no operation running or waiting ([below](#how-hard-bmm-works)). |
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

## How hard BMM works

Three actions and three conditions drive the [resource governor](doc-page:how-it-works/resources),
the part of BMM that decides how hard it works your CPU and disks. Every one of the actions needs
the task permission **Resources**; a step without it fails and says so.

| Action | What it does | Settings |
|---|---|---|
| `resources.preset` | Picks a preset: **Quiet**, **Balanced** or **Everything for BMM** | **for this task only** (the default) or **for good** · **even while a game runs** |
| `resources.gameMode` | Game mode: **Detect it**, **Force on**, **Force off** | — |
| `resources.queue` | **Pause everything waiting**, or **Resume everything** | — |

**For this task only** is the one to reach for. The preset lasts while the task runs and goes back
to yours when it ends, whether it succeeded or failed, and after **2 hours** at most even if the
task never gets that far. It is never saved in your settings. **For good** is the same as pressing
the preset button in the Storage Manager. A second preset step in the same task replaces the first.

Game mode normally beats a task's preset: while a game runs, BMM stays Quiet. Tick **even while a
game runs** for a task that must finish at full speed anyway.

| Condition | True when |
|---|---|
| `gameRunning` | Game mode is on |
| `resourcesPresetIs` | The preset **in force** is the one you picked (a task's or game mode's preset counts, not only yours) |
| `queueIdle` | BMM has no operation running or waiting |

The `value` condition can also read `queue.length`, the number of operations running or waiting,
read at the moment the condition is checked.

A night-time task that works flat out and puts everything back:

```text
03:00  resources.preset   Everything for BMM, for this task only
       mods.checkUpdates
       WAIT UNTIL queueIdle
       (the task ends: the preset goes back to yours)
```

!!! note "Detection or a task"
    **Detect it** turns game mode on by itself for a game started from a profile's game folder,
    one listed in the Storage Manager, or one in exclusive full screen. For a game it cannot see,
    a task can force it: `resources.gameMode` **Force on** before a launch pack starts the game,
    **Detect it** again afterwards. See [How detection works](doc-page:how-it-works/resources#how-detection-works).

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

## Three ways to edit a task

**The first time you create a task**, BMM asks which of the three you prefer — **Flow**
(recommended: the whole task at once, a test per node, the debugger walking it), **BMMScript**
or **Blocks**, one line each. The answer is a setting: **Settings → Planning → Tasks open in**,
and the switch at the top of the editor changes it too.

**The editor's header** carries what you act on: the task's name, whether it is **On** or **Off**
(click to switch), *Unsaved changes* when there are some, the mode switch, **Preview** (a dry run
that changes nothing), **Debug**, **Test run** and **Save** — which keeps the editor open
(:kbd[Ctrl+S]). The footer keeps **Cancel** and **Save and close**.


The builder has a switch at the top of the steps: **Blocks**, **Code** and **Flow**. They are three
views of the same task. There is one tree of steps; each mode reads it and writes it, so a task built
in one opens identically in the other two, and the mode you used last is the one the builder opens in
next time.

| Mode | What it is | Good for |
|---|---|---|
| **Blocks** | The steps as cards, top to bottom, with their fields inline. | Filling in fields; dragging a step into a branch. |
| **Code** | The steps as [BMMScript](doc-page:features/bmmscript) text. Leaving it compiles the text; a mistake keeps you there with the line that is wrong. | Writing fast; pasting; reviewing a whole task at once. |
| **Flow** | The task as a graph, left to right: the trigger, one node per step, a lane for every branch, a join where the lanes meet. | Seeing the shape of a task with branches, loops and parallel work. |

### The flow

- **Nodes.** Each shows its icon, what it does, and one line about *which* (the file, the mod, the
  condition). An **IF**, a **SWITCH** or an **ENSURE** opens its lanes to the right (THEN / ELSE,
  each CASE and DEFAULT); a loop draws its body with a dashed line going back round; **AT THE SAME
  TIME** draws one lane per branch; **TRY** has a TRY lane and an ON ERROR lane.
- **Adding.** Every edge has a **+** in the middle, every empty lane has a **+**, and so does the end
  of the task. Each opens a search over every step and every action — type a few letters, arrows,
  Enter. An action that needs a permission this task has not been granted says so in the list.
- **Editing.** Select a node and the panel on the right shows it in sections: what it does (with a
  *Learn more* link), what is wrong with it (a missing permission, how the last run went), its
  **Settings**, **Test**, and **Debugging** (a breakpoint, and the values it names while a run is
  paused). The settings are the *same* fields as in Blocks, not a copy: the same pickers, the same
  checks. Fields are grouped, say what is wrong with them **as you type** (an address that would be
  refused, a JSON body that does not parse, a regular expression that would backtrack for minutes),
  and every field that takes `{variables}` has a **{x}** button listing the variables this task can
  name — what its steps write, what its trigger hands over, the shared ones and the built-ins.
- **Moving.** Drag a node; it snaps to the grid. Where you put it is kept with the task, as an offset
  from its automatic place, so inserting a step still pushes what comes after it along. **Auto-layout**
  forgets the positions you placed by hand. Nothing about where a node sits changes what the task
  does, or its content id.
- **Last run.** For a saved task, each action shows how the last run went: a green dot for done, red
  for failed (hover it for the error), a hollow dot for a step the run never reached. A block takes
  the worst of what ran inside it.

!!! warning "Permissions still decide"

    A node whose step needs a permission the task lacks carries a **!** and says, in the words the run
    would use, what it will be refused. The flow never grants anything: *Show it in Permissions*
    takes you to the box in the sidebar, the same one as in the other modes, and the run checks the
    grant exactly as it always did.

### Flow shortcuts

Every shortcut here is a command: it is in the :kbd[Ctrl+K] palette while the editor is open, and it
can be changed in **Settings → Keyboard shortcuts**, under *Scheduler*. The flow's own keys only act
while the canvas has the focus, so typing in a field is never taken over.

| Command | Default |
|---|---|
| Add a node… | :kbd[/] |
| Edit the selected node | :kbd[Enter] |
| Delete the selection | :kbd[Delete] |
| Duplicate the selection | :kbd[Ctrl+D] |
| Undo · Redo | :kbd[Ctrl+Z] · :kbd[Ctrl+Shift+Z] |
| Select every step | :kbd[Ctrl+A] |
| Select the next node · Select the previous node | :kbd[→] · :kbd[←] |
| Select the node above · Select the node below | :kbd[↑] · :kbd[↓] |
| Move the step earlier · Move the step later | :kbd[Alt+←] · :kbd[Alt+→] |
| Zoom in · Zoom out | :kbd[Ctrl+=] · :kbd[Ctrl+-] |
| Fit the whole task in view | :kbd[F] |
| Auto-layout (forget hand-placed positions) | :kbd[Shift+L] |
| Blocks mode · Code mode · Flow mode | :kbd[Alt+1] · :kbd[Alt+2] · :kbd[Alt+3] |
| Save the task (and keep editing) | :kbd[Ctrl+S] |
| Test the selected step once | :kbd[T] |
| Breakpoint on the selected step | :kbd[F9] |
| Step (run the next step, then stop) · Continue to the next breakpoint · Stop the run | :kbd[F10] · :kbd[F5] · :kbd[Shift+F5] |

With the mouse: drag the background, hold :kbd[Space] and drag, or scroll, to move around;
:kbd[Ctrl] + wheel (or a pinch) to zoom; :kbd[Shift] + drag to select several nodes, :kbd[Ctrl] + click
to add one to the selection.

## Laya in a task

The **Laya (AI)** group of actions asks **Laya**, the classifier that runs on your PC. Every one
needs the **Laya (AI)** permission and AI turned on in Settings.

| Action | What it leaves |
|---|---|
| `ai.classify` | Sorts a text (or the start of a text file) into **your** labels. `{kind}` is the label, `{kind.p}` its probability; also `{ai.label}`, `{ai.p}`, `{ai.abstained}` and every label's score in the map `ai.scores` |
| `ai.run_task` | The same sort with one of your saved **Laya tasks** (Settings → Laya's answers → Custom tasks), picked from a list. Same variables |
| `ai.classify_mod` | Tags for one mod, chosen among **your** tags from its own files, and the adult-content hint: `{ai.mod.tags}`, `{ai.mod.category}` (the surest tag), `{ai.mod.adult}`. With **Apply the sure tags**, see below |
| `ai.library_check` | Likely duplicates, mods overwriting each other now, mods with no tag, and Laya's tags for up to 10 of those. Counts in `{ai.lib.findings}`, `{ai.lib.duplicates}`, `{ai.lib.conflicts}`, `{ai.lib.untagged}`; a readable list `ai.library`, the untagged ids in the list `ai.library.untagged`. **Changes nothing** |
| `ai.crash_label` | « Find the causes » on the crash reports that arrived since its last run (7 days back the first time), or on the latest ones: family, cause and probability for each. The newest in `{ai.crash.family}`, `{ai.crash.cause}`, `{ai.crash.p}`; one line per crash in the list `ai.crashes` |
| `ai.triage_report` | Is a text (or a file) an idea, a bug or a crash, and which part of BMM: `{ai.report.kind}`, `{ai.report.area}`. Personal data is masked first |
| `ai.status` | Laya's state: `{ai.available}`, `{ai.enabled}`, `{ai.installed}`, `{ai.loaded}`, `{ai.writer}`, `{ai.provider}`. Runs no model |
| `ai.explain_crash` | A short written explanation of one crash, in `{ai.explanation}`. Only with a **writing model** set up |
| `ai.ask` | Searches the docs and your mods for a question. The answer is text in `{answer}` and `{ai.answer}` |
| `ai.suggest_mod_metadata` | Lists suggestions for one mod (name, tags, links…). **Nothing is applied** |

Branch on the result with the Laya conditions:

| Condition | Holds when |
|---|---|
| `aiLabel` | The label is X with a probability of at least *t*: `if aiLabel(var: "kind", label: "crash", min: 0.8) { … }` |
| `aiScore` | The score Laya gave **any** label compares to a number: `aiScore(label: "ui", op: ">=", value: 0.3)` |
| `aiAbstained` | The last sort (`ai`), the last mod's tags (`ai.mod`) or the last triage (`ai.report`) was « I do not know » |
| `aiAvailable` | Laya can run now, is on, is installed, is loaded, or a writing model is set up. Asks the app: needs the permission |
| `crashCause` | The family (or the cause) of the latest crash, or of any crash of the run, is X with a minimum probability. With no crash step in the run, it reads what the trigger carried |
| `aiLibraryCount` | A count of the last library check compares to a number (`>= 1` by default) |
| `modAiTag` | Laya gave a mod (the last one classified by default) the tag X. A flagged guess does not count |

Every variable name is stable and listed with what it holds in the code (`sched-vars.ts`,
`LAYA_VARS`). A step given **into: x** also writes the same values under `x.` (`{x.tags}`,
`{x.abstained}`…).

**Your answer settings apply.** Each step goes through Settings → **Laya's answers** of its area:
« Tasks and scripts » for a sort, « Library analysis » for a mod's tags and the library check,
« Crash reports » for crash labels, « Bug reports » for triage. A threshold you raised makes
Laya abstain more (`none`, `unknown`, `{…abstained}` = 1); « keep the best guess, flagged » keeps
it, marked as a guess (a `?` in the crash list, never applied, never counted by `modAiTag`).

**Applying tags.** With **Apply the sure tags** ticked, `ai.classify_mod` writes only the tags
the dialog would tick by itself: Laya's, above your threshold, not a flagged guess, and only if
**apply without asking** is on in the « Library analysis » answers. Tags are added, never
removed, and the mod's history shows the change. Off, the tags are proposals in variables.

**Nothing leaves the PC for these.** A mod's files, a crash log or a report are read by the
built-in Laya or your own laya-serve, never by a server: with BetterCommunity as the
classifier, these steps are refused. `ai.explain_crash` is the one exception you choose: a
**remote** writing model is refused unless you tick **Allow a remote writing model** in the step,
which also needs the **network** permission.

**An answer is data, never a command.** The text from `ai.ask`, `ai.suggest_mod_metadata` and
`ai.explain_crash` is built from things BMM does not control (a mod's readme, a file, a crash
log). It can go into a message, a log line or a file. It cannot go into a program, a script, a link, an address or a header: the step
fails and says so. A copy of it (`set`, a list, a map) is refused the same way. A label from
`ai.classify` is always one of your own words (or `none`), so branching on it is safe. The same
goes for the other steps: a tag is one of yours, a cause or a report kind one of a fixed list,
checked again before it reaches a variable.

Limits: per run, 20 calls to Laya and 2 minutes of waiting (`ai.status` counts for neither); for
all tasks together, 30 calls a minute, one at a time. Nothing runs while a game is running, with
AI off, or with `--no-ai`.

Four templates start from here: **Tag new mods with Laya**, **Label new crashes and tell me**,
**Weekly library check** and **Tell me about a new kind of crash**.

## Telling the outside world — webhooks, Discord, Slack, feeds

Four steps in the **Notifications & web** group, and one trigger.

| Step | Sends | Permission |
|---|---|---|
| **Send a webhook** (`webhook.send`) | POST, PUT or PATCH to any address, with a JSON (or text) body, headers, **secret headers**, and retries | **Network** |
| **Send a Discord message** (`discord.send`) | A message to a channel, through its webhook address | **Network** |
| **Send a Slack message** (`slack.send`) | A message to a channel, through an incoming webhook | **Network** |
| **Add an entry to a feed** (`feed.publish`) | Nothing over the network: an entry at the top of an Atom file the task keeps | none |

The body of a webhook is a template: `{variables}` are filled in before sending, and in a JSON
body they are **escaped as JSON text**, so a feed title with a quote in it or a log line with a
line break cannot break the document. A JSON body that does not parse is refused before
anything is sent — a half-formed body is otherwise a `400` with no hint of why.

**What stays secret.** Put tokens in **Secret headers**: they are sent like the others and are
never shown in a log, an error, the debugger or a step's one-line summary. A Discord or Slack
webhook address *is* the password, so it is typed in a masked field and a node shows only its
host. Errors never quote the address (the network library puts it in its errors; BMM rebuilds
them without it), and the run log already removes query strings and long tokens.

**What is refused, whatever the task says** (the checks run in BMM's backend):

- anything but `http://` and `https://`, and an address with `user:password@` in it;
- a **private address** — this PC (`localhost`, `127.0.0.1`, `::1`), your network (`10.x`,
  `192.168.x`, `172.16–31.x`), link-local (`169.254.x`, the cloud metadata address), CGNAT
  (`100.64.x`), IPv6 local ranges, and IPv4 hidden inside IPv6 — unless the **step** ticks *Allow
  the local network*. The check is made on the addresses the name **resolves to**, and the
  connection is pinned to exactly those, so a name that answers one thing to the check and
  another to the connection reaches nothing new. No system proxy is used for these requests;
- a Discord step whose address is not `https://discord.com/api/webhooks/…`, a Slack step whose
  address is not `https://hooks.slack.com/…`;
- redirects on a webhook (the 3xx is reported; the body is not re-sent somewhere else). A feed
  read follows up to five redirects and checks every hop again.

Every request has a **timeout** (15 s by default, 60 s at most) and a **size cap** on the answer
(256 KB for a webhook, 4 MB for a feed). A webhook is retried on a network error, a `429` or a
`5xx` — up to four more times, with a growing pause — and never on another `4xx`: sending a wrong
request again is sending it wrong again. `{http.status}` and `{http.body}` (the first lines of the
answer) are readable afterwards; a non-2xx stops the step unless *Treat 4xx and 5xx as success* is
ticked.

**"RSS" means two things, and BMM does both.**

- **A feed as a trigger** — *When a feed has a new item* (`rss`). Give it the address of an RSS or
  Atom feed and how often to check it (every 5 minutes at the most often). The first check only
  **learns** what is there, so arming a task on a feed with fifty items does not run it fifty
  times. After that, new items run the task **once**, with the newest one as `{event.title}`,
  `{event.link}`, `{event.id}`, `{event.published}`, and how many there were as `{event.count}`.
  What was seen is remembered across launches, so an item published while BMM was closed still
  runs the task at the next check. It needs **Network**; without it the feed is never read, and
  the task's "why is it not running" line says so. *Read the feed now* shows what the trigger
  would see without remembering anything.
- **A feed of the task's own** — *Add an entry to a feed* writes an Atom file (newest first,
  50 entries kept by default) in the task's output folder, or wherever you point it. Any feed
  reader can follow it, or host the folder with Server Repo. With an *after a task* trigger, that
  is a feed of another task's results. BMM never overwrites a file that is not a feed it keeps.

Email is not offered: BMM has no mail path, and adding one means storing an SMTP password.

## Testing one step

Every step has a **Test** button — ▶ on a block, a *Test this step* section in the flow's panel,
:kbd[T] on a selected node. It runs that step once, on its own, with the task's permissions and
fresh variables, and shows what came back **on the step itself**: a pulse while it runs, then a
green or red outline and a line with the verdict, the HTTP status and the first words of the
answer. Under *reduced motion* the pulse is a still outline.

A step that only computes, reads or sends a message is tested straight away. A step that changes
something — enables a mod, deletes a profile, starts a program — asks first, because a Test
button that silently did that would be a trap.

## Everyday controls

Each task row carries: an **enable/disable** toggle, ▶ **Run now** (fires immediately, ignoring the
trigger), **Duplicate** (a copy is created **disabled** so it can't double-fire), **Edit** and
**Delete**. Inside the builder, **Test run** executes the current *unsaved* draft once, and the side
panel shows the last runs (time · OK/ERR · duration). While editing, :kbd[Ctrl+Z] / :kbd[Ctrl+Y]
undo and redo, and any single step has its own *run just this step* button.

## Starting from a template

A new task opens with a **Browse templates…** button (the count beside it is how many there
are) and a **From a catalogue…** button for automations other people published.

**Browse templates…** opens the template gallery: a category rail on the left (*Mods &
profiles*, *Backups & upkeep*, *Watching something*, *Repos & syncing*, *Chains & variables*),
a search box, and one card per template showing what it does, when it runs, how many steps it
has and whether it needs a permission. Selecting a card fills the detail pane on the right —
the trigger, every step in words, and the permissions it would need — so the choice is made on
what a template **does**, not on its name. **Use this template** (or a double-click) hands it
to the editor.

Using a template **replaces the draft**. On a blank new task that happens straight away; once
there is work in the task, BMM asks first and says how many steps would go. Blanks in a
template (a profile to pick, a program to name, a path) are yours to fill — a template never
guesses those, because a guessed path is a task that looks configured and does nothing.

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
| Friday game night | Every Friday at 19:00, the profile and the modpack you play with |
| Start from a clean slate | Every mod off, then one modpack on |
| Full backup on the 1st | A complete export plus your modpacks, monthly |
| Check for updates only when online | The daily check, skipped cleanly with no connection |
| Startup checklist | Rescan on open, then warn under 15 GB |
| React when a file changes | Watches one file and rescans when it changes |
| Switch profile when the game starts | Every 2 minutes, activates the game's profile while it runs |
| Sync once another task succeeds | A chain: sync the repo after the task you pick finishes without error |
| Check three times, then stop | A repeat block — three checks ten minutes apart |
| Night theme in the evening | Switches to a dark theme at 20:00 |

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
The **Watch a game** action (`game.watch`) writes a small Lua file
to `Saved Games/DCS/Scripts/Hooks/bmm-serverwatch.lua`. It reports which multiplayer server
you are on, to a file BMM watches. It reads nothing else and sends nothing anywhere.

It goes into **every** DCS folder found — there are usually two, release and open beta —
because flying in the one you did not set up looks exactly like the feature not working.

It used to be a button on the `watchFile` trigger as well. It is not any more, and the reason
is worth saying: setting a game up is a STEP, and putting one game's name on a generic
trigger meant the first thing somebody choosing "when a file changes" met was DCS — and, if
they pressed it, a path ending in `bmm-server.json` with nothing on screen saying what that
was. Add the action, then point the trigger at the file it writes.

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

It can also wait on what the reply **says**. Fill *wait until the reply contains* with a
piece of text — matched anywhere in the body, ignoring case — and both have to be true. This
is the common case rather than the exotic one: a job endpoint answers `200` from the moment
it accepts the work, so on status alone the wait ends on the first poll and every step after
it runs against a job that is still running.

```
{"id":"a91","state":"running"}   ← 200, and not what you are waiting for
{"id":"a91","state":"done"}      ← 200, and this one is
```

With `"state":"done"` in that field, the wait ends on the second. The reply itself lands in
`{text.http.body}`, so the steps after it can read *which* job finished.

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

**BMM's own events ring the same doorbells.** The name box offers the list — the same names
the *on event* trigger offers — so a task can wait mid-run for `bmm.repo.synced` or
`bmm.profile.activated` instead of only being started by one. `{text.hook.data}` then carries
what the event carried.

That is the difference between the two: the trigger asks *start this task when X happens*,
the wait asks *stop here until X happens*. A task that has to do something before X and
something after it needs the second.

Debugging one that never ends: `GET /api/hook` lists every name that has rung with a count,
and `GET /api/hook/:name` gives the rings themselves with their payloads — which separates
"nothing ever arrived" from "something arrived under a different name", or from "it arrived
and the body was not what I thought".

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

!!! note "What an export leaves behind"

    A shared `.bmmpa` arrives disabled, with no permissions and no Windows task — three
    decisions that belong to the person importing it.

    It also carries **no run history**. Those entries hold error messages, and an error message
    routinely holds a local path: sharing an automation was sharing a list of when its author
    was at their computer and where their files live. Nothing warned about it, because nothing
    was wrong with the automation.

## Two ways to ask before you run

**Ask now**, beside any condition, evaluates it against the app as it is. "Does `fileExists`
see what I think it sees" used to need a whole task built around it: add a step, add a notify,
save, run, read the toast, delete it again.

It answers with the task's SHARED variables available and nothing else — a condition reading
something an earlier step would have captured cannot be answered on its own, and the button
says so rather than reporting false. A condition that THROWS shows its error, which is the most
useful of the three answers: a permission it does not have, a path it cannot read.

**Preview**, beside Test run and Debug, reads the steps and says what they would change.

| | |
|---|---|
| would change | this actually does something |
| already like that | the mod is on and the step turns it on |
| cannot tell from here | not installed on this machine, or inside a block |

!!! warning "It reads, it does not run"

    No condition is evaluated, so anything inside an `if`, a loop, an `ensure` or a `try`'s
    error handler is marked **maybe**. A `try`'s main body and a `retry`'s body are not maybes —
    the first always starts and the second runs at least once.

    A `call` is listed and its contents are not read. Saying "there is a block here and I did
    not look inside" beats leaving half a task out of the answer.

## Walking a task one step at a time

**Debug**, beside Test run. It runs the same steps in the same order with the same permissions,
and stops before each one to show you what the task is holding.

| | |
|---|---|
| **Step** — ++f10++ | Run the step shown, then stop again. Press it *during* a run to go back to stepping. |
| **Continue** — ++f5++ | Stop stopping — or run to the first step matching the box below. The panel keeps showing variables as they change. |
| **Copy** | The steps and the variables as text, for a bug report. A failure is stated on the second line, above the log. |
| **Stop** | End the run here. |

The keys are commands like every other (Ctrl+K lists them, Settings → Keyboard shortcuts rebinds
them), and they are ignored while a text field has focus, so typing an F in the filter does not
advance the run. :kbd[Shift+F5] stops; :kbd[F9] puts a breakpoint on the selected step. Nothing is bound to ++esc++: it closes dialogs everywhere else in BMM, and a
key that sometimes stops a debug run and sometimes shuts the window behind it is worse than no
key.

**Run until the step mentions …** is the setting between the other two. Step is one at a time
and Continue is all the way; a task with a hundred steps and one suspect branch used to be a
choice between a hundred clicks and none. Type any part of a step's description — an action
name, a mod id — and Continue stops at the first step that contains it, then hands you back
control. Leave it empty and Continue means what it always did.

It takes a **list**, separated by commas: `download, upload, cleanup`. One needle meant running
the whole task once per place worth stopping at. Blank entries between commas are dropped —
every description contains the empty string, so `download,,upload` would otherwise stop at
every step and look like a broken Continue.

**What already ran** lists every step so far, in order. The panel used to show the current step
and nothing else, which answers "where am I" and not "how did I get here" — and the second is
the question you have when a task took a branch you did not expect.

The variable list is the point. A name that is both text and a number appears once, marked as
both — a capture writes each, and two rows would read as two variables. A **shared** value shows
only when nothing in this run claims the name, because that is the one substitution will use.
Names that just **changed** are highlighted, and names that just **appeared** are highlighted
differently: twenty rows repainted identically hide the one that moved, which is the reason
anybody is watching.

The panel can be dragged by its header — it is pinned to a corner, and the corner is sometimes
exactly where the step you are reading is drawn. Its header also counts **steps run and seconds
elapsed**: a step that took nine seconds was not visible as one, and it is usually the step
being looked for.

### In each editor

The run is shown where you are looking, and the three editors agree because the debugger reports
**which step** it stands on (its path in the task — the same path the run log records):

| Mode | While it runs | Breakpoints |
|---|---|---|
| **Flow** | The node the run stands on glows; a running node pulses; a failed one turns red. Hover a node while paused to see the values **that step** reads or writes. | The dot on a node's left edge, or *Pause here* in its panel |
| **Blocks** | The running block is outlined and scrolled into view. | The ● button of a block |
| **Code** | The running line is highlighted. | Click the gutter beside a line |

A breakpoint set in one mode is there in the other two — it is on the step, not on the picture.
**Continue** runs to the next breakpoint (or to a step matching the box below). The log lists each
step with the time since the start (`+1.2s`); click a line to show that step in the editor. When a
step fails, the message says **which step** it was and *Show the step* takes you there.

### When it breaks, the window stays open

This is the whole point and it used to be the one thing missing. A task that threw closed the
debugger — the panel went, the variables went with it, and what you were left with was a toast
containing the error message, which is what you had before there was a debugger at all.

Now the run stops **on** the failure: the message across the top, the failing step in red in
the log (it is already the only entry without a tick), and every variable still readable, still
filterable, still copyable. Step and Continue go grey, because there is nothing left to
continue; Stop becomes Close.

### Where a value came from

Click a variable's **name** — not its value, which is the editor — and you get its whole trail:
every value it has held, and the step number that left it there.

"It is empty now" is half an answer. The half that matters is *which* of two hundred steps
emptied it, and answering that used to mean stepping the task again and watching one row.

Only changes are recorded, so the trail is the answer rather than a transcript, and the cap
drops the oldest entries: a variable that changed a thousand times is being changed in a loop,
and it is the last turn of that loop that broke.

**Which step finished.** A tick means it returned. The entry WITHOUT one is where the run is
standing — or, after a failure, where it stopped, and it is marked red there. The gate runs before each step, so reaching
it again is what proves the previous one worked; nothing needed to be added to the runner to
know that.

**A filter**, over the variable names, for when there are twenty of them.

**Changing a value.** Click one, type, press Enter. This is most of what stopping before an
`if` is for: asking what the other branch does, without editing the task, running it again
and hoping the world cooperates. It writes back into the bag it came from, so a number stays
a number and keeps matching a `value` condition — and your own edit is not highlighted as a
change, or it would hide the next real one.

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

!!! tip "A protected source, from a task"

    **Connect a repo**, **Sync repo** and **Follow a catalogue** each carry a *This source is
    protected* block now — they used to offer a URL and nothing else, so a task pointed at a
    protected repo opened the screen with an empty password box and waited for somebody who
    is not there.

    A **password** only, in those three. All three act through a `bmm://` link, and a link
    able to name which identity key signs is a link choosing who you are to a server; the key
    stays the active one. **Sync a server repo (unattended)** and **Import from a URL** are
    the two that do the work themselves, so those offer the key and the passphrase as well.

### Taking somebody there, and asking what is already true

**Open a screen or a window** covers both kinds of place. The screens come from the navbar
itself, so the list cannot name one that is not there; the five things that are *not* screens —
the theme editor, the layout and navbar editors, the benchmark, and a documentation article —
each had their own `bmm://` link and no action at all, so opening one from a task meant
hand-writing a URL.

Two conditions close loops that actions had left open:

| Condition | Why it had to exist |
|---|---|
| **Plugin is installed** | A task could install a plugin and could not ask whether one was there. "Install it only if it is missing" had to be written as "install it every time", which re-downloads and re-applies on every run. |
| **Another task is armed** | The other half of *Arm or disarm another task*. Without it a task could set another one's state and never branch on it. |

Both pick from a list rather than taking a typed id — a plugin id is `com.someone.thing` and a
task id is a millisecond timestamp, and typed by hand each is a silent `false` that reads as
"not true" rather than "you named something that is not here".

!!! note "Three actions used to wait for a window nobody would see"

    **Export a mod list**, **Import a mod list** and **Export replay** all accept a path at the
    endpoint and offered no way to give one, so each opened a file dialog. Fine in front of a
    person; on a timer the task simply waits. They take a path now, and the hint says what
    empty means: *ask me*.

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

What it can recognise, by SHAPE and never by what the document claims about itself:
`bmmpa` · `bmmnav` · `bmmlaunch` · `bmmreplay` · `bmmplug` · `mm-locked` · `theme` · `databmm` ·
`repo` · `mm` · `bmp` · `cbmp` · `bmmcat`. A file that claims `format: "mm"` proves nothing; a
signed one that lies about its own type is the case this exists for.

!!! tip "A launch pack is worth validating before you run it"

    `bmmlaunch` reports how many programs a pack starts, and flags the ones that go through a
    shell — a `.ps1` runs with PowerShell's execution policy bypassed — and the ones named by
    a relative path, which resolve against whatever folder happens to be current when they
    fire. Neither is visible from the filename.

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

!!! tip "Every task says when it runs next — or why it does not"

    The chip on a task used to be blank for four of the ways a task can sit doing nothing:
    switched off, manual, watching a file, waiting for an event. Now it says which one.

    None of those is an error, so none of them is coloured. A manual task that reads “only when
    you press Run” is working exactly as intended.

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
| `bmm.ai.crashLabelled` | Laya labelled a crash report for the first time (on the crash page or in a task). Carries `report`, `family`, `cause`, `p`, `abstained`, `uncertain`. |
| `bmm.ai.crashGroup` | Laya saw a crash unlike any it remembers. Same fields. |
| `bmm.ai.ready` | Laya became available: `what` is `installed`, `loaded` or `enabled`. |

**Only when.** The trigger takes a filter on what the event carries: `family=disk` runs the task
only for crashes of that family, `family=disk|memory` for either, `cause=disk_full, abstained=false`
for both conditions at once. In code: `on event "bmm.ai.crashLabelled" where "family=disk"`.

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

**Enable modpack**, **Enable all mods** and **Apply a mod list** have an **Activation order** field
(`placement` in script): where the mods they turn on go.

```bmms
do modpack.enable(id: "night-pack", placement: "bottom")
do mods.enableAll(placement: "keep")
```

`top` makes them win, `bottom` keeps yours winning, `keep` moves nothing already active. Empty is
the pack's own choice, then the **Bulk enable** setting. Enable modpack also writes
`{order.moved}`. See [Activation order](doc-page:how-it-works/load-order).

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
