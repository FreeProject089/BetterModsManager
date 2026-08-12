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
| `active_profile_id` | `Option<String>` | UUID of the currently selected profile |
| `custom_tags` | `Vec<TagDef>` | User-defined taxonomy labels (name + color) |
| `disk_limits` | `HashMap<String, u64>` | Per-path disk I/O speed limits (MB/s) |
| `settings` | `AppSettings` | App preferences/configuration |
| `launch_packs` | `Vec<LaunchPack>` | Application launch groups |
| `installed_plugins` | `Vec<InstalledPlugin>` | Installed plugin manifests |
| `plugin_permissions` | `HashMap<String, Vec<String>>` | Granted permissions per plugin id |
| `modpacks` | `Vec<LocalModpack>` | Locally stored `.bmp` modpacks |

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
| `author` | `Option<String>` | Author attribution |
| `description` | `Option<String>` | Freetext description |
| `dependencies` | `Vec<String>` | Declared mod dependencies |
| `mod_folder_path` | `PathBuf` | Absolute path to the mod's root folder on disk |
| `enabled` | `bool` | Whether the mod is currently active in the game |
| `status` | `ModStatus` | Enum: `Enabled`, `Disabled`, `Error(String)` |
| `installed_files` | `Vec<String>` | Paths of files injected into the game ROOT |
| `tags` | `Vec<String>` | Assigned tag names |
| `download_links` | `Vec<DownloadLink>` | Web links (GitHub, NexusMods, etc.) with type and label |
| `install_notes` | `String` | Placement/setup instructions (inherited from `.MM`) |
| `activation_order` | `u32` | Activation order (0 = first applied), used for conflict resolution |
| `file_hashes` | `Option<HashMap<String,String>>` | Per-file SHA-256 map for the integrity engine |
| `content_id` | `Option<String>` | Deterministic content fingerprint (see §46) |

---

## 5. Backend — The Smart Copy Filesystem Engine

The core of BMM's mod management is the **Stacked Physical Copy** engine: the `enable_mod`/`disable_mod` commands and `apply_mod_stacked`/`unapply_mod_stacked`/`run_mod_io_worker` live in `src-tauri/src/commands/mods.rs`, while the low-level chunked copy + throttling primitives live in `src-tauri/src/fs_utils.rs`.

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

The frontend is **TypeScript** (`// @ts-nocheck`) under `frontend/src/`, compiled to `frontend/js/` (see §22). Modules are grouped into `core/` (cross-cutting), `features/` (per-page logic) and `ui/`.

| Module | Responsibility |
| :--- | :--- |
| `core/api.ts` | Direct IPC bridge with Tauri (invokes, listeners, file pickers). |
| `core/i18n.ts` | Dynamic internationalization engine. |
| `core/utils.ts` | Shared escapers/sanitizers (`escHtml`, `escAttr`). |
| `core/links-config.ts` | Central external-link registry (`links.json`). |
| `features/profiles/profiles.ts` | Profile management and grid rendering. |
| `features/mods/*.ts` | Library logic, mod list/detail, conflict handling. |
| `ui/app.ts` | Boot sequence, view routing, global wiring. |

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

## 18. Real-Time Performance Monitoring

`sysinfo` backend with high-perf Canvas/SVG visualization and timeline scrubbing. (v1.0.0) Enhanced with an **Advanced Performance Monitor** for deep-dive system health (Latency, Thread usage, Async tasks) and automated reporting.
- **Solid Progress Design**: Replaced linear-gradient animations with high-visibility flat blue (`var(--accent)`) background-color for consistent performance rendering.

---

## 19. Interactive Documentation Engine

- **Mermaid.js bridge**: Technical visualization with localized node labels.
- **Pan-Zoom**: Persistent viewport management.

---

## 20. Multimedia & Credits Engine

Video backgrounds using `asset://` protocol with Intersection Observer throttling.

---

## 21. Server Repository System (Server Mode)

Integrated HTTP server with manifest generation and Smart Sync (SHA-256).

---

## 22. Javascript to TypeScript Migration (v0.9.9)

Complete transition to Strictly Typed ESM for structural stability and IPC safety.

---

## 23. Semantic Search Algorithm & Weighted Scoring

BMM's interactive documentation engine features a dual-mode search system with full semantic expansion capabilities.

### 23.1. Index Architecture

The search index is built at startup (and on every language change) via `buildDiagramIndex()` in `docs-ui.ts`. Each index entry carries a **weight tier**:

| Weight | Source | Example |
| :--- | :--- | :--- |
| **1.0** | Diagram title | "Mod Activation Flow" |
| **0.8** | Main node label + description | `APPLY_MOD`: "Apply Mod" + desc |
| **0.6** | Secondary node (via `explanationPrefix`) | Detail nodes |
| **0.4** | Edge labels | "Conflict detected" |

The final relevance score for a result is: `raw_score × weight_tier`. Results are deduplicated per `diagramId + nodeId`, keeping only the highest score.

### 23.2. Classic Mode

A fast substring-based engine. If the normalized query string appears in the normalized text, a score is computed:
```
score = 0.7 + (queryLength / textLength) × 0.2
```
Results are shown/hidden without synonym expansion.

### 23.3. Semantic Mode

A full word-level engine with three phases:

1. **Synonym Expansion**: Every query word is expanded via a bidirectional FR/EN synonym dictionary (~25 canonical groups covering: activation, backup, conflict, integrity, performance, security, launch, etc.). Each expansion is pre-built into a flat lookup `Map<string, string[]>`.

2. **Matching Pipeline** (per query word):
   - **Exact boundary match** (`\bword\b`) → score `1.0`
   - **Substring match** → score `0.75`
   - **Levenshtein ≤ 1** (for words ≥ 5 chars) → score `0.7`
   - **Levenshtein = 2** → score `0.45`

3. **Final Score Composition**:
```
finalScore = (matchRatio × 0.35) + (avgWordScore × 0.45) + substringBonus(0.2)
```
Adaptive threshold: `0.45` for single-word queries, `0.32` for multi-word.

### 23.4. UX Details

- **Debounce**: 150ms delay prevents thrashing during fast typing.
- **Score badges**: % badge on each result card (green >85%, blue >65%, amber otherwise), visible only in Semantic mode.
- **Context labels**: Each result shows its tier (`📌 Title`, `● Node`, `○ Detail`, `→ Edge`).
- **No-results state**: Informative empty state with a "Try Semantic mode →" shortcut when in Classic mode.
- **Result cap**: Top 12 results displayed after deduplication.

---

## 24. Advanced SVG Manipulation & Highlighting (v0.9.9)

Recursive DOM traversal to prevent filter clipping and "Pulsing Glow" effect for diagram search.

---

## 25. Core Threading & I/O Isolation

Isolation of Disk I/O and Network tasks in background workers to ensure 60 FPS UI.

---

## 26. Premium UI Animation & Usability Framework (v0.9.9)

BMM v0.9.9 introduces a specialized logic layer for high-fidelity interactive elements.

### 26.1. Dropdown State Machine
The global dropdown system (`modals.ts`) uses an asynchronous state machine to manage entry and exit phases.
- **Portal Injection**: Menus are cloned and injected into a top-level `#global-dropdown-portal`.
- **Async Closure**: The `closeGlobalDropdown` function implements a two-stage removal. It first triggers a CSS `.closing` animation before physically purging the DOM after a 200ms safety window.

### 26.2. Mouse Grace Period & State Recovery
To solve common "hover loss" issues during rapid mouse movement:
- **100ms Grace Delay**: The closure trigger is buffered by a 100ms timer.
- **State "Catching"**: Entering the dropdown or re-entering the trigger clears the `dropTimer` and immediately restores the `.open` state, effectively canceling the closure mid-animation.
- **Invisible Bridging**: Uses pseudo-elements (`::before`) to create an invisible hover bridge between the trigger and the floating menu, preventing `mouseleave` events in the gap.

---

## 27. Modpack Engine — `.bmp` Format (v0.9.9)

BMM implements a complete modpack lifecycle system in `commands/modpack.rs`.

| Component | Implementation |
| :--- | :--- |
| **Data Model** | `LocalModpack` struct containing metadata, a `Vec<ModpackModRef>` and per-file `ModpackFileRef` with SHA-256 hashes |
| **Persistence** | Each modpack serialized as `<id>.json` in `AppData/modpacks/` via `serde_json` |
| **Integrity Verification** | `check_modpack_integrity` compares local files byte-level against the manifest: Missing, Corrupted, or Valid |
| **Repair Engine** | `repair_modpack_mod` supports two repair modes: Direct Download (zip extraction) and Server Repo (file-by-file SHA-256 fetch) |
| **Local Recovery** | `find_file_by_hash_in_dir` recursively scans the target directory for files matching an expected hash before initiating network downloads |
| **Progress Events** | Emits `bmm://repair-progress` IPC events with per-file progress percentages |
| **Export/Import** | File dialog integration via `tauri::api::dialog` for `.bmp` format with UUID collision avoidance on import |

---

## 28. BetaHub Integration & Proof-of-Work (v0.9.9)

BMM integrates with BetaHub for structured bug reporting.

| Component | Implementation |
| :--- | :--- |
| **API Client** | `betahub-api.ts` handles authentication, report submission, and history retrieval |
| **Modal System** | `betahub-modals.ts` (~63KB) provides a full UI for bug/suggestion submission with category tabs |
| **PoW Engine** | `betahub-pow.ts` implements SHA-256 proof-of-work challenges to prevent spam without captchas |
| **Crash Integration** | `crash-report.ts` chains `openBugReportModal()` with crash ZIP path pre-attachment from the crash detection flow |

---

## 29. System Access Control (v0.9.9)

`security-modal.ts` implements a dual-mode filesystem security gate.

| Component | Implementation |
| :--- | :--- |
| **Security Modal** | Glassmorphic first-launch modal with radio-card selection (Full/Limited) |
| **Full Access** | `fs_security_mode = "full"` — unrestricted filesystem access across all drives |
| **Limited Access** | `fs_security_mode = "limited"` — JS interface restricted to profile-defined folders |
| **Backend Command** | `apply_fs_security_mode_command` applies the selected mode via Tauri scope reconfiguration |
| **Mouse Glow Effect** | `mousemove` tracking via CSS custom properties (`--x`, `--y`) for premium radial-gradient hover effects |

---

## 30. Onboarding System (v0.9.9)

`onboarding.ts` implements a guided first-use tutorial.

| Component | Implementation |
| :--- | :--- |
| **Step Definition** | 14+ steps defined as typed objects with `navTarget`, `selector`, `img`, and `icon` |
| **Language Picker** | Step -1 renders a full language menu with FlagCDN integration and reactive re-rendering on `langChanged` events |
| **Element Highlighting** | Computes target element `getBoundingClientRect()` relative to `#app-window-outer` and overlays a focus ring with `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` |
| **Typewriter Effect** | Character-by-character rendering at 18ms intervals via `setInterval` |
| **Persistence** | `onboarding_shown` boolean flag in `settings` prevents re-display on subsequent launches |

---

## 31. Markdown Alert Engine (v0.9.9)

The `renderMarkdown` function in `update-notes.ts` now supports GitHub-style alerts.

| Component | Implementation |
| :--- | :--- |
| **Regex Parser** | Matches `<blockquote>\s*<p>\[!(NOTE\|TIP\|IMPORTANT\|WARNING\|CAUTION\|...)\]` patterns in rendered HTML |
| **Bilingual Support** | French equivalents (`REMARQUE`, `ASTUCE`, `AVERTISSEMENT`, `ATTENTION`) map to the same alert classes |
| **CSS Classes** | `.md-alert-note` (blue), `.md-alert-tip` (green), `.md-alert-important` (purple), `.md-alert-warning` (amber), `.md-alert-caution` (red) |
| **i18n Titles** | Alert titles fetched via `t('update.alert.<type>')` for localized rendering |

---

## 32. Frontend Interaction Telemetry (v0.9.9)

`user-logger.ts` implements comprehensive frontend telemetry.

| Component | Implementation |
| :--- | :--- |
| **Click Logger** | Captures button/link clicks via delegated `click` handler with `closest()` traversal |
| **Keyboard Logger** | Tracks `Ctrl+Alt+D` (DevTools), `Ctrl+Shift+F` (FSDM), `Ctrl+D` (Debug Menu toggle) |
| **Scroll Logger** | Debounced (1s) scroll position logging with active view identification |
| **Drop Logger** | `drop` event captures file names from `DataTransfer` |
| **Error Capture** | `window.error` and `unhandledrejection` forwarded to `log_frontend_line` backend command |
| **Focus/Blur** | Window focus changes logged to aid crash timeline reconstruction |

---

## 33. Launch Pack Module — Invisible Execution & Asset Pipeline (v1.0.0)

BMM v1.0.0 implements a cross-platform (Windows-centric) application grouping and silent execution engine.

| Component | Implementation |
| :--- | :--- |
| **VBScript Launcher** | Generates dynamic `launcher.vbs` scripts using `WScript.Shell.Run` with `WindowStyle=0` (Hidden) to prevent console pop-ups for `.exe` and `.bat` files. |
| **PowerShell Stealth** | Leverages `powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass` for non-intrusive script execution. |
| **Escaping Logic** | Custom double-quote escaping for VBScript strings to prevent `800A0401` syntax errors in long file paths. |
| **Icon Pipeline** | Uses the `image` crate (Lanczos3 filter) to downsample source images into a standardized 256x256 `.ico` buffer. |
| **Shortcut Engine** | Dynamically executes a hidden PowerShell sub-process to interface with `WScript.Shell` COM objects for creating desktop `.lnk` shortcuts. |
| **Asset Persistence** | Managed storage in `AppData/Local/bmm/LaunchPacks/<id>/` with automatic recursive cleanup on pack deletion. |

---

## 34. Model Context Protocol (MCP) Server (v1.0.0)

BMM v1.0.0 features a professional-grade JSON-RPC implementation for AI integration.

| Component | Implementation |
| :--- | :--- |
| **Protocol** | JSON-RPC 2.0 over standard I/O (stdio) streams. |
| **Serialization** | Intensive use of `serde` and `serde_json` for type-safe tool definitions and result mapping. |
| **Tool Surface** | ~50 atomic tools exposed via the `mcp-server` binary, covering the entire BMM command surface. |
| **State Bridge** | The MCP binary initializes a secondary instance of the `AppState` engine to access local data without requiring the main BMM UI to be running. |
| **Async Handling** | Fully asynchronous request processing using `tokio` to handle concurrent tool calls from AI agents. |

---

## 35. Unified Command Line Interface (CLI) (v1.0.0)

The new unified CLI provides a powerful terminal-based interface for BMM management.

| Component | Implementation |
| :--- | :--- |
| **Command Parser** | Built on the `clap` (Command Line Argument Parser) crate with multi-level subcommands and typed arguments. |
| **Visual Feedback** | Integration of `colored` for log levels and `tabular` for structured data presentation in the terminal. |
| **Banner Engine** | High-fidelity ASCII art rendering engine for branding and version display on startup. |
| **Environment Discovery** | Automatic `PathBuf` resolution logic to locate the BMM data directory across different Windows user profiles. |
| **Error Reporting** | Direct integration with the new `AppError` strategy for consistent error codes between CLI and GUI. |

---

## 36. UI Polish & Contextual Help Logic (v1.0.0)

BMM v1.0.0 introduces a centralized assistance and visual refinement engine.

| Component | Implementation |
| :--- | :--- |
| **Tasky Help Engine** | `window.showTaskyHelp(key, type)` triggers localized bubbles. (v1.0.0) Redesigned for compactness with centered alignment, reduced padding, and optimized anchor positioning. |
| **Tooltip Isolation** | Tooltips are rendered in a high-z-index portal to prevent clipping from parent `overflow: hidden` containers. |
| **Resize Strip Logic** | A custom resize engine in `titlebar.ts` listens for `mousedown` on edge strips and uses `tauri::window::start_dragging` or manual bounds calculation for precision. |
| **Glassmorphism Tokens** | Standardized CSS variables (`--bmm-glass-bg`, `--bmm-glass-border`) used across all 1.0 components for visual consistency. |

---

## 37. Directory Mapping & Analytics (v1.0.0)

The Directory Mapping engine (Visual Mapper) is a high-performance recursive scanner designed for large-scale mod collections.

### 37.1. Recursive Walking Engine (Rust)
The backend `scan_directory` command implements a multi-threaded recursive walker.
- **Cycle Detection**: Uses a `HashSet` of inode/path combinations to detect and terminate infinite recursion caused by circular symlinks or folder loops.
- **Infinite Depth Support**: (v1.0.0) The stack-based walker is optimized for memory, allowing for theoretical infinite nesting depth without stack overflow.
- **Filtering Logic**: Implements a blacklisting system to ignore hidden system folders (`.git`, `System Volume Information`) and irrelevant binary artifacts, keeping the tree clean.

### 37.2. Real-time Mod Statistics
BMM v1.0.0 introduces advanced telemetry for profile health.
- **Global Mod Counter**: The `get_profiles_with_stats` command performs a pre-emptive scan of the `mods` directory. It differentiates between valid mod folders (containing files) and orphaned metadata entries.
- **Reactive State Bridge**: The results are piped through an async IPC stream, allowing the UI to update the "Total Mods" badge in the sidebar and profile cards without blocking user interaction.
- **Ownership Analysis**: The mapper correlates file ownership across multiple active mods, identifying which mod physically "owns" a file in the game root at any given time.

### 37.3. Frontend Tree Rendering
The `Mapper.ts` module handles the visual presentation of the directory tree.
- **Virtual Scrolling**: Optimized to render only the visible nodes in the viewport, allowing for smooth 60 FPS interaction even with libraries containing 10,000+ files.
- **Contextual Actions**: Every node in the tree is bound to a native Shell command, enabling "Open in Explorer" and "Copy Relative Path" functionality.
- **Visual Taxonomy**: Uses distinct SVG iconography and color tokens to distinguish between:
    - **Root Mods**: Base installation folders.
    - **Asset Containers**: Sub-folders containing textures, scripts, or models.
    - **Binary Payloads**: `.exe` or `.dll` files that trigger high-priority conflict checks.

---

## 38. Metadata Updates History Engine (v1.0.0)

BMM v1.0.0 introduces a persistent tracking system for all mod metadata mutations.

| Component | Implementation |
| :--- | :--- |
| **Tracking Trigger** | Integrated into the `update_mod_metadata` command. Compares the "before" and "after" state of each field using `PartialEq`. |
| **Event Schema** | `HistoryEntry` struct capturing: Mod ID, Timestamp (UNIX), Action Type, and a bitmask/list of modified field identifiers. |
| **Data Storage** | Serialized as a separate `history.json` file per profile to ensure high performance and avoid bloating the main `mods.json`. |
| **Retention Worker** | A background cleanup task that executes on application startup, purging entries older than the user-defined threshold (default: 30 days). |
| **Search & Filter** | The frontend uses a specialized filter state to perform client-side matching on the history collection without re-fetching from disk. |

---

## 39. Export Cancellation Architecture (v1.0.0)

BMM implements a cooperative cancellation pattern for the `.MM` export operation.

| Component | Implementation |
| :--- | :--- |
| **AtomicBool Flag** | `export_cancelled: Arc<AtomicBool>` added to `AppState`. Reset to `false` at the start of every `export_modlist` invocation. |
| **Check Point** | The Rust export loop inspects `state.export_cancelled.load(Ordering::SeqCst)` before processing each mod entry. |
| **Cancel Command** | `cancel_export_modlist` Tauri command sets the flag to `true` via `state.export_cancelled.store(true, Ordering::SeqCst)`. |
| **Event Protocol** | When the flag is detected, the loop emits `bmm://export-progress` with `cancelled: true`, then returns an `AppError::LockError`. |
| **Frontend Handling** | The JS `wasCancelled` flag is set on abort button click. The `finally` block checks it to decide between "Export cancelled" and "Export complete" toasts. |

---

## 40. Folder Size Command (v1.0.0)

A dedicated Tauri command provides recursive disk usage measurement for arbitrary directories.

| Component | Implementation |
| :--- | :--- |
| **Command** | `get_folder_size(path: String) -> u64` in `commands/disk.rs` |
| **Algorithm** | Depth-first `std::fs::read_dir` recursion. Each regular file contributes `metadata().len()` bytes. Errors (permissions, broken symlinks) are silently skipped. |
| **Frontend Usage** | `profiles.js` calls this for each profile's `mods_path` after the card grid renders. Results are formatted via `formatBytes()` and injected into `.profile-disk-usage` spans. |
| **Performance** | Runs synchronously in the Tauri command thread. For very large libraries (>50 GB), the async IIFE isolates the blocking call, keeping the grid responsive during measurement. |

---

## 41. Server Browse Verification (v1.0.0)

The public repository browser enforces a `hash` field gate.

| Component | Implementation |
| :--- | :--- |
| **Gate Filter** | `renderRepoList()` applies `filtered.filter(r => r.hash && r.hash.length > 0)` before all other filters. |
| **Schema Contract** | `repos.json` entries must carry a `hash` string field (set by the BMM team when validating a server). Entries without it are silently excluded. |
| **Verified Badge** | Each displayed card renders a green "Verified" badge with a checkmark SVG in the name row. |
| **Fallback** | If the remote `repos.json` is unreachable, the browser shows its existing error/empty state — no unverified servers leak through. |

---

## 42. Centralized Link Registry (v1.0.0)

All external URLs are decoupled from code into `frontend/assets/links.json`, loaded through `frontend/src/core/links-config.ts`.

| Component | Implementation |
| :--- | :--- |
| **Schema** | `BmmLinks` interface: `plugin_catalog`, `plugin_github`, `server_browse`, `contributors`, `autoupdate_api`, `apps_catalog`, plus social links (`github_repo`, `discord`, `reddit`, `kofi`, `kofi_community`, `ed_forum`). |
| **Load order** | `loadLinks()` tries `REMOTE_LINKS_URL` → local `assets/links.json` → hardcoded `DEFAULTS`. First success wins; each merge is spread over `DEFAULTS` so missing keys never break. |
| **Observability** | A single `console.log` reports the resolved source (`remote (...)`, `local file (...)`, or `built-in defaults`). |
| **Accessor** | `getLinks()` returns the cached `Readonly<BmmLinks>`; called by `repo.ts`, `plugins.ts`, `update-notes.ts`, `apps-catalog.ts` and `app.ts`. |
| **Backend pass-through** | `fetch_plugin_catalog(catalog_url)` and `check_for_update(api_base_url)` accept the URL from the frontend, falling back to a Rust constant. |
| **Runtime HTML patching** | `patchHtmlLinks()` runs after `loadLinks()` and rewrites every `[data-link-key]` element's `href` / `data-url`, so static links in `index.html` track the JSON. |
| **Update integration** | `links.json` is listed in `TRACKED_FILES` of `scripts/gen-update-manifest.mjs`, so the incremental updater can patch URLs without a new installer. |

---

## 43. App Catalog Engine (v1.0.0)

The App Catalog is implemented in `src-tauri/src/commands/apps.rs` (+ `models/app_catalog.rs`) and `frontend/src/features/apps/apps-catalog.ts`. State persists to `apps_state.json` in the app data directory.

### Catalog Fetch & Trust Chain
- `fetch_app_catalogs(catalog_url, extra_community_urls)` merges multiple catalogs in tiers and assigns trust **by source**, never by JSON content (`apply_trust()` overwrites `official`/`partner` and truncates `tags` to 3).
  - **Tier 0 — Official**: the `apps_catalog` URL → `official = true`. Its `partner_catalogs` defines Tier 1; its `community_imports` feed Tier 2.
  - **Tier 1 — Partner**: URLs in the official `partner_catalogs` → `partner = true`.
  - **Tier 2 — Community**: `community_imports` + user-added sources → no badge.
- Entries are de-duplicated by `id` (higher tier wins). A visited-set + a 30-source cap prevent loops.

### Install Engine
- `install_app(...)` downloads to a managed `<install_path>/<id>/` folder, then branches on type:
  - **zip** → extracted; if it contains a portable exe it's kept (`is_managed = true`) and the main exe chosen by `pick_main_exe()` (name-score, skips installers). If it contains **only** an installer, that installer is run via `run_installer_and_detect()`.
  - **exe/msi** (or filename containing `setup`/`install`) → `run_installer_and_detect()`.
  - **script** → kept and registered as the launch target.
- `run_installer_and_detect()` snapshots `common_install_roots()` (Program Files, Program Files (x86), LocalAppData\Programs) **before** launch, `child.wait()`s on a `spawn_blocking` task, then resolves exe/dir/uninstaller from `find_registry_app()` (registry `DisplayIcon` / `InstallLocation` / `UninstallString`) with a folder-diff fallback (`auto_detect_installed_exe()` + `match_score()`).

### Launch, Usage Tracking & Uninstall
- `launch_app()` selects an interpreter by extension (`.ps1`→PowerShell `-ExecutionPolicy Bypass`, `.bat`/`.cmd`→cmd, `.py`→python, `.vbs`→wscript, `.sh`→bash, else direct), then spawns a background thread that `wait()`s for exit and adds the elapsed seconds to `usage_seconds`.
- `uninstall_app(app_id, delete_files, run_uninstaller)`:
  - `run_uninstaller` → resolves the command from state or a live `find_registry_app()` lookup, parses it with `parse_command()` (handles quoted paths + args), and spawns it directly (OS handles UAC).
  - else deletes the managed folder **before** mutating state (so a failed delete leaves state intact).
- Commands registered: `fetch_app_catalogs`, `install_app`, `detect_app_executables`, `launch_app`, `get_apps_state`, `uninstall_app`, `toggle_app_favorite`, `add/remove_community_source`, `get_default_apps_path`, `set_app_exe_path`, `register_installed_exe`, `app_has_uninstaller`, `open_app_folder`, `clear_app_history`.

### Frontend
- Tabs: Browse / Installed / Favorites / History / Sources / Create. State is refreshed via a lightweight `get_apps_state` read after every mutation (no polling).
- `renderMarkdown()` is a dependency-free Markdown→HTML renderer (headings, bold/italic, inline + fenced code, lists, blockquotes, links, images) used in the detail modal; README URLs are normalized to raw via `toRawUrl()` to avoid CORS.

---

## 44. Plugin System Architecture (v1.0.0)

Implemented in `src-tauri/src/commands/plugins.rs` with models in `models/plugin.rs`; the catalog is fetched from `links.json`'s `plugin_catalog`.

| Component | Implementation |
| :--- | :--- |
| **Manifest** | `PluginManifest` (id/name/version/author/description/game/permissions/tags/website/folders) plus `apply_mode` (`modlist`/`script`/`both`) and `has_scripts`/`scripts`. |
| **Modlist model** | `PluginModList { strict, required_mods }`; each `PluginModRequirement { name, optional, sha256 }`. `compare_plugin_mods` diffs the active library vs. requirements; `apply_plugin_modlist` enables the set. |
| **Install** | `install_plugin` (from catalog), `install_plugin_from_file` (`.bmmplug`), `create_local_plugin` (in-app authoring), `export_plugin`. `compute_plugin_checksum` validates contents. |
| **Permissions** | `get_plugin_permissions` / `set_plugin_permissions`; external script execution (`run_plugin_scripts`) is gated behind an "unsafe plugins" permission. |
| **Lifecycle** | `toggle_plugin`, `uninstall_plugin`, `get_installed_plugins`, `open_plugin_folder`. |
| **Automation** | `generate_script` emits cURL / PowerShell snippets; `get_app_exe_path`, `write_text_file`, `write_zip_files` support authoring/export flows. |

## 45. Local REST API Server (v1.0.0)

`src-tauri/src/api/mod.rs` runs a **Warp** server on `API_PORT = 51274` (`127.0.0.1`), started on app boot.

| Aspect | Detail |
| :--- | :--- |
| **Routes** | ~75 endpoints via `path!("api" / ...)`: `health`, `status`, `mods` (+ `active`/`enable`/`disable`/`{id}`), `profiles` (+ `activate`/`{id}`), `plugins` (+ `compare`/`apply`), `modpacks` (+ `create`/`enable`/`disable`/`import`/`{id}`), `repo` (`info`/`connect`/`list`/`sync`/`gen`/`host`), `data` (`export`/`import`), `modlists` (`export`/`import`), `creator-id`, `check-update`, `restart`. |
| **Auth** | A per-install token (`get_api_token` / `reset_api_token`) guards mutating routes; SHA-256 is used for token handling. |
| **Concurrency** | Shares `AppData` via `Arc`; uses a `oneshot` channel + `AtomicBool` for graceful shutdown. |
| **Consumers** | The in-app API explorer, generated automation scripts, and external companion tools. |

## 46. ContentID Engine (v1.0.0)

Deterministic mod identity lives in `models/mod_entry.rs`.

| Function | Behaviour |
| :--- | :--- |
| `derive_content_id(folder_path)` | Computes a stable id from the mod's file set — deterministic across machines for identical content. |
| `content_id_from_file_hashes(hashes)` | Folds the per-file SHA-256 map into a single content id. |
| `update_content_id_from_hashes(entry)` | Refreshes `entry.content_id` from already-computed `file_hashes`, keeping it in lockstep with the integrity engine. |
| **Usage** | Mod matching for `.MM` lists, modpacks, repository sync, and the import "already present" check — all keyed on `content_id` rather than folder name. |

---

## 47. Theme System Engine (v1.0.0)

A runtime CSS-variable theming engine. Frontend: `frontend/src/features/themes/theme-engine.ts` (apply/observe) and `theme-editor.ts` (the floating editor). Backend: `src-tauri/src/commands/themes.rs` persists installed themes as `.json` files in a `themes/` directory under the app data dir, plus `import_theme`/`export_theme` (`.bmmtheme` = ZIP) and `fetch_theme_catalogs`.

| Mechanism | Detail |
| :--- | :--- |
| **Token injection** | `applyTheme()` writes `--bmm-*` CSS variables into dedicated `<style>` blocks (vars / css / fonts / patch); source files are never mutated. |
| **Inline patcher** | A `MutationObserver` rewrites hardcoded inline colours on dynamically inserted DOM to the matching token, so late content follows the theme. |
| **Contrast enforcer** | On `mode: 'light'` themes, `enforceLightContrast()` darkens unreadable light text/surfaces via inline `!important` (`data-bmm-contrast`); cleared (`clearAllEnforced()`) when switching back to a dark theme so dynamic cards revert without a refresh. |
| **Element overrides** | The pick tool stores per-selector overrides (colours, states, CSS, icon SVG swap, image) applied as a generated CSS block. |
| **Auto-palette** | `genPalette()` derives a full coherent dark/light token set from a single HSL seed colour. |
| **Sharing** | Export to `.bmmtheme`, a `bmm://theme/import-inline` link, or install from the theme catalog. |

---

## 48. Translation Sandbox (v1.0.0)

`frontend/src/features/settings/i18n-sandbox.ts` — a non-destructive editor over the i18n system (§10). Edits live in an in-memory `_sandbox` map and only touch disk on export.

| Mechanism | Detail |
| :--- | :--- |
| **Sandbox model** | Keys are edited against a base language; `buildExportObject()` merges the full source file with sandbox edits, preserving order and meta keys. |
| **Pointer mode** | Clicking any element resolves its `data-i18n` key (or surfaces hardcoded text) via DOM walking. |
| **Hardcoded scanner** | `find_hardcoded_strings` (Rust) scans source for literals without an i18n key. |
| **Overlay mode** | The modal detaches into a draggable/resizable overlay; the original inline `style` is snapshotted and restored verbatim on exit (avoids the panel sticking at overlay size). |
| **Install path** | Exported `.json` files install via `import_language`; the `import_language_data(code, content)` command also accepts raw JSON. |

## 49. Customizable Navbar & Sandboxed Pages (`bmmpage://`)

The navigation bar is user-configurable (reorder/add/remove entries), and custom
entries can open **sandboxed pages** served over a dedicated `bmmpage://` scheme.

| Component | Implementation |
| :--- | :--- |
| **Custom scheme** | `bmmpage://` pages are rendered in an isolated context, keeping third-party page markup/scripts away from the core app surface. |
| **Permissioned broker** | A broker mediates every privileged call a sandboxed page attempts, granting only explicitly-allowed capabilities (no ambient access to Tauri commands). |
| **Deep-link manager** | `deep_link_manager` (TS + JS core) routes external `bmm://` / `bmmpage://` invocations, incl. web → app **install / add-source** deeplinks from BetterCommunity Web. |

## 50. Plugin Scheduler & Deeplink Actions

`scheduler.ts` runs plugin/script-generation actions on a schedule by firing
deeplinks at chosen times.

| Component | Implementation |
| :--- | :--- |
| **Sources** | Plugins are added via endpoint or deeplink sources; HTML docs ship alongside. |
| **Scheduler** | Time-based execution of script-generation actions, dispatched through the deep-link manager so a scheduled run reuses the same execution path as a manual one. |
| **Web catalog** | The App Catalog Engine (§43) also consumes the BCWEB `catalog.json` feed (apps/plugins/themes) so community content is installable from inside BMM. |

## 51. Platform: Tauri v2 Migration & Hidden Process Spawning

| Component | Implementation |
| :--- | :--- |
| **Tauri v2** | Migrated to Tauri v2 (compiles green on `cargo` + `tsc`; runtime validation ongoing). Capabilities/permissions model updated accordingly. |
| **Hidden spawn** | All background process spawns route through the `crate::commands::proc` hidden-spawn helpers so no console window ever flashes (Windows `CREATE_NO_WINDOW`). |
| **Interactive Tutorial Hub** | `tutorial-engine.ts` powers an in-app, step-driven tutorial hub layered over the onboarding system (§30). |

---

## 52. Command Registry & Palette (v1.0.0+)

One registry (`frontend/src/core/commands.ts`) powers BOTH the Ctrl/⌘+K palette and the rebindable shortcuts manager in Settings.

| Component | Implementation |
| :--- | :--- |
| **Command model** | `{ id, category, title:{en,fr}, keywords, run(), defaultChord }` in a `Map` registry. Categories: nav / mods / profiles / repo / tools / settings / help. |
| **Dynamic nav commands** | `refreshNavCommands()` rebuilds `nav.*` commands from the LIVE navbar (`.nav-item[data-view]` + `[data-custom-id]`) on every palette open — custom sandboxed pages are first-class, rebindable targets. |
| **Bindings** | User overrides persist in `localStorage` (`bmm_cmd_bindings`) layered over defaults; a single global keydown dispatcher matches chords (modifier-less chords are suppressed while typing). Conflict detection warns on double-assignment. |
| **Palette rendering** | The overlay mounts inside `#app-window-outer` (the rounded, clipped app frame) as `position:absolute` — this is what keeps the backdrop/box-shadow from bleeding into the transparent OS-webview margin. Classic search is substring scoring; Semantic expands query tokens through the merged `_synonyms` map from the language files. |
| **Actions** | Commands run through the exact UI paths a human would use (`clickNav`, `clickAfterNav`, tab-switch helpers), so dialogs/confirmations still apply. The palette dispatches `bmm:action:palette-opened` for the tutorial engine. |

## 53. Repo Download Password (v1.0.0+)

An optional subscriber-facing gate for self-hosted repos, distinct from `admin_password` (which only guards the host's `/admin` panel).

| Layer | Implementation |
| :--- | :--- |
| **Generated server** | `DOWNLOAD_PASSWORD` is templated into `server.express.js`; when non-empty, every content request (repo.json + mod files) must carry `X-Repo-Password` (or `?pw=`) or receives 401. `/dashboard`, `/monitoring.json`, `/admin/*` and local access are exempt. Comparison is constant-time (`crypto.timingSafeEqual`, CWE-208) — as is the admin `Authorization` gate, in both the single-repo and hub-server templates. |
| **Rust client** | `fetch_repo_info(url, creator_id, password)` and `SyncArgs.password` send the header; a remote 401 surfaces as the typed error `repo.errPasswordRequired`. |
| **Frontend** | On that error the subscriber gets a themed prompt; the password is kept for the session (`setRepoPassword`) and passed to `sync_server_repo`. Host forms (mini-server + export) expose a "download password (optional)" field. |
| **API / automation** | `GET /api/repo/info?password=`, `POST /api/repo/sync {password}`, the Plugins Quick Test fields, and the `bmm://repo/sync` deeplink (`&password=`) all thread it through — the deeplink was also rewired to actually pre-fill and drive the sync form via `bmm:repo-focus`. |

## 54. Offline Mode & Telemetry Pipeline (v1.0.0+)

| Subsystem | Implementation |
| :--- | :--- |
| **Offline detection** | `core/offline.ts` probes two lightweight endpoints (5 s timeout) instead of trusting `navigator.onLine`; offline state shows a banner, dispatches `bmm-connectivity`, and gates features via `requireOnline()` / `safeFetch()`. Re-probe every 15 s offline / 120 s online. |
| **Telemetry consent** | Opt-in only (`settings.analytics_consent: Option<bool>`, `None` = never asked → nothing collected; declining wipes the buffer). Sub-toggles: benchmark/extra-hardware, session replay, replay unmask. |
| **Pipeline** | Events buffer to `analytics_queue.jsonl` (10 MB cap) and flush as ONE gzipped batch (packet id) every 90 s while visible; endpoint allow-list accepts `https://` (or loopback) only. |
| **Session replay** | rrweb with no mouse-move capture, masked-by-default sensitive selectors, animating subtrees blocked; chunks gzip via `CompressionStream`. Local `.bmmreplay` files + a rolling crash-session buffer, pruned by retention limits (30 / 2 GB defaults). |
| **GDPR** | Export raw buffer; per-packet deletion requests honoured within 72 h; sent-packet list shows event names/counts only. |

### §34 addendum — MCP dependency
The MCP server now builds against **rmcp 1.8** (stdio transport unchanged), clearing RUSTSEC-2026-0189; `ServerInfo`/`Implementation` are `#[non_exhaustive]` in 1.x and are built via mutate-from-`Default`.

---

*Better Mod Manager is developed by FreeProject089 — Engineered for uncompromising performance, file safety, and modern mod management.*

## 55. Icon library: loading and sharding (v1.0.0+)

The packs are JSON generated offline by `scripts/gen-icon-pack.mjs` from the npm packages
`lucide` (ISC) and `simple-icons` (CC0) — never runtime dependencies. The libraries' own
formats are kept: Lucide's `iconNode` arrays (`[tag, attrs][]`) and Simple Icons' single
24×24 path. The SVG is built **at render time**, so the JSON stays data rather than markup.

The brand pack is 4.6 MB. It ships **twice**: whole, for the picker (which needs every name
to search), and as **27 first-letter shards** for painting a stored ref. Rendering
`si:github` therefore loads `si/g.json`. Without that, a single brand tag pulled 4.6 MB on
the startup path — exactly the kind of cost that makes a manager feel slow.

Rendering (`renderPackIcon`) is **synchronous**: card generators cannot await. A ref whose
pack is not loaded yet renders an empty string and the next render finds the glyph — so the
warm-up is fired without being awaited, never in front of `get_mods`.

## 56. Docked panel space reservation (v1.0.0+)

Three panels can dock to the same edge. Each used to write `.app-shell`'s `padding-right`
as an inline style, so the second clobbered the first's reservation and closing either one
removed the padding the other still depended on.

`ui/dock-space.ts` is the single owner: each panel **claims** its width under its own name,
the widest wins (they stack at the same edge), and releasing a claim recomputes from
whatever is left. The module also sets `body.bmm-docked` and `--bmm-dock-w` — one state for
every layout rule to key on, instead of one class per panel.

## 57. Responsiveness: synchronous commands and the main thread (v1.0.0+)

In Tauri v2, a command declared `#[tauri::command]` **without** `(async)` runs on the
window's main thread. Any command that walks the disk therefore freezes the UI for the
duration of that walk. `get_mods` was one, and it rebuilds the file cache after every mod
activation — the cause of the freeze reported in the field.

The rule adopted: **any command touching `read_dir`, `WalkDir` or `metadata` over a
user-sized tree is `(async)`**, not only the ones a freeze has already been reported for.

The UI corollary: a `transform` animation only runs on the compositor once its layer is
promoted, and that promotion is committed by the main thread. A spinner inserted during
heavy work never gets its layer and sits frozen — which looks like a hang without being
one. `will-change: transform` asks for the layer up front.
