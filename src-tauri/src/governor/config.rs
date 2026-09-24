//! The resource governor's configuration: presets, per-disk × per-operation I/O rules, and
//! the hard bounds nothing may cross (PLAN-BMM-RESOURCES-2026.md, §1 and §3; phase G0).
//!
//! This file is PURE on purpose: no filesystem, no Windows call, no global. It answers one
//! question, "what policy applies to this operation on this disk", from a stored document,
//! and every caller (the copy engine, the worker, the API, the dashboard) asks it the same way.
//!
//! # Where it lives
//!
//! `AppData.resources`, beside `disk_limits`, and NOT in `AppSettings`: `update_settings`
//! replaces the whole settings object with the copy the frontend holds, so a change made by the
//! API while the Settings screen is open would be overwritten by a stale copy.
//!
//! # The three things it guarantees
//!
//! 1. **Balanced is today.** The default preset resolves to exactly what BMM does now: two copy
//!    threads (one when the game or backup folder is on the system drive), 1 MiB chunks with a
//!    150 µs yield every 16 MiB, the 128 KiB paced path when a disk has a MB/s limit, and a hash
//!    pool of `(cores / 2).clamp(1, 4)`. Nobody's behaviour changes on upgrade.
//! 2. **The old limits carry over.** `disk_limits[mount] = n` becomes the rule
//!    `(mount, *) = { rate: n }`.
//! 3. **The bounds hold whatever the source.** A stored document, the API, the MCP server or a
//!    scheduled task cannot ask for a thread priority above ABOVE_NORMAL, a pool that takes every
//!    core, a buffer outside [64 KiB, 16 MiB], more than 16 parallel operations, more than
//!    256 MiB in flight, or a rate of 0 (which would mean "block forever").

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// What kind of work an operation is. The key of a rule, and the category of a pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    Deploy,
    Install,
    Backup,
    Extract,
    Compress,
    Scan,
    Hash,
    Download,
    Image,
    Maintenance,
}

impl OpKind {
    pub const ALL: [OpKind; 10] = [
        OpKind::Deploy, OpKind::Install, OpKind::Backup, OpKind::Extract, OpKind::Compress,
        OpKind::Scan, OpKind::Hash, OpKind::Download, OpKind::Image, OpKind::Maintenance,
    ];
    /// The key used in stored rules.
    pub fn key(self) -> &'static str {
        match self {
            OpKind::Deploy => "deploy", OpKind::Install => "install", OpKind::Backup => "backup",
            OpKind::Extract => "extract", OpKind::Compress => "compress", OpKind::Scan => "scan",
            OpKind::Hash => "hash", OpKind::Download => "download", OpKind::Image => "image",
            OpKind::Maintenance => "maintenance",
        }
    }
}

/// A named preset. `Custom` means "the rules alone, over Balanced's defaults".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    /// "Quiet while I play": one thread, small buffers, low I/O priority, a quarter of the
    /// measured disk speed, background hashing paused.
    Silent,
    /// Exactly today's behaviour.
    #[default]
    Balanced,
    /// "Everything for BMM": parallelism by disk type, big buffers, no pauses.
    Max,
    Custom,
}

/// Windows I/O priority hint for handles the governor opens. Advisory: NTFS on a local disk
/// honours it; SMB shares and most cloud volumes ignore it, and the UI must say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IoPriority {
    Low,
    Normal,
}

/// Thread priority for the governor's pools. There is no High and no Realtime, on purpose:
/// nothing BMM does is worth starving the game or the desktop for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadPriority {
    Background,
    BelowNormal,
    Normal,
    AboveNormal,
}

/// What kind of disk a path is on, as far as the governor cares (from hardware detection;
/// `Unknown` is treated like an SSD).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DiskKind {
    Nvme,
    Ssd,
    Hdd,
    Network,
    #[default]
    Unknown,
}

/// One stored rule. Every field is optional: an absent field is inherited from the next,
/// less specific rule, and finally from the preset.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IoRule {
    /// MB/s ceiling. `None` = no ceiling. 0 is refused (clamped to 1): it would block forever.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_mb_s: Option<u64>,
    /// How many operations of this kind may run at once on this disk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parallel: Option<u32>,
    /// Copy buffer, KiB.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buffer_kib: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub io_priority: Option<IoPriority>,
}

/// The stored document (`AppData.resources`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourcesConfig {
    /// Bumped when the shape changes; a document without one is version 1.
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub preset: Preset,
    /// disk key (a lower-cased mount point such as `d:\`, or `*`) → op key (or `*`) → rule.
    #[serde(default)]
    pub rules: BTreeMap<String, BTreeMap<String, IoRule>>,
    /// Set once `disk_limits` has been carried into `rules`, so it is not done twice.
    #[serde(default)]
    pub migrated_disk_limits: bool,
}

fn one() -> u32 { 1 }

impl Default for ResourcesConfig {
    fn default() -> Self {
        ResourcesConfig { version: 1, preset: Preset::Balanced, rules: BTreeMap::new(), migrated_disk_limits: false }
    }
}

/// The resolved policy for one operation on one disk. Always within the hard bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IoPolicy {
    pub rate_mb_s: Option<u64>,
    pub parallel: u32,
    pub buffer_kib: u32,
    pub io_priority: IoPriority,
    /// Yield `pause_us` every `pause_every_mib` MiB (the Smart I/O rhythm). `None` = never.
    pub pause_every_mib: Option<u32>,
    pub pause_us: u32,
    pub thread_priority: ThreadPriority,
}

/// What the resolver needs to know about the machine and the target.
#[derive(Debug, Clone, Copy)]
pub struct Target<'a> {
    /// Lower-cased mount point of the disk the operation touches, if known.
    pub disk: Option<&'a str>,
    pub kind: DiskKind,
    /// The game or backup folder is on the system drive (today's "serial I/O" rule).
    pub on_system_drive: bool,
    /// Logical cores.
    pub cores: usize,
}

// ── Hard bounds ──────────────────────────────────────────────────────────────────────────
pub const MIN_BUFFER_KIB: u32 = 64;
pub const MAX_BUFFER_KIB: u32 = 16 * 1024;
pub const MAX_PARALLEL: u32 = 16;
/// parallel × buffer may not exceed this many KiB (256 MiB in flight).
pub const MAX_IN_FLIGHT_KIB: u64 = 256 * 1024;
pub const MAX_THREAD_PRIORITY: ThreadPriority = ThreadPriority::AboveNormal;

/// Pool threads for a category: never every core, the UI keeps one.
pub fn clamp_pool_threads(wanted: usize, cores: usize) -> usize {
    let ceiling = cores.saturating_sub(1).max(1);
    wanted.clamp(1, ceiling)
}

/// The hash pool size today: `(cores / 2).clamp(1, 4)`, kept as Balanced's value.
pub fn balanced_hash_threads(cores: usize) -> usize {
    (cores / 2).clamp(1, 4)
}

/// The size of the global rayon pool main.rs builds (`cpus - 2` above 6 cores, `cpus - 1`
/// above 2, else 2). Kept as Balanced's value for the kinds whose `par_iter`s ran on that
/// global pool before they had one of their own (G3c): zip extraction (`archive.rs`) and the
/// repo export's copy + hash pass (`repo.rs`). Two threads there would have made Balanced a
/// slower BMM than the one people upgraded from, on every machine with more than 3 cores.
pub fn balanced_global_threads(cores: usize) -> usize {
    if cores > 6 { cores - 2 } else if cores > 2 { cores - 1 } else { 2 }
}

/// Pool threads for `op` under `preset`.
pub fn pool_threads(preset: Preset, op: OpKind, cores: usize) -> usize {
    let wanted = match (preset, op) {
        (Preset::Silent, _) => 1,
        (Preset::Max, _) => cores.saturating_sub(1),
        (_, OpKind::Hash) => balanced_hash_threads(cores),
        (_, OpKind::Extract) | (_, OpKind::Compress) => balanced_global_threads(cores),
        (_, _) => 2,
    };
    clamp_pool_threads(wanted, cores)
}

/// Clamp a policy into the hard bounds. Applied to EVERY resolved policy, so a stored
/// document or an API call cannot get past it by being creative.
pub fn clamp(mut p: IoPolicy) -> IoPolicy {
    p.parallel = p.parallel.clamp(1, MAX_PARALLEL);
    p.buffer_kib = p.buffer_kib.clamp(MIN_BUFFER_KIB, MAX_BUFFER_KIB);
    // Shrink the buffer, never the parallelism the user asked for, to stay under the ceiling.
    while (p.parallel as u64) * (p.buffer_kib as u64) > MAX_IN_FLIGHT_KIB && p.buffer_kib > MIN_BUFFER_KIB {
        p.buffer_kib = (p.buffer_kib / 2).max(MIN_BUFFER_KIB);
    }
    if let Some(r) = p.rate_mb_s { p.rate_mb_s = Some(r.max(1)); }
    if p.thread_priority > MAX_THREAD_PRIORITY { p.thread_priority = MAX_THREAD_PRIORITY; }
    p
}

/// The preset's own values for an operation, before any rule.
fn preset_policy(preset: Preset, op: OpKind, t: &Target) -> IoPolicy {
    match preset {
        Preset::Silent => IoPolicy {
            rate_mb_s: None, parallel: 1, buffer_kib: 256, io_priority: IoPriority::Low,
            pause_every_mib: Some(16), pause_us: 150, thread_priority: ThreadPriority::Background,
        },
        Preset::Max => IoPolicy {
            rate_mb_s: None,
            parallel: match t.kind { DiskKind::Nvme => 8, DiskKind::Ssd | DiskKind::Unknown => 4, DiskKind::Hdd => 1, DiskKind::Network => 2 },
            buffer_kib: 4096, io_priority: IoPriority::Normal,
            pause_every_mib: None, pause_us: 0, thread_priority: ThreadPriority::Normal,
        },
        // Balanced and Custom: today's behaviour (see the module doc, point 1).
        Preset::Balanced | Preset::Custom => IoPolicy {
            rate_mb_s: None,
            parallel: if t.on_system_drive { 1 } else { 2 },
            buffer_kib: 1024, io_priority: IoPriority::Normal,
            pause_every_mib: Some(16), pause_us: 150,
            thread_priority: if op == OpKind::Hash || op == OpKind::Maintenance { ThreadPriority::Background } else { ThreadPriority::Normal },
        },
    }
}

impl ResourcesConfig {
    /// The rule chain for (disk, op), most specific first: (disk, op) → (disk, *) → (*, op).
    fn chain<'a>(&'a self, disk: Option<&str>, op: OpKind) -> Vec<&'a IoRule> {
        let mut out = Vec::new();
        let op_key = op.key();
        if let Some(d) = disk {
            if let Some(m) = self.rules.get(d) {
                if let Some(r) = m.get(op_key) { out.push(r); }
                if let Some(r) = m.get("*") { out.push(r); }
            }
        }
        if let Some(m) = self.rules.get("*") {
            if let Some(r) = m.get(op_key) { out.push(r); }
            if let Some(r) = m.get("*") { out.push(r); }
        }
        out
    }

    /// The policy for `op` on `target`. Field by field, the first rule in the chain that sets
    /// it wins; unset fields come from the preset; the result is clamped.
    pub fn resolve(&self, op: OpKind, target: &Target) -> IoPolicy {
        let mut p = preset_policy(self.preset, op, target);
        let chain = self.chain(target.disk, op);
        if let Some(r) = chain.iter().find_map(|r| r.rate_mb_s) { p.rate_mb_s = Some(r); }
        if let Some(v) = chain.iter().find_map(|r| r.parallel) { p.parallel = v; }
        if let Some(v) = chain.iter().find_map(|r| r.buffer_kib) { p.buffer_kib = v; }
        if let Some(v) = chain.iter().find_map(|r| r.io_priority) { p.io_priority = v; }
        // Today's paced path: a MB/s ceiling copies in 128 KiB chunks and paces itself, with
        // no separate yield. Kept unless a rule asked for a buffer explicitly.
        if p.rate_mb_s.is_some() && self.preset != Preset::Max {
            if chain.iter().all(|r| r.buffer_kib.is_none()) { p.buffer_kib = 128; }
            p.pause_every_mib = None;
            p.pause_us = 0;
        }
        clamp(p)
    }

    /// Carry `disk_limits[mount] = n` into `rules[mount]["*"].rate_mb_s = n`, once. A limit
    /// of 0 meant "no limit" in the old table and is skipped. Returns true when it changed
    /// anything, so the caller knows to save.
    pub fn migrate_disk_limits(&mut self, disk_limits: &HashMap<String, u64>) -> bool {
        if self.migrated_disk_limits { return false; }
        for (mount, &n) in disk_limits {
            if n == 0 { continue; }
            let key = mount.to_lowercase();
            let rule = self.rules.entry(key).or_default().entry("*".to_string()).or_default();
            if rule.rate_mb_s.is_none() { rule.rate_mb_s = Some(n); }
        }
        self.migrated_disk_limits = true;
        true
    }

    /// Set (or, with `None` or an empty rule, remove) the rule for `(disk, op)`: the one door
    /// a fine-grained rule comes in by from outside the Settings screen (`POST
    /// /api/resources/io-rule`, admin token only). The keys are validated, the values clamped
    /// into the hard bounds BEFORE they are stored, so the document on disk is as sane as
    /// what `resolve` will make of it. Returns the stored rule.
    pub fn set_rule(&mut self, disk: &str, op: &str, rule: Option<IoRule>) -> Result<Option<IoRule>, String> {
        let disk = normalize_disk_key(disk).ok_or_else(|| format!("disk must be `*`, a drive (`d:\\`), a UNC share or `/`, not {disk:?}"))?;
        let op = op.trim().to_lowercase();
        if op != "*" && !OpKind::ALL.iter().any(|k| k.key() == op) {
            return Err(format!("op must be `*` or one of {}", OpKind::ALL.iter().map(|k| k.key()).collect::<Vec<_>>().join(", ")));
        }
        // Refused, not clamped: a stored document that says 999 parallel copies while the
        // governor runs 16 is a setting nobody can debug. clamp_rule stays as a second net.
        if let Some(r) = &rule { validate_rule(r)?; }
        let rule = rule.map(clamp_rule).filter(|r| *r != IoRule::default());
        match rule {
            None => {
                if let Some(m) = self.rules.get_mut(&disk) {
                    m.remove(&op);
                    if m.is_empty() { self.rules.remove(&disk); }
                }
                Ok(None)
            }
            Some(r) => {
                if !self.rules.contains_key(&disk) && self.rules.len() >= MAX_RULE_DISKS {
                    return Err(format!("at most {MAX_RULE_DISKS} disks can carry rules"));
                }
                self.rules.entry(disk).or_default().insert(op, r.clone());
                Ok(Some(r))
            }
        }
    }
}

/// How many disks may carry rules: a bound on a document the API can write.
pub const MAX_RULE_DISKS: usize = 64;

/// A stored rule, inside the hard bounds (rate ≥ 1, parallel 1..=16, buffer 64 KiB..=16 MiB).
/// What the hard bounds would otherwise rewrite, refused with the reason (a rate of 0 would
/// block for ever; parallel 1..16; buffer 64..16384 KiB).
pub fn validate_rule(r: &IoRule) -> Result<(), String> {
    if r.rate_mb_s == Some(0) { return Err("a rate must be at least 1 MB/s (leave it empty for no limit)".into()); }
    if let Some(p) = r.parallel { if p == 0 || p > MAX_PARALLEL { return Err(format!("parallel must be 1 to {MAX_PARALLEL}")); } }
    if let Some(b) = r.buffer_kib { if !(MIN_BUFFER_KIB..=MAX_BUFFER_KIB).contains(&b) { return Err(format!("buffer must be {MIN_BUFFER_KIB} to {MAX_BUFFER_KIB} KiB")); } }
    Ok(())
}

/// The old per-disk MB/s table follows a disk's `*` rate, whichever door changed it.
pub fn sync_disk_limit(rules: &BTreeMap<String, BTreeMap<String, IoRule>>, disk_limits: &mut HashMap<String, u64>, disk: &str, op: &str) {
    let Some(disk) = normalize_disk_key(disk) else { return };
    if op.trim() != "*" || disk == "*" || disk == "/" { return; }
    let rate = rules.get(&disk).and_then(|m| m.get("*")).and_then(|r| r.rate_mb_s);
    let key = disk_limits.keys().find(|k| k.to_lowercase() == disk).cloned().unwrap_or_else(|| disk.to_uppercase());
    match rate { Some(n) => { disk_limits.insert(key, n); } None => { disk_limits.remove(&key); } }
}

pub fn clamp_rule(mut r: IoRule) -> IoRule {
    if let Some(v) = r.rate_mb_s { r.rate_mb_s = Some(v.max(1)); }
    if let Some(v) = r.parallel { r.parallel = Some(v.clamp(1, MAX_PARALLEL)); }
    if let Some(v) = r.buffer_kib { r.buffer_kib = Some(v.clamp(MIN_BUFFER_KIB, MAX_BUFFER_KIB)); }
    r
}

/// The key a rule is stored under, in the shape `runtime::volume_key` produces: `*`, `d:\`,
/// `\\server\share\` (lower-cased) or `/`. None for anything else.
pub fn normalize_disk_key(disk: &str) -> Option<String> {
    let s = disk.trim();
    if s == "*" || s == "/" { return Some(s.to_string()); }
    let b = s.as_bytes();
    if (b.len() == 2 || b.len() == 3) && b[0].is_ascii_alphabetic() && b[1] == b':' && (b.len() == 2 || b[2] == b'\\' || b[2] == b'/') {
        return Some(format!("{}:\\", (b[0] as char).to_ascii_lowercase()));
    }
    if let Some(rest) = s.strip_prefix("\\\\") {
        let parts: Vec<&str> = rest.trim_end_matches('\\').split('\\').collect();
        let ok = |p: &str| !p.is_empty() && p != "." && p != ".." && p.len() <= 255 && !p.contains(['/', ':', '?', '*', '"', '<', '>', '|']) && !p.chars().any(char::is_control);
        if parts.len() == 2 && parts.iter().all(|p| ok(p)) {
            return Some(format!("\\\\{}\\{}\\", parts[0], parts[1]).to_lowercase());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(disk: Option<&str>, sys: bool) -> Target<'_> {
        Target { disk, kind: DiskKind::Ssd, on_system_drive: sys, cores: 8 }
    }

    #[test]
    fn balanced_preset_reproduces_todays_behaviour() {
        let c = ResourcesConfig::default();
        // Smart I/O copy on a non-system disk: 2 threads, 1 MiB chunks, 150 µs every 16 MiB.
        let p = c.resolve(OpKind::Deploy, &target(Some("d:\\"), false));
        assert_eq!((p.parallel, p.buffer_kib, p.pause_every_mib, p.pause_us, p.rate_mb_s), (2, 1024, Some(16), 150, None));
        // Game or backup on the system drive: serial.
        assert_eq!(c.resolve(OpKind::Deploy, &target(Some("c:\\"), true)).parallel, 1);
        // Hash pool: (cores / 2).clamp(1, 4).
        for (cores, want) in [(1, 1), (2, 1), (4, 2), (8, 4), (16, 4), (64, 4)] {
            assert_eq!(pool_threads(Preset::Balanced, OpKind::Hash, cores), want.min(cores.saturating_sub(1).max(1)), "cores={cores}");
        }
        // Extraction and the repo export ran on the global rayon pool: Balanced keeps its size
        // (the hard bound still leaves the UI a core on a 2-core machine).
        for (cores, want) in [(1, 1), (2, 1), (4, 3), (6, 5), (8, 6), (16, 14)] {
            for op in [OpKind::Extract, OpKind::Compress] {
                assert_eq!(pool_threads(Preset::Balanced, op, cores), want, "{op:?} cores={cores}");
            }
        }
        // A disk with a MB/s limit: the paced 128 KiB path, no separate yield.
        let mut limited = ResourcesConfig::default();
        limited.migrate_disk_limits(&HashMap::from([("D:\\".to_string(), 40u64)]));
        let p = limited.resolve(OpKind::Deploy, &target(Some("d:\\"), false));
        assert_eq!((p.rate_mb_s, p.buffer_kib, p.pause_every_mib), (Some(40), 128, None));
    }

    #[test]
    fn migration_carries_disk_limits_into_disk_wide_rules() {
        let mut c = ResourcesConfig::default();
        let changed = c.migrate_disk_limits(&HashMap::from([
            ("D:\\".to_string(), 40u64), ("E:\\".to_string(), 0u64),
        ]));
        assert!(changed);
        assert_eq!(c.rules["d:\\"]["*"].rate_mb_s, Some(40));
        assert!(!c.rules.contains_key("e:\\"), "0 meant no limit and is not a rule");
        // Once only: a later edit of the old table is not re-applied over the rules.
        assert!(!c.migrate_disk_limits(&HashMap::from([("D:\\".to_string(), 5u64)])));
        assert_eq!(c.rules["d:\\"]["*"].rate_mb_s, Some(40));
    }

    #[test]
    fn rule_resolution_prefers_disk_and_op_then_disk_then_op() {
        let mut c = ResourcesConfig::default();
        let rule = |r: u64| IoRule { rate_mb_s: Some(r), ..Default::default() };
        c.rules.entry("*".into()).or_default().insert("hash".into(), rule(10));
        c.rules.entry("d:\\".into()).or_default().insert("*".into(), rule(20));
        c.rules.entry("d:\\".into()).or_default().insert("hash".into(), rule(30));
        let t = target(Some("d:\\"), false);
        assert_eq!(c.resolve(OpKind::Hash, &t).rate_mb_s, Some(30), "(disk, op) first");
        assert_eq!(c.resolve(OpKind::Scan, &t).rate_mb_s, Some(20), "then (disk, *)");
        assert_eq!(c.resolve(OpKind::Hash, &target(Some("e:\\"), false)).rate_mb_s, Some(10), "then (*, op)");
        assert_eq!(c.resolve(OpKind::Scan, &target(Some("e:\\"), false)).rate_mb_s, None, "then the preset");
        // Field by field: a (disk, op) rule that only sets parallelism still inherits the rate.
        c.rules.get_mut("d:\\").unwrap().insert("scan".into(), IoRule { parallel: Some(3), ..Default::default() });
        let p = c.resolve(OpKind::Scan, &t);
        assert_eq!((p.parallel, p.rate_mb_s), (3, Some(20)));
    }

    #[test]
    fn hard_bounds_clamp_every_field() {
        let wild = IoPolicy {
            rate_mb_s: Some(0), parallel: 999, buffer_kib: 1, io_priority: IoPriority::Low,
            pause_every_mib: None, pause_us: 0, thread_priority: ThreadPriority::AboveNormal,
        };
        let p = clamp(wild);
        assert_eq!(p.rate_mb_s, Some(1), "0 would block forever");
        assert_eq!(p.parallel, MAX_PARALLEL);
        assert!(p.buffer_kib >= MIN_BUFFER_KIB);
        let big = clamp(IoPolicy { buffer_kib: 1 << 30, parallel: 16, ..wild });
        assert!(big.buffer_kib <= MAX_BUFFER_KIB);
        assert!((big.parallel as u64) * (big.buffer_kib as u64) <= MAX_IN_FLIGHT_KIB, "in flight capped");
        // A stored rule goes through the same clamp.
        let mut c = ResourcesConfig::default();
        c.rules.entry("*".into()).or_default().insert("*".into(), IoRule { rate_mb_s: Some(0), parallel: Some(0), buffer_kib: Some(u32::MAX), io_priority: None });
        let p = c.resolve(OpKind::Deploy, &target(None, false));
        assert_eq!((p.rate_mb_s, p.parallel), (Some(1), 1));
        assert!(p.buffer_kib <= MAX_BUFFER_KIB);
        // Pools never take every core, and never go below one thread.
        assert_eq!(clamp_pool_threads(64, 8), 7);
        assert_eq!(clamp_pool_threads(0, 1), 1);
        assert_eq!(pool_threads(Preset::Max, OpKind::Deploy, 8), 7);
        assert_eq!(pool_threads(Preset::Silent, OpKind::Hash, 8), 1);
    }

    #[test]
    fn old_data_json_without_resources_loads_and_keeps_disk_limits() {
        // An AppData written before the governor existed: no `resources` key at all.
        let old = r#"{"profiles":[],"mods":[],"active_profile_id":null,"disk_limits":{"D:\\":40}}"#;
        let d: crate::state::AppData = serde_json::from_str(old).expect("old data.json still loads");
        assert_eq!(d.resources, ResourcesConfig::default());
        assert_eq!(d.disk_limits.get("D:\\"), Some(&40));
        // And it saves back with the old table untouched (the MCP bridge still reads it).
        let back = serde_json::to_value(&d).unwrap();
        assert_eq!(back["disk_limits"]["D:\\"], 40);
    }

    #[test]
    fn presets_differ_where_they_should() {
        let t = Target { disk: None, kind: DiskKind::Nvme, on_system_drive: false, cores: 16 };
        let mut c = ResourcesConfig::default();
        c.preset = Preset::Silent;
        let s = c.resolve(OpKind::Deploy, &t);
        assert_eq!((s.parallel, s.io_priority, s.thread_priority), (1, IoPriority::Low, ThreadPriority::Background));
        c.preset = Preset::Max;
        let m = c.resolve(OpKind::Deploy, &t);
        assert_eq!((m.parallel, m.buffer_kib, m.pause_every_mib), (8, 4096, None));
        c.preset = Preset::Max;
        let hdd = c.resolve(OpKind::Deploy, &Target { kind: DiskKind::Hdd, ..t });
        assert_eq!(hdd.parallel, 1, "a spinning disk is not helped by parallel seeks");
    }

    /// A4: the rule the API writes is validated by key and clamped before it is stored.
    #[test]
    fn set_rule_validates_keys_and_refuses_out_of_bound_values() {
        let mut c = ResourcesConfig::default();
        for wild in [IoRule { rate_mb_s: Some(0), ..Default::default() }, IoRule { parallel: Some(999), ..Default::default() }, IoRule { buffer_kib: Some(1), ..Default::default() }] {
            assert!(c.set_rule("D:", "HASH", Some(wild)).is_err(), "an out-of-bound value must be refused, not rewritten");
        }
        assert!(c.rules.is_empty(), "a refused rule stored nothing");
        let stored = c.set_rule("D:", "HASH", Some(IoRule { rate_mb_s: Some(1), parallel: Some(MAX_PARALLEL), buffer_kib: Some(MIN_BUFFER_KIB), io_priority: None })).unwrap().unwrap();
        assert_eq!((stored.rate_mb_s, stored.parallel, stored.buffer_kib), (Some(1), Some(MAX_PARALLEL), Some(MIN_BUFFER_KIB)));
        assert_eq!(c.rules["d:\\"]["hash"], stored, "stored under the key volume_key produces");
        assert_eq!(normalize_disk_key("\\\\NAS\\Games\\").as_deref(), Some("\\\\nas\\games\\"));
        for bad in ["", "d", "d:\\games", "..", "\\\\nas", "\\\\nas\\..\\x", "C:\\..\\"] {
            assert!(c.set_rule(bad, "*", Some(IoRule { parallel: Some(2), ..Default::default() })).is_err(), "{bad:?}");
        }
        assert!(c.set_rule("*", "explode", Some(IoRule::default())).is_err());
        // An empty rule, or none, removes it (and the disk once it carries nothing).
        c.set_rule("d:\\", "hash", None).unwrap();
        assert!(!c.rules.contains_key("d:\\"));
        c.set_rule("*", "*", Some(IoRule { rate_mb_s: Some(50), ..Default::default() })).unwrap();
        c.set_rule("*", "*", Some(IoRule::default())).unwrap();
        assert!(c.rules.is_empty());
    }
}
