#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Use mimalloc as the global allocator.  Default Windows HeapAlloc is
// notoriously RSS-hungry once a process makes lots of small string /
// HashMap allocations (BMM holds tens of thousands of path/hash strings).
// mimalloc trims hundreds of MB off the steady-state working set.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod error;
mod archive;
mod commands;
mod fs_utils;
mod models;
mod state;
mod api;

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

/// Open the native WebView2 DevTools on demand (only when the user asks).
/// Works in release too thanks to the tauri "devtools" feature — these used to
/// be #[cfg(debug_assertions)]-gated, which made the button dead in production.
#[tauri::command]
fn open_devtools(window: tauri::Window) {
    window.open_devtools();
}

/// Close the native WebView2 DevTools — frees the heavy DevTools process (the
/// ~480 MB msedgewebview2 "DevTools" process) so it's only resident while open.
#[tauri::command]
fn close_devtools(window: tauri::Window) {
    window.close_devtools();
}

/// Whether the native DevTools window is currently open.
#[tauri::command]
fn is_devtools_open(window: tauri::Window) -> bool {
    window.is_devtools_open()
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
    // Worker subprocess fast-path: do the heavy file IO and exit without
    // booting Tauri, WebView2, or anything else.  Called by the parent BMM
    // as: `bmm.exe --mod-worker <in.json> <out.json>`.
    {
        let argv: Vec<String> = std::env::args().collect();
        if argv.len() >= 4 && argv[1] == "--mod-worker" {
            let code = fs_utils::run_mod_worker(&argv[2], &argv[3]);
            std::process::exit(code);
        }
    }

    // ── WebView2 RAM trims ───────────────────────────────────────────────
    // Set BEFORE WebView2 starts.  Cuts ~50-150MB off the WebView2 footprint
    // by disabling features BMM doesn't use:
    //   - AudioServiceOutOfProcess: kills the dedicated audio utility process
    //   - extensions / background pages: BMM has no Chrome extensions
    //   - Translate / sync / default apps: useless browser-only features
    //   - background-networking: no telemetry pings
    //   - renderer-process-limit=2: cap renderer/subframe processes
    if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_err() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-features=AudioServiceOutOfProcess,Translate,BackgroundNetworking,InterestFeedContentSuggestions \
             --disable-extensions \
             --disable-component-extensions-with-background-pages \
             --disable-default-apps \
             --disable-background-networking \
             --disable-sync \
             --no-pings \
             --renderer-process-limit=2 \
             --disable-component-update",
        );
    }

    // Prevent Rayon from hogging 100% CPU and lagging the OS.  Cap thread
    // count AND shrink each rayon worker's stack from the default 8MB down
    // to 512KB — BMM's parallel work (file copy / hashing) never recurses
    // deep, so 512KB is plenty and saves ~7MB of committed RSS per thread.
    let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let threads = if cpus > 6 { cpus - 2 } else if cpus > 2 { cpus - 1 } else { 2 };
    let _ = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .stack_size(512 * 1024)
        .build_global();

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
                // Clean up any tutorial demo data left over from a previous session
                // (e.g. BMM closed mid-tutorial before cleanup could run).
                crate::commands::tutorial_demo::purge_tutorial_demo(&mut data);
            }
            let _ = app_state.save();

            app.manage(app_state);
            app.manage(crate::commands::repo_server::RepoServerState::default());
            
            let state_handle = app.state::<AppState>();
            commands::mods::start_sha_calculation_background(app.handle());
            commands::mods::populate_sha_queue(state_handle);
            commands::mods::start_content_id_background(app.handle());
            
            let _ = commands::ban_manager::load_bans(&app.handle());
            let _ = commands::whitelist_manager::load_whitelist(&app.handle());
            let _ = commands::discord::init_discord_rpc(app.state::<AppState>(), app.handle());

            // Start local HTTP Plugin API on port 51274
            {
                let state_ref = app.state::<AppState>();
                let data_arc = state_ref.data.clone();
                let data_path = state_ref.data_path.clone();
                let creator_id = std::sync::Arc::new(
                    commands::security::get_creator_id(app.handle()).unwrap_or_default()
                );
                let (tx, rx) = tokio::sync::oneshot::channel::<()>();
                {
                    *state_ref.api_shutdown_tx.lock().unwrap() = Some(tx);
                }
                let api_handle = app.handle();
                tauri::async_runtime::spawn(async move {
                    crate::api::start_api_server(data_arc, data_path, creator_id, rx, api_handle).await;
                });
            }

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
                
                // Add this marker so the crash logger knows it was a clean exit even if the thread is killed
                commands::crash::log_line("[SHUTDOWN] Clean exit requested via window manager (Alt+F4/Close).");
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
            commands::mods::get_mods_all_profiles,
            commands::mods::get_mod_hashes,
            commands::mods::find_local_mods_by_hashes,
            commands::mods::flush_mem_caches,
            commands::mods::add_mod,
            commands::mods::remove_mod,
            commands::mods::enable_mod,
            commands::mods::disable_mod,
            commands::mods::disable_mods_for_profiles,
            commands::mods::update_mod_meta,
            commands::mods::scan_mods_folder,
            commands::mods::download_mod,
            commands::mods::install_from_modlist,
            commands::mods::cancel_install_from_modlist,
            commands::mods::verify_integrity,
            commands::modlist::export_modlist,
            commands::modlist::import_modlist,
            commands::modlist::cancel_export_modlist,
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
            commands::history::clear_activity_history,
            commands::settings::export_app_data,
            commands::settings::import_app_data,
            commands::settings::factory_reset,
            commands::settings::reset_app_data,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::apply_fs_security_mode_command,
            commands::settings::is_debug_mode,
            commands::settings::is_dev_build,
            commands::settings::is_fsdm_mode,
            commands::settings::is_ptb_mode,
            commands::settings::is_update_disabled,
            commands::settings::is_auto_eula_enabled,
            commands::settings::get_quicklinks_config,
            commands::settings::get_license_text,
            commands::settings::get_eula_text,
            commands::settings::get_privacy_text,
            commands::settings::get_app_version,
            commands::settings::get_build_date,
            commands::settings::get_available_languages,
            commands::settings::get_language_content,
            commands::settings::find_i18n_usages,
            commands::settings::find_hardcoded_strings,
            commands::settings::get_i18n_key_kinds,
            commands::settings::create_language_file,
            commands::settings::delete_language_file,
            commands::settings::get_all_languages_content,
            commands::settings::import_language,
            commands::settings::import_language_data,
            commands::settings::get_resource_debug_info,
            commands::settings::get_tutorial_assets_path,
            commands::settings::export_tutorial_assets,
            commands::settings::exit_app,
            commands::mods::open_folder,
            commands::mods::open_file,
            commands::mods::open_mod_folder_at,
            commands::mods::open_mod_file_at,
            commands::mods::toggle_all_mods,
            commands::mods::check_conflicts,
            commands::mods::get_mod_conflicts,
            commands::mods::get_all_mod_conflicts,
            commands::scheduler::get_schedules,
            commands::scheduler::save_schedules,
            commands::scheduler::run_scheduled_command,
            commands::scheduler::is_process_running,
            commands::scheduler::path_exists,
            commands::scheduler::register_os_schedule,
            commands::scheduler::unregister_os_schedule,
            commands::analytics::get_analytics_consent,
            commands::analytics::set_analytics_consent,
            commands::analytics::analytics_system_profile,
            commands::analytics::analytics_track,
            commands::analytics::analytics_flush,
            commands::analytics::analytics_export,
            commands::analytics::analytics_clear,
            commands::analytics::analytics_sent_packets,
            commands::analytics::analytics_request_deletion,
            commands::analytics::analytics_clear_sent_log,
            commands::analytics::replay_asset_data_url,
            commands::analytics::save_local_replay,
            commands::analytics::delete_local_replay,
            commands::mods::get_conflict_file_tree,
            commands::mods::list_mod_files_recursive,
            commands::mods::path_join,
            commands::mods::check_mod_metadata,
            commands::mods::open_mod_active_folder,
            commands::mods::open_mod_backup_folder,
            commands::mods::open_active_game_folder,
            commands::mods::get_mod_integrity,
            commands::mods::update_mod_hashes,
            commands::mods::delete_mod_hashes,
            commands::mods::get_hashing_stats,
            commands::mods::recalculate_all_hashes,
            commands::mods::recalculate_mod_sha,
            commands::mods::trigger_sha_background_population,
            commands::mods::cancel_mod_ops,
            commands::mods::clear_mod_op_cancel,
            commands::mods::kill_current_mod_op,
            commands::resource_tracker::get_resource_records,
            commands::resource_tracker::clear_resource_records,
            commands::crash::open_crash_folder,
            commands::image::crop_and_save_webp,
            commands::image::remove_profile_background,
            commands::image::get_profile_background_path,
            commands::image::apply_profile_background,
            commands::image::import_profile_icon,
            commands::image::remove_profile_icon,
            commands::image::get_profile_icon_path,
            commands::crash::open_crash_zip,
            commands::crash::get_crash_reports,
            commands::crash::trigger_manual_crash_report,
            commands::crash::log_frontend_line,
            commands::crash::read_session_log_tail,
            commands::crash::append_api_log,
            commands::crash::read_api_log,
            commands::crash::clear_api_log,
            commands::tutorial_demo::tutorial_setup_demo,
            commands::tutorial_demo::tutorial_cleanup_demo,
            commands::repo_server::set_repo_busy,
            commands::crash::get_startup_status,
            commands::autoupdate::check_for_update,
            commands::autoupdate::download_and_install_update,
            commands::autoupdate::fetch_update_manifest,
            commands::autoupdate::apply_incremental_update,
            commands::benchmark::is_benchmark_enabled,
            commands::benchmark::set_advanced_benchmark_mode,
            commands::benchmark::start_benchmark,
            commands::benchmark::stop_benchmark,
            commands::benchmark::export_benchmark_csv,
            commands::benchmark::run_app_benchmark,
            commands::benchmark::cancel_app_benchmark,
            commands::benchmark::read_file_text,
            commands::disk::get_system_disks,
            commands::disk::set_disk_limit,
            commands::disk::benchmark_disk,
            commands::disk::check_disk_space,
            commands::disk::get_folder_size,
            commands::repo::export_server_repo,
            commands::repo::update_server_repo,
            commands::repo::read_local_repo,
            commands::repo::check_mod_updates,
            commands::repo::set_mod_update_config,
            commands::repo::apply_direct_update,
            commands::repo::scan_repo_hub,
            commands::repo::generate_repo_hub,
            commands::repo::get_profile_mod_list,
            commands::repo::cancel_repo_export,
            commands::repo::generate_standalone_server,
            commands::repo::fetch_repo_info,
            commands::repo::sync_server_repo,
            commands::repo::cancel_repo_sync,
            commands::repo::pause_repo_sync,
            commands::repo::resume_repo_sync,
            commands::omm::import_omm_profile,
            commands::launch_pack::get_launch_packs,
            commands::launch_pack::create_launch_pack,
            commands::launch_pack::update_launch_pack,
            commands::launch_pack::run_launch_pack,
            commands::launch_pack::delete_launch_pack,
            commands::launch_pack::open_launch_pack_folder,
            commands::launch_pack::scan_dir_for_exe,
            commands::launch_pack::scan_installed_apps,
            commands::launch_pack::extract_exe_icon,
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
            // commands::debug::get_project_files and read_project_file
            // were removed with the Sources tab — see debug-ui.ts.
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
            open_devtools,
            close_devtools,
            is_devtools_open,
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
            crate::commands::mapper::open_game_item_in_explorer,
            crate::commands::mapper::create_mod_folder,
            crate::commands::mapper::rename_mod_item,
            commands::plugins::fetch_plugin_catalog,
            commands::plugins::install_plugin,
            commands::plugins::install_plugin_from_file,
            commands::plugins::uninstall_plugin,
            commands::plugins::toggle_plugin,
            commands::plugins::get_installed_plugins,
            commands::plugins::compare_plugin_mods,
            commands::plugins::apply_plugin_modlist,
            commands::plugins::set_plugin_permissions,
            commands::plugins::get_plugin_permissions,
            commands::plugins::get_api_token,
            commands::plugins::get_effective_api_port,
            commands::plugins::restart_api_server,
            commands::plugins::create_plugin_token,
            commands::plugins::revoke_plugin_token,
            commands::plugins::list_plugin_tokens,
            commands::plugins::reset_api_token,
            commands::plugins::generate_script,
            commands::plugins::export_plugin,
            commands::plugins::write_text_file,
            commands::plugins::write_zip_files,
            commands::plugins::get_app_exe_path,
            commands::plugins::create_local_plugin,
            commands::plugins::run_plugin_scripts,
            commands::plugins::open_plugin_folder,
            commands::plugins::compute_plugin_checksum,
            commands::apps::fetch_app_catalogs,
            commands::apps::install_app,
            commands::apps::detect_app_executables,
            commands::apps::launch_app,
            commands::apps::list_app_executables,
            commands::apps::set_app_main_exe,
            commands::apps::get_apps_state,
            commands::apps::uninstall_app,
            commands::apps::toggle_app_favorite,
            commands::apps::add_community_source,
            commands::apps::remove_community_source,
            commands::apps::get_default_apps_path,
            commands::apps::set_app_exe_path,
            commands::apps::open_app_folder,
            commands::apps::clear_app_history,
            commands::apps::register_installed_exe,
            commands::apps::app_has_uninstaller,
            commands::apps::scan_and_track_running_apps,
            // ── Themes ──────────────────────────────────────────────────────
            commands::themes::list_installed_themes,
            commands::themes::list_builtin_themes,
            commands::themes::list_builtin_themes_all,
            commands::themes::get_hidden_builtins,
            commands::themes::set_builtin_hidden,
            commands::themes::get_active_theme,
            commands::themes::set_active_theme,
            commands::themes::install_theme,
            commands::themes::delete_theme,
            commands::themes::import_theme,
            commands::themes::export_theme,
            commands::themes::fetch_theme_catalogs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
