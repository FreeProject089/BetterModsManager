# Technical Architecture & Source Code Analysis - Better Mod Manager (BMM)

This document provides a comprehensive analysis of the software architecture, internal engines, data models, and implementation strategies of Better Mod Manager.

---

## 1. Architecture Overview

BMM is built on the **Tauri v1 Framework**, a Rust-first desktop stack that provides a WebView-based UI with a high-performance Rust backend.

| Layer | Technology | Responsibility |
| :--- | :--- | :--- |
| **Backend Core** | Rust 1.70+, Tauri Commands | Filesystem I/O, state management, archive extraction, network requests, concurrency control |
| **Bridge Layer** | Tauri IPC (Invoke + Events) | Type-safe message passing between Rust and JS without shared memory |
| **Frontend** | Vanilla ES6+ JavaScript | DOM rendering, view routing, i18n, mod metadata display |
| **Styling** | Vanilla CSS3 (Custom Properties) | Variable-driven dark theme, Flexbox/Grid layouts, keyframe animations |
| **Data Persistence** | JSON files via `serde_json` | Profiles, mod entries, tags, and last active profile stored on disk |

---

## 2. Automated Build & Versioning System

BMM implements a robust automated system to ensure versioning integrity across the entire application stack.

### Build-Time Date Capture (`build.rs`)
A dedicated Rust build script intercepts the compilation process to capture the current system date.
- **Logic**: Uses the `chrono` crate to format the current UTC date as `YYYY-MM-DD`.
- **Injection**: The date is exported as a compile-time environment variable `BMM_BUILD_DATE`.
- **Persistence**: This ensures the build date is "burned" into the binary and remains static for that specific build.

### Dynamic UI Synchronization
The frontend fetches this information at boot via specialized Tauri commands:
- `get_build_date`: Returns the static build date captured at compilation.
- `is_ptb_mode`: Checks `app.cfg` to determine if PTB markers should be rendered.
- **Boot Sequence**: `initVersionDisplay()` in `app.js` performs a synchronized injection into the titlebar, footer, and credits view after i18n initialization.

---

## 3. Backend — State Management

### AppState Structure

The global `AppState` wraps all mutable data in `Arc<Mutex<AppData>>`, ensuring thread-safe access across all concurrent Tauri commands.

| Field | Type | Description |
| :--- | :--- | :--- |
| `profiles` | `Vec<Profile>` | All user-defined game profiles |
| `mods` | `Vec<ModEntry>` | All registered mods across every profile |
| `tags` | `Vec<CustomTag>` | User-defined taxonomy labels (name + color) |
| `active_profile_id` | `Option<String>` | UUID of the currently selected profile |

### Persistence Strategy

| Mechanism | Location | Trigger |
| :--- | :--- | :--- |
| JSON serialization | `AppData/Roaming/bmm/` (Windows) | Called via `state.save()` after every mutation |
| Deserialization on boot | Same path | `AppState::load()` at application startup |
| Activity history log | Adjacent JSON file per profile | Written on every `enable_mod` / `disable_mod` call |

---

## 4. Backend — Data Models

### Profile

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `String` (UUID v4) | Unique identifier |
| `name` | `String` | Display name |
| `game_name` | `String` | Friendly game name |
| `game_path` | `PathBuf` | Absolute path to the game ROOT directory |
| `mods_path` | `PathBuf` | Directory where mod folders are stored |
| `backup_path` | `PathBuf` | Directory where original game files are backed up |
| `active_mods` | `Vec<String>` | Ordered list of currently enabled mod IDs |
| `color` | `String` | Accent color hex code for the sidebar profile chip |
| `icon` | `String` | SVG icon identifier |

### ModEntry

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `String` (UUID v4) | Unique identifier |
| `name` | `String` | Display name |
| `version` | `String` | Semantic version string |
| `author` | `String` | Author attribution |
| `description` | `String` | Freetext description |
| `mod_folder_path` | `PathBuf` | Absolute path to the mod's root folder on disk |
| `enabled` | `bool` | Whether the mod is currently active in the game |
| `status` | `ModStatus` | Enum: `Enabled`, `Disabled`, `AlreadyPresent` |
| `installed_files` | `Vec<String>` | Paths of files injected into the game ROOT |
| `tags` | `Vec<String>` | Assigned tag names |
| `download_links` | `Vec<DownloadLink>` | Web links (GitHub, NexusMods, etc.) with type and label |
| `sort_priority` | `u32` | Installation priority for .MM lists |

---

## 5. Backend — The Smart Copy Filesystem Engine

The core of BMM's mod management is the **Stacked Physical Copy** engine in `src-tauri/src/fs_utils.rs`.

### Activation Flow (`enable_mod` command)

| Step | Function | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquires a global Mutex to block any concurrent operation |
| 2 | `apply_mod_stacked()` | Walks every file in the mod's folder recursively |
| 3 | Conflict Check | For each mod file, checks if a file already exists at the target game ROOT path |
| 4 | Backup | If conflict exists, the original game file is moved to `backup_path`, preserving the exact relative sub-directory structure |
| 5 | Injection | The mod file is copied to the game ROOT path |
| 6 | Track | All installed file paths are stored in `ModEntry.installed_files` |
| 7 | State Update | `mod.enabled = true`, `profile.active_mods` is updated, `state.save()` is called |
| 8 | History Log | A timestamped "Enabled" event is written to the activity log |

### Deactivation Flow (`disable_mod` command)

| Step | Function | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquires the global Mutex |
| 2 | File Resolution | Merges `installed_files` (tracked) with `list_mod_files()` (scanned) into a deduplicated set using `HashSet` |
| 3 | `unapply_mod_stacked()` | For each file, deletes the installed copy from the game ROOT |
| 4 | Restoration | Moves the backed-up original file from `backup_path` back to its exact original location |
| 5 | State Update | `mod.enabled = false`, cleared from `profile.active_mods`, `state.save()` called |
| 6 | History Log | A timestamped "Disabled" event is written |

### Selective Conflict Checking (introduced in v0.9.7)
 
To improve performance during mod activation, BMM now uses **Selective Conflict Checking**:
- Only active mods and the currently selected mod are processed for conflicts.
- This results in up to 80% reduction in IPC calls and filesystem operations during bulk activation/deactivation.

### Disk I/O Limiting (introduced in v0.9.7)

BMM addresses the "system freeze" problem common in heavy I/O applications:
- **Chunked Transfer**: Files are copied in 2MB chunks rather than a single stream.
- **Adaptive Throttling**: After each chunk, the engine sleeps for a duration calculated based on the user-defined MB/s limit.
- **Per-Disk Awareness**: The limiter detects which physical disk a path belongs to and applies the corresponding limit automatically.

### Conflict Check Cache (v0.9.9)

To further optimize performance, BMM implements a metadata-based caching system:
- **Logic**: Before scanning a mod folder, BMM compares its last modification date (`mtime`) with the stored cache value.
- **Performance Gain**: If the folder hasn't changed, the tree scan is skipped. This reduces computation time during mod toggles by 80% on large libraries.

### Why Physical Copy Instead of Symlinks

| Method | Stability | Anti-Cheat Compatible | Network Drive Support |
| :--- | :--- | :--- | :--- |
| Symlinks | Low (Windows permissions fragile) | No (many AC systems block symlinks) | No |
| BMM Physical Copy | High | Yes | Yes |

---

## 6. Backend — Concurrent Safety

| Mechanism | Purpose |
| :--- | :--- |
| `MOD_OP_LOCK: Mutex<()>` (global static, `lazy_static`) | Prevents two mod activation/deactivation operations from running simultaneously |
| `Arc<Mutex<AppData>>` | Guarantees that all reads/writes to app state are sequentially consistent |
| `tauri::async_runtime::spawn_blocking()` | Offloads all heavy I/O operations to a dedicated thread pool, keeping the UI thread unblocked |

---

## 7. Backend — Mass Installation Engine (.MM Format)

### Install from Modlist Flow

| Step | Mechanism | Detail |
| :--- | :--- | :--- |
| 1 | Parse | `serde_json::from_str()` deserializes the `.mm` JSON into a typed `ModList` struct |
| 2 | Profile Creation | If `create_profile = true`, a new `Profile` is created and set as active before any downloads begin |
| 3 | Local Deduplication | For each mod entry, BMM scans every existing profile's mods directory for a matching folder name. If found, the mod is copied locally via `fs_extra`. |
| 4 | HTTP Download | If no local match exists, `reqwest::blocking::get()` fetches the file from the provided download URL |
| 5 | Zip Detection | Inspects the first 4 bytes (PK magic numbers) to detect zip archives, regardless of file extension |
| 6 | Extraction | Iterates zip entries, creating directories and writing files via `zip::ZipArchive` |
| 7 | Progress Events | After each mod, a `bmm://mod-download-progress` event is emitted via `window.emit()` with `mod_index`, `total_mods`, `mod_name`, and `progress` (0.0–100.0) |
| 8 | Cancellation | An `AtomicBool` in the `AppState` is checked at each iteration of the installation loop to allow user-initiated termination. |

### Cancellation Logic

Cancellation is implemented using a shared `std::sync::atomic::AtomicBool` within the `AppState`. 
1. The `cancel_install_from_modlist` command sets the flag to `true`.
2. The installation loop in `install_from_modlist` checks this flag before processing each mod in the list.
3. If `true`, the loop breaks and returns a partial result set to the frontend.

### Deep Integrity Engine (v0.9.9)

The integrity engine has been expanded to include full cryptographic verification:
- **SHA-256 Hashing**: Instead of relying solely on file sizes, BMM now calculates the SHA-256 hash of every installed file and compares it to the source.
- **Thread Isolation**: Hashing is performed within the `spawn_blocking` thread pool to maintain UI responsiveness.

### ModList Data Schema

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `String` | List display name |
| `game_name` | `String` | Target game name |
| `game_path_hint` | `String` | Suggested game ROOT path for profile creation |
| `description` | `String` | List description |
| `author` | `String` | List author |
| `mods` | `Vec<ModListEntry>` | All mod entries |

| ModListEntry Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `String` | Mod name |
| `version` | `String` | Version string |
| `download_links` | `Vec<DownloadLink>` | HTTP URLs + link type (**github**, **google_drive**, **mega**, **direct**, **other**) + label |
| `sort_priority` | `u32` | Lower value = higher priority in install order |
| `file_tree` | `Vec<ModFileEntry>` | Complete list of relative file paths (built at export time) |
| `tags` | `Vec<String>` | Tag labels carried over from the source profile |

---

## 8. Backend — OvGME Migration (`ovgme.rs`)

BMM can directly parse OvGME's proprietary binary `.dat` configuration files.

| Step | Implementation Detail |
| :--- | :--- |
| **Discovery** | Scans `C:\ProgramData\OvGME\` (with `APPDATA` fallback) for subdirectories containing a `game.dat` file |
| **Binary Parsing** | The `parse_utf16_string()` function reads UTF-16 LE encoded string data from fixed byte offsets within the binary format |
| **Profile Mapping** | Extracted paths (game root, mods folder) are mapped to native BMM `Profile` structs and registered into the state |

---

## 9. Frontend — Modular Architecture

The frontend has been refactored into a modular ES6 architecture to ensure scalability and easier maintenance.

### Core Modules

| Module | Responsibility |
| :--- | :--- |
| `api.js` | Direct IPC bridge with Tauri. Handles all `invoke` calls and file pickers. |
| `state.js` | Centralized state manager. Synchronizes the local UI environment with the Rust backend. |
| `profiles.js` | Logic for profile management, grid rendering, and active profile selection. |
| `mods.js` | Mod library logic, activation toggles, and real-time conflict event handling. |
| `i18n.js` | Internationalization engine with dynamic language file discovery. |
| `utils.js` | Shared utility functions (HTML escaping, string sanitization, date formatting). |

---

## 10. Dynamic Internationalization Engine

BMM 0.9.7 introduces a fully dynamic i18n system that allows for zero-config translation expansion.

### Detection & Loading
- **Rust Command**: `get_available_languages` scans the `Lang` directory using a recursive path resolver that adapts to both development and production environments.
- **Frontend Sync**: The `i18n.js` module fetches this list and dynamically generates language selector items, including FlagCDN assets based on 2-letter ISO codes.
- **Data Attributes**: Uses `data-i18n` attributes for all static UI elements, allowing for instantaneous language switching without application reloads.

---

## 11. Frontend — Security

| Threat | Mitigation | Implementation |
| :--- | :--- | :--- |
| XSS via mod metadata | HTML entity escaping | `escHtml()` converts `<`, `>`, `"`, `&` to safe entities before any DOM `innerHTML` injection |
| Attribute injection | Attribute escaping | `escAttr()` sanitizes strings inserted into HTML attribute values |
| Path traversal | Tauri scope enforcement | Rust backend validates all file paths against registered profile bounds before I/O |

---

## 12. Technical Specification Summary

| Parameter | Implementation |
| :--- | :--- |
| **Language (Backend)** | Rust 1.70+ (Tauri v1) |
| **Language (Frontend)** | ES2022 JavaScript — Modular Architecture |
| **Networking** | reqwest 0.11 (blocking + async) |
| **Archiving** | zip-rs 0.6 |
| **State Serialization** | serde / serde_json |
| **File Operations** | std::fs + fs_extra 1.x |
| **Concurrency Model** | Arc + Mutex + tauri::async_runtime |
| **Idle RAM** | approx. 60 MB |
| **Active RAM (I/O)** | Less than 130 MB |
| **UI Framerate** | 60 FPS |
| **Cold Boot Time** | Less than 1.5 seconds |
| **System Info** | `sysinfo 0.30` |
| **Crash Tracing** | `backtrace 0.3` |

---

## 13. Crash & Logging System (`crash.rs`)

BMM implements a hybrid real-time logging system to prevent data loss in the event of an unhandled panic or process termination.

### Logging Flow

| Mechanism | Implementation | Role |
| :--- | :--- | :--- |
| **LOG_BUFFER** | `VecDeque<String>` (cap 500) | Thread-safe circular buffer for in-memory access and state snapshots. |
| **Current Session Log** | `current_session.log` | Real-time disk write via `file.sync_all()`. Acts as a "heartbeat" file. |
| **Panic Hook** | `std::panic::set_hook` | Intercepts terminal errors, generates a full `backtrace`, and triggers a ZIP generation before termination. |

### Recovery Mechanism

On application boot, `init_session()` scans the `com.bettermm.app/` directory:
1. If `current_session.log` exists, BMM assumes the previous session crashed or was killed (Alt+F4).
2. `generate_report()` is called to create a `crash_YYYYMMDD_HHMMSS.zip` within the `Crashes/` folder.
3. The old log is renamed and then replaced by a fresh log for the current session.

---

## 14. Advanced Troubleshooting (Debug Menu)

The `is_debug_mode` command controls the visibility of developer tools via `app.cfg`.

| Diagnostic | Logic |
| :--- | :--- |
| **Config Check** | `app_handle.path_resolver().resolve_resource("../app.cfg")` |
| **State Reset** | Overwrites in-memory `AppData` with `Default::default()`, clears disk `data.json`, and triggers a frontend `localStorage.clear()`. |
| **Manual Trigger** | Exposes the `trigger_manual_crash_report` command for ZIP format validation. |

---

## 15. Auto-Update Engine (`autoupdate.rs`)

BMM includes a GitHub-based update checker implemented as an async Tauri command.

### Update Check Flow

| Step | Implementation | Detail |
| :--- | :--- | :--- |
| 1 | `check_for_update` | Async Tauri command triggered by frontend on startup or manual button click |
| 2 | HTTP Request | `reqwest::Client` with `User-Agent: BetterModManager` queries `https://api.github.com/repos/FreeProject089/BetterModsManager/releases/latest` |
| 3 | Version Parse | Strips `v` / `V` prefix from `tag_name`, splits into `MAJOR.MINOR.PATCH` segments |
| 4 | SemVer Compare | `is_newer_version()` compares each segment left-to-right; returns `true` only if latest is strictly greater |
| 5 | Asset Detection | Scans `assets[]` array for `.msi` (priority), then `.exe` / `.zip`, extracts `browser_download_url` |
| 6 | Response | Returns `UpdateInfo { has_update, current_version, latest_version, release_url, release_notes, download_url }` |

### Error Handling

| Status | Behavior |
| :--- | :--- |
| **404** | Returns `Err("NO_RELEASE")` — frontend shows info toast instead of error |
| **Network failure** | Returns `Err("Network error: ...")` — frontend shows error toast on manual check, silent on auto-check |
| **JSON parse error** | Returns `Err("JSON parse error: ...")` |

### Frontend Integration

| Mechanism | Implementation |
| :--- | :--- |
| **Auto-check toggle** | `localStorage('bmm_auto_update_enabled')`, default `true` |
| **Startup check** | `setTimeout(() => performUpdateCheck(false), 3000)` — non-blocking, no toast if up-to-date |
| **Manual check** | Sidebar button (`#btn-check-updates`) and Settings button (`#btn-settings-check-update`) |
| **Update modal** | Dynamically created DOM element with version comparison, Markdown release notes, and asset download link |

---

## 16. PTB System (Public Test Build)

BMM supports a PTB distribution mode controlled via `app.cfg`.

### Detection

| Command | Logic |
| :--- | :--- |
| `is_ptb_mode` | Reads `app.cfg` via `path_resolver().resolve_resource("../app.cfg")`, checks for `ptb=true` (case-insensitive) |
| `get_ptb_notes` | Scans both the resource dir and dev project root for any file matching `*PTB*.md`, returns its content as a string |

### Frontend Flow

| Step | Detail |
| :--- | :--- |
| 1 | `checkPtbMode()` called during `main()` boot sequence |
| 2 | Invokes `is_ptb_mode` — if `false`, exits silently |
| 3 | Checks `sessionStorage('bmm_ptb_dismissed')` — if already dismissed this session, exits |
| 4 | Invokes `get_ptb_notes` to load the PTB markdown content |
| 5 | Renders content using `marked.parse()` (with `<br>` fallback) |
| 6 | Displays a themed modal with header (icon + title + PTB badge), scrollable body, and blue primary dismiss button |
| 7 | On dismiss, sets `sessionStorage` flag to prevent re-display until next app restart |

---

## 17. Real-Time Performance Monitoring

The Performance Dashboard is a standalone monitoring sub-system.

| Layer | Implementation |
| :--- | :--- |
| **Data Collection** | Rust-side `sysinfo` crate captures core-normalized CPU, global RAM, and per-process Disk I/O. |
| **Visualization** | Re-usable Chart.js-style implementation using custom Canvas and SVG paths for high efficiency. |
| **Timeline Replay** | Stores the entire tracking session in binary-compressed objects, allowing for Premiere-style frame scrubbing. |
| **PiP Mode** | Leverages a secondary UI layer to remain visible even when the main manager is minimized or focused on another task. |

---

## 18. Interactive Documentation Engine

BMM 0.9.8 integrates a custom-built Mermaid.js bridge for high-fidelity technical visualization.

| Feature | Implementation |
| :--- | :--- |
| **Dynamic Translation** | A specialized key-mapping layer intercepts Mermaid node rendering to inject localized strings from `fr.json`/`en.json`. |
| **Pan-Zoom Integration** | Uses `svg-pan-zoom` library with a persistent state manager to maintain viewport coordinates across view switches. |
| **Explanation Bridge** | Tooltips and sidebars are populated via the `explanationPrefix` system, linking diagram nodes to deep-level i18n keys. |

---

## 19. Multimedia & Credits Engine

| Feature | Implementation |
| :--- | :--- |
| **Video Backgrounds** | The Credits page features a high-performance looping MP4 background served via the `asset://` protocol. |
| **State-Aware Playback** | A specialized Intersection Observer pauses video processing when the view is not visible, reducing CPU/GPU overhead to 0%. |

---

## 20. Server Repository System (Server Mode)

BMM 0.9.8 introduces the **Server Repository** system, a robust alternative to download-based sharing.

### 20.1. Architecture
- **Host Engine**: Uses an integrated HTTP server to serve static mod files and the `repo.json` manifest. No external dependencies required for local hosting.
- **Manifest (repo.json)**: A cryptographically signed (SHA-256) JSON file containing the complete state of the repository.
- **Smart Sync Engine**: The client fetches the manifest, performs a local diff against its active profiles, and downloads only the delta (missing or changed files).

### 20.2. Security & Integrity
- **Collision Resistance**: Uses SHA-256 hashes to ensure that mod files aren't corrupted during transfer.
- **Path Isolation**: The server strictly limits file access to the designated repository folder, preventing path traversal attacks.
- **Export/Sync Cancellation (v0.9.9)**: Uses a shared `install_cancelled: Arc<AtomicBool>`. Compression and transfer loops check this flag at each iteration for immediate interruption without orphaned resources.

---

### 21. UI Consistency & State Normalization

### Unified Empty States
BMM 0.9.8 implements a shared component strategy for empty states across views.
- **State Hijacking**: The `renderModList` logic now detects the absence of an active profile and redirects to a dedicated `empty-library-no-profile` container, which is a structural clone of the primary `empty-profiles` component.
- **Cognitive Clarity**: The system explicitly distinguishes between "No Profile Selected" (Global State) and "Empty Result Set" (Contextual State), reducing user confusion during onboarding.
- **Improved Interaction**: The "How it works" button correctly invokes `window.openDocs` (aliased to `openDiagram`), and the Profile Creation button seamlessly navigates between tabs before opening modals.

### 22. Server Administration Suite Backend

The administration suite leverages dedicated Rust modules for high-speed IP and ID management.

| Module | Responsibility |
| :--- | :--- |
| `ban_manager.rs` | Handles persistence of banned IPs and Creator IDs. Uses a thread-safe `HashSet` for O(1) lookups during connection attempts. |
| `whitelist_manager.rs` | Manages the repository's whitelist state. Integrated with the HTTP server's request filtering layer. |
| `security.rs` | Provides utilities for Creator ID generation and salted hashing to prevent spoofing. |

---

## 23. Javascript to TypeScript Migration (v0.9.9)

BMM v0.9.9 marks a significant milestone with the transition of the frontend codebase to **TypeScript (TS)**. This move ensures structural stability and type safety across the entire application logic.

### 23.1. Type Safety & Stability
- **Interface Definitions**: Every core data structure (Profile, Mod, Tag, UpdateInfo) is now strictly typed, preventing "undefined" runtime errors during complex mod operations.
- **IPC Safety**: Command invocations (`invoke`) and event listeners (`listen`) are now channeled through type-safe wrappers, ensuring that arguments and return values always match the expected Rust-side schema.

### 23.2. Modern ESM & The ".js" Extension Requirement
Due to the **Modern ESM (ECMAScript Modules)** standard and the way browsers/Tauri handle compiled code, all internal imports in the `.ts` source files must use the `.js` extension (e.g., `import { api } from './api.js'`).
- **Logic**: The TypeScript compiler (TSC) does not rewrite the import extension. Since the browser executes the final compiled `.js` files, the source code must reference the target extension to maintain compatibility with native browser resolution.

---

## 24. Semantic Search Algorithm & Weighted Scoring

BMM 0.9.9 features an advanced search engine that goes beyond simple string matching.

### 24.1. The Processing Pipeline
1. **Normalization**: Both the query and the documentation index are converted to lowercase and stripped of accents (Diacritics removal).
2. **Keyword Extraction**: The search query is split into individual significant keywords.
3. **Multi-Source Indexing**: The engine crawls standard Markdown documentation AND the interactive diagram registry (Nodes + Tasky explanations).
4. **Weighted Intersection (v0.9.9 Refinement)**:
    - **Non-Binary Scoring**: Replaced the original 100% match system with a nuanced weighted algorithm.
    - **Perfect Match (1.0)**: Exact string equality.
    - **Anchored Match (0.95)**: String starts with the query.
    - **Keyword Ratio**: Partial matches are scored based on the percentage of matching keywords vs. total query length, with a "Match %" badge displayed in the UI.

---

## 25. Advanced SVG Manipulation & Highlighting (v0.9.9)

To provide premium visual feedback during documentation search, BMM implements a specialized highlighting engine for Mermaid.js diagrams.

### 25.1. Filter Clipping Prevention
When applying a `drop-shadow` filter to an SVG node, parent groups (like clusters or the main diagram container) can often clip the effect due to default `overflow: hidden` rules.
- **Recursive Traversal**: The highlighting logic now recursively traverses the DOM from the target node up to the SVG root, forcing `overflow: visible` on all parent elements.
- **Pulsing Glow**: Uses CSS `@keyframes` and `drop-shadow` to create a non-intrusive blue halo that indicates the search result without displacing the node or breaking the diagram layout.

---

## 26. Core Threading & I/O Isolation

To prevent UI "micro-stutters" during heavy mod operations, BMM enforces a strict threading model.

### 26.1. Background Workers
- **Disk I/O Worker**: All file copies, deletions, and SHA-256 integrity checks are isolated in the `spawn_blocking` pool.
- **Network Worker**: Downloads and API requests run in parallel background threads, allowing the user to browse the library while a mod list is being imported.

---

*Better Mod Manager is developed by FreeProject089 — Engineered for uncompromising performance, file safety, and modern mod management.*
