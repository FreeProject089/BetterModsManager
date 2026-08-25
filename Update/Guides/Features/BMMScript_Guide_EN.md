# ⌨️ BMMScript — writing and sharing an automation as text

The scheduler builds automations from blocks. **BMMScript** is the same automation written as
text, in the task editor's **Code** tab.

This guide is about *doing things with it*. The complete list of every action, condition and
value is generated from BMM's own registry and lives in two places, so it can never describe a
version of the app that does not exist:

- in the app: **Help & other → BMMScript — every action, condition and value**
- on the site: the BMMScript reference page

---

## 🧠 The one thing worth understanding

BMMScript **compiles to the blocks**. It is not a second engine with its own actions — the
text becomes exactly the steps the block editor produces, and the same runner executes them.

Three things follow:

1. **It is never behind the app.** `do <name>(…)` takes whatever the block editor calls the
   action. The language holds no list of names, so an action added to BMM is writable in
   script the same day, with no update to the language.
2. **You can switch mid-task.** Write it in code, press **Blocks**, and it opens as blocks.
   Build it in blocks, press **Code**, and it prints as text.
3. **It cannot do more than a block can.** Permissions, variable substitution, loop limits and
   error handling belong to the runner. Code is a way to *write* an automation, not a way past
   its rules.

The one thing a round trip does not keep is **your comments and blank lines**. They are yours,
not the task's, and the block tree has nowhere to put them. Keep a copy of anything you would
miss.

---

## ✍️ A whole task

```text
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

The header — everything before the first statement — carries the trigger, the description, and
the permissions. `allow` is the same four checkboxes the block editor has, and it is required
for the same steps: a task that runs a script without `allow script` fails at that step,
exactly as a block task would.

---

## 🧩 What it can do

| | |
|---|---|
| Actions | `do <name>(k: v)` — every action the block editor has |
| Conditions | `if` / `else if` / `else`, with `and` · `or` · `not` and brackets |
| Loops | `for x in <source>`, `repeat N times`, `repeat while`, `repeat until` |
| At once | `parallel { branch { } branch { } }`, and `parallel settle` |
| Errors | `try { } catch { }` |
| Choice | `switch { case <cond> { } default { } }` |
| Variables | `set n = 0`, `set s = "text"`, `set n: number = 0`, `shared set`, `clear` |
| Maths | `+ - * / % ^`, brackets, and the expression evaluator's functions |
| Comparing | `== != > >= < <=` |
| Waiting | `wait 30s`, `waitfor <cond> timeout 2h poll 10s orcontinue` |
| Blocks | `call "my shared block"` |
| Other tasks | `run "T"` (waits), `spawn "T"` (does not) |
| Real code | `script python { … }` — PowerShell, CMD, Bash, Python, Node or Rust |
| Flow | `break`, `continue`, `stop` |

Deliberately absent: **your own functions, and recursion.**

---

## 🖊️ Writing in the editor

- It **compiles as you type** and shows the first error with its line and column.
- The caret is moved to an error only when you **ask** — pressing Blocks, or Save. Never while
  you are typing: half a line is a syntax error, and a box that throws your cursor across the
  file mid-sentence is unusable.
- The line you are **currently on** is left alone by the live check. Move away and the error
  appears.
- **Completion**: actions after `do`, engines after `script`, lists after `in`, conditions and
  values in a condition slot. It stays shut inside a string and inside a `script` body.
  **Enter never accepts a suggestion** — Enter is a newline. **Tab** accepts. `Ctrl+Space`
  asks for the list.
- Saving from the Code tab saves the **code**, not the blocks it replaced.

---

## 📤 Sharing a `.bmmscript`

A `.bmmscript` is a plain text file. Send it however you like.

Double-click one and **BMM opens it — it does not run it.** You get a review screen:

- the file is **compiled first**, so a broken one names the line rather than half running;
- every step is listed;
- every `script` body is printed **in full**, not summarised as "runs a script".

Then one of two things:

| The file | What you can do |
|---|---|
| asks for nothing | **Run it** in one click — everything it does, you could do with the app's own buttons |
| grants itself `command`, `script`, `deeplink` or `stopProcess` | Run stays **disabled** until you tick *I have read what it does* |

Those four capabilities are the only things a task can do that the app's own buttons cannot.

**Run it now** and **Add to my tasks** are separate buttons, because running a file once and
keeping it forever are different intentions.

### What "Add to my tasks" actually adds

The task arrives **disabled**, with all four permissions **removed**, and never registers a
Windows scheduled task. BMM then tells you what the file had asked for.

That is not a restriction on you — it is the difference between choosing to run something and
finding out afterwards that it has been running on a timer since Tuesday. Turn on what you
want and enable it.

---

## 🧪 Checking one before you publish

The developer tools on BetterCommunity have a `.bmmscript` checker: unbalanced braces, and
names BMM does not have. It is **not** the compiler — BMM has the only one — so a file it
accepts can still fail to compile. It catches the two mistakes that are worth catching before
somebody else downloads the file.

---

## 🔁 Running code from inside a block workflow

You do not have to choose. The action **Run BMMScript (advanced)** takes a snippet with no
`task` wrapper:

```text
do mods.scan()
if online {
    do notify(message: "hello")
}
```

It runs as part of the surrounding task: same variables, same permissions, same loop guards.

---

## ⚠️ Two errors worth recognising

- **"There is more text after the task ended"** — almost always a `}` that closes one line too
  early. BMM refuses rather than quietly dropping the rest of your automation.
- **"`x` is given twice"** — a duplicated parameter. Keeping the last one silently would make
  a typo invisible.
