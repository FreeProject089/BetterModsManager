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
use super::config::{pool_threads, DiskKind, IoPolicy, OpKind, Preset, ResourcesConfig, Target};
use super::io::{copy_file_governed, limiter_for, CopyError};
use super::queue::{Queue, Ticket};
use std::collections::HashMap;
use std::path::{Component, Path, Prefix};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

pub struct Governor {
    config: RwLock<ResourcesConfig>,
    queue: Queue,
    pools: Mutex<HashMap<OpKind, Arc<rayon::ThreadPool>>>,
    disks: Mutex<HashMap<String, DiskKind>>,
}

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
        Governor { config: RwLock::new(cfg), queue, pools: Mutex::new(HashMap::new()), disks: Mutex::new(HashMap::new()) }
    }

    /// Apply a new resources document. Slots change at once; pools are rebuilt on next use
    /// (a pool already running work keeps it: the old `Arc` lives until its jobs finish).
    pub fn configure(&self, cfg: ResourcesConfig) {
        let preset_changed = self.config.read().map(|c| c.preset != cfg.preset).unwrap_or(true);
        let slots = slots_for(&cfg);
        for k in OpKind::ALL { self.queue.set_slots(k, *slots.get(&k).unwrap_or(&2)); }
        if let Ok(mut c) = self.config.write() { *c = cfg; }
        if preset_changed { self.pools.lock().unwrap_or_else(|p| p.into_inner()).clear(); }
    }

    pub fn config(&self) -> ResourcesConfig {
        self.config.read().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn queue(&self) -> &Queue { &self.queue }

    /// A ticket for one operation: waits for a free slot of its kind, and background kinds
    /// (hash, maintenance) step aside while foreground work runs (queue.rs).
    pub fn begin(&self, kind: OpKind, subject: &str) -> Ticket { self.queue.begin(kind, subject) }

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
        self.config.read().map(|c| c.resolve(kind, &target)).unwrap_or_else(|_| ResourcesConfig::default().resolve(kind, &target))
    }

    /// The rayon pool for `kind`, sized by the preset (hash: today's `(cores/2).clamp(1,4)`).
    pub fn pool(&self, kind: OpKind) -> Arc<rayon::ThreadPool> {
        let preset = self.config.read().map(|c| c.preset).unwrap_or_default();
        let mut m = self.pools.lock().unwrap_or_else(|p| p.into_inner());
        m.entry(kind).or_insert_with(|| {
            let n = pool_threads(preset, kind, cores());
            Arc::new(rayon::ThreadPoolBuilder::new()
                .num_threads(n)
                .thread_name(move |i| format!("bmm-{}-{i}", kind.key()))
                .build()
                .unwrap_or_else(|_| rayon::ThreadPoolBuilder::new().num_threads(1).build().expect("a one-thread pool")))
        }).clone()
    }

    /// Copy one file under `kind`'s policy for the DESTINATION disk, through that volume's
    /// shared rate limiter (two copies to one disk share one budget), checking the ticket for
    /// pause / cancel between chunks.
    pub fn copy(&self, kind: OpKind, src: &Path, dst: &Path, ticket: Option<&Ticket>) -> Result<u64, CopyError> {
        let policy = self.policy_for(kind, dst);
        let volume = volume_key(dst).unwrap_or_default();
        let limiter = limiter_for(&volume, policy.rate_mb_s.map(|m| m * 1024 * 1024));
        copy_file_governed(src, dst, &policy, &limiter, ticket)
    }
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
