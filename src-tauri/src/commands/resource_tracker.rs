//! Lightweight resource accounting for BMM operations.
//!
//! Drop-in helpers that wrap any operation and record duration, RSS
//! delta, CPU%, plus arbitrary domain metrics (bytes_read, bytes_written,
//! bandwidth_bytes, items, ...).
//!
//! Design constraints:
//!   - Zero impact on the hot path: probes only fire at op start + end,
//!     never inside loops.
//!   - All in-process — no IPC, no serialization on the critical path.
//!   - Records are appended to a bounded ring (last 500 entries) and
//!     mirrored to the crash log so they show up in bug reports.
//!   - Reads are fast: snapshot the ring + return as JSON.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

const RING_CAPACITY: usize = 500;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ResourceRecord {
    /// "MOD/apply", "SHA/compute", "REPO/export", "REPO/host", ...
    pub op: String,
    /// Free-form identifier — mod id, repo URL, etc.
    pub subject: Option<String>,
    pub started_unix_ms: u128,
    pub duration_ms: u128,
    pub rss_before_kb: u64,
    pub rss_after_kb: u64,
    pub rss_delta_kb: i128,
    pub cpu_pct: f32,
    /// Domain-specific counters: "bytes_read", "bytes_written",
    /// "bandwidth_bytes", "items", "files", etc.
    pub metrics: HashMap<String, u64>,
    /// If the op failed or was cancelled, the short reason.
    pub status: String,
}

lazy_static::lazy_static! {
    static ref RING: Mutex<std::collections::VecDeque<ResourceRecord>> =
        Mutex::new(std::collections::VecDeque::with_capacity(RING_CAPACITY));
}

fn probe_now() -> (u64, f32) {
    use sysinfo::{Pid, System};
    let mut sys = System::new();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_process(pid);
    if let Some(p) = sys.process(pid) {
        (p.memory(), p.cpu_usage())
    } else {
        (0, 0.0)
    }
}

fn now_unix_ms() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Live tracker handle.  Build with `start`, call `add_metric` while the
/// op runs, then `finish` (or let it drop — finish is implicit on Drop
/// with status="dropped").
pub struct OpTracker {
    op: String,
    subject: Option<String>,
    started: Instant,
    started_unix_ms: u128,
    rss_before_kb: u64,
    metrics: HashMap<String, u64>,
    finished: bool,
}

impl OpTracker {
    pub fn start(op: impl Into<String>) -> Self {
        let (rss, _) = probe_now();
        Self {
            op: op.into(),
            subject: None,
            started: Instant::now(),
            started_unix_ms: now_unix_ms(),
            rss_before_kb: rss / 1024,
            metrics: HashMap::new(),
            finished: false,
        }
    }

    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    pub fn add(&mut self, key: &str, value: u64) {
        *self.metrics.entry(key.to_string()).or_insert(0) += value;
    }

    pub fn set(&mut self, key: &str, value: u64) {
        self.metrics.insert(key.to_string(), value);
    }

    pub fn finish_with(self, status: impl Into<String>) {
        self.into_record(status.into());
    }

    pub fn finish(self) {
        self.into_record("ok".to_string());
    }

    fn into_record(mut self, status: String) {
        if self.finished {
            return;
        }
        self.finished = true;

        let elapsed = self.started.elapsed();
        let (rss_after, cpu_pct) = probe_now();
        let rss_after_kb = rss_after / 1024;
        let rss_delta_kb = rss_after_kb as i128 - self.rss_before_kb as i128;

        let rec = ResourceRecord {
            op: self.op.clone(),
            subject: self.subject.clone(),
            started_unix_ms: self.started_unix_ms,
            duration_ms: elapsed.as_millis(),
            rss_before_kb: self.rss_before_kb,
            rss_after_kb,
            rss_delta_kb,
            cpu_pct,
            metrics: std::mem::take(&mut self.metrics),
            status,
        };

        // Mirror to the crash log so reports include the trace.
        let metrics_str = if rec.metrics.is_empty() {
            String::new()
        } else {
            let mut parts: Vec<String> = rec.metrics.iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect();
            parts.sort();
            format!(" {}", parts.join(" "))
        };
        crate::commands::crash::log_line(format!(
            "[RES] {}{} dur={}ms rss={}KB Δrss={:+}KB cpu={:.1}% status={}{}",
            rec.op,
            rec.subject.as_ref().map(|s| format!(" ({})", s)).unwrap_or_default(),
            rec.duration_ms,
            rec.rss_after_kb,
            rec.rss_delta_kb,
            rec.cpu_pct,
            rec.status,
            metrics_str,
        ));

        // Push into the ring (drop oldest if full).
        if let Ok(mut ring) = RING.lock() {
            if ring.len() >= RING_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(rec);
        }
    }
}

impl Drop for OpTracker {
    fn drop(&mut self) {
        if !self.finished {
            // Re-create finish on drop by stealing self fields
            let me = OpTracker {
                op: std::mem::take(&mut self.op),
                subject: self.subject.take(),
                started: self.started,
                started_unix_ms: self.started_unix_ms,
                rss_before_kb: self.rss_before_kb,
                metrics: std::mem::take(&mut self.metrics),
                finished: false,
            };
            me.into_record("dropped".to_string());
        }
    }
}

/// Snapshot the most recent N records for UI / diagnostics.
#[tauri::command]
pub fn get_resource_records(limit: Option<usize>) -> Vec<ResourceRecord> {
    let cap = limit.unwrap_or(200).min(RING_CAPACITY);
    let ring = match RING.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    ring.iter().rev().take(cap).cloned().collect()
}

#[tauri::command]
pub fn clear_resource_records() {
    if let Ok(mut ring) = RING.lock() {
        ring.clear();
    }
}
