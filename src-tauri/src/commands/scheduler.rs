// Scheduler / automation persistence + custom-command executor.
//
// The automation ENGINE (timing, condition evaluation, action dispatch) lives in
// the frontend (`features/settings/scheduler.ts`) so it can reuse every existing
// `invoke(...)` action and stay maximally flexible (if/else, custom steps). The
// backend's job here is narrow and safe:
//   - persist the task list as opaque JSON (the frontend owns the schema),
//   - run user-defined *custom external commands* behind an explicit opt-in,
//   - share/import a schedule set via a short code.
//
// Custom-command execution is the only sensitive part: it is gated by the same
// "allow unsafe" intent the plugin script-runner uses and never invokes a shell
// (args are passed separately, no `cmd /c "<string>"`), avoiding CWE-78.

use tauri::Manager;
use tauri::AppHandle;
use crate::commands::crash::log_line;

fn schedules_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir().ok()
        .unwrap_or_default()
        .join("schedules.json")
}

/// Returns the raw schedules document (a JSON array of tasks). Empty array if none.
#[tauri::command]
pub fn get_schedules(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let path = schedules_path(&app_handle);
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))
}

/// Overwrites the schedules document. The frontend sends the full task array.
#[tauri::command]
pub fn save_schedules(app_handle: AppHandle, tasks: serde_json::Value) -> Result<(), String> {
    // Basic shape guard: must be an array.
    if !tasks.is_array() {
        return Err("schedules must be a JSON array".to_string());
    }
    let path = schedules_path(&app_handle);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&tasks).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Runs a user-defined external command as part of a scheduled workflow.
///
/// `allow` MUST be true (the UI passes the user's "allow custom commands" opt-in).
/// The program + args are passed separately to the OS — never concatenated into a
/// shell string — so there is no command-injection surface (CWE-78). On Windows we
/// still go through `cmd /c` ONLY to resolve PATH/builtins, with the program and
/// each argument as distinct argv entries.
// `(async)` is not decoration: `cmd.output()` blocks until the child EXITS, and a
// synchronous #[tauri::command] runs on the window's main thread — so a scheduled
// command that takes ten seconds froze the entire UI for ten seconds. Same rule the
// mod-activation freeze taught: anything that waits belongs off the main thread.
#[tauri::command(async)]
pub fn run_scheduled_command(
    program: String,
    args: Vec<String>,
    working_dir: Option<String>,
    allow: bool,
) -> Result<String, String> {
    if !allow {
        return Err("Custom command execution is disabled (enable it in the scheduler).".to_string());
    }
    let program = program.trim();
    if program.is_empty() {
        return Err("Empty command".to_string());
    }

    log_line(format!("[SCHED] Running custom command: {} {:?}", program, args));

    let mut cmd = crate::commands::proc::hidden_command(program);
    cmd.args(&args);
    if let Some(dir) = working_dir.as_ref().filter(|d| !d.trim().is_empty()) {
        cmd.current_dir(dir);
    }

    let output = cmd.output().map_err(|e| format!("Spawn failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!(
            "Command exited with {}: {}",
            output.status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into()),
            if stderr.is_empty() { stdout } else { stderr }
        ))
    }
}

/// Runs a user-authored SCRIPT as part of a scheduled workflow.
///
/// `run_scheduled_command` can only launch a program with arguments, which is the
/// wrong shape for "do these five things in order" — expressing that as argv means
/// five steps, or one long string in a shell, which is the injection surface this
/// module exists to avoid. A script is the honest form: the user writes code, it
/// goes to a file, the interpreter is handed the FILE.
///
/// That is also what keeps it safe. The script body is never concatenated into a
/// command line and never reaches a shell as text, so there is nothing to escape
/// and no quoting rule for the user to get wrong (CWE-78). The interpreter is
/// chosen from a fixed list — never from user input — so `engine` cannot name an
/// arbitrary executable.
///
/// `allow` MUST be true; it carries the task's explicit "run scripts" permission.
#[tauri::command(async)]
pub fn run_scheduled_script(
    engine: String,
    code: String,
    working_dir: Option<String>,
    allow: bool,
) -> Result<String, String> {
    if !allow {
        return Err("Script execution is not permitted for this task (grant it in the task's permissions).".to_string());
    }
    if code.trim().is_empty() {
        return Err("Empty script".to_string());
    }

    // A closed set. `engine` selects from this table and can never BE the program,
    // so no input reaches the spawn as an executable name.
    let (ext, argv): (&str, fn(&str) -> Vec<String>) = match engine.as_str() {
        "powershell" => ("ps1", |f: &str| {
            vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                f.to_string(),
            ]
        }),
        "cmd" => ("bat", |f: &str| vec!["/c".into(), f.to_string()]),
        "bash" => ("sh", |f: &str| vec![f.to_string()]),
        "python" => ("py", |f: &str| vec![f.to_string()]),
        other => return Err(format!("Unknown script engine: {}", other)),
    };

    // Which executable actually provides that engine on THIS machine. Still a closed
    // set — the candidates are hard-coded per engine — but no longer a single guess.
    //
    // The old code spawned the literal name "python", which is the one that fails most
    // often on Windows: `python.exe` there is usually the Microsoft Store's App
    // Execution Alias, which opens the Store instead of running anything, while the
    // real interpreter is `py`. A task scheduled against that alias failed at 3am with
    // "Could not start python", long after the person who wrote it could connect the
    // two. Resolving now, in order, and rejecting a candidate that does not answer
    // --version, skips the alias by construction.
    let program = resolve_engine(&engine).ok_or_else(|| missing_engine_message(&engine))?;

    // A unique name per run: two tasks firing on the same tick must not write each
    // other's script, and a stale file from a crashed run must never be executed in
    // place of this one.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("bmm-sched-{}-{}.{}", std::process::id(), stamp, ext));

    std::fs::write(&path, code.as_bytes()).map_err(|e| format!("Could not write the script: {}", e))?;

    log_line(format!(
        "[SCHED] Running {} script ({} bytes) at {}",
        engine,
        code.len(),
        path.display()
    ));

    let file = path.to_string_lossy().to_string();
    let mut cmd = crate::commands::proc::hidden_command(&program);
    cmd.args(argv(&file));
    if let Some(dir) = working_dir.as_ref().filter(|d| !d.trim().is_empty()) {
        cmd.current_dir(dir);
    }
    let result = cmd.output();

    // Removed on EVERY path, including the spawn failing — a temp directory slowly
    // filling with the user's scripts is both a mess and a disclosure.
    let _ = std::fs::remove_file(&path);

    let output = result.map_err(|e| format!("Could not start {}: {}", program, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!(
            "Script exited with {}: {}",
            output.status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into()),
            if stderr.trim().is_empty() { stdout } else { stderr }
        ))
    }
}

/// The executables that can provide each script engine, in preference order.
///
/// Hard-coded per engine, so this stays the same closed set the spawn always used —
/// resolution picks BETWEEN these names, it never accepts one from the caller.
///
/// Order matters on Windows. `py` (the official launcher, installed by every
/// python.org build) comes before `python`, because the bare `python.exe` on a
/// stock Windows is normally the Microsoft Store App Execution Alias: a stub that
/// opens the Store and runs nothing. Trying it first is how "Python is installed"
/// and "the task fails" end up both being true at once.
fn engine_candidates(engine: &str) -> &'static [&'static str] {
    match engine {
        "powershell" => &["powershell"],
        "cmd" => &["cmd"],
        "bash" => &["bash"],
        "python" => &["py", "python3", "python"],
        _ => &[],
    }
}

/// Ask a candidate what version it is. Presence on PATH is NOT enough: the Store
/// alias exists on PATH and answers nothing useful, so a candidate only counts if it
/// exits successfully AND says something. That distinction is the whole point of
/// probing rather than checking for a file.
fn probe_engine(program: &str) -> Option<String> {
    // Not everything answers `--version`, and assuming it does is how a probe reports
    // that the shell Windows always ships is missing. Measured on Windows 11:
    //   py --version          -> "Python 3.12.0"                    (ok)
    //   powershell --version  -> a PARSE ERROR, exit 255            (5.1 has no such flag;
    //                                                                it evaluates the text)
    //   cmd --version         -> would wait for input forever
    // So the two shells get the call they actually understand.
    let args: &[&str] = match program {
        "cmd" => &["/c", "ver"],
        "powershell" => &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$PSVersionTable.PSVersion.ToString()",
        ],
        _ => &["--version"],
    };
    let out = crate::commands::proc::hidden_command(program)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // Some interpreters print the version to stderr (older Python 2 did), so read both.
    let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&out.stderr).trim().to_string();
    }
    if text.is_empty() {
        None
    } else {
        Some(text.lines().next().unwrap_or("").to_string())
    }
}

/// The executable that will actually run this engine here, or None if none will.
fn resolve_engine(engine: &str) -> Option<String> {
    engine_candidates(engine)
        .iter()
        .find(|c| probe_engine(c).is_some())
        .map(|c| c.to_string())
}

/// Said once, in the place that knows why, rather than left to a raw spawn error.
fn missing_engine_message(engine: &str) -> String {
    let tried = engine_candidates(engine).join(", ");
    match engine {
        "python" => format!(
            "No Python interpreter found (tried: {tried}). BMM does not bundle one — \
             install Python from python.org and make sure it is on your PATH. On Windows, \
             a `python` that opens the Microsoft Store is the App Execution Alias, not an \
             interpreter: disable it under Settings → Apps → App execution aliases, or use \
             the `py` launcher."
        ),
        "bash" => format!(
            "No bash found (tried: {tried}). BMM does not bundle one — on Windows it comes \
             with Git for Windows or WSL. PowerShell and cmd are always available."
        ),
        other => format!("No interpreter found for {other} (tried: {tried})."),
    }
}

/// What can actually run on this machine, so the task editor can say so BEFORE a task
/// is saved rather than after it silently fails at three in the morning. Each entry is
/// {engine, available, program, version} — `program` and `version` are what the probe
/// found, which is also the honest answer to "which Python is this going to use".
#[tauri::command(async)]
pub fn scheduler_script_engines() -> Vec<serde_json::Value> {
    ["powershell", "cmd", "bash", "python"]
        .iter()
        .map(|e| {
            let found = engine_candidates(e)
                .iter()
                .find_map(|c| probe_engine(c).map(|v| (c.to_string(), v)));
            serde_json::json!({
                "engine": e,
                "available": found.is_some(),
                "program": found.as_ref().map(|(p, _)| p.clone()),
                "version": found.as_ref().map(|(_, v)| v.clone()),
            })
        })
        .collect()
}

/// True if a file or folder exists at `path`. Used by the scheduler's
/// "file exists" / "wait until file appears" condition.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.trim().is_empty() && std::path::Path::new(path.trim()).exists()
}

/// True if the target process is running. Used by the scheduler's "app is running"
/// condition / "wait until app launched" step.
///
/// `pid` wins when given. A name is a guess that can match several processes or none —
/// two copies of the same game, a launcher that renames itself between versions — while
/// a pid names exactly one. The name path stays because a scheduled task is written once
/// and runs for months: pids do not survive a reboot, so "is Steam running?" can only be
/// asked by name.
#[tauri::command]
pub fn is_process_running(name: String, pid: Option<u32>) -> bool {
    use sysinfo::{ProcessRefreshKind, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));
    if let Some(want) = pid.filter(|p| *p > 0) {
        return sys.processes().contains_key(&sysinfo::Pid::from_u32(want));
    }
    let needle = name.trim().to_lowercase();
    if needle.is_empty() {
        return false;
    }
    let stem = needle.trim_end_matches(".exe");
    sys.processes().values().any(|p| {
        let pname = p.name().to_lowercase();
        pname == needle
            || pname == format!("{}.exe", stem)
            || pname.trim_end_matches(".exe") == stem
    })
}

/// Everything currently running, so a task can be pointed at a real process instead of a
/// guessed name — {pid, name, exe, memMb}.
///
/// This existed nowhere: "app is running" took a name typed from memory, and a name that
/// never matches makes a condition that is silently always false, which is the worst kind
/// of broken schedule because it looks like it works.
///
/// Read-only, and deliberately not permission-gated: it reports what the OS already shows
/// in any task manager. Acting on a process is a different matter — see stop_process.
#[tauri::command(async)]
pub fn list_running_processes() -> Vec<serde_json::Value> {
    use sysinfo::{ProcessRefreshKind, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));
    let mut out: Vec<serde_json::Value> = sys
        .processes()
        .iter()
        .map(|(pid, p)| {
            serde_json::json!({
                "pid": pid.as_u32(),
                "name": p.name(),
                "exe": p.exe().map(|e| e.to_string_lossy().to_string()),
                "memMb": (p.memory() / (1024 * 1024)) as u64,
            })
        })
        .collect();
    // Heaviest first: the process somebody wants to name in a task is almost never the
    // 4 MB background service, and an alphabetical list of 400 entries is a list nobody
    // reads to the end.
    out.sort_by(|a, b| {
        b["memMb"]
            .as_u64()
            .unwrap_or(0)
            .cmp(&a["memMb"].as_u64().unwrap_or(0))
    });
    out
}

/// Stop a process, by pid or by name.
///
/// `allow` carries the task's explicit permission, exactly as run_scheduled_script does:
/// terminating a process can lose unsaved work, so it must be granted, not assumed.
///
/// Refuses to kill BMM itself. A task that stops the app running it would kill the
/// scheduler mid-step, leaving the run recorded as neither finished nor failed — and the
/// obvious way to write it ("close everything called Better*") would do exactly that by
/// accident.
#[tauri::command(async)]
pub fn stop_process(name: String, pid: Option<u32>, allow: bool) -> Result<u32, String> {
    use sysinfo::{ProcessRefreshKind, System, UpdateKind};
    if !allow {
        return Err(
            "Stopping a process is not permitted for this task (grant it in the task's permissions)."
                .to_string(),
        );
    }
    let me = std::process::id();
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));

    let targets: Vec<_> = if let Some(want) = pid.filter(|p| *p > 0) {
        sys.processes()
            .iter()
            .filter(|(k, _)| k.as_u32() == want)
            .map(|(_, p)| p)
            .collect()
    } else {
        let needle = name.trim().to_lowercase();
        if needle.is_empty() {
            return Err("No process name or pid given.".to_string());
        }
        let stem = needle.trim_end_matches(".exe");
        sys.processes()
            .values()
            .filter(|p| {
                let pname = p.name().to_lowercase();
                pname == needle
                    || pname == format!("{}.exe", stem)
                    || pname.trim_end_matches(".exe") == stem
            })
            .collect()
    };

    let mut killed = 0u32;
    for p in targets {
        if p.pid().as_u32() == me {
            log_line("[SCHED] Refusing to stop BMM itself".to_string());
            continue;
        }
        if p.kill() {
            killed += 1;
        }
    }
    log_line(format!(
        "[SCHED] stop_process name={:?} pid={:?} -> {} stopped",
        name, pid, killed
    ));
    if killed == 0 {
        Err("Nothing matched — the process was not running.".to_string())
    } else {
        Ok(killed)
    }
}

// ── Windows Task Scheduler integration ────────────────────────────────────────
// Lets a scheduled task fire even when BMM is CLOSED: we register a Windows
// Scheduled Task that launches `BMM.exe "bmm://schedule/run?id=<id>"` at the right
// time. BMM is registered as the `bmm://` URL-scheme handler, so on launch the
// deep-link router runs that one task. We use PowerShell's ScheduledTasks module
// (not schtasks.exe) because it parses dates culture-independently.

fn sanitize_task_id(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')).collect()
}

fn ps_day_name(n: i64) -> Option<&'static str> {
    Some(match n {
        0 => "Sunday", 1 => "Monday", 2 => "Tuesday", 3 => "Wednesday",
        4 => "Thursday", 5 => "Friday", 6 => "Saturday", _ => return None,
    })
}

/// Builds the `New-ScheduledTaskTrigger ...` expression from the frontend trigger.
fn build_trigger_expr(trigger: &serde_json::Value) -> Result<String, String> {
    let ty = trigger.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match ty {
        "interval" => {
            let n = trigger.get("everyMinutes").and_then(|v| v.as_i64()).unwrap_or(60).max(1);
            Ok(format!(
                "New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes {}) -RepetitionDuration (New-TimeSpan -Days 3650)",
                n
            ))
        }
        "hourly" => {
            let n = trigger.get("everyHours").and_then(|v| v.as_i64()).unwrap_or(1).max(1);
            Ok(format!(
                "New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours {}) -RepetitionDuration (New-TimeSpan -Days 3650)",
                n
            ))
        }
        "monthlyAt" => {
            // No native monthly cmdlet — build the trigger via its CIM class. This
            // is a single expression that returns a monthly trigger object.
            let time = trigger.get("time").and_then(|v| v.as_str()).unwrap_or("08:00");
            let h = time.split(':').next().unwrap_or("8").chars().filter(|c| c.is_ascii_digit()).collect::<String>();
            let mi = time.split(':').nth(1).unwrap_or("0").chars().filter(|c| c.is_ascii_digit()).collect::<String>();
            let day = trigger.get("day").and_then(|v| v.as_i64()).unwrap_or(1).clamp(1, 31);
            Ok(format!(
                "New-CimInstance -CimClass (Get-CimClass -ClassName MSFT_TaskMonthlyTrigger -Namespace Root/Microsoft/Windows/TaskScheduler) \
                 -ClientOnly -Property @{{ StartBoundary = (Get-Date -Hour {} -Minute {} -Second 0).ToString('s'); DaysOfMonth = {}; Enabled = $true }}",
                h, mi, day
            ))
        }
        "manual" => Err("manual trigger has no OS schedule".to_string()),
        "dailyAt" => {
            let time = trigger.get("time").and_then(|v| v.as_str()).unwrap_or("08:00");
            Ok(format!("New-ScheduledTaskTrigger -Daily -At '{}'", time.replace('\'', "")))
        }
        "weeklyAt" => {
            let time = trigger.get("time").and_then(|v| v.as_str()).unwrap_or("08:00");
            let days: Vec<&str> = trigger.get("days").and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|d| d.as_i64()).filter_map(ps_day_name).collect())
                .unwrap_or_default();
            if days.is_empty() { return Err("weekly trigger needs at least one day".into()); }
            Ok(format!("New-ScheduledTaskTrigger -Weekly -DaysOfWeek {} -At '{}'", days.join(","), time.replace('\'', "")))
        }
        "once" => {
            // ISO "YYYY-MM-DDTHH:MM[:SS]" → culture-independent Get-Date components.
            let at = trigger.get("at").and_then(|v| v.as_str()).unwrap_or("");
            let (date, time) = at.split_once('T').unwrap_or((at, "00:00"));
            let d: Vec<&str> = date.split('-').collect();
            let t: Vec<&str> = time.split(':').collect();
            if d.len() < 3 { return Err("invalid 'once' datetime".into()); }
            let (y, mo, da) = (d[0], d[1], d[2]);
            let (h, mi) = (t.get(0).copied().unwrap_or("0"), t.get(1).copied().unwrap_or("0"));
            let num = |s: &str| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>();
            Ok(format!(
                "New-ScheduledTaskTrigger -Once -At (Get-Date -Year {} -Month {} -Day {} -Hour {} -Minute {} -Second 0)",
                num(y), num(mo), num(da), num(h), num(mi)
            ))
        }
        "appStart" => Ok("New-ScheduledTaskTrigger -AtLogOn".to_string()),
        other => Err(format!("trigger type '{}' cannot be an OS schedule", other)),
    }
}

/// Registers (or replaces) a Windows Scheduled Task that launches BMM to run this
/// task by id at the configured time — even when BMM is closed.
#[tauri::command]
pub fn register_os_schedule(task_id: String, trigger: serde_json::Value) -> Result<(), String> {
    let safe_id = sanitize_task_id(&task_id);
    if safe_id.is_empty() { return Err("invalid task id".into()); }
    let task_name = format!("BMM_{}", safe_id);

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_string_lossy().replace('\'', "''"); // PS single-quote escape
    let trigger_expr = build_trigger_expr(&trigger)?;

    // -Argument is the bmm:// deep link, double-quoted so the OS passes it as one argv.
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         $a = New-ScheduledTaskAction -Execute '{exe}' -Argument '\"bmm://schedule/run?id={id}\"'; \
         $t = {trig}; \
         $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; \
         Register-ScheduledTask -TaskName '{name}' -Action $a -Trigger $t -Settings $s -Force | Out-Null",
        exe = exe_str, id = safe_id, trig = trigger_expr, name = task_name
    );

    let out = crate::commands::proc::hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell spawn failed: {}", e))?;
    if out.status.success() {
        log_line(format!("[SCHED] Registered OS task {}", task_name));
        Ok(())
    } else {
        Err(format!("Register failed: {}", String::from_utf8_lossy(&out.stderr)))
    }
}

/// Removes the Windows Scheduled Task for this BMM task (no-op if absent).
#[tauri::command]
pub fn unregister_os_schedule(task_id: String) -> Result<(), String> {
    let safe_id = sanitize_task_id(&task_id);
    if safe_id.is_empty() { return Ok(()); }
    let task_name = format!("BMM_{}", safe_id);
    let script = format!(
        "try {{ Unregister-ScheduledTask -TaskName '{}' -Confirm:$false }} catch {{}}",
        task_name
    );
    let _ = crate::commands::proc::hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();
    log_line(format!("[SCHED] Unregistered OS task {}", task_name));
    Ok(())
}

/// Creates a folder inside BMM's own app-data directory.
///
/// The scheduler can already run scripts, which can obviously create folders — but
/// only for a task that has been granted the "run scripts" permission, which is a
/// large thing to hand over for `mkdir`. This is the small, safe version: the one
/// place a task can make a folder without being trusted with the machine.
///
/// `relative` is joined UNDER the app-data dir and confined there (CWE-22). The
/// containment is checked on the CANONICALISED parent rather than by rejecting
/// `..` textually: a blacklist of dangerous spellings is a game you lose, and on
/// Windows there are several ways to write the same escape. The parent is
/// canonicalised because the target itself does not exist yet — there is nothing to
/// resolve until after it is made.
#[tauri::command(async)]
pub fn create_bmm_folder(app: tauri::AppHandle, relative: String) -> Result<String, String> {
    use tauri::Manager;

    let rel = relative.trim().trim_matches(|c| c == '/' || c == '\\');
    if rel.is_empty() {
        return Err("No folder name given".to_string());
    }
    // An absolute path is not a relative one, and silently reinterpreting it under
    // app-data would create a folder somewhere the caller did not ask for.
    let candidate = std::path::Path::new(rel);
    if candidate.is_absolute() || rel.contains(':') {
        return Err("Give a path relative to BMM's data folder, not an absolute one".to_string());
    }

    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app-data directory: {}", e))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("Could not open BMM's data folder: {}", e))?;
    let base_real = base
        .canonicalize()
        .map_err(|e| format!("Could not resolve BMM's data folder: {}", e))?;

    let target = base_real.join(candidate);
    // Create the parents first so there is something to canonicalise, then verify.
    // Doing it in this order means a traversal attempt can create a directory before
    // the check — so the check failing removes what it just made, below.
    let parent = target
        .parent()
        .ok_or_else(|| "Invalid folder name".to_string())?
        .to_path_buf();
    std::fs::create_dir_all(&parent).map_err(|e| format!("Could not create the folder: {}", e))?;
    let parent_real = parent
        .canonicalize()
        .map_err(|e| format!("Could not resolve the folder: {}", e))?;
    if !parent_real.starts_with(&base_real) {
        return Err("That path leaves BMM's data folder".to_string());
    }

    let final_path = parent_real.join(
        target
            .file_name()
            .ok_or_else(|| "Invalid folder name".to_string())?,
    );
    std::fs::create_dir_all(&final_path).map_err(|e| format!("Could not create the folder: {}", e))?;

    log_line(format!("[SCHED] Created folder {}", final_path.display()));
    Ok(final_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod process_tests {
    use super::*;

    /// The listing has to see the real OS, not just compile. This process is guaranteed to
    /// be in it, which makes it the one assertion that cannot pass by accident on an empty
    /// or failed refresh — a bare `!is_empty()` would.
    #[test]
    fn lists_this_very_process() {
        let me = std::process::id();
        let all = list_running_processes();
        assert!(
            all.len() > 1,
            "expected a populated process list, got {}",
            all.len()
        );
        assert!(
            all.iter().any(|p| p["pid"].as_u64() == Some(me as u64)),
            "the test's own pid {} was not in the listing",
            me
        );
        // Heaviest first — the ordering the picker relies on to be readable.
        let mems: Vec<u64> = all.iter().filter_map(|p| p["memMb"].as_u64()).collect();
        assert!(
            mems.windows(2).all(|w| w[0] >= w[1]),
            "listing is not sorted by memory"
        );
    }

    /// pid beats name, and a pid that exists answers true while a name that does not answers
    /// false — the two halves of the condition the scheduler asks every tick.
    #[test]
    fn pid_takes_priority_over_name() {
        let me = std::process::id();
        assert!(is_process_running("no-such-binary-xyz".into(), Some(me)));
        assert!(!is_process_running(String::new(), Some(u32::MAX)));
        assert!(!is_process_running("no-such-binary-xyz".into(), None));
        assert!(!is_process_running(String::new(), None));
    }

    /// Without the task's permission nothing is killed, and the check happens BEFORE any
    /// process is looked up — the ordering is the safety property, not the message.
    #[test]
    fn stop_requires_permission_and_spares_bmm() {
        let me = std::process::id();
        assert!(stop_process("anything".into(), Some(me), false).is_err());
        // Permission granted, target is this very process: it must refuse rather than
        // terminate the test runner, which is also what would kill the scheduler mid-run.
        assert!(stop_process(String::new(), Some(me), true).is_err());
    }
}
