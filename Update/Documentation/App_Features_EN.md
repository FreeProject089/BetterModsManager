# User Guide & Feature Overview - Better Mod Manager (BMM)

Better Mod Manager is a modern, universal mod manager for any PC game. It delivers full file safety, clean organization, and powerful sharing tools through a premium workstation-style interface.

---

## 1. Profiles

Profiles are the foundation of BMM. Each profile represents a complete, isolated environment for a specific game.

| Feature | Description |
| :--- | :--- |
| **Multi-Game Support** | Create one profile per game (DCS World, MSFS, Skyrim, etc.). Mods never cross boundaries between profiles. |
| **Three Dedicated Folders** | Each profile defines a **Game Root** (where files are installed), a **Mods Folder** (where your mod collection lives), and a **Backup Folder** (where original files are saved before being overwritten). |
| **Visual Customization** | Each profile gets a unique name, accent color, and icon for instant visual identification. |
| **OvGME Import** | BMM reads binary OvGME `.dat` configuration files (`C:\ProgramData\OvGME`) and converts them into native BMM profiles in one click. |
| **Active Profile Tracking** | BMM remembers your last active profile across sessions and restores it on the next launch. |

---

## 2. Mod Library

The library view is your collections center. All mods for the active profile appear here.

| Feature | Description |
| :--- | :--- |
| **Drag & Drop Import** | Drop a folder or `.zip` file directly into the window to register it instantly. |
| **Folder Scan** | Automatically discovers and registers all new folders and `.zip` files present in the profile's mods directory. |
| **Zip Extraction on Import** | When a `.zip` is added, BMM extracts its contents into the mods directory automatically. |
| **Enable / Disable Toggle** | A single switch activates or deactivates any mod. Activation installs files into the game. Deactivation restores the game to its exact original state. |
| **Bulk Enable / Disable** | Activate or deactivate all mods in the library in a single operation. |
| **Permanent Deletion** | Mods can be permanently deleted from disk (with a confirmation step). Only inactive mods can be deleted. |
| **Mod Metadata** | Each mod stores a name, version, author, description, and a list of arbitrary download links. |
| **Custom Tags** | Create reusable labels (e.g., "Audio", "Cockpit", "Multiplayer") and assign them to mods for filtering. |
| **Search & Filter** | Search mods by name, filter by active/inactive state, or filter by tag. |
| **Open Mod Root** | Open a mod's physical folder directly in Windows Explorer from the right-click context menu. |
| **Activity History** | Every enable/disable action is timestamped and logged per profile for audit tracking. |
| **Double-Click Toggle** | Quickly enable or disable a mod by double-clicking anywhere on its card. |

---

## 3. File Safety — The Smart Copy Engine

BMM never uses symlinks. All file operations are physical, guaranteed, and reversible.

| Operation | What Happens |
| :--- | :--- |
| **Activate a Mod** | BMM walks the mod's file tree and copies each file into the game ROOT. If a game file already exists at the target path, it is moved to the Backup folder first (preserving the exact sub-directory structure). |
| **Deactivate a Mod** | BMM deletes the installed files and moves any backed-up originals back to exactly where they came from. |
| **Conflict Resolution** | If two active mods write to the same file, BMM tracks file ownership and ensures the correct file is always restored when either mod is toggled off. |
| **Concurrent Operation Lock** | A global `MOD_OP_LOCK` prevents two operations from running simultaneously, eliminating the risk of filesystem corruption from double-clicks or rapid toggling. |

---

## 4. Conflict Detection

| Feature | Description |
| :--- | :--- |
| **Pre-Activation Warning** | Before enabling a mod, BMM compares its file tree against all currently active mods. If a collision is detected, a warning dialog appears identifying the conflicting mods. |
| **Priority by Order** | The order in which mods are activated determines which one takes priority. The last activated mod's files take precedence. |
| **Suppress Warning** | Users can choose to permanently suppress the conflict dialog for a specific combination. |
| **Fast Selective Checking** | To ensure maximum performance, BMM only verifies conflicts between active mods and the mod being toggled, avoiding unnecessary scans of the entire library. |
| **Modification Cache (mtime)** | (v0.9.9) BMM now tracks modification dates of mod folders. If no changes are detected, scans are skipped, speeding up startup by 80%. |

---

## 5. Mod Sharing — The .MM Format

The `.MM` format is BMM's proprietary JSON-based sharing standard.

| Feature | Description |
| :--- | :--- |
| **Export** | Exports the active profile's entire mod collection into a single `.mm` file containing mod names, versions, authors, descriptions, tags, download links, installation priorities, and the complete file tree of each mod. |
| **Import** | Load any `.mm` file to preview its content (mod list, file sizes, tags, links) before installing. |
| **Install from List** | One click triggers BMM to download, extract, and register every mod from the list automatically. |
| **Real-Time Progress** | A live download bar shows percentage, current mod name, and progress for each download in the queue. |
| **Local Mod Pooling** | Before initiating any network download, BMM checks if the same mod already exists on disk (in any profile). If found, it copies the files locally, saving bandwidth and installation time. |
| **Auto Profile Creation** | When importing a `.MM` list, BMM can optionally create a brand new profile from the list's metadata. |
| **File Conflict Detection** | Mods already present in the active profile are flagged as "Already Present" during import preview. |

---

## 6. Dynamic Internationalization

BMM features a robust, user-extensible translation engine.

| Feature | Description |
| :--- | :--- |
| **Language Auto-Discovery** | Drop any `.json` translation file into the `frontend/Lang` folder. BMM detects it instantly on startup. |
| **Unified Selector** | A streamlined, premium dropdown in Settings allows for instant language switching. |
| **FlagCDN Integration** | High-quality flags are rendered based on 2-letter ISO codes provided in the translation files. |
| **Offline Fallback** | If internet access is unavailable, flags are rendered as stylized text to maintain UI consistency. |
| **Translator Tools** | Integrated "Copy Template" and "Translation Guide" buttons in Settings for community contributors. |

---

## 7. Automated Versioning & Build System

BMM ensures that version information is always accurate and synchronized.

| Feature | Description |
| :--- | :--- |
| **Static Build Capture** | The exact date and time of compilation are captured by the backend during the build process. |
| **Dynamic UI Injection** | Version and build date are dynamically injected into the Credits subtitle, the hero section, the titlebar, and the footer. |
| **Configuration-Based Suffix** | The "-PTB" label and version badge adapt in real-time based on the app's internal configuration. |

---

## 8. Interactive Documentation & Diagrams

BMM introduces a state-of-the-art interactive documentation system.

| Feature | Description |
| :--- | :--- |
| **Mermaid.js Integration** | Technical processes (Mod Activation, Sync, Backups) are visualized using high-definition Mermaid diagrams. |
| **Dynamic Localization** | All labels and tooltips within the diagrams translate instantly when you switch languages. |
| **Tasky Mascots** | Our assistant, Tasky, guides you through complex flows directly within the diagrams. |
| **Interactive Pan & Zoom** | Navigate complex diagrams comfortably with mouse-based pan and zoom controls. |
| **Persistent Viewport** | The app remembers your zoom level and position when switching between different diagrams. |

---

## 9. Integrity Report

| Feature | Description |
| :--- | :--- |
| **File Verification** | After a game update, BMM can verify whether installed mod files are still intact in the game's ROOT directory. |
| **Status Detection** | Files are reported as OK, Missing, or Modified (size mismatch) for each active mod. |
| **Deep Integrity Engine** | (v0.9.9) SHA-256 cryptographic analysis of every mod file against the game root to guarantee 100% absolute fidelity. |

---

## 10. Archive Explorer

| Feature | Description |
| :--- | :--- |
| **Browse Without Extracting** | Open any `.zip` inside the app to browse its complete file tree. |
| **Search** | Filter the file tree by filename in real-time. |
| **Right-Click Actions** | Open a specific file or folder from the archive directly in Windows Explorer. Copy the path to clipboard. |

---

## 11. Update Notes

| Feature | Description |
| :--- | :--- |
| **Built-in Changelog** | A modal displays all `.md` files found in the `Update/` directory, rendered with full Markdown support. |
| **Archive Access** | Older changelogs from `Update/Old_Update/` are available in a sidebar for historical reference. |
| **File Browser Sidebar** | Navigate between release note files using left-panel navigation. |

---

## 12. Crash Reporting & Troubleshooting

BMM includes a high-reliability diagnostic system to ensure any issue can be identified and fixed quickly.

| Feature | Description |
| :--- | :--- |
| **Real-Time Logging** | Every action is written instantly to `current_session.log`. |
| **Automatic Crash Detection** | At startup, BMM checks for unclean exits and automatically packages diagnostic reports into `.zip` files. |
| **Manual Report Button** | Users can manually trigger a full system diagnostic report from the Settings menu. |

---

## 13. Auto-Update System

| Feature | Description |
| :--- | :--- |
| **Automatic Check on Startup** | BMM queries the GitHub Releases API (now pointing to `FreeProject089/BetterModsManager`) shortly after launch to check for newer versions. |
| **Manual Check Button** | Available in the sidebar and Settings for on-demand checks. |
| **Update Modal** | Displays version comparisons, markdown release notes, and direct installer download buttons. |
| **Reactivation (v0.9.8)** | Auto-updates are now re-enabled by default in `app.cfg`. |

---

## 14. PTB Mode (Public Test Build)

| Feature | Description |
| :--- | :--- |
| **Welcome Modal** | On first launch, a themed welcome modal displays the PTB release notes. |
| **Dynamic Markers** | Special badges and version suffixes appear based on this mode. |

---

## 15. Performance & Storage Management

BMM features a suite of high-end diagnostic and optimization tools to ensure maximum stability and responsiveness.

| Feature | Description |
| :--- | :--- |
| **Disk I/O Limiter** | Prevents system freezes by capping the transfer speed during mod activation/deactivation. Custom limits can be set per disk. |
| **Performance Dashboard** | A real-time monitoring overlay (PiP) tracking CPU, RAM, and Disk activity. Supports timeline scrubbing and historical data export (CSV). |
| **Storage Manager** | Detects SSD/HDD types, filesystems, and auto-identifies cloud or network drives. Fully localized "Critical" and "Warning" alerts for v0.9.9. |
| **Optimized Disk Refresh** | (v0.9.9) Disk lists are refreshed once per batch operation instead of per-mod, ensuring lightning-fast dependency resolution. |
| **IO Cache Integration** | (v0.9.9) The copy engine utilizes the global file cache to avoid redundant disk scans during mod deployment. |
| **Benchmark Tool** | Test your disk's real-world performance directly within BMM to find the optimal speed limit. |
| **Interactive Performance Guide** | Integrated diagrams explain exactly how the I/O limiter and chunked transfer engine work together. Includes the new **Conflict Cache (mtime)** and **Deep Integrity Engine** diagrams. |

---

## 16. Server Repository (Server Mode)

Server Mode is the premium synchronization system for large-scale mod sharing.

| Feature | Description |
| :--- | :--- |
| **Integrated HTTP Server** | BMM can act as a web server, hosting your profiles directly from your PC. |
| **repo.json Manifest** | Automated generation of a manifest containing all files, sizes, and SHA-256 hashes. |
| **Smart Synchronization** | Clients compare their local state with the server and only download missing or changed files. |
| **Security Verification** | Every downloaded file is verified against its cryptographic hash before installation. |
| **Tunneling Support** | Integrated support for local sharing (LAN) and public sharing via UPnP or manual port forwarding. |
| **Verified Server Browse** | The public server browser only displays repositories carrying a validated `hash` field in `repos.json`. Each listed server shows a green "Verified" badge. |

---

## 17. Server Administration Suite (v0.9.8)

Premium tools for server owners to manage their repository and users with a high-end glassmorphic interface.

| Feature | Description |
| :--- | :--- |
| **Live Monitoring** | Real-time view of connected clients, active downloads, and IP tracking. |
| **Whitelist Manager** | Control who can access your repository. Support for manual entry and status toggling. |
| **Ban System** | Block specific Creator IDs or IP addresses from interacting with your server. |
| **Search & Filter** | Integrated search bars in all admin modals (Monitoring, Whitelist, Bans) for managing large user bases. |
| **Direct Copy Buttons** | One-click copy for IPs and Creator IDs to facilitate management. |
| **Visual Feedback** | Progress bars for active transfers and localized status toasts. |

---

## 18. Technical Improvements (v0.9.8)

| Feature | Description |
| :--- | :--- |
| **Library Stability** | Fixed critical "How it works" and "Create a profile" button issues in the Mod Library empty state. |
| **RPC Safety Guards** | Backend commands now include safety checks (active profile detection) to prevent console errors and crashes. |
| **i18n Audit** | 100% translation coverage for English and French, including all new server administration messages. |
| **Credits Overhaul** | High-performance video background with automatic playback throttling when not visible. |

---

## 19. One-Click Installation (bmm://)

One-Click installation simplifies mod sharing by allowing users to install mods directly from web links.

| Feature | Description |
| :--- | :--- |
| **Protocol Handler** | BMM registers the `bmm://` protocol in Windows, allowing web browsers to launch the manager directly. |
| **URL Parsing** | The manager automatically extracts mod names, authors, versions, and multiple download links from the deep link. |
| **One-Click Profile Creation** | If a link references a game you haven't configured yet, the modal allows you to create a new profile instantly with built-in path validation. |
| **DDL Support** | Optimized for Direct Download Links (GitHub, Discord, Personal Servers), ensuring a smooth "Click and Play" experience. |

---

## 20. Discord Rich Presence

BMM integrates with Discord to show your friends what you are currently playing and managing.

| Feature | Description |
| :--- | :--- |
| **Live Status** | Displays the active game profile name and the number of enabled mods. |
| **Server State** | If you are running BMM in Server Mode, your Discord status indicates you are hosting a repository. |
| **Privacy Toggle** | Can be enabled or disabled instantly from the Settings menu. |
| **Reactive Updates** | Your status updates automatically every time you switch profiles or toggle a mod. |
| **Discord Join Button** | (v0.9.9) Integrated direct community access button in crash reports for instant support. |

---

## 21. Advanced Conflict Diagnostics

BMM version 0.9.8 introduces an interactive diagnostic tool to resolve complex mod file collisions.

| Feature | Description |
| :--- | :--- |
| **Interactive Graph** | View a visual map of all file collisions between your mods. |
| **Quick Resolution** | Click any graph node to go directly to that mod in the library for management. |
| **Visual Hierarchy** | Understand at a glance which mods overwrite others with a color-coded Mermaid layout. |

---

## 22. Interactive Documentation & Semantic Search (v0.9.9)

BMM v0.9.9 introduces a revolutionary documentation system that combines traditional guides with real-time interactive diagrams and AI-powered semantic search.

| Feature | Description |
| :--- | :--- |
| **Interactive Diagrams** | Powered by Mermaid.js, these diagrams visualize complex logic. v0.9.9 adds the **Deep Integrity Engine**, **Conflict Cache**, and **Premium Interaction** schemas. |
| **Semantic Search** | Switch between "Classic" (keyword) and "Semantic" (deep indexing) modes. Semantic search analyzes diagram labels and hidden metadata to find exact answers. |
| **Node Highlighting** | Clicking a search result from a diagram instantly opens the relevant schema and highlights the target node with a premium, pulsing blue halo. |
| **Visual Indicators** | FAQ entries with associated diagrams now feature a "Layers" icon, making it easy to identify interactive content at a glance. |
| **Dual-Tab Interface** | Distinguishes between "Basic" (video tutorials and quick FAQ) and "Advanced" (technical diagrams and deep-dive documentation). |
| **Smart Video Fallback** | Video tutorials detect your connection. They stream from YouTube if online (saving space) or play local MP4 files if offline. |
| **Tasky Mascot Integration** | Tasky explains each step of a diagram. Hovering or clicking nodes triggers contextual help bubbles with localized content. |

---

## 23. Javascript to TypeScript Migration (v0.9.9)

BMM v0.9.9 marks a significant milestone with the transition of the frontend codebase to **TypeScript (TS)**. This move ensures structural stability and type safety across the entire application logic, making for a much smoother and bug-free user experience.

---

## 24. High-Performance Multi-threaded Engine

BMM's backend is powered by a multi-threaded Rust core, ensuring that heavy file operations never freeze the user interface.

| Feature | Description |
| :--- | :--- |
| **UI Responsiveness** | The JavaScript frontend remains 100% interactive (60 FPS) even during massive copies or hashing. |
| **Tokio Async Runtime** | Powered by the world-class Tokio runtime for efficient background task management. |
| **Dedicated IO Workers** | Disk-intensive tasks (copy, delete, scan) are isolated in a background worker pool. |
| **Zero-Lag UI Bridge** | Uses an asynchronous IPC bridge to communicate state changes back to the interface safely. |

---

## 25. Premium Interaction & Usability (v0.9.9)

BMM v0.9.9 introduces a significant polish to micro-interactions and interface fluidity.

| Feature | Description |
| :--- | :--- |
| **Smooth Animations** | Animated entry and exit transitions (fade + slide) for the Mod Actions dropdown menu. |
| **Interaction Grace Period** | A 100ms grace period prevents accidental menu closure when moving the mouse between the toggle and the list. |
| **Catchable Menus** | Menus currently in their closing phase can be instantly "caught" on hover, restoring their open state without flicker. |
| **Standardized Icons** | Visual harmonization of chevrons and indicators for a consistent "Vanguard" premium look and feel. |

---

## 26. Legal & Compliance (v0.9.9)

BMM ensures legal transparency and provides clear guidelines for community safety.

| Feature | Description |
| :--- | :--- |
| **Mandatory EULA** | Users must accept the End User License Agreement during the installation process (NSIS and MSI). |
| **Integrated EULA Viewer** | Access the full legal document anytime from the Credits page. Features high-quality Markdown rendering. |
| **Localized Legal Agreement** | The EULA automatically adapts to your system language (EN/FR support) for better accessibility. |
| **Moderation Clauses** | Explicit legal definitions for server repository moderation and user conduct. |
| **Translation Guide** | Comprehensive documentation for community members to create and bundle their own localized EULA versions. |

---

## 27. Modpack System — The .BMP Format (v0.9.9)

BMM introduces a complete modpack lifecycle system for curating, sharing, and verifying collections of mods.

| Feature | Description |
| :--- | :--- |
| **Create & Manage Modpacks** | Bundle multiple mods from any profile into a single modpack with metadata (name, description, author, version). |
| **SHA-256 File Manifest** | Each mod in a modpack stores a complete file manifest with per-file SHA-256 hashes for integrity verification. |
| **Export (.bmp)** | Export modpacks as `.bmp` (Better ModPack) files — a JSON-based format designed for easy sharing. |
| **Import (.bmp)** | Import modpacks from `.bmp` files. A new UUID is generated on import to prevent collisions. |
| **Integrity Check** | Verify that all mods referenced in a modpack are present locally and that their files match the recorded SHA-256 hashes. |
| **Auto-Repair** | Missing or corrupted mods can be automatically re-downloaded from their original source (Direct Link or Server Repo). |
| **Local Recovery** | Before downloading, the repair engine searches the local disk for misplaced files matching the expected hash. |

---

## 28. BetaHub Bug Reporting Integration (v0.9.9)

BMM integrates with BetaHub for structured bug reporting and community feedback.

| Feature | Description |
| :--- | :--- |
| **Bug & Suggestion Tabs** | Submit bugs or feature suggestions through a dedicated modal interface. |
| **Proof-of-Work Spam Protection** | Uses SHA-256 cryptographic challenges to verify genuine submissions without captchas. |
| **Privacy-First Design** | Strictly separates public report details from private system logs and contact information. |
| **Crash-to-Report Flow** | From the crash report modal, users can directly open a pre-filled BetaHub bug report with the crash ZIP attached. |
| **Report History** | View and track your recent submissions with direct links to view them on BetaHub. |

---

## 29. System Access Control (v0.9.9)

BMM features a dual-layer security system to balance functionality and file safety.

| Feature | Description |
| :--- | :--- |
| **First-Launch Modal** | A premium glassmorphic modal prompts users to choose their security mode on first launch. |
| **Full Access Mode** | Allows BMM to manage all games, mods, and disks without restrictions. Recommended for multi-drive setups. |
| **Limited Access Mode** | Restricts the JS interface to only access folders explicitly defined in profiles. Heavy Rust operations remain unrestricted. |
| **Persistent Setting** | The chosen security mode is persisted in settings and applied on every launch. |

---

## 30. Tasky Onboarding Tutorial (v0.9.9)

BMM features a guided interactive tutorial powered by the Tasky mascot.

| Feature | Description |
| :--- | :--- |
| **Language Selection** | The tutorial begins with an interactive language picker with flag previews. |
| **Step-by-Step Guide** | Tasky walks new users through profiles, library, mod sharing, performance tools, and documentation. |
| **Typewriter Animation** | Each explanation is revealed with a premium typewriter text effect. |
| **Element Highlighting** | Target UI elements are highlighted with a blue glow overlay to guide the user's attention. |
| **Skip & Navigate** | Users can skip the tutorial at any time or navigate back to previous steps. |

---

## 31. Lightweight Standalone Server (v0.9.9)

Generate a minimal standalone server script that runs without the BMM interface.

| Feature | Description |
| :--- | :--- |
| **Script Generation** | Generates a `.bat` script to launch an ultra-lightweight mod server for dedicated/headless machines. |
| **Cloudflare Tunnel** | Built-in Cloudflare Tunnel support for public URL sharing (enabled by default). |
| **UPnP Port Forwarding** | Automatic port forwarding via UPnP for LAN-friendly setups. |
| **Configurable** | Set port, upload speed limit, password, and server version (v1/v2) directly from the UI. |

---

## 32. GitHub-Style Markdown Alerts (v0.9.9)

BMM's Markdown renderer supports GitHub-style alert blocks for rich documentation.

| Feature | Description |
| :--- | :--- |
| **5 Alert Types** | `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` — each with distinct colors and styling. |
| **Bilingual Syntax** | French equivalents (`[!REMARQUE]`, `[!ASTUCE]`, `[!AVERTISSEMENT]`, `[!ATTENTION]`) are also supported. |
| **Localized Titles** | Alert titles are automatically translated based on the active language. |

---

## 33. Frontend Interaction Logging (v0.9.9)

BMM captures detailed frontend interaction telemetry for diagnostics and crash investigation.

| Feature | Description |
| :--- | :--- |
| **Click Tracking** | All button clicks and link navigations are logged with labels for debugging. |
| **Keyboard Shortcuts** | Common shortcuts (Ctrl+N, Ctrl+S, etc.) and debug toggles (Ctrl+Alt+D) are tracked. |
| **Drag & Drop Logging** | File drops are recorded with filenames for import troubleshooting. |
| **Error Capture** | Unhandled JS errors and rejected promises are forwarded to the backend log buffer. |
| **Focus/Blur Tracking** | Window focus changes are logged to help identify timing-related issues. |

---

## 34. Launch Packs — Application Groups (v1.0.0)

Launch Packs allow you to group multiple applications and scripts into a single automated execution unit.

| Feature | Description |
| :--- | :--- |
| **Multi-App Execution** | Group `.exe`, `.bat`, `.cmd`, and `.ps1` files together. All items in a pack launch simultaneously with one click. |
| **Invisible Launcher** | Uses a specialized VBScript backend to launch applications silently. Command windows and console pop-ups are hidden from view. |
| **Auto-Icon Generation** | BMM automatically converts your source images (PNG, JPG) into high-quality Windows `.ico` files for your shortcuts. |
| **Windows Shortcuts** | Generate a native `.lnk` file on your desktop or in your start menu that points directly to your invisible launch pack. |
| **PowerShell Stealth** | PowerShell scripts are executed with the `-WindowStyle Hidden` flag for a non-intrusive background experience. |
| **Asset Management** | BMM handles the lifecycle of launcher scripts and icons, ensuring clean deletion when a pack is removed. |

---

## 35. MCP Server & Advanced CLI (v1.0.0)

BMM v1.0.0 introduces professional-grade automation through the Model Context Protocol and a new unified CLI.

| Feature | Description |
| :--- | :--- |
| **Model Context Protocol** | Connect BMM to AI agents like Claude or Gemini. Manage mods, profiles, and syncs through natural language conversation. |
| **Unified Binary** | The `bmm-mcp-server.exe` acts as both a JSON-RPC protocol server and a standalone command-line interface. |
| **Full Terminal Control** | Nearly every BMM operation is available via CLI: sync mods, list profiles, search the library, or run launch packs. |
| **Remote Diagnostics** | Access installation statistics and analyze crash reports directly from a remote terminal or script. |
| **Fancy CLI Output** | Features a high-fidelity ASCII banner, colored log levels, and structured table outputs for better readability. |
| **Automation Friendly** | Designed for power users who want to script their mod management or integrate it into larger home cockpit systems. |

---

## 36. Help & Other Center (v1.0.0)

The Documentation view has been expanded and rebranded as **"Help & Other"** to serve as a comprehensive resource hub for all skill levels.

### Tab Structure

| Tab | Content |
| :--- | :--- |
| **Basic** | Getting started guides, video tutorials, download link types, .MM format, dedicated hosting, mod mapper basics |
| **Advanced** | Deep-dive technical cards with diagram links: Integrity Engine, I/O Limiter, Conflicts, Performance Monitor, Launch Packs, MCP/CLI, Security System, Crash Reporting, App Updates, BetaHub, Tech Stack, **Docker deployment guide with ngrok tunnel** |
| **FAQ** | Frequently asked questions with embedded diagram shortcuts — includes Docker & Infrastructure section, VPS vs. home PC, ngrok tunnel, Docker update procedure, and profile disk usage |

### Dual-Mode Semantic Search

| Feature | Description |
| :--- | :--- |
| **Classic Mode** | Fast substring-based search across all visible cards, FAQ entries, and gallery buttons. |
| **Semantic Mode** | Full NLP-style search with FR/EN synonym expansion (~25 canonical synonym groups), word-boundary matching, and Levenshtein fuzzy matching (distance ≤ 2 for words ≥ 5 chars). |
| **Weighted Index** | Diagram titles score 1.0×, main node labels 0.8×, secondary nodes 0.6×, edge labels 0.4×. |
| **Score Badges** | In Semantic mode, each result displays a relevance % badge (green >85%, blue >65%, amber otherwise). |
| **Context Labels** | Each result card indicates its source tier: 📌 Title, ● Node, ○ Detail, or → Edge. |
| **Debounce** | 150ms input debounce to prevent excess computation during fast typing. |
| **No-Results State** | Informative empty state with a one-click shortcut to switch to Semantic mode. |
| **Result Cap** | Top 12 results after deduplication per `diagramId + nodeId`. |

### Interactive Diagrams

| Feature | Description |
| :--- | :--- |
| **35+ Diagrams** | Every major feature has a linked interactive Mermaid.js diagram with pan/zoom. |
| **Live Node Highlighting** | Search results that link to a specific node trigger a "pulsing glow" animation on that node. |
| **Language Sync** | All node labels and cluster names are fully translated via `{{i18n.key}}` substitution. |
| **Gallery** | A scrollable gallery groups all diagrams by category for direct access. |

---

## 37. UI Polish & Contextual Help (v1.0.0)

BMM v1.0.0 features significant visual refinements and a smarter assistance system.

| Feature | Description |
| :--- | :--- |
| **Contextual Tooltips** | Hovering over nearly any UI element provides a "Tasky Help" bubble with clear explanations. |
| **Refined Window Controls** | New high-fidelity resize strips and corner handles for more precise window management. |
| **Glassmorphism 2.0** | Enhanced translucent effects and 1px border highlights across all modals and cards. |
| **Profile Mod Counter** | Profile cards now display a real-time count of registered mods, also reflected in the Mapper view. |
| **Tasky Mascot** | Improved animations and positioning for Tasky during onboarding and help interactions. |

---

## 38. Visual Mapper & Directory Analytics (v1.0.0)

The Visual Mapper provides a deep structural analysis of your mod collection, ensuring that your installation tree is exactly as you intend.

| Feature | Description |
| :--- | :--- |
| **Interactive Tree View** | Explore the physical file structure of every mod in your library through a high-performance interactive tree. |
| **Real-Time Mod Analytics** | The Mapper view displays live statistics, including total mod count per profile and individual file counts per mod. |
| **Infinite Recursion Depth** | (v1.0.0) The directory walker now supports infinite nesting depth with cycle detection, perfect for complex scenery or high-fidelity aircraft mods. |
| **Dynamic Node Interaction** | Expand or collapse entire directory branches. Identify "Root" vs "Sub" folders instantly through visual color-coding. |
| **Direct File Access** | Right-click any file or folder in the tree to open its physical location in Windows Explorer or copy its relative installation path. |
| **Backend-Powered Scanning** | Utilizes a multi-threaded Rust engine for scanning, ensuring the UI remains responsive even when analyzing libraries with tens of thousands of files. |

---

## 39. Profile Disk Usage (v1.0.0)

Each profile card in the Profiles view displays the total disk space consumed by its mod folder.

| Feature | Description |
| :--- | :--- |
| **Asynchronous Loading** | Disk size is calculated in the background after the profile grid renders, with a spinner shown during calculation. |
| **Formatted Display** | Size is displayed in human-readable units (B, KB, MB, GB, TB) next to a database icon on the profile card. |
| **Rust-Powered** | Backed by a recursive `get_folder_size` Tauri command that walks the directory tree without blocking the UI. |
| **Per-Profile** | Each profile's mods folder is measured independently. Profiles with inaccessible paths silently show nothing. |

---

## 40. .MM Export Cancellation (v1.0.0)

The .MM export operation can now be cancelled mid-progress without corrupting the output or leaving the UI stuck.

| Feature | Description |
| :--- | :--- |
| **In-Progress Cancel** | An "Annuler" button inside the export progress overlay calls the `cancel_export_modlist` Tauri command. |
| **AtomicBool Flag** | A dedicated `export_cancelled` flag in `AppState` is checked by the Rust export loop on each file iteration. |
| **Clean State Reset** | After cancellation, the overlay closes, buttons re-enable, and a "Export cancelled" toast is displayed. |
| **Partial File Safety** | The cancelled export file is discarded; no incomplete `.mm` file is left behind. |

---

## 41. Expanded Profile Icon Library (v1.0.0)

The profile icon picker now offers over 110 icons across 15 thematic categories.

| Category | Examples |
| :--- | :--- |
| **Tech** | monitor, server, code, keyboard, mouse, printer, bluetooth, satellite, router, cloud |
| **Transport** | bus, truck, ship, bicycle, train, helicopter |
| **Media** | film, tv, speaker, mic, clapperboard, disc |
| **Sport** | trophy, medal, dumbbell, bike, swords |
| **Nature** | tree, leaf, flower, bird, fish, bug |
| **Places** | home, building, flag, castle, tent |
| **Symbols** | infinity, diamond, hexagon, fingerprint, sparkles, atom, crown, layers |
| **Tools** | pen, ruler, compass, scissors, book, bookmark, lock, search, filter |

---

## 42. Updates History (v1.0.0)

The Updates History system provides a detailed audit log of all changes made to your mod collection's metadata.

| Feature | Description |
| :--- | :--- |
| **Metadata Tracking** | Automatically logs changes to mod names, versions, authors, descriptions, tags, and download links. |
| **Field-Level Detail** | Each entry identifies exactly which fields were modified (e.g., "Modified: Author, Tags"). |
| **Historical Audit** | View the exact date and time of every metadata update. |
| **Action Filtering** | Filter the history list to show only specific types of modifications. |
| **Retention Control** | Choose how long to keep history (e.g., 30 days, 6 months) to manage disk usage. |
| **Manual Cleanup** | Clear the entire history log with a single click from the management modal. |
| **Premium View** | Features a glassmorphic list design with high-fidelity badges and indicators. |

---

## 43. App Catalog (v1.0.0)

The App Catalog is a one-click installer for companion apps and tools, driven by a hostable `catalog.json`.

| Feature | Description |
| :--- | :--- |
| **Browse & Filter** | Grid of app cards with thumbnail, badges, search, and category/price filters (Game/Utility/Other · Free/Freemium/Paid). |
| **One-Click Install** | Supports `zip`, `exe`, `msi`, and `script`. Portable zips are extracted and the main executable is auto-picked; installers run their own wizard. |
| **Zero-Action Detection** | For any installer, BMM snapshots install folders + the Windows registry before running it, then diffs afterward to find the launch executable and uninstaller — no manual file picking. |
| **Choose Install Path** | Portable apps can be installed to a custom folder, defaulting to BMM's managed `Apps` directory. |
| **Usage Tracking** | Time spent in each launched app is recorded automatically when the app closes. |
| **Smart Uninstall** | Managed apps offer keep-files / delete-everything; setup-installed apps can run their real Windows uninstaller (resolved from the registry). |
| **History & Favorites** | Per-app activity log (install/launch/uninstall) with icons, plus a favorites tab. |
| **Detail Modal** | Image gallery (thumbnail + screenshots), full Markdown README renderer, requirements, usage stats, and source label. |
| **Catalog Creator** | Build a `catalog.json` in-app — add apps via a form, preview the JSON, then copy or download it to host your own catalog. |
| **Trust Model** | `Official` / `Partner` badges are granted by catalog source (the official catalog and its `partner_catalogs`), never by what a JSON claims. |
| **Community Sources** | Add any community catalog URL; the official catalog can auto-import partner and community catalogs. |

---

## 44. Centralized Link Registry (v1.0.0)

All external URLs used by the app are consolidated into a single editable file, `assets/links.json`, so links can be changed without recompiling.

| Feature | Description |
| :--- | :--- |
| **Single Source** | Plugin catalog, server-browse list, contributors, auto-update API, app catalog, and all social links (Discord, Reddit, Ko-fi, GitHub, ED forum) live in one JSON file. |
| **3-Tier Loading** | Loaded at startup from a remote URL, falling back to the bundled local file, then built-in defaults. A log line states which source was used. |
| **Runtime HTML Patching** | Static links in the Credits page, BetaHub modal, and repo-browser quick-links update from the JSON via `data-link-key` attributes. |
| **Update-Friendly** | `links.json` is tracked by the incremental update manifest, so URLs can change through a release without a full rebuild. |

---

## 45. Plugin System (v1.0.0)

Plugins extend BMM with curated mod sets, automation scripts, and bundled content, described by a manifest.

| Feature | Description |
| :--- | :--- |
| **Manifest Format** | Each plugin declares id, name, version, author, description, target game, permissions, tags, website, bundled folders, and an optional modlist. |
| **Apply Modes** | A plugin can apply a declarative **modlist**, run bundled **scripts**, or **both**. |
| **Modlist Enforcement** | Required mods can be marked strict and pinned to a SHA-256. BMM compares your library against the requirements and reports what's missing before applying. |
| **Install Sources** | Install from the remote plugin catalog, from a local `.bmmplug` file, or author your own plugin in-app and export it. |
| **Permission Gating** | Plugins request permissions; running bundled external scripts requires an explicit "unsafe plugins" opt-in. |
| **Lifecycle** | Enable/disable, uninstall, open plugin folder, and checksum validation are all built in. |
| **Script Generation** | Generate ready-to-run cURL / PowerShell snippets that drive BMM through the local API. |

---

## 46. Local REST API (v1.0.0)

BMM runs a local HTTP server on `127.0.0.1:51274`, letting external tools and plugins control it programmatically.

| Feature | Description |
| :--- | :--- |
| **~40 Endpoints** | Mods, profiles, plugins, modpacks, repository, and data import/export are all controllable over `/api/`. |
| **Token Auth** | A per-install API token protects the endpoints; it can be viewed or regenerated from the Plugins view. |
| **Automation Ready** | Powers companion tools and macro setups (e.g. Stream Deck), and the in-app API explorer. |
| **Script Helpers** | One click generates authenticated request snippets for any action. |

---

## 47. ContentID — Mod Identity (v1.0.0)

Every mod gets a deterministic content fingerprint so BMM recognizes the same mod across machines, regardless of its folder name.

| Feature | Description |
| :--- | :--- |
| **Deterministic ID** | The same files always produce the same `content_id`, derived from the mod's actual file hashes. |
| **Cross-Machine Matching** | Modpacks, `.MM` lists, and repository sync match mods by content, not by name — eliminating false mismatches. |
| **"Already Present" Detection** | The import flow uses ContentID to detect mods you already have, avoiding duplicates. |
| **Integrity-Linked** | The ID stays in sync with the SHA-256 fingerprints from the integrity engine. |

---

## 48. Theme System (v1.0.0)

A complete theming engine that restyles 100% of BMM with **no CSS knowledge required**, while still exposing raw CSS for power users. Opened from **Settings → Theme**.

| Feature | Description |
| :--- | :--- |
| **7 Built-in Presets** | Ready-made themes (Sombre, Void, Full White, Discord, Orange, Spotify…), including light themes. |
| **Auto-Palette** | Pick a single colour and generate a full, coherent dark or light theme from it. |
| **Element Picker** | Right-click any element in the app to edit its text/background/border colours, hover & active states, custom CSS, icon (SVG swap) or image. |
| **Design Tokens** | Themes are JSON of `--bmm-*` CSS variables injected as `<style>` blocks — source files are never modified, everything is reversible. |
| **Inline Patcher** | A MutationObserver rewrites hardcoded inline colours on dynamic content so it follows the theme too. |
| **Auto-Contrast** | On light themes, unreadable light text/surfaces are darkened automatically (toggleable). |
| **Change Tracker** | A "Your changes" panel lists every edit with per-item revert; Discard / Revert-all restore instantly (including dynamic mod/profile cards, no refresh). |
| **Share & Install** | Export a `.bmmtheme` (ZIP with assets/fonts), copy a one-click `bmm://theme/import-inline` link, or install from the theme catalog. |

---

## 49. Translation Sandbox (v1.0.0)

A built-in tool (Settings → Translation Sandbox) that lets anyone create or fix a language without touching code — extends the Dynamic Internationalization system (§6).

| Feature | Description |
| :--- | :--- |
| **Safe Sandbox** | Edit translation keys in isolation; nothing changes in BMM until you export or apply. |
| **Pointer Mode** | Click any element in the running app to jump straight to its i18n key (or flag hardcoded text). |
| **Hardcoded Scanner** | Scans the source for strings without an i18n key, so translators/contributors can spot gaps. |
| **Overlay Mode** | Detach the sandbox into a draggable, resizable overlay so you can edit while using the app. |
| **Export** | Save your language as a `.json` file (full file, order preserved). |
| **One-Click Share** | A **Share** button produces a `bmm://language/import-inline` link (gzip-compressed); for full translations that exceed the link size limit it falls back to exporting the `.json` to share as a file. |

## 50. Customizable Navbar & Sandboxed Pages (v1.0.0+)

- **Reorder / customize the navbar** — arrange the top navigation to taste.
- **Sandboxed `bmmpage://` pages** — custom navbar entries can open isolated pages
  through a permissioned broker, so third-party page content can't touch the core app.

## 51. Plugin Scheduler & Web Catalog (v1.0.0+)

- **Scheduler** — have plugin/script-generation actions run automatically at chosen
  times (fired via deeplinks).
- **BetterCommunity Web catalog** — browse & install community apps, plugins and
  themes straight from BMM (BCWEB `catalog.json` feed), and open web **install /
  add-source** deeplinks that hand off to the app.

## 52. Theme Store & Sharing (v1.0.0+)

- A growing library of built-in themes (Sombre, White, Discord, Spotify, Brutal,
  Claude, Nord, Sakura…) plus a **first-class light mode**, and shareable
  `.bmmtheme.json` files exported/imported from the theme editor.

## 53. Interactive Tutorial Hub (v1.0.0+)

- A guided, step-driven **Tutorial Hub** that walks new users through the app's major
  workflows on top of the first-run onboarding.

---

*Better Mod Manager is developed by FreeProject089.*

