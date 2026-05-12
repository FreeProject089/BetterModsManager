# Mod Integrity & Hash Management System

Implementation of a comprehensive hash/integrity management feature for Better Mods Manager, covering Settings UI, Mod Library feedback, Mod Detail actions, and backend Rust commands.

## User Review Required

> [!IMPORTANT]
> **Integrity Check Before Activation**: When `verify_integrity_before_activation` is enabled and a mod's hash is invalid/missing, should we:
> - (A) Block activation completely and show a toast error? ← **Proposed approach**
> - (B) Show a confirmation modal letting the user force-activate anyway?

> [!WARNING]
> **Backend Tauri Event System**: The progress tracking for bulk hash recalculation will use `tauri::Window::emit()` events (`sha-progress`). This requires the frontend to listen via `appWindow.listen()`. This is the standard Tauri approach for async progress reporting.

## Proposed Changes

### Phase 1: Backend — New Rust Commands & State Updates

---

#### [MODIFY] [state.rs](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/src-tauri/src/state.rs)

Add `verify_integrity_before_activation` field to `AppSettings`:

```diff
 pub struct AppSettings {
     ...
     pub fs_security_mode: Option<String>,
+    #[serde(default)]
+    pub verify_integrity_before_activation: bool,
 }
```

And update the `Default` impl accordingly.

---

#### [MODIFY] [mods.rs](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/src-tauri/src/commands/mods.rs)

**3 new Tauri commands** + **1 modification** to existing `enable_mod`:

1. **`clear_mod_hashes(mod_id)`** — Clears `file_hashes` for a specific mod
2. **`recalculate_profile_hashes(profile_id)`** — Bulk recalculation with `sha-progress` events emitted via `tauri::Window`
3. **`get_profile_hash_stats(profile_id)`** — Returns per-profile stats: `{ total_mods, hashed_mods, last_hash_date }`

**Modify `enable_mod`**: If `settings.verify_integrity_before_activation` is `true`, run `get_mod_integrity` logic inline before applying. If invalid, return an error string like `"INTEGRITY_FAILED|{mod_id}"` preventing activation.

**Modify `start_sha_calculation_background`**: Emit `sha-progress` event with `{ mod_id, mod_name, current, total }` payload after each mod is processed so the modal can show real-time progress.

---

#### [MODIFY] [main.rs](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/src-tauri/src/main.rs)

Register 3 new commands in the `invoke_handler`:
- `commands::mods::clear_mod_hashes`
- `commands::mods::recalculate_profile_hashes`
- `commands::mods::get_profile_hash_stats`

---

### Phase 2: Frontend — Settings UI

---

#### [MODIFY] [models.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/types/models.ts)

Add `verify_integrity_before_activation` to `AppSettings` interface + new interfaces:

```ts
export interface ProfileHashStats {
  total_mods: number;
  hashed_mods: number;
  last_hash_date: string | null;
}

export interface ShaProgressEvent {
  mod_id: string;
  mod_name: string;
  current: number;
  total: number;
}
```

---

#### [MODIFY] [settings.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/features/settings/settings.ts)

Add new `initHashManagementSettings()` function:
- Wire up the toggle `#chk-verify-integrity` for the "Verify Integrity Before Activation" option
- Wire up `#btn-open-hash-manager` to open the Hash Management modal

---

#### [MODIFY] [index.html](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/index.html)

Add **2 new HTML blocks** in `#view-settings`:

1. **Hash Management Card** (after the Discord RPC card ~line 4179):
   - Title: "Mod Integrity & Hashes" with a shield icon
   - Description explaining SHA-256 integrity checking
   - Toggle: "Verify integrity before activation" (`#chk-verify-integrity`)
   - Button: "Open Hash Manager" (`#btn-open-hash-manager`) opening the modal

2. **Hash Manager Modal** (`#modal-hash-manager`):
   - Per-profile stats table: profile name, % hashed, last hash date
   - "Recalculate All" button per profile
   - Real-time progress bar with `%` and mod name display
   - Individual mod search/recalculate within the modal

---

### Phase 3: Frontend — Mod Library Visual Feedback

---

#### [MODIFY] [components.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/ui/components.ts)

In `getModCardHTML()`:
- Add a `⚠` warning badge next to the mod name when `mod.file_hashes` is `null` (no hash computed yet) **or** when the mod is flagged as modified
- The badge will have a tooltip: `"Integrity not verified"` or `"Mod was modified since last hash"`
- Use `onmouseenter="window.showTaskyHelp('mod.integrityWarning', 'alert')"` pattern

---

#### [MODIFY] [mods-list.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/features/mods/mods-list.ts)

In the toggle change handler (activation flow):
- If `verify_integrity_before_activation` is enabled, handle the `INTEGRITY_FAILED` error string from the backend
- Show a specific toast: "Integrity check failed. Recalculate hashes to activate this mod."

---

### Phase 4: Frontend — Mod Detail Panel

---

#### [MODIFY] [components.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/ui/components.ts)

In `getModDetailHTML()`, add a new collapsible section `integrity` between `conflicts` and `links`:

```
🔐 Integrity
├── Status badge: ✓ Valid / ⚠ Modified / ? Not Verified
├── Hash count: "12 / 12 files hashed"
├── Last hash date
├── [Recalculate Hashes] button
└── [Clear Hashes] button (danger, with confirmation)
```

---

#### [MODIFY] [mods-details.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/features/mods/mods-details.ts)

Wire up the new integrity section buttons:
- `#btn-recalc-hash`: Calls `update_mod_hashes`, shows spinner, refreshes detail
- `#btn-clear-hash`: Calls `clear_mod_hashes` after confirmation, refreshes detail

---

### Phase 5: i18n Translations

---

#### [MODIFY] [en.json](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/Lang/en.json)

Add all new translation keys under `integrity.*` and `settings.hash*` namespaces.

#### [MODIFY] [fr.json](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/Lang/fr.json)

French translations for all new keys.

---

### Phase 6: CSS

---

#### [MODIFY] CSS files

Add styles for:
- `.integrity-badge` — small warning/success badge on mod cards
- `.hash-progress-bar` — animated progress bar in the modal
- `.integrity-status-pill` — status indicator in mod detail
- `.hash-manager-profile-row` — profile row in the modal

---

## File Change Summary

| Layer | File | Changes |
|-------|------|---------|
| Backend | `state.rs` | +1 field `verify_integrity_before_activation` |
| Backend | `mods.rs` | +3 commands, modify `enable_mod` + SHA worker |
| Backend | `main.rs` | Register 3 new commands |
| Frontend | `models.ts` | +2 interfaces, +1 field |
| Frontend | `settings.ts` | +1 init function for hash management |
| Frontend | `index.html` | +1 settings card, +1 modal |
| Frontend | `components.ts` | Integrity badge in cards + new detail section |
| Frontend | `mods-list.ts` | Handle `INTEGRITY_FAILED` in activation |
| Frontend | `mods-details.ts` | Wire integrity buttons |
| i18n | `en.json`, `fr.json` | ~30 new keys |
| CSS | style files | New badge/progress/status styles |

## Verification Plan

### Automated Tests
- `cargo build` — Ensure Rust compiles with new commands
- `npm run build` — Ensure TypeScript compiles cleanly

### Manual Verification
- Toggle "Verify Integrity" on → try activating a mod with no hashes → should fail
- Toggle "Verify Integrity" off → mod activates normally
- Open Hash Manager modal → see per-profile stats
- Click "Recalculate All" → see real-time progress bar
- In Mod Detail → "Recalculate" → hashes update
- In Mod Detail → "Clear Hashes" → hashes removed, warning badge appears on card
- Mod Card shows ⚠ badge for mods without valid hashes
