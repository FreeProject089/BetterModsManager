# `app.cfg`

A flat text file, next to the executable, that decides how a **build** behaves: whether the
debug menu exists, whether it can update itself, whether the blog talks to a local server.
It is read by the Rust side at startup and never written back — BMM does not modify it, and
nothing in the interface changes it. To change one of these, edit the file and restart.

Settings you change from inside the app live somewhere else entirely (the profile store);
this file is for the person who *builds or ships* BMM, not for the person using it.

```ini
Prod=true
PTB=true
DisableUpdate=false
EnableBenchmark=true
FSDM=true
AutoEULA_on_first_Start=true
BCTestMode=false
BCTestBase=http://localhost:5176
```

That is the file as shipped. It is also the file in
`BetterInstaller/examples/bmm/payload/_up_/app.cfg`, and the two are byte-identical — keep
them that way, or an installed BMM behaves differently from a built one.

---

## Read this before you edit it

**There is no comment syntax.** Not `#`, not `//`, not `;`. Most of these keys are matched by
searching the *whole lowercased file* for a substring, so a line you thought you had
commented out still counts:

```ini
#Prod=false        <- the file contains "prod=false". Debug mode is ON.
```

To disable a flag, delete the line or write the other value. Never comment it out.

**Spaces around `=` break most keys, and not the others.** The file is parsed twice, by two
different pieces of code, and they do not agree:

| Parser | Keys | Does `Key = value` work? |
|---|---|---|
| substring search over the lowercased file | `Prod`, `PTB`, `DisableUpdate`, `FSDM`, `AutoEULA_on_first_Start`, `quicklink1_disabled`, `quicklink2_disabled` | **No** — silently reads as the default |
| line parser, splits on the first `=`, trims both sides | `BCTestMode`, `BCTestBase` | Yes |

So `BCTestMode = true` works and `PTB = true` does not, in the same file, with no warning
either way. Write every key tight: `Key=value`.

**Key names are case-insensitive**, because the substring parser lowercases the file first
and the line parser lowercases the key. `PTB=true`, `ptb=true` and `Ptb=true` are the same.

**Values are not free-form.** Except for `BCTestBase`, the only value that ever does anything
is the one listed below. `Prod=false` turns debug mode on; `Prod=maybe`, `Prod=0` and
`Prod=true` are all merely "not `prod=false`", which is off.

**A missing file is not an error.** Every flag defaults to `false` and the app starts
normally: no debug menu, updates enabled, no PTB, no auto-EULA — the shape of a plain
release build. So if a flag seems to be ignored, first check the file is being found at all.

---

## Where the file is looked for

`resolve_path()` tries these in order and stops at the first that exists:

1. `app.cfg` in the resource directory
2. `_up_/app.cfg` in the resource directory — **where a packaged BMM finds it**
3. `frontend/app.cfg`, then the bare filename
4. climbing up to five directories from the resource directory — **where `tauri dev` finds it**
5. `app.cfg` relative to the working directory

Two consequences worth knowing. In development it finds the `app.cfg` at the repository
root, so editing that one changes `npm run dev`. And because plain `app.cfg` is tried before
`_up_/app.cfg`, a stray copy sitting beside the executable **wins over the bundled one** —
a convenient way to override a shipped build, and an easy way to be confused by a file you
forgot you left there.

---

## The keys

### `Prod`

`Prod=false` turns **debug mode** on: the debug menu appears in the interface, along with the
developer tooling it gates.

The name reads backwards, so read it twice. `Prod=true` does not *enable* anything — it
merely fails to contain `prod=false`. Deleting the line has exactly the same effect.

This is separate from whether the binary is a debug build. WebView2's right-click "Inspect"
and F12 are allowed by `is_dev_build()`, which is a compile-time fact (`cargo run` yes,
`tauri build` no) and ignores this file completely.

### `PTB`

`PTB=true` marks the build as a **public test build**. It changes what the update screen
offers and what the update notes show — a PTB follows the test channel rather than the
stable one.

### `DisableUpdate`

`DisableUpdate=true` switches the **self-update check** off entirely. Nothing is contacted and
nothing is offered. Intended for builds distributed by someone else — a package manager, a
corporate deployment — where the app updating itself would fight whatever is actually
managing it.

This is separate from `links.json`'s `autoupdate_api`, which changes *where* the check looks.
This one decides whether it happens at all.

### `FSDM`

`FSDM=true` reveals the **full-screen debug menu**, a heavier developer surface than the one
`Prod=false` provides. Independent of `Prod`: either flag alone shows its own menu.

### `AutoEULA_on_first_Start`

`AutoEULA_on_first_Start=true` shows the licence agreement automatically on first launch, so a
fresh installation asks for acceptance before anything else. With it off, the licence is
still readable from Help & Other; it just is not pushed at the user.

### `BCTestMode` and `BCTestBase`

The pair that points the in-app blog and community screens at a **local or staging
BetterCommunity** instead of the real site.

```ini
BCTestMode=true
BCTestBase=http://localhost:5176
```

`BCTestBase` accepts a host with or without a port. When `BCTestMode` is `false` — or when the
file is missing — the app uses the production `bettercommunity` address from `links.json`,
and `BCTestBase` is ignored entirely. Leaving a stale `BCTestBase` in the file is harmless;
leaving `BCTestMode=true` in a shipped build is not, because every user's blog would point at
a machine that is not theirs.

Read once at startup, after the Tauri bridge is up. Changing it needs a restart.

---

## Keys that are in the file, or in the code, and do nothing

Written down rather than quietly dropped, because a config key that looks live and is not
costs somebody an afternoon.

### `EnableBenchmark` — nothing reads it

It is in the shipped `app.cfg`. Searching the whole repository — Rust, TypeScript, build
scripts — finds no reader of any spelling of it. Setting it to `true` or `false`, or deleting
the line, has no effect on anything.

The benchmark suite in `benchmarks/` is run from the command line and does not consult this
file. Leave the line if you like the symmetry; just do not expect it to switch anything on.

### `quicklink1_disabled` and `quicklink2_disabled` — the reader no longer loads

These hide the two shortcut cards (Discord, GitHub) at the top of Help & Other, and the Rust
command that reads them, `get_quicklinks_config`, still works. But its only caller is
`frontend/src/docs/docs-ui.ts`, which nothing has imported since Help & Other was rebuilt
around `docs-hub.ts`. The command is therefore never invoked, and the flags never take
effect.

They are absent from the shipped file, which is why nobody has noticed. Adding them will not
hide the cards. Either the hub needs to call `get_quicklinks_config`, or the command and the
keys should go — that is a decision, not a bug fix, so it is recorded here rather than made.

---

## Checking what a build actually read

The values are visible from inside the app rather than inferred:

- **Settings → Debug** shows BetterCommunity test mode and its base URL, read-only.
- **Settings → Debug → resource paths** (`get_resource_debug_info`) prints every path tried
  for `app.cfg` and whether it exists — the fastest way to discover that a flag "does not
  work" because the file being read is not the file you edited.
- The log records `[DEBUG_SYSTEM] Resolution: … is_debug: …` at startup, and
  `[BC] test_mode=… base_url='…'`. If you see `app.cfg could not be resolved`, then no flag
  in this document is in effect.
