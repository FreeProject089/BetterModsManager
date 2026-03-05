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

## 2. Backend — State Management

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

## 3. Backend — Data Models

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

## 4. Backend — The Smart Copy Filesystem Engine

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
| 8 | History Log | A timestamped `"Enabled"` event is written to the activity log |

### Deactivation Flow (`disable_mod` command)

| Step | Function | Action |
| :--- | :--- | :--- |
| 1 | `MOD_OP_LOCK.lock()` | Acquires the global Mutex |
| 2 | File Resolution | Merges `installed_files` (tracked) with `list_mod_files()` (scanned) into a deduplicated set using `HashSet` |
| 3 | `unapply_mod_stacked()` | For each file, deletes the installed copy from the game ROOT |
| 4 | Restoration | Moves the backed-up original file from `backup_path` back to its exact original location |
| 5 | State Update | `mod.enabled = false`, cleared from `profile.active_mods`, `state.save()` called |
| 6 | History Log | A timestamped `"Disabled"` event is written |

### Why Physical Copy Instead of Symlinks

| Method | Stability | Anti-Cheat Compatible | Network Drive Support |
| :--- | :--- | :--- | :--- |
| Symlinks | Low (Windows permissions fragile) | No (many AC systems block symlinks) | No |
| BMM Physical Copy | High | Yes | Yes |

---

## 5. Backend — Concurrent Safety

| Mechanism | Purpose |
| :--- | :--- |
| `MOD_OP_LOCK: Mutex<()>` (global static, `lazy_static`) | Prevents two mod activation/deactivation operations from running simultaneously |
| `Arc<Mutex<AppData>>` | Guarantees that all reads/writes to app state are sequentially consistent |
| `tauri::async_runtime::spawn_blocking()` | Offloads all heavy I/O operations to a dedicated thread pool, keeping the UI thread unblocked |

---

## 6. Backend — Mass Installation Engine (`.MM` Format)

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
| `download_links` | `Vec<DownloadLink>` | HTTP URLs + link type (nexus, github, direct) + label |
| `sort_priority` | `u32` | Lower value = higher priority in install order |
| `file_tree` | `Vec<ModFileEntry>` | Complete list of relative file paths (built at export time) |
| `tags` | `Vec<String>` | Tag labels carried over from the source profile |

---

## 7. Backend — OvGME Migration (`ovgme.rs`)

BMM can directly parse OvGME's proprietary binary `.dat` configuration files.

| Step | Implementation Detail |
| :--- | :--- |
| **Discovery** | Scans `C:\ProgramData\OvGME\` (with `APPDATA` fallback) for subdirectories containing a `game.dat` file |
| **Binary Parsing** | The `parse_utf16_string()` function reads UTF-16 LE encoded string data from fixed byte offsets within the binary format |
| **Profile Mapping** | Extracted paths (game root, mods folder) are mapped to native BMM `Profile` structs and registered into the state |

---

## 8. Frontend — Architecture

### Module System

| Module | File | Role |
| :--- | :--- | :--- |
| `app.js` | Entry | Boot sequence, Tauri bridge, navigation, modals, update notes, shortcuts |
| `profiles.js` | Profile UI | Profile grid rendering, create/edit/delete profile forms, active profile logic |
| `mods.js` | Mod UI | Mod card rendering, activation toggle, download progress listener, bulk actions |
| `i18n.js` | Internationalization | JSON dictionary loading, `t()` function, `data-i18n` DOM attribute scanner |
| `onboarding.js` | Tutorial | Sequential step engine, navigation-link targeting, Tasky mascot animations |

### i18n Engine

| Mechanism | Detail |
| :--- | :--- |
| **Loading** | Fetches `Lang/fr.json` or `Lang/en.json` based on `localStorage('bmm-lang')` |
| **Static translation** | DOM elements with `data-i18n="key"` are automatically replaced on load and language switch |
| **Dynamic translation** | `t('key', { param: value })` performs runtime string interpolation for parameterized messages |
| **Language switch** | Calls `applyTranslations(document.body)` without any page reload |

---

## 9. Frontend — Security

| Threat | Mitigation | Implementation |
| :--- | :--- | :--- |
| XSS via mod metadata | HTML entity escaping | `escHtml()` converts `<`, `>`, `"`, `&` to safe entities before any DOM `innerHTML` injection |
| Attribute injection | Attribute escaping | `escAttr()` sanitizes strings inserted into HTML attribute values |
| Path traversal | Tauri scope enforcement | Rust backend validates all file paths against registered profile bounds before I/O |

---

## 10. Technical Specification Summary

| Parameter | Implementation |
| :--- | :--- |
| **Language (Backend)** | Rust 1.70+ (Tauri v1) |
| **Language (Frontend)** | ES2022 JavaScript — Zero framework |
| **Networking** | reqwest 0.11 (blocking, async via spawn_blocking) |
| **Archiving** | zip-rs 0.6 |
| **State Serialization** | serde / serde_json |
| **File Operations** | std::fs + fs_extra 1.x |
| **Concurrency Model** | Arc + Mutex + tauri::async_runtime |
| **Idle RAM** | approx. 60 MB |
| **Active RAM (I/O)** | Less than 120 MB |
| **UI Framerate** | 60 FPS (decoupled from Rust workers) |
| **Cold Boot Time** | Less than 1.5 seconds |

---

*Created by FreeProject089 — Engineered for uncompromising performance, file safety, and modern mod management.*
