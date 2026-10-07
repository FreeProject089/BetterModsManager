//! Saved activation-order lists: build an order from ANY mods, keep it, use it anywhere.
//!
//! `mod_order.rs` reorders what is active; `order_share.rs` carries an order to another
//! machine. A list (models/order_list.rs) is the piece in between: a named order that may name
//! mods that are not active, or not installed here yet, kept in `AppData.order_lists`.
//!
//! ── What a list does ───────────────────────────────────────────────────────────────────────
//!
//!  * Plan (`order_list_plan`): each entry resolved against the library, strongest identity
//!    first (`order_share::resolve_entries`), with the match quality and the entry's state in a
//!    profile: active, installed but inactive, missing, ambiguous. Nothing is dropped: an entry
//!    that answers to nothing is listed as missing.
//!  * Apply the order (`order_list_apply`) to one or several profiles: in each, the ACTIVE mods
//!    the list names take its order in the slots they hold (`order_share::merge_order`), and
//!    only the files that change hands are re-copied (`mod_order::commit`). Nothing is enabled.
//!  * Activate (`order_list_activate`) on the active profile: every mod of the list that is
//!    not on is enabled — through `enable_mod`, the path a click takes, so dependencies,
//!    conflict checks, the SHA gate, the governor and the cancel flag all apply — then the
//!    list's mods are placed on top in the list's order (`arrange`, mode top). With `exclusive`,
//!    the active mods the list does not name (nor need, as dependencies) are disabled first,
//!    in one batch (`disable_mods_for_profiles`), so the profile ends up as the list.
//!
//! ── Trust ──────────────────────────────────────────────────────────────────────────────────
//!
//! The frontend sends whole lists; they are validated here (`sanitize`), never stored as
//! received: bounded sizes, no control characters, one entry per library mod, profile ids that
//! exist. An entry that names a library mod by its local id is rewritten from the library, so
//! the list keeps every identifier the mod has today. A shared document goes through the same
//! resolver with local ids UNtrusted, and its entries are saved under local identities only
//! when they resolved; the others keep the names they came with, without a foreign local id.
//!
//! ── Notes and sharing ──────────────────────────────────────────────────────────────────────
//!
//! A list's notes are B.MD source: line breaks are kept (they ARE the markup), other control
//! characters dropped, at most `MAX_NOTES` characters, refused rather than cut beyond that.
//! A list that came from elsewhere is flagged `imported` for good, and the frontend renders its
//! notes on the untrusted path.
//!
//! A list travels two ways. The one-line code (`order_share`'s, notes included) is for a chat
//! window, so it has a ceiling (`MAX_CODE`): past it the export offers no code and says so.
//! The `.bmmorder` file (`ListFile`) carries the whole list, notes included, whatever its size;
//! it is versioned and read strictly (`parse_file`): unknown fields, a newer version, oversized
//! or control-character fields and an empty list are refused, never trimmed into shape.

use crate::commands::mod_order;
use crate::commands::order_share::{self, LibMod, MatchKind, OrderEntry, PlaceMode, Resolution};
use crate::models::order_list::OrderList;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{State, Window};

pub const MAX_LISTS: usize = 500;
pub const MAX_ENTRIES: usize = 10_000;
const MAX_NAME: usize = 120;
pub const MAX_NOTES: usize = order_share::MAX_NOTES;
const MAX_ENTRY_NAME: usize = 300;
const MAX_FIELD: usize = 256;
/// The longest code the export hands out, in characters. A code is pasted into chats and forum
/// posts; past this it stops being "a line" and the file is the way to share.
pub const MAX_CODE: usize = 8_000;
/// The `.bmmorder` file: its format name and the newest version this build reads.
pub const FILE_FORMAT: &str = "bmm-order-list";
pub const FILE_VERSION: u32 = 1;
pub const FILE_EXT: &str = "bmmorder";
/// A list file larger than this is not a list (10 000 entries and full notes fit well inside).
pub const MAX_FILE: usize = 4 * 1024 * 1024;
const MAX_STAMP: usize = 64;

/// `s` without control characters, trimmed, at most `max` characters.
fn clean(s: &str, max: usize) -> String {
    let t: String = s.chars().filter(|c| !c.is_control()).collect();
    t.trim().chars().take(max).collect::<String>().trim().to_string()
}

/// Notes as they may be stored: B.MD source, so line breaks (`\r\n` and `\r` become `\n`) and
/// tabs stay; every other control character goes; blank lines around it are trimmed. Longer than
/// `MAX_NOTES` characters is refused, not cut: half a table is worse than an error.
///
/// The cause of "the notes show raw once saved": the old cleaner was the single-line one, which
/// dropped every `\n` as a control character, so a saved list came back as one long paragraph
/// of Markdown syntax.
pub fn clean_notes(s: &str) -> Result<String, String> {
    let t: String = s
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
        .collect();
    let t = t.trim_end().trim_start_matches(|c: char| c == '\n' || c == ' ' || c == '\t');
    if t.chars().count() > MAX_NOTES {
        return Err("orderList.errNotesTooLong".into());
    }
    Ok(t.to_string())
}

fn clean_opt(s: &Option<String>) -> Option<String> {
    s.as_deref().map(|v| clean(v, MAX_FIELD)).filter(|v| !v.is_empty())
}

/// One entry as it may be stored: bounded, and refreshed from the library when its local id
/// names a library mod. `None` for an entry that names nothing at all.
pub fn clean_entry(e: &OrderEntry, lib: &HashMap<&str, &LibMod>) -> Option<OrderEntry> {
    let id = clean_opt(&e.id);
    if let Some(m) = id.as_deref().and_then(|i| lib.get(i)) {
        return Some(m.entry());
    }
    let mut out = OrderEntry {
        name: clean(&e.name, MAX_ENTRY_NAME),
        version: clean(&e.version, MAX_FIELD),
        content_id: clean_opt(&e.content_id),
        repo_mod_id: clean_opt(&e.repo_mod_id),
        source_repo: clean_opt(&e.source_repo),
        id,
    };
    if out.name.is_empty() {
        // Nameless but identified: the identifier stands in for the name on screen.
        out.name = out.content_id.clone().or_else(|| out.repo_mod_id.clone()).or_else(|| out.id.clone())?;
    }
    Some(out)
}

/// The entries as they may be stored: cleaned, and one per library mod (the first wins: a
/// mod has one place in an order). Unresolved entries are all kept — they are what the screen
/// lists as missing.
pub fn clean_entries(entries: &[OrderEntry], lib: &[LibMod]) -> Result<Vec<OrderEntry>, String> {
    if entries.len() > MAX_ENTRIES {
        return Err("order.errTooLarge".into());
    }
    let by_id: HashMap<&str, &LibMod> = lib.iter().map(|m| (m.id.as_str(), m)).collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::with_capacity(entries.len());
    for e in entries {
        let Some(c) = clean_entry(e, &by_id) else { continue };
        if let Some(id) = c.id.as_deref().filter(|i| by_id.contains_key(i)) {
            if !seen.insert(id.to_string()) {
                continue;
            }
        }
        out.push(c);
    }
    Ok(out)
}

/// A list as it may be stored. `existing` is the stored list of the same id (its creation
/// date is kept); `profiles` the ids of the profiles that exist.
pub fn sanitize(
    input: &OrderList,
    existing: Option<&OrderList>,
    lib: &[LibMod],
    profiles: &[String],
    now: &str,
) -> Result<OrderList, String> {
    let name = clean(&input.name, MAX_NAME);
    if name.is_empty() {
        return Err("orderList.errName".into());
    }
    let known: HashSet<&String> = profiles.iter().collect();
    let mut seen = HashSet::new();
    let profile_ids = input
        .profile_ids
        .iter()
        .filter(|p| known.contains(p) && seen.insert((*p).clone()))
        .cloned()
        .collect();
    Ok(OrderList {
        id: existing.map(|l| l.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        name,
        description: clean_notes(&input.description)?,
        imported: input.imported || existing.map_or(false, |l| l.imported),
        game: clean_opt(&input.game),
        profile_ids,
        entries: clean_entries(&input.entries, lib)?,
        created_at: existing.map(|l| l.created_at.clone()).filter(|s| !s.is_empty()).unwrap_or_else(|| now.to_string()),
        updated_at: now.to_string(),
    })
}

/// Where an entry stands in a profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryState {
    Active,
    /// Installed, not active in this profile.
    Inactive,
    /// Not installed here, or ambiguous: nothing will be enabled for it.
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PlanRow {
    /// 1-based position in the list.
    pub index: usize,
    /// The name the entry carries.
    pub name: String,
    pub version: String,
    #[serde(flatten)]
    pub matched: Resolution,
    /// The library mod's name, when it differs (renamed since).
    pub mod_name: Option<String>,
    pub mod_version: Option<String>,
    pub state: EntryState,
    /// 1-based position in the profile's order (0 = not active).
    pub position: usize,
    /// The mod's folder is under the profile's mods folder.
    pub in_profile: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NamedMod {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ListPlan {
    pub profile_id: String,
    pub rows: Vec<PlanRow>,
    /// Installed and off: what "Activate" turns on, in the list's order.
    pub to_activate: Vec<NamedMod>,
    pub already_active: usize,
    pub missing: usize,
    pub ambiguous: usize,
    /// Active mods the list does not name, nor need as dependencies: what "Activate only this
    /// list" turns off.
    pub to_deactivate: Vec<NamedMod>,
    /// Active mods the list names, in the list's order: what "Apply order" places.
    pub placed: usize,
    /// The profile's order after "Apply order" (nothing enabled).
    pub order_after: Vec<String>,
    pub order_changed: bool,
    /// Files that change hands under `order_after` (filled in by the command).
    pub handovers: usize,
}

/// What resolution and the plan need to know about the library and one profile.
pub struct Library {
    pub mods: Vec<LibMod>,
    /// mod id → its declared dependencies.
    pub deps: HashMap<String, Vec<String>>,
    /// Mods whose folder lies under the profile's mods folder.
    pub in_profile: HashSet<String>,
}

/// `ids` and everything they depend on, transitively (a dependency cycle ends the walk).
pub fn with_dependencies(ids: &[String], deps: &HashMap<String, Vec<String>>) -> HashSet<String> {
    let mut out: HashSet<String> = HashSet::new();
    let mut stack: Vec<String> = ids.to_vec();
    while let Some(id) = stack.pop() {
        if !out.insert(id.clone()) {
            continue;
        }
        if let Some(d) = deps.get(&id) {
            stack.extend(d.iter().filter(|x| !out.contains(*x)).cloned());
        }
    }
    out
}

/// The whole plan of a list for a profile whose order is `current`, without touching anything.
pub fn plan(profile_id: &str, current: &[String], entries: &[OrderEntry], lib: &Library, trust_ids: bool) -> ListPlan {
    let by_id: HashMap<&str, &LibMod> = lib.mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let resolved = order_share::resolve_entries(entries, &lib.mods, trust_ids);
    let pos = |id: &str| current.iter().position(|x| x == id).map(|i| i + 1).unwrap_or(0);
    let mut rows = Vec::with_capacity(entries.len());
    let mut to_activate = Vec::new();
    let mut listed: Vec<String> = Vec::new();
    let (mut already, mut missing, mut ambiguous) = (0, 0, 0);
    for (i, (e, r)) in entries.iter().zip(resolved.into_iter()).enumerate() {
        let m = r.mod_id.as_deref().and_then(|id| by_id.get(id)).copied();
        let position = m.map(|m| pos(&m.id)).unwrap_or(0);
        let state = match m {
            None => EntryState::Missing,
            Some(_) if position > 0 => EntryState::Active,
            Some(_) => EntryState::Inactive,
        };
        match state {
            EntryState::Active => already += 1,
            EntryState::Inactive => to_activate.push(NamedMod { id: m.unwrap().id.clone(), name: m.unwrap().name.clone() }),
            EntryState::Missing if r.quality == MatchKind::Ambiguous => ambiguous += 1,
            EntryState::Missing => missing += 1,
        }
        if let Some(m) = m {
            listed.push(m.id.clone());
        }
        rows.push(PlanRow {
            index: i + 1,
            name: e.name.clone(),
            version: e.version.clone(),
            mod_name: m.map(|m| m.name.clone()).filter(|n| n != &e.name),
            mod_version: m.map(|m| m.version.clone()),
            in_profile: m.map_or(false, |m| lib.in_profile.contains(&m.id)),
            matched: r,
            state,
            position,
        });
    }
    let keep = with_dependencies(&listed, &lib.deps);
    let name_of = |id: &String| by_id.get(id.as_str()).map(|m| m.name.clone()).unwrap_or_else(|| id.clone());
    let to_deactivate = current
        .iter()
        .filter(|id| !keep.contains(*id))
        .map(|id| NamedMod { id: id.clone(), name: name_of(id) })
        .collect();
    let active: HashSet<&String> = current.iter().collect();
    let wanted: Vec<String> = listed.iter().filter(|id| active.contains(id)).cloned().collect();
    let order_after = order_share::merge_order(current, &wanted);
    ListPlan {
        profile_id: profile_id.to_string(),
        rows,
        to_activate,
        already_active: already,
        missing,
        ambiguous,
        to_deactivate,
        placed: wanted.len(),
        order_changed: order_after != current,
        order_after,
        handovers: 0,
    }
}

/// The order after an activation: the list's mods (those now active), on top in the list's
/// order. Dependencies the activation pulled in stay under them; everything else keeps its place.
pub fn order_after_activation(current: &[String], listed: &[String]) -> Vec<String> {
    order_share::arrange(current, listed, PlaceMode::Top)
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────

fn library_for(state: &State<'_, AppState>, profile_id: Option<&String>) -> Result<(String, Vec<String>, Library), String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let pid = profile_id.cloned().or_else(|| data.active_profile_id.clone());
    let prof = data
        .profiles
        .iter()
        .find(|p| Some(&p.id) == pid.as_ref())
        .ok_or_else(|| "order.errNoProfile".to_string())?;
    let mods_path = prof.mods_path.clone();
    let canon = mods_path.canonicalize().ok();
    let in_profile = data
        .mods
        .iter()
        .filter(|m| {
            m.mod_folder_path.starts_with(&mods_path)
                || match (&canon, m.mod_folder_path.canonicalize()) {
                    (Some(p), Ok(f)) => f.starts_with(p),
                    _ => false,
                }
        })
        .map(|m| m.id.clone())
        .collect();
    Ok((
        prof.id.clone(),
        prof.active_mods.clone(),
        Library {
            mods: data.mods.iter().map(LibMod::from_entry).collect(),
            deps: data.mods.iter().map(|m| (m.id.clone(), m.dependencies.clone())).collect(),
            in_profile,
        },
    ))
}

fn lib_mods(state: &State<'_, AppState>) -> Vec<LibMod> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    data.mods.iter().map(LibMod::from_entry).collect()
}

fn find_list(state: &State<'_, AppState>, id: &str) -> Result<OrderList, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    data.order_lists.iter().find(|l| l.id == id).cloned().ok_or_else(|| "orderList.errNotFound".to_string())
}

/// Every saved list, most recently changed first.
#[tauri::command]
pub fn order_list_all(state: State<'_, AppState>) -> Vec<OrderList> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let mut v = data.order_lists.clone();
    v.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    v
}

/// Create (empty id) or update a list. Answers the list as stored.
#[tauri::command]
pub fn order_list_save(state: State<'_, AppState>, list: OrderList) -> Result<OrderList, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let lib = lib_mods(&state);
    let saved = {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let profiles: Vec<String> = data.profiles.iter().map(|p| p.id.clone()).collect();
        let at = if list.id.is_empty() { None } else { data.order_lists.iter().position(|l| l.id == list.id) };
        if !list.id.is_empty() && at.is_none() {
            return Err("orderList.errNotFound".into());
        }
        if at.is_none() && data.order_lists.len() >= MAX_LISTS {
            return Err("orderList.errTooMany".into());
        }
        let clean = sanitize(&list, at.map(|i| &data.order_lists[i]), &lib, &profiles, &now)?;
        match at {
            Some(i) => data.order_lists[i] = clean.clone(),
            None => data.order_lists.push(clean.clone()),
        }
        clean
    };
    let _ = state.save();
    Ok(saved)
}

#[tauri::command]
pub fn order_list_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let before = data.order_lists.len();
        data.order_lists.retain(|l| l.id != id);
        if data.order_lists.len() == before {
            return Err("orderList.errNotFound".into());
        }
    }
    let _ = state.save();
    Ok(())
}

/// What a list (saved or a draft's entries) means for a profile (default: the active one).
/// Changes nothing.
#[tauri::command]
pub fn order_list_plan(state: State<'_, AppState>, entries: Vec<OrderEntry>, profile_id: Option<String>) -> Result<ListPlan, String> {
    let (pid, current, lib) = library_for(&state, profile_id.as_ref())?;
    if entries.len() > MAX_ENTRIES {
        return Err("order.errTooLarge".into());
    }
    // Row i answers entry i of the draft, so nothing is merged or dropped here (saving does
    // that): a duplicate shows as not found, which is what the save will remove.
    let by_id: HashMap<&str, &LibMod> = lib.mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let entries: Vec<OrderEntry> = entries.iter().map(|e| clean_entry(e, &by_id).unwrap_or_else(|| e.clone())).collect();
    let mut p = plan(&pid, &current, &entries, &lib, true);
    if p.order_changed {
        let index = mod_order::index_for(&state, &current)?;
        p.handovers = mod_order::handovers(&index, &current, &p.order_after).len();
    }
    Ok(p)
}

/// A shared order read as a NEW list (not saved): the entries the library resolved are named
/// by their local identities, the others keep what they came with. `matches` is how each
/// entry was found, local ids untrusted — the import preview shows it.
#[derive(Debug, Serialize)]
pub struct ImportedList {
    pub name: Option<String>,
    pub game: Option<String>,
    /// The notes it came with (empty when none), cleaned like a saved list's.
    pub notes: String,
    pub entries: Vec<OrderEntry>,
    pub matches: Vec<Resolution>,
}

pub fn imported(doc: &order_share::OrderDoc, lib: &[LibMod]) -> ImportedList {
    let by_id: HashMap<&str, &LibMod> = lib.iter().map(|m| (m.id.as_str(), m)).collect();
    let matches = order_share::resolve_entries(&doc.mods, lib, false);
    let entries = doc
        .mods
        .iter()
        .zip(matches.iter())
        .map(|(e, r)| match r.mod_id.as_deref().and_then(|id| by_id.get(id)) {
            Some(m) => m.entry(),
            // A local id from another machine names nothing here, and could name something
            // else tomorrow: it is not kept.
            None => OrderEntry { id: None, ..e.clone() },
        })
        .collect();
    // Every import path has already refused notes over the cap; cleaning cannot fail here.
    let notes = doc.notes.as_deref().map(clean_notes).and_then(Result::ok).unwrap_or_default();
    ImportedList {
        name: doc.name.as_deref().map(|n| clean(n, MAX_NAME)).filter(|n| !n.is_empty()),
        game: clean_opt(&doc.game),
        notes,
        entries,
        matches,
    }
}

// ── The .bmmorder file ─────────────────────────────────────────────────────────────────────

/// One entry of a list file. Same fields as `OrderEntry`, read strictly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct FileEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_mod_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_repo: Option<String>,
    /// The writer's local id: a hint for a round trip on the same machine, never trusted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// A whole list as a file: what the code cannot carry when it is long, notes included. No
/// profile ids (they name profiles of the machine that wrote it) and no list id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ListFile {
    pub format: String,
    pub version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub created_at: String,
    pub entries: Vec<FileEntry>,
}

/// The list as a `.bmmorder` file (pretty JSON).
pub fn write_file(list: &OrderList, now: &str) -> String {
    let f = ListFile {
        format: FILE_FORMAT.into(),
        version: FILE_VERSION,
        name: list.name.clone(),
        game: list.game.clone(),
        notes: list.description.clone(),
        created_at: now.to_string(),
        entries: list
            .entries
            .iter()
            .map(|e| FileEntry {
                name: e.name.clone(),
                version: e.version.clone(),
                content_id: e.content_id.clone(),
                repo_mod_id: e.repo_mod_id.clone(),
                source_repo: e.source_repo.clone(),
                id: e.id.clone(),
            })
            .collect(),
    };
    serde_json::to_string_pretty(&f).unwrap_or_default()
}

/// A single-line field of a file: no control character, at most `max` characters.
fn field_ok(s: &str, max: usize) -> bool {
    !s.chars().any(char::is_control) && s.chars().count() <= max
}

fn opt_ok(s: &Option<String>, max: usize) -> bool {
    s.as_deref().map_or(true, |v| field_ok(v, max))
}

/// Read a `.bmmorder` file, strictly. Refused (never trimmed into shape): larger than
/// `MAX_FILE`, not this format, a version this build does not know, an unknown field, a field
/// over its size or holding a control character (notes may hold line breaks and tabs), notes
/// over `MAX_NOTES`, no entry, too many, or an entry that names nothing.
pub fn parse_file(text: &str) -> Result<order_share::OrderDoc, String> {
    if text.len() > MAX_FILE {
        return Err("order.errTooLarge".into());
    }
    let t = text.trim_start_matches('\u{feff}').trim();
    let v: serde_json::Value = serde_json::from_str(t).map_err(|_| "orderList.errFile".to_string())?;
    if v.get("format").and_then(|f| f.as_str()) != Some(FILE_FORMAT) {
        return Err("orderList.errFile".into());
    }
    // The version before the shape: a newer file may carry fields this build refuses, and
    // "made by a newer BMM" is the message that tells the reader what to do.
    match v.get("version").and_then(|x| x.as_u64()) {
        Some(n) if n >= 1 && n <= FILE_VERSION as u64 => {}
        Some(_) => return Err("order.errVersion".into()),
        None => return Err("orderList.errFile".into()),
    }
    let f: ListFile = serde_json::from_value(v).map_err(|_| "orderList.errFile".to_string())?;
    let name = f.name.trim();
    if name.is_empty() || !field_ok(name, MAX_NAME) || !opt_ok(&f.game, MAX_FIELD) || !field_ok(&f.created_at, MAX_STAMP) {
        return Err("orderList.errFile".into());
    }
    if f.notes.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t') {
        return Err("orderList.errFile".into());
    }
    if f.notes.chars().count() > MAX_NOTES {
        return Err("orderList.errNotesTooLong".into());
    }
    if f.entries.is_empty() {
        return Err("order.errEmpty".into());
    }
    if f.entries.len() > MAX_ENTRIES {
        return Err("order.errTooLarge".into());
    }
    let mut mods = Vec::with_capacity(f.entries.len());
    for e in f.entries {
        let some = |o: &Option<String>| o.as_deref().map_or(false, |x| !x.trim().is_empty());
        let named = !e.name.trim().is_empty() || some(&e.content_id) || some(&e.repo_mod_id);
        let sized = field_ok(&e.name, MAX_ENTRY_NAME)
            && field_ok(&e.version, MAX_FIELD)
            && [&e.content_id, &e.repo_mod_id, &e.source_repo, &e.id].iter().all(|o| opt_ok(o, MAX_FIELD));
        if !named || !sized {
            return Err("orderList.errFile".into());
        }
        mods.push(OrderEntry {
            name: e.name,
            version: e.version,
            content_id: e.content_id,
            repo_mod_id: e.repo_mod_id,
            source_repo: e.source_repo,
            id: e.id,
        });
    }
    Ok(order_share::OrderDoc {
        format: order_share::FORMAT.into(),
        version: order_share::DOC_VERSION,
        name: Some(name.to_string()),
        game: f.game,
        created_at: f.created_at,
        notes: Some(f.notes).filter(|n| !n.trim().is_empty()),
        mods,
    })
}

/// Anything the import box may receive: a list file (read strictly), or whatever
/// `order_share::parse_text` reads (a code, a link, an order's JSON, a list of names).
pub fn parse_any(text: &str) -> Result<order_share::OrderDoc, String> {
    let t = text.trim_start_matches('\u{feff}').trim_start();
    if t.starts_with('{') && text.len() <= MAX_FILE {
        let is_file = serde_json::from_str::<serde_json::Value>(t)
            .ok()
            .and_then(|v| v.get("format").and_then(|f| f.as_str()).map(|f| f == FILE_FORMAT))
            .unwrap_or(false);
        if is_file {
            return parse_file(text);
        }
    }
    order_share::parse_text(text)
}

#[tauri::command]
pub fn order_list_parse(state: State<'_, AppState>, text: String) -> Result<ImportedList, String> {
    let doc = parse_any(&text)?;
    Ok(imported(&doc, &lib_mods(&state)))
}

/// What sharing a list offers: the code when it is short enough, plain text, and the file.
#[derive(Debug, Serialize)]
pub struct ListExport {
    /// The one-line code (notes included), or None when it would be longer than `code_max`.
    pub code: Option<String>,
    /// How long the code is (or would be), in characters.
    pub code_len: usize,
    pub code_max: usize,
    /// One mod name per line: what a person reads.
    pub text: String,
    /// The `.bmmorder` file, the whole list.
    pub file: String,
    pub file_name: String,
    pub notes_len: usize,
}

/// A file name made of the list's name: letters, digits, `-` and `_`, never empty.
pub fn file_name_for(name: &str) -> String {
    let dashed: String = name.chars().map(|c| if c.is_alphanumeric() || c == '_' { c } else { '-' }).collect();
    let mut base = dashed.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    base = base.chars().take(60).collect::<String>().trim_end_matches('-').to_string();
    if base.is_empty() {
        base = "order-list".into();
    }
    format!("{}.{}", base, FILE_EXT)
}

pub fn export_list(list: &OrderList, now: &str) -> ListExport {
    let doc = order_share::OrderDoc {
        format: order_share::FORMAT.into(),
        version: order_share::DOC_VERSION,
        name: Some(list.name.clone()),
        game: list.game.clone(),
        created_at: now.to_string(),
        notes: Some(list.description.clone()).filter(|n| !n.trim().is_empty()),
        mods: list.entries.clone(),
    };
    let code = order_share::encode_code(&doc);
    let code_len = code.chars().count();
    ListExport {
        code: if code_len <= MAX_CODE { Some(code) } else { None },
        code_len,
        code_max: MAX_CODE,
        text: order_share::encode_text(&doc),
        file: write_file(list, now),
        file_name: file_name_for(&list.name),
        notes_len: list.description.chars().count(),
    }
}

/// A saved list, to share: the code (when short enough), plain text and the `.bmmorder` file.
#[tauri::command]
pub fn order_list_export(state: State<'_, AppState>, id: String) -> Result<ListExport, String> {
    let list = find_list(&state, &id)?;
    Ok(export_list(&list, &chrono::Utc::now().to_rfc3339()))
}

#[derive(Debug, Serialize)]
pub struct ApplyOutcome {
    pub profile_id: String,
    pub profile_name: String,
    /// Active mods the list placed.
    pub placed: usize,
    /// Files that changed hands.
    pub moved: usize,
    pub error: Option<String>,
}

/// Give a list's order to the active mods of each profile in `profile_ids`. Nothing is enabled
/// or disabled; each profile is its own commit, so one failing does not stop the others.
#[tauri::command]
pub async fn order_list_apply(state: State<'_, AppState>, id: String, profile_ids: Vec<String>) -> Result<Vec<ApplyOutcome>, String> {
    let list = find_list(&state, &id)?;
    let mut seen = HashSet::new();
    let targets: Vec<String> = profile_ids.into_iter().filter(|p| seen.insert(p.clone())).collect();
    if targets.is_empty() {
        return Err("orderList.errNoProfile".into());
    }
    let mut out = Vec::new();
    for pid in targets {
        let name = {
            let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
            data.profiles.iter().find(|p| p.id == pid).map(|p| p.name.clone())
        };
        let Some(profile_name) = name else {
            out.push(ApplyOutcome { profile_id: pid, profile_name: String::new(), placed: 0, moved: 0, error: Some("order.errNoProfile".into()) });
            continue;
        };
        let res: Result<(usize, usize), String> = async {
            let (_, current, lib) = library_for(&state, Some(&pid))?;
            let p = plan(&pid, &current, &list.entries, &lib, true);
            if !p.order_changed {
                return Ok((p.placed, 0));
            }
            let snap = mod_order::snapshot(&state, Some(pid.clone()))?;
            let moved = mod_order::commit(&state, snap, p.order_after, false).await?;
            Ok((p.placed, moved))
        }
        .await;
        out.push(match res {
            Ok((placed, moved)) => ApplyOutcome { profile_id: pid, profile_name, placed, moved, error: None },
            Err(e) => ApplyOutcome { profile_id: pid, profile_name, placed: 0, moved: 0, error: Some(e) },
        });
    }
    Ok(out)
}

#[derive(Debug, Default, Serialize)]
pub struct Failed {
    pub id: String,
    pub name: String,
    pub error: String,
}

#[derive(Debug, Default, Serialize)]
pub struct ActivateReport {
    pub enabled: usize,
    pub already_active: usize,
    pub missing: usize,
    pub disabled: usize,
    pub failed: Vec<Failed>,
    /// Files that changed hands when the list's order was placed.
    pub moved: usize,
    pub cancelled: bool,
}

/// Turn on every installed mod of a list on the ACTIVE profile and give them the list's order.
/// `exclusive`: first turn off the active mods the list neither names nor needs.
///
/// `enable_mod` acts on the active profile, which is why this one does too: `profile_id`, when
/// given, must be it.
///
/// `cancel_scope`: the batch's own cancel token (the frontend's activation job id). The enables
/// run inside it, so `cancel_mod_ops(scope)` stops this batch and nothing else, and no other
/// batch's clear can lower this one's Stop. Without it, the legacy global flag (reset here).
#[tauri::command]
pub async fn order_list_activate(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    exclusive: bool,
    profile_id: Option<String>,
    bypass_sha: Option<bool>,
    cancel_scope: Option<String>,
) -> Result<ActivateReport, String> {
    match cancel_scope {
        Some(sc) => {
            if !crate::fs_utils::valid_scope_id(&sc) {
                return Err("invalid cancel scope".into());
            }
            crate::fs_utils::in_cancel_scope(Some(&sc), activate_in(window, state, id, exclusive, profile_id, bypass_sha)).await
        }
        None => {
            crate::fs_utils::reset_mod_op_cancel();
            activate_in(window, state, id, exclusive, profile_id, bypass_sha).await
        }
    }
}

/// The batch, inside whatever cancel scope is current. One plan, the enables in list order
/// (dependencies resolved by `enable_mod`), then ONE order commit for everything that is on.
async fn activate_in(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    exclusive: bool,
    profile_id: Option<String>,
    bypass_sha: Option<bool>,
) -> Result<ActivateReport, String> {
    let list = find_list(&state, &id)?;
    let active_pid = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.active_profile_id.clone().ok_or_else(|| "order.errNoProfile".to_string())?
    };
    if profile_id.as_ref().map_or(false, |p| p != &active_pid) {
        return Err("orderList.errNotActive".into());
    }
    let (pid, current, lib) = library_for(&state, Some(&active_pid))?;
    let p = plan(&pid, &current, &list.entries, &lib, true);
    let mut rep = ActivateReport {
        already_active: p.already_active,
        missing: p.missing + p.ambiguous,
        ..Default::default()
    };
    crate::commands::crash::log_line(format!(
        "[ORDER] activate list '{}': {} to enable, {} already on, {} missing, exclusive={}",
        list.name, p.to_activate.len(), p.already_active, rep.missing, exclusive
    ));

    if exclusive && !p.to_deactivate.is_empty() {
        let ids: Vec<String> = p.to_deactivate.iter().map(|m| m.id.clone()).collect();
        crate::commands::mods::disable_mods_for_profiles(window.clone(), state.clone(), vec![pid.clone()], Some(ids.clone())).await?;
        rep.disabled = ids.len();
    }

    for m in &p.to_activate {
        if crate::fs_utils::is_mod_op_cancelled() {
            rep.cancelled = true;
            break;
        }
        // A dependency of an earlier entry may already have turned this one on.
        let on = {
            let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
            data.profiles.iter().find(|x| x.id == pid).map_or(false, |x| x.active_mods.contains(&m.id))
        };
        if on {
            rep.enabled += 1;
            continue;
        }
        match crate::commands::mods::enable_mod_in(window.clone(), state.clone(), m.id.clone(), bypass_sha).await {
            Ok(_) => rep.enabled += 1,
            Err(e) => rep.failed.push(Failed { id: m.id.clone(), name: m.name.clone(), error: e }),
        }
    }
    if crate::fs_utils::is_mod_op_cancelled() {
        rep.cancelled = true;
    }

    // The list's order, for the mods that are on now. Done even after a cancel: what did turn
    // on is placed where the list says, and the files that change hands are the only ones copied.
    let listed: Vec<String> = p.rows.iter().filter_map(|r| r.matched.mod_id.clone()).collect();
    let snap = mod_order::snapshot(&state, Some(pid.clone()))?;
    let after = order_after_activation(&snap.order, &listed);
    if after != snap.order {
        rep.moved = mod_order::commit(&state, snap, after, false).await?;
    }
    Ok(rep)
}

#[cfg(test)]
#[path = "order_lists_tests.rs"]
mod tests;
