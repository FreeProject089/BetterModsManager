#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod fs_utils;
mod models;
mod state;

use state::AppState;
use std::path::PathBuf;
use tauri::Manager;

fn main() {
    // 1. Initialise le gestionnaire de crash dès le démarrage (Expert Mode)
    commands::crash::setup_panic_hook();
    commands::crash::init_session();

    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path_resolver()
                .app_data_dir()
                .unwrap_or_else(|| PathBuf::from("."));
            let data_path = app_dir.join("data.json");
            app.manage(AppState::load(data_path));

            // Log du démarrage
            commands::crash::log_line(format!(
                "[STARTUP] Better Mod Manager v{} initializing system...",
                env!("CARGO_PKG_VERSION")
            ));

            Ok(())
        })
        // 2. Capture de la fermeture (Alt+F4 / Croix)
        // On intercepte pour générer un rapport de session avant que le processus ne soit tué.
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                api.prevent_close();

                let window = event.window().clone();
                let state = window.state::<AppState>();

                // Capture de l'état actuel pour le diagnostic
                let state_snapshot = state.data.lock().ok().and_then(|d| serde_json::to_string_pretty(&*d).ok());

                commands::crash::log_line("[SHUTDOWN] Window close-requested. Generating session report...");

                // Thread de sauvegarde rapide du rapport de session
                std::thread::spawn(move || {
                    commands::crash::generate_report(
                        false, 
                        "User requested close (Alt+F4 / Window X)", 
                        state_snapshot,
                        None
                    );
                    let _ = window.close();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Profile commands
            commands::profile::get_profiles,
            commands::profile::get_active_profile_id,
            commands::profile::set_active_profile,
            commands::profile::create_profile,
            commands::profile::update_profile,
            commands::profile::delete_profile,
            // Mod commands
            commands::mods::get_mods,
            commands::mods::add_mod,
            commands::mods::remove_mod,
            commands::mods::enable_mod,
            commands::mods::disable_mod,
            commands::mods::update_mod_meta,
            commands::mods::scan_mods_folder,
            commands::mods::download_mod,
            commands::mods::install_from_modlist,
            commands::mods::cancel_install_from_modlist,
            commands::mods::verify_integrity,
            // Mod list commands
            commands::modlist::export_modlist,
            commands::modlist::import_modlist,
            commands::modlist::add_download_link,
            commands::modlist::remove_download_link,
            // OvGME
            commands::ovgme::import_ovgme_profiles,
            // Update notes
            commands::update::get_update_notes,
            commands::update::get_old_updates_count,
            // Tags
            commands::tag::get_tags,
            commands::tag::create_tag,
            commands::tag::delete_tag,
            // History
            commands::history::get_activity_history,
            // Settings
            commands::settings::export_app_data,
            commands::settings::import_app_data,
            commands::settings::reset_app_data,
            commands::settings::is_debug_mode,
            commands::settings::is_ptb_mode,
            commands::settings::is_update_disabled,
            commands::settings::get_ptb_notes,
            commands::settings::get_license_text,
            commands::settings::get_app_version,
            commands::mods::open_folder,
            commands::mods::open_file,
            commands::mods::open_mod_folder_at,
            commands::mods::open_mod_file_at,
            commands::mods::toggle_all_mods,
            commands::mods::check_conflicts,
            commands::mods::list_mod_files_recursive,
            // Crash Advanced
            commands::crash::open_crash_folder,
            commands::crash::open_crash_zip,
            commands::crash::get_crash_reports,
            commands::crash::trigger_manual_crash_report,
            commands::crash::log_frontend_line,
            // Auto Update
            commands::autoupdate::check_for_update,
            commands::autoupdate::download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
