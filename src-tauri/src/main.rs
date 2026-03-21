#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod fs_utils;
mod models;
mod state;

use state::AppState;
use std::path::PathBuf;
use tauri::Manager;
use commands::settings::*;

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
            
            let app_state = AppState::load(data_path);
            
            // Comprehensive State Dump for Diagnostics
            {
                {
                    let mut data = app_state.data.lock().unwrap();
                    commands::crash::log_line(format!("[STARTUP] BMM v{} initialized.", env!("CARGO_PKG_VERSION")));
                    
                    // Capture previous state for UI
                    app_state.previous_session_clean.store(data.settings.last_session_clean, std::sync::atomic::Ordering::SeqCst);
                    
                    // Set dirty flag: if we crash, this stays false
                    data.settings.last_session_clean = false;
                }
                // Lock released here, now it's safe to save
                let _ = app_state.save();

                let data = app_state.data.lock().unwrap();
                commands::crash::log_line(format!("[STARTUP-INFO] Profile Count: {}", data.profiles.len()));
                
                // Track paths to detect collisions
                let mut mods_folders: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
                let mut game_folders: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();

                for p in &data.profiles {
                    commands::crash::log_line(format!("  [PROFILE] {} (ID: {})", p.name, p.id));
                    commands::crash::log_line(format!("    - Icon: {:?}", p.icon));
                    commands::crash::log_line(format!("    - Background: {:?}", p.background_image));
                    commands::crash::log_line(format!("    - Game Path: {:?}", p.game_path));
                    commands::crash::log_line(format!("    - Mods Path: {:?}", p.mods_path));
                    commands::crash::log_line(format!("    - Backup Path: {:?}", p.backup_path));
                    commands::crash::log_line(format!("    - Active Mods: {}", p.active_mods.len()));

                    // Collect for collision analysis (normalized lowercase strings)
                    let m_path = p.mods_path.to_string_lossy().to_lowercase().trim_end_matches(['/', '\\']).to_string();
                    let g_path = p.game_path.to_string_lossy().to_lowercase().trim_end_matches(['/', '\\']).to_string();
                    
                    if !m_path.is_empty() {
                        mods_folders.entry(m_path).or_default().push(p.name.clone());
                    }
                    if !g_path.is_empty() {
                        game_folders.entry(g_path).or_default().push(p.name.clone());
                    }
                }

                // Path Collision Analysis
                for (path, profiles) in mods_folders {
                    if profiles.len() > 1 {
                        commands::crash::log_line(format!("[WARNING] SHARED MODS FOLDER DETECTED: '{}' is used by {} profiles: {:?}", path, profiles.len(), profiles));
                    }
                }
                for (path, profiles) in game_folders {
                    if profiles.len() > 1 {
                        commands::crash::log_line(format!("[WARNING] SHARED GAME FOLDER DETECTED: '{}' is used by {} profiles: {:?}", path, profiles.len(), profiles));
                    }
                }

                commands::crash::log_line(format!("[STARTUP-INFO] Total Mod Registry Count: {}", data.mods.len()));
                if let Some(active_id) = &data.active_profile_id {
                    if let Some(active_profile) = data.profiles.iter().find(|p| &p.id == active_id) {
                        commands::crash::log_line(format!("[STARTUP-INFO] Active Profile: {} ({} mods enabled)", active_profile.name, active_profile.active_mods.len()));
                        for mod_id in &active_profile.active_mods {
                            if let Some(m) = data.mods.iter().find(|m| &m.id == mod_id) {
                                commands::crash::log_line(format!("    - Enabled Mod: {} (ID: {})", m.name, m.id));
                            }
                        }
                    }
                }
                commands::crash::log_line(format!("[STARTUP-INFO] App Settings: Filter: {}, Sort: {}, Lang: {}", 
                    data.settings.current_filter, data.settings.current_sort_by, data.settings.language));

                // Add resource diagnostic dump
                let debug_info = get_resource_debug_info(app.handle());
                commands::crash::log_line("[STARTUP-DIAGNOSTIC] Resource Resolution Report:");
                for line in debug_info.lines() {
                    commands::crash::log_line(format!("  {}", line));
                }
            }

            app.manage(app_state);
            app.manage(crate::commands::repo_server::RepoServerState::default());

            Ok(())
        })
        // 2. Capture de la fermeture (Alt+F4 / Croix)
        // Intercept to generate a session report before the process is killed.
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                // Si on ferme déjà, on ne fait rien (évite la récursion de window.close())
                if commands::crash::is_shutting_down() {
                    return;
                }

                api.prevent_close();
                let window = event.window().clone();
                let state = window.state::<AppState>();

                // 1. Marquer immédiatement le shutdown (bloque les écritures ultérieures)
                commands::crash::log_line("[SHUTDOWN] Window close-requested event received. Marking as shutting down...");
                commands::crash::set_shutting_down();

                // 2. Capture current state for diagnostic
                let state_snapshot = {
                    let mut data = state.data.lock().ok();
                    if let Some(ref mut d) = data {
                        // Mark clean for the next time
                        d.settings.last_session_clean = true;
                    }
                    data.and_then(|d| serde_json::to_string_pretty(&*d).ok())
                };
                let _ = state.save();

                // 3. Thread de sauvegarde du rapport (évite de bloquer l'event loop)
                std::thread::spawn(move || {
                    commands::crash::log_line("[SHUTDOWN] Thread: Generating session report...");
                    let _ = commands::crash::generate_report(
                        false, // false = Session Zip
                        "Clean Exit (Window Close / Alt+F4)", 
                        state_snapshot,
                        None,
                        None
                    );
                    commands::crash::log_line("[SHUTDOWN] Thread: Done. Closing window.");
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
            commands::mods::get_all_mods,
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
            export_app_data,
            import_app_data,
            reset_app_data,
            get_settings,
            update_settings,
            is_debug_mode,
            is_fsdm_mode,
            is_ptb_mode,
            is_update_disabled,
            get_license_text,
            get_app_version,
            get_build_date,
            get_available_languages,
            get_language_content,
            import_language,
            get_resource_debug_info,
            // ... (other commands)
            commands::mods::open_folder,
            commands::mods::open_file,
            commands::mods::open_mod_folder_at,
            commands::mods::open_mod_file_at,
            commands::mods::toggle_all_mods,
            commands::mods::check_conflicts,
            commands::mods::get_mod_conflicts,
            commands::mods::get_conflict_file_tree,
            commands::mods::list_mod_files_recursive,
            commands::mods::path_join,
            commands::mods::check_mod_metadata,
            // Crash Advanced
            commands::crash::open_crash_folder,
            // Image
            commands::image::crop_and_save_webp,
            commands::image::remove_profile_background,
            commands::image::get_profile_background_path,
            commands::image::apply_profile_background,
            commands::crash::open_crash_zip,
            commands::crash::get_crash_reports,
            commands::crash::trigger_manual_crash_report,
            commands::crash::log_frontend_line,
            commands::crash::get_startup_status,
            // Auto Update
            commands::autoupdate::check_for_update,
            commands::autoupdate::download_and_install_update,
            // Benchmark
            commands::benchmark::is_benchmark_enabled,
            commands::benchmark::start_benchmark,
            commands::benchmark::stop_benchmark,
            commands::benchmark::export_benchmark_csv,
            // Disk Limiter
            commands::disk::get_system_disks,
            commands::disk::set_disk_limit,
            commands::disk::benchmark_disk,
            commands::disk::check_disk_space,
            // Server Repo
            commands::repo::export_server_repo,
            commands::repo::generate_standalone_server,
            commands::repo::fetch_repo_info,
            commands::repo::sync_server_repo,
            commands::repo::cancel_repo_sync,
            commands::repo::pause_repo_sync,
            commands::repo::resume_repo_sync,
            // OMM
            commands::omm::import_omm_profile,
            commands::omm::auto_import_omm,
            // Repo Server
            commands::repo_server::start_repo_server,
            commands::repo_server::stop_repo_server,
            commands::repo_server::get_repo_server_status,
            commands::security::get_creator_id,
            commands::security::verify_repo_signature,
            commands::crash::finalize_and_close_app,
            commands::debug::get_project_files,
            commands::debug::read_project_file,
            commands::debug::get_debug_stats,
            commands::debug::get_rust_logs,
            commands::window::start_resizing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
