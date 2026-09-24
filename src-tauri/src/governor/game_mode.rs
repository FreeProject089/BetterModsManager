//! "A game is running" (PLAN-BMM-RESOURCES-2026.md §2.3, phase G4), as a pure state machine.
//!
//! The sampler (`procs.rs`) lists the running executables every 5 seconds and feeds them
//! here; this file decides, from that list and the user's choices, whether BMM is in game mode
//! and which preset applies. Pure so every rule is a test, with the process list injected.
//!
//! The rules:
//!   · a game is an executable under a profile's game folder, or in the user's own list,
//!     compared case-insensitively (Windows paths);
//!   · entering is immediate; leaving waits 30 s of absence, so a launcher that restarts the
//!     game or a loading screen that swaps processes does not flip BMM back and forth;
//!   · the user's manual choice (on / off) beats detection;
//!   · game mode beats a preset a scheduled task asked for, unless that task was allowed to
//!     ignore it (off by default and removed on import);
//!   · in game mode, background hashing and maintenance are paused, and deploy / install are
//!     slowed, never paused: a half-modded game folder is worse than a slow one.

use super::config::{OpKind, Preset};
use std::time::{Duration, Instant};

pub const LEAVE_AFTER: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Manual {
    #[default]
    Auto,
    On,
    Off,
}

/// What the governor should do for one kind of operation right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Treatment {
    Normal,
    /// Slowed to the game preset's policy.
    Throttled,
    /// Held at its checkpoints until game mode ends.
    Paused,
}

#[derive(Debug, Clone)]
pub struct GameMode {
    /// Lower-cased game folders from the profiles, with a trailing separator.
    game_dirs: Vec<String>,
    /// Lower-cased executable names or full paths the user listed.
    extra: Vec<String>,
    pub manual: Manual,
    pub game_preset: Preset,
    last_seen: Option<Instant>,
    active: bool,
}

fn norm_dir(d: &str) -> String {
    let mut s = d.replace('/', "\\").to_lowercase();
    if !s.ends_with('\\') { s.push('\\'); }
    s
}

/// `c:\`, `\`, `\\server\share\`: a normalised folder that is a whole volume.
fn is_drive_root(d: &str) -> bool {
    let b = d.as_bytes();
    d == "\\" || (b.len() == 3 && b[0].is_ascii_alphabetic() && b[1] == b':')
        || d.strip_prefix("\\\\").map(|r| r.trim_end_matches('\\').split('\\').count() <= 2).unwrap_or(false)
}

impl GameMode {
    pub fn new(game_dirs: &[String], extra: &[String]) -> GameMode {
        GameMode {
            // A blank folder, or one that is a whole drive (`C:\`, `\`), would make every program
            // on it "a game" and keep BMM in game mode for good: such a folder counts for nothing.
            game_dirs: game_dirs.iter().filter(|d| !d.trim().is_empty()).map(|d| norm_dir(d.trim()))
                .filter(|d| !is_drive_root(d)).collect(),
            extra: extra.iter().map(|e| e.replace('/', "\\").to_lowercase()).collect(),
            manual: Manual::Auto,
            game_preset: Preset::Silent,
            last_seen: None,
            active: false,
        }
    }

    /// Is this executable path a game?
    pub fn is_game(&self, exe: &str) -> bool {
        let e = exe.replace('/', "\\").to_lowercase();
        let name = e.rsplit('\\').next().unwrap_or(&e);
        self.game_dirs.iter().any(|d| e.starts_with(d.as_str()))
            || self.extra.iter().any(|x| x == &e || x == name)
    }

    /// Replace the game folders and the manual list (profiles saved, the list edited) without
    /// touching the detection state: a game already seen stays seen until it is absent for
    /// LEAVE_AFTER under the new lists too.
    pub fn set_lists(&mut self, game_dirs: &[String], extra: &[String]) {
        let fresh = GameMode::new(game_dirs, extra);
        self.game_dirs = fresh.game_dirs;
        self.extra = fresh.extra;
    }

    /// Replace the manual list only (the profiles could not be read this time).
    pub fn set_extra(&mut self, extra: &[String]) {
        self.extra = GameMode::new(&[], extra).extra;
    }

    /// Is there anything to look for? With no game folder and no listed executable, the
    /// sampler need not list processes at all.
    pub fn has_targets(&self) -> bool { !self.game_dirs.is_empty() || !self.extra.is_empty() }

    /// Feed one sample of running executables. Returns whether game mode is active afterwards.
    pub fn observe<'a>(&mut self, running: impl IntoIterator<Item = &'a str>, now: Instant) -> bool {
        self.observe_with(running, false, now)
    }

    /// `observe` with a second signal: Windows says a full-screen Direct3D program is running
    /// (`QUNS_RUNNING_D3D_FULL_SCREEN`), which counts as a game even when it is in no list.
    pub fn observe_with<'a>(&mut self, running: impl IntoIterator<Item = &'a str>, fullscreen: bool, now: Instant) -> bool {
        let seen = fullscreen || running.into_iter().any(|p| self.is_game(p));
        if seen {
            self.last_seen = Some(now);
            self.active = true;
        } else if self.active {
            if self.last_seen.map(|t| now.duration_since(t) >= LEAVE_AFTER).unwrap_or(true) {
                self.active = false;
            }
        }
        self.is_active()
    }

    pub fn is_active(&self) -> bool {
        match self.manual { Manual::On => true, Manual::Off => false, Manual::Auto => self.active }
    }

    /// The preset in force. `chosen` is the user's preset; `task` a preset a scheduled task set
    /// for its duration, with whether that task may override game mode.
    pub fn effective_preset(&self, chosen: Preset, task: Option<(Preset, bool)>) -> Preset {
        match task {
            Some((p, true)) => p,
            _ if self.is_active() => self.game_preset,
            Some((p, false)) => p,
            None => chosen,
        }
    }

    pub fn treatment(&self, kind: OpKind) -> Treatment {
        if !self.is_active() { return Treatment::Normal; }
        match kind {
            OpKind::Hash | OpKind::Maintenance => Treatment::Paused,
            _ => Treatment::Throttled,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gm() -> GameMode { GameMode::new(&["D:/Games/Skyrim".into()], &["eldenring.exe".into()]) }

    #[test]
    fn exe_under_a_profile_game_path_enters_game_mode_case_insensitively() {
        let mut g = gm();
        let t0 = Instant::now();
        assert!(!g.observe(["C:\\Windows\\explorer.exe"], t0));
        assert!(g.observe(["d:\\GAMES\\skyrim\\SkyrimSE.exe"], t0), "entering is immediate, case does not matter");
        let mut g2 = gm();
        assert!(g2.observe(["E:\\Steam\\steamapps\\common\\ELDEN RING\\Game\\EldenRing.exe"], t0), "a listed executable name counts wherever it runs");
        // A folder that merely starts with the same letters is not the game folder.
        let mut g3 = gm();
        assert!(!g3.observe(["D:\\Games\\SkyrimTools\\x.exe"], t0));
    }

    #[test]
    fn leaving_takes_thirty_seconds_of_absence() {
        let mut g = gm();
        let t0 = Instant::now();
        g.observe(["D:\\Games\\Skyrim\\SkyrimSE.exe"], t0);
        assert!(g.observe([], t0 + Duration::from_secs(10)), "a loading screen does not end it");
        assert!(g.observe([], t0 + Duration::from_secs(29)));
        assert!(!g.observe([], t0 + Duration::from_secs(31)), "30 s without the game ends it");
        // Seen again in between resets the clock.
        g.observe(["D:\\Games\\Skyrim\\SkyrimSE.exe"], t0 + Duration::from_secs(40));
        assert!(g.observe([], t0 + Duration::from_secs(65)));
    }

    #[test]
    fn manual_off_beats_auto() {
        let mut g = gm();
        let t0 = Instant::now();
        g.manual = Manual::Off;
        assert!(!g.observe(["D:\\Games\\Skyrim\\SkyrimSE.exe"], t0));
        g.manual = Manual::On;
        assert!(g.observe([], t0), "forced on without a game");
        g.manual = Manual::Auto;
        assert!(g.is_active(), "back to auto: the game seen earlier still counts");
    }

    #[test]
    fn a_task_scoped_max_preset_yields_to_game_mode() {
        let mut g = gm();
        let t0 = Instant::now();
        assert_eq!(g.effective_preset(Preset::Balanced, Some((Preset::Max, false))), Preset::Max, "no game: the task's preset");
        g.observe(["D:\\Games\\Skyrim\\SkyrimSE.exe"], t0);
        assert_eq!(g.effective_preset(Preset::Balanced, Some((Preset::Max, false))), Preset::Silent, "a game: game mode wins");
        assert_eq!(g.effective_preset(Preset::Balanced, Some((Preset::Max, true))), Preset::Max, "unless the task may override it");
        assert_eq!(g.effective_preset(Preset::Balanced, None), Preset::Silent);
    }

    #[test]
    fn deploy_is_throttled_not_paused() {
        let mut g = gm();
        assert_eq!(g.treatment(OpKind::Deploy), Treatment::Normal);
        g.observe(["D:\\Games\\Skyrim\\SkyrimSE.exe"], Instant::now());
        assert_eq!(g.treatment(OpKind::Deploy), Treatment::Throttled);
        assert_eq!(g.treatment(OpKind::Install), Treatment::Throttled);
        assert_eq!(g.treatment(OpKind::Hash), Treatment::Paused);
        assert_eq!(g.treatment(OpKind::Maintenance), Treatment::Paused);
    }

    #[test]
    fn new_lists_keep_a_game_already_seen() {
        let mut g = gm();
        let t0 = Instant::now();
        g.observe(["D:\\Games\\Skyrim\\SkyrimSE.exe"], t0);
        g.set_lists(&["E:/Other".into()], &[]);
        assert!(g.is_active(), "saving a profile does not end a game in progress");
        assert!(!g.observe([], t0 + LEAVE_AFTER), "it ends after the usual absence");
        assert!(g.observe(["e:\\other\\game.exe"], t0 + LEAVE_AFTER), "the new folder counts");
        assert!(g.has_targets());
        g.set_lists(&[" ".into()], &[]);
        assert!(!g.has_targets(), "nothing to look for: the sampler can skip listing processes");
    }

    #[test]
    fn a_full_screen_direct3d_program_counts_as_a_game() {
        let mut g = GameMode::new(&[], &[]);
        let t0 = Instant::now();
        assert!(g.observe_with(["C:\\x\\notlisted.exe"], true, t0));
        assert!(g.observe_with([], false, t0 + Duration::from_secs(29)));
        assert!(!g.observe_with([], false, t0 + LEAVE_AFTER));
    }

    #[test]
    fn a_whole_drive_is_never_a_game_folder() {
        let mut g = GameMode::new(&["C:\\".into(), "d:".into(), "/".into(), "\\\\nas\\games".into(), "E:\\Games\\X".into()], &[]);
        assert!(!g.observe(["C:\\Windows\\explorer.exe", "D:\\tool.exe", "\\\\nas\\games\\a.exe"], Instant::now()), "a drive root would make every program a game");
        assert!(g.observe(["E:\\Games\\X\\x.exe"], Instant::now()), "a real folder still counts");
    }

    #[test]
    fn empty_game_folders_match_nothing() {
        let mut g = GameMode::new(&["".into(), "  ".into()], &[]);
        assert!(!g.observe(["C:\\anything.exe"], Instant::now()), "an unset game folder must not make every process a game");
    }
}
