//! The advanced storage matrix (S1): per disk × per operation rules, and what each one
//! resolves to with where every value comes from.
//!
//! A cell left empty inherits: (disk, op) → (disk, all ops) → (all disks, op) → the preset.
//! The UI shows the resolved value AND its source, because a matrix of blank cells that
//! nonetheless limits a copy to 40 MB/s is exactly the kind of setting nobody can debug.
use crate::governor::config::{normalize_disk_key, sync_disk_limit, IoPriority, IoRule, OpKind};
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
    let d = normalize_disk_key(&disk).ok_or_else(|| format!("not a disk: {disk}"))?;
    Ok(resolve_disk(&global().config().rules, &d))
}

/// Store (or with `rule: None`, remove) the rule for (disk, op). `op` may be "*".
#[tauri::command]
pub fn resources_set_rule(state: State<AppState>, disk: String, op: String, rule: Option<IoRule>) -> Result<(), String> {
    // The same path as POST /api/resources/io-rule (config.rs set_rule + sync_disk_limit):
    // keys normalised or refused, out-of-bound values refused, disk_limits kept in step.
    let cfg = {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        data.resources.set_rule(&disk, &op, rule)?;
        let rules = data.resources.rules.clone();
        sync_disk_limit(&rules, &mut data.disk_limits, &disk, &op);
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
            Some(d) => { let d = normalize_disk_key(&d).ok_or_else(|| format!("not a disk: {d}"))?; data.resources.rules.remove(&d); data.disk_limits.retain(|k, _| k.to_lowercase() != d); }
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

}
