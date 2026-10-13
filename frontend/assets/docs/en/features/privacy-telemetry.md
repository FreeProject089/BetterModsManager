# Privacy, telemetry & offline


## Telemetry is opt-in

Until you explicitly accept the consent dialog, **nothing is collected at all** — the tracker
is a no-op. Declining (or never answering) collects zero data, and declining also wipes
anything previously buffered.

The dialog has four buttons and nothing else counts as an answer (a click beside it does nothing):

| Button | What it does |
|---|---|
| **Turn all on** (recommended) | The five categories below |
| **Choose** | A switch per category, then *Save* |
| **No thanks** | Off, remembered |
| **Later** (or Escape) | Nothing saved, nothing sent; asked again at the next launch |

### If you installed with BetterInstaller

The installer asks the same question first, on its **Privacy & data** step, the way a cookie
banner does. Nothing is pre-selected, and Install stays greyed out until you pick one:

| Card | What BMM starts with |
|---|---|
| **Essential only** | No telemetry, no session replay, no hardware report, no Discord status. Update checks stay on |
| **Accept all** | Every telemetry category, masked session replay and Discord Rich Presence. **Not** the weekly hardware report: only *Customize* can turn that one on |
| **Customize** | A switch per category, each saying what it sends and to whom, starting from the card you had picked |

The installer writes your answer into `installer-handoff.json`, and BMM reads it once on its
first launch: an answer that turns telemetry on is your consent, so the dialog above does not
appear; *Essential only* is recorded as a refusal. Either way, Settings → Privacy changes any of it
later.

The installer also downloads the **Laya offline** model during setup (327 MB from the project's
GitHub release, checked against a pinned SHA-256). That option is ticked by default and sends
nothing about you; *Not now* skips it.

```mermaid
flowchart TD
    CONSENT{"Telemetry<br/>accepted?"} -- "no or not asked" --> NOTHING(["Nothing collected"])
    CONSENT -- "yes" --> EVENTS["Events: pages, clicks,<br/>perf, errors"]
    CONSENT -- "yes" --> REPLAY["Masked replay<br/>(own switch)"]
    EVENTS --> QUEUE[("Local queue<br/>jsonl, 10 MB cap")]
    REPLAY --> QUEUE
    QUEUE -- "Export" --> EXPORT(["JSON file"])
    QUEUE --> ENDPOINT{"HTTPS endpoint<br/>configured?"}
    ENDPOINT -- "no" --> LOCAL(["Stays on disk"])
    ENDPOINT -- "yes" --> GZIP["Gzip batch<br/>+ packet id"]
    GZIP --> SERVER(["Telemetry server"])
    GZIP -- "listed" --> SENT[("Sent packets")]
    SENT --> DEL["Deletion request<br/>(within 72 h)"]
    DEL --> SERVER
```

## If you opt in

Telemetry is split into categories, each with one line of what it sends:

| Category | What is sent |
|---|---|
| Usage statistics | Pages and features used, clicks, session length. Never what you type |
| Performance | FPS, memory use and load times |
| Errors, live | Errors and crashes as they happen ([below](#errors-sent-live)) |
| Laya usage statistics | Which Laya feature, provider, speed, fields kept or rejected; never any text ([below](#laya-usage-statistics)) |
| Session replay (masked) | The BMM window only, typed text masked |

Two options are never part of *Turn all on*: the **weekly hardware report** (precise hardware
IDs) and **unmasked replay**. The full list, with what each one contains, is in the
[privacy policy](https://github.com/FreeProject089/BetterModsManager/blob/main/PRIVACY.md).

**No IP or location lookup.** BMM does not put an IP address in what it sends (neither the local
one nor the public one) and never asks a third-party service where you are. The telemetry server
only sees the address the connection comes from, like any web server, and keeps it cut down to its
network.

- **Session replay** (on by default when telemetry is on) records the UI **masked**:
  mod names, profile names and paths appear as `••••`. Unmasking is a separate, explicit toggle.
- Everything buffers to a **local file (10 MB cap)** first and is only uploaded as gzip batches
  over **HTTPS** — if no endpoint is configured, data never leaves your machine.

## What a session replay actually looks like

Rather than describe it, here is one. This is a real `.bmmreplay` played back in the browser by the
same rrweb player the app uses — the DOM is replayed, so it is **not a video**: text stays text, and
you can see the masking in action.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/bmm-demo.bmmreplay" data-page="features/privacy-telemetry" data-title="A masked BMM session, replayed in the browser"></div>

!!! note "It loads on demand"

    The player only fetches the recording when you press play — a replay is a JSON event stream and
    this one is around 25 MB, so it is never pulled in just by opening the page.

Notice that mod and profile names read as `••••`. That is the default masking, and it is what gets
recorded — the unmasked values never enter the file at all, so there is nothing to leak later. The
*Full* switch is what changes that, and it is deliberately separate.

### Where a recording lives while it is being made

The **local session recorder** (the one that feeds crash reports and the replay list) writes to disk
as it goes rather than holding the session in the app:

| | |
|---|---|
| While recording | Events are appended to a spool under `Spool/` in the app-data folder, in batches of at most 512 KB or 200 events, flushed at least every 3 seconds |
| Memory cost | About half a megabyte, whatever the session length — the assembled `.bmmreplay` is never built inside the app, even when you export it |
| History kept | A rolling **512 MB** window on disk. Oldest segments are dropped first, and each segment starts with a full snapshot, so what remains always plays |
| If BMM is killed | At most the last few seconds are missing. A half-written final entry is detected and skipped when the file is assembled |
| Saved replays | Capped separately by your retention settings (count + total size) |

This is why a long or idle session no longer costs you anything: it used to keep everything in memory
and re-serialise all of it every 45 seconds, which is what made a long session expensive and forced
it to throw history away.

!!! note "The DevTools Replay Studio works differently"

    The Studio (a deliberate, attended recording with a capture frame, pause/resume and a trim) keeps
    its events in memory, because it needs them to compress pauses and apply the trim. It is bounded
    at 64 MB and **stops the take** when it gets there, telling you so — what it already has is
    complete and playable.

## Errors sent live

A separate switch, **Send errors live**, lets BMM tell the team about an error within seconds
instead of waiting for a bug report. It only works while telemetry is on: turning telemetry off
stops it and deletes what was waiting to be sent.

- **On with telemetry.** Accepting telemetry turns it on (*Turn all on*, or the master toggle in
  Settings). *Choose* lets you leave it off, and Settings → Privacy turns it off on its own.
- **What is sent.** JavaScript errors, crashes of the Rust side, commands that failed with a real
  error (a cancel, being offline or a message already shown to you are not reported), and failed
  deploys, installs, backups and scheduled tasks. For each: the error message, where it happened
  in BMM's own code (function and file, no line numbers), the BMM version and the OS. For a crash,
  the *name* of the local crash report, never its content.
- **Cleaned on your PC first.** Every secret BMM stores (tokens, keys, your BetterCommunity key),
  your user-folder name, e-mail addresses, IP addresses and your PC name are removed before
  anything leaves. The telemetry server removes them a second time on arrival.
- **Grouped, not repeated.** The same error again within 10 minutes only adds 1 to a counter. At
  most 60 new errors an hour are sent, the waiting list is capped at 200 distinct errors, and it is kept on
  disk so an offline PC sends it later.
- **Not linked to your other telemetry.** The report carries a one-way hash of your install id,
  which the dashboard cannot match to anything else. A data request or an erasure still covers it.

```mermaid
flowchart TD
    ERR(["Error, crash,<br/>failed command"]) --> SWITCH{"Telemetry and<br/>Send errors live?"}
    SWITCH -- "no" --> DROP(["Nothing"])
    SWITCH -- "yes" --> CLEAN["Secrets, folder names,<br/>e-mails, IPs removed"]
    CLEAN --> SEEN{"Same fingerprint<br/>waiting?"}
    SEEN -- "yes" --> COUNT["Its count + 1"]
    SEEN -- "no" --> QUEUE[("Queue on disk<br/>200 errors max")]
    COUNT --> QUEUE
    QUEUE --> SEND[["Sender: new in 3 s,<br/>others every 60 s"]]
    SEND --> SERVER(["Telemetry server:<br/>Issues"])
```

## Laya usage statistics

A category of its own, so the team can see whether Laya actually helps. Content-free: for each use
of a Laya feature, BMM sends the feature, where it ran (built in, BetterCommunity server, your own
server, an external API, or rules), a latency range, whether it answered or declined, the **names**
of the fields it suggested and which ones you kept, how many Ask Laya results there were and the
*kind* of result you opened, model install / removal, and errors as short codes.

Never your question, a suggestion's value, a mod, file or profile name, an id or an error message.
The team reads it on the telemetry dashboard's **Laya** page (adoption, acceptance per field,
latency, providers, errors).

## Proof of consent: My consents

Every answer about the Terms, the Privacy Policy and telemetry leaves a **receipt**: the document,
its version, the SHA-256 of the exact text you were shown, the language, the answer (and each
category), the time, where you answered (installer, first launch, Settings, a `bmm://` link, the
local API, the CLI, the MCP server, an import) and the BMM version. It is keyed by a random install
id, not by your Creator ID or your hardware.

| | |
|---|---|
| Where | `consent-ledger.jsonl` in BMM's data folder: append-only, each receipt chained to the one before it and sealed with a local key, so an edited, removed or inserted line is detected |
| See it | Settings → Privacy → **My consents**: every receipt, whether the chain is intact, **Export (JSON)** |
| Asked again | When a document changes, or when BMM finds an answer with no receipt for the version in force (an update from 1.0.x, imported settings): telemetry goes back to "not asked" and the documents are shown again |
| Server copy | Sent to the telemetry server **only while telemetry is on**, or when you press **Send to the server**. Stored append-only, without IP address or text; erasure by install id |

## Your controls (Settings → Privacy)

- Master toggle, then one switch per category (with **Turn all on** while one is off), plus the
  weekly hardware report and unmasked replay.
- **Export** the raw buffer as JSON any time.
- See every **sent packet** (event names and counts only) and request its **deletion** —
  honoured within 72 hours.
- **My consents**: your consent receipts, their check, export and *Send to the server*.

Crash reports and saved session replays stay **local** under retention limits you control
(default: 30 sessions / 2 GB) — a crash report is only ever shared when *you* export or send it.

## Offline mode

BMM doesn't just trust the OS "connected" flag — it **probes** two lightweight endpoints; if
neither answers within 5 seconds, you're offline.

- A discreet **"no connection" banner** appears. It is a notice, not a lock: network features
  (repo syncs, catalogs, update checks) are not switched off, so one you start while offline fails
  with its own error.
- **Everything local keeps working** — library, profiles, activation, the mapper, themes.
- Recovery is automatic: while offline BMM re-probes every **15 seconds**, and a re-check every
  2 minutes, online or not, catches connections that died silently.

```mermaid
flowchart TD
    START(["Startup or<br/>online event"]) --> NAV{"navigator.onLine?"}
    TIMER["Re-check: 15 s offline,<br/>120 s always"] --> NAV
    NAV -- "true" --> PROBE{"gstatic, then Cloudflare:<br/>answer within 5 s?"}
    NAV -- "false" --> OFF["Offline"]
    OSOFF(["OS offline event"]) --> OFF
    PROBE -- "yes" --> ON(["Online, banner hidden"])
    PROBE -- "no" --> OFF
    OFF --> BANNER(["No connection banner"])
```
