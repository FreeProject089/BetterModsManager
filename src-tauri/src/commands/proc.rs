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
