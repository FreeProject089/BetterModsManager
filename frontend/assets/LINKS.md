# `links.json` — every key, what reads it, and what breaks if it is wrong

Every external URL BMM touches lives in one file so it can be changed without a release.
This document was written by tracing each key to its actual consumer, not from the file's own
comments — and that turned up six keys that nothing reads. Those are marked.

---

## Where the file comes from

BMM loads `links.json` from four places, first success wins:

| # | Source | When it is used |
|---|---|---|
| 1 | `https://bettercommunity.ch/api/assets/links.json` | Always tried first. **This is the copy to edit** — BetterCommunity → Admin → Downloads & assets. |
| 2 | `https://raw.githubusercontent.com/.../Tdev/frontend/assets/links.json` | BCWEB unreachable. |
| 3 | `assets/links.json` (this file, bundled in the app) | Both unreachable — offline, or a first run with no network. |
| 4 | `DEFAULTS` in `frontend/src/core/links-config.ts` | The file is missing or unparseable. |

The chain lives in `links-config.ts`. Set any URL there to `''` to skip that source.

**Editing this bundled file only affects installs that cannot reach 1 or 2.** For a change
that reaches everybody today, edit the BCWEB copy.

---

## Data sources

### `plugin_catalog`
The plugin catalogue feed. Read by `catalog-index.ts`, `plugins.ts`, and Rust `plugins.rs`.
Wrong or unreachable → the plugin browser is empty. It does not fall back.

### `plugin_github`
Where "View on GitHub" goes from the plugin screen. Cosmetic; a bad value is a dead link.

### `apps_catalog`
The Better\* app catalogue (BMM, BSM, the installer). Read by `apps-catalog.ts`,
`catalog-index.ts`, Rust `apps.rs`. Unreachable → the apps tab shows nothing.

### `server_browse`
The public list of Server-Repos, shown in Browse. Read by `repo.ts`. Unreachable → an empty
browse list; hosting and syncing your own repos still work, because those use their own URLs.

### `preset_catalog`
The official scheduler-automation feed. Read by `scheduler.ts`. Point it at a tunnel to test
against a BCWEB that is not the production domain.

### `contributors`
The credits list. Read by `app.ts` and Rust `net.rs`. Unreachable → the credits screen falls
back to whatever is bundled.

### `feedback_endpoint`
Where **Settings → Feedback & bug reports** posts. Read by `features/feedback/bc-feedback.ts`.
Default: the BetterCommunity feedback centre for project `bmm`
(`https://bettercommunity.ch/api/feedback/bmm`). Point it at a tunnel to test against a local
BCWEB. Set it to `""` to send through the BetaHub client instead (the pre-2026 pipeline, kept
as a fallback). Unreachable → the report is queued locally and retried on the next start.

### `feedback_web`
The page a linked user opens to follow their reports (the history list links there).
Default `https://bettercommunity.ch/dashboard?s=reports`.

---

## Updates

### `autoupdate_api` · `autoupdate_api_fallback`
The release feed. **Primary first; the fallback is tried only when the primary is unreachable
or rate-limited.**

```
autoupdate_api          https://api.github.com/repos/FreeProject089/BetterModsManager/releases
autoupdate_api_fallback https://bettercommunity.ch/api/updates/bmm
```

Read by `update-notes.ts`, passed to Rust `check_for_update`.

**Why a fallback exists.** GitHub allows **60 unauthenticated API calls per hour per IP**.
Behind a shared address — a company, a campus, a CGNAT mobile provider — that budget is spent
by other people, and BMM reported a network error for the rest of the hour.

**When it falls back:** connection failure, 5xx, 403 or 429 (rate limit).
**When it does NOT:** a 404. That means the feed genuinely has no release, and the other
source almost certainly has none either.

**The two feeds have different paths, and BMM handles both** — this is the trap to know
about if you ever point these somewhere else:

| | release list | latest release |
|---|---|---|
| GitHub (`…/releases`) | `<base>` | `<base>/latest` |
| BCWEB (`…/updates/bmm`) | `<base>/releases` | `<base>/latest` |

Swapping one base for the other naively gives a 404 on the list — and a 404 is read as
"no release", so the failure would look like *you are up to date* rather than like an error.
`release_url()` in `autoupdate.rs` picks the right shape by checking whether the base ends
with `/releases`.

Set `autoupdate_api_fallback` to `""` to disable it. An older `links.json` without the key
behaves the same way.

---

## Telemetry (opt-in)

### `analytics_endpoint`
PostHog-compatible capture endpoint. Read by `analytics.ts`.
**Empty = nothing leaves the machine.** Events stay buffered locally. That is the switch to
use to turn collection off for everybody without shipping a release.

### `analytics_key`
The **public** ingest key (`bmm_pk_…`). It only permits *submitting* telemetry and already
ships inside the app, so it is not a secret. The private admin key — deletion approvals, goal
writes — lives only on the telemetry server and is never in this file.

---

## Discord Rich Presence

Read by Rust `discord.rs`. Two buttons, each choosing between two configured URLs:

| Key | Meaning |
|---|---|
| `WebSiteRPC1` / `WebSiteRPC2` | Candidates for button 1 ("Website"). The chosen one gets `?creator=<id>` appended at runtime. |
| `github_RPC1` / `github_RPC2` | Candidates for button 2 ("GitHub"). |
| `BoutonRPC1` | Which website link to use: `1` or `2`. |
| `BoutonRPC2` | Which GitHub link to use: `1` or `2`. |

`BoutonRPC1`/`2` accept a number or a string (`"1"`); anything else defaults to 1.

These six are the only keys **absent from the `BmmLinks` TypeScript interface**, and that is
correct rather than an omission: nothing in the frontend reads them, so `links-config.ts`
says so in a comment instead of declaring fields no TypeScript ever touches. Rust parses the
JSON itself.

---

## How the community links reach a user

Every external URL in `frontend/index.html` carries `data-link-key="<key>"`, and
`patchHtmlLinks()` in `app.ts` rewrites it from the registry once the file has loaded. A
rotated Discord invite or a moved forum thread therefore reaches installed copies without a
release — which is the whole point of the file.

| Key | Where it appears |
|---|---|
| `github_repo` | credits card; the BetterCommunity screen |
| `reddit` | credits card |
| `ed_forum` | credits card |
| `kofi_community` | quicklink card 2; the BetterCommunity screen |
| `bettercommunity` | credits card; the BetterCommunity screen; `repo-sync.ts` |
| `discord` | credits card; the crash report; quicklink card 1; the BetterCommunity screen |
| `kofi` | credits card; `kofi-modal.ts` |
| `feedback_web` | the "follow your reports" line in Settings |
| `catalog_index` | not fetched by anything, but `csp-hosts.ts` takes its HOST into the connect-src allowlist |

### An earlier version of this section was wrong, and the way it was wrong is worth keeping

It said those six keys were dead, "verified by counting reads of `getLinks().<key>` /
`links.<key>` outside `links-config.ts`: all six return zero."

The count was correct and the conclusion was not. `patchHtmlLinks` reads the key **out of the
element** — `links[el.getAttribute('data-link-key')]` — so no key name is ever spelled out in
the TypeScript and a grep for spelled-out reads finds nothing however many there are. A
dynamic lookup is invisible to a static count of named ones.

One link genuinely was hardcoded, and the wrong claim hid it rather than exposing it: the
"follow your reports" anchor in Settings, added after its neighbours, without the attribute.
`feedback_web` was in the registry and unreachable. It has the attribute now.

**`scripts/check-links.mjs` is what keeps this true.** It fails the build if an external URL in
`index.html` has no `data-link-key`, names a key that is not in `links.json`, or disagrees with
the value there. The third case matters most: the URL in the markup is what a person sees
before the registry loads, and what they keep if it cannot be reached at all.

---

## How the file is laid out

JSON has no comments, so the keys beginning with `_` **are** the headings. They are numbered
to keep the reading order stable, and each one describes the group beneath it:

| Heading | What follows it |
|---|---|
| `_1_about_this_file` | Where the file is loaded from, and which copy to edit |
| `_2_catalogues` | Catalogues and lists |
| `_3_updates` | The update feed and its fallback |
| `_4_telemetry` | Endpoint and public ingest key |
| `_5_community` | Social links — **most of these are not read**, see below |
| `_6_discord_rpc` | Rich Presence buttons |

Nothing parses them. `links-config.ts` merges the file over its defaults
(`{ ...DEFAULTS, ...parsed }`), so an unknown key is carried along harmlessly and a missing
one falls back — which is also why the order has no effect on behaviour and exists purely so
the file can be read top to bottom.

Adding a key? Put it in a group. If a future regroup finds one that belongs to none, it is
parked under `_9_unsorted` rather than dropped, so it shows up as an oversight instead of
disappearing.

---

## Testing against a tunnel

To point BMM at a BCWEB that is not the production domain (cloudflared, ngrok — see
`BCWEB/infra/tunnel.mjs`), change the `bettercommunity.ch` host in:
`server_browse`, `contributors`, `preset_catalog`, `catalog_index`, `analytics_endpoint`,
`autoupdate_api_fallback`.

Editing the **bundled** file requires a rebuild. Editing the **BCWEB** copy does not — but if
you are testing because BCWEB is on a tunnel, source 1 is that tunnel, so edit source 2 or
this file instead.
