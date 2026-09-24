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
