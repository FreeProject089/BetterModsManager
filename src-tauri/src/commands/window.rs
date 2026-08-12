use tauri::{Window, Runtime};

/// Open an external http(s) URL in the user's default browser. Registered so the
/// frontend's invoke('open_external_url', { url }) works (previously the command was
/// missing, forcing an unreliable window.open fallback inside the Tauri webview).
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("only http(s) URLs are allowed".into());
    }
    open::that(u).map_err(|e| e.to_string())
}

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

        let hwnd = window.hwnd().expect("Failed to get window handle").0 as isize;

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

// ── Taskbar unread badge ─────────────────────────────────────────────────────
//
// Windows does not support Tauri's set_badge_count — the doc says so outright and
// points at set_overlay_icon, which takes an actual image. So the badge is drawn
// here: a 16x16 RGBA overlay, red disc, white digits, which is what the taskbar
// composites onto the app icon.
//
// The digits come from a hand-written 3x5 bitmap font rather than a text renderer.
// At this size a real font stack is both overkill and worse: hinting and antialiasing
// on a 5-pixel-tall glyph produce grey mush, while a bitmap is exact. Anything over
// nine becomes "9+", because two digits do not fit legibly in 16 pixels and a badge
// nobody can read is decoration.

/// 3x5 glyphs, one bit per pixel, most significant bit = leftmost column.
const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111], // 0
    [0b010, 0b110, 0b010, 0b010, 0b111], // 1
    [0b111, 0b001, 0b111, 0b100, 0b111], // 2
    [0b111, 0b001, 0b111, 0b001, 0b111], // 3
    [0b101, 0b101, 0b111, 0b001, 0b001], // 4
    [0b111, 0b100, 0b111, 0b001, 0b111], // 5
    [0b111, 0b100, 0b111, 0b101, 0b111], // 6
    [0b111, 0b001, 0b010, 0b010, 0b010], // 7
    [0b111, 0b101, 0b111, 0b101, 0b111], // 8
    [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];
/// A '+' in the same 3x5 cell, for the "9+" overflow.
const PLUS: [u8; 5] = [0b000, 0b010, 0b111, 0b010, 0b000];

/// Sets (or clears) the unread badge on the taskbar icon.
///
/// `count` of 0 removes it. This is the only honest way to say "nothing unread":
/// leaving a zero badge on screen is a notification that there are no notifications.
#[tauri::command]
pub fn set_unread_badge(window: tauri::Window, count: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if count == 0 {
            return window.set_overlay_icon(None).map_err(|e| e.to_string());
        }

        const S: i32 = 16;
        let mut px = vec![0u8; (S * S * 4) as usize];
        let put = |px: &mut Vec<u8>, x: i32, y: i32, c: [u8; 4]| {
            if x < 0 || y < 0 || x >= S || y >= S { return; }
            let i = ((y * S + x) * 4) as usize;
            px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
        };

        // The disc. Sampled at 2x2 per pixel so the edge is not a staircase — the one
        // place antialiasing is worth doing by hand, because a jagged circle next to
        // the system's own smooth icons looks like a rendering fault.
        let r = 7.5_f32;
        let cx = 7.5_f32;
        let cy = 7.5_f32;
        for y in 0..S {
            for x in 0..S {
                let mut hits = 0;
                for sy in 0..2 {
                    for sx in 0..2 {
                        let fx = x as f32 + 0.25 + sx as f32 * 0.5;
                        let fy = y as f32 + 0.25 + sy as f32 * 0.5;
                        if (fx - cx).powi(2) + (fy - cy).powi(2) <= r * r { hits += 1; }
                    }
                }
                if hits > 0 {
                    let a = (hits as f32 / 4.0 * 255.0) as u8;
                    put(&mut px, x, y, [237, 66, 69, a]); // the same red the app uses for danger
                }
            }
        }

        // The glyphs, centred. One digit at 3 wide, or "9+" at 3+1+3.
        let over = count > 9;
        let cells: Vec<[u8; 5]> = if over {
            vec![DIGITS[9], PLUS]
        } else {
            vec![DIGITS[count as usize]]
        };
        let total_w: i32 = cells.len() as i32 * 3 + (cells.len() as i32 - 1);
        let mut ox = (S - total_w) / 2;
        let oy = (S - 5) / 2;
        for cell in &cells {
            for (row, bits) in cell.iter().enumerate() {
                for col in 0..3 {
                    if bits & (1 << (2 - col)) != 0 {
                        put(&mut px, ox + col, oy + row as i32, [255, 255, 255, 255]);
                    }
                }
            }
            ox += 4;
        }

        let img = tauri::image::Image::new_owned(px, S as u32, S as u32);
        return window.set_overlay_icon(Some(img)).map_err(|e| e.to_string());
    }

    // Everywhere else the platform has a real badge and no image is needed.
    #[cfg(not(target_os = "windows"))]
    {
        let n = if count == 0 { None } else { Some(count as i64) };
        return window.set_badge_count(n).map_err(|e| e.to_string());
    }
}
