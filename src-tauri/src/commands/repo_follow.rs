//! Followed repos: BMM checks a repo on a schedule and says when one of YOUR mods has an
//! update in it, and, when the user asked for it, downloads or applies it.
//!
//! What lives here:
//!
//!  - the update rule, shared with `check_mod_updates` ([`update_reason`]): a version that
//!    really is newer (numbers compared as numbers, never "1.10" < "1.9", never a downgrade),
//!    or the same version whose files changed (`ModEntry.repo_content_hash`, recorded at sync);
//!  - the per-repo follow settings ([`RepoFollow`], on `ConnectedServerRepo` in data.json);
//!  - the light check ([`repo_follow_check`]): a conditional GET of repo.json with the ETag /
//!    Last-Modified it answered last time, so an unchanged repo costs one 304 and no parsing;
//!    a server that sends neither is compared by the sha256 of the body;
//!  - the Atom feed the built-in repo server serves next to repo.json ([`atom_feed`]).
//!
//! The SCHEDULE is not a loop here: the page's follow runner (frontend
//! `features/repo/repo-follow.ts`) asks [`repo_follow_due`] every few minutes while BMM is
//! open, checks the due repos one by one (each one a row in the activity centre), and for a
//! repo set to download / apply runs the plan the check returns ([`apply_plan`]) through the
//! ordinary sync and the activation job manager. A check reports whether a game is running
//! (the governor's game mode): nothing is downloaded or applied then, the user is told.

use crate::commands::repo::{normalize_repo_url, ModUpdateInfo};
use crate::models::mod_entry::ModEntry;
use crate::models::repo::ServerRepo;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::HashMap;
use tauri::State;

// ── The update rule ─────────────────────────────────────────────────────────────────────────

/// `1.2.10` vs `1.2.9`, `v2` vs `2.0.0`, `1.0.0-beta` < `1.0.0`. `None` when either side is not
/// a dotted number (a date, a codename): the caller falls back to "different = update".
pub fn version_cmp(a: &str, b: &str) -> Option<Ordering> {
    fn parse(s: &str) -> Option<(Vec<u64>, Option<String>)> {
        let s = s.trim().trim_start_matches(['v', 'V']);
        let s = s.split('+').next().unwrap_or("");
        let (core, pre) = match s.split_once('-') { Some((c, p)) => (c, Some(p.to_ascii_lowercase())), None => (s, None) };
        if core.is_empty() { return None; }
        let nums = core.split('.').map(|p| p.parse::<u64>().ok()).collect::<Option<Vec<_>>>()?;
        Some((nums, pre))
    }
    let (mut x, xp) = parse(a)?;
    let (mut y, yp) = parse(b)?;
    let n = x.len().max(y.len());
    x.resize(n, 0);
    y.resize(n, 0);
    Some(x.cmp(&y).then_with(|| match (xp, yp) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(p), Some(q)) => p.cmp(&q),
    }))
}

/// Why the repo's copy is an update over the installed one: `"version"`, `"content"`, or
/// `None` (the same, or OLDER: a repo that went back a version is never offered as an update).
pub fn update_reason(cur_ver: &str, cur_hash: Option<&str>, new_ver: &str, new_hash: Option<&str>) -> Option<&'static str> {
    match version_cmp(new_ver, cur_ver) {
        Some(Ordering::Greater) => return Some("version"),
        Some(Ordering::Less) => return None,
        Some(Ordering::Equal) => {}
        None if !new_ver.trim().eq_ignore_ascii_case(cur_ver.trim()) => return Some("version"),
        None => {}
    }
    match (cur_hash, new_hash) {
        (Some(c), Some(n)) if !c.is_empty() && !n.is_empty() && !c.eq_ignore_ascii_case(n) => Some("content"),
        _ => None,
    }
}

/// One repo mod as the update check reads it.
#[derive(Debug, Clone)]
pub struct Offered { pub version: String, pub changelog: Option<String>, pub content_hash: String }

/// Every mod a manifest offers, by id. One id in several repo profiles: the NEWEST copy wins
/// (it was the first one met, whatever its version).
pub fn manifest_index(repo: &ServerRepo) -> HashMap<String, Offered> {
    let mut map: HashMap<String, Offered> = HashMap::new();
    for p in &repo.profiles {
        for rm in &p.mods {
            let o = Offered { version: rm.version.clone(), changelog: rm.changelog.clone(), content_hash: crate::commands::repo::mod_content_hash(rm) };
            match map.get(&rm.id) {
                Some(prev) if version_cmp(&o.version, &prev.version) != Some(Ordering::Greater) => {}
                _ => { map.insert(rm.id.clone(), o); }
            }
        }
    }
    map
}

/// The repo ids a mod is linked to in `repo_n` (normalised): through `source_repo`,
/// `update_url` or a repo-kind update source.
pub fn linked_ids(m: &ModEntry, repo_n: &str) -> Vec<String> {
    let main = m.repo_mod_id.clone().filter(|r| !r.trim().is_empty());
    let mut out = Vec::new();
    let mut add = |url: &str, rid: Option<String>| {
        if normalize_repo_url(url) == repo_n {
            if let Some(r) = rid.filter(|r| !r.trim().is_empty()) { if !out.contains(&r) { out.push(r); } }
        }
    };
    if let Some(r) = &m.source_repo { add(r, main.clone()); }
    if let Some(r) = &m.update_url { add(r, main.clone()); }
    for s in m.update_sources.iter().filter(|s| !s.is_direct()) { add(&s.repo_url, s.repo_mod_id.clone().or_else(|| main.clone())); }
    out
}

/// The installed mods that have an update in this manifest.
pub fn updates_for_repo(mods: &[ModEntry], repo_url: &str, repo: &ServerRepo) -> Vec<ModUpdateInfo> {
    let repo_n = normalize_repo_url(repo_url);
    let index = manifest_index(repo);
    let mut out = Vec::new();
    for m in mods {
        for rid in linked_ids(m, &repo_n) {
            let Some(o) = index.get(&rid) else { continue };
            // The content fingerprint only speaks for the repo the mod was synced FROM.
            let own_hash = m.source_repo.as_deref().map(normalize_repo_url).filter(|s| *s == repo_n).and(m.repo_content_hash.as_deref());
            if let Some(reason) = update_reason(&m.version, own_hash, &o.version, Some(&o.content_hash)) {
                out.push(ModUpdateInfo {
                    mod_id: m.id.clone(),
                    name: m.name.clone(),
                    current_version: m.version.clone(),
                    new_version: o.version.clone(),
                    repo_url: repo_n.clone(),
                    repo_mod_id: rid.clone(),
                    changelog: o.changelog.clone(),
                    direct: false,
                    detail: (reason == "content").then(|| "content".to_string()),
                });
                break;
            }
        }
    }
    out
}

// ── Follow settings ─────────────────────────────────────────────────────────────────────────

fn default_interval() -> u32 { 360 }
fn default_action() -> String { "notify".into() }
fn yes() -> bool { true }

/// How one followed repo is checked, and what BMM does when a mod has an update.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoFollow {
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Minutes between two checks. Six hours by default; at least 15.
    #[serde(default = "default_interval")]
    pub interval_min: u32,
    /// `notify` (default): say it. `download`: sync the updated mods' files. `apply`: sync
    /// them and re-deploy the ones that were enabled. Never while a game runs.
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    /// sha256 of the last body, for servers that send no validator.
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub last_check: Option<String>,
    #[serde(default)]
    pub last_version: Option<String>,
    #[serde(default)]
    pub last_updates: u32,
    #[serde(default)]
    pub last_error: Option<String>,
}

impl Default for RepoFollow {
    fn default() -> Self {
        Self { enabled: true, interval_min: default_interval(), action: default_action(), etag: None, last_modified: None, digest: None, last_check: None, last_version: None, last_updates: 0, last_error: None }
    }
}

pub const MIN_INTERVAL: u32 = 15;

pub fn normalize_action(a: &str) -> String {
    match a.trim().to_ascii_lowercase().as_str() {
        "download" => "download".into(),
        "apply" => "apply".into(),
        _ => "notify".into(),
    }
}

/// Is this follow due at `now`? Never checked = due.
pub fn is_due(f: &RepoFollow, now: chrono::DateTime<chrono::Utc>) -> bool {
    if !f.enabled { return false; }
    let Some(last) = f.last_check.as_deref().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) else { return true };
    now.signed_duration_since(last.with_timezone(&chrono::Utc)).num_minutes() >= i64::from(f.interval_min.max(MIN_INTERVAL))
}

/// What the page sends to change a follow (absent = unchanged).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FollowPatch {
    pub enabled: Option<bool>,
    pub interval_min: Option<u32>,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowedRepo {
    pub url: String,
    pub name: String,
    pub follow: RepoFollow,
    pub due: bool,
}

fn listed(r: &crate::state::ConnectedServerRepo) -> Option<FollowedRepo> {
    let f = r.follow.clone()?;
    Some(FollowedRepo { url: r.url.clone(), name: r.name.clone(), due: is_due(&f, chrono::Utc::now()), follow: f })
}

/// Every followed repo.
#[tauri::command]
pub fn repo_follow_list(state: State<'_, AppState>) -> Result<Vec<FollowedRepo>, String> {
    let data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
    Ok(data.settings.connected_server_repos.iter().filter_map(listed).collect())
}

/// The followed repos due for a check now (the scheduler task asks this first).
#[tauri::command]
pub fn repo_follow_due(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(repo_follow_list(state)?.into_iter().filter(|r| r.due).map(|r| r.url).collect())
}

/// Follow a repo, or change how it is followed. The repo is added to the connected list
/// when it is not there yet (the sync screen never added it, so « auto-sync » and the
/// follow had nothing to hang on).
#[tauri::command]
pub fn repo_follow_set(state: State<'_, AppState>, url: String, name: Option<String>, patch: FollowPatch) -> Result<FollowedRepo, String> {
    let key = normalize_repo_url(&url);
    if key.is_empty() { return Err("repo.follow.errNoUrl".into()); }
    let out = {
        let mut data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        let list = &mut data.settings.connected_server_repos;
        let at = match list.iter().position(|r| normalize_repo_url(&r.url) == key) {
            Some(i) => i,
            None => {
                list.push(crate::state::ConnectedServerRepo { url: url.trim().to_string(), ..Default::default() });
                list.len() - 1
            }
        };
        let r = &mut list[at];
        if let Some(n) = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) { r.name = n.chars().take(120).collect(); }
        let f = r.follow.get_or_insert_with(RepoFollow::default);
        if let Some(e) = patch.enabled { f.enabled = e; }
        if let Some(m) = patch.interval_min { f.interval_min = m.clamp(MIN_INTERVAL, 60 * 24 * 30); }
        if let Some(a) = patch.action { f.action = normalize_action(&a); }
        listed(r).ok_or("repo.follow.errNoUrl")?
    };
    state.save().map_err(|e| e.to_string())?;
    Ok(out)
}

/// Stop following (the repo stays connected for its auto-sync setting).
#[tauri::command]
pub fn repo_follow_remove(state: State<'_, AppState>, url: String) -> Result<bool, String> {
    let key = normalize_repo_url(&url);
    let changed = {
        let mut data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        let mut changed = false;
        for r in data.settings.connected_server_repos.iter_mut().filter(|r| normalize_repo_url(&r.url) == key) {
            changed |= r.follow.take().is_some();
        }
        changed
    };
    if changed { state.save().map_err(|e| e.to_string())?; }
    Ok(changed)
}

/// `POST /api/repo/follow`: follow a repo or change how (the page's switch, interval and
/// action), or stop following it with `remove`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowApiArgs {
    pub url: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub interval_min: Option<u32>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub remove: bool,
}

/// `POST /api/repo/follow/check`: check one followed repo now.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowCheckArgs {
    pub url: String,
    #[serde(default)]
    pub password: Option<String>,
    /// Ignore the stored ETag / Last-Modified: read the manifest in full.
    #[serde(default)]
    pub force: bool,
}

// ── The check ───────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FollowCheck {
    pub url: String,
    pub name: String,
    /// The server answered 304, or the same body as last time: nothing was parsed.
    pub not_modified: bool,
    pub version: Option<String>,
    pub updates: Vec<ModUpdateInfo>,
    pub action: String,
    pub error: Option<String>,
    /// A game is running (the governor's game mode): the page notifies only.
    pub game_running: bool,
    /// How to install the updates found: one sync per local profile ([`apply_plan`]).
    pub plan: Vec<ApplyStep>,
}

/// One sync the page runs to install a followed repo's updates into one local profile.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyStep {
    pub local_profile_id: String,
    pub repo_profile_id: String,
    /// The repo mod ids to download (the sync's `selected_mod_ids`).
    pub repo_mod_ids: Vec<String>,
    /// The local records being updated.
    pub local_mod_ids: Vec<String>,
    /// Those that are enabled in that profile: « apply » turns them off before the sync and
    /// on after it, so the game gets the new files.
    pub enabled_local_ids: Vec<String>,
}

/// The syncs that install `updates`: per local profile (the one whose mods folder holds the
/// record), the repo profile that lists the mod (the profile it was synced from first, else
/// the first repo profile that has it). An update whose record is in no profile's folder, or
/// whose mod no repo profile lists, is left out: the page says to update it by hand.
pub fn apply_plan(mods: &[ModEntry], profiles: &[crate::models::profile::Profile], repo: &ServerRepo, updates: &[ModUpdateInfo]) -> Vec<ApplyStep> {
    let mut steps: Vec<ApplyStep> = Vec::new();
    for u in updates.iter().filter(|u| !u.direct) {
        let Some(m) = mods.iter().find(|m| m.id == u.mod_id) else { continue };
        let Some(p) = profiles.iter().find(|p| crate::commands::mod_ids::in_folder(&m.mod_folder_path, &p.mods_path)) else { continue };
        let lists = |rp: &&crate::models::repo::RepoProfile| rp.mods.iter().any(|rm| rm.id == u.repo_mod_id);
        let rp = repo.profiles.iter().filter(lists).find(|rp| p.origin_repo_profile_id.as_deref() == Some(rp.id.as_str()))
            .or_else(|| repo.profiles.iter().find(lists));
        let Some(rp) = rp else { continue };
        let at = match steps.iter().position(|s| s.local_profile_id == p.id && s.repo_profile_id == rp.id) {
            Some(i) => i,
            None => {
                steps.push(ApplyStep { local_profile_id: p.id.clone(), repo_profile_id: rp.id.clone(), repo_mod_ids: vec![], local_mod_ids: vec![], enabled_local_ids: vec![] });
                steps.len() - 1
            }
        };
        let s = &mut steps[at];
        if !s.repo_mod_ids.contains(&u.repo_mod_id) { s.repo_mod_ids.push(u.repo_mod_id.clone()); }
        if !s.local_mod_ids.contains(&m.id) {
            s.local_mod_ids.push(m.id.clone());
            if p.active_mods.contains(&m.id) { s.enabled_local_ids.push(m.id.clone()); }
        }
    }
    steps
}

fn manifest_url(url: &str) -> String {
    let mut u = url.trim().to_string();
    if !u.starts_with("http://") && !u.starts_with("https://") { u = format!("http://{u}"); }
    if !u.ends_with("repo.json") { u = format!("{}/repo.json", u.trim_end_matches('/')); }
    u
}

enum Probe { NotModified, Body { etag: Option<String>, last_modified: Option<String>, digest: String, body: String } }

async fn probe(url: &str, creator_id: Option<&str>, password: Option<&str>, f: &RepoFollow) -> Result<Probe, String> {
    use reqwest::header::{HeaderMap, HeaderValue};
    let target = manifest_url(url);
    let mut h = HeaderMap::new();
    if let Some(v) = creator_id.and_then(|c| HeaderValue::from_str(c).ok()) { h.insert("X-Creator-ID", v); }
    if let Some(v) = password.filter(|p| !p.is_empty()).and_then(|p| HeaderValue::from_str(p).ok()) { h.insert("X-Repo-Password", v); }
    crate::commands::repo_keyauth::add_proof(&mut h, &target);
    if let Some(v) = f.etag.as_deref().and_then(|e| HeaderValue::from_str(e).ok()) { h.insert(reqwest::header::IF_NONE_MATCH, v); }
    if let Some(v) = f.last_modified.as_deref().and_then(|e| HeaderValue::from_str(e).ok()) { h.insert(reqwest::header::IF_MODIFIED_SINCE, v); }
    let client = reqwest::Client::builder().default_headers(h).timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let res = client.get(&target).send().await.map_err(|e| e.to_string())?;
    let st = res.status();
    if st == reqwest::StatusCode::NOT_MODIFIED { return Ok(Probe::NotModified); }
    if st == reqwest::StatusCode::UNAUTHORIZED { return Err("repo.errPasswordRequired".into()); }
    if !st.is_success() { return Err(format!("HTTP {}", st.as_u16())); }
    let header = |k: reqwest::header::HeaderName| res.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let etag = header(reqwest::header::ETAG);
    let last_modified = header(reqwest::header::LAST_MODIFIED);
    let body = res.text().await.map_err(|e| e.to_string())?;
    let digest = format!("{:x}", Sha256::digest(body.as_bytes()));
    if f.digest.as_deref() == Some(digest.as_str()) { return Ok(Probe::NotModified); }
    Ok(Probe::Body { etag, last_modified, digest, body })
}

/// Check one followed repo now. `force` ignores the stored validators (a full read).
#[tauri::command]
pub async fn repo_follow_check(state: State<'_, AppState>, handle: tauri::AppHandle, url: String, password: Option<String>, force: Option<bool>) -> Result<FollowCheck, String> {
    let key = normalize_repo_url(&url);
    let (mut follow, name) = {
        let data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        let r = data.settings.connected_server_repos.iter().find(|r| normalize_repo_url(&r.url) == key);
        (r.and_then(|r| r.follow.clone()).unwrap_or_default(), r.map(|r| r.name.clone()).unwrap_or_default())
    };
    if force.unwrap_or(false) { follow.etag = None; follow.last_modified = None; follow.digest = None; }
    let creator_id = crate::commands::security::get_creator_id(handle).ok();
    let game_running = crate::governor::runtime::global().game_mode().0;
    let mut out = FollowCheck { url: url.clone(), name, action: follow.action.clone(), game_running, ..Default::default() };

    match probe(&url, creator_id.as_deref(), password.as_deref(), &follow).await {
        Ok(Probe::NotModified) => {
            out.not_modified = true;
            out.version = follow.last_version.clone();
            follow.last_error = None;
        }
        Ok(Probe::Body { etag, last_modified, digest, body }) => {
            // The body is the manifest; a legacy one reads through the upgrade, anything else
            // (a folder listing, a discovered repo) through the full reader.
            let parsed: Option<ServerRepo> = serde_json::from_str(body.trim_start_matches('\u{feff}')).ok()
                .or_else(|| crate::commands::repo_convert::read_legacy(&body));
            let repo = match parsed {
                Some(r) => Ok(r),
                None => crate::commands::repo::fetch_repo_info(url.clone(), creator_id.clone(), password.clone()).await,
            };
            match repo {
                Ok(repo) => {
                    {
                        let data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
                        out.updates = updates_for_repo(&data.mods, &url, &repo);
                        out.plan = apply_plan(&data.mods, &data.profiles, &repo, &out.updates);
                    }
                    out.version = Some(repo.version.clone());
                    follow.etag = etag;
                    follow.last_modified = last_modified;
                    follow.digest = Some(digest);
                    follow.last_version = Some(repo.version);
                    follow.last_updates = out.updates.len() as u32;
                    follow.last_error = None;
                }
                Err(e) => { follow.last_error = Some(e.clone()); out.error = Some(e); }
            }
        }
        Err(e) => { follow.last_error = Some(e.clone()); out.error = Some(e); }
    }
    follow.last_check = Some(chrono::Utc::now().to_rfc3339());
    {
        let mut data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        if let Some(r) = data.settings.connected_server_repos.iter_mut().find(|r| normalize_repo_url(&r.url) == key) {
            // Only the check's own fields: the user may have changed the settings meanwhile.
            if let Some(f) = r.follow.as_mut() {
                f.etag = follow.etag; f.last_modified = follow.last_modified; f.digest = follow.digest;
                f.last_check = follow.last_check; f.last_version = follow.last_version;
                f.last_updates = follow.last_updates; f.last_error = follow.last_error;
            }
        }
    }
    let _ = state.save();
    Ok(out)
}

// ── The feed the built-in server serves ─────────────────────────────────────────────────────

fn xml(s: &str) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').collect::<String>()
        .replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// An Atom feed of a repo: one entry per mod and version, so any feed reader (and BMM's own
/// scheduler « new item in a feed » trigger) sees a new entry when a mod's version moves.
/// `base` is the address the client asked on; `updated` the manifest's modification time.
pub fn atom_feed(repo: &ServerRepo, base: &str, updated: chrono::DateTime<chrono::Utc>) -> String {
    let base = base.trim_end_matches('/');
    let when = updated.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n");
    s.push_str(&format!("  <title>{}</title>\n  <id>{}/repo.json</id>\n  <updated>{}</updated>\n", xml(&repo.name), xml(base), when));
    s.push_str(&format!("  <link rel=\"alternate\" type=\"application/json\" href=\"{}/repo.json\"/>\n", xml(base)));
    if let Some(a) = repo.author.as_deref().filter(|a| !a.is_empty()) { s.push_str(&format!("  <author><name>{}</name></author>\n", xml(a))); }
    let mut seen = std::collections::HashSet::new();
    for p in &repo.profiles {
        for m in &p.mods {
            if !seen.insert((m.id.clone(), m.version.clone())) { continue; }
            s.push_str("  <entry>\n");
            s.push_str(&format!("    <title>{} {}</title>\n", xml(&m.name), xml(&m.version)));
            s.push_str(&format!("    <id>{}/repo.json#{}@{}</id>\n", xml(base), xml(&m.id), xml(&m.version)));
            s.push_str(&format!("    <updated>{}</updated>\n", when));
            let summary = m.changelog.as_deref().or(m.description.as_deref()).unwrap_or("");
            if !summary.is_empty() { s.push_str(&format!("    <summary>{}</summary>\n", xml(summary))); }
            s.push_str("  </entry>\n");
        }
    }
    s.push_str("</feed>\n");
    s
}

/// The validator of a served body: a strong ETag over exactly the bytes sent.
pub fn etag_of(body: &[u8]) -> String {
    format!("\"{}\"", &hex::encode(Sha256::digest(body))[..32])
}

/// Does an `If-None-Match` header match this ETag (a list, `*`, or a weak form)?
pub fn etag_matches(if_none_match: Option<&str>, etag: &str) -> bool {
    let Some(h) = if_none_match else { return false };
    h.split(',').map(|t| t.trim().trim_start_matches("W/")).any(|t| t == "*" || t == etag)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn versions_compare_as_numbers_and_never_offer_a_downgrade() {
        assert_eq!(version_cmp("1.10.0", "1.9.0"), Some(Ordering::Greater));
        assert_eq!(version_cmp("v2", "2.0.0"), Some(Ordering::Equal));
        assert_eq!(version_cmp("1.0.0-beta", "1.0.0"), Some(Ordering::Less));
        assert_eq!(version_cmp("1.0.0+build7", "1.0.0"), Some(Ordering::Equal));
        assert_eq!(version_cmp("summer-2026", "1.0"), None);
        assert_eq!(update_reason("1.9", None, "1.10", None), Some("version"));
        assert_eq!(update_reason("1.0.0", None, "1.0", None), None, "the same version written two ways");
        assert_eq!(update_reason("2.0", None, "1.5", None), None, "a downgrade is not an update");
        assert_eq!(update_reason("alpha", None, "beta", None), Some("version"), "not numbers: different = update");
        assert_eq!(update_reason(" Alpha ", None, "alpha", None), None);
    }

    #[test]
    fn same_version_with_other_files_is_a_content_update() {
        assert_eq!(update_reason("1.0", Some("aa"), "1.0", Some("bb")), Some("content"));
        assert_eq!(update_reason("1.0", Some("aa"), "1.0", Some("AA")), None);
        assert_eq!(update_reason("1.0", None, "1.0", Some("bb")), None, "no fingerprint recorded: the version decides");
    }

    fn repo_with(mods: serde_json::Value) -> ServerRepo {
        serde_json::from_value(serde_json::json!({
            "name": "R", "description": null, "author": "a", "version": "3", "game_name": "g", "created_at": "",
            "profiles": [{ "id": "p", "name": "P", "game_name": "g", "mods": mods }]
        })).unwrap()
    }
    fn rmod(id: &str, v: &str, hash: &str) -> serde_json::Value {
        serde_json::json!({ "id": id, "name": id, "version": v, "author": null, "description": null, "tags": [], "download_links": [],
            "files": [{ "relative_path": "a.txt", "size": 1, "sha256_hash": hash }] })
    }

    #[test]
    fn updates_are_found_for_the_mods_linked_to_that_repo_only() {
        let repo = repo_with(serde_json::json!([rmod("alpha", "1.1", "x"), rmod("beta", "1.0", "y"), rmod("gamma", "1.0", "z")]));
        let mut a = ModEntry::new("Alpha".into(), PathBuf::from("C:/m/a"));
        a.source_repo = Some("http://host/repo".into()); a.repo_mod_id = Some("alpha".into()); a.version = "1.0".into();
        let mut b = ModEntry::new("Beta".into(), PathBuf::from("C:/m/b"));
        b.source_repo = Some("http://host/repo".into()); b.repo_mod_id = Some("beta".into()); b.version = "1.0".into();
        b.repo_content_hash = Some("old".into());
        let mut c = ModEntry::new("Gamma elsewhere".into(), PathBuf::from("C:/m/c"));
        c.source_repo = Some("http://other/repo".into()); c.repo_mod_id = Some("gamma".into()); c.version = "0.1".into();
        let ups = updates_for_repo(&[a, b, c], "http://HOST/repo/repo.json", &repo);
        let names: Vec<_> = ups.iter().map(|u| (u.name.as_str(), u.detail.as_deref())).collect();
        assert_eq!(names, vec![("Alpha", None), ("Beta", Some("content"))], "gamma lives in another repo");
    }

    #[test]
    fn the_apply_plan_groups_updates_per_local_profile_and_keeps_the_enabled_ones() {
        let mut repo = repo_with(serde_json::json!([rmod("alpha", "1.1", "x"), rmod("beta", "2.0", "y")]));
        let mut p2 = repo.profiles[0].clone();
        p2.id = "q".into();
        repo.profiles.push(p2);
        let mut a = ModEntry::new("Alpha".into(), PathBuf::from("C:/A/mods/alpha_x"));
        a.id = "alpha".into(); a.source_repo = Some("http://host/repo".into()); a.repo_mod_id = Some("alpha".into()); a.version = "1.0".into();
        let mut b = ModEntry::new("Beta".into(), PathBuf::from("C:/B/mods/beta_x"));
        b.id = "beta".into(); b.source_repo = Some("http://host/repo".into()); b.repo_mod_id = Some("beta".into()); b.version = "1.0".into();
        let mut orphan = ModEntry::new("Lost".into(), PathBuf::from("D:/elsewhere/beta_x"));
        orphan.id = "beta~z".into(); orphan.source_repo = Some("http://host/repo".into()); orphan.repo_mod_id = Some("beta".into()); orphan.version = "1.0".into();
        let mk = |id: &str, mods: &str, active: &[&str], origin: Option<&str>| {
            let mut p = crate::models::profile::Profile::new(id.into(), String::new(), PathBuf::new(), PathBuf::from(mods), PathBuf::new());
            p.id = id.into();
            p.active_mods = active.iter().map(|s| s.to_string()).collect();
            p.origin_repo_profile_id = origin.map(str::to_string);
            p
        };
        let profiles = vec![mk("A", "C:/A/mods", &["alpha"], None), mk("B", "C:/B/mods", &[], Some("q"))];
        let mods = vec![a, b, orphan];
        let ups = updates_for_repo(&mods, "http://host/repo", &repo);
        assert_eq!(ups.len(), 3);
        let plan = apply_plan(&mods, &profiles, &repo, &ups);
        assert_eq!(plan.len(), 2, "the record in no profile folder is left out: {plan:?}");
        assert_eq!((plan[0].local_profile_id.as_str(), plan[0].repo_profile_id.as_str()), ("A", "p"));
        assert_eq!(plan[0].enabled_local_ids, vec!["alpha".to_string()]);
        assert_eq!((plan[1].local_profile_id.as_str(), plan[1].repo_profile_id.as_str()), ("B", "q"), "the profile it came from");
        assert!(plan[1].enabled_local_ids.is_empty());
        assert_eq!(plan[1].repo_mod_ids, vec!["beta".to_string()]);
    }

    #[test]
    fn the_newest_copy_of_an_id_wins_across_repo_profiles() {
        let mut repo = repo_with(serde_json::json!([rmod("alpha", "1.0", "x")]));
        let mut p2 = repo.profiles[0].clone();
        p2.mods[0].version = "1.2".into();
        repo.profiles.push(p2);
        assert_eq!(manifest_index(&repo)["alpha"].version, "1.2");
    }

    #[test]
    fn due_follows_the_interval_and_the_switch() {
        let now = chrono::Utc::now();
        let mut f = RepoFollow::default();
        assert!(is_due(&f, now), "never checked");
        f.last_check = Some((now - chrono::Duration::minutes(30)).to_rfc3339());
        assert!(!is_due(&f, now));
        f.interval_min = 5;
        assert!(is_due(&f, now), "5 is raised to the 15-minute floor, and 30 > 15");
        f.enabled = false;
        assert!(!is_due(&f, now));
        assert_eq!(normalize_action("APPLY"), "apply");
        assert_eq!(normalize_action("rm -rf"), "notify");
    }

    #[test]
    fn the_feed_is_valid_xml_shape_and_escapes() {
        let repo = repo_with(serde_json::json!([rmod("a<b", "1.0 & co", "x")]));
        let f = atom_feed(&repo, "http://h:8080/", chrono::Utc::now());
        assert!(f.starts_with("<?xml") && f.trim_end().ends_with("</feed>"));
        assert!(f.contains("a&lt;b") && f.contains("1.0 &amp; co") && !f.contains("a<b"));
        assert!(f.contains("<id>http://h:8080/repo.json#"));
    }

    #[test]
    fn etags_match_lists_weak_forms_and_star() {
        let e = etag_of(b"hello");
        assert!(etag_matches(Some(&e), &e));
        assert!(etag_matches(Some(&format!("\"x\", W/{e}")), &e));
        assert!(etag_matches(Some("*"), &e));
        assert!(!etag_matches(Some("\"nope\""), &e));
        assert!(!etag_matches(None, &e));
    }
}
