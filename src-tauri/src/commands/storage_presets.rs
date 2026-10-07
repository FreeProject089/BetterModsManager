//! Storage Manager rule presets: one click that writes a coherent set of storage rules for
//! THIS PC, with a preview of every change before it is applied, and an undo.
//!
//! A preset only writes what the storage rules can actually express:
//!   · the governor's work intensity (Silent / Balanced / Max),
//!   · per disk × per operation rules (buffer, operations at once, I/O priority),
//!   · the space alerts (on/off, the warning and critical free-space thresholds).
//!
//! It never moves a folder: where a profile keeps its game, mods and backups is set per
//! profile. That is why there is no "put everything on another disk" preset — a rule paces
//! work on a disk, it does not choose the disk. It never touches a disk's speed cap either
//! (the `*` rule's MB/s, set by hand or by the benchmark in Disks & space): a cap in force is
//! carried into the plan, so a preset cannot silently undo a measurement.
//!
//! "Adapted to the PC": the drives are read once (sysinfo for size and free space, the
//! read-only IOCTL in hw_detect for the bus and the seek penalty, the profiles for which drive
//! holds the game, the mods and the backups). The plan names real drives and its thresholds
//! scale with the smallest drive the profiles use. Everything below `profile()` is pure.
//!
//! Laya is not asked. Laya is a text classifier; the recommendation here is a function of
//! measured facts (kinds, sizes, free space, cores), and a model reading a description of
//! those facts could only agree with the rule or contradict a measurement.
use crate::governor::config::{normalize_disk_key, IoPriority, IoRule, Preset};
use crate::governor::runtime::global;
use crate::state::AppState;
use serde::Serialize;
use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use tauri::State;

pub type Rules = BTreeMap<String, BTreeMap<String, IoRule>>;

pub const PRESET_IDS: [&str; 6] = ["balanced", "quiet", "performance", "ssd_hdd", "space_watch", "external"];

/// What a drive is, as far as a preset cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DriveKind { Nvme, Ssd, Hdd, Network, Cloud, Unknown }

impl DriveKind {
    fn is_flash(self) -> bool { matches!(self, DriveKind::Nvme | DriveKind::Ssd) }
}

#[derive(Debug, Clone, Serialize)]
pub struct Drive {
    /// The rule key (`d:\`, a UNC share, `/`).
    pub key: String,
    pub label: String,
    pub kind: DriveKind,
    /// Removable, or on a USB bus.
    pub external: bool,
    pub system: bool,
    pub total_bytes: u64,
    pub free_bytes: u64,
    /// "game", "mods", "backup": what the profiles keep there.
    pub roles: Vec<String>,
}

impl Drive {
    fn used_by_profiles(&self) -> bool { !self.roles.is_empty() }
    fn local(&self) -> bool { !matches!(self.kind, DriveKind::Network | DriveKind::Cloud) }
    fn free_pct(&self) -> f64 { if self.total_bytes == 0 { 100.0 } else { self.free_bytes as f64 * 100.0 / self.total_bytes as f64 } }
}

#[derive(Debug, Clone, Serialize)]
pub struct PcProfile {
    pub drives: Vec<Drive>,
    pub cores: usize,
}

/// What a preset compares itself with: the stored document and the alert settings.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Current {
    pub preset: Preset,
    pub rules: Rules,
    pub alert: Alert,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
pub struct Alert { pub enabled: bool, pub warning_pct: u32, pub critical_pct: u32 }

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub id: &'static str,
    /// False when this PC has nothing the preset is for (no HDD for "SSD + HDD", no external
    /// drive for "External drives"). The plan is still built, empty of rules.
    pub available: bool,
    pub preset: Preset,
    pub rules: Rules,
    pub alert: Alert,
    /// Why each rule is there, for the preview: (code, drive key).
    pub notes: Vec<(String, String)>,
    pub changes: Changes,
    /// A hash of (preset, rules, alert). Apply refuses a plan that no longer matches the one
    /// previewed (a drive plugged in between the two, another window's edit).
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Changes {
    pub preset: Option<(Preset, Preset)>,
    pub alert: Option<(Alert, Alert)>,
    pub rules: Vec<RuleChange>,
}

impl Changes {
    pub fn is_empty(&self) -> bool { self.preset.is_none() && self.alert.is_none() && self.rules.is_empty() }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RuleChange {
    pub disk: String,
    pub op: String,
    pub before: Option<IoRule>,
    pub after: Option<IoRule>,
}

// ── Thresholds ──────────────────────────────────────────────────────────────────────────────

const GB: u64 = 1_000_000_000;

/// The space alert thresholds for this PC. They are FREE-space percentages (mods.rs: enabling
/// mods warns at or under `warning_pct` free and refuses at or under `critical_pct`), so a
/// fixed percentage is wrong both ways: 10 % of a 4 TB disk is 400 GB, of a 120 GB SSD 12 GB.
/// Aim for about 30 GB free (warning) and 10 GB (critical) on the SMALLEST drive the profiles
/// use, within 10..=40 % and 3..=30 %, the critical always 5 points under the warning.
/// `strict` (Watch the space) adds 10 and 5 points.
pub fn thresholds(p: &PcProfile, strict: bool) -> Alert {
    let pool: Vec<&Drive> = { let u: Vec<&Drive> = p.drives.iter().filter(|d| d.used_by_profiles() && d.total_bytes > 0).collect(); if u.is_empty() { p.drives.iter().filter(|d| d.local() && d.total_bytes > 0).collect() } else { u } };
    let smallest = pool.iter().map(|d| d.total_bytes).min().unwrap_or(1000 * GB);
    let pct = |bytes: u64| ((bytes as f64 * 100.0) / smallest as f64).ceil() as u32;
    let mut warning = pct(30 * GB).clamp(10, 40);
    let mut critical = pct(10 * GB).clamp(3, 30);
    if strict { warning = (warning + 10).min(50); critical = (critical + 5).min(40); }
    if critical + 5 > warning { critical = warning.saturating_sub(5).max(1); }
    Alert { enabled: true, warning_pct: warning, critical_pct: critical }
}

// ── The presets ─────────────────────────────────────────────────────────────────────────────

fn rule(buffer: Option<u32>, parallel: Option<u32>, io: Option<IoPriority>) -> IoRule {
    IoRule { rate_mb_s: None, parallel, buffer_kib: buffer, io_priority: io }
}

/// The drives a preset acts on: those the profiles use, or every local drive when no profile
/// exists yet (a fresh install still gets a plan that names its disks).
fn targets(p: &PcProfile) -> Vec<&Drive> {
    let used: Vec<&Drive> = p.drives.iter().filter(|d| d.used_by_profiles()).collect();
    if used.is_empty() { p.drives.iter().filter(|d| d.local()).collect() } else { used }
}

/// Build a preset for this PC, measured against what is in force now. Pure.
pub fn build(id: &str, p: &PcProfile, cur: &Current) -> Option<Plan> {
    let id: &'static str = PRESET_IDS.iter().copied().find(|x| *x == id)?;
    let mut rules: Rules = BTreeMap::new();
    let mut notes: Vec<(String, String)> = Vec::new();
    let put = |rules: &mut Rules, disk: &str, op: &str, r: IoRule| { rules.entry(disk.to_string()).or_default().insert(op.to_string(), r); };
    let all = &p.drives;
    let flash = all.iter().filter(|d| d.local() && d.kind.is_flash()).count();
    let hdds = all.iter().filter(|d| d.local() && d.kind == DriveKind::Hdd).count();
    let externals: Vec<&Drive> = all.iter().filter(|d| d.external && d.local()).collect();
    let (preset, alert, available) = match id {
        "balanced" => (Preset::Balanced, thresholds(p, false), true),
        "quiet" => (Preset::Silent, thresholds(p, false), true),
        "performance" => (Preset::Max, thresholds(p, false), flash > 0),
        "space_watch" => (Preset::Balanced, thresholds(p, true), true),
        "ssd_hdd" => {
            let ok = flash > 0 && hdds > 0;
            if ok {
                for d in all.iter().filter(|d| d.local()) {
                    if d.kind == DriveKind::Hdd {
                        // A hard disk pays for every seek: smaller copy steps, one backup at a
                        // time, backups and archive writing behind everything else.
                        put(&mut rules, &d.key, "*", rule(Some(512), None, None));
                        put(&mut rules, &d.key, "backup", rule(None, Some(1), Some(IoPriority::Low)));
                        put(&mut rules, &d.key, "compress", rule(None, None, Some(IoPriority::Low)));
                        notes.push(("hdd".into(), d.key.clone()));
                    } else if d.kind.is_flash() {
                        // Flash takes big steps: installs and extraction in 4 MiB chunks.
                        put(&mut rules, &d.key, "install", rule(Some(4096), None, None));
                        put(&mut rules, &d.key, "extract", rule(Some(4096), None, None));
                        notes.push(("flash".into(), d.key.clone()));
                    }
                }
            }
            (Preset::Balanced, thresholds(p, false), ok)
        }
        "external" => {
            for d in &externals {
                put(&mut rules, &d.key, "*", rule(Some(256), None, Some(IoPriority::Low)));
                put(&mut rules, &d.key, "backup", rule(None, Some(1), None));
                notes.push(("external".into(), d.key.clone()));
            }
            (Preset::Balanced, thresholds(p, false), !externals.is_empty())
        }
        _ => return None,
    };
    if id == "performance" {
        for d in all.iter().filter(|d| d.local() && d.kind == DriveKind::Hdd) {
            // Max gives a hard disk one copy at a time already; it keeps its backups behind
            // the game's own reads.
            put(&mut rules, &d.key, "backup", rule(None, None, Some(IoPriority::Low)));
            notes.push(("hdd_backup".into(), d.key.clone()));
        }
    }
    // The speed caps in force stay: they are Disks & space's (and the benchmark's), not ours.
    for (disk, ops) in &cur.rules {
        if let Some(rate) = ops.get("*").and_then(|r| r.rate_mb_s) {
            rules.entry(disk.clone()).or_default().entry("*".into()).or_default().rate_mb_s = Some(rate);
            notes.push(("cap_kept".into(), disk.clone()));
        }
    }
    let changes = diff(cur, preset, &rules, alert);
    let fingerprint = fingerprint(preset, &rules, alert);
    Some(Plan { id, available, preset, rules, alert, notes, changes, fingerprint })
}

/// Which preset fits this PC best, and why (reason codes, translated by the UI). Pure.
pub fn recommend(p: &PcProfile) -> (&'static str, Vec<String>) {
    let t = targets(p);
    let mut why = Vec::new();
    if t.iter().any(|d| d.total_bytes > 0 && d.free_pct() < 15.0) {
        why.push("low_space".into());
        return ("space_watch", why);
    }
    let flash = p.drives.iter().any(|d| d.local() && d.kind.is_flash());
    let hdd = p.drives.iter().any(|d| d.local() && d.kind == DriveKind::Hdd);
    if flash && hdd && t.iter().any(|d| d.kind == DriveKind::Hdd) {
        why.push("ssd_and_hdd".into());
        return ("ssd_hdd", why);
    }
    if t.iter().any(|d| d.external) {
        why.push("external_used".into());
        return ("external", why);
    }
    if !t.is_empty() && t.iter().all(|d| d.kind.is_flash()) && p.cores >= 8 {
        why.push("all_flash_many_cores".into());
        return ("performance", why);
    }
    if p.cores <= 4 {
        why.push("few_cores".into());
        return ("quiet", why);
    }
    why.push("default".into());
    ("balanced", why)
}

/// Every difference between what is in force and the plan. Pure.
pub fn diff(cur: &Current, preset: Preset, rules: &Rules, alert: Alert) -> Changes {
    let mut out = Changes::default();
    if cur.preset != preset { out.preset = Some((cur.preset, preset)); }
    if cur.alert != alert { out.alert = Some((cur.alert, alert)); }
    let mut keys: Vec<(String, String)> = Vec::new();
    for (d, ops) in cur.rules.iter().chain(rules.iter()) {
        for o in ops.keys() { let k = (d.clone(), o.clone()); if !keys.contains(&k) { keys.push(k); } }
    }
    keys.sort();
    for (d, o) in keys {
        let before = cur.rules.get(&d).and_then(|m| m.get(&o)).cloned().filter(|r| *r != IoRule::default());
        let after = rules.get(&d).and_then(|m| m.get(&o)).cloned().filter(|r| *r != IoRule::default());
        if before != after { out.rules.push(RuleChange { disk: d, op: o, before, after }); }
    }
    out
}

pub fn fingerprint(preset: Preset, rules: &Rules, alert: Alert) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(&(preset, rules)).unwrap_or_default().hash(&mut h);
    alert.hash(&mut h);
    format!("{:016x}", h.finish())
}

// ── The machine ─────────────────────────────────────────────────────────────────────────────

/// Read the drives and the profiles. Blocking: one sysinfo enumeration and one read-only
/// IOCTL per drive letter (access 0, no data read, no admin right).
pub fn profile(state: &AppState) -> PcProfile {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let system = std::env::var("SystemDrive").ok().and_then(|s| normalize_disk_key(&s));
    let profiles: Vec<(String, String, String)> = state.data.lock().map(|d| d.profiles.iter().map(|p| {
        let n = |x: &std::path::Path| crate::commands::disk::strip_verbatim(&x.to_string_lossy().to_lowercase());
        (n(&p.game_path), n(&p.mods_path), n(&p.backup_path))
    }).collect()).unwrap_or_default();
    let mut drives: Vec<Drive> = Vec::new();
    for d in disks.iter() {
        let mount = d.mount_point().to_string_lossy().to_string();
        let Some(key) = normalize_disk_key(&mount) else { continue };
        if drives.iter().any(|x| x.key == key) { continue; }
        let name = d.name().to_string_lossy().to_string();
        let hw = crate::hw_detect::disk(&mount);
        let cloud = crate::commands::disk::detect_cloud_provider(&mount, &name);
        let kind = match (cloud.as_deref(), hw.bus.as_str(), hw.seek_penalty, d.kind()) {
            (Some("Network / NAS"), ..) => DriveKind::Network,
            (Some(_), ..) => DriveKind::Cloud,
            (_, "nvme", ..) => DriveKind::Nvme,
            (_, _, Some(true), _) => DriveKind::Hdd,
            (_, _, Some(false), _) => DriveKind::Ssd,
            (_, _, None, sysinfo::DiskKind::HDD) => DriveKind::Hdd,
            (_, _, None, sysinfo::DiskKind::SSD) => DriveKind::Ssd,
            _ => DriveKind::Unknown,
        };
        let mp = crate::commands::disk::strip_verbatim(&mount.to_lowercase());
        let mut roles: Vec<String> = Vec::new();
        for (g, m, b) in &profiles {
            for (path, role) in [(g, "game"), (m, "mods"), (b, "backup")] {
                if !path.is_empty() && path.starts_with(&mp) && !roles.iter().any(|r| r == role) { roles.push(role.to_string()); }
            }
        }
        drives.push(Drive {
            system: system.as_deref() == Some(key.as_str()),
            key,
            label: if name.is_empty() { mount.clone() } else { name },
            kind,
            external: d.is_removable() || hw.bus == "usb",
            total_bytes: d.total_space(),
            free_bytes: d.available_space(),
            roles,
        });
    }
    drives.sort_by(|a, b| a.key.cmp(&b.key));
    PcProfile { drives, cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) }
}

fn current(state: &AppState) -> Result<Current, String> {
    let d = state.data.lock().map_err(|_| "state lock".to_string())?;
    Ok(Current {
        preset: d.resources.preset,
        rules: d.resources.rules.clone(),
        alert: Alert { enabled: d.settings.storage_alert_enabled, warning_pct: d.settings.storage_warning_space_pct, critical_pct: d.settings.storage_critical_space_pct },
    })
}

/// What one Undo puts back: the document and the alerts as they were before the last apply.
#[derive(Debug, Clone)]
struct Snapshot { id: &'static str, cur: Current }
static UNDO: Mutex<Option<Snapshot>> = Mutex::new(None);

#[derive(Debug, Serialize)]
pub struct Overview {
    pub profile: PcProfile,
    pub recommended: &'static str,
    pub reasons: Vec<String>,
    pub plans: Vec<Plan>,
    /// The preset the last apply wrote, while its undo is still possible.
    pub undo: Option<&'static str>,
}

/// Every preset built for this PC, each with its changes against what is in force. Read-only.
#[tauri::command]
pub async fn storage_presets(app: tauri::AppHandle) -> Result<Overview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let profile = profile(&state);
        let cur = current(&state)?;
        let (recommended, reasons) = recommend(&profile);
        let plans = PRESET_IDS.iter().filter_map(|id| build(id, &profile, &cur)).collect();
        let undo = UNDO.lock().ok().and_then(|u| u.as_ref().map(|s| s.id));
        Ok(Overview { profile, recommended, reasons, plans, undo })
    }).await.map_err(|e| e.to_string())?
}

fn write(state: &AppState, preset: Preset, rules: Rules, alert: Alert) -> Result<(), String> {
    let cfg = {
        let mut d = state.data.lock().map_err(|_| "state lock".to_string())?;
        d.resources.preset = preset;
        d.resources.rules = rules;
        d.settings.storage_alert_enabled = alert.enabled;
        d.settings.storage_warning_space_pct = alert.warning_pct;
        d.settings.storage_critical_space_pct = alert.critical_pct;
        d.resources.clone()
    };
    global().configure(cfg);
    state.save().map_err(|e| e.to_string())
}

/// Apply the preset `id`, provided it still is the plan the preview showed (`fingerprint`).
/// The previous state is kept for one Undo. Every rule goes through the same validation as a
/// hand-typed one.
#[tauri::command]
pub async fn storage_preset_apply(app: tauri::AppHandle, id: String, fingerprint: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let profile = profile(&state);
        let cur = current(&state)?;
        let plan = build(&id, &profile, &cur).ok_or_else(|| format!("unknown preset: {id}"))?;
        if !plan.available { return Err(format!("the preset {id} has nothing to act on on this PC")); }
        if plan.fingerprint != fingerprint { return Err("stale: the drives or the rules changed since the preview, check it again".into()); }
        // Nothing to change: nothing written, and the undo still holds what the LAST real apply replaced.
        if plan.changes.is_empty() { return Ok(()); }
        for ops in plan.rules.values() { for r in ops.values() { crate::governor::config::validate_rule(r)?; } }
        write(&state, plan.preset, plan.rules, plan.alert)?;
        if let Ok(mut u) = UNDO.lock() { *u = Some(Snapshot { id: plan.id, cur }); }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// Put back what the last apply replaced. False when there is nothing to undo.
#[tauri::command]
pub async fn storage_preset_undo(state: State<'_, AppState>) -> Result<bool, String> {
    let snap = UNDO.lock().map_err(|_| "undo lock".to_string())?.take();
    let Some(s) = snap else { return Ok(false) };
    write(&state, s.cur.preset, s.cur.rules, s.cur.alert)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drive(key: &str, kind: DriveKind, total_gb: u64, free_gb: u64, roles: &[&str]) -> Drive {
        Drive { key: key.into(), label: key.into(), kind, external: false, system: key == "c:\\", total_bytes: total_gb * GB, free_bytes: free_gb * GB, roles: roles.iter().map(|s| s.to_string()).collect() }
    }
    fn pc(drives: Vec<Drive>, cores: usize) -> PcProfile { PcProfile { drives, cores } }
    fn cur() -> Current { Current { preset: Preset::Balanced, rules: BTreeMap::new(), alert: Alert { enabled: false, warning_pct: 40, critical_pct: 30 } } }

    #[test]
    fn every_id_builds_and_unknown_ids_do_not() {
        let p = pc(vec![drive("c:\\", DriveKind::Nvme, 500, 200, &["game"])], 8);
        for id in PRESET_IDS { assert!(build(id, &p, &cur()).is_some(), "{id}"); }
        assert!(build("archive_elsewhere", &p, &cur()).is_none());
    }

    #[test]
    fn ssd_plus_hdd_names_the_real_drives() {
        let p = pc(vec![drive("c:\\", DriveKind::Ssd, 250, 80, &["game"]), drive("d:\\", DriveKind::Hdd, 4000, 3000, &["mods", "backup"])], 8);
        let plan = build("ssd_hdd", &p, &cur()).unwrap();
        assert!(plan.available);
        let d = &plan.rules["d:\\"];
        assert_eq!(d["*"].buffer_kib, Some(512));
        assert_eq!(d["backup"].parallel, Some(1));
        assert_eq!(d["backup"].io_priority, Some(IoPriority::Low));
        assert_eq!(plan.rules["c:\\"]["install"].buffer_kib, Some(4096));
        assert_eq!(recommend(&p).0, "ssd_hdd");
        // Not offered on a PC without a hard disk.
        let flash_only = pc(vec![drive("c:\\", DriveKind::Ssd, 250, 80, &["game"])], 8);
        let none = build("ssd_hdd", &flash_only, &cur()).unwrap();
        assert!(!none.available && none.rules.is_empty());
    }

    #[test]
    fn every_rule_a_preset_writes_passes_the_hand_typed_validation() {
        let mut ext = drive("e:\\", DriveKind::Ssd, 1000, 900, &["backup"]);
        ext.external = true;
        let p = pc(vec![drive("c:\\", DriveKind::Nvme, 1000, 500, &["game"]), drive("d:\\", DriveKind::Hdd, 2000, 1500, &["mods"]), ext], 16);
        for id in PRESET_IDS {
            let plan = build(id, &p, &cur()).unwrap();
            for ops in plan.rules.values() { for r in ops.values() { crate::governor::config::validate_rule(r).unwrap(); } }
            for (disk, ops) in &plan.rules {
                assert!(normalize_disk_key(disk).is_some(), "{disk}");
                for op in ops.keys() { assert!(op == "*" || crate::governor::config::OpKind::ALL.iter().any(|k| k.key() == op), "{op}"); }
            }
        }
    }

    #[test]
    fn thresholds_scale_with_the_smallest_drive_the_profiles_use() {
        let small = thresholds(&pc(vec![drive("c:\\", DriveKind::Ssd, 120, 50, &["game"]), drive("d:\\", DriveKind::Hdd, 4000, 10, &[])], 8), false);
        let big = thresholds(&pc(vec![drive("c:\\", DriveKind::Ssd, 2000, 500, &["game"])], 8), false);
        assert!(small.warning_pct > big.warning_pct, "{small:?} vs {big:?}");
        assert_eq!(big, Alert { enabled: true, warning_pct: 10, critical_pct: 3 });
        for a in [small, big, thresholds(&pc(vec![drive("c:\\", DriveKind::Ssd, 30, 5, &["game"])], 2), true)] {
            assert!(a.critical_pct + 5 <= a.warning_pct && a.warning_pct <= 50 && a.critical_pct >= 1, "{a:?}");
        }
        let strict = thresholds(&pc(vec![drive("c:\\", DriveKind::Ssd, 2000, 500, &["game"])], 8), true);
        assert!(strict.warning_pct > big.warning_pct);
    }

    #[test]
    fn a_speed_cap_in_force_is_kept_and_the_preview_lists_what_goes() {
        let mut c = cur();
        c.rules.entry("d:\\".into()).or_default().insert("*".into(), IoRule { rate_mb_s: Some(80), buffer_kib: Some(2048), ..Default::default() });
        c.rules.entry("d:\\".into()).or_default().insert("hash".into(), IoRule { parallel: Some(3), ..Default::default() });
        let p = pc(vec![drive("c:\\", DriveKind::Ssd, 500, 200, &["game"]), drive("d:\\", DriveKind::Hdd, 2000, 1500, &["mods"])], 8);
        let plan = build("balanced", &p, &c).unwrap();
        assert_eq!(plan.rules["d:\\"]["*"].rate_mb_s, Some(80), "the cap stays");
        assert_eq!(plan.rules["d:\\"]["*"].buffer_kib, None, "the rest of the rule goes");
        let ch = &plan.changes;
        assert!(ch.rules.iter().any(|r| r.op == "hash" && r.after.is_none()), "a removed rule is listed");
        assert!(ch.alert.is_some(), "the alerts turn on");
        assert!(ch.preset.is_none(), "Balanced was in force already");
    }

    #[test]
    fn applying_the_same_plan_twice_changes_nothing_the_second_time() {
        let p = pc(vec![drive("c:\\", DriveKind::Ssd, 500, 200, &["game"]), drive("d:\\", DriveKind::Hdd, 2000, 1500, &["mods"])], 8);
        let plan = build("ssd_hdd", &p, &cur()).unwrap();
        let after = Current { preset: plan.preset, rules: plan.rules.clone(), alert: plan.alert };
        let again = build("ssd_hdd", &p, &after).unwrap();
        assert!(again.changes.is_empty(), "{:?}", again.changes);
        assert_eq!(again.fingerprint, plan.fingerprint);
        assert_ne!(build("quiet", &p, &after).unwrap().fingerprint, plan.fingerprint);
    }

    #[test]
    fn the_recommendation_follows_the_machine() {
        assert_eq!(recommend(&pc(vec![drive("c:\\", DriveKind::Ssd, 500, 20, &["game"])], 8)).0, "space_watch");
        let mut usb = drive("e:\\", DriveKind::Ssd, 1000, 900, &["mods"]);
        usb.external = true;
        assert_eq!(recommend(&pc(vec![drive("c:\\", DriveKind::Ssd, 500, 200, &["game"]), usb], 8)).0, "external");
        assert_eq!(recommend(&pc(vec![drive("c:\\", DriveKind::Nvme, 1000, 600, &["game", "mods"])], 12)).0, "performance");
        assert_eq!(recommend(&pc(vec![drive("c:\\", DriveKind::Ssd, 1000, 600, &["game"])], 4)).0, "quiet");
        assert_eq!(recommend(&pc(vec![drive("c:\\", DriveKind::Ssd, 1000, 600, &["game"])], 6)).0, "balanced");
        // A hard disk nobody's profile uses does not make the SSD + HDD preset the advice.
        assert_eq!(recommend(&pc(vec![drive("c:\\", DriveKind::Ssd, 1000, 600, &["game"]), drive("d:\\", DriveKind::Hdd, 2000, 1500, &[])], 6)).0, "balanced");
    }
}
