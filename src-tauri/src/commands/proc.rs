//! Child-process spawning that never flashes a console window on Windows.
//!
//! Console programs (cmd, powershell, python, bash, cscript, …) launched via the
//! default `Command` pop a black console window for a split second in a release
//! build (the app itself is GUI-subsystem, but its children aren't). Routing every
//! spawn through these helpers sets the `CREATE_NO_WINDOW` flag so they stay
//! invisible. On non-Windows the flag is a no-op.

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A `std::process::Command` that won't show a console window (Windows).
pub fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// A `tokio::process::Command` that won't show a console window (Windows).
pub fn hidden_tokio_command<S: AsRef<std::ffi::OsStr>>(program: S) -> tokio::process::Command {
    let mut c = tokio::process::Command::new(program);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW); // tokio Command exposes this inherently on Windows
    c
}


/// A hidden PowerShell running `script`, with every VALUE handed over as an environment
/// variable (`$env:NAME` in the script) instead of being spliced into the script text.
///
/// Splicing is what the launch-pack code did, escaping `'` as `''` — and PowerShell also ends a
/// single-quoted string at `‘ ’ ‚ ‛` (U+2018–U+201B). A pack named `x’; <command>; ’` in a
/// `.bmmlaunch` somebody shared ran `<command>` the moment it was IMPORTED (CWE-78). An
/// environment variable is data to PowerShell whatever it contains, so there is nothing left
/// to escape and no quote character to forget.
pub fn hidden_powershell(script: &str, vars: &[(&str, &std::ffi::OsStr)]) -> std::process::Command {
    let mut c = hidden_command("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    for (k, v) in vars {
        c.env(k, v);
    }
    c
}

/// Write a Windows shortcut (`.lnk`) that runs `wscript.exe "<vbs>"`: a launch pack's.
///
/// The one copy of a script that was written out three times (create, update, and the MCP
/// server's create), all three splicing paths into the text — see `hidden_powershell`.
pub fn create_wscript_shortcut(
    lnk: &std::path::Path,
    vbs: &std::path::Path,
    working_dir: &std::path::Path,
    icon: Option<&std::path::Path>,
) -> std::io::Result<std::process::Output> {
    let script = "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut($env:BMM_LNK); \
         $Shortcut.TargetPath = 'wscript.exe'; \
         $Shortcut.Arguments = '\"' + $env:BMM_VBS + '\"'; \
         $Shortcut.WorkingDirectory = $env:BMM_WORKDIR; \
         $Shortcut.IconLocation = $env:BMM_ICON; \
         $Shortcut.Save()";
    let empty = std::ffi::OsStr::new("");
    hidden_powershell(script, &[
        ("BMM_LNK", lnk.as_os_str()),
        ("BMM_VBS", vbs.as_os_str()),
        ("BMM_WORKDIR", working_dir.as_os_str()),
        ("BMM_ICON", icon.map(|p| p.as_os_str()).unwrap_or(empty)),
    ])
    .output()
}

/// A launch-pack name made safe to be a shortcut's FILE name: no separator, no drive, no
/// wildcard, no `..`, never empty. Here rather than in launch_pack.rs so the MCP server,
/// which compiles this file and not that one, names its shortcuts by the same rule — it
/// joined the raw name, so `..\..\Startup\x` placed the shortcut wherever it liked.
pub fn safe_lnk_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let cleaned = cleaned.replace("..", "_");
    let cleaned = cleaned.trim_matches(|c| c == '.' || c == ' ');
    if cleaned.is_empty() { "launchpack".to_string() } else { cleaned.to_string() }
}

#[cfg(all(test, windows))]
mod powershell_tests {
    use super::*;

    /// The trigger, run for real: a value holding PowerShell's other single quotes, which a
    /// `''` escape does not touch. Passed as a variable it comes back as the same string and
    /// nothing in it runs.
    #[test]
    fn a_value_with_unicode_quotes_is_data_not_code() {
        let hostile = "x\u{2019}; Write-Output INJECTED; \u{2019} and ' and \u{2018}";
        let out = hidden_powershell(
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output ('value=' + $env:BMM_T)",
            &[("BMM_T", std::ffi::OsStr::new(hostile))],
        )
        .output()
        .expect("powershell runs");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(!text.lines().any(|l| l.trim() == "INJECTED"), "the value ran: {text}");
        assert!(text.contains(&format!("value={hostile}")), "the value was changed: {text}");
    }

    #[test]
    fn a_shortcut_name_cannot_carry_a_path() {
        assert_eq!(safe_lnk_stem(r"..\..\Startup\evil"), "____Startup_evil");
        assert_eq!(safe_lnk_stem("C:evil"), "C_evil");
        assert_eq!(safe_lnk_stem("   "), "launchpack");
    }
}

/// What a finished (or killed) process left behind.
pub struct Finished {
    pub stdout: String,
    pub stderr: String,
    /// None when the process was killed for running too long.
    pub code: Option<i32>,
    pub timed_out: bool,
}

/// Run a command, and give up on it after `secs`.
///
/// `Command::output()` waits forever. That is fine for something BMM itself wrote and wrong
/// for a script somebody scheduled: a `.ps1` that reads from stdin, a `python` blocked on a
/// socket, an installer that quietly opened a dialog on a session nobody is looking at. The
/// task holds its slot until the app is closed, and the only visible symptom is a run that has
/// been "in progress" since 3am.
///
/// **The pipes are drained on their own threads**, which is not decoration. A child writing
/// more than the pipe buffer holds — 64 KB is typical — blocks on its own write until somebody
/// reads. Polling for exit without reading would therefore hang on a CHATTY script that is
/// working perfectly, and the timeout would then kill it: a wait-for-exit loop with unread
/// pipes turns "prints a lot" into "fails after five minutes".
///
/// On Windows the whole tree is killed, not just the child. Killing `powershell.exe` leaves
/// whatever it started running, which is the case that matters — a script's job is usually to
/// start something.
pub fn run_with_timeout(mut cmd: std::process::Command, secs: u64) -> std::io::Result<Finished> {
    use std::io::Read;
    use std::sync::mpsc;

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::null());
    let mut child = cmd.spawn()?;

    let drain = |mut pipe: Option<Box<dyn Read + Send>>| {
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(p) = pipe.as_mut() {
                let mut raw = Vec::new();
                let _ = p.read_to_end(&mut raw);
                buf = String::from_utf8_lossy(&raw).to_string();
            }
            let _ = tx.send(buf);
        });
        rx
    };
    let out_rx = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let err_rx = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(secs.max(1));
    let mut timed_out = false;
    let code = loop {
        match child.try_wait()? {
            Some(status) => break status.code(),
            None => {
                if std::time::Instant::now() >= deadline {
                    timed_out = true;
                    kill_tree(&mut child);
                    break None;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    };

    // Whatever it managed to say before it was stopped. Short waits, because the pipes are
    // closed once the process is gone — and a reader thread that never finishes must not turn
    // a timeout into a permanent hang, which would be this function causing the bug it exists
    // to prevent.
    let grab = |rx: mpsc::Receiver<String>| rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or_default();
    Ok(Finished { stdout: grab(out_rx), stderr: grab(err_rx), code, timed_out })
}

/// Stop a process and everything it started.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        // /T for the tree, /F because a script that ignored a polite request for five minutes
        // is not going to answer this one either.
        let _ = hidden_command("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod timeout_tests {
    use super::*;

    /// The whole point: a process that never ends is stopped, and says so.
    ///
    /// Uses the platform's own sleep rather than a script BMM writes, so the test does not
    /// depend on PowerShell or Python being installed on whoever runs it.
    #[test]
    fn a_process_that_will_not_end_is_killed_and_reported() {
        let cmd = if cfg!(windows) {
            let mut c = hidden_command("cmd");
            // A ping to a nonexistent-but-routable address is the classic Windows sleep, and
            // `timeout` refuses to run without a console, which is exactly what this is.
            c.args(["/c", "ping", "127.0.0.1", "-n", "30"]);
            c
        } else {
            let mut c = hidden_command("sleep");
            c.arg("30");
            c
        };
        let started = std::time::Instant::now();
        let out = run_with_timeout(cmd, 1).expect("it should start");
        let took = started.elapsed();

        assert!(out.timed_out, "a 30s process under a 1s limit must report timing out");
        assert_eq!(out.code, None, "there is no exit code for a process we killed");
        // Generously bounded: the point is that it did not wait thirty seconds, not that it
        // was punctual to the millisecond on a loaded CI machine.
        assert!(took.as_secs() < 15, "took {:?} — the deadline did not fire", took);
    }

    /// And the ordinary case still behaves: output arrives, the code is zero, nothing is killed.
    #[test]
    fn a_normal_process_returns_its_output_untouched() {
        let cmd = if cfg!(windows) {
            let mut c = hidden_command("cmd");
            c.args(["/c", "echo", "hello"]);
            c
        } else {
            let mut c = hidden_command("echo");
            c.arg("hello");
            c
        };
        let out = run_with_timeout(cmd, 30).expect("it should start");
        assert!(!out.timed_out);
        assert_eq!(out.code, Some(0));
        assert!(out.stdout.contains("hello"), "stdout was {:?}", out.stdout);
    }

    /// A chatty process must not hang.
    ///
    /// This is the bug the reader threads exist to prevent: a child writing more than the pipe
    /// buffer blocks on its own write until somebody reads, so a wait-for-exit loop with unread
    /// pipes turns "prints a lot" into "times out" — killing a script that was working.
    #[test]
    fn a_process_that_prints_a_lot_is_not_mistaken_for_a_stuck_one() {
        let cmd = if cfg!(windows) {
            let mut c = hidden_command("cmd");
            // ~5000 lines, comfortably past any pipe buffer.
            c.args(["/c", "for /L %i in (1,1,5000) do @echo line-%i"]);
            c
        } else {
            let mut c = hidden_command("sh");
            c.args(["-c", "i=0; while [ $i -lt 5000 ]; do echo line-$i; i=$((i+1)); done"]);
            c
        };
        let out = run_with_timeout(cmd, 30).expect("it should start");
        assert!(!out.timed_out, "a talkative process was treated as stuck");
        assert_eq!(out.code, Some(0));
        assert!(out.stdout.len() > 20_000, "only got {} bytes back", out.stdout.len());
    }
}

/// Why a [`shell_launch`] did not start the program. `code` is the Windows error, 0 when the
/// program did start and then closed straight away with a failure exit code (`exit_code`).
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchError {
    pub code: u32,
    pub exit_code: Option<u32>,
    pub message: String,
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// ERROR_CANCELLED: the person answered No to the Windows permission (UAC) prompt.
pub const ERROR_CANCELLED: u32 = 1223;
/// ERROR_ELEVATION_REQUIRED: the program asks for administrator rights.
pub const ERROR_ELEVATION_REQUIRED: u32 = 740;
/// ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION: typically an antivirus still scanning a
/// file that was written a moment ago.
pub const ERROR_SHARING_VIOLATION: u32 = 32;
pub const ERROR_LOCK_VIOLATION: u32 = 33;
pub const ERROR_ACCESS_DENIED: u32 = 5;

/// A plain-language explanation of a launch failure. The Windows text and number stay in it,
/// so a bug report still carries the real cause.
pub fn explain_launch_error(code: u32, what: &str) -> String {
    let os = std::io::Error::from_raw_os_error(code as i32).to_string();
    match code {
        ERROR_CANCELLED => format!(
            "{what} did not start: the Windows permission prompt was declined. Run the update again and \
             answer Yes, or download the installer from the release page. (Windows error {code})"
        ),
        ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION => format!(
            "{what} did not start: the file is still in use, usually by an antivirus scanning it. \
             Wait a moment and try again, or download the installer from the release page. ({os})"
        ),
        ERROR_ACCESS_DENIED => format!(
            "{what} did not start: Windows denied access to it (an antivirus or a security policy can \
             block programs started from the temporary folder). Download the installer from the \
             release page and run it by hand. ({os})"
        ),
        _ => format!("{what} did not start: {os}"),
    }
}

/// Start `file` the way Explorer does on a double-click: ShellExecuteExW, in-process, with no
/// shell and no PowerShell in between.
///
/// Why this exists: installers used to go through `open::that`, which on Windows runs
/// `powershell -NonInteractive -Command Start-Process -FilePath $env:OPEN_RS_TARGET` in a hidden
/// window. When Start-Process throws (permission prompt declined, file still locked by an
/// antivirus, PowerShell blocked by a policy) all that comes back is `ExitStatus(1)`, and BMM
/// showed exactly that: « Launcher "powershell.exe" ... failed with ExitStatus(ExitStatus(1)) ».
/// The reason was on PowerShell's stderr, which nobody read.
///
/// The verb is `open`, so a program whose manifest asks for administrator rights gets the normal
/// UAC prompt from Windows itself; `ERROR_ELEVATION_REQUIRED` is retried once with `runas`; a
/// sharing violation (antivirus scanning the file just written) is retried a few times. Any other
/// failure comes back with the Windows code and text. `args` is a parameter string: callers pass
/// constants only, never user text. The process is watched for a moment, so one that exits at
/// once with a failure code is reported instead of being taken for a started installer.
#[cfg(windows)]
pub fn shell_launch(file: &std::path::Path, args: Option<&str>) -> Result<(), LaunchError> {
    let (process, what) = shell_start(file, args)?;
    if process != 0 {
        // SAFETY: `process` is the handle ShellExecuteExW returned (NOCLOSEPROCESS); closed once.
        let early_failure = unsafe {
            let mut code = 0u32;
            let failed = k32::WaitForSingleObject(process, 1500) == k32::WAIT_OBJECT_0
                && k32::GetExitCodeProcess(process, &mut code) != 0
                && code != 0;
            k32::CloseHandle(process);
            failed.then_some(code)
        };
        if let Some(exit) = early_failure {
            return Err(LaunchError {
                code: 0,
                exit_code: Some(exit),
                message: format!(
                    "{what} started and closed at once with exit code {exit} (0x{exit:08X}). Nothing was \
                     installed; download the installer from the release page and run it by hand."
                ),
            });
        }
    }
    Ok(())
}

/// [`shell_launch`]'s start (same verb, same elevation retry, same plain-language errors), then
/// WAIT for the program to finish, at most `max_secs`. `Ok(Some(code))` is its exit code,
/// `Ok(None)` that it was still running at the deadline (or Windows gave no handle). Used for
/// an old installation's uninstaller (commands::old_installs): BMM must know it ended before it
/// scans again. `args` follows the same rule: constants, or values BMM validated, never user text.
#[cfg(windows)]
pub fn shell_run_wait(file: &std::path::Path, args: Option<&str>, max_secs: u64) -> Result<Option<u32>, LaunchError> {
    let (process, _what) = shell_start(file, args)?;
    if process == 0 {
        return Ok(None);
    }
    let millis = u32::try_from(max_secs.saturating_mul(1000)).unwrap_or(u32::MAX - 1);
    // SAFETY: `process` is the handle ShellExecuteExW returned (NOCLOSEPROCESS); closed once.
    let code = unsafe {
        let mut code = 0u32;
        let ended = k32::WaitForSingleObject(process, millis) == k32::WAIT_OBJECT_0
            && k32::GetExitCodeProcess(process, &mut code) != 0;
        k32::CloseHandle(process);
        ended.then_some(code)
    };
    Ok(code)
}

#[cfg(windows)]
mod k32 {
    #[link(name = "kernel32")]
    extern "system" {
        pub fn WaitForSingleObject(handle: isize, millis: u32) -> u32;
        pub fn GetExitCodeProcess(handle: isize, code: *mut u32) -> i32;
        pub fn CloseHandle(handle: isize) -> i32;
    }
    pub const WAIT_OBJECT_0: u32 = 0;
}

/// The start half of [`shell_launch`]: ShellExecuteExW with `open`, `runas` on
/// ERROR_ELEVATION_REQUIRED, a few retries on a sharing violation. Returns the process handle
/// (0 when Windows gave none; the caller closes a non-zero one) and the file's display name.
#[cfg(windows)]
fn shell_start(file: &std::path::Path, args: Option<&str>) -> Result<(isize, String), LaunchError> {
    use std::os::windows::ffi::OsStrExt;

    // A #[repr(C)] mirror of SHELLEXECUTEINFOW: windows-sys only exposes it behind a feature
    // (Win32_System_Registry) this crate does not enable.
    #[repr(C)]
    struct ShellExecuteInfoW {
        cb_size: u32,
        f_mask: u32,
        hwnd: isize,
        lp_verb: *const u16,
        lp_file: *const u16,
        lp_parameters: *const u16,
        lp_directory: *const u16,
        n_show: i32,
        h_inst_app: isize,
        lp_id_list: *mut core::ffi::c_void,
        lp_class: *const u16,
        hkey_class: isize,
        dw_hot_key: u32,
        h_icon_or_monitor: isize,
        h_process: isize,
    }
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteExW(info: *mut ShellExecuteInfoW) -> i32;
    }
    const SEE_MASK_NOCLOSEPROCESS: u32 = 0x40;
    const SEE_MASK_NOASYNC: u32 = 0x100;
    const SEE_MASK_FLAG_NO_UI: u32 = 0x400;
    const SW_SHOWNORMAL: i32 = 1;

    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let file_w = wide(file.as_os_str());
    let dir_w = file.parent().map(|d| wide(d.as_os_str()));
    let args_w = args.map(|a| wide(std::ffi::OsStr::new(a)));
    let what = file
        .file_name()
        .map(|n| format!("\"{}\"", n.to_string_lossy()))
        .unwrap_or_else(|| "The program".to_string());

    let attempt = |verb: &str| -> Result<isize, u32> {
        let verb_w = wide(std::ffi::OsStr::new(verb));
        let mut info = ShellExecuteInfoW {
            cb_size: std::mem::size_of::<ShellExecuteInfoW>() as u32,
            // NO_UI: Windows' own error box would only repeat the message BMM shows.
            f_mask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            hwnd: 0,
            lp_verb: verb_w.as_ptr(),
            lp_file: file_w.as_ptr(),
            lp_parameters: args_w.as_ref().map(|a| a.as_ptr()).unwrap_or(std::ptr::null()),
            lp_directory: dir_w.as_ref().map(|d| d.as_ptr()).unwrap_or(std::ptr::null()),
            n_show: SW_SHOWNORMAL,
            h_inst_app: 0,
            lp_id_list: std::ptr::null_mut(),
            lp_class: std::ptr::null(),
            hkey_class: 0,
            dw_hot_key: 0,
            h_icon_or_monitor: 0,
            h_process: 0,
        };
        // SAFETY: every pointer is a NUL-terminated buffer that outlives the call, and cb_size
        // is the size of this #[repr(C)] mirror of SHELLEXECUTEINFOW.
        let ok = unsafe { ShellExecuteExW(&mut info) };
        if ok != 0 {
            Ok(info.h_process)
        } else {
            Err(std::io::Error::last_os_error().raw_os_error().unwrap_or(0) as u32)
        }
    };

    let mut verb = "open";
    let mut retries = 0u64;
    let process = loop {
        match attempt(verb) {
            Ok(h) => break h,
            Err(ERROR_ELEVATION_REQUIRED) if verb == "open" => verb = "runas",
            Err(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION) if retries < 4 => {
                retries += 1;
                std::thread::sleep(std::time::Duration::from_millis(750 * retries));
            }
            Err(code) => {
                return Err(LaunchError { code, exit_code: None, message: explain_launch_error(code, &what) })
            }
        }
    };

    Ok((process, what))
}

#[cfg(all(test, windows))]
mod launch_tests {
    use super::*;

    #[test]
    fn a_declined_prompt_is_said_in_words() {
        let m = explain_launch_error(ERROR_CANCELLED, "\"BMM-Setup.exe\"");
        assert!(m.contains("permission prompt was declined"), "{m}");
        assert!(m.contains("1223"), "{m}");
    }

    #[test]
    fn a_missing_file_reports_the_windows_error_not_an_exit_status() {
        let p = std::env::temp_dir().join(format!("bmm-missing-{}.exe", std::process::id()));
        let e = shell_launch(&p, None).expect_err("a missing file cannot start");
        assert_ne!(e.code, 0);
        assert!(!e.message.contains("ExitStatus"), "{}", e.message);
        assert!(e.message.contains("did not start"), "{}", e.message);
    }

    #[test]
    fn a_program_that_fails_at_once_is_not_taken_for_a_started_one() {
        // cmd.exe /c exit 3: starts fine, exits 3 well inside the watch window.
        let cmd = std::path::PathBuf::from(std::env::var_os("ComSpec").unwrap_or_else(|| "C:\\Windows\\System32\\cmd.exe".into()));
        let e = shell_launch(&cmd, Some("/c exit 3")).expect_err("exit 3 is a failure");
        assert_eq!(e.exit_code, Some(3));
    }
}
