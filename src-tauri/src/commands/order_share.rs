//! The activation order, shared and applied in bulk.
//!
//! `mod_order.rs` holds the rule (last wins) and the one way to change it on disk (`commit`:
//! save the order, re-copy only the files that change hands). This file holds the two things
//! built on it:
//!
//! ── 1. One engine for bulk enables ─────────────────────────────────────────────────────────
//!
//! Every place that enables several mods at once (a modpack, "Enable all", a `.mm` list, a
//! scheduled task, a BMMScript) ends with the same question: where do those mods go in the
//! order? `arrange` answers it with a MODE, and every caller goes through it:
//!
//!   * `top`    the block goes on top, in its own order: it wins what it shares. A modpack
//!              "as it was built".
//!   * `bottom` the block goes under everything already active: the mods you had keep winning.
//!   * `keep`   nothing moves: mods already active keep their place, newly enabled ones sit on
//!              top in the order they were enabled (what enabling has always done).
//!
//! The BLOCK is the caller's business: a modpack passes all of its mods (in the pack's order),
//! "Enable all" and a mod list pass only the mods they newly enabled, so a careful order is
//! never reshuffled by a button that only meant "turn the rest on". When no mode is given, the
//! setting `order_bulk_mode` decides (default `top`, the behaviour modpacks always had).
//!
//! ── 2. A portable order ────────────────────────────────────────────────────────────────────
//!
//! A mod id is what THIS machine calls a mod. Shared, an order names mods by what survives the
//! trip: `content_id` (a fingerprint of the mod), the repo's own id, and the name, then the
//! local id for a round trip on the same machine. `OrderDoc` is that document; it travels as
//! JSON, as a one-line code (`BMMORDER1.` + base64url JSON), as a `bmm://order?d=` link, or
//! as plain text, one mod name per line — what a person pastes from a forum post.
//!
//! Importing never replaces the active set: it reorders the mods of the document that are
//! active, in the slots they already hold (`merge_order`), so a mod the document does not
//! know keeps exactly its place. The preview says what matched, what is missing, what is
//! installed but not active, what is extra, and where each mod lands.

use crate::commands::mod_order;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;

// ── Placement modes ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaceMode {
    Top,
    Bottom,
    Keep,
}

impl PlaceMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "top" => Some(Self::Top),
            "bottom" => Some(Self::Bottom),
            "keep" => Some(Self::Keep),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Bottom => "bottom",
            Self::Keep => "keep",
        }
    }
}

/// The mode a caller asked for, or the setting's, or `top`. Unknown words fall back too:
/// a script or a task written by a newer BMM must still run.
pub fn resolve_mode(asked: Option<&str>, setting: &str) -> PlaceMode {
    asked
        .and_then(|s| if s.eq_ignore_ascii_case("default") { None } else { PlaceMode::parse(s) })
        .or_else(|| PlaceMode::parse(setting))
        .unwrap_or(PlaceMode::Top)
}

/// Where `block` goes in `order` under `mode`. Ids of the block that are not active are
/// ignored; the result is always a permutation of `order`.
pub fn arrange(order: &[String], block: &[String], mode: PlaceMode) -> Vec<String> {
    match mode {
        PlaceMode::Top => mod_order::place_block(order, block, None),
        PlaceMode::Bottom => mod_order::place_block(order, block, Some(0)),
        PlaceMode::Keep => order.to_vec(),
    }
}

// ── The portable document ───────────────────────────────────────────────────────────────────

pub const FORMAT: &str = "bmm-order";
pub const CODE_PREFIX: &str = "BMMORDER1.";
/// A pasted order larger than this is not an order.
const MAX_TEXT: usize = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct OrderEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub version: String,
    /// Fingerprint of the mod (bmm.json or folder content): the same mod on another machine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    /// The id the mod has in the repo it came from, which survives version bumps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_mod_id: Option<String>,
    /// That repo, so two repos that both call a mod `core` are not mistaken for each other.
    /// Absent from documents written before saved lists; the repo id alone still matches then.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_repo: Option<String>,
    /// The local BMM id: only meaningful on the machine that wrote the document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OrderDoc {
    #[serde(default = "format_name")]
    pub format: String,
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub created_at: String,
    /// First applied first; the last one wins a shared file.
    pub mods: Vec<OrderEntry>,
}

fn format_name() -> String { FORMAT.to_string() }
fn one() -> u32 { 1 }

/// What resolution needs to know about a library mod.
#[derive(Debug, Clone, Default)]
pub struct LibMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub content_id: Option<String>,
    pub repo_mod_id: Option<String>,
    pub source_repo: Option<String>,
}

impl LibMod {
    pub fn from_entry(m: &crate::models::mod_entry::ModEntry) -> Self {
        LibMod {
            id: m.id.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            content_id: m.content_id.clone(),
            repo_mod_id: m.repo_mod_id.clone(),
            source_repo: m.source_repo.clone(),
        }
    }

    /// The entry that names this mod by everything that identifies it.
    pub fn entry(&self) -> OrderEntry {
        OrderEntry {
            name: self.name.clone(),
            version: self.version.clone(),
            content_id: self.content_id.clone().filter(|s| !s.is_empty()),
            repo_mod_id: self.repo_mod_id.clone().filter(|s| !s.is_empty()),
            source_repo: self.source_repo.clone().filter(|s| !s.is_empty()),
            id: Some(self.id.clone()),
        }
    }
}

/// The document for `order` (ids), described by what survives another machine.
pub fn build_doc(order: &[String], lib: &[LibMod], name: Option<String>, game: Option<String>) -> OrderDoc {
    let by_id: HashMap<&str, &LibMod> = lib.iter().map(|m| (m.id.as_str(), m)).collect();
    OrderDoc {
        format: FORMAT.into(),
        version: 1,
        name,
        game,
        created_at: chrono::Utc::now().to_rfc3339(),
        mods: order
            .iter()
            .map(|id| match by_id.get(id.as_str()) {
                Some(m) => m.entry(),
                None => OrderEntry { name: id.clone(), id: Some(id.clone()), ..Default::default() },
            })
            .collect(),
    }
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// `BMMORDER1.<base64url JSON>`: one line, survives a chat window.
pub fn encode_code(doc: &OrderDoc) -> String {
    use base64::Engine;
    let json = serde_json::to_vec(doc).unwrap_or_default();
    format!("{}{}", CODE_PREFIX, b64().encode(json))
}

pub fn encode_link(doc: &OrderDoc) -> String {
    format!("bmm://order?d={}", encode_code(doc))
}

/// One mod name per line, numbered: what a person reads, and what `parse_text` reads back.
pub fn encode_text(doc: &OrderDoc) -> String {
    let mut s = String::new();
    s.push_str("# BMM activation order");
    if let Some(n) = &doc.name {
        s.push_str(": ");
        s.push_str(n);
    }
    s.push_str("\n# First applied first, the last one wins a shared file.\n");
    for (i, m) in doc.mods.iter().enumerate() {
        s.push_str(&format!("{}. {}\n", i + 1, m.name));
    }
    s
}

fn decode_code(code: &str) -> Result<OrderDoc, String> {
    use base64::Engine;
    let body: String = code.trim().chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = b64()
        .decode(body.trim_end_matches('='))
        .map_err(|_| "order.errParse".to_string())?;
    let doc: OrderDoc = serde_json::from_slice(&bytes).map_err(|_| "order.errParse".to_string())?;
    Ok(doc)
}

/// "12. Name", "12) Name", "- Name", "* Name" or "Name" → "Name".
fn strip_bullet(line: &str) -> &str {
    let l = line.trim();
    let digits = l.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 {
        let rest = &l[digits..];
        if let Some(r) = rest.strip_prefix('.').or_else(|| rest.strip_prefix(')')) {
            return r.trim();
        }
    }
    for b in ["- ", "* ", "• "] {
        if let Some(r) = l.strip_prefix(b) {
            return r.trim();
        }
    }
    l
}

/// Read an order from anything a person may paste: a link, a code, JSON, or a list of names.
pub fn parse_text(text: &str) -> Result<OrderDoc, String> {
    if text.len() > MAX_TEXT {
        return Err("order.errTooLarge".into());
    }
    let t = text.trim().trim_start_matches('\u{feff}');
    if t.is_empty() {
        return Err("order.errEmpty".into());
    }
    let doc = if let Some(rest) = t.strip_prefix("bmm://order") {
        let q = rest.trim_start_matches('/').trim_start_matches('?');
        let d = q
            .split('&')
            .find_map(|kv| kv.strip_prefix("d="))
            .ok_or_else(|| "order.errParse".to_string())?;
        let d = percent_encoding::percent_decode_str(d).decode_utf8_lossy().to_string();
        decode_code(d.strip_prefix(CODE_PREFIX).unwrap_or(&d))?
    } else if let Some(code) = t.strip_prefix(CODE_PREFIX) {
        decode_code(code)?
    } else if t.starts_with('{') {
        let v: serde_json::Value = serde_json::from_str(t).map_err(|_| "order.errParse".to_string())?;
        // A .mm list or a modpack pasted whole carries its order under `load_order`.
        let v = v.get("load_order").cloned().filter(|x| x.is_object()).unwrap_or(v);
        serde_json::from_value(v).map_err(|_| "order.errParse".to_string())?
    } else {
        let mods: Vec<OrderEntry> = t
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(strip_bullet)
            .filter(|l| !l.is_empty())
            .map(|n| OrderEntry { name: n.to_string(), ..Default::default() })
            .collect();
        OrderDoc { format: FORMAT.into(), version: 1, name: None, game: None, created_at: String::new(), mods }
    };
    if doc.format != FORMAT {
        return Err("order.errParse".into());
    }
    if doc.mods.is_empty() {
        return Err("order.errEmpty".into());
    }
    if doc.mods.len() > MAX_ENTRIES {
        return Err("order.errTooLarge".into());
    }
    Ok(doc)
}

/// How an entry found its library mod, strongest first. The screen shows it: a match by name
/// is a guess worth a glance, a match by fingerprint is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    /// The local BMM id (a list saved on this machine, or a round trip).
    Id,
    /// The content fingerprint: the same mod, whatever it is called here.
    Content,
    /// The id the mod has in the repo it came from (and that repo, when both sides know it).
    Source,
    /// The name, with the version deciding between mods that share it, or agreeing.
    NameVersion,
    /// The name alone (case, spaces, `_` and `-` ignored).
    Name,
    /// Several library mods carry that name and nothing decides: nobody is guessed.
    Ambiguous,
    /// Nothing in the library answers to it.
    Missing,
}

/// One entry, resolved.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Resolution {
    pub mod_id: Option<String>,
    pub quality: MatchKind,
    /// Library mods that carried the name when the name was asked (2+ when ambiguous).
    pub candidates: usize,
    /// Found by name while the entry names another version.
    pub version_differs: bool,
}

/// A name as people mistype it: case, spaces, `_` and `-` do not count.
pub fn norm_name(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn some_str(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn same_repo(a: &str, b: &str) -> bool {
    a.trim_end_matches('/').eq_ignore_ascii_case(b.trim_end_matches('/'))
}

/// Each entry → a library mod, with how it was found. The strongest identity wins, pass by
/// pass over ALL entries, so a fingerprint claims its mod before a name could: local id, then
/// content fingerprint, then repo id (same repo first), then the name, where the version
/// decides between namesakes or nobody is guessed. A library mod answers for one entry at most.
///
/// `trust_ids`: a list saved on THIS machine names mods by their local id, which survives a
/// rename. A document from elsewhere does not: there, a local id counts only alongside the same
/// name, so an id that happens to exist here never pulls an unrelated mod in.
pub fn resolve_entries(entries: &[OrderEntry], lib: &[LibMod], trust_ids: bool) -> Vec<Resolution> {
    let mut used: HashSet<String> = HashSet::new();
    let missing = Resolution { mod_id: None, quality: MatchKind::Missing, candidates: 0, version_differs: false };
    let mut out: Vec<Resolution> = vec![missing; entries.len()];
    let mut by_name: HashMap<String, Vec<&LibMod>> = HashMap::new();
    for m in lib {
        by_name.entry(norm_name(&m.name)).or_default().push(m);
    }
    let by_id = |e: &OrderEntry, m: &LibMod| {
        some_str(&e.id) == Some(m.id.as_str()) && (trust_ids || norm_name(&e.name) == norm_name(&m.name))
    };
    let by_content = |e: &OrderEntry, m: &LibMod| some_str(&e.content_id).map_or(false, |c| some_str(&m.content_id) == Some(c));
    let by_repo_strict = |e: &OrderEntry, m: &LibMod| {
        some_str(&e.repo_mod_id).map_or(false, |r| some_str(&m.repo_mod_id) == Some(r))
            && matches!((some_str(&e.source_repo), some_str(&m.source_repo)), (Some(a), Some(b)) if same_repo(a, b))
    };
    // The repo id alone, when one side does not know the repo. Two repos naming different
    // mods alike are told apart by the strict pass first, and never matched across here.
    let by_repo_loose = |e: &OrderEntry, m: &LibMod| {
        some_str(&e.repo_mod_id).map_or(false, |r| some_str(&m.repo_mod_id) == Some(r))
            && !matches!((some_str(&e.source_repo), some_str(&m.source_repo)), (Some(a), Some(b)) if !same_repo(a, b))
    };
    let passes: [(&dyn Fn(&OrderEntry, &LibMod) -> bool, MatchKind); 4] = [
        (&by_id, MatchKind::Id),
        (&by_content, MatchKind::Content),
        (&by_repo_strict, MatchKind::Source),
        (&by_repo_loose, MatchKind::Source),
    ];
    for (pass, kind) in passes.iter() {
        for (i, e) in entries.iter().enumerate() {
            if out[i].mod_id.is_some() {
                continue;
            }
            if let Some(m) = lib.iter().find(|m| !used.contains(&m.id) && pass(e, m)) {
                used.insert(m.id.clone());
                out[i] = Resolution { mod_id: Some(m.id.clone()), quality: *kind, candidates: 1, version_differs: false };
            }
        }
    }
    for (i, e) in entries.iter().enumerate() {
        if out[i].mod_id.is_some() {
            continue;
        }
        let cands: Vec<&LibMod> = by_name
            .get(&norm_name(&e.name))
            .map(|v| v.iter().copied().filter(|m| !used.contains(&m.id)).collect())
            .unwrap_or_default();
        let v = e.version.trim();
        let same_version: Vec<&LibMod> = cands.iter().copied().filter(|m| !v.is_empty() && m.version.trim() == v).collect();
        // Same name twice (two versions side by side): the version decides, or nobody does.
        let (pick, kind) = match (cands.len(), same_version.len()) {
            (0, _) => (None, MatchKind::Missing),
            (_, 1) => (Some(same_version[0]), MatchKind::NameVersion),
            (1, _) => (Some(cands[0]), MatchKind::Name),
            _ => (None, MatchKind::Ambiguous),
        };
        out[i].candidates = cands.len();
        out[i].quality = kind;
        if let Some(m) = pick {
            used.insert(m.id.clone());
            out[i].mod_id = Some(m.id.clone());
            out[i].version_differs = !v.is_empty() && m.version.trim() != v;
        }
    }
    out
}

/// Each entry of the document → a library mod, or None, as a document from elsewhere
/// (`resolve_entries` with the local ids untrusted).
pub fn resolve(doc: &OrderDoc, lib: &[LibMod]) -> Vec<Option<String>> {
    resolve_entries(&doc.mods, lib, false).into_iter().map(|r| r.mod_id).collect()
}

/// `current` with the mods of `wanted` rearranged into `wanted`'s order, in the slots they
/// already hold. Everything else stays exactly where it is. Ids of `wanted` that are not in
/// `current` are ignored. Always a permutation of `current`.
pub fn merge_order(current: &[String], wanted: &[String]) -> Vec<String> {
    let present: HashSet<&String> = current.iter().collect();
    let mut seen = HashSet::new();
    let mut queue = wanted
        .iter()
        .filter(|id| present.contains(id) && seen.insert((*id).clone()))
        .cloned()
        .collect::<Vec<_>>()
        .into_iter();
    let inside: HashSet<String> = seen;
    current
        .iter()
        .map(|id| if inside.contains(id) { queue.next().unwrap_or_else(|| id.clone()) } else { id.clone() })
        .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PreviewRow {
    pub id: String,
    pub name: String,
    /// 1-based position now (0 = not active).
    pub from: usize,
    /// 1-based position after the import (0 = not active).
    pub to: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ImportPlan {
    pub name: Option<String>,
    pub game: Option<String>,
    /// Entries in the document.
    pub total: usize,
    /// Active mods the document places, in the document's order.
    pub matched: Vec<PreviewRow>,
    /// Installed, not active: the import does not enable them.
    pub inactive: Vec<PreviewRow>,
    /// Names the library does not have.
    pub missing: Vec<String>,
    /// Active mods the document does not know: they keep their slot.
    pub extra: Vec<PreviewRow>,
    /// The order after the import.
    pub result: Vec<String>,
    pub changed: bool,
    /// Files that would change hands (filled in by the command, which has the file index).
    pub handovers: usize,
}

/// The whole import, without touching anything.
pub fn plan_import(current: &[String], doc: &OrderDoc, lib: &[LibMod]) -> ImportPlan {
    let names: HashMap<&str, &str> = lib.iter().map(|m| (m.id.as_str(), m.name.as_str())).collect();
    let name_of = |id: &str| names.get(id).map(|s| s.to_string()).unwrap_or_else(|| id.to_string());
    let resolved = resolve(doc, lib);
    let active: HashSet<&String> = current.iter().collect();
    let mut wanted = Vec::new();
    let mut inactive = Vec::new();
    let mut missing = Vec::new();
    for (e, r) in doc.mods.iter().zip(resolved.iter()) {
        match r {
            Some(id) if active.contains(id) => wanted.push(id.clone()),
            Some(id) => inactive.push(PreviewRow { id: id.clone(), name: name_of(id), from: 0, to: 0 }),
            None => missing.push(e.name.clone()),
        }
    }
    let result = merge_order(current, &wanted);
    let pos = |o: &[String], id: &str| o.iter().position(|x| x == id).map(|i| i + 1).unwrap_or(0);
    let wanted_set: HashSet<&String> = wanted.iter().collect();
    let matched = wanted
        .iter()
        .map(|id| PreviewRow { id: id.clone(), name: name_of(id), from: pos(current, id), to: pos(&result, id) })
        .collect();
    let extra = current
        .iter()
        .filter(|id| !wanted_set.contains(id))
        .map(|id| PreviewRow { id: id.clone(), name: name_of(id), from: pos(current, id), to: pos(&result, id) })
        .collect();
    ImportPlan {
        name: doc.name.clone(),
        game: doc.game.clone(),
        total: doc.mods.len(),
        matched,
        inactive,
        missing,
        extra,
        changed: result != current,
        result,
        handovers: 0,
    }
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────

fn library(state: &State<'_, AppState>) -> (Vec<LibMod>, String) {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    (data.mods.iter().map(LibMod::from_entry).collect(), data.settings.order_bulk_mode.clone())
}

fn profile_meta(state: &State<'_, AppState>, profile_id: Option<&String>) -> (Option<String>, Option<String>) {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let pid = profile_id.cloned().or_else(|| data.active_profile_id.clone());
    data.profiles
        .iter()
        .find(|p| Some(&p.id) == pid.as_ref())
        .map(|p| (Some(p.name.clone()), Some(p.game_name.clone()).filter(|g| !g.is_empty())))
        .unwrap_or((None, None))
}

#[derive(Debug, Serialize)]
pub struct OrderExport {
    pub doc: OrderDoc,
    pub code: String,
    pub link: String,
    pub text: String,
}

/// The profile's order as a document, a code, a link and plain text.
pub fn export_for(state: &State<'_, AppState>, profile_id: Option<String>) -> Result<OrderExport, String> {
    let snap = mod_order::snapshot(state, profile_id.clone())?;
    let (lib, _) = library(state);
    let (name, game) = profile_meta(state, Some(&snap.pid));
    let doc = build_doc(&snap.order, &lib, name, game);
    Ok(OrderExport { code: encode_code(&doc), link: encode_link(&doc), text: encode_text(&doc), doc })
}

#[tauri::command]
pub fn mod_order_export(state: State<'_, AppState>, profile_id: Option<String>) -> Result<OrderExport, String> {
    export_for(&state, profile_id)
}

pub fn preview_for(state: &State<'_, AppState>, profile_id: Option<String>, text: &str) -> Result<ImportPlan, String> {
    let doc = parse_text(text)?;
    let snap = mod_order::snapshot(state, profile_id)?;
    let (lib, _) = library(state);
    let mut plan = plan_import(&snap.order, &doc, &lib);
    if plan.changed {
        let index = mod_order::index_for(state, &snap.order)?;
        plan.handovers = mod_order::handovers(&index, &snap.order, &plan.result).len();
    }
    Ok(plan)
}

/// What importing `text` would do to the profile's order. Changes nothing.
#[tauri::command]
pub fn mod_order_import_preview(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    text: String,
) -> Result<ImportPlan, String> {
    preview_for(&state, profile_id, &text)
}

/// Import an order: the active mods it names take its order, in the slots they hold.
/// Returns how many files changed hands.
#[tauri::command]
pub async fn mod_order_import(state: State<'_, AppState>, profile_id: Option<String>, text: String) -> Result<usize, String> {
    import_for(&state, profile_id, &text).await
}

pub async fn import_for(state: &State<'_, AppState>, profile_id: Option<String>, text: &str) -> Result<usize, String> {
    let doc = parse_text(text)?;
    let snap = mod_order::snapshot(state, profile_id)?;
    let (lib, _) = library(state);
    let plan = plan_import(&snap.order, &doc, &lib);
    if !plan.changed {
        return Ok(0);
    }
    mod_order::commit(state, snap, plan.result, false).await
}

/// Place a block of active mods by `mode` (None / "default" = the setting). The one call
/// every bulk enable ends with. Returns how many files changed hands.
#[tauri::command]
pub async fn mod_order_arrange(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    ids: Vec<String>,
    mode: Option<String>,
) -> Result<usize, String> {
    arrange_for(&state, profile_id, &ids, mode.as_deref()).await
}

pub async fn arrange_for(state: &State<'_, AppState>, profile_id: Option<String>, ids: &[String], mode: Option<&str>) -> Result<usize, String> {
    let (_, setting) = library(state);
    let mode = resolve_mode(mode, &setting);
    let snap = mod_order::snapshot(state, profile_id)?;
    let after = arrange(&snap.order, ids, mode);
    if after == snap.order {
        return Ok(0);
    }
    mod_order::commit(state, snap, after, false).await
}

/// The default placement of a bulk enable (`top` | `bottom` | `keep`).
#[tauri::command]
pub fn order_bulk_mode_get(state: State<'_, AppState>) -> String {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    resolve_mode(None, &data.settings.order_bulk_mode).as_str().to_string()
}

#[tauri::command]
pub fn order_bulk_mode_set(state: State<'_, AppState>, mode: String) -> Result<String, String> {
    let m = PlaceMode::parse(&mode).ok_or_else(|| "order.errMode".to_string())?;
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.settings.order_bulk_mode = m.as_str().to_string();
    }
    let _ = state.save();
    Ok(m.as_str().to_string())
}

#[cfg(test)]
#[path = "order_share_tests.rs"]
mod tests;
