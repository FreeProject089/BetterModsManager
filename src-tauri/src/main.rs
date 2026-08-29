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

use tauri::Emitter;
use tauri_plugin_fs::FsExt;
use state::AppState;
use std::path::PathBuf;
use winreg::enums::*;
use winreg::RegKey;
use tauri::Manager;
use std::sync::Mutex;
use tracing::info;

lazy_static::lazy_static! {
    static ref PENDING_DEEP_LINK: Mutex<Option<String>> = Mutex::new(None);
    /// A .bmmscript double-clicked while BMM was closed. Same reason as the deep link
    /// above: emitting before the window exists loses the event.
    static ref PENDING_SCRIPT_FILE: Mutex<Option<String>> = Mutex::new(None);
}

#[tauri::command]
fn get_pending_deep_link() -> Option<String> {
    PENDING_DEEP_LINK.lock().unwrap().take()
}

#[tauri::command]
fn get_pending_script_file() -> Option<String> {
    PENDING_SCRIPT_FILE.lock().unwrap().take()
}

/// Open the native WebView2 DevTools on demand (only when the user asks).
/// Works in release too thanks to the tauri "devtools" feature — these used to
/// be #[cfg(debug_assertions)]-gated, which made the button dead in production.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// Close the native WebView2 DevTools — frees the heavy DevTools process (the
/// ~480 MB msedgewebview2 "DevTools" process) so it's only resident while open.
#[tauri::command]
fn close_devtools(window: tauri::WebviewWindow) {
    window.close_devtools();
}

/// Whether the native DevTools window is currently open.
#[tauri::command]
fn is_devtools_open(window: tauri::WebviewWindow) -> bool {
    window.is_devtools_open()
}

/// Claim the `bmm://` URL scheme for THIS executable.
///
/// This used to overwrite the registration unconditionally on every start, which meant the last
/// BMM to run owned the protocol — including a build run once out of %TEMP% to test an installer.
/// When that folder was later cleaned up, the registry kept pointing at an executable that no
/// longer existed, so every `bmm://` link in the browser did nothing at all, silently, with no
/// way for the real install to take the scheme back.
///
/// Two rules fix that:
///   · a copy running from a temporary directory never claims the scheme — it has no stable home
///     and cannot honour the registration past the next cleanup;
///   · a registration whose target has gone missing is always taken over, so the case above heals
///     itself the next time a real install starts.
fn register_bmm_protocol() -> Result<(), Box<dyn std::error::Error>> {
    let exe_path = std::env::current_exe()?;

    // Is this copy running from a throwaway location?
    let in_temp = std::env::temp_dir()
        .canonicalize()
        .ok()
        .and_then(|tmp| {
            exe_path
                .canonicalize()
                .ok()
                .map(|exe| exe.starts_with(&tmp))
        })
        .unwrap_or(false);

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = "Software\\Classes\\bmm";

    // What is registered right now, and does it still exist?
    let current: Option<String> = hkcu
        .open_subkey(format!("{path}\\shell\\open\\command"))
        .ok()
        .and_then(|k| k.get_value::<String, _>("").ok());
    let current_target_missing = match &current {
        // The value is `"<exe>" "%1"`; the path is what sits between the first pair of quotes.
        Some(cmd) => cmd
            .split('"')
            .nth(1)
            .map(|p| !std::path::Path::new(p).exists())
            .unwrap_or(true),
        None => true,
    };

    if in_temp && !current_target_missing {
        commands::crash::log_line(
            "[DEEPLINK] running from a temp directory — leaving the bmm:// registration alone",
        );
        return Ok(());
    }

    let exe_str = exe_path.to_string_lossy();
    let command = format!("\"{}\" \"%1\"", exe_str);
    if current.as_deref() == Some(command.as_str()) {
        return Ok(()); // already ours, nothing to write
    }

    let (key, _) = hkcu.create_subkey(path)?;
    key.set_value("", &"URL:bmm Protocol")?;
    key.set_value("URL Protocol", &"")?;
    let (shell_key, _) = key.create_subkey("shell\\open\\command")?;
    shell_key.set_value("", &command)?;
    commands::crash::log_line(&format!(
        "[DEEPLINK] bmm:// now opens {exe_str}{}",
        if current_target_missing {
            " (previous target was missing)"
        } else {
            ""
        }
    ));

    Ok(())
}

/// Make `.bmmscript` open in BMM.
///
/// Mirrors register_bmm_protocol, guards included: a copy running from a temp directory
/// leaves a real install's association alone, and a registration pointing at an exe that no
/// longer exists is replaced. Failure is never fatal — an association is a convenience, and
/// refusing to start over one would be absurd.
fn register_bmmscript_association() -> Result<(), Box<dyn std::error::Error>> {
    let exe_path = std::env::current_exe()?;
    let in_temp = std::env::temp_dir()
        .canonicalize()
        .ok()
        .and_then(|tmp| exe_path.canonicalize().ok().map(|exe| exe.starts_with(&tmp)))
        .unwrap_or(false);

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let prog_id = "Software\\Classes\\BetterModsManager.bmmscript";

    let current: Option<String> = hkcu
        .open_subkey(format!("{prog_id}\\shell\\open\\command"))
        .ok()
        .and_then(|k| k.get_value::<String, _>("").ok());
    let current_target_missing = match &current {
        Some(cmd) => cmd
            .split('"')
            .nth(1)
            .map(|p| !std::path::Path::new(p).exists())
            .unwrap_or(true),
        None => true,
    };
    if in_temp && !current_target_missing {
        commands::crash::log_line(
            "[BMMSCRIPT] running from a temp directory — leaving the .bmmscript association alone",
        );
        return Ok(());
    }

    let exe_str = exe_path.to_string_lossy();
    let command = format!("\"{}\" \"%1\"", exe_str);
    if current.as_deref() == Some(command.as_str()) {
        return Ok(());
    }

    let (key, _) = hkcu.create_subkey(prog_id)?;
    key.set_value("", &"BMM automation script")?;
    let (icon, _) = key.create_subkey("DefaultIcon")?;
    icon.set_value("", &format!("\"{}\",0", exe_str))?;
    let (shell_key, _) = key.create_subkey("shell\\open\\command")?;
    shell_key.set_value("", &command)?;

    // The extension points at the ProgId. Written second on purpose: an extension pointing
    // at a ProgId that does not exist yet is a file type Windows cannot open at all.
    let (ext, _) = hkcu.create_subkey("Software\\Classes\\.bmmscript")?;
    ext.set_value("", &"BetterModsManager.bmmscript")?;

    commands::crash::log_line(&format!("[BMMSCRIPT] .bmmscript now opens {exe_str}"));
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

/// The bundle identifier moved (com.bettermm.app → com.bettermm.desktop), and Tauri derives the
/// app-data dir from it, so a fresh 1.0 install looks in a brand-new empty folder while a user's
/// real data (data.json, profiles, Replays, caches…) still sits under the OLD id. Copy it across
/// ONCE, before anything reads `data.json`. Copy (not move) so the old folder stays as a safety
/// net; guarded so it only runs when the new dir has no data yet and the old dir clearly does.
fn migrate_legacy_appdata(new_dir: &std::path::Path) {
    const OLD_ID: &str = "com.bettermm.app";
    if new_dir.join("data.json").exists() { return; }           // already has data — never overwrite
    let Some(parent) = new_dir.parent() else { return; };
    let old_dir = parent.join(OLD_ID);
    if old_dir == new_dir || !old_dir.join("data.json").exists() { return; } // nothing to bring over
    if std::fs::create_dir_all(new_dir).is_err() { return; }
    match copy_dir_recursive(&old_dir, new_dir) {
        Ok(n) => crate::commands::crash::log_line(format!(
            "[MIGRATE] copied {n} legacy app-data entries from {} → {}", old_dir.display(), new_dir.display())),
        Err(e) => crate::commands::crash::log_line(format!("[MIGRATE] legacy app-data copy failed: {e}")),
    }
}

/// Recursively copy `src` INTO `dst` (contents-only), returning the file count. Skips entries that
/// already exist in `dst` so a partial/retried migration never clobbers newer files.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<u64> {
    let mut copied = 0u64;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            std::fs::create_dir_all(&to)?;
            copied += copy_dir_recursive(&from, &to)?;
        } else if !to.exists() {
            std::fs::copy(&from, &to)?;
            copied += 1;
        }
    }
    Ok(copied)
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
    let _ = register_bmmscript_association();

    let args: Vec<String> = std::env::args().collect();
    if let Some(link) = args.iter().find(|arg| arg.starts_with("bmm://")).cloned() {
        *PENDING_DEEP_LINK.lock().unwrap() = Some(link);
    }
    // A double-clicked .bmmscript arrives as a plain path argument. Held like a pending
    // deeplink and handed over once the window exists — emitting before there is anything
    // listening loses it, which is the bug PENDING_DEEP_LINK was written for.
    if let Some(file) = args
        .iter()
        .find(|a| a.to_lowercase().ends_with(".bmmscript"))
        .cloned()
    {
        *PENDING_SCRIPT_FILE.lock().unwrap() = Some(file);
    }

    tauri::Builder::default()
        // Custom sandboxed pages: `bmmpage://<id>/<file>` serves a page's bundle
        // read-only with a strict CSP and an opaque origin (see commands::custom_pages).
        .register_uri_scheme_protocol("bmmpage", |ctx, request| {
            commands::custom_pages::bmmpage_protocol(ctx, request)
        })
        // Sub-frame guard: Tauri v2 defines window.__TAURI_INTERNALS__ for the
        // MAIN frame only, but injects code into every frame (incl. cross-origin
        // iframes like the YouTube tutorial embeds and about:blank) that reads
        // `__TAURI_INTERNALS__.plugins`, throwing "reading 'plugins' of undefined"
        // in those sub-frames. Defining a stub in all frames silences the noise.
        // Harmless in the main frame (the real internals are defined first and
        // are non-configurable, so the `if (!...)` guard is a no-op there).
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("bmm_subframe_guard")
                .js_init_script_on_all_frames(
                    "try{if(!window.__TAURI_INTERNALS__){window.__TAURI_INTERNALS__={plugins:{}}}else if(!window.__TAURI_INTERNALS__.plugins){window.__TAURI_INTERNALS__.plugins={}}}catch(e){}"
                        .to_string(),
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(link) = args.iter().find(|arg| arg.starts_with("bmm://")).cloned() {
                let _ = app.emit("deep-link-received", link);
            }
            if let Some(file) = args
                .iter()
                .find(|a| a.to_lowercase().ends_with(".bmmscript"))
                .cloned()
            {
                let _ = app.emit("bmmscript-file-opened", file);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_cli::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().ok().unwrap_or_else(|| PathBuf::from("."));
            // The bundle identifier changed (com.bettermm.app → com.bettermm.desktop), which moves
            // the app-data dir. Bring a pre-1.0 user's data across BEFORE we read data.json, so
            // upgrading from 0.9.x doesn't silently start from an empty profile.
            migrate_legacy_appdata(&app_dir);
            let data_path = app_dir.join("data.json");
            let app_state = AppState::load(data_path);
            // Mirror the key-auth path into the module that signs with it. Without this
            // the setting would only take effect after being re-saved, so a restart would
            // silently stop proving identity to every server that requires it.
            // Migrates the pre-keyring single value on the way through, so an upgrade keeps
            // the key somebody had configured instead of silently proving nothing.
            {
                let ring = app_state.data.lock().ok()
                    .map(|mut d| commands::repo_keyauth::keyring_from_settings(&mut d.settings));
                if let Some(r) = ring { commands::repo_keyauth::set_keyring(r); }
            }
            
            {
                let mut data = app_state.data.lock().unwrap();
                app_state.previous_session_clean.store(data.settings.last_session_clean, std::sync::atomic::Ordering::SeqCst);
                data.settings.last_session_clean = false;
                // Clean up any tutorial demo data left over from a previous session
                // (e.g. BMM closed mid-tutorial before cleanup could run).
                crate::commands::tutorial_demo::purge_tutorial_demo(&mut data);
                crate::commands::tutorial_demo::purge_demo_files();
                // Fifty API routes gained a permission this version. Carry the read half of
                // each domain a plugin was already trusted with, once, or upgrading BMM
                // stops every installed plugin for a reason nobody would connect to it.
                let moved = crate::commands::plugins::migrate_plugin_read_scopes(&mut data);
                if moved > 0 {
                    println!("plugin scopes: read access carried over for {moved} plugin(s)");
                }
            }
            let _ = app_state.save();

            app.manage(app_state);
            app.manage(crate::commands::repo_server::RepoServerState::default());
            
            let state_handle = app.state::<AppState>();
            commands::mods::start_sha_calculation_background(app.handle().clone());
            commands::mods::populate_sha_queue(state_handle);
            commands::mods::start_content_id_background(app.handle().clone());
            
            let _ = commands::ban_manager::load_bans(&app.handle().clone());
            let _ = commands::whitelist_manager::load_whitelist(&app.handle().clone());
            let _ = commands::discord::init_discord_rpc(app.state::<AppState>(), app.handle().clone());

            // Start local HTTP Plugin API on port 51274
            {
                let state_ref = app.state::<AppState>();
                let data_arc = state_ref.data.clone();
                let data_path = state_ref.data_path.clone();
                let creator_id = std::sync::Arc::new(
                    commands::security::get_creator_id(app.handle().clone()).unwrap_or_default()
                );
                let (tx, rx) = tokio::sync::oneshot::channel::<()>();
                {
                    *state_ref.api_shutdown_tx.lock().unwrap() = Some(tx);
                }
                let api_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    crate::api::start_api_server(data_arc, data_path, creator_id, rx, api_handle).await;
                });
            }

            if let Some(link) = PENDING_DEEP_LINK.lock().unwrap().clone() {
                let _ = app.emit("deep-link-received", link);
            }
            // NOT taken here: the frontend drains it with get_pending_script_file once it is
            // ready to show the review screen. Emitting AND clearing would drop the file if
            // the listener is not attached yet, which is the whole failure this mirrors.
            if let Some(file) = PENDING_SCRIPT_FILE.lock().unwrap().clone() {
                let _ = app.emit("bmmscript-file-opened", file);
            }

            apply_fs_security_mode(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if commands::crash::is_shutting_down() { return; }
                api.prevent_close();
                let window = window.clone();
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
            commands::verify::file_meta,
            commands::verify::hash_file,
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
            commands::modlist::open_locked_modlist,
            commands::modlist::modlist_credentials_open,
            commands::modlist::modlist_credentials_apply_keys,
            commands::modlist::cancel_export_modlist,
            commands::modlist::add_download_link,
            commands::modlist::remove_download_link,
            commands::ovgme::import_ovgme_profiles,
            commands::legacy_scan::scan_legacy_managers,
            commands::update::get_update_notes,
            commands::update::get_old_updates_count,
            commands::update::get_update_folder_structure,
            commands::tag::get_tags,
            commands::tag::create_tag,
            commands::tag::update_tag,
            commands::tag::delete_tag,
            commands::history::get_activity_history,
            commands::history::clear_activity_history,
            commands::settings::export_app_data,
            commands::settings::export_app_data_json,
            commands::export_bundle::export_data_bundle,
            commands::restore_bundle::inspect_data_bundle,
            commands::restore_bundle::restore_data_bundle,
            commands::settings::export_app_data_auto,
            commands::settings::import_app_data,
            commands::settings::factory_reset,
            commands::settings::reset_app_data,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::installer_handoff::consume_installer_handoff,
            commands::settings::apply_fs_security_mode_command,
            commands::settings::is_debug_mode,
            commands::settings::is_dev_build,
            commands::settings::is_fsdm_mode,
            commands::settings::is_ptb_mode,
            commands::settings::app_build_info,
            commands::settings::legal_fingerprint,
            commands::settings::is_update_disabled,
            commands::settings::is_auto_eula_enabled,
            commands::settings::get_quicklinks_config,
            commands::settings::get_bc_config,
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
            commands::mods::open_external,
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
            commands::scheduler::run_scheduled_script,
            commands::scheduler::scheduler_script_engines,
            commands::bmms::bmms_compile,
            commands::bmms::bmms_compile_steps,
            commands::bmms::bmms_decompile,
            commands::scheduler::list_running_processes,
            commands::scheduler::stop_process,
            commands::scheduler::create_bmm_folder,
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
            commands::analytics::analytics_packet_status,
            commands::analytics::analytics_request_deletion,
            commands::analytics::analytics_request_data,
            commands::analytics::analytics_clear_sent_log,
            commands::analytics::replay_asset_data_url,
            commands::analytics::save_local_replay,
            commands::analytics::save_local_video,
            commands::analytics::replay_spool_begin,
            commands::analytics::replay_spool_append,
            commands::analytics::replay_spool_trim,
            commands::analytics::replay_spool_finalize,
            commands::analytics::replay_spool_clear,
            commands::analytics::delete_local_replay,
            commands::analytics::save_crash_session,
            commands::analytics::list_saved_replays,
            commands::analytics::prune_sessions,
            commands::dialog::dlg_pick_folder,
            commands::dialog::dlg_pick_file,
            commands::dialog::dlg_save_file,
            commands::dialog::dlg_confirm,
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
            commands::autoupdate::check_update_via_installer,
            commands::autoupdate::update_via_installer,
            commands::custom_pages::list_custom_pages,
            commands::custom_pages::create_custom_page,
            commands::custom_pages::get_custom_page_source,
            commands::custom_pages::update_custom_page,
            commands::custom_pages::delete_custom_page,
            commands::custom_pages::import_page_file,
            commands::custom_pages::list_page_files,
            commands::custom_pages::import_page_path,
            commands::custom_pages::import_page_dir,
            commands::custom_pages::delete_page_file,
            commands::custom_pages::list_page_docs,
            commands::custom_pages::get_page_doc,
            commands::custom_pages::save_page_doc,
            commands::custom_pages::delete_page_doc,
            commands::custom_pages::page_storage_get,
            commands::custom_pages::page_storage_set,
            commands::custom_pages::page_storage_remove,
            commands::custom_pages::page_storage_keys,
            commands::custom_pages::page_storage_clear,
            commands::custom_pages::page_grants_get,
            commands::custom_pages::page_set_grant,
            commands::custom_pages::page_net_origins_get,
            commands::custom_pages::page_set_net_origins,
            commands::custom_pages::page_fetch,
            commands::custom_pages::page_system_info,
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
            commands::repo::generate_repo_manifest,
            commands::doc_sign::verify_bmm_document,
            commands::doc_sign::write_signed_document,
            commands::repo::get_auto_sync_repos,
            commands::repo_autoindex::default_remote_repo_dir,
            commands::repo_autoindex::plan_remote_repo_refresh,
            commands::repo_discover::discover_server_repo,
            commands::repo_autoindex::refresh_repo_from_server,
            commands::repo_credentials::set_repo_credentials,
            commands::repo_credentials::forget_repo_credentials,
            commands::repo_credentials::list_repo_credentials,
            commands::repo::set_repo_auto_sync,
            commands::identity::set_bcweb_identity_key,
            commands::identity::get_bcweb_identity_key,
            commands::identity::set_my_attestation,
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
            commands::launch_pack::export_launch_pack,
            commands::launch_pack::import_launch_pack,
            commands::launch_pack::scan_dir_for_exe,
            commands::launch_pack::scan_installed_apps,
            commands::launch_pack::extract_exe_icon,
            commands::omm::auto_import_omm,
            commands::repo_ssh::ssh_test_connection,
            commands::repo_ssh::ssh_upload_repo,
            commands::repo_ssh::ssh_download_repo,
            commands::repo_ssh::ssh_fetch_repo_info,
            commands::repo_ssh::ssh_read_text,
            commands::repo_keyauth::set_key_auth_key,
            commands::repo_keyauth::key_auth_list,
            commands::repo_keyauth::key_auth_add,
            commands::repo_keyauth::key_auth_generate,
            commands::repo_extras::repo_extras_write,
            commands::modlist::modlist_fetch,
            commands::modlist::fetch_to_app_data,
            commands::settings::backup_dest_path,
            commands::plugin_assets::plugin_assets_list,
            commands::plugin_assets::plugin_tree,
            commands::plugin_assets::folder_tree,
            commands::plugin_assets::preview_under,
            commands::plugin_assets::plugin_asset_read,
            commands::plugin_assets::plugin_asset_path,
            commands::plugin_assets::plugin_asset_export,
            commands::plugin_assets::plugin_file_export,
            commands::plugin_assets::plugin_asset_add,
            commands::plugin_assets::plugin_asset_remove,
            commands::plugin_assets::plugin_check,
            commands::catalog_sources::catalog_sources_set,
            commands::catalog_sources::catalog_sources_get,
            commands::catalog_store::catalog_entry,
            commands::catalog_store::catalog_drop,
            commands::catalog_store::catalog_authored_get,
            commands::game_watch::file_stamp,
            commands::game_watch::read_text_tail,
            commands::scheduler::run_scheduled_script_full,
            commands::catalog_bundle::list_dir_files,
            commands::hooks::hook_fire,
            commands::hooks::hook_poll,
            commands::hooks::hook_list,
            commands::hooks::hook_clear,
            commands::game_watch::game_profiles,
            commands::game_watch::game_find_logs,
            commands::game_watch::dcs_saved_games,
            commands::game_watch::dcs_install_hook,
            commands::game_watch::dcs_remove_hook,
            commands::repo_extras::repo_extras_apply,
            commands::repo_extras::repo_extras_install,
            commands::repo_keyauth::key_auth_remove,
            commands::repo_keyauth::key_auth_set_active,
            commands::repo_keyauth::key_auth_set_for_url,
            commands::repo_keyauth::key_auth_unlock,
            commands::repo_keyauth::key_auth_origin_of,
            commands::repo_ssh::ssh_list_dir,
            commands::repo_ssh::ssh_resolve_path,
            commands::repo_ssh::ssh_forget_host,
            commands::repo_server::start_repo_server,
            commands::repo_server::stop_repo_server,
            commands::repo_server::get_repo_require_login,
            commands::repo_server::set_repo_require_login,
            commands::repo_server::get_repo_server_status,
            commands::repo_server::get_connected_clients,
            commands::repo_server::get_active_downloads,
            commands::security::get_creator_id,
            commands::security::bc_api_get,
            commands::security::set_bcweb_api_key,
            commands::security::has_bcweb_api_key,
            commands::security::bcweb_notifications,
            commands::security::bc_api_post,
            commands::security::bc_fetch_data_url,
            commands::security::get_salted_creator_id,
            commands::security::verify_repo_signature,
            commands::crash::finalize_and_close_app,
            commands::disk::read_file_base64,
            // commands::debug::get_project_files and read_project_file
            // were removed with the Sources tab — see debug-ui.ts.
            commands::debug::get_debug_stats,
            commands::debug::get_rust_logs,
            commands::debug::export_diagnostics,
            commands::debug::generate_diagnostic_report,
            commands::debug::capture_memory_snapshot,
            commands::window::set_unread_badge,
            commands::window::start_resizing,
            commands::window::open_external_url,
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
            get_pending_script_file,
            open_devtools,
            close_devtools,
            is_devtools_open,
            commands::crash::get_dxdiag_report,
            commands::crash::list_crash_reports,
            commands::crash::delete_crash_report,
            commands::crash::read_crash_report,
            commands::crash::read_crash_report_file,
            commands::crash::read_crash_session,
            commands::crash::copy_file,
            commands::modpack::save_modpack,
            commands::modpack::load_modpacks,
            commands::modpack::get_modpack_by_id,
            commands::modpack::delete_modpack,
            commands::modpack::build_modpack_mod_ref,
            commands::modpack::export_modpack,
            commands::modpack::import_modpack,
            commands::modpack::install_modpack_from_url,
            commands::tutorial_custom::tutorial_custom_list,
            commands::tutorial_custom::tutorial_custom_save,
            commands::tutorial_custom::tutorial_custom_delete,
            commands::tutorial_custom::tutorial_custom_import,
            commands::catalog_bundle::catalog_bundle_pack,
            commands::catalog_bundle::catalog_bundle_stage,
            commands::catalog_bundle::catalog_bundle_unstage,
            commands::catalog_bundle::catalog_bundle_open,
            commands::modpack_catalog::export_modpack_catalog,
            commands::modpack_catalog::read_modpack_catalog,
            commands::modpack_catalog::install_from_modpack_catalog,
            commands::modpack::check_modpack_integrity,
            commands::modpack::repair_modpack_mod,
            crate::commands::mod_archive::is_mod_archived,
            crate::commands::mod_archive::unarchive_mod,
            crate::commands::mod_archive::rearchive_mod,
            crate::commands::mapper::get_directory_tree,
            crate::commands::mapper::restructure_mod_item,
            crate::commands::mapper::delete_mod_item,
            crate::commands::mapper::open_item_in_explorer,
            crate::commands::mapper::open_game_item_in_explorer,
            crate::commands::mapper::create_mod_folder,
            crate::commands::mapper::rename_mod_item,
            commands::net::fetch_remote_json,
            commands::net::http_request,
            commands::sandbox_gen::generate_sandbox_library,
            commands::sandbox_gen::clear_sandbox_library,
            commands::sandbox_gen::sandbox_library_info,
            commands::plugins::fetch_plugin_catalog,
            commands::plugins::install_plugin,
            commands::plugins::install_plugin_from_file,
            commands::plugins::read_plugin_manifest,
            commands::plugins::uninstall_plugin,
            commands::plugins::toggle_plugin,
            commands::plugins::get_installed_plugins,
            commands::plugins::compare_plugin_mods,
            commands::plugins::apply_plugin_modlist,
            commands::plugins::set_plugin_permissions,
            commands::plugins::get_plugin_permissions,
            commands::plugins::get_api_token,
            commands::plugins::get_os_schedule_key,
            commands::bmm_paths::bmm_path_roots,
            commands::bmm_paths::bmm_path_resolve,
            commands::plugins::plugin_automations,
            commands::plugins::plugin_bundles,
            commands::plugin_assets::plugin_contents,
            commands::plugin_assets::plugin_file_read,
            commands::mod_order::mod_order_get,
            commands::mod_order::mod_order_set,
            commands::task_output::task_write_file,
            commands::task_output::task_output_dir,
            commands::format_check::bmm_validate,
            commands::content_ids::content_id_of,
            commands::content_ids::content_id_from,
            commands::repo_extras::repo_modpacks_apply,
            commands::repo_extras::repo_modpacks_read,
            commands::apps::catalog_probe_url,
            commands::apps::catalog_probe_file,
            commands::plugins::get_effective_api_port,
            commands::plugins::get_api_status,
            commands::plugins::restart_api_server,
            commands::plugins::create_plugin_token,
            commands::plugins::revoke_plugin_token,
            commands::plugins::list_plugin_tokens,
            commands::plugins::reset_api_token,
            commands::plugins::generate_script,
            commands::plugins::export_plugin,
            commands::plugins::write_text_file,
            commands::plugins::read_nav_bundle,
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
            commands::themes::theme_presets_dir,
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
