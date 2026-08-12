# Changelog v1.0.0 (since 74d7fa9)

This version represents the transition to the 1.0 milestone, focusing on cross-platform utility, automated execution groups, and advanced AI integration.

## [MAJOR] Launch Pack Module (Application Groups)
### Invisible Execution Engine
- Implemented a specialized VBScript-based launcher (launcher.vbs) to allow the silent execution of application groups without visible console windows.
- Added native support for PowerShell scripts (.ps1) using the -WindowStyle Hidden flag.
- Support extended to standard executables (.exe) and batch scripts (.bat, .cmd).
- Implemented an automatic icon generation pipeline using the 'image' crate to convert source images (PNG, JPG, BMP) into Windows-compatible .ico files (256x256 Lanczos3 filtering).
- Added Windows Shortcut (.lnk) generation via PowerShell COM objects, ensuring persistent custom icons and working directory configuration.

### Management and UI
- Created a new Launch Pack administration view within the Settings menu.
- Implemented a premium glassmorphism deletion modal with dynamic i18n support for parameter injection.
- Added automatic file system synchronization: deleting a pack now recursively removes associated launcher scripts, icons, and shortcuts from the AppData directory.

## [MAJOR] MCP Server & Advanced CLI Overhaul
### Model Context Protocol (MCP) Integration
- Developed a standalone binary (bmm-mcp-server.exe) dedicated to the Model Context Protocol.
- Implemented a full JSON-RPC server over standard I/O (stdio) for seamless integration with AI agents like Claude Desktop and Gemini.
- Exposed over 25 specialized tools to the protocol, including:
    - Profile management (List, Get Active, Set Active).
    - Mod library operations (List, Get, Toggle, Search).
    - Synchronization and engine commands (Sync, Export Config).
    - Diagnostic tools (Get Statistics, List/Read/Analyze Crash Reports).
    - Repository tools (Generate Repo, Start Server, Lightweight Server Generation).
    - Documentation and i18n access (Read Docs, Read Lang Files).

### Advanced Command Line Interface
- Integrated a full-featured CLI into the MCP binary.
- Added high-fidelity terminal feedback including a custom ASCII banner and colored output levels.
- Implemented comprehensive subcommands for all core operations (mods, profiles, sync, stats, crashes, launchpacks).
- Added environment auto-discovery: the CLI now automatically locates the BMM data directory and configuration files.

## [NEW] Mod Integrity & Advanced Security
### Deep Scan Engine (SHA-256)
- Implemented a full cryptographic integrity system based on SHA-256 fingerprints.
- **Deep Audit**: Added the ability to perform a recursive audit of mod folders to identify missing, modified, or unauthorized files.
- **Visual Alerts**: Integrated a "Pulsing Red Shield" visual indicator to highlight corrupted or compromised mods in real-time.
- **Persistent State**: The integrity status is now persisted in the mod database, allowing for instant identification of issues upon application launch.
- **Reactive UI**: Implemented real-time UI synchronization: the manager now updates integrity icons immediately across the library and detail panels when a scan is performed.
- **Safety Enforcement**: Integrated integrity checks into the activation sequence to prevent enabling mods with missing or corrupted files.

## [NEW] UI/UX & Premium Polish
### Help Center and Navigation
- **Help & Other**: Rebranded the Documentation section to "Help & other" to provide a unified hub for guides, interactive diagrams, and technical resources.
- **Tooltip Management**: Implemented a centralized contextual help system (`window.showTaskyHelp`) powered by the Tasky mascot, providing instant explanations for nearly every UI element.
- **Decorative Elements**: Added high-fidelity decorative components including refined resize strips, corner handles, and glassmorphic overlays for a more premium feel.
- **Tasky Polish**: Refined the mascot's animations and interactive positioning during onboarding and help sequences.
- **Updates History**: Implemented a comprehensive change tracking system for mod metadata (Author, Version, Description, Tags, Links, Dependencies).
    - **Smart Filtering**: Added action-based filtering to quickly locate specific modifications.
    - **Retention Management**: Added configurable history retention duration (e.g., 30 days) with a manual clear option.
    - **Premium Interface**: History entries are rendered with high-precision timestamps and dynamic badges identifying modified fields.


### [MAJOR] Visual Mapper & Directory Analytics
- **Structural Tree Analysis**: Implemented a high-performance visual mapper to explore the physical structure of mod collections.
- **Recursive Walking Engine**: Developed a multi-threaded Rust engine with **Infinite Recursion Depth** support and active **Cycle Detection** (inode/path verification).
- **Real-Time Mod Analytics**: Added a profile-wide mod counter that performs pre-emptive directory scans to display live collection statistics.
- **Virtual Scrolling**: Optimized the tree view to handle 10,000+ files at 60 FPS using dynamic node virtualization.
- **Interactive File Controls**: Added shell integration for "Open in Explorer" and "Copy Relative Path" directly from the mapper tree.

## [IMPROVED] Backend Engine & Core Logic
### Rust Core Hardening
- Implemented a new centralized error handling strategy using a custom AppError enum and anyhow integration for better diagnostic clarity.
- Overhauled the directory mapping engine (Mapper) to improve reliability when analyzing deeply nested mod structures.
- Fixed critical escaping issues for Windows Script Host (WSH) by implementing double-quote escaping for file paths in VBScript.
- Corrected PowerShell string escaping for shortcut generation by implementing single-quote doubling.
- Refined the mod activation sequence to ensure atomic file operations and consistent conflict resolution.

### Resource Management
- Implemented a background cleanup engine to purge orphaned log files and temporary synchronization artifacts.
- Optimized the SHA-256 calculation queue to reduce CPU overhead during background integrity checks.

## [IMPROVED] Internationalization (i18n)
- Achieved 100% i18n coverage for both English and French.
- Eliminated all remaining hardcoded strings in the Mapper, Settings, and Launch Pack modules.
- Upgraded the frontend i18n helper to support parameter injection and dynamic HTML content within translated strings.

## [NEW] Profile Disk Usage Display
- Each profile card now shows the total disk space consumed by its mod folder (e.g. `1.4 GB`), loaded asynchronously in the background after the Profiles view renders.
- A spinning loader is shown during calculation; a database icon accompanies the final formatted size.
- Implemented via a new Rust command `get_folder_size` (recursive directory walker) registered in the Tauri invoke handler.

## [FIXED] .MM Export Cancellation
- The "Cancel" button inside the export progress overlay now actually cancels the running export operation.
- A dedicated `export_cancelled: AtomicBool` field was added to `AppState`. The `export_modlist` Rust command checks this flag on each file iteration and emits a `cancelled: true` event when triggered.
- A separate `cancel_export_modlist` Tauri command sets the flag from the frontend.
- The UI correctly shows a "Export cancelled" toast and resets to its idle state after cancellation.

## [IMPROVED] Profile Icons — Expanded Library
- The icon picker in profile creation and editing now offers 110+ icons organized across 15 categories: Tech, Transport, Media, Sport, Nature, Places, Symbols, and more.
- New SVG icon cases added to `getProfileIconSvg`: `code`, `monitor`, `server`, `printer`, `keyboard`, `bluetooth`, `satellite`, `router`, `cloud`, `bus`, `truck`, `ship`, `bicycle`, `train`, `helicopter`, `film`, `tv`, `speaker`, `mic`, `trophy`, `medal`, `dumbbell`, `swords`, `shield-check`, `tree`, `leaf`, `flower`, `bird`, `fish`, `home`, `building`, `flag`, `castle`, `infinity`, `diamond`, `hexagon`, `fingerprint`, `sparkles`, `atom`, `crown`, and many more.

## [NEW] Help & Other — Docker Documentation
- Added a comprehensive Docker deployment card to the Advanced tab: What is Docker, pros/cons comparison, `docker-compose.yml` example, ngrok tunnel explanation with visual flow diagram, and code blocks for updating the Docker server.
- Added a new "Docker & Infrastructure" section to the FAQ with 4 new entries: What is Docker, What is ngrok, VPS vs. home PC, and How to update a Docker server.
- Added FAQ entry explaining the new profile disk usage feature.
- All new content is fully bilingual (EN/FR) with i18n keys added to both `en.json` and `fr.json`.

## [NEW] Server Browse — Verified Servers Only
- The repo browser now exclusively displays servers that carry a `hash` field in `repos.json`, guaranteeing that only BMM-team-validated repositories appear in the public listing.
- A green "Verified" badge with a checkmark icon is displayed on every listed server card.

## [IMPROVED] Docker Documentation — Complete Rework
- Converted the Docker documentation card in the Advanced tab from a custom inline layout to the standard `glass-card` format, matching the style of Launch Packs and MCP cards.
- Added a dedicated Mermaid diagram (`docker-deployment`) visualizing the full Docker + ngrok deployment flow: host machine → Docker container → ngrok agent → cloud tunnel → clients.
- Added a "View Diagram" button to the Docker card header, opening the new `docker-deployment` diagram in the interactive viewer.
- Replaced the placeholder Docker icon with a proper Docker whale SVG (containers on back).
- Added copy-to-clipboard buttons on all code blocks in the Docker FAQ (docker compose update commands).
- Reduced the card to a clean 3-card grid (What is Docker, Comparison, ngrok) plus a 2-column code block section (compose file + ngrok command), each with an individual copy button.

## [IMPROVED] Mod Library — Modernized Filter Bar
- Redesigned the filter bar with a glassmorphic container (`backdrop-filter: blur(10px)`, subtle border and background).
- Modernized filter buttons: smooth hover transitions, `translateY(-1px)` lift on hover, improved active state with glow (`box-shadow: 0 0 10px rgba(99,102,241,0.15)`).
- Updated the search box: sharper focus state with accent color glow, smooth icon color transition on focus.
- Modernized the view toggle button (compact/grid) with a matching active state and hover lift.
- Modernized `profile-select` dropdowns: smooth hover/focus transitions, accent glow on focus, consistent border style with the rest of the bar.

## [NEW] Server Browse — Whitelist Detection
- The repo browser now reads `whitelist_enabled` from each server's entry in `repos.json`.
- Servers with `whitelist_enabled: true` display a green "🔒 Whitelist" badge; servers with `whitelist_enabled: false` display a red "Open" badge.
- Added a whitelist filter dropdown to the browse modal: "All servers", "Whitelist ON", "No whitelist" — instantly filters the displayed list.

## [NEW] Quick-Link Cards (Help & Other)
- Added two configurable quick-link cards at the top of the Help & Other section (before the documentation tabs), linking to the BMM Discord and GitHub repository.
- Cards feature brand icons, hover animation (`translateY(-2px)` + glow shadow), and an external link indicator.
- Each card can be individually disabled via `app.cfg`:
  - `quicklink1_disabled=true` — hides the Discord card
  - `quicklink2_disabled=true` — hides the GitHub card
- Added new Rust command `get_quicklinks_config` that reads both flags from `app.cfg` and returns a JSON struct to the frontend.
- If both cards are disabled, the entire card strip is hidden.

## [IMPROVED] Incremental Update System
- Replaced the single "full installer download" update flow with an **incremental delta update** system.
- `check_for_update` now also looks for an `update-manifest.json` asset in the GitHub release. If found, its URL is returned in the `manifest_url` field.
- Added two new Rust commands:
  - `fetch_update_manifest(url)` — downloads and parses the manifest JSON listing changed files with paths, SHA-256 hashes, and download URLs.
  - `apply_incremental_update(manifest)` — downloads only changed files, verifies each SHA-256 digest, and applies them in-place in the BMM install directory. Emits `update-progress` events for each file.
- The update modal now shows a **"Quick Update (incremental)"** primary button when a manifest is available, with a real-time progress bar and per-file status. The full installer remains available as a secondary option.
- Files that already match the expected SHA-256 are skipped without re-downloading.
- Atomic file replacement: files are written to a temp location first, then moved atomically to their final destination (with a copy fallback for cross-drive scenarios).

## [MAJOR] Plugin System (Core Plugins / Cplugins)
### Extensible Plugin Architecture
- Introduced a full plugin system with a manifest format (`PluginManifest`): `id`, `name`, `version`, `author`, `description`, `game`, `permissions`, `tags`, `website`, bundled `folders`, and a declarative `modlist`.
- **Apply modes**: a plugin can apply a `modlist` (declaratively require/enable a set of mods), run bundled `scripts`, or `both`.
- **Modlist enforcement**: `PluginModList` supports a `strict` flag and `required_mods` entries with optional `sha256` pinning. `compare_plugin_mods` reports what's missing/mismatched before applying; `apply_plugin_modlist` activates the required set.
- **Installation paths**: install from the remote plugin catalog (`fetch_plugin_catalog` → `install_plugin`) or from a local `.bmmplug` file (`install_plugin_from_file`). Plugins can also be authored in-app (`create_local_plugin`) and exported (`export_plugin`).
- **Permission gating**: `set_plugin_permissions` / `get_plugin_permissions` control what a plugin may do; running bundled external scripts is gated behind an explicit "unsafe plugins" permission (`run_plugin_scripts`).
- **Integrity**: `compute_plugin_checksum` validates plugin contents; `toggle_plugin`, `uninstall_plugin`, `get_installed_plugins`, and `open_plugin_folder` round out lifecycle management.
- **Script generation**: `generate_script` produces ready-to-run automation snippets (cURL / PowerShell) targeting the local API.

## [NEW] Local REST API Server
- Added an embedded **Warp**-based HTTP server on `127.0.0.1:51274`, letting external tools and plugins drive BMM programmatically.
- **~40 endpoints** under `/api/` covering: health/status, mods (list, active, enable, disable, get/delete by id), profiles (list, get, create, update, delete, activate), plugins (list, compare, apply), modpacks (list, create, enable, disable, import, get/delete), repository (info, connect, list, sync, generate, host), data/modlist export & import, `creator-id`, `check-update`, and `restart`.
- **Token authentication**: `get_api_token` / `reset_api_token` manage a per-install API token; the `generate_script` helper builds authenticated request snippets.
- Powers the in-app API explorer and external automation (e.g. Stream Deck, companion scripts).

## [NEW] ContentID — Deterministic Mod Identity
- Implemented a deterministic content-identity system: `derive_content_id()` and `content_id_from_file_hashes()` produce a stable `content_id` from a mod's actual file hashes — the **same files on any machine yield the same ID**.
- Enables reliable cross-machine mod recognition (matching mods by content rather than folder name), powering accurate `.MM` / modpack / repository matching and the "already present" detection in the import flow.
- `update_content_id_from_hashes()` keeps the ID in sync with the SHA-256 fingerprints computed by the integrity engine.

## [IMPROVED] Onboarding V2
- Reworked the first-run onboarding into a modular tutorial engine (`tutorial-engine`, `tutorial-store`, `tutorial-hub`, `tutorial-data`, `tutorial-events`).
- Step-driven, event-aware flow with a restartable Tutorial Hub, dispatched BMM actions, and Tasky-guided contextual help.

## [IMPROVED] Memory & Performance
- Major memory-footprint reduction (~1.5 GB → ~500 MB average in dev) through aggressive cleanup of video/marquee resources and view teardown.
- **Lazy loading** added to heavy views (Credits, Mapper): media and large DOM trees are built/destroyed on demand rather than kept resident.
- Mapper lag fixes and reduced idle CPU usage.

## [IMPROVED] Server Repository — GitHub Browse & Cross-Platform
- Added a **GitHub-repo browse** mode so users can discover server repositories hosted on GitHub directly from the browser.
- Added **`.zip` support** to the Server Repo flow and **full Linux support** for the lightweight standalone server.
- Repository history tracking and assorted server-mode UX refinements.

## [MAJOR] App Catalog Module (One-Click App Installation)
### Browse, Install & Track Apps
- Added a dedicated **App Catalog** view in the sidebar — a one-click installer for companion apps and tools.
- **Install engine** supporting `zip`, `exe`, `msi`, and `script` (`.ps1`/`.bat`/`.cmd`/`.py`/`.vbs`/`.sh`):
  - **Portable zip** → extracted to a BMM-managed folder, main `.exe` auto-picked by name match (skips installers/uninstallers).
  - **Installer (exe/msi, or an installer bundled inside a zip)** → BMM runs the installer's own wizard, then **auto-detects** the result with **zero user action** by diffing install folders + the Windows registry (`DisplayIcon`, `InstallLocation`, `UninstallString`) before and after.
  - **Script** → saved and launched through the correct interpreter.
- **Usage tracking**: launch time is recorded automatically by waiting for the launched process to exit — no manual stop needed.
- **Smart uninstall**: managed apps offer "keep files" / "delete everything"; setup-installed apps can **run their real Windows uninstaller** (resolved live from the registry, even for apps installed before tracking).
- **History & Favorites**: per-app install/launch/uninstall log with SVG icons, and a favorites tab.
- **Catalog Creator**: build a `catalog.json` in-app (add apps, preview JSON, copy or download) to host and share your own catalog.
- **Detail modal**: image gallery (thumb + screenshots), full Markdown README renderer (headings, lists, code, links, images), info table, and category-accented actions.

### Trust Model & Community Catalogs
- Badges (`Official`, `Partner`) are assigned by **catalog source**, never by the JSON — a community catalog claiming `"official": true` is silently overridden.
- The official catalog's `partner_catalogs` list grants the Partner badge; `community_imports` chains additional catalogs without granting badges.
- Users can add their own community catalog sources; the official catalog can auto-import partner/community catalogs.

## [NEW] Centralized Link Registry (`links.json`)
- Every external URL (plugin catalog, server-browse list, contributors, auto-update API, app catalog, Discord/Reddit/Ko-fi/GitHub/ED-forum social links) now lives in a single editable file: `frontend/assets/links.json`.
- Loaded at startup with a 3-tier fallback: **remote URL → bundled local file → built-in defaults**, with a clear log line stating which source was used.
- Social links in the Credits page, BetaHub modal and repo-browser quick-links are patched into the HTML at runtime via `data-link-key` attributes — change one JSON entry and it propagates everywhere, no recompile.
- `links.json` is tracked by the incremental update manifest, so URLs can be changed via a release without shipping a new build.

## [FIXED] Mapper — Final Preview Tooltip Clipping
- The structure-diagnostic preview tooltips in the Mapper's final preview modal were being clipped behind the modal's overflow container and sticky table header.
- Replaced the CSS `::after` tooltip with a fixed-position, body-attached tooltip that follows the cursor and is never clipped.

## [IMPROVED] Tooling & Minor Additions
- **Advanced Benchmark Mode**: reworked the performance benchmark with an advanced perf modal (`set_advanced_benchmark_mode`, `openAdvancedPerfModal`) and **CSV export** of results (`export_benchmark_csv`).
- **Developer Tools toggle**: added `open_devtools` / `close_devtools` / `is_devtools_open` commands to toggle the WebView dev tools from within the app (debug menu).
- **Profile "Disable All (Global)"**: added a one-click action on the Profiles page to disable every active mod at once (`disableAllRequestedMods()`), with a confirmation step; removed the now-redundant legacy "Active Mods (Global)" button.
- **Tasky tooltip accuracy**: contextual help tooltips now track the cursor correctly even when the mouse stops before the debounce fires.

## [IMPROVED] Customisation, Sharing & Polish
- **Theme System**: full no-CSS theming engine (7 presets, single-colour auto-palette, right-click element editing, change tracker). Fixed Discard/Revert-all so it fully restores instantly (including dynamic mod/profile cards) with no refresh; the "Edit this element" popup now always spawns fully on-screen and scrolls if the window is short. Refreshed the editor's visuals (accent-aware glass styling).
- **Translation Sandbox**: added a one-click **Share** button that produces a `bmm://language/import-inline` link embedding the whole translation (installed via the new `import_language_data` command). Fixed the overlay→restore sizing bug that left the panel stuck small.
- **App Catalog & docs**: added Documentation cards for the App Catalog and Theme Editor, and a Catalogs & Browsers guide explaining every catalog/browser and how to add multiple sources.
- **Discord Rich Presence**: activity buttons are now driven by `links.json` (GitHub-hosted with a bundled local backup) — the site button points to BetterCommunity by default, with a toggle to switch links, and a **Copy Creator ID** button when a Creator ID exists.
- **Credits**: added a BetterCommunity website link.
- **Ko-fi reminder**: shows on each start (unless you pick "Don't show again"), with a refreshed look.
- **Interactive tutorial**: updated for the new systems (App Catalog, Translation Tool, Theme System, Plugins & API) with steps that highlight the real UI.
- **BMM DevTools**: removed the redundant JS debugger sub-tab; DevTools open from a header button. The real Chrome/WebView2 inspector now works in release builds.
- **Responsive**: the window no longer squishes its toolbars on small sizes — content keeps its layout and scrolls instead.

## [FIXED] Installer / Build
- Fixed the MSI bundling failure (`light.exe` LGHT0091 duplicate symbol) by shipping the MCP/CLI server as a cargo `[[example]]` (so tauri-bundler doesn't double-harvest it) while still bundling it via the `externalBin` sidecar. The bundled `bmm-mcp-server` is rebuilt and up to date, and the CLI/MCP ship in both the `.msi` and `.exe`.
- Pinned WebView2 install to `downloadBootstrapper` (silent) so the installer fetches WebView2 if missing.

## [POST-1.0.0] Ecosystem, Customization & Web Integration

### Customizable Navbar & Sandboxed Pages
- Users can now customize the navbar (reorder/add entries) and open **sandboxed
  `bmmpage://` pages** rendered through a permissioned broker, isolating third-party
  page content from the core app.

### Theme System v2
- Full custom-theme engine + editor: token-based theming, a growing set of built-in
  themes (BMM Sombre, White, Discord, Spotify, Brutal, Claude, Nord, Sakura…), and a
  first-class **light mode**. Themes are shareable `.bmmtheme.json` files.

### Plugins API & Scheduler
- Plugin sources via endpoint/deeplink, HTML docs, and a **scheduler** that runs
  script-generation actions through deeplinks at chosen times.

### BetterCommunity Web Integration
- BMM consumes the BCWEB **`catalog.json`** feed (apps/plugins/themes) and handles
  **install / add-source deeplinks** from the web, tying the desktop app to the
  community hub. Telemetry moved to the rewritten dashboard (Rust/Axum/Postgres + React).

### Platform
- **Tauri v2 migration** (compiles green, runtime validation ongoing).
- All background process spawns routed through hidden-spawn helpers (no console flash).
- Interactive **Tutorial Hub** and an expanded crash manager.

### Command Palette & Rebindable Shortcuts
- **Ctrl/⌘+K command palette** over the whole app: jump to any screen (including your
  own custom navbar pages, picked up live) or run actions directly — add a mod, scan,
  verify integrity, profile import (OvGME/OMM), the whole Server Repo surface
  (sync/host tabs, generate server, start/stop, monitoring, copy creator ID), app
  updates, storage & hashing stats. Classic + **semantic** (synonym-expanded) search.
- Every command is **rebindable** from Settings → Keyboard shortcuts (record, reset,
  clear; conflict warning), replacing the old hardcoded 4-shortcut system. Custom nav
  pages get shortcuts too.
- Fixed the palette rendering: interaction (z-index/pointer) and the backdrop/box-shadow
  bleeding outside the rounded app window (now mounted inside the clipped frame).

### Server Repos: Optional Download Password
- Self-hosted repos can now require a **download password**: set it when generating the
  server; subscribers are prompted once (sent as `X-Repo-Password`, remembered for later
  syncs). Blank = open repo. Distinct from the admin password, which only guards the
  host's admin panel.
- Threaded end-to-end: host forms (mini-server + export), subscriber prompt with retry,
  `GET /api/repo/info?password=` and `POST /api/repo/sync {password}`, the Plugins
  Quick Test, and the `bmm://repo/sync` deeplink — which was also **fixed** (it
  previously navigated without pre-filling; it now drives the sync form, honouring
  url/dirs/profile/password).

### Documentation Overhaul (Help & Other + BMM Docs)
- Help & Other rebuilt as a data-driven bilingual hub (md-lite directives, user/dev
  split) with a correctness pass: conflicts = **last-enabled wins** (no priority list),
  server hosting vs sync split, SHA-256 on the wire, generalist examples (no
  game-specific placeholders).
- New articles + **3 new interactive diagrams** (offline-mode, telemetry-pipeline,
  i18n-system) with full node descriptions; new coverage for offline mode, privacy &
  telemetry (opt-in model, masked replay, per-packet 72 h deletion), repo admin &
  monitoring, launch packs (corrected: application groups, not mod bundles), and the
  translation system.
- The **BMM Docs** website mirrors the in-app content (minus interactive elements) with
  Mermaid diagrams, new pages (command palette, launch packs, privacy/telemetry) and an
  updated API reference.

### Security
- **rmcp 0.16 → 1.8** clears RUSTSEC-2026-0189 (DNS-rebinding in the HTTP transport;
  BMM's MCP server is stdio-only so it was unreachable — advisory now gone anyway).
  `cargo audit`: 0 vulnerabilities.
- Generated mini-server & hub-server templates now compare passwords in
  **constant time** (`crypto.timingSafeEqual`, CWE-208) for both the download password
  and the admin gate.
- npm: dompurify advisory fixed (`npm audit fix` → 0).

### Fixes
- Session-flush `RangeError` + rrweb recorder perf/lag; webview OOM fix.
- Startup fetch errors (links.json CORS via Rust bridge, contributors.json, stray
  callbacks); faster app shutdown; legacy app-data migration to the new bundle id.
- Replay/Animation Studios: simpler UX, recording-visibility toggle, preset dropdown
  layering, pointer-events fixes.

---
*Release 1.0.0 represents the final consolidation of the core feature set; the section
above tracks the ecosystem/customization work layered on top of it.*

---

## [MAJOR] Shared icon library (Lucide + Simple Icons)

- **2017 Lucide glyphs** and **3453 Simple Icons brands** available across BMM, plus your
  own images (PNG/JPG/SVG/WebP, 128 KB cap, embedded).
- An icon is a plain string (`lucide:x`, `si:x`, `data:image/…`), so it travels through
  **every share path** — exported profiles, repos, catalogs — with no extra code.
- One picker (search across 5000+, tabs, upload) wired into three surfaces: **custom
  tags**, **profile visual icon**, **plugin creation**.
- Lazy-loaded and **sharded per letter**: painting a stored brand icon fetches ~150 KB, not
  the full 4.6 MB pack (that one arrives only if you open the Brands tab). The boot script
  budget is unchanged.

## [NEW] Tags: icons and gradients

- A tag can carry an **icon** (library above) and a **two-colour gradient** instead of a
  flat tint.
- Tags are now **editable** (new `update_tag` command): the form switches to edit mode,
  with an explicit Cancel.
- One renderer (`renderTagChip`) serves all five surfaces — card grid, list rows, details
  panel, "+N" modal, Settings — which previously drew five slightly different versions of
  the same tag.

## [MAJOR] Scheduler: the full control-flow family

- **For each**: run the body once per item of a *live* collection (enabled / disabled / all
  mods, profiles, modpacks, themes), substituting `{item.id}`, `{item.name}` — or any field
  — into action parameters.
- **Switch**: ordered cases, each with its own condition; the first that matches runs, else
  the default branch.
- **do… while**: the body runs first, then the condition decides another lap.
- Tasks authored by an agent or the CLI are **normalized on load**, so an incomplete shape
  can never stop the editor from opening.

## [MAJOR] MCP & CLI: authoring, not just reading

- `bmm_create_schedule` / `bmm_delete_schedule` (MCP) and `create-schedule` /
  `delete-schedule` (CLI, via `--file`, `--json` or stdin): an agent or a script can now
  **compose** a whole automation, control-flow blocks included.
- `bmm_create_plugin_scaffold` / `create-plugin`: writes a plugin **draft**
  (`plugin.json` + README) into `plugin-drafts/<id>/`. Deliberately not an install — a
  plugin can carry scripts, so installation stays the app's normal, permission-gated flow.
- Safety: a task created without an explicit `enabled: true` lands **disabled**, to be
  inspected before it is armed. An *update* that omits the field keeps the stored state.

## [NEW] Dockable side panels

- The **interactive tutorial**, the **theme editor** and the **translation sandbox** can
  dock to the window edge as a full-height column, with a draggable, remembered width.
- The app reflows around them: a single owner (`dock-space`) reserves the space, so opening
  a second panel no longer clobbers the first one's reservation.
- Each panel **changes shape** per mode: the sandbox stacks its two columns when docked,
  the tutorial moves its toolbar onto two rows.

## [IMPROVED] Theme editor

- **Dock mode** (above) and a **File** menu grouping Import / Share / Export.
- **Clicking a token's label** flashes every element actually painted with that value — the
  shortest way to learn what a token controls.
- The **element picker** finally states how it works (right-click / middle-click), and
  **Shift + right-click** always opens the precise element editor.
- The **sidebar logo** token works (it was written but no rule ever read it).
- The *Surfaces* and *Toasts* groups got their icon and description back.

## [FIXED] Responsiveness and UI freezes

- **Enabling a mod no longer freezes the app.** In Tauri v2 a synchronous command runs on
  the main thread, so the file-cache rebuild every activation triggers blocked the whole
  window. Disk-walking commands now run on a worker thread.
- **Loading indicators actually spin.** A transform animation only runs on the compositor
  once its layer is promoted, and that promotion is committed by the main thread: inserted
  during heavy work, the spinner sat frozen and looked exactly like a hang.
- The library action bar accounts for the space a docked panel takes.

## [NEW] Documentation

- New **"Make your own theme"** page (EN + FR): every token explained group by group, the
  `.bmmtheme` format field by field, the drop-in folder, and a from-zero build order.
- The documentation PDF's first page carries the author and the exact edition (version +
  commit timestamp).
