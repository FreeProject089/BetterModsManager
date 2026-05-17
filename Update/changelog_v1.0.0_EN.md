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

---
*Release 1.0.0 represents the final consolidation of the core feature set.*
