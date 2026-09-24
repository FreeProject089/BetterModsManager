//! The governor's one instance (G3 wiring): what a call site asks for.
//!
//! Before this the pieces existed (config, queue, io, game_mode) and nothing held them
//! together, so every G3 phase would have had to invent its own instance. There is exactly
//! one, `global()`, configured from `AppData.resources` at startup and again whenever the
//! resources document changes (`configure`). A call site does three things:
//!
//! ```ignore
//! let gov = crate::governor::runtime::global();
//! let ticket = gov.begin(OpKind::Deploy, &mod_name);      // waits for a slot of its kind
//! gov.copy(OpKind::Deploy, &src, &dst, Some(&ticket))?;    // policy + per-volume rate limit
//! gov.pool(OpKind::Hash).install(|| files.par_iter()...);  // the kind's rayon pool
//! ```
//!
//! Balanced (the default) reproduces today's behaviour: 2 slots per kind, the hash pool at
//! `(cores / 2).clamp(1, 4)`, no rate limit unless a disk rule (migrated from `disk_limits`)
//! sets one. So wiring a site changes nothing until somebody picks another preset.
use super::config::{pool_threads, DiskKind, IoPolicy, OpKind, Preset, ResourcesConfig, Target, ThreadPriority};
use super::game_mode::{GameMode, Manual, Treatment};
use super::io::{copy_file_governed, limiter_for, CopyError, RateLimiter};
use super::queue::{Queue, Ticket};
use std::collections::HashMap;
use std::path::{Component, Path, Prefix};
use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

pub struct Governor {
    config: RwLock<ResourcesConfig>,
    queue: Queue,
    pools: Mutex<HashMap<OpKind, Arc<rayon::ThreadPool>>>,
    disks: Mutex<HashMap<String, DiskKind>>,
    /// A preset a scheduled task set for its own duration (A3). Never persisted.
    task: Mutex<Option<TaskPreset>>,
    game: Mutex<GameMode>,
    /// Background tickets this governor paused for game mode, so leaving it resumes exactly
    /// those and not one the user paused by hand.
    paused_for_game: Mutex<HashSet<u64>>,
    /// The preset the pools were last built for.
    built_for: Mutex<Option<Preset>>,
    /// Whether pool threads set the priority the preset resolves (win.rs). Always in the app;
    /// off in unit tests, where hundreds of tests share the machine and a hash pool in
    /// background mode starved under that load hit the governed-hash tests' 5 s timeouts.
    /// The test that checks priorities turns it on for its own instance.
    apply_thread_priority: bool,
}

/// A task-scoped preset. `token` lets only the task that set it clear it; `until` is the
/// safety net: a task that dies without its `finally` cannot leave BMM in Max for ever.
#[derive(Debug, Clone, Copy)]
pub struct TaskPreset {
    pub preset: Preset,
    pub overrides_game: bool,
    pub token: u64,
    pub until: Instant,
}

/// The longest a task-scoped preset may last, whatever the task asked (plan §5.1: TTL 2 h).
pub const TASK_PRESET_MAX: Duration = Duration::from_secs(2 * 60 * 60);

static GOV: OnceLock<Governor> = OnceLock::new();

/// The instance. Built with the default (Balanced) document on first use, so a call site that
/// runs before startup has configured it (a unit test, the MCP example) still works.
pub fn global() -> &'static Governor {
    GOV.get_or_init(|| Governor::new(ResourcesConfig::default()))
}

fn cores() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
}

/// Slots per kind for a preset: Silent runs one of each at a time, Max as many as the pool
/// has threads, Balanced / Custom today's 2 (the queue's default for an unlisted kind).
fn slots_for(cfg: &ResourcesConfig) -> HashMap<OpKind, usize> {
    match cfg.preset {
        Preset::Silent => OpKind::ALL.iter().map(|k| (*k, 1)).collect(),
        Preset::Max => OpKind::ALL.iter().map(|k| (*k, pool_threads(Preset::Max, *k, cores()))).collect(),
        Preset::Balanced | Preset::Custom => HashMap::new(),
    }
}

/// The lower-cased mount point of a path (`d:\`), or `\\server\share\` for a UNC path, the key
/// rules and rate limiters are stored under. None for a relative path.
pub fn volume_key(path: &Path) -> Option<String> {
    match path.components().next()? {
        Component::Prefix(p) => Some(match p.kind() {
            Prefix::Disk(l) | Prefix::VerbatimDisk(l) => format!("{}:\\", (l as char).to_ascii_lowercase()),
            Prefix::UNC(s, sh) | Prefix::VerbatimUNC(s, sh) => format!("\\\\{}\\{}\\", s.to_string_lossy(), sh.to_string_lossy()).to_lowercase(),
            _ => p.as_os_str().to_string_lossy().to_lowercase(),
        }),
        Component::RootDir => Some("/".into()),
        _ => None,
    }
}

impl Governor {
    fn new(cfg: ResourcesConfig) -> Governor {
        let queue = Queue::new(slots_for(&cfg));
        Governor {
            config: RwLock::new(cfg), queue, pools: Mutex::new(HashMap::new()), disks: Mutex::new(HashMap::new()),
            task: Mutex::new(None), game: Mutex::new(GameMode::new(&[], &[])),
            paused_for_game: Mutex::new(HashSet::new()), built_for: Mutex::new(None),
            apply_thread_priority: !cfg!(test),
        }
    }

    /// The preset in force: the user's, unless game mode or a task-scoped preset says
    /// otherwise (game_mode.rs `effective_preset`). An expired task preset no longer counts.
    pub fn effective_preset(&self) -> Preset {
        let chosen = self.config.read().map(|c| c.preset).unwrap_or_default();
        let task = self.task.lock().unwrap_or_else(|p| p.into_inner())
            .filter(|t| Instant::now() < t.until)
            .map(|t| (t.preset, t.overrides_game));
        self.game.lock().unwrap_or_else(|p| p.into_inner()).effective_preset(chosen, task)
    }

    /// Re-derive slots, pools and the game-mode pauses from the effective preset. Called after
    /// anything that can change it.
    fn refresh(&self) {
        let eff = self.effective_preset();
        let cfg = ResourcesConfig { preset: eff, ..self.config() };
        let slots = slots_for(&cfg);
        for k in OpKind::ALL { self.queue.set_slots(k, *slots.get(&k).unwrap_or(&2)); }
        let mut built = self.built_for.lock().unwrap_or_else(|p| p.into_inner());
        if *built != Some(eff) {
            self.pools.lock().unwrap_or_else(|p| p.into_inner()).clear();
            *built = Some(eff);
        }
        drop(built);
        self.apply_game_pauses();
    }

    /// Background work (hash, maintenance) is held at its checkpoints while a game runs, and
    /// released when it stops (game_mode.rs `treatment`).
    fn apply_game_pauses(&self) {
        let game = self.game.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let mut mine = self.paused_for_game.lock().unwrap_or_else(|p| p.into_inner());
        for t in self.queue.snapshot() {
            match game.treatment(t.kind) {
                Treatment::Paused => { if !mine.contains(&t.id) && self.queue.pause(t.id) { mine.insert(t.id); } }
                _ => { if mine.remove(&t.id) { self.queue.resume(t.id); } }
            }
        }
        if !game.is_active() {
            for id in mine.drain() { self.queue.resume(id); }
        }
    }

    /// Set a preset for a task's duration. Returns the token that clears it. `ttl` is capped
    /// at TASK_PRESET_MAX; a later call replaces an earlier one (the last task wins).
    pub fn set_task_preset(&self, preset: Preset, overrides_game: bool, ttl: Duration) -> u64 {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let token = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let until = Instant::now() + ttl.min(TASK_PRESET_MAX);
        *self.task.lock().unwrap_or_else(|p| p.into_inner()) = Some(TaskPreset { preset, overrides_game, token, until });
        self.refresh();
        token
    }

    /// Clear the task preset if `token` is still the one in force (a newer task's is kept).
    /// Returns whether it cleared anything.
    pub fn clear_task_preset(&self, token: u64) -> bool {
        let mut t = self.task.lock().unwrap_or_else(|p| p.into_inner());
        if t.map(|x| x.token == token).unwrap_or(false) { *t = None; drop(t); self.refresh(); true } else { false }
    }

    /// Drop an expired task preset (the TTL safety net). Cheap; called from status reads and
    /// a timer.
    pub fn expire_task_preset(&self) -> bool {
        let mut t = self.task.lock().unwrap_or_else(|p| p.into_inner());
        if t.map(|x| Instant::now() >= x.until).unwrap_or(false) { *t = None; drop(t); self.refresh(); true } else { false }
    }

    pub fn task_preset(&self) -> Option<TaskPreset> { *self.task.lock().unwrap_or_else(|p| p.into_inner()) }

    pub fn set_game_manual(&self, m: Manual) {
        self.game.lock().unwrap_or_else(|p| p.into_inner()).manual = m;
        self.refresh();
    }

    pub fn game_mode(&self) -> (bool, Manual) {
        let g = self.game.lock().unwrap_or_else(|p| p.into_inner());
        (g.is_active(), g.manual)
    }

    /// Game detection (procs.rs), step 1: the lists. `game_dirs` = every profile's game folder
    /// (None: the profiles could not be read this time, keep the previous folders); the manual
    /// list comes from the document. Returns (detection is on, listing processes is worth it).
    pub fn set_game_lists(&self, game_dirs: Option<&[String]>) -> (bool, bool) {
        let extra = self.config.read().map(|c| c.game_exes.clone()).unwrap_or_default();
        let mut g = self.game.lock().unwrap_or_else(|p| p.into_inner());
        match game_dirs {
            Some(d) => g.set_lists(d, &extra),
            None => g.set_extra(&extra),
        }
        let auto = g.manual == Manual::Auto;
        (auto, auto && g.has_targets())
    }

    /// Game detection, step 2: one sample of running executables (full paths) and the
    /// full-screen signal. When game mode turns on or off, the preset in force, the slots, the
    /// pools and the background pauses follow at once. Returns whether it changed.
    pub fn observe_games(&self, running: &[String], fullscreen: bool, now: Instant) -> bool {
        let changed = {
            let mut g = self.game.lock().unwrap_or_else(|p| p.into_inner());
            let before = g.is_active();
            before != g.observe_with(running.iter().map(|s| s.as_str()), fullscreen, now)
        };
        if changed { self.refresh(); }
        changed
    }

    /// Apply a new resources document. Slots change at once; pools are rebuilt on next use
    /// (a pool already running work keeps it: the old `Arc` lives until its jobs finish).
    pub fn configure(&self, cfg: ResourcesConfig) {
        if let Ok(mut c) = self.config.write() { *c = cfg; }
        self.refresh();
    }

    pub fn config(&self) -> ResourcesConfig {
        self.config.read().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn queue(&self) -> &Queue { &self.queue }

    /// A ticket for one operation: waits for a free slot of its kind, and background kinds
    /// (hash, maintenance) step aside while foreground work runs (queue.rs).
    pub fn begin(&self, kind: OpKind, subject: &str) -> Ticket {
        // Nested inside a ticket of the same kind on this thread (an export that zips, a sync
        // that installs): waiting for a slot would wait for our own outer ticket, for ever
        // under Silent's single slot. The nested one takes no slot and stays visible.
        let t = if self.queue.held_here(kind) { self.queue.begin_unslotted(kind, subject) } else { self.queue.begin(kind, subject) };
        let paused = self.game.lock().unwrap_or_else(|p| p.into_inner()).treatment(kind) == Treatment::Paused;
        if paused && self.queue.pause(t.id()) {
            self.paused_for_game.lock().unwrap_or_else(|p| p.into_inner()).insert(t.id());
        }
        t
    }

    /// `begin` for ASYNC code (a Tauri `async fn`, anything on the runtime).
    ///
    /// `begin` blocks until a slot frees, which on the runtime parks one of its few worker
    /// threads — the ones the local API and the built-in repo server answer on — for as long
    /// as the operation ahead of it runs (under Silent, i.e. whenever game mode is on, one
    /// Download at a time). And it records the calling thread for the nested-ticket rule, which
    /// means nothing for a future: a second sync polled on the same worker looked "nested" in
    /// the first and took no slot at all, so game mode's one-at-a-time did not hold (pentest
    /// R13). Here the wait runs on a blocking thread and the ticket is tied to no thread.
    /// Game mode still pauses a background kind at once, as in `begin`.
    pub async fn begin_async(&self, kind: OpKind, subject: String) -> Ticket {
        let q = self.queue.clone();
        let t = match tokio::task::spawn_blocking(move || q.begin_detached(kind, &subject)).await {
            Ok(t) => t,
            // The blocking pool refused or the closure panicked (it cannot short of a poisoned
            // lock, which the queue recovers from): wait here rather than run ungoverned.
            Err(_) => self.queue.begin_detached(kind, "ticket"),
        };
        let paused = self.game.lock().unwrap_or_else(|p| p.into_inner()).treatment(kind) == Treatment::Paused;
        if paused && self.queue.pause(t.id()) {
            self.paused_for_game.lock().unwrap_or_else(|p| p.into_inner()).insert(t.id());
        }
        t
    }

    /// What the disk under `path` is, detected once per volume (IOCTL on Windows).
    fn disk_kind(&self, volume: &str) -> DiskKind {
        if volume.starts_with("\\\\") { return DiskKind::Network; }
        let mut m = self.disks.lock().unwrap_or_else(|p| p.into_inner());
        *m.entry(volume.to_string()).or_insert_with(|| {
            let d = crate::hw_detect::disk(volume);
            match (d.bus.as_str(), d.seek_penalty) {
                ("nvme", _) => DiskKind::Nvme,
                (_, Some(true)) => DiskKind::Hdd,
                (_, Some(false)) => DiskKind::Ssd,
                _ => DiskKind::Unknown,
            }
        })
    }

    /// The resolved policy for `kind` on the disk that holds `path`.
    pub fn policy_for(&self, kind: OpKind, path: &Path) -> IoPolicy {
        let volume = volume_key(path);
        let system = std::env::var("SystemDrive").ok().map(|s| format!("{}\\", s.to_lowercase()));
        let dk = volume.as_deref().map(|v| self.disk_kind(v)).unwrap_or_default();
        let target = Target {
            disk: volume.as_deref(),
            kind: dk,
            on_system_drive: volume.is_some() && volume == system,
            cores: cores(),
        };
        let cfg = ResourcesConfig { preset: self.effective_preset(), ..self.config() };
        cfg.resolve(kind, &target)
    }

    /// The thread priority `kind`'s pool runs at under `preset` (rules do not set it; the
    /// preset does: Quiet = background, Balanced = background for hash and maintenance,
    /// Everything for BMM = normal). Capped at MAX_THREAD_PRIORITY by `resolve`.
    pub fn pool_priority(&self, preset: Preset, kind: OpKind) -> ThreadPriority {
        let cfg = ResourcesConfig { preset, ..self.config() };
        cfg.resolve(kind, &Target { disk: None, kind: DiskKind::Unknown, on_system_drive: false, cores: cores() }).thread_priority
    }

    /// The rayon pool for `kind`, sized by the preset (hash: today's `(cores/2).clamp(1,4)`).
    /// Each of its threads sets its own priority as it starts (win.rs); a preset change
    /// rebuilds the pool, so the priority follows game mode and task presets too.
    pub fn pool(&self, kind: OpKind) -> Arc<rayon::ThreadPool> {
        let preset = self.effective_preset();
        let prio = self.pool_priority(preset, kind);
        let mut m = self.pools.lock().unwrap_or_else(|p| p.into_inner());
        m.entry(kind).or_insert_with(|| {
            let n = pool_threads(preset, kind, cores());
            let apply = self.apply_thread_priority;
            let start = move |_: usize| if apply { super::win::set_current_thread_priority(prio) };
            Arc::new(rayon::ThreadPoolBuilder::new()
                .num_threads(n)
                .thread_name(move |i| format!("bmm-{}-{i}", kind.key()))
                .start_handler(start)
                .build()
                .unwrap_or_else(|_| rayon::ThreadPoolBuilder::new().num_threads(1).start_handler(start).build().expect("a one-thread pool")))
        }).clone()
    }

    /// The MB/s budget `kind` draws on when it writes to (or, for a read-only kind, reads
    /// from) the disk under `path`; None = no limit. A disk-wide rate is ONE bucket per volume,
    /// shared by every kind that inherits it; a rate set for this operation ((disk, op) or
    /// (*, op)) is a bucket of its own on that volume, so a download limit does not slow a
    /// deploy to the same disk. For the byte loops outside the governed copy (extraction,
    /// repository sync, modpack downloads).
    pub fn limiter(&self, kind: OpKind, path: &Path) -> Option<Arc<RateLimiter>> {
        let policy = self.policy_for(kind, path);
        self.limiter_with(kind, path, &policy)
    }

    fn limiter_with(&self, kind: OpKind, path: &Path, policy: &IoPolicy) -> Option<Arc<RateLimiter>> {
        let rate = policy.rate_mb_s?;
        let volume = volume_key(path).unwrap_or_default();
        let own = self.config.read().map(|c| c.rate_is_op_specific(Some(&volume), kind)).unwrap_or(false);
        let key = if own { format!("{volume}|{}", kind.key()) } else { volume };
        Some(limiter_for(&key, Some(rate.saturating_mul(1024 * 1024))))
    }

    /// Copy one file under `kind`'s policy for the DESTINATION disk, through that volume's
    /// rate limiter (two copies to one disk share one budget), checking the ticket for
    /// pause / cancel between chunks. No limit: no bucket is touched at all.
    pub fn copy(&self, kind: OpKind, src: &Path, dst: &Path, ticket: Option<&Ticket>) -> Result<u64, CopyError> {
        let policy = self.policy_for(kind, dst);
        let limiter = self.limiter_with(kind, dst, &policy).unwrap_or_else(|| Arc::new(RateLimiter::new(None)));
        copy_file_governed(src, dst, &policy, &limiter, ticket)
    }
}

/// A private instance for a test elsewhere in the crate that must not move the global one
/// (game mode, presets and slots are process-wide, and tests run in parallel).
#[cfg(test)]
impl Governor {
    pub(crate) fn for_tests(cfg: ResourcesConfig) -> Governor { Governor::new(cfg) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_keys_are_lower_cased_mount_points() {
        #[cfg(windows)]
        {
            assert_eq!(volume_key(Path::new(r"D:\Games\Mods\a.pak")).as_deref(), Some(r"d:\"));
            assert_eq!(volume_key(Path::new(r"\\?\E:\x")).as_deref(), Some(r"e:\"));
            assert_eq!(volume_key(Path::new(r"\\NAS\Share\mods\x")).as_deref(), Some(r"\\nas\share\"));
        }
        assert_eq!(volume_key(Path::new("relative/x")), None);
    }

    #[test]
    fn balanced_keeps_todays_slots_and_hash_pool() {
        let g = Governor::new(ResourcesConfig::default());
        assert!(slots_for(&g.config()).is_empty(), "Balanced must leave the queue at its default of 2");
        let n = g.pool(OpKind::Hash).current_num_threads();
        assert_eq!(n, crate::governor::config::clamp_pool_threads((cores() / 2).clamp(1, 4), cores()));
    }

    #[test]
    fn silent_runs_one_of_each_and_rebuilds_pools() {
        let g = Governor::new(ResourcesConfig::default());
        let before = g.pool(OpKind::Deploy);
        g.configure(ResourcesConfig { preset: Preset::Silent, ..Default::default() });
        assert!(slots_for(&g.config()).values().all(|n| *n == 1));
        let after = g.pool(OpKind::Deploy);
        assert!(!Arc::ptr_eq(&before, &after), "a preset change must rebuild the pool");
        assert_eq!(after.current_num_threads(), 1);
    }

    #[test]
    fn task_scoped_preset_applies_and_only_its_token_clears_it() {
        let g = Governor::new(ResourcesConfig::default());
        let a = g.set_task_preset(Preset::Max, false, Duration::from_secs(60));
        assert_eq!(g.effective_preset(), Preset::Max);
        let b = g.set_task_preset(Preset::Silent, false, Duration::from_secs(60));
        assert!(!g.clear_task_preset(a), "an older task must not clear a newer task's preset");
        assert_eq!(g.effective_preset(), Preset::Silent);
        assert!(g.clear_task_preset(b));
        assert_eq!(g.effective_preset(), Preset::Balanced);
        assert_eq!(g.config().preset, Preset::Balanced, "a task preset is never written to the document");
    }

    #[test]
    fn task_preset_expires_and_is_capped_at_two_hours() {
        let g = Governor::new(ResourcesConfig::default());
        g.set_task_preset(Preset::Max, false, Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(g.effective_preset(), Preset::Balanced, "an expired task preset no longer counts");
        assert!(g.expire_task_preset());
        g.set_task_preset(Preset::Max, false, Duration::from_secs(10 * 60 * 60));
        let left = g.task_preset().unwrap().until.duration_since(Instant::now());
        assert!(left <= TASK_PRESET_MAX);
    }

    #[test]
    fn manual_game_mode_beats_a_task_preset_that_does_not_override_it() {
        let g = Governor::new(ResourcesConfig::default());
        g.set_task_preset(Preset::Max, false, Duration::from_secs(60));
        g.set_game_manual(Manual::On);
        assert_eq!(g.effective_preset(), Preset::Silent);
        g.set_game_manual(Manual::Off);
        assert_eq!(g.effective_preset(), Preset::Max);
    }

    #[test]
    fn game_mode_pauses_background_tickets_and_releases_them_after() {
        let g = Governor::new(ResourcesConfig::default());
        g.set_game_manual(Manual::On);
        let t = g.begin(OpKind::Hash, "bg");
        let view = |g: &Governor| g.queue().snapshot().into_iter().find(|v| v.subject == "bg").unwrap().state;
        assert_eq!(view(&g), crate::governor::queue::TicketState::Paused);
        let d = g.begin(OpKind::Deploy, "fg");
        assert_ne!(g.queue().snapshot().into_iter().find(|v| v.subject == "fg").unwrap().state, crate::governor::queue::TicketState::Paused, "deploy is throttled, not paused");
        g.set_game_manual(Manual::Off);
        assert_ne!(view(&g), crate::governor::queue::TicketState::Paused);
        drop((t, d));
    }

    #[test]
    fn a_nested_ticket_of_the_same_kind_never_waits_for_its_own_outer_ticket() {
        let g = Governor::new(ResourcesConfig::default());
        g.configure(ResourcesConfig { preset: Preset::Silent, ..Default::default() });
        let outer = g.begin(OpKind::Compress, "outer");
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::scope(|s| {
            s.spawn(|| { let inner = g.begin(OpKind::Compress, "inner"); tx.send(inner.id()).unwrap(); });
            // A DIFFERENT thread must still wait for the one slot (checked with a short timeout).
            assert!(rx.recv_timeout(Duration::from_millis(150)).is_err(), "another thread got past a full slot");
            drop(outer);
            assert!(rx.recv_timeout(Duration::from_secs(5)).is_ok());
        });
        let outer = g.begin(OpKind::Compress, "outer again");
        let inner = g.begin(OpKind::Compress, "nested, same thread");  // would hang before
        assert_eq!(g.queue().snapshot().iter().filter(|v| v.kind == OpKind::Compress).count(), 2);
        drop((inner, outer));
    }

    /// Pentest R13: two async operations of one kind under Silent (one slot) — game mode's
    /// setting. Polled on the SAME runtime thread, the second used to ride on the first as a
    /// "nested" ticket and take no slot.
    #[test]
    fn async_operations_share_the_slots_whatever_thread_polls_them() {
        let g = Governor::new(ResourcesConfig { preset: Preset::Silent, ..Default::default() });
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let a = g.begin_async(OpKind::Download, "sync a".into()).await;
            let second = tokio::time::timeout(Duration::from_millis(200), g.begin_async(OpKind::Download, "sync b".into())).await;
            assert!(second.is_err(), "a second download started while the only slot was taken");
            drop(a);
            let b = tokio::time::timeout(Duration::from_secs(5), g.begin_async(OpKind::Download, "sync c".into())).await
                .expect("the slot frees when the first ticket drops");
            drop(b);
        });
    }

    #[test]
    fn pool_threads_run_at_the_priority_the_preset_resolves() {
        let mut g = Governor::new(ResourcesConfig::default());
        assert!(!g.apply_thread_priority, "unit tests keep every other pool at normal priority");
        g.apply_thread_priority = true; // this instance only: what the app does
        assert_eq!(g.pool_priority(Preset::Balanced, OpKind::Deploy), ThreadPriority::Normal);
        assert_eq!(g.pool_priority(Preset::Balanced, OpKind::Hash), ThreadPriority::Background);
        assert_eq!(g.pool_priority(Preset::Silent, OpKind::Deploy), ThreadPriority::Background);
        assert_eq!(g.pool_priority(Preset::Max, OpKind::Hash), ThreadPriority::Normal);
        #[cfg(windows)]
        {
            use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority};
            // SAFETY: pseudo-handle of the calling (pool) thread.
            let prio_on = |g: &Governor, k: OpKind| g.pool(k).install(|| unsafe { GetThreadPriority(GetCurrentThread()) });
            assert_eq!(prio_on(&g, OpKind::Deploy), 0, "Balanced deploy threads run at normal");
            assert!(prio_on(&g, OpKind::Hash) < 0, "Balanced hash threads run in background mode");
            g.configure(ResourcesConfig { preset: Preset::Silent, ..Default::default() });
            assert!(prio_on(&g, OpKind::Deploy) < 0, "Quiet: the rebuilt pool runs in background mode");
        }
    }

    #[test]
    fn a_disk_rate_is_one_shared_bucket_and_an_operation_rate_its_own() {
        use crate::governor::config::IoRule;
        let mut cfg = ResourcesConfig::default();
        cfg.set_rule("q:", "*", Some(IoRule { rate_mb_s: Some(40), ..Default::default() })).unwrap();
        cfg.set_rule("q:", "download", Some(IoRule { rate_mb_s: Some(5), ..Default::default() })).unwrap();
        let g = Governor::new(cfg);
        let p = Path::new(r"Q:\Games\mod.bin");
        #[cfg(windows)]
        {
            let deploy = g.limiter(OpKind::Deploy, p).expect("the disk-wide rate");
            let backup = g.limiter(OpKind::Backup, p).expect("the disk-wide rate");
            assert!(Arc::ptr_eq(&deploy, &backup), "every kind that inherits the disk rate shares one budget");
            let dl = g.limiter(OpKind::Download, p).expect("the download rate");
            assert!(!Arc::ptr_eq(&dl, &deploy), "a download limit is a budget of its own");
        }
        assert!(g.limiter(OpKind::Deploy, Path::new(r"Z:\no\rule")).is_none(), "no rate, no bucket");
    }

    #[test]
    fn copy_goes_through_and_counts_bytes() {
        let dir = std::env::temp_dir().join(format!("bmm-gov-rt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.bin");
        let dst = dir.join("b.bin");
        std::fs::write(&src, vec![7u8; 300_000]).unwrap();
        let g = Governor::new(ResourcesConfig::default());
        let t = g.begin(OpKind::Deploy, "test");
        let n = g.copy(OpKind::Deploy, &src, &dst, Some(&t)).unwrap();
        assert_eq!(n, 300_000);
        assert_eq!(std::fs::read(&dst).unwrap(), std::fs::read(&src).unwrap());
        drop(t);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
