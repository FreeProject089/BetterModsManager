# BMMScript — automations as code


> The same automations as the [scheduler's](doc-page:features/scheduler) bricks, written as text. Anything
> you can build by clicking, you can type — and anything you type, you can open back up as
> bricks.


**[Every action, condition and value](doc-page:features/bmmscript-reference)** — the full list, generated from BMM's own registry so it cannot go stale.

## Why it is not a separate language

BMMScript **compiles to the bricks**. It is not a second engine with its own actions: the
text you write is turned into exactly the steps the brick editor produces, and the same
runner executes them.

Three things follow, and they are the whole reason for the design.

- **It is never behind the bricks.** An action is written `do <name>(…)`, and the language
  holds no list of action names. An action added to BMM tomorrow is already writable today.
- **You can switch modes.** A task written in code opens as bricks; a task built from bricks
  prints as code. Neither direction loses anything.
- **It cannot do more than a brick can.** Permissions, variable substitution, loop limits
  and error handling are the runner's, unchanged. Code is a way to *write* an automation,
  not a way to get past its rules.

What it deliberately has **no** support for: your own functions, and recursion. Everything
else a brick can do, it can do — including variables, arithmetic and comparisons, which are
surface syntax over the `var.set`, `math.set` and `value` bricks rather than a second
evaluator.

## A whole task

```bmms
task "Nightly tidy" {
    every day at 03:00
    describe "Scan, then disable anything huge"
    allow script

    do mods.scan()

    if online and not modEnabled(id: "keep-me") {
        do notify(message: "Scanning…")
        wait 30s
    } else {
        stop
    }

    for item in enabledMods {
        try {
            do mod.disable(id: "{item.id}")
        } catch {
            do notify(message: "Could not disable {item.name}")
        }
    }
}
```

## The header

Everything before the first statement.

| Line | Means |
|---|---|
| `every day at 03:00` | daily, at that time |
| `every week on mon, fri at 09:30` | those days — `mon tue wed thu fri sat sun` |
| `every month on 1 at 00:00` | that day of the month |
| `every 30m` · `every 2h` | an interval. A whole number of hours becomes an hourly trigger |
| `once at "2026-01-01T09:00"` | a single moment |
| `on app start` | once per launch of BMM |
| `manual` | only when you press Run, or a deeplink fires it |
| `describe "…"` | the description shown in the list |
| `disabled` | keep the task, do not run it |
| `allow command, script, deeplink, stopProcess` | what the task may do outside BMM |

`allow` is the same four permissions as the brick editor's checkboxes, and it is required
for the same steps. A task that runs a script without `allow script` fails at that step,
exactly as a brick task would.

## Statements

### Actions

```bmms
do mods.scan()
do notify(message: "done", level: info)
do mod.disable(id: "{item.id}")
```

`do <action>(name: value, …)`. The action name is whatever the brick editor calls it, and
the parameter names are the ones its form uses — open a step as code once and you will see
the exact spelling for it.

Values are text in quotes, numbers, `true` / `false`, or a bare word (which is text —
`level: info` and `level: "info"` are the same thing).

### Choices

```bmms
if online { do mods.scan() }
if not fileExists(path: "C:\mods\out.txt") { do mods.scan() } else { stop }
if online and modEnabled(id: "x") { do mods.scan() } else if always { stop }
```

Conditions are written like actions. `and` / `or` combine them, `not` inverts one, and
brackets group. `a and b and c` is one group of three, which is what the brick editor shows.

### Variables and arithmetic

```bmms
set count = 0
set count = count + 1
set average = (a + b) / 2
set label = "hello"
shared set team = "red"
clear count
```

The rule for telling the two apart is the one you would guess: **a quoted value is text, an
unquoted one is a number**. `set n = 0` counts; `set s = "0"` is the character zero.

Numbers go through the same expression evaluator the `math.set` action uses — brackets,
`+ - * / % ^`, and its functions. Text goes to `var.set`, and `shared set` writes the
variable every task can read. `clear` removes one.

A name must be letters, digits and `_`, starting with a letter. Anything else is refused
while you type rather than at run time: a name the substituter cannot match back would store
something that looks saved and can never be read.

An expression ends at the end of the line. There is no line continuation — the alternative
is guessing where a statement stops.

### Comparing

```bmms
if count >= 3 { stop }
if disk.write_mbps < 50 { do notify(message: "slow disk") }
```

`== != > >= < <=` against a number or a name. This is the brick editor's compare row, so a
comparison written here opens there as one.

### Loops

```bmms
for item in enabledMods { do mod.disable(id: "{item.id}") }   # mods, enabledMods, disabledMods, profiles, modpacks, themes
for item in list "queue" { do notify(message: "{item.name}") } # a list you built with list.push
repeat 3 times { do mods.scan() }
repeat while online { wait 1m }
repeat until fileExists(path: "x") { wait 10s }
```

Inside a loop, `{item.id}` and `{item.name}` are replaced in every text value.
`break` leaves the loop, `continue` skips to the next item, `stop` ends the whole task.

### At the same time

```bmms
parallel {
    branch { do repo.sync() }
    branch { do benchmark.run() }
}

parallel settle {
    branch { do mods.checkUpdates() }
    branch { do mods.scan() }
}
```

Every branch starts together and the step finishes when they all have.

`parallel` on its own stops the step as soon as one branch fails — what a sequence would
have done. `parallel settle` lets them all finish and then tells you how many failed, which
is the honest choice for "do these five, tell me which ones did not work".

Branches share the task's variables. Two branches writing the same one race, and the last
write wins — so use them for work that does not depend on each other.

### Other tasks

```bmms
run "Nightly tidy"       # waits for it, and records whether it worked
spawn "Long download"    # starts it and carries on
```

`run` waits; a following `if lasttask.ok == 1` can branch on the result. `spawn` does not
wait, and refuses a task that is already running — including itself.

### Real code, inline

```bmms
script python {
    import os
    print(os.getcwd())
}

script bash {
    for f in *.zip; do echo "$f"; done
}
```

`powershell`, `cmd`, `bash`, `python`, `node`, `rust`. The body is taken **exactly as
written** — no escaping, no quoting, braces inside it are fine. It needs `allow script`, the
same as the block form.

Indentation is dedented by the common margin and restored when the file is printed back, so
Python keeps its shape through a round trip.

### Types

```bmms
set count: number = 0
set label: text = "hello"
```

Optional, and checked when you write it: `set n: number = "0"` is refused, so is
`set s: text = 5`. The runner has no types at run time, so this is the only place the
mistake can be caught at all — and it says what the variable is for the next reader.

### Waiting

```bmms
wait 30s                                    # also 5m, 2h, or a bare number of seconds
waitfor fileExists(path: "x") timeout 2h poll 10s
waitfor online timeout 30s orcontinue       # carry on instead of failing
```

### Making sure of something

For a task whose job is a **state** rather than a script. It fires on its schedule, finds
everything as it should be, and does nothing at all — then puts it right the day something
drifts.

```bmms
ensure modEnabled(id: "big-map-pack") {
    do mod.enable(id: "big-map-pack")
}

ensure fileExists(path: "{game}/config/ready.txt") {
    do script.run(engine: "powershell", code: "New-Item ...")
} orcontinue
```

!!! note "Why this is not `if not …`"

    An `if` runs its block and never looks back, so a fix that **failed** looks exactly like
    one that worked. `ensure` re-checks the condition afterwards, and a condition that is
    still false is a failure you can see.

    That is the whole value of a task that runs every hour: not that it does the work, but
    that it tells you the day it stopped being able to.

`orcontinue` keeps the run going after a failed `ensure` — for a task that makes sure of
several independent things and wants all of them attempted rather than stopping at the first
one it could not fix.

In the block editor this is the **Make sure of** brick.

### Values every task has

| Written | Is |
|---|---|
| `{date}` · `{time}` · `{now}` · `{stamp}` | Today, the clock, an ISO timestamp, and one a person can read. |
| `{nl}` · `{tab}` | A real newline and a real tab — a text field cannot hold either. |

A variable your task defines wins over a built-in of the same name, so adding these changed
nothing about a task that already had one.

### Saying what happened

```bmms
print "checking {n} mods"
do file.write(path: "report.txt", text: "{n} mods on {date}")
do file.write(path: "run.log", text: "done{nl}", append: true)
```

`print` puts a line in the running panel and in the task's `run.log`. It is the statement you
write twenty times while working out why a task did what it did — which is the difference
between a language you debug IN and one you debug by staring at.

**A relative path lands in the task's output folder.** An absolute path, or a place name like
`mods:notes.txt`, goes exactly where it says. A bare filename with no rule about where would
end up next to the executable: wrong, and hard to find afterwards.

The output folder defaults to a per-task folder inside BMM's own data, and can be set to
anywhere — including a place name, so "write into the folder that plugin ships" is one setting
rather than a path that breaks on the next machine.

!!! note "A relative path may not climb out"

    `../elsewhere/run.log` is refused. It is the one shape nobody writes by accident, and the
    only one that turns "write in my folder" into "write anywhere".

### Errors and branches

```bmms
try {
    do repo.sync()
} catch {
    do notify(message: "sync failed")
}

switch {
    case online { do repo.sync() }
    case fileExists(path: "cache.json") { do modlist.import() }
    default { do notify(message: "nothing to do") }
}
```

A `switch` runs the **first** case whose condition holds, then stops.

### Shared blocks

```bmms
call "repair/fetch"
```

Runs a named block from the scheduler's block store, inside this task and with this task's
permissions.

### Folders, for when there are eleven of them

A block name can hold a slash. `repair/fetch` and `repair/verify` sit in a `repair` folder in
the panel, and `call "repair/fetch"` runs it exactly as before.

By the time somebody has eleven blocks they have already invented a naming convention to group
them — `repair_fetch`, `repair_verify` — because the flat list gave them nowhere else to put
the structure. This is that convention, made real.

!!! note "Nothing stores the tree"

    It is read from the names every time. So renaming a block MOVES it, deleting the last block
    in a folder removes the folder, and there is no second structure that can end up disagreeing
    with the blocks it claims to describe.

A `.bmmpa` already carries the blocks a task calls, so exporting one exports its whole tree —
folders included, since the folders are the names.


## Comments

`//` and `#` both run to the end of the line.

## Running code from inside a brick workflow

You do not have to choose. The action **Run BMMScript (advanced)** takes a snippet with no
`task` wrapper:

```bmms
do mods.scan()
if online {
    do notify(message: "hello")
}
```

It runs as part of the surrounding task: same variables, same permissions, same loop
guards. The editor compiles it as you type and shows the line number of the first error, so
a mistake is found while you are looking at it rather than at 3 a.m.

## Running another language

BMMScript is for *BMM's own* steps. To run real code, use the **Run a script** action, which
takes PowerShell, CMD, Bash, Python, JavaScript (Node) or Rust. BMM bundles none of those —
the editor says whether each one can actually run on this machine, and which binary it
found, before you save the task.

Rust is compiled before it runs, so it starts far more slowly than the others; for a task
that fires every few minutes, one of the interpreted engines is usually the better answer.

## Sharing a script

A `.bmmscript` is a plain text file, so it shares like any other. Double-click one and BMM
opens it — it does **not** run it.

What you get is a review screen: the file is compiled first (a broken one names the line
rather than half running), every step is listed, and every `script` body is printed in full
rather than summarised as "runs a script".

Then one of two things:

- **It asks for nothing** — one click to run. Everything it can do, you could do by hand
  with the buttons already in the app, so running it adds no capability.
- **It grants itself something** — `command`, `script`, `deeplink` or `stopProcess` — and
  Run stays disabled until you tick *I have read what it does*. Those four are the only
  things a task can do that the app's own buttons cannot.

**Run it now** and **Add to my tasks** are separate buttons, because running a file once and
keeping it forever are different intentions. Neither inherits `osSchedule`: registering a
Windows scheduled task is your decision, never the file author's.

A file written by an older BMM that carries only the legacy permission flag is read
correctly — it reports what it really grants, not nothing.

## Errors

Every error names a line and a column. Two are worth knowing about because they look like
something else:

- **"There is more text after the task ended"** — almost always a `}` that closes one line
  too early. BMM refuses rather than quietly dropping the rest of your automation.
- **"`x` is given twice"** — a duplicated parameter. Keeping the last one silently would
  make a typo invisible.

## What round-tripping does not keep

Comments and blank lines. They are yours, not the task's, and the brick tree has nowhere to
put them: open a task as bricks and print it back as code, and the comments are gone. Keep a
copy of anything you would miss.
