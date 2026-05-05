#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod commands;
mod fs_utils;
mod models;
mod state;

use state::AppState;
use std::path::PathBuf;
use winreg::enums::*;
use winreg::RegKey;
use tauri::Manager;
use std::sync::Mutex;
use tracing::info;

lazy_static::lazy_static! {
    static ref PENDING_DEEP_LINK: Mutex<Option<String>> = Mutex::new(None);
}

#[tauri::command]
fn get_pending_deep_link() -> Option<String> {
    PENDING_DEEP_LINK.lock().unwrap().take()
}

fn register_bmm_protocol() -> Result<(), Box<dyn std::error::Error>> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = "Software\\Classes\\bmm";
    let (key, _) = hkcu.create_subkey(path)?;
    key.set_value("", &"URL:bmm Protocol")?;
    key.set_value("URL Protocol", &"")?;

    let (shell_key, _) = key.create_subkey("shell\\open\\command")?;
    let exe_path = std::env::current_exe()?;
    let exe_str = exe_path.to_string_lossy();
    let command = format!("\"{}\" \"%1\"", exe_str);
    shell_key.set_value("", &command)?;

    Ok(())
}

pub fn apply_fs_security_mode(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    let (mode, profiles) = {
        let data = state.data.lock().unwrap();
        (data.settings.fs_security_mode.clone(), data.profiles.clone())
    };

    if let Some(m) = mode {
        if m == "full" {
            commands::crash::log_line("[SECURITY] Applying FULL FS Access Mode.");
            let disks = sysinfo::Disks::new_with_refreshed_list();
            for disk in disks.iter() {
                let mount = disk.mount_point();
                let _ = app.fs_scope().allow_directory(mount, true);
                let _ = app.asset_protocol_scope().allow_directory(mount, true);
            }
        } else {
            commands::crash::log_line("[SECURITY] Applying LIMITED FS Access Mode.");
            for p in profiles {
                if p.game_path.exists() {
                    let _ = app.fs_scope().allow_directory(&p.game_path, true);
                    let _ = app.asset_protocol_scope().allow_directory(&p.game_path, true);
                }
                if p.mods_path.exists() {
                    let _ = app.fs_scope().allow_directory(&p.mods_path, true);
                    let _ = app.asset_protocol_scope().allow_directory(&p.mods_path, true);
                }
                if p.backup_path.exists() {
                    let _ = app.fs_scope().allow_directory(&p.backup_path, true);
                    let _ = app.asset_protocol_scope().allow_directory(&p.backup_path, true);
                }
            }
        }
    }
}

fn main() {
    // Prevent Rayon from hogging 100% CPU and lagging the OS
    let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let threads = if cpus > 6 { cpus - 2 } else if cpus > 2 { cpus - 1 } else { 2 };
    let _ = rayon::ThreadPoolBuilder::new().num_threads(threads).build_global();

    tracing_subscriber::fmt::init();
    info!("Starting Better Mods Manager...");
    commands::crash::setup_panic_hook();
    commands::crash::init_session();
    let _ = register_bmm_protocol();

    let args: Vec<String> = std::env::args().collect();
    if let Some(link) = args.iter().find(|arg| arg.starts_with("bmm://")).cloned() {
        *PENDING_DEEP_LINK.lock().unwrap() = Some(link);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(link) = args.iter().find(|arg| arg.starts_with("bmm://")).cloned() {
                let _ = app.emit_all("deep-link-received", link);
            }
            if let Some(window) = app.get_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .setup(|app| {
            let app_dir = app.path_resolver().app_data_dir().unwrap_or_else(|| PathBuf::from("."));
            let data_path = app_dir.join("data.json");
            let app_state = AppState::load(data_path);
            
            {
                let mut data = app_state.data.lock().unwrap();
                app_state.previous_session_clean.store(data.settings.last_session_clean, std::sync::atomic::Ordering::SeqCst);
                data.settings.last_session_clean = false;
            }
            let _ = app_state.save();

            app.manage(app_state);
            app.manage(crate::commands::repo_server::RepoServerState::default());
            
            let state_handle = app.state::<AppState>();
            commands::mods::start_sha_calculation_background(state_handle.clone());
            commands::mods::populate_sha_queue(state_handle);
            
            let _ = commands::ban_manager::load_bans(&app.handle());
            let _ = commands::whitelist_manager::load_whitelist(&app.handle());
            let _ = commands::discord::init_discord_rpc(app.state::<AppState>());

            if let Some(link) = PENDING_DEEP_LINK.lock().unwrap().clone() {
                let _ = app.emit_all("deep-link-received", link);
            }
            
            apply_fs_security_mode(app.handle());
            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                if commands::crash::is_shutting_down() { return; }
                api.prevent_close();
                let window = event.window().clone();
                let state = window.state::<AppState>();
                commands::crash::set_shutting_down();

                let state_snapshot = {
                    let mut data = state.data.lock().ok();
                    if let Some(ref mut d) = data { d.settings.last_session_clean = true; }
                    data.and_then(|d| serde_json::to_string_pretty(&*d).ok())
                };
                let _ = state.save();

                std::thread::spawn(move || {
                    let _ = commands::crash::generate_report(false, "Clean Exit", state_snapshot, None, None);
                    let _ = window.close();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::profile::get_profiles,
            commands::profile::get_active_profile_id,
            commands::profile::set_active_profile,
            commands::profile::create_profile,
            commands::profile::update_profile,
            commands::profile::delete_profile,
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
            commands::modlist::export_modlist,
            commands::modlist::import_modlist,
            commands::modlist::add_download_link,
            commands::modlist::remove_download_link,
            commands::ovgme::import_ovgme_profiles,
            commands::update::get_update_notes,
            commands::update::get_old_updates_count,
            commands::update::get_update_folder_structure,
            commands::tag::get_tags,
            commands::tag::create_tag,
            commands::tag::delete_tag,
            commands::history::get_activity_history,
            commands::settings::export_app_data,
            commands::settings::import_app_data,
            commands::settings::reset_app_data,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::apply_fs_security_mode_command,
            commands::settings::is_debug_mode,
            commands::settings::is_fsdm_mode,
            commands::settings::is_ptb_mode,
            commands::settings::is_update_disabled,
            commands::settings::is_auto_eula_enabled,
            commands::settings::get_license_text,
            commands::settings::get_eula_text,
            commands::settings::get_app_version,
            commands::settings::get_build_date,
            commands::settings::get_available_languages,
            commands::settings::get_language_content,
            commands::settings::import_language,
            commands::settings::get_resource_debug_info,
            commands::settings::exit_app,
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
            commands::mods::open_mod_active_folder,
            commands::mods::open_mod_backup_folder,
            commands::mods::get_mod_integrity,
            commands::mods::update_mod_hashes,
            commands::crash::open_crash_folder,
            commands::image::crop_and_save_webp,
            commands::image::remove_profile_background,
            commands::image::get_profile_background_path,
            commands::image::apply_profile_background,
            commands::crash::open_crash_zip,
            commands::crash::get_crash_reports,
            commands::crash::trigger_manual_crash_report,
            commands::crash::log_frontend_line,
            commands::crash::get_startup_status,
            commands::autoupdate::check_for_update,
            commands::autoupdate::download_and_install_update,
            commands::benchmark::is_benchmark_enabled,
            commands::benchmark::start_benchmark,
            commands::benchmark::stop_benchmark,
            commands::benchmark::export_benchmark_csv,
            commands::disk::get_system_disks,
            commands::disk::set_disk_limit,
            commands::disk::benchmark_disk,
            commands::disk::check_disk_space,
            commands::repo::export_server_repo,
            commands::repo::cancel_repo_export,
            commands::repo::generate_standalone_server,
            commands::repo::fetch_repo_info,
            commands::repo::sync_server_repo,
            commands::repo::cancel_repo_sync,
            commands::repo::pause_repo_sync,
            commands::repo::resume_repo_sync,
            commands::omm::import_omm_profile,
            commands::omm::auto_import_omm,
            commands::repo_server::start_repo_server,
            commands::repo_server::stop_repo_server,
            commands::repo_server::get_repo_server_status,
            commands::repo_server::get_connected_clients,
            commands::repo_server::get_active_downloads,
            commands::security::get_creator_id,
            commands::security::get_salted_creator_id,
            commands::security::verify_repo_signature,
            commands::crash::finalize_and_close_app,
            commands::disk::read_file_base64,
            commands::debug::get_project_files,
            commands::debug::read_project_file,
            commands::debug::get_debug_stats,
            commands::debug::get_rust_logs,
            commands::window::start_resizing,
            commands::ban_manager::ban_user,
            commands::ban_manager::unban_user,
            commands::ban_manager::unban_all,
            commands::ban_manager::unban_bulk,
            commands::ban_manager::get_ban_list,
            commands::whitelist_manager::toggle_whitelist,
            commands::whitelist_manager::add_to_whitelist,
            commands::whitelist_manager::remove_from_whitelist,
            commands::whitelist_manager::get_whitelist,
            commands::whitelist_manager::clear_whitelist,
            commands::discord::init_discord_rpc,
            commands::discord::set_discord_presence,
            get_pending_deep_link,
            commands::crash::get_dxdiag_report,
            commands::crash::list_crash_reports,
            commands::modpack::save_modpack,
            commands::modpack::load_modpacks,
            commands::modpack::get_modpack_by_id,
            commands::modpack::delete_modpack,
            commands::modpack::build_modpack_mod_ref,
            commands::modpack::export_modpack,
            commands::modpack::import_modpack,
            commands::modpack::check_modpack_integrity,
            commands::modpack::repair_modpack_mod,
            crate::commands::mapper::get_directory_tree,
            crate::commands::mapper::restructure_mod_item,
            crate::commands::mapper::delete_mod_item,
            crate::commands::mapper::open_item_in_explorer,
            crate::commands::mapper::create_mod_folder,
            crate::commands::mapper::rename_mod_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
