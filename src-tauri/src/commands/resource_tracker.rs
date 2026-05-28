//! Lightweight resource accounting for BMM operations.
//!
//! Tuned for ~microsecond start/finish cost so it can wrap any op,
//! including hot ones, without measurable overhead:
//!   • Windows: direct `GetProcessMemoryInfo` / `GetProcessTimes` —
//!     no `sysinfo` allocations, no full process-table scan.
//!   • Cross-platform fallback: lazy sysinfo only when really needed.
//!   • Lock-free `try_lock` on the ring; if the ring is contended (very
//!     rare), the record is silently dropped rather than blocking the op.
//!   • Metrics are `Vec<(Cow, u64)>` — no `HashMap`, no string hashing.
//!   • CPU% is only computed when the op lasted long enough for the
//!     number to mean something (>= 50 ms).
//!
//! Records are appended to a bounded ring (last 500) and mirrored to the
//! crash log so they show up in bug reports.

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::sync::Mutex;
use std::time::Instant;

const RING_CAPACITY: usize = 500;
const CPU_SAMPLE_MIN_MS: u128 = 50;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ResourceRecord {
    pub op: String,
    pub subject: Option<String>,
    pub started_unix_ms: u128,
    pub duration_ms: u128,
    pub rss_before_kb: u64,
    pub rss_after_kb: u64,
    pub rss_delta_kb: i128,
    pub cpu_pct: f32,
    /// Domain-specific counters: bytes_read, bytes_written, bytes_sent,
    /// items, files, ...  Sorted by key when serialized.
    pub metrics: std::collections::BTreeMap<String, u64>,
    pub status: String,
}

lazy_static::lazy_static! {
    static ref RING: Mutex<std::collections::VecDeque<ResourceRecord>> =
        Mutex::new(std::collections::VecDeque::with_capacity(RING_CAPACITY));
}

// ─────────────────────────────────────────────────────────────────────────
// Fast probes
// ─────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win_probe {
    use std::mem::size_of;

    #[repr(C)]
    pub(super) struct PROCESS_MEMORY_COUNTERS {
        pub cb: u32,
        pub page_fault_count: u32,
        pub peak_working_set_size: usize,
        pub working_set_size: usize,
        pub quota_peak_paged_pool_usage: usize,
        pub quota_paged_pool_usage: usize,
        pub quota_peak_non_paged_pool_usage: usize,
        pub quota_non_paged_pool_usage: usize,
        pub pagefile_usage: usize,
        pub peak_pagefile_usage: usize,
    }

    #[repr(C)]
    pub(super) struct FILETIME {
        pub low: u32,
        pub high: u32,
    }

    extern "system" {
        pub fn GetCurrentProcess() -> *mut std::ffi::c_void;
        pub fn GetProcessMemoryInfo(
            h: *mut std::ffi::c_void,
            pmc: *mut PROCESS_MEMORY_COUNTERS,
            cb: u32,
        ) -> i32;
        pub fn GetProcessTimes(
            h: *mut std::ffi::c_void,
            creation: *mut FILETIME,
            exit: *mut FILETIME,
            kernel: *mut FILETIME,
            user: *mut FILETIME,
        ) -> i32;
    }

    #[inline]
    pub(super) fn rss_kb() -> u64 {
        unsafe {
            let mut pmc: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            pmc.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            if GetProcessMemoryInfo(GetCurrentProcess(), &mut pmc, pmc.cb) != 0 {
                return (pmc.working_set_size / 1024) as u64;
            }
            0
        }
    }

    /// Total kernel+user CPU time consumed by this process so far,
    /// expressed in 100-ns ticks (Windows native unit).
    #[inline]
    pub(super) fn process_cpu_100ns() -> u64 {
        unsafe {
            let mut c: FILETIME = std::mem::zeroed();
            let mut e: FILETIME = std::mem::zeroed();
            let mut k: FILETIME = std::mem::zeroed();
            let mut u: FILETIME = std::mem::zeroed();
            if GetProcessTimes(GetCurrentProcess(), &mut c, &mut e, &mut k, &mut u) == 0 {
                return 0;
            }
            let k_ticks = ((k.high as u64) << 32) | (k.low as u64);
            let u_ticks = ((u.high as u64) << 32) | (u.low as u64);
            k_ticks.saturating_add(u_ticks)
        }
    }
}

#[inline]
fn probe_rss_kb() -> u64 {
    #[cfg(target_os = "windows")]
    {
        return win_probe::rss_kb();
    }
    #[cfg(not(target_os = "windows"))]
    {
        use sysinfo::{Pid, System};
        let mut sys = System::new();
        let pid = Pid::from_u32(std::process::id());
        sys.refresh_process(pid);
        sys.process(pid).map(|p| p.memory() / 1024).unwrap_or(0)
    }
}

#[inline]
fn probe_cpu_ticks() -> u64 {
    #[cfg(target_os = "windows")]
    {
        return win_probe::process_cpu_100ns();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Cross-platform fallback: skip CPU sampling.  cpu_pct will read 0.
        0
    }
}

#[inline]
fn now_unix_ms() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────────────────
// OpTracker
// ─────────────────────────────────────────────────────────────────────────

pub struct OpTracker {
    op: Cow<'static, str>,
    subject: Option<String>,
    started: Instant,
    started_unix_ms: u128,
    rss_before_kb: u64,
    cpu_before_ticks: u64,
    /// Inline Vec keeps allocations tiny — most ops add 0–3 metrics.
    metrics: Vec<(Cow<'static, str>, u64)>,
    finished: bool,
}

impl OpTracker {
    pub fn start(op: impl Into<Cow<'static, str>>) -> Self {
        Self {
            op: op.into(),
            subject: None,
            started: Instant::now(),
            started_unix_ms: now_unix_ms(),
            rss_before_kb: probe_rss_kb(),
            cpu_before_ticks: probe_cpu_ticks(),
            metrics: Vec::new(),
            finished: false,
        }
    }

    pub fn with_subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    /// Accumulate into a metric (allocates only if the key is new).
    pub fn add(&mut self, key: impl Into<Cow<'static, str>>, value: u64) {
        let k: Cow<'static, str> = key.into();
        if let Some(slot) = self.metrics.iter_mut().find(|(kk, _)| *kk == k) {
            slot.1 = slot.1.saturating_add(value);
        } else {
            self.metrics.push((k, value));
        }
    }

    /// Replace a metric outright.
    pub fn set(&mut self, key: impl Into<Cow<'static, str>>, value: u64) {
        let k: Cow<'static, str> = key.into();
        if let Some(slot) = self.metrics.iter_mut().find(|(kk, _)| *kk == k) {
            slot.1 = value;
        } else {
            self.metrics.push((k, value));
        }
    }

    pub fn finish(self) {
        self.into_record("ok");
    }

    pub fn finish_with(self, status: impl AsRef<str>) {
        let s = status.as_ref().to_string();
        self.into_record(&s);
    }

    fn into_record(mut self, status: &str) {
        if self.finished {
            return;
        }
        self.finished = true;

        let elapsed = self.started.elapsed();
        let elapsed_ms = elapsed.as_millis();
        let rss_after_kb = probe_rss_kb();
        let rss_delta_kb = rss_after_kb as i128 - self.rss_before_kb as i128;

        // CPU% is meaningful only for ops with non-trivial duration.
        // For shorter ops the divisor is too small and the figure looks
        // ridiculous (think 500%).  Skip them to keep records clean.
        let cpu_pct: f32 = if elapsed_ms >= CPU_SAMPLE_MIN_MS {
            let cpu_after_ticks = probe_cpu_ticks();
            let cpu_delta_ticks = cpu_after_ticks.saturating_sub(self.cpu_before_ticks);
            // Ticks are 100-ns units; convert to ms then to fraction of
            // wall-clock elapsed_ms, normalized per logical CPU.
            let cpu_ms = cpu_delta_ticks as f64 / 10_000.0;
            let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
            let pct = (cpu_ms / elapsed_ms as f64 / cpus * 100.0) as f32;
            pct.clamp(0.0, 100.0 * cpus as f32)
        } else {
            0.0
        };

        // Build BTreeMap only at serialization time (cheap, ops are rare).
        let mut sorted = std::collections::BTreeMap::new();
        let mut metrics_log = String::new();
        for (k, v) in self.metrics.drain(..) {
            if !metrics_log.is_empty() { metrics_log.push(' '); }
            metrics_log.push_str(&k);
            metrics_log.push('=');
            metrics_log.push_str(&v.to_string());
            sorted.insert(k.into_owned(), v);
        }

        let op_owned = self.op.clone().into_owned();
        let subject_owned = self.subject.take();

        // Mirror to crash log.
        crate::commands::crash::log_line(format!(
            "[RES] {}{} dur={}ms rss={}KB Δrss={:+}KB cpu={:.1}% status={}{}",
            op_owned,
            subject_owned.as_ref().map(|s| format!(" ({})", s)).unwrap_or_default(),
            elapsed_ms,
            rss_after_kb,
            rss_delta_kb,
            cpu_pct,
            status,
            if metrics_log.is_empty() { String::new() } else { format!(" {}", metrics_log) },
        ));

        // Try to push.  If the ring is locked (extremely rare) drop the
        // record rather than blocking the calling op — logging is best-effort.
        if let Ok(mut ring) = RING.try_lock() {
            if ring.len() >= RING_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(ResourceRecord {
                op: op_owned,
                subject: subject_owned,
                started_unix_ms: self.started_unix_ms,
                duration_ms: elapsed_ms,
                rss_before_kb: self.rss_before_kb,
                rss_after_kb,
                rss_delta_kb,
                cpu_pct,
                metrics: sorted,
                status: status.to_string(),
            });
        }
    }
}

impl Drop for OpTracker {
    fn drop(&mut self) {
        if !self.finished {
            // Steal fields to call into_record.
            let me = OpTracker {
                op: std::mem::replace(&mut self.op, Cow::Borrowed("")),
                subject: self.subject.take(),
                started: self.started,
                started_unix_ms: self.started_unix_ms,
                rss_before_kb: self.rss_before_kb,
                cpu_before_ticks: self.cpu_before_ticks,
                metrics: std::mem::take(&mut self.metrics),
                finished: false,
            };
            me.into_record("dropped");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────

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
