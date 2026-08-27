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
