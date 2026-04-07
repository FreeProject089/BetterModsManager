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
| 3 | Conflict Check | For each mod file, checks if a file already exists at the target path |
| 4 | Backup | If conflict exists, the original game file is moved to `backup_path`, preserving structure |
| 5 | Injection | The mod file is copied to the game ROOT path |
| 6 | Track | All installed file paths are stored in `ModEntry.installed_files` |
| 7 | State Update | `mod.enabled = true`, `profile.active_mods` is updated, `state.save()` is called |
| 8 | History Log | A timestamped "Enabled" event is written |

### Deactivation Flow (`disable_mod` command)

| Step | Function | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquires the global Mutex |
| 2 | File Resolution | Merges `installed_files` with `list_mod_files()` into a deduplicated set via `HashSet` |
| 3 | `unapply_mod_stacked()` | For each file, deletes the installed copy from the game ROOT |
| 4 | Restoration | Moves the backed-up original file from `backup_path` back to its original location |
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
- **Per-Disk Awareness**: The limiter detects disk physical mapping and applies limits accordingly.

### Conflict Check Cache (v0.9.9)

To further optimize performance, BMM implements a metadata-based caching system:
- **Logic**: Before scanning a mod folder, BMM compares its last modification date (`mtime`) with a stored metadata cache using `std::fs::metadata().modified()`.
- **I/O Optimization**: (v0.9.9) The disk monitoring system now caches the hardware disk list during bulk operations, preventing redundant refreshes.
- **Cache Leveraging**: (v0.9.9) The `apply_mod_stacked` engine leverages the global `mod_files_cache` to determine file ownership, eliminating recursive disk scans for already-active mods.
- **Performance Gain**: These combined optimizations result in up to 90% faster activation for mods with complex dependency chains.

### Why Physical Copy Instead of Symlinks

| Method | Stability | Anti-Cheat Compatible | Network Drive Support |
| :--- | :--- | :--- | :--- |
| Symlinks | Low (Windows permissions fragile) | No | No |
| BMM Physical Copy | High | Yes | Yes |

---

## 6. Backend — Concurrent Safety

| Mechanism | Purpose |
| :--- | :--- |
| `MOD_OP_LOCK: Mutex<()>` | Prevents concurrent mod activation/deactivation |
| `Arc<Mutex<AppData>>` | Guarantees sequentially consistent reads/writes to app state |
| `tauri::async_runtime::spawn_blocking()` | Offloads all heavy I/O to background workers |

---

## 7. Backend — Mass Installation Engine (.MM Format)

### Install from Modlist Flow

| Step | Mechanism | Detail |
| :--- | :--- | :--- |
| 1 | Parse | `serde_json::from_str()` deserializes the `.mm` JSON into a `ModList` struct |
| 2 | Profile Creation | If `create_profile = true`, a new `Profile` is created and set as active |
| 3 | Local Deduplication | Re-uses existing mod files if found on disk to save bandwidth |
| 4 | HTTP Download | Fetches missing files via `reqwest::blocking::get()` |
| 5 | Zip Detection | Magic number inspection for reliable extraction |
| 6 | Extraction | Writes files to disk via `zip::ZipArchive` |
| 7 | Progress Events | Emits `bmm://mod-download-progress` with granular details |
| 8 | Cancellation | Checks `AtomicBool` in the `AppState` to allow termination |

### Deep Integrity Engine (v0.9.9)

- **SHA-256 Hashing**: Full cryptographic verification of every installed file against its source. This identifies corruption, partial overwrites, or unauthorized modifications that simple file-size checks would miss.
- **Thread Isolation**: The CPU-intensive hashing logic is offloaded to the asynchronous `spawn_blocking` worker pool to maintain a 60 FPS UI experience.

---

## 8. Backend — OvGME Migration (`ovgme.rs`)

BMM can directly parse OvGME's proprietary binary `.dat` configuration files.

| Step | Implementation Detail |
| :--- | :--- |
| **Discovery** | Scans `C:\ProgramData\OvGME\` for `game.dat` |
| **Binary Parsing** | Reads UTF-16 LE data from fixed byte offsets |
| **Profile Mapping** | Maps OvGME paths to native BMM `Profile` structs |

---

## 9. Frontend — Modular Architecture

The frontend uses a modular ES6 architecture for scalability.

| Module | Responsibility |
| :--- | :--- |
| `api.js` | Direct IPC bridge with Tauri (invokes, listeners). |
| `state.js` | Centralized state manager for UI-Backend sync. |
| `profiles.js` | Profile management and grid rendering. |
| `mods.js` | Library logic and conflict event handling. |
| `i18n.js` | Dynamic internationalization engine. |
| `utils.js` | Shared escapers and sanitizers. |

---

## 10. Dynamic Internationalization Engine

- **Detection**: `get_available_languages` scans the `Lang` directory.
- **Activation**: Instant language switching via `data-i18n` attributes.

---

## 11. Frontend — Security

| Threat | Mitigation | Implementation |
| :--- | :--- | :--- |
| XSS | HTML entity escaping | `escHtml()` converts special characters |
| Attribute injection | Attribute escaping | `escAttr()` sanitizes attribute strings |
| Path traversal | Scope enforcement | Rust backend validates paths against profile bounds |

---

## 12. Technical Specification Summary

| Parameter | Implementation |
| :--- | :--- |
| **RAM (Idle)** | ~60 MB |
| **RAM (Active)** | < 130 MB |
| **UI Framerate** | 60 FPS |
| **Cold Boot Time** | < 1.5 seconds |
| **Backend** | Rust 1.70+ (Tauri v1) |
| **Frontend** | ES2022 JavaScript |

---

## 13. Crash & Logging System (`crash.rs`)

- **LOG_BUFFER**: Thread-safe circular buffer for in-memory logging.
- **Panic Hook**: Captures backtraces and packages ZIP reports on failure.

---

## 14. Advanced Troubleshooting (Debug Menu)

- **Config Check**: `is_debug_mode` controlled via `app.cfg`.
- **State Reset**: Overwrites `AppData` and clears local storage.

---

## 15. Auto-Update Engine (`autoupdate.rs`)

GitHub-based async updater with SemVer comparison and asset detection.

---

## 16. PTB System (Public Test Build)

Distribution mode controlled via `app.cfg` with themed release note modals.

---

## 17. Legal & EULA System (v0.9.9)

- **Installer Integration**: Forced EULA acceptance in NSIS and WiX/MSI configurations.
- **Dynamic Localization**: Backend command `get_eula_text` dynamically selects `EULA_{LANG}.md` with fallback to `EULA.md`.
- **Markdown Rendering**: Frontend uses `renderMarkdown` utility to display legal text with full formatting in a dedicated modal.
- **Community Governance**: Formalized "Server Repositories & Moderation" clauses to protect community hosts.

---

## 17. Real-Time Performance Monitoring

`sysinfo` backend with high-perf Canvas/SVG visualization and timeline scrubbing.

---

## 18. Interactive Documentation Engine

- **Mermaid.js bridge**: Technical visualization with localized node labels.
- **Pan-Zoom**: Persistent viewport management.

---

## 19. Multimedia & Credits Engine

Video backgrounds using `asset://` protocol with Intersection Observer throttling.

---

## 20. Server Repository System (Server Mode)

Integrated HTTP server with manifest generation and Smart Sync (SHA-256).

---

## 21. Javascript to TypeScript Migration (v0.9.9)

Complete transition to Strictly Typed ESM for structural stability and IPC safety.

---

## 22. Semantic Search Algorithm & Weighted Scoring

Weighted intersection matching (Perfect, Anchored, Keyword Ratio) with Match % badges.

---

## 23. Advanced SVG Manipulation & Highlighting (v0.9.9)

Recursive DOM traversal to prevent filter clipping and "Pulsing Glow" effect for diagram search.

---

## 24. Core Threading & I/O Isolation

Isolation of Disk I/O and Network tasks in background workers to ensure 60 FPS UI.

---

## 25. Premium UI Animation & Usability Framework (v0.9.9)

BMM v0.9.9 introduces a specialized logic layer for high-fidelity interactive elements.

### 25.1. Dropdown State Machine
The global dropdown system (`modals.ts`) uses an asynchronous state machine to manage entry and exit phases.
- **Portal Injection**: Menus are cloned and injected into a top-level `#global-dropdown-portal`.
- **Async Closure**: The `closeGlobalDropdown` function implements a two-stage removal. It first triggers a CSS `.closing` animation before physically purging the DOM after a 200ms safety window.

### 25.2. Mouse Grace Period & State Recovery
To solve common "hover loss" issues during rapid mouse movement:
- **100ms Grace Delay**: The closure trigger is buffered by a 100ms timer.
- **State "Catching"**: Entering the dropdown or re-entering the trigger clears the `dropTimer` and immediately restores the `.open` state, effectively canceling the closure mid-animation.
- **Invisible Bridging**: Uses pseudo-elements (`::before`) to create an invisible hover bridge between the trigger and the floating menu, preventing `mouseleave` events in the gap.

---

*Better Mod Manager is developed by FreeProject089 — Engineered for uncompromising performance, file safety, and modern mod management.*
