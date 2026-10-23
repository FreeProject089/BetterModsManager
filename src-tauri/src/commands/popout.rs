//! Panels popped out of BMM's window into windows of their own (frontend/popout.html).
//!
//! A few of BMM's panels float and can be dragged (the theme editor, the translation sandbox in
//! overlay mode, the task debugger), but only inside BMM's own window: the panel you need next
//! to the app ends up on top of the app. These commands open a real OS window for one of them.
//!
//! The pop-out window runs none of the panel's code. The panel stays in the main window,
//! hidden, and keeps doing all the work; the pop-out shows a copy of its markup and sends the
//! clicks and keystrokes back (frontend/src/ui/popout.ts, popout-window.ts). So the window
//! needs no more than events and moving itself, which is all capabilities/popout.json grants.
//!
//! Labels are `popout-<id>`, `<id>` a short lowercase slug from a fixed list in the frontend.
//! main.rs announces a destroyed pop-out (`bmm://popout-closed`, payload the id) so the main
//! window shows the panel again however the window went away (its own button, Alt+F4, the
//! taskbar).

use tauri::Manager;

/// The label prefix of every pop-out window. main.rs lets these close without ending the app
/// (its CloseRequested handler only acts on "main").
pub const PREFIX: &str = "popout-";

/// The emitted event when a pop-out window is gone. Payload: its id.
pub const CLOSED_EVENT: &str = "bmm://popout-closed";

/// A slug, so the id can be neither a path nor a query string of its own.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn label(id: &str) -> Result<String, String> {
    if valid_id(id) { Ok(format!("{PREFIX}{id}")) } else { Err("invalid pop-out id".into()) }
}

/// Open (or bring forward) the pop-out window for `id`, at the given logical position and
/// inner size. A position that lands on no monitor is dropped and the window is centred:
/// a saved position from a screen that has since been unplugged must not open it off-screen.
///
/// Async on purpose: building a window from a synchronous command deadlocks on Windows (the
/// command runs on the main thread the new webview needs). Same as open_mini_monitor.
#[tauri::command]
pub async fn open_popout_window(
    app: tauri::AppHandle,
    id: String,
    title: String,
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = label(&id)?;
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let w = if width.is_finite() { width.clamp(320.0, 4000.0) } else { 640.0 };
    let h = if height.is_finite() { height.clamp(240.0, 3000.0) } else { 560.0 };
    let title: String = title.chars().filter(|c| !c.is_control()).take(120).collect();
    let title = if title.trim().is_empty() { "BMM".to_string() } else { format!("{} · BMM", title.trim()) };
    let url = tauri::WebviewUrl::App(format!("popout.html?id={id}").into());
    let mut b = tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(title)
        .inner_size(w, h)
        .min_inner_size(320.0, 240.0)
        .resizable(true)
        .decorations(false)
        .shadow(true)
        .focused(true);
    let on_screen = match (x, y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => app
            .get_webview_window("main")
            .and_then(|m| m.available_monitors().ok())
            .map(|ms| ms.iter().any(|m| {
                let s = m.scale_factor();
                let (mx, my) = (m.position().x as f64 / s, m.position().y as f64 / s);
                let (mw, mh) = (m.size().width as f64 / s, m.size().height as f64 / s);
                // The title bar (top 40 px of the window) has to be grabbable on that monitor.
                x + 80.0 > mx && x < mx + mw - 40.0 && y >= my - 4.0 && y < my + mh - 40.0
            }))
            .unwrap_or(false)
            .then_some((x, y)),
        _ => None,
    };
    b = match on_screen {
        Some((x, y)) => b.position(x, y),
        None => b.center(),
    };
    b.build().map(|_| ()).map_err(|e| e.to_string())
}

/// Close the pop-out window for `id`, if open. The main window shows the panel again when it
/// hears CLOSED_EVENT.
#[tauri::command]
pub fn close_popout_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let label = label(&id)?;
    if let Some(w) = app.get_webview_window(&label) { let _ = w.destroy(); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_slugs() {
        assert!(valid_id("theme-editor"));
        assert!(valid_id("sched-debug2"));
        assert!(!valid_id(""));
        assert!(!valid_id("Theme"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("x?id=y"));
        assert!(!valid_id(&"a".repeat(41)));
    }
}
