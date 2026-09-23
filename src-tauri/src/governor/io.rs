//! The governed copy (PLAN-BMM-RESOURCES-2026.md, G2): one copy loop whose speed limit is SHARED
//! by every copy on the same disk.
//!
//! # The defect this exists for
//!
//! Today each copy paces itself (`fs_utils::copy_file_force_smart`, path 1): with two copy
//! threads, a disk limited to 40 MB/s is written at 80 MB/s, and the copy of the originals and
//! the copy of the mod each get their own 40 even when they go to the same disk. A limit that
//! multiplies with the parallelism is not a limit.
//!
//! Here a `RateLimiter` is a token bucket PER VOLUME, and every copy to that volume draws from
//! it, so the sum of all copies respects the number the user set.
//!
//! # What a copy does
//!
//! Chunks of the policy's buffer size; between chunks, the ticket's checkpoint (pause, cancel,
//! background yielding) and the bucket (rate); the Smart I/O yield when the policy asks for one.
//! A cancelled copy removes its partial destination. Bytes are reported to the ticket for the
//! dashboard. Wiring it into fs_utils and the worker is the migration phases' job (G3a).

use super::config::IoPolicy;
use super::queue::{Cancelled, Ticket};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// A token bucket in bytes. `rate` bytes per second, bursts up to one second's worth.
pub struct RateLimiter {
    state: Mutex<(f64, Instant)>, // (tokens available, last refill)
    rate: Mutex<Option<u64>>,     // bytes per second; None = unlimited
}

impl RateLimiter {
    pub fn new(rate_bytes_s: Option<u64>) -> RateLimiter {
        RateLimiter { state: Mutex::new((rate_bytes_s.unwrap_or(0) as f64, Instant::now())), rate: Mutex::new(rate_bytes_s) }
    }

    pub fn set_rate(&self, rate_bytes_s: Option<u64>) {
        *self.rate.lock().unwrap_or_else(|p| p.into_inner()) = rate_bytes_s;
    }

    /// Block until `n` bytes may pass. Unlimited returns at once.
    pub fn acquire(&self, n: u64) {
        loop {
            let rate = *self.rate.lock().unwrap_or_else(|p| p.into_inner());
            let Some(rate) = rate.filter(|r| *r > 0) else { return };
            let wait = {
                let mut st = self.state.lock().unwrap_or_else(|p| p.into_inner());
                let now = Instant::now();
                let refill = now.duration_since(st.1).as_secs_f64() * rate as f64;
                st.0 = (st.0 + refill).min(rate as f64); // at most one second of burst
                st.1 = now;
                if st.0 >= n as f64 || (st.0 >= rate as f64 * 0.999 && n as f64 > rate as f64) {
                    // Enough tokens, or a chunk bigger than a whole second's budget: let it go and
                    // go into debt, so a huge buffer on a slow limit still makes progress.
                    st.0 -= n as f64;
                    return;
                }
                Duration::from_secs_f64(((n as f64 - st.0) / rate as f64).max(0.0005))
            };
            std::thread::sleep(wait.min(Duration::from_millis(250)));
        }
    }
}

/// The bucket for a volume (the lower-cased mount point), created on first use.
pub fn limiter_for(volume: &str, rate_bytes_s: Option<u64>) -> Arc<RateLimiter> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<RateLimiter>>>> = OnceLock::new();
    let map = MAP.get_or_init(|| Mutex::new(HashMap::new()));
    let mut m = map.lock().unwrap_or_else(|p| p.into_inner());
    let l = m.entry(volume.to_lowercase()).or_insert_with(|| Arc::new(RateLimiter::new(rate_bytes_s))).clone();
    l.set_rate(rate_bytes_s);
    l
}

#[derive(Debug)]
pub enum CopyError {
    Cancelled,
    Io(std::io::Error),
}

impl From<std::io::Error> for CopyError {
    fn from(e: std::io::Error) -> Self { CopyError::Io(e) }
}
impl From<Cancelled> for CopyError {
    fn from(_: Cancelled) -> Self { CopyError::Cancelled }
}

/// Copy `src` to `dst` under `policy`, drawing on `limiter`, checking `ticket` between chunks.
/// Returns the bytes copied. On cancellation the partial `dst` is removed.
pub fn copy_file_governed(src: &Path, dst: &Path, policy: &IoPolicy, limiter: &RateLimiter, ticket: Option<&Ticket>) -> Result<u64, CopyError> {
    if let Some(parent) = dst.parent() { std::fs::create_dir_all(parent)?; }
    let result = (|| -> Result<u64, CopyError> {
        let mut input = std::fs::File::open(src)?;
        let mut output = std::fs::File::create(dst)?;
        let mut buf = vec![0u8; (policy.buffer_kib as usize) * 1024];
        let every = policy.pause_every_mib.map(|m| (m as u64) << 20);
        let mut since_pause = 0u64;
        let mut total = 0u64;
        loop {
            if let Some(t) = ticket { t.checkpoint()?; }
            let n = input.read(&mut buf)?;
            if n == 0 { break; }
            limiter.acquire(n as u64);
            output.write_all(&buf[..n])?;
            total += n as u64;
            if let Some(t) = ticket { t.add_bytes(n as u64, n as u64); }
            if let Some(every) = every {
                since_pause += n as u64;
                if since_pause >= every && policy.pause_us > 0 {
                    std::thread::sleep(Duration::from_micros(policy.pause_us as u64));
                    since_pause = 0;
                }
            }
        }
        output.flush()?;
        Ok(total)
    })();
    if matches!(result, Err(CopyError::Cancelled)) { let _ = std::fs::remove_file(dst); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::config::{IoPriority, ThreadPriority};
    use crate::governor::queue::Queue;
    use crate::governor::config::OpKind;

    fn policy(buffer_kib: u32) -> IoPolicy {
        IoPolicy { rate_mb_s: None, parallel: 2, buffer_kib, io_priority: IoPriority::Normal, pause_every_mib: Some(16), pause_us: 150, thread_priority: ThreadPriority::Normal }
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("bmm-gov-io-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn file_of(dir: &Path, name: &str, len: usize) -> std::path::PathBuf {
        let p = dir.join(name);
        let data: Vec<u8> = (0..len).map(|i| (i * 31 % 251) as u8).collect();
        std::fs::write(&p, data).unwrap();
        p
    }

    #[test]
    fn every_copy_path_produces_identical_bytes() {
        let d = scratch("same");
        for len in [0usize, 1, 64 * 1024 - 1, 64 * 1024, 3 * 1024 * 1024 + 7] {
            let src = file_of(&d, &format!("s{len}"), len);
            for kib in [64u32, 1024, 4096] {
                let dst = d.join(format!("d{len}-{kib}"));
                let n = copy_file_governed(&src, &dst, &policy(kib), &RateLimiter::new(None), None).unwrap();
                assert_eq!(n as usize, len);
                assert_eq!(std::fs::read(&src).unwrap(), std::fs::read(&dst).unwrap(), "len={len} kib={kib}");
            }
        }
    }

    #[test]
    fn two_parallel_copies_share_one_disk_budget() {
        let d = scratch("budget");
        let a = file_of(&d, "a", 4 << 20);
        let b = file_of(&d, "b", 4 << 20);
        // 4 MB/s shared: 8 MB in total must take about 2 s (minus the one-second burst), not 1 s
        // as two independent 4 MB/s limits would.
        let lim = Arc::new(RateLimiter::new(Some(4 << 20)));
        let start = Instant::now();
        let (l1, l2) = (lim.clone(), lim.clone());
        let (a2, b2, da, db) = (a.clone(), b.clone(), d.join("ca"), d.join("cb"));
        let h1 = std::thread::spawn(move || copy_file_governed(&a2, &da, &policy(256), &l1, None).unwrap());
        let h2 = std::thread::spawn(move || copy_file_governed(&b2, &db, &policy(256), &l2, None).unwrap());
        h1.join().unwrap(); h2.join().unwrap();
        let took = start.elapsed();
        assert!(took >= Duration::from_millis(900), "two copies shared one 4 MB/s budget: {took:?}");
        // The same two copies with a limiter each finish in about the burst alone.
        let start = Instant::now();
        let (da, db) = (d.join("ia"), d.join("ib"));
        let (a3, b3) = (a.clone(), b.clone());
        let h1 = std::thread::spawn(move || copy_file_governed(&a3, &da, &policy(256), &RateLimiter::new(Some(4 << 20)), None).unwrap());
        let h2 = std::thread::spawn(move || copy_file_governed(&b3, &db, &policy(256), &RateLimiter::new(Some(4 << 20)), None).unwrap());
        h1.join().unwrap(); h2.join().unwrap();
        assert!(start.elapsed() < took, "separate budgets are faster, which is the defect a shared one fixes");
    }

    #[test]
    fn cancel_mid_file_removes_the_partial_destination() {
        let d = scratch("cancel");
        let src = file_of(&d, "big", 8 << 20);
        let dst = d.join("out");
        let q = Queue::default();
        let t = q.begin(OpKind::Deploy, "big");
        q.pause(t.id()); // hold it at the first checkpoint...
        let id = t.id();
        let (s2, d2) = (src.clone(), dst.clone());
        let h = std::thread::spawn(move || copy_file_governed(&s2, &d2, &policy(64), &RateLimiter::new(None), Some(&t)));
        std::thread::sleep(Duration::from_millis(80));
        q.cancel(id); // ...then cancel it
        assert!(matches!(h.join().unwrap(), Err(CopyError::Cancelled)));
        assert!(!dst.exists(), "no half file is left behind");
    }

    #[test]
    fn pause_mid_file_then_resume_yields_identical_bytes() {
        let d = scratch("pause");
        let src = file_of(&d, "big", 6 << 20);
        let dst = d.join("out");
        let q = Queue::default();
        let t = q.begin(OpKind::Install, "big");
        let id = t.id();
        // A slow limit so the copy is still running when we pause it.
        let lim = Arc::new(RateLimiter::new(Some(8 << 20)));
        let (s2, d2, l2) = (src.clone(), dst.clone(), lim.clone());
        let h = std::thread::spawn(move || copy_file_governed(&s2, &d2, &policy(64), &l2, Some(&t)).unwrap());
        std::thread::sleep(Duration::from_millis(30));
        q.pause(id);
        std::thread::sleep(Duration::from_millis(150));
        q.resume(id);
        let n = h.join().unwrap();
        assert_eq!(n, 6 << 20);
        assert_eq!(std::fs::read(&src).unwrap(), std::fs::read(&dst).unwrap());
    }

    #[test]
    fn a_volume_has_one_bucket_whoever_asks() {
        let a = limiter_for("D:\\", Some(10));
        let b = limiter_for("d:\\", Some(20));
        assert!(Arc::ptr_eq(&a, &b), "the same volume, however it is spelled, shares one budget");
        assert_eq!(*a.rate.lock().unwrap(), Some(20), "the latest rule wins");
    }
}
