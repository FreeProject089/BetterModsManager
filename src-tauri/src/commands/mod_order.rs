//! Which mod wins a file, and how to change the answer: the ACTIVATION ORDER of a profile.
//!
//! BMM deploys by copying a mod's files into the game, so two active mods that ship the same
//! relative path do not merge — one of them is what is on disk. The rule has always been
//! **last wins**: `Profile.active_mods` is the deployment order, and `fs_utils` reads it when a
//! mod is disabled, to find who provides that file now.
//!
//! ── The model ─────────────────────────────────────────────────────────────────────────────
//!
//! `Profile.active_mods` IS the order, position 0 applied first, the last one on top. There is
//! no second list and no priority number: a second list would be a second truth, and the day it
//! disagreed with the one deployment walks, the screen would describe a game that does not
//! exist. The consequence is also the migration: an existing profile's order is the order its
//! mods were enabled in, which is exactly what is on disk today, so nothing is rewritten and a
//! user who never opens the order view sees no change. A newly enabled mod goes to the END (it
//! wins), as it always did; the order view is how it is moved afterwards.
//!
//! ── The rules this file holds ──────────────────────────────────────────────────────────────
//!
//!  1. Deploy: a later mod overwrites an earlier one (enable appends, so enabling = on top).
//!  2. Undeploy: a file the disabled mod shipped comes back from the LAST remaining provider in
//!     the order, or from the original-game backup, or is deleted when the game never had it.
//!     `fallback_order` + `read_roots` build that provider list (archived mods included: their
//!     files are read from the extracted cache, never from the `.zip` path itself).
//!  3. Reorder: the new order is saved, then every file that CHANGED HANDS is re-copied from its
//!     new winner, under a Deploy ticket, one mod operation at a time (`MOD_OP_LOCK`). Files
//!     whose winner did not change are not touched. A reorder that fails half-way leaves the
//!     order saved and says so; "Re-apply" (`mod_order_reapply`) re-copies every contested
//!     file's winner, which is also the repair for a game folder somebody edited by hand.
//!
//! A list that says one thing while the disk says another is worse than no list, because it is
//! the one people will trust — hence rule 3 redeploys instead of asking the user to.

use crate::state::AppState;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::State;

/// A relative path as a map key: forward slashes, no `./`. The cache holds folder mods with
/// the OS separator and archived mods with `/`, so without this a zip and a folder shipping
/// the same file never met on Windows.
pub fn rel_key(s: &str) -> String {
    let mut k = s.replace('\\', "/");
    while let Some(rest) = k.strip_prefix("./") {
        k = rest.to_string();
    }
    k
}

/// Another mod this one beats (or is beaten by), and on how many files.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Rival {
    pub id: String,
    pub name: String,
    pub files: usize,
}

/// One active mod, in deployment order.
#[derive(Debug, Serialize, Clone)]
pub struct OrderedMod {
    pub id: String,
    pub name: String,
    /// 0-based position. Higher wins a shared file.
    pub position: usize,
    /// How many of this mod's files another active mod also provides.
    pub contested: usize,
    /// Of those, how many this mod currently WINS.
    pub winning: usize,
    /// The mods whose files this one replaces on disk ("overrides 12 files from X").
    pub overrides: Vec<Rival>,
    /// The mods that replace this one's files ("overridden by Y").
    pub overridden_by: Vec<Rival>,
    /// Kept zipped in the mods folder (read from its extracted cache when deployed).
    pub archived: bool,
    /// When the mod was added to the library, for the "sort by install date" helper.
    pub added_at: String,
}

/// One file more than one active mod provides.
#[derive(Debug, Serialize, Clone)]
pub struct ContestedFile {
    /// Path relative to the game folder, `/`-separated.
    pub path: String,
    /// Every active mod that ships it, in deployment order.
    pub mods: Vec<String>,
    /// The one on disk: the last of them, unless a per-file pin chose another active provider.
    pub winner: String,
    /// The winner comes from a pin (`Profile.file_winners`), not from the order.
    #[serde(default)]
    pub pinned: bool,
}

/// A file whose winner a new order changes.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Handover {
    pub path: String,
    pub from: String,
    pub to: String,
}

/// relative path → the mods that ship it (any order, no duplicates).
pub type ProviderIndex = HashMap<String, Vec<String>>;

/// The provider index of a set of mods, from their file lists.
pub fn build_index<'a, I>(items: I) -> ProviderIndex
where
    I: IntoIterator<Item = (&'a String, Vec<String>)>,
{
    let mut index: ProviderIndex = HashMap::new();
    for (id, files) in items {
        let mut seen = HashSet::new();
        for f in files {
            let k = rel_key(&f);
            if k.is_empty() || !seen.insert(k.clone()) {
                continue;
            }
            index.entry(k).or_default().push(id.clone());
        }
    }
    index
}

fn rank_of(order: &[String]) -> HashMap<&str, usize> {
    order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect()
}

/// Per-file winners chosen by the user: relative path (rel_key) -> mod id. See
/// `Profile.file_winners`.
pub type Pins = HashMap<String, String>;

/// THE rule, in one place: who provides `path` on disk, given its active providers sorted in
/// activation order. A pin wins when its mod is one of those providers; otherwise the LAST one
/// does. `None` when nobody active ships it (the game's own file, or nothing).
///
/// Returns the winner and whether it came from the pin.
pub fn winner_of<'a>(path: &str, providers_in_order: &[&'a String], pins: &Pins) -> Option<(&'a String, bool)> {
    if let Some(p) = pins.get(path) {
        if let Some(hit) = providers_in_order.iter().find(|id| id.as_str() == p.as_str()) {
            return Some((*hit, true));
        }
    }
    providers_in_order.last().map(|w| (*w, false))
}

/// The active providers of one path, in activation order.
fn providers_sorted<'a>(ids: &'a [String], rank: &HashMap<&str, usize>) -> Vec<&'a String> {
    let mut active: Vec<&String> = ids.iter().filter(|id| rank.contains_key(id.as_str())).collect();
    active.sort_by_key(|id| rank[id.as_str()]);
    active
}

/// Files provided by more than one mod of `order`, and who wins each (the last of them).
/// The app always goes through `contested_pinned`; this is the order-only rule the tests state.
#[cfg(test)]
pub fn contested(index: &ProviderIndex, order: &[String]) -> Vec<ContestedFile> {
    contested_pinned(index, order, &Pins::new())
}

/// `contested`, honouring per-file pins.
pub fn contested_pinned(index: &ProviderIndex, order: &[String], pins: &Pins) -> Vec<ContestedFile> {
    let rank = rank_of(order);
    let mut out = Vec::new();
    for (path, ids) in index.iter() {
        let active = providers_sorted(ids, &rank);
        if active.len() < 2 {
            continue;
        }
        let (winner, pinned) = winner_of(path, &active, pins).map(|(w, p)| (w.clone(), p)).unwrap_or_default();
        out.push(ContestedFile {
            path: path.clone(),
            winner,
            pinned,
            mods: active.into_iter().cloned().collect(),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// The files whose winner differs between two orders of the same set.
pub fn handovers(index: &ProviderIndex, before: &[String], after: &[String]) -> Vec<Handover> {
    let none = Pins::new();
    plan_handovers(index, before, &none, after, &none)
}

/// What a plan changes on disk: every file contested BEFORE (two or more active providers)
/// whose winner is different AFTER. `after` may be a subset of `before` (mods the plan
/// disables): a file whose last provider leaves goes back to the game's own copy, reported
/// with `to` empty.
pub fn plan_handovers(index: &ProviderIndex, before: &[String], pins_before: &Pins, after: &[String], pins_after: &Pins) -> Vec<Handover> {
    let rb = rank_of(before);
    let ra = rank_of(after);
    let mut out = Vec::new();
    for (path, ids) in index.iter() {
        let was = providers_sorted(ids, &rb);
        if was.len() < 2 {
            continue;
        }
        let now = providers_sorted(ids, &ra);
        let w0 = winner_of(path, &was, pins_before).map(|(w, _)| w.clone()).unwrap_or_default();
        let w1 = winner_of(path, &now, pins_after).map(|(w, _)| w.clone()).unwrap_or_default();
        if w0 != w1 {
            out.push(Handover { path: path.clone(), from: w0, to: w1 });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Two active mods that ship the same files, and how those files are shared out between them.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct PairSummary {
    /// The one applied first (higher up the list, lower position).
    pub a: String,
    /// The one applied later.
    pub b: String,
    /// Files both ship.
    pub files: usize,
    /// Of those, how many are `a`'s copy on disk.
    pub a_wins: usize,
    /// ... and `b`'s. The rest (files - a_wins - b_wins) are a third mod's.
    pub b_wins: usize,
    /// How many of those files have a pinned winner.
    pub pinned: usize,
}

/// One summary per pair of mods that share at least one file, most files first.
pub fn pair_summaries(contested: &[ContestedFile]) -> Vec<PairSummary> {
    let mut acc: HashMap<(String, String), PairSummary> = HashMap::new();
    for c in contested {
        for i in 0..c.mods.len() {
            for j in (i + 1)..c.mods.len() {
                // `mods` is in activation order, so `i` is applied before `j`.
                let (a, b) = (&c.mods[i], &c.mods[j]);
                let e = acc.entry((a.clone(), b.clone())).or_insert_with(|| PairSummary {
                    a: a.clone(),
                    b: b.clone(),
                    files: 0,
                    a_wins: 0,
                    b_wins: 0,
                    pinned: 0,
                });
                e.files += 1;
                if &c.winner == a {
                    e.a_wins += 1;
                } else if &c.winner == b {
                    e.b_wins += 1;
                }
                if c.pinned {
                    e.pinned += 1;
                }
            }
        }
    }
    let mut out: Vec<PairSummary> = acc.into_values().collect();
    out.sort_by(|x, y| y.files.cmp(&x.files).then(x.a.cmp(&y.a)).then(x.b.cmp(&y.b)));
    out
}

/// Pins as a caller sent them: keys normalised, empty entries dropped.
pub fn normalize_pins(raw: &Pins) -> Pins {
    raw.iter()
        .filter(|(k, v)| !k.trim().is_empty() && !v.trim().is_empty())
        .map(|(k, v)| (rel_key(k), v.clone()))
        .collect()
}

/// The pinned files whose pin overrides the order right now (the pinned mod is not the last
/// provider): what has to be put back after an enable or a disable copied the order's winner
/// over it. Empty when there are no pins, which is the common case and costs nothing.
pub fn pins_to_reassert(index: &ProviderIndex, order: &[String], pins: &Pins) -> Vec<ContestedFile> {
    if pins.is_empty() {
        return Vec::new();
    }
    contested_pinned(index, order, pins)
        .into_iter()
        .filter(|c| c.pinned && c.mods.last() != Some(&c.winner))
        .collect()
}

/// Same ids, same count. A new order that is not a permutation of the active set is refused:
/// a stale caller sending a shorter list would drop a mod out of the order while its files stay
/// in the game.
pub fn is_permutation(a: &[String], b: &[String]) -> bool {
    let mut x: Vec<&String> = a.iter().collect();
    let mut y: Vec<&String> = b.iter().collect();
    x.sort();
    y.sort();
    x == y
}

/// Move `block` (in its own order) to `position` of `order`; `None` = the end, on top.
///
/// Ids of `block` that are not in `order` are ignored, duplicates count once, and `position`
/// is an index into the order WITHOUT the block, clamped. This is "move to top/bottom" and how
/// a modpack inserts its mods: contiguously, in the pack's order.
pub fn place_block(order: &[String], block: &[String], position: Option<usize>) -> Vec<String> {
    let present: HashSet<&String> = order.iter().collect();
    let mut seen = HashSet::new();
    let moving: Vec<String> = block
        .iter()
        .filter(|id| present.contains(id) && seen.insert((*id).clone()))
        .cloned()
        .collect();
    let moving_set: HashSet<&String> = moving.iter().collect();
    let mut rest: Vec<String> = order.iter().filter(|id| !moving_set.contains(id)).cloned().collect();
    let at = position.unwrap_or(rest.len()).min(rest.len());
    let tail = rest.split_off(at);
    rest.extend(moving);
    rest.extend(tail);
    rest
}

/// The providers a disabled mod's files fall back to: the mods that STAY active, in activation
/// order (the last of them wins, see `fs_utils::unapply_mod_stacked`).
pub fn fallback_order(active: &[String], leaving: &HashSet<String>) -> Vec<String> {
    active.iter().filter(|id| !leaving.contains(*id)).cloned().collect()
}

/// One spelling per game folder, for "do these two profiles deploy into the same folder?".
///
/// The profiles compared `game_path` with `==`, so `E:\Game`, `E:\Game\` and `e:\game` were
/// three different folders on Windows, where they are one.
pub fn game_folder_key(p: &Path) -> String {
    let s = crate::commands::disk::strip_verbatim(&p.to_string_lossy()).replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(windows) { s.to_lowercase() } else { s.to_string() }
}

/// What the OTHER profiles deploying into the same game folder as `profile_id` have there.
///
/// Deployed files belong to the GAME FOLDER, not to the profile that is active: switching
/// profiles moves no file, so another profile's enabled mods are physically in that folder
/// while this one works on it. Two decisions need them:
///
///  · the backup guard (`fs_utils::backup_original_file`): a file one of `owners` put there is
///    a mod's file, not a game original. Seen from this profile alone it was backed up into
///    this profile's `_original/` and later "restored" as the game's own file;
///  · the undeploy: a file this profile's mod covered falls back to one of `owners` before the
///    original, and the original may sit in one of `backups` (the profile that first replaced
///    it backed it up into ITS backup folder).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct GameFolderShare {
    /// Mod ids enabled in another profile on this game folder (and not in this one), in each
    /// profile's activation order, profiles in their stored order.
    pub owners: Vec<String>,
    /// Those profiles' backup roots, without this profile's own and without duplicates.
    pub backups: Vec<PathBuf>,
}

pub fn game_folder_share(profiles: &[crate::models::profile::Profile], profile_id: &str) -> GameFolderShare {
    let Some(me) = profiles.iter().find(|p| p.id == profile_id) else { return GameFolderShare::default() };
    let key = game_folder_key(&me.game_path);
    let mine: HashSet<&String> = me.active_mods.iter().collect();
    let own_backup = game_folder_key(&me.backup_path);
    let mut share = GameFolderShare::default();
    let mut seen_mods = HashSet::new();
    let mut seen_backups: HashSet<String> = [own_backup].into_iter().collect();
    for p in profiles.iter().filter(|p| p.id != me.id && game_folder_key(&p.game_path) == key) {
        for id in &p.active_mods {
            if !mine.contains(id) && seen_mods.insert(id.clone()) {
                share.owners.push(id.clone());
            }
        }
        if seen_backups.insert(game_folder_key(&p.backup_path)) {
            share.backups.push(p.backup_path.clone());
        }
    }
    share
}

/// The providers a file falls back to when this profile disables `leaving`: the other
/// profiles' mods on the same game folder first, then this profile's own remaining mods, so the
/// own stack keeps winning (last wins) and another profile's copy comes back before the
/// original or a delete.
pub fn shared_fallback_order(owners: &[String], active: &[String], leaving: &HashSet<String>) -> Vec<String> {
    let own = fallback_order(active, leaving);
    let own_set: HashSet<&String> = own.iter().collect();
    let mut out: Vec<String> = fallback_order(owners, leaving).into_iter().filter(|id| !own_set.contains(id)).collect();
    out.extend(own);
    out
}

/// `(id, directory to read the mod's files from)` for `ids`, order kept.
///
/// A folder mod reads from its folder. An archived mod reads from its extracted cache: joining
/// a relative path onto `Mod.zip` names nothing, so a fallback that used the raw path skipped
/// every archived provider and restored the vanilla file (or deleted it) instead of that mod's
/// copy. An archive is only extracted when it ships one of `wanted` (all when `wanted` is None),
/// and one that cannot be extracted is left out, which is what the old path did in effect.
pub fn read_roots(
    ids: &[String],
    folders: &HashMap<String, PathBuf>,
    wanted: Option<&HashSet<String>>,
) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for id in ids {
        let Some(folder) = folders.get(id) else { continue };
        if crate::archive::is_archive(folder) {
            if let Some(w) = wanted {
                let ships = crate::fs_utils::list_mod_files(folder)
                    .map(|fs| fs.iter().any(|f| w.contains(&rel_key(&f.to_string_lossy()))))
                    .unwrap_or(false);
                if !ships {
                    continue;
                }
            }
            match crate::archive::materialize(folder) {
                Ok(dir) => out.push((id.clone(), dir)),
                Err(e) => crate::commands::crash::log_line(format!(
                    "[ORDER] could not extract {:?} to read it as a provider: {}", folder, e
                )),
            }
        } else {
            out.push((id.clone(), folder.clone()));
        }
    }
    out
}

/// What a batch disable restores: the union of the leaving mods' files, and the providers that
/// remain on that game folder, in order.
///
/// ONE unapply for the whole batch. Unapplying each mod in turn, with the others of the batch
/// still counted as providers, put a batch member's copy back into the game (it was "still
/// active" until the loop ended); and with them excluded instead, the first unapply restored
/// the vanilla file and freed its backup, so the second found no backup and deleted the file.
#[derive(Debug, Clone, PartialEq)]
pub struct BatchPlan {
    pub files: Vec<String>,
    pub remaining: Vec<String>,
}

/// `root_orders`: the `active_mods` of every profile deploying to that game folder.
pub fn plan_batch_disable(
    root_orders: &[Vec<String>],
    leaving: &HashSet<String>,
    files_of: &dyn Fn(&str) -> Vec<String>,
) -> BatchPlan {
    let mut remaining = Vec::new();
    let mut seen = HashSet::new();
    for order in root_orders {
        for id in fallback_order(order, leaving) {
            if seen.insert(id.clone()) {
                remaining.push(id);
            }
        }
    }
    let mut files: Vec<String> = Vec::new();
    let mut fseen = HashSet::new();
    let mut ids: Vec<&String> = leaving.iter().collect();
    ids.sort();
    for id in ids {
        for f in files_of(id) {
            if fseen.insert(rel_key(&f)) {
                files.push(f);
            }
        }
    }
    files.sort();
    BatchPlan { files, remaining }
}

/// What a redeploy did.
#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct RedeployReport {
    pub copied: usize,
    /// Files no provider actually had on disk any more (a stale file list): left as they were.
    pub missing: usize,
}

/// Re-copy each contested file from its winner (the last of `mods` whose copy exists).
pub fn redeploy(
    game_path: &Path,
    files: &[ContestedFile],
    roots: &HashMap<String, PathBuf>,
    smart_io: bool,
    ticket: &crate::governor::queue::Ticket,
) -> anyhow::Result<RedeployReport> {
    use crate::governor::config::OpKind;
    let mut rep = RedeployReport::default();
    for c in files {
        crate::fs_utils::checkpoint(ticket)?;
        let Some(rel) = crate::fs_utils::safe_relative_path(&c.path) else { continue };
        // The winner first (a pin may have chosen one that is not the last), then the others
        // from the top down, for a winner whose copy is missing on disk.
        let src = std::iter::once(&c.winner)
            .chain(c.mods.iter().rev())
            .filter_map(|id| roots.get(id))
            .map(|root| root.join(&rel))
            .find(|p| p.is_file());
        match src {
            Some(src) => {
                // No backup here on purpose: the file being replaced belongs to another MOD; the
                // original game file was backed up when the first of them was enabled.
                crate::fs_utils::copy_file_governed(OpKind::Deploy, &src, &game_path.join(&rel), Some(ticket), smart_io)?;
                rep.copied += 1;
            }
            None => rep.missing += 1,
        }
    }
    Ok(rep)
}

/// Per mod: whom it beats and who beats it, from the contested files (winner vs each loser).
fn rivals(
    contested: &[ContestedFile],
    names: &HashMap<String, String>,
) -> (HashMap<String, Vec<Rival>>, HashMap<String, Vec<Rival>>) {
    let mut beats: HashMap<String, HashMap<String, usize>> = HashMap::new();
    let mut beaten: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for c in contested {
        for loser in c.mods.iter().filter(|m| *m != &c.winner) {
            *beats.entry(c.winner.clone()).or_default().entry(loser.clone()).or_default() += 1;
            *beaten.entry(loser.clone()).or_default().entry(c.winner.clone()).or_default() += 1;
        }
    }
    let flat = |m: HashMap<String, HashMap<String, usize>>| {
        m.into_iter()
            .map(|(k, v)| {
                let mut list: Vec<Rival> = v
                    .into_iter()
                    .map(|(id, files)| Rival { name: names.get(&id).cloned().unwrap_or_else(|| id.clone()), id, files })
                    .collect();
                list.sort_by(|a, b| b.files.cmp(&a.files).then(a.name.cmp(&b.name)));
                list.truncate(8);
                (k, list)
            })
            .collect::<HashMap<_, _>>()
    };
    (flat(beats), flat(beaten))
}

/// Everything about one profile the order commands need, read under one lock.
pub(crate) struct Snapshot {
    pub(crate) pid: String,
    pub(crate) order: Vec<String>,
    game_path: PathBuf,
    mods_path: PathBuf,
    smart_io: bool,
    folders: HashMap<String, PathBuf>,
    names: HashMap<String, String>,
    added: HashMap<String, String>,
    pub(crate) pins: Pins,
}

pub(crate) fn snapshot(state: &State<'_, AppState>, profile_id: Option<String>) -> Result<Snapshot, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let pid = profile_id.or_else(|| data.active_profile_id.clone());
    let prof = data
        .profiles
        .iter()
        .find(|p| Some(&p.id) == pid.as_ref())
        .ok_or_else(|| "order.errNoProfile".to_string())?;
    let mut folders = HashMap::new();
    let mut names = HashMap::new();
    let mut added = HashMap::new();
    for m in data.mods.iter() {
        folders.insert(m.id.clone(), m.mod_folder_path.clone());
        names.insert(m.id.clone(), m.name.clone());
        added.insert(m.id.clone(), m.added_at.clone());
    }
    Ok(Snapshot {
        pid: prof.id.clone(),
        order: prof.active_mods.clone(),
        game_path: prof.game_path.clone(),
        mods_path: prof.mods_path.clone(),
        smart_io: data.settings.smart_io_enabled,
        folders,
        names,
        added,
        pins: prof.file_winners.clone(),
    })
}

/// The provider index of `ids`, from the in-memory file cache (built on first use: the order
/// view can be the first screen to need it, and an empty cache would say "no conflicts").
pub(crate) fn index_for(state: &State<'_, AppState>, ids: &[String]) -> Result<ProviderIndex, String> {
    crate::commands::mods::ensure_cache_populated(state).map_err(|e| e.to_string())?;
    let cache = state.mod_files_cache.lock().unwrap_or_else(|p| p.into_inner());
    Ok(build_index(ids.iter().filter_map(|id| {
        cache.get(id).map(|set| (id, set.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>()))
    })))
}

/// The active mods of a profile, in the order they are deployed, with who beats whom.
#[tauri::command]
pub fn mod_order_get(
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<(Vec<OrderedMod>, Vec<ContestedFile>), String> {
    let snap = snapshot(&state, profile_id)?;
    let index = index_for(&state, &snap.order)?;
    let contested = contested_pinned(&index, &snap.order, &snap.pins);
    let (beats, beaten) = rivals(&contested, &snap.names);
    let mut count: HashMap<&str, (usize, usize)> = HashMap::new();
    for c in &contested {
        for m in &c.mods {
            let e = count.entry(m.as_str()).or_default();
            e.0 += 1;
            if m == &c.winner {
                e.1 += 1;
            }
        }
    }
    let mods = snap
        .order
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let (contested_n, winning) = count.get(id.as_str()).copied().unwrap_or_default();
            OrderedMod {
                id: id.clone(),
                name: snap.names.get(id).cloned().unwrap_or_else(|| id.clone()),
                position: i,
                contested: contested_n,
                winning,
                overrides: beats.get(id).cloned().unwrap_or_default(),
                overridden_by: beaten.get(id).cloned().unwrap_or_default(),
                archived: snap.folders.get(id).map(|f| crate::archive::is_archive(f)).unwrap_or(false),
                added_at: snap.added.get(id).cloned().unwrap_or_default(),
            }
        })
        .collect();
    Ok((mods, contested))
}

/// What applying `order` would change on disk, without changing anything: the files that
/// would change hands. The order view shows this count on its "Apply order" button.
#[tauri::command]
pub fn mod_order_preview(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    order: Vec<String>,
) -> Result<Vec<Handover>, String> {
    let snap = snapshot(&state, profile_id)?;
    if !is_permutation(&snap.order, &order) {
        return Err("order.errNotPermutation".to_string());
    }
    let index = index_for(&state, &snap.order)?;
    Ok(plan_handovers(&index, &snap.order, &snap.pins, &order, &snap.pins))
}

/// Save `after` as the profile's order, then make the disk agree: the files that changed hands
/// (or, with `all`, every contested file) are re-copied from their winner. Returns how many.
pub(crate) async fn commit(state: &State<'_, AppState>, snap: Snapshot, after: Vec<String>, all: bool) -> Result<usize, String> {
    let pins = snap.pins.clone();
    commit_with_pins(state, snap, after, pins, all).await
}

/// `commit`, also replacing the profile's per-file pins with `pins_after`.
pub(crate) async fn commit_with_pins(
    state: &State<'_, AppState>,
    snap: Snapshot,
    after: Vec<String>,
    pins_after: Pins,
    all: bool,
) -> Result<usize, String> {
    let index = index_for(state, &after)?;
    let moved: Vec<ContestedFile> = if all {
        contested_pinned(&index, &after, &pins_after)
    } else {
        let changed: HashSet<String> =
            plan_handovers(&index, &snap.order, &snap.pins, &after, &pins_after).into_iter().map(|h| h.path).collect();
        contested_pinned(&index, &after, &pins_after).into_iter().filter(|c| changed.contains(&c.path)).collect()
    };

    let pins_changed = pins_after != snap.pins;
    if after != snap.order || pins_changed {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        for p in data.profiles.iter_mut() {
            // The profile itself, and its twins: enable/disable keep profiles that share the
            // game AND mods folders in step, so the order follows when they hold the same set.
            // The pins follow the same way: they describe the same game folder.
            let twin = p.game_path == snap.game_path && p.mods_path == snap.mods_path && is_permutation(&p.active_mods, &after);
            if p.id == snap.pid || twin {
                p.active_mods = after.clone();
                if pins_changed {
                    p.file_winners = pins_after.clone();
                }
            }
        }
    }
    let _ = state.save();

    redeploy_files(snap, moved).await
}

/// Copy each of `moved` from its winner, off the UI thread, one mod operation at a time.
async fn redeploy_files(snap: Snapshot, moved: Vec<ContestedFile>) -> Result<usize, String> {
    if moved.is_empty() {
        return Ok(0);
    }
    let game_path = snap.game_path.clone();
    let folders = snap.folders;
    let smart_io = snap.smart_io;
    // Off the UI thread: extracting an archived provider and copying files both touch the disk.
    let outcome: Result<RedeployReport, String> = tauri::async_runtime::spawn_blocking(move || {
        use crate::governor::config::OpKind;
        let _lock = crate::commands::mods::MOD_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let ticket = crate::governor::runtime::global().begin(OpKind::Deploy, "load order");
        let wanted: HashSet<String> = moved.iter().map(|c| c.path.clone()).collect();
        let ids: Vec<String> = {
            let mut seen = HashSet::new();
            moved.iter().flat_map(|c| c.mods.iter().cloned()).filter(|id| seen.insert(id.clone())).collect()
        };
        let roots: HashMap<String, PathBuf> = read_roots(&ids, &folders, Some(&wanted)).into_iter().collect();
        redeploy(&game_path, &moved, &roots, smart_io, &ticket).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    let rep = outcome?;
    if rep.missing > 0 {
        crate::commands::crash::log_line(format!(
            "[ORDER] {} contested file(s) had no provider on disk and were left as they were", rep.missing
        ));
    }
    Ok(rep.copied)
}

/// Reorder the active mods, and make the disk agree. Returns how many files changed hands.
///
/// The new order must be a PERMUTATION of what is active: same ids, same count. Anything else
/// is refused rather than reconciled.
#[tauri::command]
pub async fn mod_order_set(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    order: Vec<String>,
) -> Result<usize, String> {
    let snap = snapshot(&state, profile_id)?;
    if !is_permutation(&snap.order, &order) {
        return Err("order.errNotPermutation".to_string());
    }
    commit(&state, snap, order, false).await
}

/// Move some active mods, as one block in the given order, to `position` (None = the end, on
/// top of everything). "Move to top/bottom" and a modpack's insertion both go through here.
#[tauri::command]
pub async fn mod_order_place(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    ids: Vec<String>,
    position: Option<usize>,
) -> Result<usize, String> {
    let snap = snapshot(&state, profile_id)?;
    let after = place_block(&snap.order, &ids, position);
    commit(&state, snap, after, false).await
}

/// Re-copy the winner of every contested file: the repair when the disk and the order may
/// disagree (a reorder that was cancelled half-way, a file edited by hand in the game folder).
#[tauri::command]
pub async fn mod_order_reapply(state: State<'_, AppState>, profile_id: Option<String>) -> Result<usize, String> {
    let snap = snapshot(&state, profile_id)?;
    let after = snap.order.clone();
    commit(&state, snap, after, true).await
}

// ── The conflicts view ─────────────────────────────────────────────────────────────────────
//
// One screen for "which mod wins each file, and how do I change that": the active profile's
// contested files under a DRAFT plan (an order, per-file pins, mods to disable), every pair of
// mods that share files with how the files are shared out, and what the draft would change on
// disk compared with now. The frontend never computes a winner itself; it sends the draft and
// draws what comes back, so the screen and the deployment cannot disagree.

/// How many contested files / handovers a plan answer carries. Two big texture packs can share
/// tens of thousands of paths; the counts stay exact, the lists are cut.
pub const PLAN_LIST_CAP: usize = 5000;

/// The conflicts of a profile under a draft plan.
#[derive(Debug, Serialize, Clone)]
pub struct ConflictPlanView {
    pub profile_id: String,
    /// The draft's activation order (the disabled mods taken out).
    pub order: Vec<String>,
    /// id -> display name, for every mod the answer mentions.
    pub names: HashMap<String, String>,
    /// The draft's pins (normalised).
    pub pins: Pins,
    /// Contested files under the draft, path order, at most PLAN_LIST_CAP.
    pub files: Vec<ContestedFile>,
    pub files_total: usize,
    /// Every pair of mods that share files under the draft.
    pub pairs: Vec<PairSummary>,
    /// What applying the draft would change on disk, at most PLAN_LIST_CAP.
    pub handovers: Vec<Handover>,
    pub handovers_total: usize,
}

/// Check a draft against the saved state and build the view. Pure, for the tests.
pub fn plan_view(
    index: &ProviderIndex,
    current: &[String],
    current_pins: &Pins,
    order: Option<Vec<String>>,
    pins: Option<Pins>,
    disable: &[String],
) -> Result<(Vec<String>, Pins, Vec<ContestedFile>, Vec<PairSummary>, Vec<Handover>), String> {
    let order = order.unwrap_or_else(|| current.to_vec());
    if !is_permutation(current, &order) {
        return Err("order.errNotPermutation".to_string());
    }
    let pins = normalize_pins(&pins.unwrap_or_else(|| current_pins.clone()));
    let leaving: HashSet<String> = disable.iter().cloned().collect();
    let after: Vec<String> = order.iter().filter(|id| !leaving.contains(*id)).cloned().collect();
    let files = contested_pinned(index, &after, &pins);
    let pairs = pair_summaries(&files);
    let moves = plan_handovers(index, current, current_pins, &after, &pins);
    Ok((after, pins, files, pairs, moves))
}

/// The conflicts of a profile (None = the active one) under a draft. Every argument left out
/// means "as saved": with none, this is simply the current state.
#[tauri::command]
pub fn conflict_plan(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    order: Option<Vec<String>>,
    pins: Option<Pins>,
    disable: Option<Vec<String>>,
) -> Result<ConflictPlanView, String> {
    let snap = snapshot(&state, profile_id)?;
    let index = index_for(&state, &snap.order)?;
    let disable = disable.unwrap_or_default();
    let (after, pins, mut files, pairs, mut moves) = plan_view(&index, &snap.order, &snap.pins, order, pins, &disable)?;
    let files_total = files.len();
    let handovers_total = moves.len();
    files.truncate(PLAN_LIST_CAP);
    moves.truncate(PLAN_LIST_CAP);
    let names = snap
        .order
        .iter()
        .map(|id| (id.clone(), snap.names.get(id).cloned().unwrap_or_else(|| id.clone())))
        .collect();
    Ok(ConflictPlanView {
        profile_id: snap.pid,
        order: after,
        names,
        pins,
        files,
        files_total,
        pairs,
        handovers: moves,
        handovers_total,
    })
}

/// Save a draft's order and pins, and re-copy the files that change hands. Returns how many.
/// Disabling is not done here: the frontend disables through `disable_mod`, which restores
/// each file from the next provider and then puts the pins back (`reassert_pins`).
#[tauri::command]
pub async fn conflict_apply(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    order: Vec<String>,
    pins: Pins,
) -> Result<usize, String> {
    let snap = snapshot(&state, profile_id)?;
    if !is_permutation(&snap.order, &order) {
        return Err("order.errNotPermutation".to_string());
    }
    let pins = normalize_pins(&pins);
    commit_with_pins(&state, snap, order, pins, false).await
}

/// Put pinned files back after an enable or a disable: both copy the ORDER's winner (enable
/// overwrites, disable restores from the last remaining provider), which is not the pinned
/// one when a pin is set. Nothing to do, and nothing read, when the profile has no pins.
pub async fn reassert_pins(state: &State<'_, AppState>) -> Result<usize, String> {
    let snap = snapshot(state, None)?;
    if snap.pins.is_empty() {
        return Ok(0);
    }
    let index = index_for(state, &snap.order)?;
    let moved = pins_to_reassert(&index, &snap.order, &snap.pins);
    redeploy_files(snap, moved).await
}

#[cfg(test)]
#[path = "mod_order_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "conflict_plan_tests.rs"]
mod conflict_plan_tests;
