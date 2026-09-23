//! "A game is running" (PLAN-BMM-RESOURCES-2026.md §2.3, phase G4), as a pure state machine.
//!
//! The sampler (a later phase) lists the running executables every few seconds and feeds them
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

impl GameMode {
    pub fn new(game_dirs: &[String], extra: &[String]) -> GameMode {
        GameMode {
            game_dirs: game_dirs.iter().filter(|d| !d.trim().is_empty()).map(|d| norm_dir(d)).collect(),
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

    /// Feed one sample of running executables. Returns whether game mode is active afterwards.
    pub fn observe<'a>(&mut self, running: impl IntoIterator<Item = &'a str>, now: Instant) -> bool {
        let seen = running.into_iter().any(|p| self.is_game(p));
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
    fn empty_game_folders_match_nothing() {
        let mut g = GameMode::new(&["".into(), "  ".into()], &[]);
        assert!(!g.observe(["C:\\anything.exe"], Instant::now()), "an unset game folder must not make every process a game");
    }
}
