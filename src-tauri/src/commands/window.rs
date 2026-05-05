use tauri::{Window, Runtime};

#[tauri::command]
pub async fn start_resizing<R: Runtime>(window: Window<R>, direction: String) {
    #[cfg(target_os = "windows")]
    {
        // Map direction strings to Win32 hit-test constants
        let hit_test: isize = match direction.as_str() {
            "Left"        => 10, // HTLEFT
            "Right"       => 11, // HTRIGHT
            "Top"         => 12, // HTTOP
            "TopLeft"     => 13, // HTTOPLEFT
            "TopRight"    => 14, // HTTOPRIGHT
            "Bottom"      => 15, // HTBOTTOM
            "BottomLeft"  => 16, // HTBOTTOMLEFT
            "BottomRight" => 17, // HTBOTTOMRIGHT
            _ => return,
        };

        let hwnd = window.hwnd().expect("Failed to get window handle").0;

        // CRITICAL: ReleaseCapture + SendMessageW MUST run on the main/UI thread.
        // The async command handler runs on a tokio thread — ReleaseCapture() on the
        // wrong thread does nothing because mouse capture is per-thread on Windows.
        let _ = window.run_on_main_thread(move || {
            use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_NCLBUTTONDOWN};
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;

            unsafe {
                ReleaseCapture();
                SendMessageW(hwnd as _, WM_NCLBUTTONDOWN, hit_test as usize, 0);
            }
        });
    }
}
