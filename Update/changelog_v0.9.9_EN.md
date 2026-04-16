# Changelog v0.9.9 (since ea8279e)

This version introduces significant performance optimizations, a brand-new integrity engine, and refined social integration.

### [NEW] Backend Performance Core
- **Optimized Disk Checks**: Refined the storage monitoring system to refresh disk lists once per operation, significantly speeding up complex mod activations with many dependencies.
- **File List Cache Integration**: The stacked copy engine now leverages the centralized mod file cache instead of performing redundant recursive directory scans, reducing total I/O overhead by up to 60% during deployment.
- **Code Hardening**: Resolved compiler warnings and optimized Zip archive handling in the Rust core for better stability.

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

## Support & User Feedback (BetaHub)
### [NEW] Advanced BetaHub Integration
- **Feedback System**: Total overhaul of the suggestion reporting modal. Feedback is now posted cleanly without redundant image uploads, leveraging native user linking via the `FormUser` header.
- **Recent Reports**:
    - **Tab Management**: Clear separation between `Bugs` and `Suggestions` inside the in-app settings history.
    - **Smart Pagination**: View is now capped at visualizing the last 5 reports by default, paired with a dynamic "View Older" expansion button.
    - **Granular Management**: Added an individual "Delete" button (trash icon) to securely forget a single report from local memory, alongside the global "CLEAR" configuration.

## Bug Fixes & Stability
### [FIXED] Critical Syntax Errors
- **Lexical Collision**: Renamed internal `parent` variable to `pNode` in `interactive-docs.ts` to resolve a shadowing `SyntaxError`.
### [FIXED] RPC & Logic Stability
- **RPC Stability**: Resolved critical `TypeError: getProfiles is not a function` crash in the Discord status update loop.
- **Command Security**: Fixed `cancel_repo_export` RPC error where the command was not correctly registered in the backend.

### [FIXED] Security & Anti-XSS
- **Toast Notifications**: Refactored the global `toast()` function in `app.ts` to use sterile DOM structures (`.textContent`), plugging a potential XSS vulnerability.
- **Profile Deletion**: Secured the irreversible profile deletion modal in `profiles.ts` by strictly enforcing `escHtml` checks on user-defined profile names.

## Legal & Compliance
### [NEW] End User License Agreement (EULA)
- **Mandatory Installer EULA**: Integrated a required license agreement page into both NSIS (.exe) and WiX (.msi) installers to ensure legal compliance.
- **In-App EULA Viewer**: Added a dedicated, localized EULA section in the Credits page with full Markdown rendering support.
- **Community Localization**: Created a comprehensive **EULA Translation Guide** (EN/FR) to allow community members to bundle their own legal translations easily.
- **Moderation Clauses**: Formalized guidelines regarding Server Repositories and user moderation for a safer modding environment.

---
*Generated on: 2026-04-02*
