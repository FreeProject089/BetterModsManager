//! Noticing that a game did something, from outside the game.
//!
//! BMM cannot see you join a server. Nothing about a running game is visible to another
//! process except what that game WRITES — so this module is three small facts and one Lua
//! file, and everything above it is built out of those:
//!
//!  - `file_stamp` — has this file changed? The whole of "watch a file" trigger.
//!  - `read_text_tail` — the last few KB of a log, which is where a game says what it just
//!    did. Deliberately not gated by the extension allowlist `read_file_text` uses: a game
//!    log is `.log`, `.txt`, `.dcs`, or has no extension at all, and an allowlist there
//!    would refuse exactly the files this exists to read.
//!  - the DCS hook — the one game where a *supported* API can tell us directly, so it does,
//!    rather than being reverse-engineered out of a log line that changes every patch.
//!
//! The universal path and the DCS path end in the same place: a file whose contents name a
//! server. What is above them does not know which produced it.

use serde::Serialize;

/// A cheap fingerprint of a file: modified time and length.
///
/// Not a hash. A game log is appended to hundreds of times a minute and can be hundreds of
/// megabytes; hashing one on a five-second poll would spend more of the machine on watching
/// than on the game. mtime+len misses a change that keeps the length and the timestamp
/// identical, which for an appending log is not a thing that happens.
///
/// An empty string means "no file". A watcher must be able to tell "not there" from "there
/// and unchanged" without a second call — the first is the normal state before a game has
/// ever run, and firing on it would run the task at every startup.
#[tauri::command]
pub fn file_stamp(path: String) -> String {
    let Ok(md) = std::fs::metadata(&path) else { return String::new() };
    let secs = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}:{}", secs, md.len())
}

/// The last `kb` kilobytes of a text file, as lossy UTF-8.
///
/// Seeks rather than reads: the point is to look at the end of a log that may be enormous,
/// and reading it whole to throw away the front is how a five-second poll becomes a stutter.
///
/// Lossy on purpose. A game log is written by something that does not care about encodings
/// and one bad byte in a 200 KB tail must not turn "which server did I join" into an error.
#[tauri::command]
pub fn read_text_tail(path: String, kb: Option<u64>) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let want = kb.unwrap_or(64).clamp(1, 4096) * 1024;
    let mut f = std::fs::File::open(&path).map_err(|e| format!("game.errRead|{}", e))?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len > want {
        f.seek(SeekFrom::Start(len - want)).map_err(|e| e.to_string())?;
    }
    let mut buf = Vec::with_capacity(want as usize);
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

/// Every DCS Saved Games folder on this machine.
///
/// Plural because there are usually two — `DCS` (release) and `DCS.openbeta` — and people
/// fly in whichever they last updated. Installing the hook into one and being told it
/// worked, while flying in the other, is a failure with no symptom at all: the file is
/// simply never written and the automation never fires.
#[tauri::command]
pub fn dcs_saved_games() -> Vec<String> {
    let Some(home) = dirs_home() else { return Vec::new() };
    let saved = home.join("Saved Games");
    let Ok(rd) = std::fs::read_dir(&saved) else { return Vec::new() };
    let mut out: Vec<String> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.eq_ignore_ascii_case("DCS") || n.to_ascii_lowercase().starts_with("dcs."))
                    .unwrap_or(false)
        })
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    out.sort();
    out
}

fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
}

/// The file the hook writes, and every watcher reads.
pub const STATE_FILE: &str = "bmm-server.json";
const HOOK_FILE: &str = "bmm-serverwatch.lua";

/// The hook itself.
///
/// Every call into the DCS API is wrapped in `pcall`. A GUI hook that throws is not a
/// harmless failure — DCS drops the whole callback table, so a hook that raises once stops
/// reporting for the rest of the session, silently. `net.get_server_name` in particular is
/// not present in every build, which is exactly the kind of thing that would do it.
///
/// It writes JSON by hand rather than through a serialiser, because a GUI hook has no
/// modules loaded that it did not load itself, and pulling one in is a second thing that
/// can fail on somebody else's install.
const HOOK_LUA: &str = r#"-- Written by Better Mods Manager. Safe to delete.
--
-- It reports, to a file BMM watches, which multiplayer server this DCS client is on. It
-- reads nothing, sends nothing and changes no game state; the only thing it writes is the
-- file below.
--
-- Every DCS call is inside pcall on purpose: a GUI hook that raises is dropped by DCS for
-- the whole session, so one missing function in one build would silently stop the reporting
-- rather than logging an error anybody would see.
local bmm = {}

local out = lfs.writedir() .. "bmm-server.json"

local function esc(s)
    s = tostring(s or "")
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"')
    s = s:gsub("[\n\r\t]", " ")
    return s
end

local function try(f)
    local ok, v = pcall(f)
    if ok then return v end
    return nil
end

local function report(event)
    local server = try(function() return net.get_server_name() end)
    if server == nil then
        -- Older builds have no get_server_name. The mission is what is left, and it is
        -- still enough to tell one server's setup from another's.
        server = ""
    end
    local mission = try(function() return DCS.getMissionName() end) or ""
    local mp = try(function() return DCS.isMultiplayer() end)
    local body = string.format(
        '{"event":"%s","server":"%s","mission":"%s","multiplayer":%s,"at":%d}',
        esc(event), esc(server), esc(mission),
        (mp == true) and "true" or "false",
        os.time()
    )
    local fh = io.open(out, "w")
    if fh then
        fh:write(body)
        fh:close()
    end
end

function bmm.onSimulationStart()
    report("start")
end

function bmm.onSimulationStop()
    report("stop")
end

DCS.setUserCallbacks(bmm)
"#;

#[derive(Serialize)]
pub struct HookResult {
    /// Where the hook was written, one per DCS folder.
    pub installed: Vec<String>,
    /// The file the hook writes, which is what a watch trigger should point at.
    pub watch: Vec<String>,
}

/// Put the hook in every DCS folder found, or in the one given.
///
/// Overwrites without asking. The file is ours, named after us, and the alternative — an
/// older copy of our own hook left in place because a file already existed — is a bug
/// nobody can see: it keeps reporting, in the old format, and the automation quietly stops
/// matching.
#[tauri::command]
pub fn dcs_install_hook(dir: Option<String>) -> Result<HookResult, String> {
    let dirs: Vec<String> = match dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => vec![d],
        None => dcs_saved_games(),
    };
    if dirs.is_empty() {
        return Err("game.errNoDcs".to_string());
    }
    let mut installed = Vec::new();
    let mut watch = Vec::new();
    for d in dirs {
        let root = std::path::PathBuf::from(&d);
        let hooks = root.join("Scripts").join("Hooks");
        std::fs::create_dir_all(&hooks).map_err(|e| format!("game.errWrite|{}", e))?;
        let path = hooks.join(HOOK_FILE);
        std::fs::write(&path, HOOK_LUA).map_err(|e| format!("game.errWrite|{}", e))?;
        installed.push(path.to_string_lossy().to_string());
        watch.push(root.join(STATE_FILE).to_string_lossy().to_string());
    }
    Ok(HookResult { installed, watch })
}

/// Take it out again. Reports how many were actually removed, not how many were tried.
#[tauri::command]
pub fn dcs_remove_hook(dir: Option<String>) -> usize {
    let dirs: Vec<String> = match dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => vec![d],
        None => dcs_saved_games(),
    };
    dirs.iter()
        .filter(|d| {
            std::fs::remove_file(
                std::path::PathBuf::from(d).join("Scripts").join("Hooks").join(HOOK_FILE),
            )
            .is_ok()
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_stamps_as_nothing() {
        // "Not there" and "there and unchanged" must be different, or the first watch poll
        // after every app start looks like a change and runs the task.
        assert_eq!(file_stamp("Z:/definitely/not/here.log".into()), "");
    }

    #[test]
    fn a_stamp_changes_when_the_file_grows() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.log");
        std::fs::write(&p, b"one").unwrap();
        let first = file_stamp(p.to_string_lossy().to_string());
        assert!(!first.is_empty());
        std::fs::write(&p, b"one two three").unwrap();
        assert_ne!(first, file_stamp(p.to_string_lossy().to_string()));
    }

    #[test]
    fn the_tail_is_the_end_of_the_file_not_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.log");
        let mut body = "x".repeat(3000);
        body.push_str("THE LAST LINE");
        std::fs::write(&p, &body).unwrap();
        let tail = read_text_tail(p.to_string_lossy().to_string(), Some(1)).unwrap();
        assert!(tail.ends_with("THE LAST LINE"));
        assert!(tail.len() <= 1024);
    }

    #[test]
    fn a_file_smaller_than_the_window_comes_back_whole() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("small.log");
        std::fs::write(&p, b"all of it").unwrap();
        assert_eq!(read_text_tail(p.to_string_lossy().to_string(), Some(64)).unwrap(), "all of it");
    }

    #[test]
    fn a_bad_byte_does_not_turn_a_log_into_an_error() {
        // Game logs are written by things that do not care about encodings, and one bad
        // byte must not cost the whole read.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("weird.log");
        std::fs::write(&p, b"before \xff\xfe after").unwrap();
        let out = read_text_tail(p.to_string_lossy().to_string(), None).unwrap();
        assert!(out.contains("before") && out.contains("after"));
    }

    #[test]
    fn the_hook_lands_where_dcs_looks_for_it() {
        let dir = tempfile::tempdir().unwrap();
        let r = dcs_install_hook(Some(dir.path().to_string_lossy().to_string())).unwrap();
        let written = dir.path().join("Scripts").join("Hooks").join(HOOK_FILE);
        assert!(written.exists(), "DCS only loads GUI hooks from Scripts/Hooks");
        assert_eq!(r.installed, vec![written.to_string_lossy().to_string()]);
        // What it tells the caller to watch must be the file the hook actually writes.
        assert_eq!(r.watch, vec![dir.path().join(STATE_FILE).to_string_lossy().to_string()]);

        assert_eq!(dcs_remove_hook(Some(dir.path().to_string_lossy().to_string())), 1);
        assert!(!written.exists());
        // Removing one that is not there is 0, not an error: "make sure it is gone" is a
        // reasonable thing to ask twice.
        assert_eq!(dcs_remove_hook(Some(dir.path().to_string_lossy().to_string())), 0);
    }

    #[test]
    fn the_hook_writes_where_the_watcher_reads() {
        // The one place these two could drift. The Lua builds its path from
        // lfs.writedir(), which IS the Saved Games/DCS folder, plus this name.
        assert!(HOOK_LUA.contains(STATE_FILE), "the hook must write {}", STATE_FILE);
        assert!(HOOK_LUA.contains("DCS.setUserCallbacks"), "a GUI hook registers this way");
        assert!(HOOK_LUA.contains("pcall"), "an unguarded call is dropped for the session");
    }
}
