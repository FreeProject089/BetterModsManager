# SHA / Hash Management & Integrity Gate — Implementation Plan

## Objectif

Ajouter un système complet de gestion des SHA-256 dans BMM, accessible depuis les Settings, avec :
- Un dashboard par profil (% de hashes calculés, date du dernier calcul)
- Le recalcul individuel ou global avec progression temps réel
- Un garde-fou optionnel empêchant l'activation d'un mod sans hash valide
- Des indicateurs visuels dans la liste de mods (badge `?` / warning)
- Des actions contextuelles dans le panneau détail : recalculer, supprimer, re-télécharger

---

## Contexte & Analyse

### Infrastructure existante (à réutiliser)

| Élément | Emplacement | Rôle |
|---|---|---|
| `ModEntry.file_hashes` | `models/mod_entry.rs` | `Option<HashMap<String,String>>` — hashes par fichier |
| `update_mod_hashes` | `commands/mods.rs:1894` | Recalcule les hashes d'un mod |
| `get_mod_integrity` | `commands/mods.rs:1816` | Rapport d'intégrité pour un mod |
| `start_sha_calculation_background` | `commands/mods.rs:1922` | Worker de fond |
| `populate_sha_queue` / `add_mod_to_priority_sha_queue` | `commands/mods.rs` | Files de calcul |
| `sha_queue`, `sha_queue_priority`, `sha_calculation_active` | `state.rs` | Arc<Mutex<>> déjà dans AppState |

### Ce qui **manque**

1. **`hash_calculated_at: Option<String>`** sur `ModEntry` — pour la date du dernier calcul
2. **`require_hash_before_activation: bool`** dans `AppSettings` — le garde-fou (défaut: `false`)
3. **Commande `get_hash_stats()`** — retourne les stats par profil
4. **Commande `recalculate_all_hashes_for_profile(profile_id)`** — recalcul global avec events de progression
5. **Commande `recalculate_mod_hashes_with_event(mod_id, window)`** — recalcul individuel avec event
6. **Modification de `enable_mod()`** — bloquer si `require_hash_before_activation` et hash invalide/absent
7. **Frontend Settings** — nouvelle section SHA + modal
8. **Frontend Mod List** — badge warning si hash invalide ou absent
9. **Frontend Mod Detail** — boutons recalculer / supprimer / re-télécharger

---

## Open Questions

> [!IMPORTANT]
> **Date du dernier calcul** : Le champ `hash_calculated_at` est ajouté sur `ModEntry`. Il sera mis à jour lors de tout calcul (background ou manuel). Les anciens mods auront `null` (affiché comme "Jamais").

> [!IMPORTANT]
> **Progression temps réel** : L'event Tauri `bmm://hash-progress` sera émis avec `{ profileId, modId, modName, done, total, percent }`. Le frontend s'y abonne pendant que la modal est ouverte.

> [!IMPORTANT]
> **Re-download** : Le bouton "Supprimer & Re-télécharger" n'apparaît que si `mod.download_links` contient au moins un lien avec `link_type === 'direct'` ou `'github'`. Il utilise la commande `download_mod` existante après `remove_mod`.

> [!IMPORTANT]
> **Garde-fou & activation bloquée** : Quand `require_hash_before_activation = true`, `enable_mod()` retourne `Err("HASH_REQUIRED|<mod_name>")` si le mod n'a pas de hashes. Le frontend affiche un toast spécifique et ne bloque **pas** les mods déjà activés (le guard ne s'applique qu'à l'activation).

---

## Proposed Changes

### 1. Rust — Model (`models/mod_entry.rs`)

#### [MODIFY] [mod_entry.rs](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/src-tauri/src/models/mod_entry.rs)

- Ajouter `hash_calculated_at: Option<String>` sur `ModEntry`
- L'initialiser à `None` dans `ModEntry::new()`

---

### 2. Rust — State (`state.rs`)

#### [MODIFY] [state.rs](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/src-tauri/src/state.rs)

- Ajouter `require_hash_before_activation: bool` dans `AppSettings` (défaut `false`, `#[serde(default)]`)
- Ajouter dans `AppSettings::default()` : `require_hash_before_activation: false`

---

### 3. Rust — Commands (`commands/mods.rs`)

#### [MODIFY] [mods.rs](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/src-tauri/src/commands/mods.rs)

**A) Mettre à jour `hash_calculated_at` lors des calculs existants**

Dans `update_mod_hashes` (ligne 1894) et dans `start_sha_calculation_background` (ligne 1922) : après avoir assigné `m.file_hashes = Some(new_hashes)`, ajouter :
```rust
m.hash_calculated_at = Some(chrono::Local::now().to_rfc3339());
```

**B) Nouvelle struct + commande `get_hash_stats`**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileHashStats {
    pub profile_id: String,
    pub profile_name: String,
    pub total_mods: usize,
    pub hashed_mods: usize,
    pub percent: f32,
    pub last_calculated_at: Option<String>, // most recent hash_calculated_at among mods
}

#[tauri::command]
pub fn get_hash_stats(state: State<AppState>) -> Result<Vec<ProfileHashStats>, String>
```

Pour chaque profil, itère sur les mods qui lui appartiennent et calcule `hashed_mods` (ceux avec `file_hashes.is_some()` et non vide), `total_mods`, `percent` et le `last_calculated_at` le plus récent.

**C) Nouvelle commande `recalculate_all_hashes_for_profile`**

```rust
#[tauri::command]
pub async fn recalculate_all_hashes_for_profile(
    window: Window,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), String>
```

- Récupère la liste des mods du profil
- Pour chaque mod (avec compteur `done` / `total`) :
  - Calcule `compute_file_sha256` pour chaque fichier
  - Émet `window.emit("bmm://hash-progress", payload)` avec `{ profileId, modId, modName, done, total, percent }`
  - Met à jour `m.file_hashes` et `m.hash_calculated_at`
- Sauvegarde l'état

**D) Nouvelle commande `recalculate_mod_hashes_with_event`**

```rust
#[tauri::command]
pub async fn recalculate_mod_hashes_with_event(
    window: Window,
    state: State<'_, AppState>,
    mod_id: String,
) -> Result<(), String>
```

Identique à `update_mod_hashes` mais émet un event `bmm://hash-mod-done` à la fin.

**E) Modifier `enable_mod()` pour le garde-fou**

En début de `enable_mod()`, après avoir résolu les dépendances, ajouter :
```rust
// Integrity gate check
let (require_hash, mod_has_hashes) = {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let require = data.settings.require_hash_before_activation;
    let has_hash = data.mods.iter()
        .find(|m| m.id == mod_id)
        .map_or(true, |m| m.file_hashes.as_ref().map_or(false, |h| !h.is_empty()));
    (require, has_hash)
};
if require_hash && !mod_has_hashes {
    let name = { ... }; // get mod name
    return Err(format!("HASH_REQUIRED|{}", name));
}
```

---

### 4. Rust — `main.rs`

#### [MODIFY] [main.rs](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/src-tauri/src/main.rs)

Enregistrer les 3 nouvelles commandes dans `tauri::generate_handler!`:
```rust
commands::mods::get_hash_stats,
commands::mods::recalculate_all_hashes_for_profile,
commands::mods::recalculate_mod_hashes_with_event,
```

---

### 5. Frontend — `api.ts` mock stubs

#### [MODIFY] [api.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/core/api.ts)

Ajouter dans `mockInvoke` les 3 nouvelles commandes avec retours par défaut pour le test navigateur.

---

### 6. Frontend — Settings TS

#### [MODIFY] [settings.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/features/settings/settings.ts)

**Nouvelle fonction `initHashSettings()`** :

- Initialise le toggle `chk-require-hash-activation` (lit/écrit `settings.require_hash_before_activation`)
- Initialise le bouton `btn-open-hash-modal` pour ouvrir la modal glassmorphism `modal-hash-manager`
- Enregistre l'écoute de l'event Tauri `bmm://hash-progress` pendant que la modal est ouverte
- Expose `window._renderHashModal()` pour rafraîchissement dynamique

**`_renderHashModal()`** :
- Appelle `get_hash_stats()` et affiche pour chaque profil :
  - Barre de progression circulaire (CSS) avec `% hashed`
  - Date du dernier calcul
  - Bouton "Recalculer tout ce profil" → `recalculate_all_hashes_for_profile(profileId)`
  - Liste des mods du profil avec indicateur hash OK/manquant + bouton recalcul individuel

**Progression temps réel** :
- Barre de progression HTML mise à jour via l'event `bmm://hash-progress`
- Affiche le nom du mod en cours

Ajouter l'appel `await initHashSettings()` dans `initSettings()`.

---

### 7. Frontend — HTML Settings section

#### [MODIFY] [index.html](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/index.html)

**Dans la vue `settings`**, ajouter une section **SHA / Intégrité** avec :

```html
<!-- Section SHA Management -->
<div class="settings-section">
  <div class="settings-section-header">
    <!-- SHA icon + titre + description i18n -->
  </div>
  <!-- Option : require hash before activation (bmm-switch) -->
  <label class="bmm-switch" ...>
    <input type="checkbox" id="chk-require-hash-activation">
    ...
  </label>
  <!-- Bouton ouvrir modal -->
  <button id="btn-open-hash-modal" class="btn btn-primary" ...>
    <!-- data-i18n="settings.hash.openModal" -->
  </button>
</div>

<!-- Modal Hash Manager -->
<div id="modal-hash-manager" class="modal-overlay">
  <div class="modal-content glass" style="width:680px; max-height:80vh; overflow-y:auto;">
    <!-- Header -->
    <!-- Body : rendu dynamique par _renderHashModal() -->
    <div id="hash-modal-body">...</div>
    <!-- Progress bar (cachée par défaut) -->
    <div id="hash-progress-bar-wrap" style="display:none">
      <div id="hash-progress-bar"></div>
      <div id="hash-progress-label"></div>
    </div>
  </div>
</div>
```

---

### 8. Frontend — Mod List indicator

#### [MODIFY] [components.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/ui/components.ts)

Dans `getModCardHTML()` (ou équivalent), ajouter un badge d'alerte si `!mod.file_hashes || Object.keys(mod.file_hashes).length === 0` :

```html
<span class="hash-warning-badge" title="...tooltip...">?</span>
```

Le badge est un petit cercle orange/jaune avec `?`, affiché en superposition sur la card (ou à côté du nom). La tooltip (via `title` ou un `data-tooltip`) explique : *"Les hashes de ce mod n'ont pas encore été calculés ou le mod a été modifié. Il peut être compromis ou corrompu."*

Si le mod **a** des hashes mais que `get_mod_integrity` a détecté des modifications (détectable côté frontend en comparant `hash_calculated_at` vs `last_scan_mtime` — approche simple : on flag au chargement), on affiche un badge `⚠` rouge.

> [!NOTE]
> Pour éviter un appel réseau par mod au chargement, le badge rouge `⚠` sera uniquement visible si `mod.file_hashes` est non-null **mais** que `mod.hash_calculated_at` est très ancien (> 7 jours) OU après un appel explicite à `get_mod_integrity`. Le badge `?` s'affiche si aucun hash n'existe.

---

### 9. Frontend — Mod Detail panel

#### [MODIFY] [mods-details.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/features/mods/mods-details.ts)

Dans `renderModDetail()`, après les boutons existants, ajouter une section **Hash & Actions** :

```html
<div class="detail-hash-section">
  <!-- Statut du hash (OK / Manquant / Date) -->
  <div id="detail-hash-status">...</div>
  <!-- Bouton recalculer les hashes -->
  <button id="btn-recalc-hash-detail">...</button>
  <!-- Bouton supprimer le mod (existant, déplacé ici pour cohérence) -->
  <button id="btn-delete-mod-detail">...</button>
  <!-- Bouton re-télécharger (visible seulement si download_links non vide) -->
  <button id="btn-redownload-mod-detail" style="display:none">...</button>
</div>
```

**Logique boutons** :
- **Recalculer** → `invoke('recalculate_mod_hashes_with_event', { modId })` + spinner + écoute event `bmm://hash-mod-done` → toast success + refresh panel
- **Supprimer** → confirme, `invoke('remove_mod', { modId, deleteFiles: true })` + ferme panel + refresh liste
- **Re-télécharger** → `invoke('remove_mod', { modId, deleteFiles: true })` puis `invoke('download_mod', { url, modName, profileId })` ; visible uniquement si `mod.download_links.length > 0`

---

### 10. Frontend — Gestion de l'erreur `HASH_REQUIRED`

#### [MODIFY] [mods-list.ts](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/src/features/mods/mods-list.ts)

Dans le handler de `enable_mod`, intercepter l'erreur préfixée `HASH_REQUIRED|` :

```typescript
if (err.startsWith('HASH_REQUIRED|')) {
  const modName = err.split('|')[1];
  toast(t('hash.activationBlocked', { name: modName }), 'warning');
} else {
  toast(t('common.error') + ': ' + err, 'error');
}
```

---

### 11. i18n — Traductions

#### [MODIFY] [en.json](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/Lang/en.json)
#### [MODIFY] [fr.json](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/Lang/fr.json)
#### [MODIFY] [template.json](file:///e:/Travaille/CodageAutres/Better%20Project/BetterModsManager/frontend/Lang/template.json)

Nouvelles clés à ajouter dans la section `settings.*` et `hash.*` :

| Clé | EN | FR |
|---|---|---|
| `settings.hash.title` | SHA / Integrity Management | Gestion des SHA / Intégrité |
| `settings.hash.desc` | Manage file integrity hashes for your mods. | Gérez les empreintes d'intégrité de vos mods. |
| `settings.hash.openModal` | Open Hash Manager | Ouvrir le gestionnaire de hashes |
| `settings.hash.requireBeforeActivation` | Verify integrity before activation | Vérifier l'intégrité avant activation |
| `settings.hash.requireDesc` | If enabled, a mod can only be activated if its hashes are valid. | Si activé, un mod ne peut être activé que si ses hashes sont valides. |
| `hash.modalTitle` | Hash Manager | Gestionnaire de Hashes |
| `hash.profileStats` | Profile: {name} | Profil : {name} |
| `hash.percent` | {n}% hashed | {n}% hashés |
| `hash.lastCalc` | Last calculation: {date} | Dernier calcul : {date} |
| `hash.never` | Never | Jamais |
| `hash.recalcAll` | Recalculate all | Recalculer tout |
| `hash.recalcMod` | Recalculate | Recalculer |
| `hash.calculating` | Calculating... | Calcul en cours... |
| `hash.done` | Calculation complete | Calcul terminé |
| `hash.activationBlocked` | "{name}" cannot be activated: hashes are missing. | "{name}" ne peut pas être activé : les hashes sont manquants. |
| `hash.missingWarning` | Hashes not calculated yet. This mod may be compromised or corrupted. | Hashes non calculés. Ce mod peut être compromis ou corrompu. |
| `hash.modifiedWarning` | This mod has been modified since its last hash. It may be compromised. | Ce mod a été modifié depuis son dernier hash. Il peut être compromis. |
| `hash.statusOk` | Integrity verified ({date}) | Intégrité vérifiée ({date}) |
| `hash.statusMissing` | No hash — Unverified | Pas de hash — Non vérifié |
| `hash.deleteMod` | Delete mod | Supprimer le mod |
| `hash.redownloadMod` | Delete & Re-download | Supprimer & Re-télécharger |
| `hash.redownloadConfirm` | This will delete the mod files and re-download from the original URL. Continue? | Ceci supprimera les fichiers du mod et le re-téléchargera depuis l'URL originale. Continuer ? |

---

## Verification Plan

### Automated Build
```
npm run dev   # Compile TypeScript → JS
```

### Manual Verification

1. **Settings** : La section SHA s'affiche correctement dans les settings, le bouton ouvre la modal
2. **Modal** : Chaque profil affiche son % et date, les boutons recalculent avec progression visible
3. **Badge** : Un mod sans hash affiche le badge `?` dans la liste
4. **Garde-fou désactivé** : Un mod s'active normalement sans hash
5. **Garde-fou activé** : Activer un mod sans hash retourne un toast `HASH_REQUIRED` et le mod reste désactivé
6. **Mod Detail** : Les 3 boutons (recalcul, supprimer, re-télécharger) fonctionnent correctement
7. **Re-téléchargement** : Visible uniquement si `download_links` non vide
8. **i18n** : Pas de chaîne hardcodée, test EN/FR
