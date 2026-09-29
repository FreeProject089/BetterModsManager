//! The one process sampler (PLAN-BMM-RESOURCES-2026.md §2.3): what feeds game mode's
//! detection. Before it, `GameMode::observe` was called by tests only and "Detect it" never
//! turned game mode on by itself.
//!
//! Every POLL (5 s), on a thread of its own:
//!   1. the game folders are re-read from the profiles (`game_dirs`, a closure main.rs gives it,
//!      reading AppState without waiting for a busy lock) and the manual list from the
//!      governor's document, so a profile saved or a list edited counts at the next poll;
//!   2. if detection is on (`auto`) and there is something to look for, the running
//!      executables are listed: ONE `sysinfo::System`, reused, refreshing processes only and
//!      each executable path only the first time a process is seen;
//!   3. the second signal is asked: Windows says a full-screen Direct3D program runs;
//!   4. `Governor::observe_games` decides (enter at once, leave after 30 s) and, on a change,
//!      re-derives the preset in force, the slots, the pools and the background pauses.
//!
//! With detection forced on or off nothing is listed at all. The thread is started by main.rs
//! only: tests exercise `sample_once` with a governor of their own and never start the loop.
//!
//! Second pass (agent-bmm-storage): a third, opt-in signal (a foreground window covering a
//! whole screen: borderless games, but videos too), and a report on every change, which
//! main.rs turns into the `bmm://game-mode` event (the engage / disengage notice). The cost of
//! one poll is measured by `game_detector_cost` (ignored; run it with --ignored --nocapture).
use super::game_mode::{GameView, Signals};
use super::runtime::Governor;
use std::time::{Duration, Instant};

pub const POLL: Duration = Duration::from_secs(5);

/// Lists running executables. One per sampler thread; cheap to call again.
pub struct ProcList {
    sys: sysinfo::System,
}

impl Default for ProcList {
    fn default() -> Self { ProcList::new() }
}

impl ProcList {
    pub fn new() -> ProcList { ProcList { sys: sysinfo::System::new() } }

    /// Full executable paths of the running processes (those whose path can be read: another
    /// user's elevated process may not say, and is not a game this user launched anyway).
    pub fn executables(&mut self) -> Vec<String> {
        use sysinfo::{ProcessRefreshKind, UpdateKind};
        self.sys.refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));
        self.sys.processes().values().filter_map(|p| p.exe().map(|e| e.to_string_lossy().into_owned())).collect()
    }
}

/// The running executables minus BMM itself (and its `--mod-worker` children, the same
/// executable): a BMM kept inside a game folder, which modders do, must not be "a game running"
/// for as long as it is open.
pub fn without_self(mut running: Vec<String>, me: Option<&str>) -> Vec<String> {
    if let Some(me) = me {
        let me = me.replace('/', "\\").to_lowercase();
        running.retain(|e| e.replace('/', "\\").to_lowercase() != me);
    }
    running
}

/// One poll. `list` is only asked when there is something to look for; `fullscreen` only
/// when detection is on. Returns whether game mode changed.
pub fn sample_once(
    gov: &Governor,
    game_dirs: Option<Vec<String>>,
    list: &mut dyn FnMut() -> Vec<String>,
    fullscreen: &dyn Fn() -> bool,
    now: Instant,
) -> bool {
    let (auto, worth_listing) = gov.set_game_lists(game_dirs.as_deref());
    if !auto { return false; }
    let running = if worth_listing { list() } else { Vec::new() };
    gov.observe_games(&running, fullscreen(), now)
}

/// `sample_once` with every signal and a report: `window` (the foreground full-screen
/// window's executable) is only asked when the user turned that signal on, and `report` is
/// called once per change of game mode, with the new view (which game, since when).
pub fn sample_and_report(
    gov: &Governor,
    game_dirs: Option<Vec<String>>,
    list: &mut dyn FnMut() -> Vec<String>,
    exclusive: &dyn Fn() -> bool,
    window: &dyn Fn() -> Option<String>,
    now: Instant,
    report: &dyn Fn(&GameView),
) -> bool {
    let (auto, worth_listing) = gov.set_game_lists(game_dirs.as_deref());
    if !auto { return false; }
    let running = if worth_listing { list() } else { Vec::new() };
    let win = if gov.config().game.fullscreen_window { window() } else { None };
    let changed = gov.observe_game_signals(&running, Signals { exclusive_fullscreen: exclusive(), fullscreen_window: win.as_deref() }, now);
    if changed { report(&gov.game_view()); }
    changed
}

/// A foreground full-screen window, unless it is BMM itself or the desktop's shell.
fn foreground_game_window(me: Option<&str>) -> Option<String> {
    let exe = super::win::foreground_fullscreen_exe()?;
    let low = exe.replace('/', "\\").to_lowercase();
    if me.map(|m| m.replace('/', "\\").to_lowercase() == low).unwrap_or(false) { return None; }
    if low.ends_with("\\explorer.exe") { return None; }
    Some(exe)
}

/// Start the 5 s loop (main.rs, once). `game_dirs` returns every profile's game folder, or
/// None when the state is busy right now (the previous folders are kept for this poll).
/// `on_change` is called on the sampler's thread each time game mode turns on or off by itself.
pub fn start<F, R>(game_dirs: F, on_change: R)
where
    F: Fn() -> Option<Vec<String>> + Send + 'static,
    R: Fn(&GameView) + Send + 'static,
{
    let _ = std::thread::Builder::new().name("bmm-game-detect".into()).spawn(move || {
        let gov = super::runtime::global();
        let mut procs = ProcList::new();
        let me = std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned());
        loop {
            sample_and_report(gov, game_dirs(), &mut || without_self(procs.executables(), me.as_deref()), &super::win::d3d_full_screen,
                &|| foreground_game_window(me.as_deref()), Instant::now(), &on_change);
            std::thread::sleep(POLL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::config::{OpKind, Preset, ResourcesConfig};
    use crate::governor::game_mode::{Manual, LEAVE_AFTER};

    fn gov_with(exes: &[&str]) -> Governor {
        let mut cfg = ResourcesConfig::default();
        cfg.set_game_exes(&exes.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap();
        Governor::for_tests(cfg)
    }

    #[test]
    fn a_game_under_a_profile_folder_turns_game_mode_on_and_its_absence_off() {
        let g = gov_with(&[]);
        let t0 = Instant::now();
        let dirs = || Some(vec!["D:\\Games\\Skyrim".to_string()]);
        let mut running = vec!["C:\\Windows\\explorer.exe".to_string()];
        assert!(!sample_once(&g, dirs(), &mut || running.clone(), &|| false, t0));
        assert_eq!(g.effective_preset(), Preset::Balanced);
        running.push("D:\\Games\\Skyrim\\SkyrimSE.exe".into());
        assert!(sample_once(&g, dirs(), &mut || running.clone(), &|| false, t0), "entering is a change");
        assert_eq!(g.effective_preset(), Preset::Silent, "the preset in force follows at once");
        let hash = g.begin(OpKind::Hash, "bg");
        assert!(hash.must_yield(), "background work is held while the game runs");
        running.pop();
        assert!(!sample_once(&g, dirs(), &mut || running.clone(), &|| false, t0 + POLL), "30 s of grace");
        assert!(sample_once(&g, dirs(), &mut || running.clone(), &|| false, t0 + LEAVE_AFTER));
        assert_eq!(g.effective_preset(), Preset::Balanced);
        assert!(!hash.must_yield(), "and released when it ends");
    }

    #[test]
    fn the_manual_list_counts_and_a_busy_state_keeps_the_folders() {
        let g = gov_with(&["eldenring.exe"]);
        let t0 = Instant::now();
        let mut running = || vec!["E:\\Steam\\ELDEN RING\\Game\\EldenRing.exe".to_string()];
        assert!(sample_once(&g, None, &mut running, &|| false, t0));
        assert!(g.game_mode().0);
    }

    #[test]
    fn nothing_is_listed_when_there_is_nothing_to_look_for_or_detection_is_forced() {
        let g = gov_with(&[]);
        let mut asked = 0;
        sample_once(&g, Some(vec![]), &mut || { asked += 1; vec![] }, &|| false, Instant::now());
        assert_eq!(asked, 0, "no game folder and no listed executable: no process list");
        g.set_game_manual(Manual::Off);
        let mut asked = 0;
        let fs_asked = std::cell::Cell::new(0);
        sample_once(&g, Some(vec!["D:\\G".into()]), &mut || { asked += 1; vec![] }, &|| { fs_asked.set(fs_asked.get() + 1); true }, Instant::now());
        assert_eq!((asked, fs_asked.get()), (0, 0), "forced off: nothing is sampled");
        assert!(!g.game_mode().0);
    }

    #[test]
    fn bmm_inside_a_game_folder_is_not_a_game() {
        let g = gov_with(&[]);
        let me = "D:/Games/Skyrim/BMM/BetterModsManager.exe";
        let running = || without_self(vec![r"d:\games\skyrim\bmm\bettermodsmanager.exe".to_string()], Some(me));
        assert!(!sample_once(&g, Some(vec![r"D:\Games\Skyrim".into()]), &mut || running(), &|| false, Instant::now()));
        assert!(!g.game_mode().0);
        assert_eq!(without_self(vec!["a.exe".into()], None), vec!["a.exe".to_string()]);
    }

    #[test]
    fn full_screen_direct3d_is_a_game_even_in_no_list() {
        let g = gov_with(&[]);
        assert!(sample_once(&g, Some(vec![]), &mut || vec![], &|| true, Instant::now()));
        assert!(g.game_mode().0);
    }

    #[test]
    fn the_real_process_list_reads_our_own_executable() {
        let mut p = ProcList::new();
        let me = std::env::current_exe().unwrap().to_string_lossy().to_lowercase();
        let list = p.executables();
        assert!(list.iter().any(|e| e.to_lowercase() == me), "the test binary itself is running");
        assert!(!p.executables().is_empty(), "the same System is reused for the next poll");
    }

    // ── Game mode, second pass (agent-bmm-storage) ────────────────────────────────────────

    #[test]
    fn pause_until_the_game_ends_is_lifted_when_it_ends() {
        let g = gov_with(&["game.exe"]);
        let t0 = Instant::now();
        assert!(sample_once(&g, Some(vec![]), &mut || vec!["C:\\g\\game.exe".into()], &|| false, t0));
        assert!(g.pause_until_game_ends().is_ok());
        assert_eq!(g.queue().paused_all().unwrap().by, "game");
        sample_once(&g, Some(vec![]), &mut || vec![], &|| false, t0 + LEAVE_AFTER);
        assert!(!g.game_mode().0);
        assert!(g.queue().paused_all().is_none(), "the game ended: everything resumes by itself");
        assert!(g.pause_until_game_ends().is_err(), "no game running: nothing to wait for");
    }

    #[test]
    fn a_change_is_reported_with_its_trigger() {
        let g = gov_with(&["game.exe"]);
        let t0 = Instant::now();
        let seen = std::cell::RefCell::new(Vec::new());
        let report = |v: &crate::governor::game_mode::GameView| seen.borrow_mut().push((v.active, v.trigger.as_ref().map(|t| t.name.clone())));
        sample_and_report(&g, Some(vec![]), &mut || vec!["C:\\g\\game.exe".into()], &|| false, &|| None, t0, &report);
        sample_and_report(&g, Some(vec![]), &mut || vec!["C:\\g\\game.exe".into()], &|| false, &|| None, t0 + POLL, &report);
        sample_and_report(&g, Some(vec![]), &mut || vec![], &|| false, &|| None, t0 + LEAVE_AFTER + POLL, &report);
        assert_eq!(*seen.borrow(), vec![(true, Some("game.exe".to_string())), (false, None)], "one report per change, none in between");
    }


    /// The cost of one poll on this machine, part by part. Ignored (it measures, it does not
    /// check): `cargo test --bin better-mods-manager game_detector_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn game_detector_cost() {
        let time = |f: &mut dyn FnMut()| { let t = Instant::now(); f(); t.elapsed().as_secs_f64() * 1000.0 };
        let mut p = ProcList::new();
        let mut n = 0;
        let first = time(&mut || n = p.executables().len());
        let mut next = Vec::new();
        for _ in 0..10 { next.push(time(&mut || { p.executables(); })); }
        let d3d: Vec<f64> = (0..10).map(|_| time(&mut || { crate::governor::win::d3d_full_screen(); })).collect();
        let win: Vec<f64> = (0..10).map(|_| time(&mut || { crate::governor::win::foreground_fullscreen_exe(); })).collect();
        let g = gov_with(&["game.exe"]);
        let running = p.executables();
        let decide: Vec<f64> = (0..10).map(|_| time(&mut || { sample_once(&g, Some(vec!["D:/Games/X".into()]), &mut || running.clone(), &|| false, Instant::now()); })).collect();
        let avg = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        println!("processes listed: {n}");
        println!("first process list: {first:.2} ms; next ones: avg {:.2} ms, max {:.2} ms", avg(&next), next.iter().cloned().fold(0.0, f64::max));
        println!("exclusive full-screen query: avg {:.3} ms", avg(&d3d));
        println!("foreground full-screen window: avg {:.3} ms", avg(&win));
        println!("decision over the list: avg {:.3} ms", avg(&decide));
        println!("one poll every {} s: about {:.3} % of one core", POLL.as_secs(), (avg(&next) + avg(&d3d) + avg(&win) + avg(&decide)) / (POLL.as_secs_f64() * 1000.0) * 100.0);
    }

}
