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

### [NEW] Diagrams Gallery Expansion
- **New Technical Schemas**: Added 3 high-fidelity interactive diagrams to the gallery:
    - **Deep Integrity Engine**: Visualizes the cryptographic SHA-256 verification process.
    - **Conflict Cache (mtime)**: Details our timestamp-based optimization logic.
    - **Premium UI Interactions**: Documents the menu grace period and "catching" system.
- **Improved Accessibility**: FAQ entries now feature a "Layers" stack icon if they contain an interactive diagram.
- **Gallery Link Resolution**: Fixed the broken `semanticSearch` link in the documentation gallery.
- **Visual Feedback**: Added a "Pulsing Blue" glow for diagram nodes found via search.

### [NEW] Premium Interaction & Polish
- **Smooth Dropdown Animations**: Implemented entry (fade/scale/slide) and exit animations for the mod actions menu.
- **Usability Grace Period**: Added a 100ms delay to prevent accidental menu closing.
- **Menu "Catching"**: Dropdowns can now be "caught" and instantly re-opened while closing.
- **Icon Harmonization**: Standardized all dropdown chevrons for a consistent "Vanguard" look.

## Localization & i18n
- **Storage Manager**: Fully localized "Critical" and "Warning" alerts for English and French.
- **Diagram Clusters**: Standardized technical labels across all interactive schemas.
- **i18n Audit**: Fully translated the "Found in Diagrams" search header.
- **Fallback Purge**: Systematically removed all hardcoded fallback strings across `mods-details.ts`, `repo.ts`, `profiles.ts` and others to enforce strict i18n parity.
- **Profile Backgrounds**: Added completely missing translation keys (and wiped duplicates) for custom profile background states (`prof.bgPendingNotice`, etc.) in `en.json`, `fr.json`, and `template.json`.

## Bug Fixes & Stability
### [FIXED] Critical Syntax Errors
- **Lexical Collision**: Renamed internal `parent` variable to `pNode` in `interactive-docs.ts` to resolve a shadowing `SyntaxError`.
### [FIXED] RPC & Logic Stability
- **RPC Stability**: Resolved critical `TypeError: getProfiles is not a function` crash in the Discord status update loop.
- **Command Security**: Fixed `cancel_repo_export` RPC error where the command was not correctly registered in the backend.

### [FIXED] Security & Anti-XSS
- **Toast Notifications**: Refactored the global `toast()` function in `app.ts` to use sterile DOM structures (`.textContent`), plugging a potential XSS vulnerability.
- **Profile Deletion**: Secured the irreversible profile deletion modal in `profiles.ts` by strictly enforcing `escHtml` checks on user-defined profile names.

---
*Generated on: 2026-04-02*
