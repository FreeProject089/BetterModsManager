# Where BMM's links come from, and how it finds updates


Every external address BMM touches — catalogues, the repo list, telemetry, the update feed —
lives in one file, `links.json`, so any of them can be changed **without shipping a new
version of BMM**.

Everything below is taken from `frontend/src/core/links-config.ts`,
`frontend/assets/links.json` and `src-tauri/src/commands/autoupdate.rs`. Where they disagree
with this page, they are right and this page is a bug.

## Where the file is loaded from

BMM tries four sources in order and stops at the first that answers:

| # | Source | Used when |
|---|---|---|
| 1 | `bettercommunity.ch/api/assets/links.json` | Always tried first. **This is the copy that gets edited.** |
| 2 | The copy on GitHub | BetterCommunity is unreachable. |
| 3 | `assets/links.json`, bundled in the app | Both are unreachable — offline, or a first run with no network. |
| 4 | Built-in defaults in the code | The file is missing or unparseable. |

The practical consequence: a link can be corrected on BetterCommunity and every installed copy
of BMM picks it up the next time it starts. Editing the bundled file only affects installs
that cannot reach sources 1 and 2.

## Finding updates

BMM asks a release feed whether there is a newer version. There are **two**, and the second is
only consulted when the first cannot answer.

| | Address |
|---|---|
| Primary | `api.github.com/repos/FreeProject089/BetterModsManager/releases` |
| Fallback | `bettercommunity.ch/api/updates/bmm` |

### Why a second one exists

GitHub allows **60 unauthenticated requests per hour, per IP address**. That budget is not per
person — it belongs to the address. Behind a company network, a university, or a mobile
operator using CGNAT, it can be spent entirely by other people, and BMM would report a network
error for the rest of the hour through no fault of yours.

BetterCommunity serves the same release information in the same format, so the check succeeds
and nothing downstream knows which one answered.

### When it falls back, and when it does not

| Situation | Behaviour |
|---|---|
| Connection failed | Try the fallback |
| Server error (5xx) | Try the fallback |
| Rate limited (403 / 429) | Try the fallback |
| **No release found (404)** | **Stop.** That feed genuinely has none, and the other almost certainly has none either. |

If the fallback also fails, the error you see is the fallback's own — the last thing tried is
the one that describes the current state.

To disable it, set `autoupdate_api_fallback` to an empty string. A `links.json` from before
this existed behaves the same way.

!!! warning "The two feeds do not use the same path"

    GitHub lists releases at `<base>` and BetterCommunity at `<base>/releases`, while both
    serve the newest one at `<base>/latest`. BMM picks the right shape by checking whether the
    address ends with `/releases`.

    This matters if you ever point these somewhere else: swapping one address for the other
    without accounting for it returns a 404 on the list — and a 404 means *no release*, so the
    failure would show up as **"you are up to date"** rather than as an error.

## What each entry is for

### Catalogues and lists

| Key | What it feeds |
|---|---|
| `plugin_catalog` | The plugin browser. Unreachable → the list is empty. |
| `apps_catalog` | The Better\* apps tab. |
| `preset_catalog` | The official automation feed used by the scheduler. |
| `server_browse` | The public Server-Repo list in Browse. Your own repos are unaffected. |
| `contributors` | The credits screen. Falls back to what is bundled. |
| `plugin_github` | Where "View on GitHub" points from the plugin screen. |

### Telemetry — opt-in

| Key | What it does |
|---|---|
| `analytics_endpoint` | Where anonymous usage data is sent. **Empty means nothing leaves your machine** — events stay buffered locally. |
| `analytics_key` | A *public* ingest key. It can only submit telemetry, and it already ships inside the app, so it is not a secret. The key that can read or delete data lives only on the server. |

### Discord Rich Presence

`WebSiteRPC1` / `WebSiteRPC2` and `github_RPC1` / `github_RPC2` are the candidate addresses for
the two buttons Discord shows. `BoutonRPC1` and `BoutonRPC2` pick which of each pair is used —
`1` or `2`.

## Testing against a local BetterCommunity

To point BMM at a BetterCommunity that is not the public site — a tunnel, a local instance —
change the `bettercommunity.ch` host in `server_browse`, `contributors`, `preset_catalog`,
`catalog_index`, `analytics_endpoint` and `autoupdate_api_fallback`.

Since source 1 is BetterCommunity itself, editing *its* copy is not how you do this: edit the
GitHub copy or the bundled file.

## A caveat worth knowing

Six entries are present in `links.json` and **nothing reads them**: `github_repo`, `reddit`,
`ed_forum`, `kofi_community`, `bettercommunity` and `catalog_index`. Those addresses are fixed
in the app's markup, so changing them here has no effect. `kofi` **is** read and does work.

There is a fuller account, aimed at whoever maintains the file, in
`frontend/assets/LINKS.md`.
