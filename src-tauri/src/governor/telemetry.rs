//! Live samples for the resources dashboard (G6).
//!
//! **Zero cost at rest.** The sampling thread exists only while somebody is subscribed
//! (`resources_subscribe`, one per open dashboard); with no subscriber `tick` returns None
//! without reading a single counter, and the thread ends. One sample a second:
//!
//!   · BMM's CPU, as a share of the whole machine (process time delta / wall time / cores);
//!   · the machine's CPU (GetSystemTimes: kernel includes idle, so busy = kernel + user - idle);
//!   · BMM's disk I/O in MB/s (GetProcessIoCounters deltas);
//!   · the queue, the preset in force and game mode, from the governor.
//!
//! Emitted as `bmm://governor-tick` by the command that subscribes.
use super::config::Preset;
use super::queue::TicketView;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
pub struct Sample {
    pub t_ms: u64,
    /// Percent of the whole machine (all cores = 100).
    pub cpu_bmm: f32,
    pub cpu_system: f32,
    pub read_mbps: f32,
    pub write_mbps: f32,
    pub effective: Preset,
    pub game_active: bool,
    pub tickets: Vec<TicketView>,
}

#[derive(Debug, Clone, Copy, Default)]
struct Counters {
    /// 100 ns units.
    proc_time: u64,
    sys_busy: u64,
    sys_total: u64,
    read_bytes: u64,
    write_bytes: u64,
}

pub struct Sampler {
    subs: AtomicUsize,
    running: AtomicBool,
    prev: Mutex<Option<(Counters, Instant)>>,
}

pub fn sampler() -> &'static Sampler {
    static S: OnceLock<Sampler> = OnceLock::new();
    S.get_or_init(Sampler::new)
}

fn cores() -> f64 { std::thread::available_parallelism().map(|n| n.get() as f64).unwrap_or(1.0) }

impl Sampler {
    pub fn new() -> Sampler {
        Sampler { subs: AtomicUsize::new(0), running: AtomicBool::new(false), prev: Mutex::new(None) }
    }

    pub fn subscribe(&self) -> usize { self.subs.fetch_add(1, Ordering::SeqCst) + 1 }

    /// Never below zero: a dashboard that unsubscribes twice (closed, then its page unloaded)
    /// must not steal another dashboard's subscription.
    pub fn unsubscribe(&self) -> usize {
        let mut cur = self.subs.load(Ordering::SeqCst);
        loop {
            if cur == 0 { return 0; }
            match self.subs.compare_exchange(cur, cur - 1, Ordering::SeqCst, Ordering::SeqCst) {
                Ok(_) => return cur - 1,
                Err(now) => cur = now,
            }
        }
    }

    pub fn subscribers(&self) -> usize { self.subs.load(Ordering::SeqCst) }

    /// One sample, or None when nobody is listening (and then nothing is read at all).
    pub fn tick(&self) -> Option<Sample> {
        if self.subscribers() == 0 {
            *self.prev.lock().unwrap_or_else(|p| p.into_inner()) = None;
            return None;
        }
        let now = Instant::now();
        let c = read_counters();
        let mut prev = self.prev.lock().unwrap_or_else(|p| p.into_inner());
        let (cpu_bmm, cpu_system, read_mbps, write_mbps) = match *prev {
            Some((p, at)) => {
                let wall = now.duration_since(at).as_secs_f64().max(0.001);
                let proc_s = c.proc_time.saturating_sub(p.proc_time) as f64 / 1e7;
                let busy = c.sys_busy.saturating_sub(p.sys_busy) as f64;
                let total = c.sys_total.saturating_sub(p.sys_total) as f64;
                let mb = 1024.0 * 1024.0;
                (
                    (proc_s / wall / cores() * 100.0).clamp(0.0, 100.0) as f32,
                    if total > 0.0 { (busy / total * 100.0).clamp(0.0, 100.0) as f32 } else { 0.0 },
                    (c.read_bytes.saturating_sub(p.read_bytes) as f64 / mb / wall) as f32,
                    (c.write_bytes.saturating_sub(p.write_bytes) as f64 / mb / wall) as f32,
                )
            }
            None => (0.0, 0.0, 0.0, 0.0),
        };
        *prev = Some((c, now));
        drop(prev);
        let gov = super::runtime::global();
        Some(Sample {
            t_ms: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            cpu_bmm, cpu_system, read_mbps, write_mbps,
            effective: gov.effective_preset(),
            game_active: gov.game_mode().0,
            tickets: gov.queue().snapshot(),
        })
    }

    /// Start the 1 Hz loop if it is not running. It ends by itself when the last subscriber
    /// leaves. `emit` is called once per sample.
    pub fn run<F: Fn(&Sample) + Send + 'static>(&'static self, emit: F) {
        if self.running.swap(true, Ordering::SeqCst) { return; }
        std::thread::Builder::new().name("bmm-governor-telemetry".into()).spawn(move || loop {
            match self.tick() {
                Some(s) => emit(&s),
                None => {
                    self.running.store(false, Ordering::SeqCst);
                    // A subscriber that arrived between the empty tick and the store above saw
                    // `running` still true and started nothing: take the loop back for it.
                    if self.subscribers() == 0 || self.running.swap(true, Ordering::SeqCst) { return; }
                    continue;
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }).ok();
    }
}

#[cfg(windows)]
fn read_counters() -> Counters {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessIoCounters, GetProcessTimes, GetSystemTimes, IO_COUNTERS};
    let ft = |f: FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
    let mut c = Counters::default();
    // SAFETY: every out-parameter is a local of the right type; GetCurrentProcess returns a
    // pseudo-handle that needs no closing.
    unsafe {
        let me = GetCurrentProcess();
        let (mut cr, mut ex, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        if GetProcessTimes(me, &mut cr, &mut ex, &mut k, &mut u).is_ok() { c.proc_time = ft(k) + ft(u); }
        let (mut idle, mut sk, mut su) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        if GetSystemTimes(Some(&mut idle), Some(&mut sk), Some(&mut su)).is_ok() {
            c.sys_total = ft(sk) + ft(su);
            c.sys_busy = c.sys_total.saturating_sub(ft(idle));
        }
        let mut io = IO_COUNTERS::default();
        if GetProcessIoCounters(me, &mut io).is_ok() { c.read_bytes = io.ReadTransferCount; c.write_bytes = io.WriteTransferCount; }
    }
    c
}
#[cfg(not(windows))]
fn read_counters() -> Counters { Counters::default() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampler_emits_nothing_without_subscribers() {
        let s = Sampler::new();
        assert!(s.tick().is_none(), "no subscriber, no sample");
        s.subscribe();
        let first = s.tick().expect("a subscriber gets samples");
        assert_eq!(first.cpu_bmm, 0.0, "the first sample has no previous one to diff against");
        assert!(s.tick().is_some());
        s.unsubscribe();
        assert!(s.tick().is_none(), "the last one leaving stops the samples");
    }

    #[test]
    fn unsubscribing_never_goes_below_zero() {
        let s = Sampler::new();
        s.subscribe();
        assert_eq!(s.unsubscribe(), 0);
        assert_eq!(s.unsubscribe(), 0, "a second unsubscribe must not wrap");
        assert_eq!(s.subscribers(), 0);
    }

    #[test]
    fn busy_work_shows_up_as_cpu() {
        let s = Sampler::new();
        s.subscribe();
        s.tick();
        let t0 = Instant::now();
        let mut x = 0u64;
        while t0.elapsed() < Duration::from_millis(200) { x = x.wrapping_mul(6364136223846793005).wrapping_add(1); }
        std::hint::black_box(x);
        let smp = s.tick().unwrap();
        #[cfg(windows)]
        assert!(smp.cpu_bmm > 0.0, "a busy thread for 200 ms must register");
        assert!(smp.cpu_bmm <= 100.0 && smp.cpu_system <= 100.0);
    }
}
