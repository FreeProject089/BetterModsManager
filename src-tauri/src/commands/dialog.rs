// Native file/folder/confirm dialogs, exposed as invoke commands.
//
// Under Tauri v2 the dialog plugin's JS bindings are NOT injected by
// `withGlobalTauri` (only the core globals are). Rather than vendor the plugin
// JS, the frontend bridge (frontend/src/core/api.ts) routes every dialog through
// these thin Rust wrappers over `tauri_plugin_dialog`. They are plain (sync)
// commands so the blocking_* dialog calls run on Tauri's command thread pool and
// don't block the async runtime.

use tauri_plugin_dialog::DialogExt;

#[derive(serde::Deserialize)]
pub struct DlgFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

fn apply_filters<'a>(
    mut b: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    filters: &'a Option<Vec<DlgFilter>>,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    if let Some(fs) = filters {
        for f in fs {
            let ext: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            b = b.add_filter(&f.name, &ext);
        }
    }
    b
}

#[tauri::command]
pub fn dlg_pick_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn dlg_pick_file(app: tauri::AppHandle, filters: Option<Vec<DlgFilter>>) -> Option<String> {
    let picked = apply_filters(app.dialog().file(), &filters)
        .blocking_pick_file()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned());
    if let Some(p) = &picked {
        remember_picked(p);
    }
    picked
}

/// Files the user chose in this dialog during this session, canonicalised.
///
/// `read_file_base64` is confined to BMM's folders (security summary §9 #16), but a feedback
/// screenshot or a zip the user attaches can live anywhere. A choice made in the native dialog
/// is the user's own, and nothing else can make it (a plugin or an MCP tool cannot click in
/// it), so that one file stays readable. Bounded: past 256 the oldest entry goes first.
static PICKED: std::sync::Mutex<Vec<std::path::PathBuf>> = std::sync::Mutex::new(Vec::new());

pub(crate) fn remember_picked(path: &str) {
    let Ok(c) = std::fs::canonicalize(path) else { return };
    let mut v = PICKED.lock().unwrap_or_else(|p| p.into_inner());
    if !v.contains(&c) {
        if v.len() >= 256 {
            v.remove(0);
        }
        v.push(c);
    }
}

/// Was this (already canonical) path picked in BMM's own file dialog?
pub(crate) fn was_picked(canonical: &std::path::Path) -> bool {
    PICKED.lock().unwrap_or_else(|p| p.into_inner()).iter().any(|p| p == canonical)
}

#[tauri::command]
pub fn dlg_save_file(
    app: tauri::AppHandle,
    default_path: Option<String>,
    filters: Option<Vec<DlgFilter>>,
) -> Option<String> {
    let mut b = app.dialog().file();
    if let Some(dp) = default_path.filter(|s| !s.trim().is_empty()) {
        let pb = std::path::PathBuf::from(&dp);
        if let Some(name) = pb.file_name().and_then(|n| n.to_str()) {
            b = b.set_file_name(name);
        }
        if let Some(dir) = pb.parent().filter(|d| d.is_dir()) {
            b = b.set_directory(dir);
        }
    }
    apply_filters(b, &filters)
        .blocking_save_file()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn dlg_confirm(app: tauri::AppHandle, message: String, title: Option<String>) -> bool {
    use tauri_plugin_dialog::MessageDialogButtons;
    app.dialog()
        .message(message)
        .title(title.unwrap_or_else(|| "Better Mods Manager".into()))
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show()
}
