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

use tauri::AppHandle;
use crate::commands::crash::log_line;

fn schedules_path(app: &AppHandle) -> std::path::PathBuf {
    app.path_resolver()
        .app_data_dir()
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
#[tauri::command]
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

    let mut cmd = std::process::Command::new(program);
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

/// True if a file or folder exists at `path`. Used by the scheduler's
/// "file exists" / "wait until file appears" condition.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.trim().is_empty() && std::path::Path::new(path.trim()).exists()
}

/// True if a process whose name matches `name` is currently running. Used by the
/// scheduler's "app is running" condition / "wait until app launched" step.
#[tauri::command]
pub fn is_process_running(name: String) -> bool {
    use sysinfo::{System, ProcessRefreshKind, UpdateKind};
    let needle = name.trim().to_lowercase();
    if needle.is_empty() { return false; }
    let stem = needle.trim_end_matches(".exe");
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));
    sys.processes().values().any(|p| {
        let pname = p.name().to_lowercase();
        pname == needle || pname == format!("{}.exe", stem) || pname.trim_end_matches(".exe") == stem
    })
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

    let out = std::process::Command::new("powershell")
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
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();
    log_line(format!("[SCHED] Unregistered OS task {}", task_name));
    Ok(())
}
