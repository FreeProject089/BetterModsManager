# Changelog Summary (since 7e839e6e)

This document summarizes the major technical and functional changes introduced in Better Mod Manager from commit `7e839e6e` to the current version.

## Server Repository & Administration
### [NEW] Whitelist & Ban Management
- Implemented `whitelist_manager.rs` and `ban_manager.rs` in the Rust backend.
- Added UI for manual entry of IP addresses and Creator Keys.
- Added capability to authorized/block users in real-time.

### [REFINE] Admin UI Overhaul
- **Premium Design**: Full glassmorphic overhaul for Monitoring, Whitelist, and Ban modals.
- **UX Improvements**: Added integrated search/filter for lists and one-click copy buttons for IDs and IPs.
- **Unified Feedback**: Standardized row layouts and themed headers for all server-related administration.

### [NEW] Live Monitoring
- Real-time tracking of connected clients.
- Visual progress bars for active downloads per client.
- IP and target file identification for hosts.

### [IMPROVED] Mini-Server
- Refined `server.ps1` for better standalone hosting performance.
- Added `launcher.bat` for easier admin privilege management.

## Mod Management Engine & Library
### [REFINED] Dependency System
- **Load Order Priority**: The parent mod now prioritizes its own files before requirements (Parent first, then deps).
- **Cascading Deactivation**: Disabling a mod now triggers a prompt to optionally disable its dependents and requirements.
- **Improved UI**: Searchable dropdown in "Add Mod" modal showing all library mods on focus.

### [FIXED] Library Navigation & Stability
- **Functional Fixes**: Resolved `window.openDocs` crash for "How it works" button.
- **Empty State UX**: "Create a profile" button now correctly switches to the Profiles tab and auto-opens the creation modal.
- **RPC Safety**: Added guards for `scan_mods_folder` to prevent errors when no profile is active.

### [FIXED] UI Reactivity
- Activation order badges (`#N`) now refresh immediately when toggling mods without requiring a manual list reload.
- Synchronized naming conventions between frontend and backend (e.g., `mod_id`, `mod_folder_path`).

## Localization & UX
### [IMPROVED] Internationalization (i18n)
- **Full Audit**: Fixed all missing translation keys in `en.json` and `fr.json`.
- **UI Feedback**: Localized all toasts and status messages for Server Repository operations.
- **Consistency**: Unified translation keys between `repo.js` and JSON dictionary files.

### [NEW] Interactive Diagrams
- **Lightweight Architecture**: New diagram explaining the "Smart Physical Copy" philosophy vs virtual links.
- **Improved Tooltips**: Tasky now provides more granular explanations for backend logic steps.

### [VISUAL] Credits Page
- Added looping video background for a premium feel.
- Synchronized version reporting (v0.9.8) across the UI.

## Technical Debt & Performance
- Optimized IPC calls between JS and Rust for smoother UI response during bulk operations.
- Fixed several Rust compilation errors related to unbalanced delimiters and mismatched field names.
- Batching of profile state saves to reduce Disk I/O overhead.

---
*Generated on: 2026-03-24*
