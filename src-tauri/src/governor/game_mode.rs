//! "A game is running" (PLAN-BMM-RESOURCES-2026.md §2.3, phase G4), as a pure state machine.
//!
//! The sampler (`procs.rs`) lists the running executables every 5 seconds and feeds them
//! here; this file decides, from that list and the user's choices, whether BMM is in game mode
//! and which preset applies. Pure so every rule is a test, with the process list injected.
//!
//! The rules:
//!   · a game is an executable under a profile's game folder (unless the user ignores that
//!     folder), or in the user's own list, compared case-insensitively (Windows paths);
//!     Windows saying a full-screen Direct3D program runs counts too, and, only when the user
//!     asks for it, any window covering a whole screen in the foreground (a borderless game,
//!     but also a full-screen video, hence off by default);
//!   · entering is immediate; leaving waits for the user's cooldown (30 s by default) of
//!     absence, so a launcher that restarts the game or a loading screen that swaps processes
//!     does not flip BMM back and forth;
//!   · the user's manual choice (on / off) beats detection;
//!   · game mode beats a preset a scheduled task asked for, unless that task was allowed to
//!     ignore it (off by default and removed on import);
//!   · in game mode, the kinds the user ticked are held (hashing and maintenance by default),
//!     and everything else is slowed; deploy, install and backup are never held: a half-modded
//!     game folder is worse than a slow one.
//!
//! It also remembers WHY: the executable that triggered game mode, from which source, and
//! since when, for the Storage Manager and the engage / disengage notice.

use super::config::{norm_game_dir, OpKind, Preset};
use serde::Serialize;
use std::time::{Duration, Instant};

/// The default cooldown (the user's is in `GameOptions::leave_after_secs`).
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

/// Where a detection came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Under one of the profiles' game folders.
    ProfileFolder,
    /// In the user's own list.
    Listed,
    /// Windows: a full-screen Direct3D program owns the screen.
    ExclusiveFullscreen,
    /// A window covering a whole screen in the foreground (the user's opt-in).
    FullscreenWindow,
    /// The user forced game mode on.
    Forced,
}

/// The game that turned game mode on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Trigger {
    /// Full path when known ("" for the exclusive-full-screen signal, which names nobody).
    pub exe: String,
    /// The file name, for display.
    pub name: String,
    pub source: Source,
    /// The profile folder it ran from (ProfileFolder only), normalised.
    pub dir: Option<String>,
}

/// The second-opinion signals, beside the process list.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Signals<'a> {
    pub exclusive_fullscreen: bool,
    /// The executable of a foreground window covering a whole screen, if any.
    pub fullscreen_window: Option<&'a str>,
}

/// Game mode as the Storage Manager shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GameView {
    pub active: bool,
    pub manual: Manual,
    pub trigger: Option<Trigger>,
    /// Milliseconds since game mode turned on (None when off).
    pub since_ms: Option<u64>,
    /// The game is gone and game mode ends in this many milliseconds (the cooldown).
    pub leaving_in_ms: Option<u64>,
    /// The profile folders watched right now (ignored ones and whole drives left out).
    pub watched_dirs: Vec<String>,
    /// The kinds held while it is on (op keys).
    pub paused_kinds: Vec<String>,
    pub leave_after_secs: u64,
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
    since: Option<Instant>,
    trigger: Option<Trigger>,
    pause: Vec<OpKind>,
    leave_after: Duration,
    ignored: Vec<String>,
    fullscreen_window: bool,
}

/// `c:\`, `\`, `\\server\share\`: a normalised folder that is a whole volume.
fn is_drive_root(d: &str) -> bool {
    let b = d.as_bytes();
    d == "\\" || (b.len() == 3 && b[0].is_ascii_alphabetic() && b[1] == b':')
        || d.strip_prefix("\\\\").map(|r| r.trim_end_matches('\\').split('\\').count() <= 2).unwrap_or(false)
}

fn file_name(p: &str) -> String {
    p.rsplit(['\\', '/']).next().unwrap_or(p).to_string()
}

/// Never held, whatever the options say.
fn never_held(k: OpKind) -> bool { matches!(k, OpKind::Deploy | OpKind::Install | OpKind::Backup) }

impl GameMode {
    pub fn new(game_dirs: &[String], extra: &[String]) -> GameMode {
        let mut g = GameMode {
            game_dirs: Vec::new(),
            extra: Vec::new(),
            manual: Manual::Auto,
            game_preset: Preset::Silent,
            last_seen: None,
            active: false,
            since: None,
            trigger: None,
            pause: vec![OpKind::Hash, OpKind::Maintenance],
            leave_after: LEAVE_AFTER,
            ignored: Vec::new(),
            fullscreen_window: false,
        };
        g.set_lists(game_dirs, extra);
        g
    }

    /// The user's options: what is held, the cooldown, the ignored profile folders, and
    /// whether a full-screen foreground window counts. Deploy, install and backup are dropped
    /// from `pause` whatever it says.
    pub fn set_options(&mut self, pause: &[OpKind], leave_after: Duration, ignored: &[String], fullscreen_window: bool) {
        self.pause = pause.iter().copied().filter(|k| !never_held(*k)).collect();
        self.leave_after = leave_after;
        self.ignored = ignored.iter().map(|d| norm_game_dir(d)).collect();
        self.fullscreen_window = fullscreen_window;
        let dirs = std::mem::take(&mut self.game_dirs);
        self.game_dirs = dirs.into_iter().filter(|d| !self.ignored.contains(d)).collect();
    }

    /// Is this executable path a game? (The source says which list matched.)
    fn match_game(&self, exe: &str) -> Option<Trigger> {
        let e = exe.replace('/', "\\").to_lowercase();
        let name = e.rsplit('\\').next().unwrap_or(&e);
        if let Some(d) = self.game_dirs.iter().find(|d| e.starts_with(d.as_str())) {
            return Some(Trigger { exe: exe.to_string(), name: file_name(exe), source: Source::ProfileFolder, dir: Some(d.clone()) });
        }
        if self.extra.iter().any(|x| x == &e || x == name) {
            return Some(Trigger { exe: exe.to_string(), name: file_name(exe), source: Source::Listed, dir: None });
        }
        None
    }

    pub fn is_game(&self, exe: &str) -> bool { self.match_game(exe).is_some() }

    /// Replace the game folders and the manual list (profiles saved, the list edited) without
    /// touching the detection state: a game already seen stays seen until it is absent for
    /// the cooldown under the new lists too.
    pub fn set_lists(&mut self, game_dirs: &[String], extra: &[String]) {
        // A blank folder, or one that is a whole drive (`C:\`, `\`), would make every program
        // on it "a game" and keep BMM in game mode for good: such a folder counts for nothing.
        let mut dirs: Vec<String> = Vec::new();
        for d in game_dirs.iter().filter(|d| !d.trim().is_empty()).map(|d| norm_game_dir(d)) {
            if !is_drive_root(&d) && !self.ignored.contains(&d) && !dirs.contains(&d) { dirs.push(d); }
        }
        self.game_dirs = dirs;
        self.set_extra(extra);
    }

    /// Replace the manual list only (the profiles could not be read this time).
    pub fn set_extra(&mut self, extra: &[String]) {
        self.extra = extra.iter().map(|e| e.trim().replace('/', "\\").to_lowercase()).filter(|e| !e.is_empty()).collect();
    }

    /// Is there anything to look for? With no game folder and no listed executable, the
    /// sampler need not list processes at all.
    pub fn has_targets(&self) -> bool { !self.game_dirs.is_empty() || !self.extra.is_empty() }

    /// Feed one sample of running executables. Returns whether game mode is active afterwards.
    pub fn observe<'a>(&mut self, running: impl IntoIterator<Item = &'a str>, now: Instant) -> bool {
        self.observe_with(running, false, now)
    }

    /// `observe` with Windows' exclusive-full-screen signal (`QUNS_RUNNING_D3D_FULL_SCREEN`).
    pub fn observe_with<'a>(&mut self, running: impl IntoIterator<Item = &'a str>, fullscreen: bool, now: Instant) -> bool {
        let list: Vec<&str> = running.into_iter().collect();
        self.observe_signals(&list, Signals { exclusive_fullscreen: fullscreen, fullscreen_window: None }, now)
    }

    /// One sample: the running executables and the screen signals. Returns whether game mode is
    /// active afterwards. The first match names the trigger; a game that keeps running keeps
    /// the trigger it had (a second game starting does not rename it).
    pub fn observe_signals(&mut self, running: &[&str], sig: Signals<'_>, now: Instant) -> bool {
        let still = self.trigger.as_ref().filter(|t| !t.exe.is_empty())
            .filter(|t| running.iter().any(|p| p.eq_ignore_ascii_case(&t.exe)) && self.is_game(&t.exe))
            .cloned();
        let found = still
            .or_else(|| running.iter().find_map(|p| self.match_game(p)))
            .or_else(|| sig.exclusive_fullscreen.then(|| Trigger { exe: String::new(), name: String::new(), source: Source::ExclusiveFullscreen, dir: None }))
            .or_else(|| sig.fullscreen_window.filter(|_| self.fullscreen_window).map(|e| Trigger { exe: e.to_string(), name: file_name(e), source: Source::FullscreenWindow, dir: None }));
        if let Some(t) = found {
            self.last_seen = Some(now);
            if !self.active { self.since = Some(now); }
            self.active = true;
            self.trigger = Some(t);
        } else if self.active && self.last_seen.map(|t| now.duration_since(t) >= self.leave_after).unwrap_or(true) {
            self.active = false;
            self.since = None;
            self.trigger = None;
        }
        self.is_active()
    }

    pub fn is_active(&self) -> bool {
        match self.manual { Manual::On => true, Manual::Off => false, Manual::Auto => self.active }
    }

    /// The Storage Manager's view, at `now`.
    pub fn view(&self, now: Instant) -> GameView {
        let active = self.is_active();
        let trigger = match self.manual {
            Manual::On => Some(Trigger { exe: String::new(), name: String::new(), source: Source::Forced, dir: None }),
            Manual::Off => None,
            Manual::Auto => self.trigger.clone(),
        };
        let absent = self.last_seen.map(|t| now.saturating_duration_since(t)).unwrap_or_default();
        let leaving_in_ms = (self.manual == Manual::Auto && self.active && absent > Duration::ZERO)
            .then(|| self.leave_after.saturating_sub(absent).as_millis() as u64);
        GameView {
            active,
            manual: self.manual,
            trigger,
            since_ms: if self.manual == Manual::Auto { self.since.map(|s| now.saturating_duration_since(s).as_millis() as u64) } else { None },
            leaving_in_ms,
            watched_dirs: self.game_dirs.clone(),
            paused_kinds: self.pause.iter().map(|k| k.key().to_string()).collect(),
            leave_after_secs: self.leave_after.as_secs(),
        }
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
        if !never_held(kind) && self.pause.contains(&kind) { Treatment::Paused } else { Treatment::Throttled }
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

    // ── Game mode, second pass (agent-bmm-storage) ────────────────────────────────────────

    #[test]
    fn the_trigger_says_which_game_and_why() {
        let mut g = gm();
        let t0 = Instant::now();
        g.observe_signals(&["C:\\x\\a.exe", "D:\\Games\\Skyrim\\SkyrimSE.exe"], Signals::default(), t0);
        let v = g.view(t0 + Duration::from_secs(7));
        let tr = v.trigger.expect("a running game names itself");
        assert_eq!(tr.name, "SkyrimSE.exe");
        assert_eq!(tr.source, Source::ProfileFolder);
        assert_eq!(tr.dir.as_deref(), Some("d:\\games\\skyrim\\"));
        assert_eq!(v.since_ms, Some(7000));
        let mut g2 = gm();
        g2.observe_signals(&["E:\\x\\EldenRing.exe"], Signals::default(), t0);
        assert_eq!(g2.view(t0).trigger.unwrap().source, Source::Listed);
        let mut g3 = GameMode::new(&[], &[]);
        g3.observe_signals(&[], Signals { exclusive_fullscreen: true, fullscreen_window: None }, t0);
        assert_eq!(g3.view(t0).trigger.unwrap().source, Source::ExclusiveFullscreen);
        g3.manual = Manual::On;
        assert_eq!(g3.view(t0).trigger.unwrap().source, Source::Forced, "forced on says so");
    }

    #[test]
    fn a_full_screen_window_counts_only_when_asked_for() {
        let mut g = GameMode::new(&[], &[]);
        let t0 = Instant::now();
        let sig = Signals { exclusive_fullscreen: false, fullscreen_window: Some("C:\\Games\\Indie\\game.exe") };
        assert!(!g.observe_signals(&[], sig, t0), "off by default: a full-screen video is not a game");
        g.set_options(&[OpKind::Hash, OpKind::Maintenance], LEAVE_AFTER, &[], true);
        assert!(g.observe_signals(&[], sig, t0));
        assert_eq!(g.view(t0).trigger.unwrap().source, Source::FullscreenWindow);
    }

    #[test]
    fn the_cooldown_is_the_users_and_the_grace_is_shown() {
        let mut g = gm();
        g.set_options(&[OpKind::Hash], Duration::from_secs(10), &[], false);
        let t0 = Instant::now();
        g.observe_signals(&["D:\\Games\\Skyrim\\SkyrimSE.exe"], Signals::default(), t0);
        assert!(g.observe_signals(&[], Signals::default(), t0 + Duration::from_secs(4)));
        let v = g.view(t0 + Duration::from_secs(4));
        assert_eq!(v.leaving_in_ms, Some(6000), "closed 4 s ago with a 10 s cooldown: 6 s left");
        assert!(!g.observe_signals(&[], Signals::default(), t0 + Duration::from_secs(10)));
        assert_eq!(g.view(t0 + Duration::from_secs(10)).trigger, None);
    }

    #[test]
    fn what_is_paused_is_the_users_choice_but_never_a_deploy() {
        let mut g = gm();
        g.set_options(&[OpKind::Download, OpKind::Scan, OpKind::Deploy, OpKind::Install, OpKind::Backup], LEAVE_AFTER, &[], false);
        g.manual = Manual::On;
        assert_eq!(g.treatment(OpKind::Download), Treatment::Paused);
        assert_eq!(g.treatment(OpKind::Scan), Treatment::Paused);
        assert_eq!(g.treatment(OpKind::Hash), Treatment::Throttled, "unticked: slowed, not held");
        for k in [OpKind::Deploy, OpKind::Install, OpKind::Backup] {
            assert_eq!(g.treatment(k), Treatment::Throttled, "{k:?}: a half-modded game folder is worse than a slow one");
        }
    }

    #[test]
    fn an_ignored_profile_folder_is_not_watched() {
        let mut g = GameMode::new(&["D:/Games/Skyrim".into(), "E:/Tools".into()], &[]);
        g.set_options(&[OpKind::Hash], LEAVE_AFTER, &["e:\\tools".into()], false);
        g.set_lists(&["D:/Games/Skyrim".into(), "E:/Tools".into()], &[]);
        assert!(!g.observe_signals(&["E:\\Tools\\xedit.exe"], Signals::default(), Instant::now()));
        assert!(g.observe_signals(&["D:\\Games\\Skyrim\\SkyrimSE.exe"], Signals::default(), Instant::now()));
        assert_eq!(g.view(Instant::now()).watched_dirs, vec!["d:\\games\\skyrim\\".to_string()]);
    }

}
