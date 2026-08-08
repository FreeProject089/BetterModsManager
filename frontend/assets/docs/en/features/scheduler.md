# Scheduling & automation


> Schedule BMM actions (one-time or recurring) — activate a mod, modpack, profile…

Reachable from [Plugins & API](doc-page:features/plugins). This is the part of BMM that does things while
you're not looking.

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
| **System & flow** | Show a notification · Discord RPC · export a data backup · set a variable · **run another scheduled task** · restart BMM · open a URL · **run a custom command** · run a raw `bmm://` deeplink |
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

## Custom commands

> Allow custom commands.

Off by default, and rightly: a scheduled task that can run arbitrary commands is a scheduled
task that can do anything, at a time you're not watching. Turn it on when you need it, and
know what the command does.

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

The bundled example is a `repeat` in `times` mode (loop 3×). Swap the mode to `while`/`until`
and give it a `value` or `appRunning` condition, and you have automations like "*keep checking
until the game process exits, then export my data*".

## Everyday controls

Each task row carries: an **enable/disable** toggle, ▶ **Run now** (fires immediately, ignoring the
trigger), **Duplicate** (a copy is created **disabled** so it can't double-fire), **Edit** and
**Delete**. Inside the builder, **Test run** executes the current *unsaved* draft once, and the side
panel shows the last runs (time · OK/ERR · duration). While editing, :kbd[Ctrl+Z] / :kbd[Ctrl+Y]
undo and redo, and any single step has its own *run just this step* button.

## Share a set of tasks — `.BMMPA`

**Export .BMMPA** writes your whole task set to a JSON file; **Import .BMMPA** loads someone else's.

!!! note "Imports never fire on their own"

    Imported tasks get fresh ids and *Run even when BMM is closed* is forced **off**, so importing a
    file can't silently register OS-level scheduled tasks on your machine. Review and enable them
    yourself. **Load example** drops in a ready-made (disabled) task you can dissect.
