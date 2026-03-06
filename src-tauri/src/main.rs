#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod fs_utils;
mod models;
mod state;

use state::AppState;
use std::path::PathBuf;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path_resolver()
                .app_data_dir()
                .unwrap_or_else(|| PathBuf::from("."));
            let data_path = app_dir.join("data.json");
            app.manage(AppState::load(data_path));
            Ok(())
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
            commands::settings::get_license_text,
            commands::settings::get_app_version,
            commands::mods::open_folder,
            commands::mods::open_file,
            commands::mods::open_mod_folder_at,
            commands::mods::open_mod_file_at,
            commands::mods::toggle_all_mods,
            commands::mods::check_conflicts,
            commands::mods::list_mod_files_recursive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
