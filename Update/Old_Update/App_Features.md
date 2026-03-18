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

---

## 8. Interactive Documentation & Diagrams

BMM 0.9.8 introduces a state-of-the-art interactive documentation system.

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

---

## 9. Archive Explorer

| Feature | Description |
| :--- | :--- |
| **Browse Without Extracting** | Open any `.zip` inside the app to browse its complete file tree. |
| **Search** | Filter the file tree by filename in real-time. |
| **Right-Click Actions** | Open a specific file or folder from the archive directly in Windows Explorer. Copy the path to clipboard. |

---

## 10. Update Notes

| Feature | Description |
| :--- | :--- |
| **Built-in Changelog** | A modal displays all `.md` files found in the `Update/` directory, rendered with full Markdown support. |
| **Archive Access** | Older changelogs from `Update/Old_Update/` are available in a sidebar for historical reference. |
| **File Browser Sidebar** | Navigate between release note files using left-panel navigation. |

---

## 11. Crash Reporting & Troubleshooting

BMM includes a high-reliability diagnostic system to ensure any issue can be identified and fixed quickly.

| Feature | Description |
| :--- | :--- |
| **Real-Time Logging** | Every action is written instantly to `current_session.log`. |
| **Automatic Crash Detection** | At startup, BMM checks for unclean exits and automatically packages diagnostic reports into `.zip` files. |
| **Manual Report Button** | Users can manually trigger a full system diagnostic report from the Settings menu. |

---

## 12. Auto-Update System

| Feature | Description |
| :--- | :--- |
| **Automatic Check on Startup** | BMM queries the GitHub Releases API shortly after launch to check for newer versions. |
| **Manual Check Button** | Available in the sidebar and Settings for on-demand checks. |
| **Update Modal** | Displays version comparisons, markdown release notes, and direct installer download buttons. |

---

## 13. PTB Mode (Public Test Build)

| Feature | Description |
| :--- | :--- |
| **Welcome Modal** | On first launch, a themed welcome modal displays the PTB release notes. |
| **Dynamic Markers** | Special badges and version suffixes appear based on this mode. |

---

## 14. Performance & Storage Management

BMM features a suite of high-end diagnostic and optimization tools to ensure maximum stability.

| Feature | Description |
| :--- | :--- |
| **Disk I/O Limiter** | Prevents system freezes by capping the transfer speed during mod activation/deactivation. Custom limits can be set per disk. |
| **Performance Dashboard** | A real-time monitoring overlay (PiP) tracking CPU, RAM, and Disk activity. Supports timeline scrubbing and historical data export (CSV). |
| **Storage Manager** | Detects SSD/HDD types, filesystems, and auto-identifies cloud (Google Drive, MEGA, etc.) or network drives. |
| **Benchmark Tool** | Test your disk's real-world performance directly within BMM to find the optimal speed limit. |
| **Interactive Performance Guide** | Integrated diagrams explain exactly how the I/O limiter and chunked transfer engine work together. |

---

## 15. UI Guidance & Empty States

| Feature | Description |
| :--- | :--- |
| **"How it Works" Buttons** | Context-sensitive help buttons appear on empty views (Library, Profiles) to guide new users. |
| **Instructional Modals** | Direct access to relevant documentation and diagrams from the main interface. |

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

---

*Better Mod Manager is developed by FreeProject089.*
