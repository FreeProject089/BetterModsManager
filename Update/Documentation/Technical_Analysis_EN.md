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

Weighted intersection matching (Perfect, Anchored, Keyword Ratio) with Match % badges.

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
| **Tool Surface** | Over 25 atomic tools exposed via the `mcp-server` binary, covering the entire BMM command surface. |
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
| **Resize Strip Logic** | A custom resize engine in `main.ts` listens for `mousedown` on edge strips and uses `tauri::window::start_dragging` or manual bounds calculation for precision. |
| **Glassmorphism Tokens** | Standardized CSS variables (`--bg-glass`, `--border-glass`) used across all 1.0 components for visual consistency. |

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

*Better Mod Manager is developed by FreeProject089 — Engineered for uncompromising performance, file safety, and modern mod management.*

