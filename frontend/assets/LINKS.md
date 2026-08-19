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

## ⚠️ Declared but never read

**These six keys are in the file and in the TypeScript interface, and nothing reads them.**
The links they describe are **hardcoded in `frontend/index.html`**, so editing them here — or
in the BCWEB copy — changes nothing a user sees.

| Key | Where the real value lives |
|---|---|
| `github_repo` | `index.html` (credits card) |
| `reddit` | `index.html` (credits card) |
| `ed_forum` | `index.html` (credits card) |
| `kofi_community` | `index.html` (quicklink card 2) |
| `bettercommunity` | hardcoded at each use site |
| `catalog_index` | nothing reads it; `settings.ts` has a similarly-named *localStorage* key, which is not this |

Verified by counting reads of `getLinks().<key>` / `links.<key>` outside `links-config.ts`:
all six return zero. `kofi` **is** read — once, in `kofi-modal.ts`, with the current URL as an
inline default — so it is the one link of this group that works. (`app.ts` and
`theme-editor.ts` contain the word "kofi" in class and function names and do **not** read the
key; counting file matches rather than reads is what makes a list like this wrong.)

Two ways to resolve it, and it is a real decision rather than an oversight to sweep up:
either delete the dead keys so the file stops implying it controls those links, or replace the
hardcoded values in `index.html` with reads from the registry. The second is the point of
having a registry at all, but it touches a file that is frequently edited by hand.

---

## Comment keys

`_comment_catalogs`, `_comment_analytics`, `_comment_source`, `_comment_rpc`,
`_comment_autoupdate` are documentation for whoever opens the file. Nothing parses them;
`links-config.ts` ignores unknown keys.

---

## Testing against a tunnel

To point BMM at a BCWEB that is not the production domain (cloudflared, ngrok — see
`BCWEB/infra/tunnel.mjs`), change the `bettercommunity.ch` host in:
`server_browse`, `contributors`, `preset_catalog`, `catalog_index`, `analytics_endpoint`,
`autoupdate_api_fallback`.

Editing the **bundled** file requires a rebuild. Editing the **BCWEB** copy does not — but if
you are testing because BCWEB is on a tunnel, source 1 is that tunnel, so edit source 2 or
this file instead.
