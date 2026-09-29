//! The two Windows calls that turn a resolved policy into something the scheduler and the disk
//! actually see (PLAN-BMM-RESOURCES-2026.md §2.2). No-ops elsewhere.
//!
//!   · `set_current_thread_priority`: run by each governor pool thread as it starts
//!     (`ThreadPoolBuilder::start_handler`, runtime.rs). Background = THREAD_MODE_BACKGROUND_BEGIN,
//!     which also lowers the thread's I/O and memory priority; the others are the plain
//!     THREAD_PRIORITY_* levels. Never above MAX_THREAD_PRIORITY (ABOVE_NORMAL), whatever the
//!     caller passes: there is no HIGH or TIME_CRITICAL here to reach.
//!   · `set_low_io_priority`: the per-handle I/O priority hint (FileIoPriorityHintInfo,
//!     IoPriorityHintLow) on the files a governed copy opens. Advisory: NTFS on a local disk
//!     honours it; SMB shares and most cloud volumes ignore it, which the interface says.
//!
//! Both are best effort: a refusal leaves the thread or the handle as it was and the
//! operation runs anyway, at normal priority.
use super::config::{ThreadPriority, MAX_THREAD_PRIORITY};

/// The priority a pool thread asks for, capped at the hard bound.
pub fn capped(p: ThreadPriority) -> ThreadPriority { p.min(MAX_THREAD_PRIORITY) }

#[cfg(windows)]
pub fn set_current_thread_priority(p: ThreadPriority) {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN, THREAD_PRIORITY_ABOVE_NORMAL,
        THREAD_PRIORITY_BELOW_NORMAL,
    };
    let level = match capped(p) {
        ThreadPriority::Background => THREAD_MODE_BACKGROUND_BEGIN,
        ThreadPriority::BelowNormal => THREAD_PRIORITY_BELOW_NORMAL,
        ThreadPriority::Normal => return, // a new thread already runs at normal: nothing to ask
        ThreadPriority::AboveNormal => THREAD_PRIORITY_ABOVE_NORMAL,
    };
    // SAFETY: GetCurrentThread returns a pseudo-handle for the calling thread that needs no
    // closing; SetThreadPriority only reads it and the level.
    unsafe { let _ = SetThreadPriority(GetCurrentThread(), level); }
}

#[cfg(not(windows))]
pub fn set_current_thread_priority(_p: ThreadPriority) {}

#[cfg(windows)]
pub fn set_low_io_priority(f: &std::fs::File) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{FileIoPriorityHintInfo, IoPriorityHintLow, SetFileInformationByHandle, FILE_IO_PRIORITY_HINT_INFO};
    let info = FILE_IO_PRIORITY_HINT_INFO { PriorityHint: IoPriorityHintLow };
    // SAFETY: the handle is the open file's own, borrowed for the call; `info` is a local of
    // the type FileIoPriorityHintInfo expects, and its size is passed with it.
    unsafe {
        let _ = SetFileInformationByHandle(
            HANDLE(f.as_raw_handle() as isize),
            FileIoPriorityHintInfo,
            &info as *const FILE_IO_PRIORITY_HINT_INFO as *const core::ffi::c_void,
            std::mem::size_of::<FILE_IO_PRIORITY_HINT_INFO>() as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn set_low_io_priority(_f: &std::fs::File) {}

/// Windows says a full-screen Direct3D program owns the screen (a game in exclusive full
/// screen): `SHQueryUserNotificationState == QUNS_RUNNING_D3D_FULL_SCREEN`. Game detection's
/// second signal (procs.rs). Borderless-window games do not set it; the folder and executable
/// lists are what catch those.
#[cfg(windows)]
pub fn d3d_full_screen() -> bool {
    use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
    let mut state = 0;
    // SAFETY: one out-parameter, a local of the right type.
    let hr = unsafe { SHQueryUserNotificationState(&mut state) };
    hr >= 0 && state == QUNS_RUNNING_D3D_FULL_SCREEN
}

#[cfg(not(windows))]
pub fn d3d_full_screen() -> bool { false }

/// Does a window rectangle cover a whole monitor (left, top, right, bottom)? A borderless
/// full-screen window is exactly the monitor, often a pixel wider; a maximised window stops
/// at the taskbar and does not count.
pub fn covers(win: (i32, i32, i32, i32), mon: (i32, i32, i32, i32)) -> bool {
    win.0 <= mon.0 && win.1 <= mon.1 && win.2 >= mon.2 && win.3 >= mon.3 && mon.2 > mon.0 && mon.3 > mon.1
}

/// The executable of the foreground window when it covers its whole monitor (game
/// detection's opt-in third signal: borderless games set no Direct3D full-screen state).
/// None for the desktop and the taskbar, for a window that does not cover its screen, and when
/// the process cannot be asked (another user's elevated program). Four cheap calls, no list.
#[cfg(windows)]
pub fn foreground_fullscreen_exe() -> Option<String> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowRect, GetWindowThreadProcessId};
    // SAFETY: every call takes the window handle Windows just gave us (a stale one only makes
    // a call fail, which is handled) and out-parameters that are locals of the right type and
    // size (cbSize set before GetMonitorInfoW).
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 || hwnd == GetShellWindow() || hwnd == GetDesktopWindow() { return None; }
        let mut cls = [0u16; 64];
        let n = GetClassNameW(hwnd, cls.as_mut_ptr(), cls.len() as i32);
        let class = String::from_utf16_lossy(&cls[..n.max(0) as usize]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") { return None; }
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut r) == 0 { return None; }
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL);
        if mon == 0 { return None; }
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut mi) == 0 { return None; }
        let m = mi.rcMonitor;
        if !covers((r.left, r.top, r.right, r.bottom), (m.left, m.top, m.right, m.bottom)) { return None; }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 { return None; }
        process_path(pid)
    }
}

#[cfg(not(windows))]
pub fn foreground_fullscreen_exe() -> Option<String> { None }

/// A process's executable path, asked with the least right that can answer.
#[cfg(windows)]
fn process_path(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: the handle is ours and closed on every path; the buffer is a local whose
    // length is passed with it and updated by the call.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pool_thread_never_asks_above_the_bound() {
        for p in [ThreadPriority::Background, ThreadPriority::BelowNormal, ThreadPriority::Normal, ThreadPriority::AboveNormal] {
            assert!(capped(p) <= MAX_THREAD_PRIORITY);
        }
    }

    #[test]
    fn background_priority_applies_to_the_thread_that_asks() {
        // Run on a thread of its own: background mode is per thread and lasts its lifetime.
        std::thread::spawn(|| {
            set_current_thread_priority(ThreadPriority::Background);
            #[cfg(windows)]
            {
                use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority};
                // SAFETY: pseudo-handle of the calling thread.
                let p = unsafe { GetThreadPriority(GetCurrentThread()) };
                assert!(p < 0, "background mode lowers the thread's priority (got {p})");
            }
        }).join().unwrap();
    }

    #[test]
    fn only_a_window_covering_the_whole_monitor_is_full_screen() {
        let mon = (0, 0, 1920, 1080);
        assert!(covers((0, 0, 1920, 1080), mon), "borderless full screen");
        assert!(covers((-1, -1, 1921, 1081), mon), "a pixel wider still covers");
        assert!(!covers((0, 0, 1920, 1040), mon), "maximised: stops at the taskbar");
        assert!(!covers((1920, 0, 3840, 1080), mon), "the other monitor");
        assert!(covers((1920, 0, 3840, 1080), (1920, 0, 3840, 1080)), "a second monitor's own full screen");
        assert!(!covers((0, 0, 0, 0), (0, 0, 0, 0)), "an empty monitor rectangle counts for nothing");
    }

    #[test]
    fn the_foreground_check_never_panics() {
        // No assertion on the answer: it depends on the desktop the test runs on (none in CI).
        let _ = foreground_fullscreen_exe();
    }

    #[test]
    fn the_io_hint_is_harmless_on_a_real_file() {
        let p = std::env::temp_dir().join(format!("bmm-gov-win-{}", std::process::id()));
        let f = std::fs::File::create(&p).unwrap();
        set_low_io_priority(&f);
        use std::io::Write;
        (&f).write_all(b"still writable").unwrap();
        drop(f);
        assert_eq!(std::fs::read(&p).unwrap(), b"still writable");
        let _ = std::fs::remove_file(&p);
    }
}
