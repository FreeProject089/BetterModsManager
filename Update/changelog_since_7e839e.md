# Changelog Summary (since 7e839e6e)

This document summarizes the major technical and functional changes introduced in Better Mod Manager from commit `7e839e6e` to the current version.

## Server Repository & Networking
### [NEW] Whitelist & Ban Management
- Implemented `whitelist_manager.rs` and `ban_manager.rs` in the Rust backend.
- Added UI for manual entry of IP addresses and Creator Keys.
- Added capability to authorized/block users in real-time.

### [NEW] Live Monitoring
- Real-time tracking of connected clients.
- Visual progress bars for active downloads per client.
- IP and target file identification for hosts.

### [IMPROVED] Mini-Server
- Refined `server.ps1` for better standalone hosting performance.
- Added `launcher.bat` for easier admin privilege management.

## Mod Management Engine
### [REFINED] Dependency System
- **Load Order Priority**: The parent mod now prioritizes its own files before requirements (Parent first, then deps).
- **Cascading Deactivation**: Disabling a mod now triggers a prompt to optionally disable its dependents and requirements.
- **Improved UI**: Searchable dropdown in "Add Mod" modal showing all library mods on focus.

### [FIXED] UI Reactivity
- Activation order badges (`#N`) now refresh immediately when toggling mods without requiring a manual list reload.
- Synchronized naming conventions between frontend and backend (e.g., `mod_id`, `mod_folder_path`).

## Documentation & UX
### [NEW] Interactive Diagrams
- **Lightweight Architecture**: New diagram explaining the "Smart Physical Copy" philosophy vs virtual links.
- **Improved Tooltips**: Tasky now provides more granular explanations for backend logic steps.

## Technical Debt & Performance
- Optimized IPC calls between JS and Rust for smoother UI response during bulk operations.
- Fixed several Rust compilation errors related to unbalanced delimiters and mismatched field names.
- Batching of profile state saves to reduce Disk I/O overhead.

---
*Generated on: 2026-03-22*
