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

## 6. Integrity Report

| Feature | Description |
| :--- | :--- |
| **File Verification** | After a game update, BMM can verify whether installed mod files are still intact in the game's ROOT directory. |
| **Status Detection** | Files are reported as OK, Missing, or Modified (size mismatch) for each active mod. |

---

## 7. Archive Explorer

| Feature | Description |
| :--- | :--- |
| **Browse Without Extracting** | Open any `.zip` inside the app to browse its complete file tree. |
| **Search** | Filter the file tree by filename in real-time. |
| **Right-Click Actions** | Open a specific file or folder from the archive directly in Windows Explorer. Copy the path to clipboard. |

---

## 8. Update Notes

| Feature | Description |
| :--- | :--- |
| **Built-in Changelog** | A modal displays all `.md` files found in the `Update/` directory, rendered with full Markdown support. |
| **Archive Access** | Older changelogs from `Update/Old_Update/` are available in a sidebar for historical reference. |
| **File Browser Sidebar** | Navigate between release note files using left-panel navigation. |

| **File Browser Sidebar** | Navigate between release note files using left-panel navigation. |
| **Cancellation Support** | Long operations like modlist installations can be cancelled mid-way through the progress UI. |

---

## 10. Mod Connection Types

When adding or editing a mod, you can categorize its download links. This helps with organization and automation.

| Type | Best Use Case | BMM Behavior |
| :--- | :--- | :--- |
| **GitHub** | Official mod repositories or release pages. | Standard community-recognized link. |
| **Direct** | A direct URL to a `.zip`, `.rar`, or `.7z` file. | **High Priority.** Essential for fully automated `.MM` installations. |
| **Google Drive** | Large files shared through Drive. | Requires manual interaction if a direct bypass isn't possible. |
| **MEGA** | Encrypted cloud storage. | Standard link recognition. |
| **Other** | Forums (DCS, Nexus), Discord links, etc. | Generic fallback link. |

---

## 11. Interface & Settings

| Feature | Description |
| :--- | :--- |
| **Multilingual** | Full support for English and French via a JSON-based i18n engine. Language switching is instant — no reload required. |
| **Onboarding (Tasky)** | An interactive tutorial guides new users step-by-step through every core feature, with navigation to the relevant view. |
| **Keyboard Shortcuts** | Ctrl+N (New Profile), Ctrl+E (Export .MM), and other shortcuts for power users. |
| **Dark Mode Design** | Fixed dark mode workstation aesthetic with CSS custom properties for accent colors, borders, and transitions. |
| **Sidebar Navigation** | Instant view switching: Library, Profiles, Mod Lists, Documentation, Credits, and Settings. |

---

*Better Mod Manager is developed by FreeProject089.*
