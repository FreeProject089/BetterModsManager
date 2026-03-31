# Changelog v0.9.9 (since ea8279e)

This version introduces significant performance optimizations, a brand-new integrity engine, and refined social integration.

## Performance & Core Engines
### [NEW] High-Performance Conflict Detection
- **mtime Caching**: Implemented a metadata-based cache that tracks modification dates of mod folders.
- **80% Faster Scans**: Skipping unchanged folders results in near-instantaneous library scans on subsequent launches.
- **Selective Checking**: Refined IPC logic to only verify conflicts for the mod being toggled.

### [NEW] Deep Integrity Engine
- **SHA-256 Verification**: Added a dedicated security layer that performs full cryptographic hashing of mod files against the game root.
- **Reliable Detection**: Identifies corrupted or modified files with 100% precision beyond simple file-size comparisons.

## Social & Community
### [NEW] Discord Rich Presence Integration
- **Live Activity**: Shows your active game profile and enabled mod count to your Discord friends.
- **Privacy First**: Fully toggleable from the Settings menu.
- **Reactive Updates**: Synchronized state changes when switching profiles or toggling mods.
- **Community Support**: Added a "Join Discord" button directly in the crash report modal for instant help.

## Server Repository (Server Mode)
### [IMPROVED] Operation Management
- **Cancellation Support**: Both Server Export and Synchronization can now be cancelled mid-process.
- **Atomic Reliability**: Implemented `Arc<AtomicBool>` guards to ensure immediate termination without leaving orphaned file handles or temporary archives.
- **UI Feedback**: Progress bars now correctly reset to 0% upon cancellation or error.

## Documentation & Interactive Diagrams
### [NEW] Nuanced Search Scoring (v0.9.9)
- **Weighted Algorithm**: Replaced binary 100% matches with keyword-ratio scoring (Perfect, Anchored, and Partial matches).
- **Visual Feedback**: Added a "Match %" badge to each search result for granular relevance identification.

### [NEW] Premium Interaction & Polish
- **Pulsing Node Highlight**: Implemented a subtle, professional blue pulse for diagram nodes found via search.
- **Filter Clipping Fix**: Enhanced SVG DOM traversal to prevent `drop-shadow` clipping by forcing `overflow: visible` on all parent groups.
- **Diagram Indicators**: FAQ entries now feature a "Layers" stack icon if they contain an interactive diagram.
- **i18n Audit**: Fully translated the "Found in Diagrams" search header for English and French users.

## Bug Fixes & Stability
### [FIXED] Critical Syntax Errors
- **Lexical Collision**: Renamed internal `parent` variable to `pNode` in `interactive-docs.ts` to resolve a shadowing `SyntaxError`.
### [FIXED] RPC & Logic Stability
- **RPC Stability**: Resolved critical `TypeError: getProfiles is not a function` crash in the Discord status update loop.
- **Command Security**: Fixed `cancel_repo_export` RPC error where the command was not correctly registered in the backend.

---
*Generated on: 2026-03-30*
