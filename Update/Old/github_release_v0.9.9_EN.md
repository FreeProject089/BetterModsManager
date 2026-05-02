# Better Mods Manager v0.9.9

This version introduces significant performance optimizations, a brand-new integrity engine, and refined social integration.

### [NEW] Backend Performance Core
- **Optimized Disk Checks**: Refined the storage monitoring system to refresh disk lists once per operation, significantly speeding up complex mod activations with many dependencies.
- **File List Cache Integration**: The stacked copy engine now leverages the centralized mod file cache instead of performing redundant recursive directory scans, reducing total I/O overhead by up to 60% during deployment.
- **Code Hardening**: Resolved compiler warnings and optimized Zip archive handling in the Rust core for better stability.
- **[IMPROVED] Storage Manager**: Automatic detection of Cloud drives (Google Drive, OneDrive, Dropbox, MEGA) and Network storage (NAS/UNC) for more accurate performance warnings.

## Social & Community
### [NEW] Discord Rich Presence Integration
- **Live Activity**: Shows your active game profile and enabled mod count to your Discord friends.
- **Privacy First**: Fully toggleable from the Settings menu.
- **Reactive Updates**: Synchronized state changes when switching profiles or toggling mods.
- **[NEW] Deep Link Support (`bmm://`)**: One-click mod installation directly from your browser using the `bmm://import?url=...` protocol.
- **Shared Activation Tracking**: Instantly visualize which other profiles use and enable the same mod for easier multi-instance management.
- **Community Support**: Added a "Join Discord" button directly in the crash report modal for instant help.

## Server Repository (Server Mode)
### [NEW] Standalone Server (BMM_LW_V2)
- **Full Admin Suite**: Finalized the ultra-lightweight standalone server management interface.
- **Admin Security**: Added local password authentication with dynamic visibility toggle (eye icon).
- **Session Inspector**: New responsive modal to monitor active downloads and metadata in real-time.
- **Ban Management**: Ability to ban specific IPs or Creator IDs directly from the dashboard.
- **Full i18n Support**: The admin interface and generation options are now localized in both English and French.

### [IMPROVED] Operation Management
- **Cancellation Support**: Both Server Export and Synchronization can now be cancelled mid-process.
- **Atomic Reliability**: Implemented `Arc<AtomicBool>` guards to ensure immediate termination without leaving orphaned file handles or temporary archives.
- **UI Feedback**: Progress bars now correctly reset to 0% upon cancellation or error.

## Documentation & Interactive Diagrams
### [NEW] Nuanced Search Scoring (v0.9.9)
- **Weighted Algorithm**: Replaced binary 100% matches with keyword-ratio scoring (Perfect, Anchored, and Partial matches).
- **Visual Feedback**: Added a "Match %" badge to each search result for granular relevance identification.

- **New Technical Schemas**: Added 4 high-fidelity interactive diagrams to the gallery:
    - **Deep Integrity Engine**: Visualizes the cryptographic SHA-256 verification process.
    - **Conflict Cache (mtime)**: Details our timestamp-based optimization logic.
    - **Premium UI Interactions**: Documents the menu grace period and "catching" system.
    - **System Access Control**: Details the security bridge between the frontend and Tauri backend.
- **Tasky Mascot (Interactive Assistance)**: Tasky now provides context-aware explanations when hovering over diagram nodes and edges.
- **Improved Accessibility**: FAQ entries now feature a "Layers" stack icon if they contain an interactive diagram.
- **Gallery Link Resolution**: Fixed the broken `semanticSearch` link in the documentation gallery.
- **Visual Feedback**: Added a "Pulsing Blue" glow for diagram nodes found via search.

### [NEW] Premium Interaction & Polish
- **Smooth Dropdown Animations**: Implemented entry (fade/scale/slide) and exit animations for the mod actions menu.
- **Usability Grace Period**: Added a 100ms delay to prevent accidental menu closing.
- **Menu "Catching"**: Dropdowns can now be "caught" and instantly re-opened while closing.
- **Icon Harmonization**: Standardized all dropdown chevrons and folder opening icons (Active, Backup, Source) for perfect visual consistency.
- **[NEW] System Access Control (Security Modal)**: New security mode selection system (Full vs Limited) to protect your system while using third-party mods.
- **Backdrop Polish**: Fixed security modal background blur to be confined to the app window without obscuring the Tasky mascot.

## Localization & i18n
- **Storage Manager**: Fully localized "Critical" and "Warning" alerts for English and French.
- **Diagram Clusters**: Standardized technical labels across all interactive schemas.
- **i18n Audit**: Fully translated the "Found in Diagrams" search header and the new security system.
- **Robust i18n Engine**: Upgraded the translation engine to support complex nested keys (e.g., `docs.gallery.btn.*`) and dots in property names.
- **Fallback Purge**: Systematically removed all hardcoded fallback strings across `mods-details.ts`, `repo.ts`, `profiles.ts` and others to enforce strict i18n parity.
- **Profile Backgrounds**: Added completely missing translation keys (and wiped duplicates) for custom profile background states (`prof.bgPendingNotice`, etc.) in `en.json`, `fr.json`, and `template.json`.

## Support & User Feedback (BetaHub)
### [NEW] Advanced BetaHub Integration
- **Feedback System**: Total overhaul of the suggestion reporting modal. Feedback is now posted cleanly without redundant image uploads, leveraging native user linking via the `FormUser` header.
- **Recent Reports**:
    - **Tab Management**: Clear separation between `Bugs` and `Suggestions` inside the in-app settings history.
    - **Smart Pagination**: View is now capped at visualizing the last 5 reports by default, paired with a dynamic "View Older" expansion button.
    - **Granular Management**: Added an individual "Delete" button (trash icon) to securely forget a single report from local memory, alongside the global "CLEAR" configuration.

## Bug Fixes & Stability
### [FIXED] UI & Modals
- **Archive Explorer**: Fixed a bug affecting the proper functioning of the Archive Explorer.
- **EULA & Crash Modals**: Fixed button visibility issues when accessing the EULA from the Credits section, and resolved minor display bugs in the crash report modal.
- **Update Modals Harmonization**: Visual unification of "Update Notes" and "Update Journal" modals using `.ptb-modal-*` CSS classes.
- **Automatic Language Loading**: Modals now automatically load the `.md` file with the appropriate language suffix (`_FR.md` or `_EN.md`) from the root `@Update` folder.
- **Content Padding**: Fixed modal content padding (40px 60px) to prevent text from being flush against edges.
- **Close Button**: Fixed non-functional close button (using `modal.remove()` instead of `modal.classList.remove('open')`).

### [FIXED] Critical Syntax Errors
- **Lexical Collision**: Renamed internal `parent` variable to `pNode` in `interactive-docs.ts` to resolve a shadowing `SyntaxError`.

### [FIXED] RPC & Logic Stability
- **File Filtering**: Fixed an issue with language-based file filtering to correctly handle `_XX` (e.g., `_EN`, `_FR`) suffix conventions for documentation.
- **RPC Stability**: Resolved critical `TypeError: getProfiles is not a function` crash in the Discord status update loop.
- **Command Security**: Fixed `cancel_repo_export` RPC error where the command was not correctly registered in the backend.
- **BMM Dev Tool**: Addressed minor functional issues within the internal BMM development tool.

### [FIXED] Security & Anti-XSS
- **Content Security Policy**: Resolved critical CSP violations to harden app security and ensure expected external assets are correctly authorized.
- **Toast Notifications**: Refactored the global `toast()` function in `app.ts` to use sterile DOM structures (`.textContent`), plugging a potential XSS vulnerability.
- **Profile Deletion**: Secured the irreversible profile deletion modal in `profiles.ts` by strictly enforcing `escHtml` checks on user-defined profile names.
- **BetaHub Moderation**: Added an `isGibberish` text validation check to the BetaHub feedback modal to prevent nonsensical spam submissions.

### [FIXED] Localization
- **Storage Manager i18n**: Resolved duplicate translation keys and corrected nested section placements within the local language files (`en.json`, `fr.json`).
- **Gallery Key Detection**: Resolved a bug where diagram gallery buttons failed to detect their translations due to JSON structure.

## Legal & Compliance
### [NEW] End User License Agreement (EULA)
- **Mandatory Installer EULA**: Integrated a required license agreement page into both NSIS (.exe) and WiX (.msi) installers to ensure legal compliance.
- **In-App EULA Viewer**: Added a dedicated, localized EULA section in the Credits page with full Markdown rendering support.
- **Community Localization**: Created a comprehensive **EULA Translation Guide** (EN/FR) to allow community members to bundle their own legal translations easily.
- **Moderation Clauses**: Formalized guidelines regarding Server Repositories and user moderation for a safer modding environment.

### [FIXED] Standalone Server & Dashboard
- **JS Syntax Errors**: Resolved critical bugs preventing login and ban actions from working on the generated dashboard.
- **Responsive Dashboard**: The Session Inspector modal now correctly adapts to all screen sizes.
- **Server Repo UI**: Fixed missing password eye icon and removed misleading hover effects on static "Optional" badges.
- **Rust Warning Cleanup**: Systematic elimination of all compilation warnings and unnecessary mutability in the Rust core to ensure peak performance and stability.

## Installation
1. Download BetterModsManager_v0.9.9.exe or .msi.
2. Run the installer and follow the instructions.
3. Launch the application.

Links:
- Website: https://freeproject089.github.io/BMM_Web/
- GitHub: https://github.com/FreeProject089/BetterModsManager
- Discord: https://discord.com/invite/CTaaEF9R75

Release Date: May 1st, 2026 - 19:00 Zurich Time
