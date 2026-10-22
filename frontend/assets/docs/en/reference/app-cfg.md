# `app.cfg` — the build's own switches


A flat text file next to the executable that decides how a **build** behaves: whether the
debug menu exists, whether the app may update itself, whether the blog talks to a local
server instead of the real site.

It is read once at startup and never written back. Nothing in the interface changes it — to
change one of these, edit the file and restart. Settings you change from inside BMM live
somewhere else entirely; this file is for whoever *builds or ships* BMM.

Everything below is taken from `src-tauri/src/commands/settings.rs` and
`src-tauri/src/fs_utils.rs`. Where they disagree with this page, they are right and this
page is a bug.

## The file as shipped

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

The copy in `BetterInstaller/examples/bmm/payload/_up_/app.cfg` is byte-identical. Keep it
that way, or an installed BMM behaves differently from a built one.

## Three things that will catch you out

!!! danger "There is no comment syntax"

    Not `#`, not `//`, not `;`. Most keys are matched by searching the **whole lowercased
    file** for a substring, so a line you thought you had commented out still counts:

    ```ini
    #Prod=false
    ```

    That file contains `prod=false`. Debug mode is **on**. To disable a flag, delete the line
    or write the other value.

!!! warning "Spaces around `=` break most keys, and not the others"

    The file is parsed twice, by two different pieces of code, and they do not agree.

    | Parser | Keys | Does `Key = value` work? |
    |---|---|---|
    | substring search over the lowercased file | `Prod`, `PTB`, `DisableUpdate`, `FSDM`, `AutoEULA_on_first_Start`, `quicklink1_disabled`, `quicklink2_disabled` | **No** — silently reads as the default |
    | line parser, splits on the first `=` | `BCTestMode`, `BCTestBase`, `BCApiVersion`, `BCv2Base`, `DocsReplays` | Yes |

    So `BCTestMode = true` works and `PTB = true` does not, in the same file, with no warning
    either way. Write every key tight: `Key=value`.

!!! note "A missing file is not an error"

    Every flag defaults to `false` and the app starts normally — no debug menu, updates
    enabled, no PTB, no auto-EULA. That is the shape of a plain release build, so a flag that
    "does nothing" is usually a file that was never found.

Key names are case-insensitive. Values are not free-form: apart from `BCTestBase`, the only
value that ever does anything is the one listed below. `Prod=maybe` and `Prod=true` are both
merely "not `prod=false`" — that is, off.

## Where the file is looked for

`resolve_path()` tries these in order and stops at the first that exists:

| # | Path | Matters because |
|---|---|---|
| 1 | `app.cfg` in the resource directory | A stray copy here **wins over the bundled one** |
| 2 | `_up_/app.cfg` in the resource directory | Where a packaged BMM finds it |
| 3 | `frontend/app.cfg`, then the bare filename | |
| 4 | up to five directories above the resource directory | Where `tauri dev` finds the repository root copy |
| 5 | `app.cfg` beside the working directory | Last resort |

Because 1 is tried before 2, dropping an `app.cfg` next to the executable is a supported way
to override a shipped build — and an easy way to be confused by a file you forgot you left
there.

## The keys

| Key | Value that does something | Effect |
|---|---|---|
| `Prod` | `Prod=false` | Shows the **debug menu**. Reads backwards: `Prod=true` enables nothing, it merely fails to be `prod=false`. |
| `PTB` | `PTB=true` | Marks the build as a **public test build** — the update screen and update notes follow the test channel. |
| `DisableUpdate` | `DisableUpdate=true` | Switches the **self-update check** off entirely. Nothing is contacted, nothing is offered. |
| `FSDM` | `FSDM=true` | Shows the **full-screen debug menu**, a heavier surface than `Prod=false` gives. Independent of `Prod`. |
| `AutoEULA_on_first_Start` | `=true` | Shows the licence automatically on first launch. With it off the licence is still readable from Help &amp; other. |
| `BCTestMode` | `BCTestMode=true` | Points the in-app blog and community screens at `BCTestBase` instead of the real site. |
| `BCTestBase` | any host, port optional | The staging or local base, e.g. `http://localhost:5176`. Ignored unless `BCTestMode=true`. |
| `BCApiVersion` | `BCApiVersion=v2` (or `2`) | Moves what has a **BetterCommunity v2** adapter to v2, once v2 answers its health check. `v1` pins v1 whatever links.json says. Absent: links.json's `bc_api`, else v1. See below. |
| `BCv2Base` | an `https://` address | Where v2 lives. Empty or missing: links.json's `bc_v2_base`, else production. |
| `DocsReplays` | `DocsReplays=false` (or `off`) | Removes every session replay (`.bmmreplay`) from the documentation in Help &amp; other. |

`DisableUpdate` decides *whether* the update check happens; `links.json`'s `autoupdate_api`
decides *where it looks*. They are unrelated — see
[Where BMM's links come from](doc-page:reference/links-and-updates).

`Prod` is also unrelated to whether the binary is a debug build: WebView2's right-click
"Inspect" and F12 are gated by a compile-time fact (`cargo run` yes, `tauri build` no) that
ignores this file.

Leaving a stale `BCTestBase` in a shipped file is harmless. Leaving `BCTestMode=true` is not
— every user's blog would then point at a machine that is not theirs.

## BetterCommunity v2: `BCApiVersion` and `BCv2Base`

The switch for **BetterCommunity v2**. Neither key is in the shipped file. Since BMM 1.0.4 the
same switch can also come from the links file BetterCommunity publishes (`bc_api`,
`bc_v2_base` in [links.json](doc-page:reference/links-and-updates)), so installed copies follow v2 the day it goes
live. **This file wins**: a `BCApiVersion` line here decides whatever links.json says, and
`BCApiVersion=v1` keeps this install on v1. Without the line here and without `bc_api` in
links.json, BMM is on v1 and nothing changes.

```ini
BCApiVersion=v2
BCv2Base=https://v2.example.org
```

`BCApiVersion=v2` (or `2`, any case) asks for v2. BMM then checks `GET <base>/v2/health` once at
start; if v2 does not answer `ok` or `degraded`, the session stays on v1 and the log says why. On
v2, what has a v2 adapter moves: feedback and bug reports, [consent
receipts](doc-page:features/privacy-telemetry#proof-of-consent-my-consents) and the legal texts, the
account sign-in, notifications, the Community page, Laya's suggestions, app telemetry and signed
catalogue feeds; the v1 paths v2 serves itself are read from v2. Avatars, launch announcements,
author search and the Discord link stay on the v1 address. Any other value is v1. The whole list
is in [BetterCommunity v2](doc-page:features/community#bettercommunity-v2).

`BCv2Base` is where v2 lives; empty or missing means links.json's `bc_v2_base`, else the test
base in test mode, else production. It must be `https://`, or plain `http://` to this machine
only (`localhost`, `127.0.0.1`, `*.localhost`); anything else is refused and the session stays
on v1. Both keys are read once at start-up: changing them needs a restart.

Telemetry has no switch of its own: every batch BMM sends (only with your consent) is wrapped
in a versioned envelope (`"schema": "bmm-telemetry"`, `"v"`). The two fields carry no data
about anybody; a server that predates them ignores them, a newer one reads `v` first.

## Keys that are there and do nothing

Written down rather than quietly dropped, because a config key that looks live and is not
costs somebody an afternoon.

**`EnableBenchmark`** is in the shipped file and **nothing reads it**. Searching the whole
repository — Rust, TypeScript, build scripts — finds no reader of any spelling. Setting it,
clearing it or deleting the line changes nothing. The benchmark suite is run from the command
line and does not consult this file.

**`quicklink1_disabled`** and **`quicklink2_disabled`** hide the two shortcut cards at the top
of Help &amp; other, and the Rust command that reads them still works — but its only caller is
a module that nothing has imported since Help &amp; other was rebuilt. The command is never
invoked, so the flags never take effect. They are absent from the shipped file, which is why
nobody has noticed; adding them will not hide the cards.

## Checking what a build actually read

- **Settings → Debug** shows BetterCommunity test mode and its base URL, read-only.
- **Settings → Debug → resource paths** prints every path tried for `app.cfg` and whether it
  exists — the fastest way to discover that the file being read is not the file you edited.
- The log records `[DEBUG_SYSTEM] Resolution: … is_debug: …` at startup and
  `[BC] test_mode=… base_url='…'`. `app.cfg could not be resolved` means no flag on this page
  is in effect.
