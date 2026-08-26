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
| **Download Password (optional)** | A host can require a subscriber-facing download password: set at server generation, requested once from subscribers (sent as `X-Repo-Password`, remembered for later syncs). Blank = open repo. Distinct from the admin password, which only guards the host's admin panel. |

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
| **~75 Endpoints** | Mods, profiles, plugins, modpacks, repository, and data import/export are all controllable over `/api/`. |
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
| **12 Built-in Presets** | Ready-made themes (BMM Default, Sombre, Void, Full White, Discord, Orange, Spotify Green, Brutalist, Glass, Clay, Nord, Sakura), including light themes. |
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

## 54. Command Palette & Rebindable Shortcuts (v1.0.0+)

One search box over the whole app: press **Ctrl/⌘+K** anywhere.

| Feature | Description |
| :--- | :--- |
| **Go anywhere** | Jump to any screen — including your own custom navbar pages, detected live. |
| **Run actions** | Add a mod, scan, verify integrity, import profiles (OvGME/OMM), drive the whole Server Repo surface (sync/host, generate server, start/stop, monitoring, copy creator ID), check app updates, open storage/hashing stats. |
| **Two search modes** | Classic (literal) and **Semantic** — synonym-expanded, so "update" also finds "upgrade / new version". |
| **Rebind everything** | Settings → Keyboard shortcuts lists every command: record a new combo, reset to default, or clear it; conflicts are flagged. Custom pages get shortcuts too. |

## 55. Privacy, Telemetry & Offline Mode (v1.0.0+)

| Feature | Description |
| :--- | :--- |
| **Strictly opt-in telemetry** | Nothing is collected until the consent dialog is explicitly accepted; declining wipes any buffer. |
| **What's sent** | Pages, clicks (labels only — never typed values), perf samples, errors, an anonymous hardware profile. No paths, no mod contents, no identity. |
| **Masked session replay** | Optional rrweb replay with mod/profile names and paths rendered as ••••; unmasking is a separate explicit toggle. |
| **Local-first pipeline** | Events buffer to a local 10 MB-capped file; upload is gzip-batched over HTTPS only. No endpoint configured = data never leaves the machine. |
| **GDPR controls** | Export the raw buffer; view every sent packet (event names/counts only) and request per-packet deletion, honoured within 72 h. |
| **Offline mode** | Real connectivity probes (not just the OS flag); a discreet banner, paused network features with clear toasts, everything local keeps working, auto-recovery (15 s re-probe). |

## 56. Documentation & Tutorial Suite (v1.0.0+)

| Feature | Description |
| :--- | :--- |
| **Help & Other hub** | Data-driven bilingual articles (user + developer parts), classic & semantic search, 41 interactive Mermaid diagrams with per-node explanations. |
| **BMM Docs site** | The website mirrors the in-app content (minus interactive elements) with Mermaid diagrams and a full API reference — PDF-ready. |
| **Interactive tutorials** | Guided coach-card tutorials driving the real UI, with a self-cleaning practice sandbox (example profile, mods with a deliberate conflict, example modpack). Now also covers the command palette & shortcuts. |
| **Translate BMM** | The Translation Sandbox: create a language, translate key-by-key with live previews and a progress bar, export/import — no rebuild. |

---

*Better Mod Manager is developed by FreeProject089.*

## 57. Shared icon library (v1.0.0+)

2017 **Lucide** glyphs and 3453 **Simple Icons** brands, plus your own images, behind one
picker (search, tabs, upload). Wired into **tags**, the **profile visual icon** and
**plugin creation**.

An icon is a string (`lucide:x`, `si:x`, `data:image/…`) — it is data, so it follows every
existing share path (exported profile, repo, catalog) with no special handling. The packs
load on demand and are **sharded per letter**, so painting a stored icon costs ~150 KB
rather than 4.6 MB.

## 58. Tags: icons, gradients, editing (v1.0.0+)

A tag carries a name, a colour, and now an **icon** and an optional **second colour**
(gradient). Tags are editable in place; the old form could only create. The five places
that draw a tag go through one renderer, so the same tag looks the same everywhere.

## 59. Dockable side panels (v1.0.0+)

The interactive tutorial, the theme editor and the translation sandbox dock to the window
edge as a full-height column, with a draggable, remembered width. The app reflows around
them instead of being covered. Each panel adapts its **shape** to the mode: stacked
columns, two-row toolbar.

## 60. Scheduler: full control flow (v1.0.0+)

On top of If/Else, Wait and Repeat: **For each** (over a live collection, substituting
`{item.*}`), **Switch** (ordered cases + default) and **do… while**. Enough to write "for
each enabled mod, verify integrity then notify" without one step per mod.

## 61. Agent and script authoring (v1.0.0+)

The MCP server and the CLI no longer only read — they **create**: whole automations
(control-flow blocks included) and plugin drafts. A created task lands disabled, to be
inspected before it is armed; a plugin lands as a draft, to be installed through the app's
normal permission-gated flow.

## 62. Scripts in a scheduled task (v1.0.0+)

A workflow step can now **run a script you write** — PowerShell, CMD, Bash or Python —
instead of only launching a program with arguments. BMM saves the body to a temporary file
and hands the interpreter that file, so nothing you type is ever placed on a command line:
there is no quoting to get right, and a stray quote cannot change what runs. Inside a
**FOR EACH**, `{item.name}` and `{item.id}` are substituted before the script starts.

Under *Advanced* you can name a variable. The script's first output line becomes that
variable's value, and later steps can branch on it — without it, a script could only report
success or failure, which made "if the script says yes, then…" impossible to express.

## 63. Task permissions, one grant per capability (v1.0.0+)

A task used to carry a single switch called "allow custom commands". It told you a
permission was being granted but not what it covered, and it did not cover deeplinks at
all — even though a `bmm://` link reaches anything the app exposes.

There are now four separate grants, each naming what it unlocks: **run external programs**,
**run scripts**, **fire deeplinks** and **stop a running program**. Each is off until you turn
it on, and a step whose permission is missing fails with a message naming the one to grant,
rather than running quietly.

Stopping a program is separate from launching one because the risk differs in kind: starting
something is undoable, killing something can lose unsaved work with nothing to undo.

Tasks you built before the split keep everything they already had — except *run scripts* and
*stop a program*, which no existing task receives, because neither capability existed when you
agreed to the old checkbox.

**A task that arrives in a file gets none of them.** Importing a `.bmmpa`, or adding a shared
`.bmmscript` to your tasks, strips every one of the four and leaves the task **disabled** —
then tells you what the file had asked for, so you can grant what you actually want. The
automation is intact and one toggle away from working; what it cannot do is arrive already
holding permission to run programs on a timer.

## 64. Notification centre (v1.0.0+)

A bell sits beside **Check for Updates**. It keeps every message BMM has shown you, with the
source it came from, when it arrived and its full text — a toast is a three-second window
onto something that already happened, and until now missing it meant losing it. Entries can
be marked read, removed one at a time or cleared, and repeated messages from a batch
operation collapse into one line.

## 65. Better bug reports (v1.0.0+)

The diagnostics export now carries the **web view's environment** alongside the app's: your
system's accessibility and colour preferences, the window size and pixel ratio, and any
uncaught errors from the session. These silently change how the app behaves while being
invisible in a screenshot — a spinner that refused to turn was traced to a Windows
accessibility switch that nothing had ever reported.

## 66. Choosing how BMM starts, in the installer (v1.0.0+)

The installer's Configuration page is not decoration: what you pick there is applied at
first launch, so BMM opens already set up rather than asking you the same questions again.

- **Theme.** The picker shows a tile per built-in theme with its real colours (background,
  surface, accent, text), and offers itself once more on the final page — a theme is a
  decision about a picture, and that is the first moment you have nothing else to think
  about. Your choice is now genuinely applied on first launch.
- **Language.** `auto` follows your operating system; picking a language explicitly also
  skips BMM's first-run language prompt.
- **Anonymous telemetry** and **Discord Rich Presence** arrive **already ticked**. Both are
  plainly visible on that page and you can untick either before installing, and change your
  mind at any time in Settings. What telemetry sends is described in **PRIVACY.md**, which
  states this pre-ticked default explicitly rather than leaving you to discover it.
- **The Terms and Privacy Policy** shown during installation are displayed in your language
  when a translated copy is bundled, and their tables — including the "what leaves your PC"
  summary — are now readable rather than raw markdown.

Every one of these is optional, and BMM's own defaults apply unchanged to an installation
that never ran the installer.


---

## 67. Write your own interactive tutorial (v1.0.0+)

The tutorial hub has **Create…**, **Import…** and **Catalogues…** at the bottom of its list.

A tutorial you write is made of **parts** and **steps**, and a step can do everything an
official step does: open a view, highlight an element, wait for you to actually perform an
action before Next unlocks, or simply explain something. The **Test** button beside the
selector field flashes whatever it matches right now — useful for catching a typo, and it
tells you plainly that it cannot prove the tutorial on somebody else's screen.

**Share it.** *Share (.bmmtut)* writes a single file, signed with your creator key. Whoever
imports it is told whether the signature is valid, absent, or **invalid** — a file edited
after signing is labelled rather than quietly accepted as your work.

**Follow a catalogue.** *Catalogues…* takes the address of a tutorial catalogue and lists
what it offers; installing is one click. A protected catalogue asks for its download password
or your identity key in the same fold every other catalogue screen uses.

Custom tutorials run on the same engine as the built-in ones, so they behave identically. What
they cannot do is run code: a tutorial displays text and highlights parts of the interface,
and shared text is stripped to formatting tags.

---

## 68. Close a server you generated (v1.0.0+)

Every server BMM generates — the Multi-Repo Hub, the Express standalone, and the lightweight
`.bat` / `.sh` pair in both versions — now reads an **`access.json`** sitting next to it:

```json
{
  "password": "",
  "pubkeys": ["ssh-ed25519 AAAAC3Nza… you@machine"],
  "audience": "http://repo.example.com:3000"
}
```

- Leave it empty and the server is open, exactly as before.
- A **password** is asked of every content request.
- **Authorised keys** require a signed proof — and the first key you list makes it required
  for *everyone*, so add your own before anybody else's.
- **`audience`** is the address your subscribers type, exactly as they type it. BMM signs the
  address it dialled, so this is what stops a proof captured elsewhere being replayed here —
  and it is the one value that will refuse everybody if it is wrong.

The file is read **when a request arrives**, so adding a subscriber's key takes effect
immediately: no regenerating, no re-uploading. In the Multi-Repo Hub each repo folder has its
own file, so one hub can hold an open repo beside a locked one.

A **static** hub export has no server process and cannot enforce any of this; it ships a
README saying so.

---

## 69. Reach a repo that only exists over SSH (v1.0.0+)

**Update from the server** now reads over SFTP as well as HTTP. That matters because an HTTP
server has to publish a directory index for BMM to read it, and a machine you reach by SSH
usually publishes none — which is exactly the case where the mods exist nowhere else.

Open **This repo is on an SSH machine** and pick one of the servers you already configured
under *Publish over SSH*. Host, port, account and folder come from there; you supply the two
things BMM never stores — the **account password** and the **key passphrase**. The same block
sits in *Update the Server Repo*, where it also makes a password-authenticated server usable
for the first time.

**Publish over SSH** can now take its private key from your **identity keys**: the chooser
under the path field lists them by name. Picking one fills the path — configuring a server
never changes which identity BMM presents to catalogues.

And when *Test the connection* refuses a write, it tells you why: the remote folder's owner
and mode, the account BMM connected as, and the command that fixes it. `/srv`, `/var/www` and
`/opt` are owned by root on most systems — everyone may list them, only root may create a
file in one — and nothing about your account or your key is wrong.

---

## 70. Several identity keys, not one (v1.0.0+)

**Settings → Identity & API → Identity keys** holds as many keys as you like, each under a
name you choose. One is the default, presented to anything that asks; any individual server
can be pointed at a different one. A work identity and a personal one coexist without
swapping files between runs.

**ed25519, RSA and ECDSA** are all accepted, in OpenSSH format or as a PuTTY `.ppk`. Only the
**path** is stored — the file is read at the moment a proof is signed, and what travels is a
short-lived signed statement, never the key.

Every key chooser in the app lists these same keys, and a choice you make for one server is
remembered for that server.

---

## 71. Publish a list, not just a catalogue (v1.0.0+)

On BetterCommunity, **Submit content → Host my own catalog** can now host two things that are
documents rather than collections of items:

- a **Server-Repo list** — the file BMM's *Browse Server Repositories* reads, so you can
  publish your own selection of repos;
- a **catalogue index** — a catalogue of catalogues, which hands somebody a single address
  that brings in app, plugin, theme, automation, modpack, tutorial and repo catalogues at
  once.

Both are exported from BMM (the repo-catalogue builder, and the catalogue-index builder in
Settings), uploaded as one JSON file, and served at a stable address with the same access
control every catalogue has. There is nothing to host per entry, so these are free.

Submit content also links to **Host a Server-Repo** now — the mods themselves, which is a
different thing from a catalogue and previously had no signpost on that page.


## 72. BMMScript — automations as text (v1.0.0+)

The scheduler has a second way to write the same thing: an automation as text, in the task
editor's **Code** tab.

It is not a separate language with its own actions. It **compiles to the blocks** — the text
becomes exactly the steps the block editor produces, and the same runner executes them. Three
things follow, and they are the whole design:

- **It is never behind the app.** An action is written `do <name>(…)` and the language holds
  no list of action names, so an action added to BMM is writable in script the same day.
- **Either direction.** Code opens as blocks; blocks print as code. Neither loses anything
  except your comments and blank lines, which the block tree has nowhere to put.
- **It cannot do more than a block can.** Permissions, variable substitution, loop limits and
  error handling are the runner's, unchanged. Code is a way to *write* an automation, not a
  way around its rules.

It has conditions and boolean groups, loops of four kinds, `parallel` branches, `try`/`catch`,
`switch`, variables with optional types, arithmetic, comparisons, shared blocks, sub-tasks
(waiting or not), and raw `script` bodies in PowerShell, CMD, Bash, Python, Node or Rust —
taken exactly as written, braces and all.

What it deliberately has **no** support for: your own functions, and recursion.

The editor compiles as you type and puts the caret on the first error when you ask for it —
never while you are still typing a line. Completion offers what fits where the caret is
(actions after `do`, engines after `script`, conditions in a condition slot) and **Enter never
accepts a suggestion**: Enter is a newline, Tab accepts.

The full list of everything you can write is generated from BMM's own registry, so it cannot
describe a version that does not exist: **Help & other → BMMScript — every action, condition
and value**, and the same page on the documentation site.

## 73. Publish a catalogue of automations (v1.0.0+)

BMM could follow a catalogue of automations and had no way to make one. Publishing meant
writing `catalog.json` by hand and guessing the field names.

**Settings → Scheduler → Files… → My catalogues… → Create one** picks your automations and
writes one file: a `.bmmbundle` holding the `catalog.json` and every automation packed into
it, or a `catalog.json` of addresses for automations already hosted. Send the bundle, or drop
the catalogue file on GitHub, GitHub Pages or any static host — see §77.

The addresses it writes are **relative** — `nightly.bmmpa`, not a full URL — because a
catalogue that names its own host stops working the moment it is moved, mirrored or forked,
and being forked is the normal life of a folder on GitHub. BMM resolves them against wherever
it fetched the catalogue from.

Everything an automation calls travels with it: sub-tasks, shared blocks, launch packs and
plugins. Two automations with the same name get different files, so one entry can never
quietly serve another's contents.

## 74. Theme catalogues can point at a file (v1.0.0+)

Every other catalogue kind lists an *address* and fetches the file. A theme catalogue had to
carry the whole theme inline, so the obvious way to publish — a folder of `.bmmtheme` files
with a `catalog.json` beside them — was the one way that did not work: you pasted each theme's
full body into the feed by hand, and re-pasted it to publish a fix.

An entry with a `download_url` and no `vars` is now fetched when you install it. Inline still
works and is still what the builder writes, so nothing published so far changes. Relative
addresses resolve against the catalogue, exactly as they do for automations.

## 75. Compact view now includes the details panel (v1.0.0+)

Compact used to mean shorter cards, and opening one gave you the full-size panel — a tall form
dropped into a list whose rows are 54 pixels. The panel follows the setting now: tighter
fields, and a shorter box, because the setting is about how much room the library takes and
the panel is part of the library. Everything still scrolls, so nothing is hidden.

## 76. Conflicts: what Intra and Inter actually mean (v1.0.0+)

The conflicts panel showed coloured words and let you sort them. It never said what the words
meant, and the two are not the same kind of problem:

- **Intra** — the other mod is in the **same profile**. Both can be enabled together, so this
  is the conflict that matters right now.
- **Inter** — the other mod is in a **different profile** sharing the same game folder. They
  can never be active at once; it only bites when you switch profile.
- **Active** — both enabled, so the overlap is on disk now, and the mod activated last (the
  `#` number in the row) wins.
- **Potential** — the files overlap but the other mod is disabled.

Those four are a legend at the top of the panel, always visible. The filters gained a **state**
axis — whether something is happening now or only if you change something — and an empty list
now tells "no conflicts" apart from "your filters hid all of them", which look identical and
mean opposite things.

---

## 77. One catalogue screen (v1.0.0+)

Automations, mod lists, themes and tutorials share a single screen. What a catalogue holds
differs; what you do with one does not.

| Tab | What it is for |
|---|---|
| **Browse** | What the catalogues you follow contain, and one action per entry. |
| **Follow** | Add a source by address **or by file**, see what you follow, switch one off or drop it. Protected sources are handled here, once, for every kind. |
| **Create** | Pick what goes in, and choose **per entry** whether its file travels with the catalogue or is fetched from an address. |

**Two shapes out.** A **`.bmmbundle`** holds the `catalog.json` and every file it packs, in
one thing you can send — nothing to host, no address to keep alive. A **`catalog.json`** holds
addresses only, for content that already lives somewhere. Only what the catalogue names is
packed, and you choose where the file goes.

**Indexes work in the follow box.** Pasting a catalogue index follows the catalogues of that
kind and leaves the other kinds alone — following them all would be a bigger action than the
one that was asked for.

**Themes have a third per-entry choice**, *keep it in the catalogue*: the whole theme written
inline, which is what every theme catalogue published so far contains and still their default.
It works for custom themes with images, because a theme is self-contained JSON and its
preview, assets and fonts are base64 inside it — at the cost of everyone who follows the
catalogue downloading all of it just to read the list.

**Two kinds keep their own screen, on purpose.** The plugin catalogue is an editor of saved
drafts, because it is the one you come back to and change; this screen writes a file and
forgets. Modpack catalogues keep theirs because a `.cbmp` already *is* a bundle.

**A catalogue can carry what you do not have installed.** Modpacks accept an address or a
`.bmp` file; plugins accept a `.bmmplug`. Both are read and checked when you pick them rather
than when the catalogue is written, and a handed-over pack keeps the signature it arrived
with — re-signing would put your name on somebody else's work.
