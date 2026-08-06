# Every URL BMM talks to

What each one must serve, what breaks when it does not, and whether anything catches the fall.

Compiled from the code, not from memory: `frontend/assets/links.json`,
`frontend/src/core/links-config.ts`, `src-tauri/src/commands/autoupdate.rs`,
`BetterInstaller/examples/bmm/installer.toml`, and a sweep of hard-coded URLs across
`frontend/src` and `src-tauri/src`.

---

## The registry itself

Almost every outward link is data, not code. `links.json` is the registry, and BMM resolves it
through three sources in order:

| # | Source | Purpose |
|---|---|---|
| 1 | `https://bettercommunity.ch/api/assets/links.json` | **Authoritative.** Edited from Admin → Downloads & assets; a change reaches every installed copy without a release |
| 2 | `https://raw.githubusercontent.com/FreeProject089/BetterModsManager/refs/heads/Tdev/frontend/assets/links.json` | Used when BCWEB is unreachable |
| 3 | `assets/links.json`, bundled in the app | Offline |

The first source that answers wins; BMM logs which one it used (`[BMM] links.json source: …`).

**This is the only fallback chain in the app.** Everything below inherits it *for the URL*, but
not for the content at that URL — if `links.json` resolves and the target it points at is down,
that feature fails.

---

## Must exist for the app to update

| URL | Must serve | If it is down |
|---|---|---|
| `https://api.github.com/repos/FreeProject089/BetterModsManager/releases` | The GitHub releases list | No update check at all — see the warning below |
| Release asset `update.json` | BetterInstaller's update manifest — version, package URL, optional deltas | Copies installed by BetterInstaller never see an update |
| Release asset `bmm.bpkg` | The signed package `update.json` points at | The update is offered and then fails to download |
| Release asset `update-manifest.json` | BMM's own incremental manifest, for installs that did not come from BetterInstaller | Dev/portable copies stop updating |

!!! danger "GitHub is a single point of failure for updates, and nothing catches it"

    BetterInstaller *supports* mirrors — `check_remote_multi` tries every source, skips dead ones
    and keeps the newest version. BMM does not use it: `manifest_urls = []` in `installer.toml`,
    so there is exactly one source.

    The **package download** now supports mirrors too — `update.json` takes a `urls` array and
    bpkg-core tries each in turn. That is safe by construction rather than by trust: the Ed25519
    signature is verified before the install directory is touched, so a mirror can serve a bad
    file and never get it applied.

    So closing this is one line of configuration — the build script turns each manifest mirror
    into its sibling `.bpkg` URL automatically:

    ```toml
    manifest_urls = ["https://bettercommunity.ch/api/assets/bmm/update.json"]
    ```

    **Nothing serves that URL today.** BCWEB would have to publish `update.json` and `bmm.bpkg`
    and keep them in step with the GitHub release. Until it does, GitHub remains the only
    source — the mechanism is ready, the second host is not.

---

## BetterCommunity

| URL | Must serve | If it is down |
|---|---|---|
| `https://bettercommunity.ch/api/assets/links.json` | The registry above | Falls back to GitHub, then to the bundled copy |
| `https://bettercommunity.ch/api/repos.json` | The public server-repo directory | The Server Repo browser is empty; joining a repo by direct URL still works |
| `https://bettercommunity.ch/api/assets/contributors.json` | The credits list | The Credits screen shows the bundled copy |
| `https://bettercommunity.ch/` | The site itself | Blog, account and community buttons lead nowhere |
| `https://telemetry.bettercommunity.ch/batch/` | Accepts batched telemetry `POST`s | Nothing user-facing. Telemetry is opt-in and dropped on failure |

The collector and its **public** ingest key (`analytics_key`, `bmm_pk_…`) are entries in
`links.json` like everything else, so the endpoint can be moved and the key rotated from the admin
panel without a release. They were missing from the file until now and lived only in the
compiled-in fallback, which meant neither could change without shipping a new BMM. The private
admin key never ships — it exists only on the telemetry server.

Test mode is read once at startup from `app.cfg` (`BCTestMode` / `BCTestBase`), which lets these
point at a local instance without touching the code.

---

## Catalogs — where content is discovered

| URL | Must serve |
|---|---|
| `https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/catalog.json` | The plugin catalog |
| `https://raw.githubusercontent.com/BetterDCS/BMM_App_Catalogue/main/catalog.json` | The app catalog |
| `https://raw.githubusercontent.com/BetterDCS/BMM_Themes/main/catalog.json` | The theme catalog |

Each is a plain JSON file in a public repo. A missing one leaves that catalog empty; it does not
affect anything already installed. Community catalogs added by the user are extra sources on top,
not replacements.

---

## Documentation

| URL | Must serve |
|---|---|
| `https://freeproject089.github.io/BMM-Docs/` | The published docs site |

**Not required to read the documentation.** Every page is bundled in the app under
`assets/docs/<lang>/`, and the in-app reader never fetches anything. The site is used for two
things: the *Open on the site* buttons, and playing a recording that was too large to bundle —
BMM fetches those bytes and plays them in its own player rather than opening a browser.

---

## Connectivity probes

| URL | Used for |
|---|---|
| `https://www.gstatic.com/generate_204` | Is there internet? |
| `https://cloudflare.com/cdn-cgi/trace` | Second opinion, if the first fails |
| `https://api.ipify.org` | The public IP, shown when hosting a server repo |

The first two are deliberately two different companies — one being blocked should not make BMM
believe the whole network is down.

---

## Third-party, opened in a browser

Never fetched, only opened: `discord.com/invite/CTaaEF9R75`, `reddit.com/r/BetterModManager`,
`ko-fi.com/I2I31ZIPPG`, `ko-fi.com/bettercommunity`, `forum.dcs.world/topic/385941-…`,
`github.com/FreeProject089/BetterModsManager`, `app.betahub.io` (bug reports).

Downloaded on demand, only if the user asks for the feature:
`nodejs.org/dist/…` (the Node runtime a plugin script may need) and
`raw.githubusercontent.com/miniupnp/…/upnpc.exe` (UPnP port mapping when hosting a repo).

---

## Discord Rich Presence

`links.json` also carries the two RPC buttons: `WebSiteRPC1` / `WebSiteRPC2` and
`github_RPC1` / `github_RPC2`, with `BoutonRPC1` / `BoutonRPC2` deciding which of each pair is
shown. Button 1's URL gets `?creator=<id>` appended at runtime. These are labels on a Discord
profile — nothing is fetched.

---

## Changing any of this

Prefer editing `links.json` on BetterCommunity: it reaches installed copies immediately, with no
release. Keep the GitHub copy in step, since it is what answers when BCWEB does not.

The URLs that are **not** in `links.json` and need a release to change: the updater manifest
(`installer.toml`), the docs site (`DOCS_SITE` in `docs-hub.ts`), and the connectivity probes
(`offline.ts`).

The telemetry endpoint used to be on that list. It is not any more — it moved into the registry,
along with its public ingest key.
