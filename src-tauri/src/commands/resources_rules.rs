//! The advanced storage matrix (S1): per disk × per operation rules, and what each one
//! resolves to with where every value comes from.
//!
//! A cell left empty inherits: (disk, op) → (disk, all ops) → (all disks, op) → the preset.
//! The UI shows the resolved value AND its source, because a matrix of blank cells that
//! nonetheless limits a copy to 40 MB/s is exactly the kind of setting nobody can debug.
use crate::governor::config::{IoPriority, IoRule, OpKind, MAX_BUFFER_KIB, MAX_PARALLEL, MIN_BUFFER_KIB};
use crate::governor::runtime::global;
use crate::state::AppState;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use tauri::State;

/// Where one resolved value comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source { DiskOp, Disk, AllDisksOp, AllDisks, Preset }

#[derive(Debug, Serialize)]
pub struct Cell {
    pub op: &'static str,
    pub rate_mb_s: Option<u64>,
    pub parallel: u32,
    pub buffer_kib: u32,
    pub io_priority: IoPriority,
    pub src_rate: Source,
    pub src_parallel: Source,
    pub src_buffer: Source,
    pub src_io: Source,
    /// The rule stored for exactly (disk, op), for the editor.
    pub own: IoRule,
}

/// The ops the matrix shows (plan §3). Deploy and Image are left to the preset on purpose:
/// deploy speed is what game mode throttles, and images are too small to be worth a knob.
pub const MATRIX_OPS: [OpKind; 7] = [OpKind::Install, OpKind::Backup, OpKind::Extract, OpKind::Compress, OpKind::Scan, OpKind::Hash, OpKind::Download];

fn norm_disk(d: &str) -> Result<String, String> {
    let d = d.trim().to_lowercase();
    if d == "*" { return Ok(d); }
    let ok_letter = d.len() >= 2 && d.as_bytes()[0].is_ascii_alphabetic() && d.as_bytes()[1] == b':';
    if ok_letter || d.starts_with("\\\\") { Ok(if d.ends_with('\\') { d } else { format!("{d}\\") }) } else { Err(format!("not a disk: {d}")) }
}

fn norm_op(o: &str) -> Result<&'static str, String> {
    if o == "*" { return Ok("*"); }
    OpKind::ALL.iter().map(|k| k.key()).find(|k| *k == o).ok_or_else(|| format!("unknown operation: {o}"))
}

/// Refuse what the hard bounds would silently rewrite, so the stored document says what
/// actually happens (a rate of 0 would mean "block forever").
fn validate(r: &IoRule) -> Result<(), String> {
    if r.rate_mb_s == Some(0) { return Err("a rate must be at least 1 MB/s (leave it empty for no limit)".into()); }
    if let Some(p) = r.parallel { if p == 0 || p > MAX_PARALLEL { return Err(format!("parallel must be 1 to {MAX_PARALLEL}")); } }
    if let Some(b) = r.buffer_kib { if !(MIN_BUFFER_KIB..=MAX_BUFFER_KIB).contains(&b) { return Err(format!("buffer must be {MIN_BUFFER_KIB} to {MAX_BUFFER_KIB} KiB")); } }
    Ok(())
}

/// Resolve every matrix op for one disk, with sources. Pure over the rules map.
pub fn resolve_disk(rules: &BTreeMap<String, BTreeMap<String, IoRule>>, disk: &str) -> Vec<Cell> {
    let get = |d: &str, o: &str| rules.get(d).and_then(|m| m.get(o)).cloned().unwrap_or_default();
    MATRIX_OPS.iter().map(|&op| {
        let chain = [(get(disk, op.key()), Source::DiskOp), (get(disk, "*"), Source::Disk), (get("*", op.key()), Source::AllDisksOp), (get("*", "*"), Source::AllDisks)];
        let pick = |f: &dyn Fn(&IoRule) -> bool| chain.iter().find(|(r, _)| f(r)).map(|(_, s)| *s).unwrap_or(Source::Preset);
        let p = global().policy_for(op, Path::new(disk));
        Cell {
            op: op.key(),
            rate_mb_s: p.rate_mb_s, parallel: p.parallel, buffer_kib: p.buffer_kib, io_priority: p.io_priority,
            src_rate: pick(&|r| r.rate_mb_s.is_some()),
            src_parallel: pick(&|r| r.parallel.is_some()),
            src_buffer: pick(&|r| r.buffer_kib.is_some()),
            src_io: pick(&|r| r.io_priority.is_some()),
            own: get(disk, op.key()),
        }
    }).collect()
}

#[tauri::command]
pub fn resources_matrix(disk: String) -> Result<Vec<Cell>, String> {
    let d = norm_disk(&disk)?;
    Ok(resolve_disk(&global().config().rules, &d))
}

/// Store (or with `rule: None`, remove) the rule for (disk, op). `op` may be "*".
#[tauri::command]
pub fn resources_set_rule(state: State<AppState>, disk: String, op: String, rule: Option<IoRule>) -> Result<(), String> {
    let d = norm_disk(&disk)?;
    let o = norm_op(op.trim())?;
    if let Some(r) = &rule { validate(r)?; }
    let cfg = {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        let empty = rule.as_ref().map(|r| *r == IoRule::default()).unwrap_or(true);
        if empty {
            if let Some(m) = data.resources.rules.get_mut(&d) { m.remove(o); if m.is_empty() { data.resources.rules.remove(&d); } }
        } else {
            data.resources.rules.entry(d.clone()).or_default().insert(o.to_string(), rule.unwrap());
        }
        // The old per-disk table follows the disk-wide rate, which is what set_disk_limit does
        // in the other direction, so the two never disagree.
        if o == "*" && d != "*" {
            let rate = data.resources.rules.get(&d).and_then(|m| m.get("*")).and_then(|r| r.rate_mb_s);
            let key = data.disk_limits.keys().find(|k| k.to_lowercase() == d).cloned().unwrap_or_else(|| d.to_uppercase());
            match rate { Some(n) => { data.disk_limits.insert(key, n); } None => { data.disk_limits.remove(&key); } }
        }
        data.resources.clone()
    };
    global().configure(cfg);
    state.save().map_err(|e| e.to_string())
}

/// Remove every rule for one disk ("*" = the all-disks rules), or all of them with `None`.
#[tauri::command]
pub fn resources_reset_rules(state: State<AppState>, disk: Option<String>) -> Result<(), String> {
    let cfg = {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        match disk {
            Some(d) => { let d = norm_disk(&d)?; data.resources.rules.remove(&d); data.disk_limits.retain(|k, _| k.to_lowercase() != d); }
            None => { data.resources.rules.clear(); data.disk_limits.clear(); }
        }
        data.resources.clone()
    };
    global().configure(cfg);
    state.save().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(rate: Option<u64>, par: Option<u32>) -> IoRule { IoRule { rate_mb_s: rate, parallel: par, ..Default::default() } }

    #[test]
    fn every_value_names_the_rule_it_came_from() {
        let mut rules: BTreeMap<String, BTreeMap<String, IoRule>> = BTreeMap::new();
        rules.entry("d:\\".into()).or_default().insert("hash".into(), rule(Some(40), None));
        rules.entry("d:\\".into()).or_default().insert("*".into(), rule(Some(90), Some(3)));
        rules.entry("*".into()).or_default().insert("hash".into(), IoRule { buffer_kib: Some(512), ..Default::default() });
        let cells = resolve_disk(&rules, "d:\\");
        let hash = cells.iter().find(|c| c.op == "hash").unwrap();
        assert_eq!(hash.src_rate, Source::DiskOp, "the (disk, op) rate wins over the disk-wide one");
        assert_eq!(hash.src_parallel, Source::Disk);
        assert_eq!(hash.src_buffer, Source::AllDisksOp);
        assert_eq!(hash.src_io, Source::Preset);
        assert_eq!(hash.own.rate_mb_s, Some(40));
        let scan = cells.iter().find(|c| c.op == "scan").unwrap();
        assert_eq!(scan.src_rate, Source::Disk);
    }

    #[test]
    fn a_rule_the_bounds_would_rewrite_is_refused_not_stored() {
        assert!(validate(&rule(Some(0), None)).is_err());
        assert!(validate(&rule(None, Some(0))).is_err());
        assert!(validate(&rule(None, Some(MAX_PARALLEL + 1))).is_err());
        assert!(validate(&IoRule { buffer_kib: Some(8), ..Default::default() }).is_err());
        assert!(validate(&rule(Some(1), Some(1))).is_ok());
    }

    #[test]
    fn disks_and_ops_are_normalised_or_refused() {
        assert_eq!(norm_disk("D:").unwrap(), "d:\\");
        assert_eq!(norm_disk(" E:\\ ").unwrap(), "e:\\");
        assert_eq!(norm_disk("*").unwrap(), "*");
        assert!(norm_disk("../etc").is_err());
        assert_eq!(norm_op("hash").unwrap(), "hash");
        assert!(norm_op("rm -rf").is_err());
    }
}
