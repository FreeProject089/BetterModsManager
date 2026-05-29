#[cfg(windows)]
use windows::Win32::System::Threading::CREATE_NO_WINDOW;

use std::sync::Mutex;
use tokio::sync::Mutex as AsyncMutex;
use tokio::sync::oneshot;
use local_ip_address::local_ip;
use std::path::PathBuf;
use igd::{search_gateway, PortMappingProtocol};
use tokio::process::{Command, Child};
use std::process::Stdio;
use tokio::io::{BufReader, AsyncBufReadExt};
use tokio_util::io::ReaderStream;
use futures::StreamExt;
use warp::Filter;
use std::collections::HashMap;
use std::sync::Arc;
use crate::commands::ban_manager::{self, BanError};
use crate::commands::whitelist_manager::{self, WhitelistError};
use tauri::Manager;
use regex::Regex;
use bytes::Bytes;
use percent_encoding::percent_decode_str;

/// Emitted when a client fetches repo.json (anti-spam: 30s per client)
#[derive(serde::Serialize, Clone)]
pub struct ServerClientConnectedPayload {
    pub ip: String,
    pub creator_id: Option<String>,
    pub protocol: String,
}

/// Emitted when a mod file download starts on the server
#[derive(serde::Serialize, Clone)]
pub struct ServerDownloadStartedPayload {
    pub ip: String,
    pub creator_id: Option<String>,
    pub file: String,
    pub total_size: u64,
    pub protocol: String,
}

/// Emitted when a mod file download finishes on the server
#[derive(serde::Serialize, Clone)]
pub struct ServerDownloadFinishedPayload {
    pub ip: String,
    pub creator_id: Option<String>,
    pub file: String,
    pub total_size: u64,
    pub protocol: String,
}

#[derive(serde::Serialize)]
pub struct ActiveDownload {
    pub ip: String,
    pub file: String,
    pub total_size: u64,
    pub downloaded_size: u64,
    pub start_time: u64, // Unix timestamp in ms
    pub creator_id: Option<String>,
    pub protocol: String,
}

pub struct RepoServerState {
    pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    pub upnp_mapped: Mutex<bool>,
    pub tunnel_process: Mutex<Option<Child>>,
    pub lan_url: Mutex<Option<String>>,
    pub public_url: Mutex<Option<String>>,
    pub tunnel_url: Mutex<Option<String>>,
    pub serve_path: Mutex<Option<String>>,
    pub active_port: Mutex<u16>,
    pub upload_limit: Mutex<u32>, // KB/s
    pub seed: Mutex<Option<String>>,
    pub active_downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,
    /// Anti-spam: tracks last notification instant per "ip|creator_id" — 30s cooldown
    pub connected_clients: Arc<Mutex<HashMap<String, std::time::Instant>>>,
    /// Track session download notifications per client - only notify once per session start
    pub session_download_started: Arc<Mutex<HashMap<String, bool>>>,
    /// Track session completion notifications per client - only notify when all downloads complete
    pub session_download_completed: Arc<Mutex<HashMap<String, bool>>>,
    /// True while a repo sync is in progress (set by the API, cleared by the UI flow).
    pub sync_busy: Arc<std::sync::atomic::AtomicBool>,
    /// True while a repo generation/export is in progress.
    pub gen_busy: Arc<std::sync::atomic::AtomicBool>,
}

impl Default for RepoServerState {
    fn default() -> Self {
        Self {
            shutdown_tx: Mutex::new(None),
            upnp_mapped: Mutex::new(false),
            tunnel_process: Mutex::new(None),
            lan_url: Mutex::new(None),
            public_url: Mutex::new(None),
            tunnel_url: Mutex::new(None),
            serve_path: Mutex::new(None),
            active_port: Mutex::new(8000),
            upload_limit: Mutex::new(0),
            seed: Mutex::new(None),
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
            connected_clients: Arc::new(Mutex::new(HashMap::new())),
            session_download_started: Arc::new(Mutex::new(HashMap::new())),
            session_download_completed: Arc::new(Mutex::new(HashMap::new())),
            sync_busy: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            gen_busy: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }
}

/// Set/clear the sync/gen busy flags (called by the UI flow to release the
/// guard the API endpoints use to reject concurrent processes).
#[tauri::command]
pub fn set_repo_busy(state: tauri::State<'_, RepoServerState>, kind: String, busy: bool) {
    use std::sync::atomic::Ordering;
    match kind.as_str() {
        "sync" => state.sync_busy.store(busy, Ordering::SeqCst),
        "gen"  => state.gen_busy.store(busy, Ordering::SeqCst),
        _ => {}
    }
}

async fn get_cloudflared_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. Check user settings first
    let state = handle.state::<crate::state::AppState>();
    let settings = {
        let data = state.data.lock().map_err(|_| "Failed to lock AppState".to_string())?;
        data.settings.clone()
    };

    if let Some(ref path_str) = settings.cloudflared_path {
        let path = PathBuf::from(path_str);
        if path.exists() && path.is_file() {
            return Ok(path);
        }
        println!("[Tunnel] User specified cloudflared path does not exist: {}", path_str);
    }

    // 2. Default auto-download path
    let app_dir = handle.path_resolver().app_data_dir().ok_or("Impossible de trouver le dossier AppData")?;
    let bin_dir = app_dir.join("bin");
    if !bin_dir.exists() {
        std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    }
    let cf_path = bin_dir.join("cloudflared.exe");

    if !cf_path.exists() {
        println!("[Tunnel] Downloading cloudflared...");
        let arch = match std::env::consts::ARCH {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            "x86" => "386",
            _ => "amd64",
        };
        let url = format!("https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-{}.exe", arch);
        
        let client = reqwest::Client::builder()
            .user_agent("BetterModsManager/1.0")
            .build()
            .map_err(|e| format!("Client error: {}", e))?;

        let response = client.get(&url).send().await.map_err(|e| format!("Download error: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("Échec du téléchargement (Status {}): {}", response.status(), url));
        }

        let bytes = response.bytes().await.map_err(|e| format!("Read error: {}", e))?;
        std::fs::write(&cf_path, &bytes).map_err(|e| format!("Write error: {}", e))?;
        println!("[Tunnel] Download complete.");
    }

    Ok(cf_path)
}

async fn fetch_public_ip() -> Result<String, String> {
    reqwest::get("https://api.ipify.org")
        .await
        .map_err(|e| format!("Network error: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

#[derive(serde::Serialize)]
pub struct StartServerResult {
    pub lan_url: String,
    pub public_url: Option<String>,
    pub tunnel_url: Option<String>,
    pub upnp_success: bool,
    pub seed: Option<String>,
}

#[tauri::command]
pub async fn start_repo_server(
    handle: tauri::AppHandle,
    state: tauri::State<'_, RepoServerState>,
    path: String,
    port: u16,
    upload_limit: u32,
) -> Result<StartServerResult, String> {
    // 1. Check if already running
    // 2. Validate path
    let serve_dir = PathBuf::from(&path);
    if !serve_dir.exists() || !serve_dir.is_dir() {
        return Err("Le dossier spécifié n'existe pas ou est invalide".to_string());
    }
    
    let manifest_path = serve_dir.join("repo.json");
    if !manifest_path.exists() {
        return Err("Aucun repo.json trouvé dans ce dossier. Générez d'abord le repo ou pointez vers un dossier existant.".to_string());
    }

    // Load repo to check/generate seed
    let repo_json_content = std::fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let mut repo_data: crate::models::repo::ServerRepo = serde_json::from_str(&repo_json_content).map_err(|e| e.to_string())?;
    
    let server_seed = match repo_data.seed {
        Some(ref s) => s.clone(),
        None => {
            // Generate seed if missing
            use rand::{thread_rng, Rng};
            use rand::distributions::Alphanumeric;
            let new_seed: String = thread_rng()
                .sample_iter(&Alphanumeric)
                .take(32)
                .map(char::from)
                .collect();
            repo_data.seed = Some(new_seed.clone());
            // Save back
            let updated_json = serde_json::to_string_pretty(&repo_data).map_err(|e| e.to_string())?;
            std::fs::write(&manifest_path, updated_json).map_err(|e| e.to_string())?;
            new_seed
        }
    };

    // 3. Create graceful shutdown channel
    let (tx, rx) = oneshot::channel();
    {
        let mut tx_lock = state.shutdown_tx.lock().unwrap_or_else(|p| p.into_inner());
        if tx_lock.is_some() {
            return Err("Le serveur est déjà en cours d'exécution".to_string());
        }
        *tx_lock = Some(tx);
    }

    // 4. Setup warp routes with CORS and Ban Check


    let active_downloads = state.active_downloads.clone();
    let _connected_clients = state.connected_clients.clone();
    let session_download_started = state.session_download_started.clone();
    let session_download_completed = state.session_download_completed.clone();
    let serve_dir_clone = serve_dir.clone();

    let key_filter = warp::header::optional::<String>("x-creator-key")
        .and(warp::header::optional::<String>("x-creator-id"))
        .map(|k1: Option<String>, k2: Option<String>| k1.or(k2));

    let handle_clone = handle.clone();
    let file_route = warp::get()
        .and(warp::path::tail())
        .and(warp::addr::remote())
        .and(key_filter)
        .and_then(move |tail: warp::path::Tail, addr: Option<std::net::SocketAddr>, key: Option<String>| {
            let handle = handle_clone.clone();
            let active_downloads = active_downloads.clone();
            let session_download_started = session_download_started.clone();
            let session_download_completed = session_download_completed.clone();
            let serve_dir = serve_dir_clone.clone();
            async move {
                let state = handle.state::<RepoServerState>();
                let ip = addr.map(|a| a.ip().to_string()).unwrap_or_default();
                let rel_path_encoded = tail.as_str();
                let rel_path = percent_decode_str(rel_path_encoded).decode_utf8_lossy().into_owned();

                // 1. Mandatory Creator ID for any file in /mods/
                let is_mod_file = rel_path.starts_with("mods/") || rel_path.starts_with("mods\\");
                if is_mod_file && key.is_none() {
                    println!("[Server] Access Denied: Missing Creator ID header for mod download from {}", ip);
                    return Err(warp::reject::custom(BanError));
                }

                // 2. Ban Check
                if ban_manager::is_banned(&ip, key.as_deref()) {
                    return Err(warp::reject::custom(BanError));
                }

                // 3. Whitelist Check (Server owner can restrict access)
                if whitelist_manager::is_whitelist_enabled() && !whitelist_manager::is_whitelisted(&ip, key.as_deref()) {
                    println!("[Server] Access Denied: User {} ({:?}) not on whitelist", ip, key);
                    return Err(warp::reject::custom(WhitelistError));
                }
                let full_path = serve_dir.join(&rel_path);
                
                // Security: ensure file is within repo
                if !full_path.starts_with(&serve_dir) {
                    println!("[Server] Security Block: Request for {} (decoded: {}) is outside serve_dir", rel_path_encoded, rel_path);
                    return Err(warp::reject::not_found());
                }

                if rel_path == "monitoring.json" {
                    let dl_path = serve_dir.join("downloads.json");
                    let content = tokio::fs::read_to_string(&dl_path).await.unwrap_or_else(|_| "{}".to_string());
                    let json_val: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
                    
                    let total_dls = json_val["totalDownloads"].as_u64().unwrap_or(0);
                    let total_bytes = json_val["totalBytesSent"].as_u64().unwrap_or(0);
                    let mods_dl = json_val["mods"].clone();
                    
                    let active_dls: Vec<serde_json::Value> = {
                        let active = active_downloads.lock().unwrap_or_else(|p| p.into_inner());
                        active.values().map(|dl| {
                            serde_json::json!({
                                "ip": dl.ip,
                                "creatorId": dl.creator_id,
                                "file": dl.file,
                                "downloaded": dl.downloaded_size,
                                "total": dl.total_size,
                                "speed": 0 // Mocked for integrated server
                            })
                        }).collect()
                    };

                    let response = serde_json::json!({
                        "server": {
                            "version": "1.0",
                            "uptime": 0,
                            "totalBytes": total_bytes,
                            "totalDls": total_dls,
                            "modsDownloads": mods_dl
                        },
                        "active": active_dls,
                        "sessions": [],
                        "history": []
                    });
                    
                    return Ok(warp::Reply::into_response(warp::reply::json(&response)));
                }

                if rel_path.starts_with("admin/") || rel_path == "dashboard" {
                    return Ok(warp::Reply::into_response(warp::reply::with_status(warp::reply::json(&serde_json::json!({})), warp::hyper::StatusCode::UNAUTHORIZED)));
                }

                if !full_path.is_file() {
                    println!("[Server] File Not Found: {} (decoded: {}) -> {:?}", rel_path_encoded, rel_path, full_path);
                    return Err(warp::reject::not_found());
                }

                let file = tokio::fs::File::open(&full_path).await.map_err(|_| warp::reject::not_found())?;
                let metadata = file.metadata().await.map_err(|_| warp::reject::not_found())?;
                let total_size = metadata.len();
                let file_name = rel_path.to_string();

                // Determine protocol for events
                let protocol = if ip.starts_with("127.0.0.1") || ip == "::1" { "Local" }
                    else if ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.") { "LAN" }
                    else { "WAN" };

                // Intercept repo.json to filter modpacks based on share_mode and Creator ID
                if file_name == "repo.json" || file_name == "repo.json\\" || file_name == "repo.json/" {
                    // Anti-spam notification logic
                    let client_key = format!("{}|{:?}", ip, key);
                    let should_notify = {
                        let mut clients = state.connected_clients.lock().unwrap_or_else(|p| p.into_inner());
                        let now = std::time::Instant::now();
                        if let Some(last) = clients.get(&client_key) {
                            if now.duration_since(*last).as_secs() > 30 {
                                clients.insert(client_key, now);
                                true
                            } else { false }
                        } else {
                            clients.insert(client_key, now);
                            true
                        }
                    };

                    if should_notify {
                        let _ = handle.emit_all("bmm://server-client-connected", ServerClientConnectedPayload {
                            ip: ip.clone(),
                            creator_id: key.clone(),
                            protocol: protocol.to_string(),
                        });
                    }

                    if let Ok(content) = tokio::fs::read_to_string(&full_path).await {
                        if let Ok(mut repo) = serde_json::from_str::<crate::models::repo::ServerRepo>(&content) {
                            if let Some(mut packs) = repo.modpacks.take() {
                                packs.retain(|p| {
                                    match p.share_mode.as_str() {
                                        "public" => true,
                                        "whitelist_repo" => {
                                            !crate::commands::ban_manager::is_banned(&ip, key.as_deref()) &&
                                            (!crate::commands::whitelist_manager::is_whitelist_enabled() || crate::commands::whitelist_manager::is_whitelisted(&ip, key.as_deref()))
                                        },
                                        "whitelist_custom" => {
                                            if let Some(ref cw) = p.custom_whitelist {
                                                cw.contains(&key.clone().unwrap_or_default())
                                            } else { false }
                                        },
                                        _ => false,
                                    }
                                });
                                repo.modpacks = Some(packs);
                            }
                            if let Ok(filtered_json) = serde_json::to_string(&repo) {
                                let response = warp::http::Response::builder()
                                    .header("Content-Type", "application/json")
                                    .header("Content-Length", filtered_json.len())
                                    .body(warp::hyper::Body::from(filtered_json))
                                    .expect("Failed to build warp response");
                                return Ok::<_, warp::Rejection>(response);
                            }
                        }
                    }
                }

                let upload_limit = *state.upload_limit.lock().unwrap_or_else(|p| p.into_inner());
                let stream = ReaderStream::new(file);
                let active_downloads_inner = active_downloads.clone();
                let ip_clone = ip.clone();

                // Track the download in state
                {
                    let mut dl_lock = active_downloads_inner.lock().unwrap_or_else(|p| p.into_inner());
                    dl_lock.insert(ip_clone.clone(), ActiveDownload {
                        ip: ip_clone.clone(),
                        file: file_name.clone(),
                        total_size,
                        downloaded_size: 0,
                        start_time: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                        creator_id: key.clone(),
                        protocol: protocol.to_string(),
                    });
                }

                // Emit download-started (only for mod files, not repo.json itself)
                // Only notify once per session start per client
                if is_mod_file {
                    let client_key = format!("{}|{}", ip, key.as_deref().unwrap_or(""));
                    let should_notify = {
                        let mut session_notifs = session_download_started.lock().unwrap_or_else(|p| p.into_inner());
                        if !session_notifs.contains_key(&client_key) {
                            session_notifs.insert(client_key, true);
                            true
                        } else {
                            false
                        }
                    };

                    if should_notify {
                        let _ = handle.emit_all("bmm://server-download-started", ServerDownloadStartedPayload {
                            ip: ip.clone(),
                            creator_id: key.clone(),
                            file: file_name.clone(),
                            total_size,
                            protocol: protocol.to_string(),
                        });
                    }
                }

                let tracked_stream = stream.map(move |chunk: std::io::Result<Bytes>| {
                    if let Ok(ref bytes) = chunk {
                        let mut dl_lock = active_downloads_inner.lock().unwrap_or_else(|p| p.into_inner());
                        if let Some(dl) = dl_lock.get_mut(&ip_clone) {
                            dl.downloaded_size += bytes.len() as u64;
                        }
                    }
                    chunk
                });

                let bytes_sent_acc = Arc::new(AsyncMutex::new(0usize));
                let interval_start = Arc::new(AsyncMutex::new(std::time::Instant::now()));

                // Clone values for the finish-event closure
                let handle_finish = handle.clone();
                let ip_finish = ip.clone();
                let key_finish = key.clone();
                let file_finish = file_name.clone();
                let protocol_finish = protocol.to_string();
                let is_mod_file_finish = is_mod_file;
                let bytes_total_sent = 0u64;

                let final_stream = tracked_stream.then(move |chunk| {
                    let bytes_sent = bytes_sent_acc.clone();
                    let i_start = interval_start.clone();
                    async move {
                        if upload_limit > 0 {
                            if let Ok(ref bytes) = chunk {
                                let mut b_lock = bytes_sent.lock().await;
                                let mut s_lock = i_start.lock().await;
                                
                                *b_lock += bytes.len();
                                let now = std::time::Instant::now();
                                let elapsed = now.duration_since(*s_lock).as_millis() as u64;
                                
                                if elapsed >= 1000 {
                                    *b_lock = 0;
                                    *s_lock = now;
                                } else if *b_lock >= (upload_limit as usize * 1024) {
                                    let sleep_ms = 1000 - elapsed;
                                    tokio::time::sleep(std::time::Duration::from_millis(sleep_ms)).await;
                                    *b_lock = 0;
                                    *s_lock = std::time::Instant::now();
                                }
                            }
                        }
                        chunk
                    }
                });

                // Wrap stream to detect completion and emit download-finished
                let final_stream = if is_mod_file_finish {
                    let handle_fin = handle_finish.clone();
                    let ip_fin = ip_finish.clone();
                    let key_fin = key_finish.clone();
                    let file_fin = file_finish.clone();
                    let proto_fin = protocol_finish.clone();
                    let total = total_size;
                    let session_completed = session_download_completed.clone();
                    let serve_dir_fin = serve_dir.clone();
                    let stream_with_end = final_stream.chain(futures::stream::once(async move {
                        // Check if this is the last download for this client
                        let client_key = format!("{}|{}", ip_fin, key_fin.as_deref().unwrap_or(""));
                        let should_notify_complete = {
                            let state = handle_fin.state::<RepoServerState>();
                            let active_downloads = state.active_downloads.lock().unwrap_or_else(|p| p.into_inner());
                            let completed_notifs = session_completed.lock().unwrap_or_else(|p| p.into_inner());
                            
                            // Check if there are no more active downloads for this client
                            let has_active_downloads = active_downloads.values().any(|dl| {
                                dl.ip == ip_fin && dl.creator_id == key_fin
                            });
                            
                            // Only notify if no more downloads and we haven't notified yet
                            !has_active_downloads && !completed_notifs.contains_key(&client_key)
                        };

                        if should_notify_complete {
                            let _state = handle_fin.state::<RepoServerState>();
                            let mut completed_notifs = session_completed.lock().unwrap_or_else(|p| p.into_inner());
                            completed_notifs.insert(client_key, true);
                            
                            let _ = handle_fin.emit_all("bmm://server-download-finished", ServerDownloadFinishedPayload {
                                ip: ip_fin,
                                creator_id: key_fin,
                                file: file_fin.clone(),
                                total_size: total,
                                protocol: proto_fin,
                            });
                        }
                        
                        // Per-download resource record (file served = bandwidth used)
                        {
                            let mut t = crate::commands::resource_tracker::OpTracker::start("REPO/host-serve")
                                .with_subject(file_fin.clone());
                            t.set("bytes_sent", total);
                            t.finish();
                        }

                        // Update downloads.json stats
                        let downloads_path = serve_dir_fin.join("downloads.json");
                        let content = tokio::fs::read_to_string(&downloads_path).await.unwrap_or_else(|_| "{}".to_string());
                        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                            let total_dl = json["totalDownloads"].as_u64().unwrap_or(0);
                            json["totalDownloads"] = serde_json::json!(total_dl + 1);
                            
                            let bytes_sent = json["totalBytesSent"].as_u64().unwrap_or(0);
                            json["totalBytesSent"] = serde_json::json!(bytes_sent + total);

                            if file_fin.starts_with("mods/") || file_fin.starts_with("mods\\") {
                                let parts: Vec<&str> = file_fin.split(|c| c == '/' || c == '\\').collect();
                                if parts.len() > 1 {
                                    let mod_id = parts[1];
                                    let mut mods = json["mods"].as_object().cloned().unwrap_or_default();
                                    let mod_total = mods.get(mod_id).and_then(|v| v.as_u64()).unwrap_or(0);
                                    mods.insert(mod_id.to_string(), serde_json::json!(mod_total + 1));
                                    json["mods"] = serde_json::Value::Object(mods);
                                }
                            }
                            if let Ok(new_content) = serde_json::to_string(&json) {
                                let _ = tokio::fs::write(&downloads_path, new_content).await;
                            }
                        }

                        // Signal end-of-stream with an empty Ok chunk
                        Ok::<Bytes, std::io::Error>(Bytes::new())
                    }));
                    warp::hyper::Body::wrap_stream(stream_with_end)
                } else {
                    warp::hyper::Body::wrap_stream(final_stream)
                };

                // Drop unused variable
                let _ = bytes_total_sent;


                let content_type = if full_path.extension().map(|e| e == "json").unwrap_or(false) { "application/json" }
                    else if full_path.extension().map(|e| e == "zip").unwrap_or(false) { "application/zip" }
                    else { "application/octet-stream" };

                let response = warp::http::Response::builder()
                    .header("Content-Length", total_size)
                    .header("Content-Type", content_type)
                    .body(final_stream)
                    .map_err(|_| warp::reject::not_found())?;

                Ok::<_, warp::Rejection>(response)
            }
        });

    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "OPTIONS"])
        .allow_headers(vec!["*", "x-creator-key", "x-creator-id", "range", "content-type", "accept"]);
    
    // file_route handles all files including repo.json with connection notifications
    let routes = file_route.with(cors);


    // 5. Port and Address
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));

    // Check if port is already in use
    if let Err(e) = std::net::TcpListener::bind(addr) {
        return Err(format!("Le port {} est déjà utilisé par une autre application : {}", port, e));
    }
    
    // 6. UPnP Port Forwarding
    let mut upnp_success = false;
    let mut public_ip = None;

    match search_gateway(Default::default()) {
        Ok(gateway) => {
            let local_ip_addr = local_ip().map_err(|e| e.to_string())?;
            let local_socket = match local_ip_addr {
                std::net::IpAddr::V4(v4) => std::net::SocketAddrV4::new(v4, port),
                _ => return Err("UPnP supporte uniquement IPv4 pour le moment".to_string()),
            };
            
            match gateway.add_port(PortMappingProtocol::TCP, port, local_socket, 0, "Better Mods Manager Repo") {
                Ok(_) => {
                    upnp_success = true;
                    *state.upnp_mapped.lock().unwrap_or_else(|p| p.into_inner()) = true;
                    public_ip = gateway.get_external_ip().map(|ip| ip.to_string()).ok();
                },
                Err(e) => {
                    println!("[UPNP] Failed to map port: {}", e);
                }
            }
        },
        Err(e) => {
            println!("[UPNP] Gateway discovery failed: {}", e);
        }
    }

    // Fallback: Fetch public IP manually if UPnP failed or didn't provide IP
    if public_ip.is_none() {
        if let Ok(ip) = fetch_public_ip().await {
            public_ip = Some(ip);
        }
    }

    // 7. Spawn the server in a Tokio task
    let (_addr_actual, server) = warp::serve(routes.recover(handle_rejection)).bind_with_graceful_shutdown(addr, async {
        rx.await.ok();
    });
    
    tokio::task::spawn(server);

    // Return results
    let my_local_ip = match local_ip() {
        Ok(ip) => ip.to_string(),
        Err(_) => "127.0.0.1".to_string(),
    };

    let lan_url = format!("http://{}:{}/repo.json", my_local_ip, port);
    let public_url = public_ip.map(|ip| format!("http://{}:{}/repo.json", ip, port));

    // 8. Start Cloudflare Tunnel
    let mut tunnel_url = None;
    match get_cloudflared_path(&handle).await {
        Ok(cf_path) => {
            let target_url = format!("http://{}:{}", my_local_ip, port);
            println!("[Tunnel] Target URL: {}", target_url);

            let mut child = Command::new(cf_path)
                .args(["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", &target_url])
                .stderr(Stdio::piped())
                .stdout(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW.0)
                .spawn()
                .map_err(|e| format!("Tunnel launch error: {}", e))?;

            if let Some(stderr) = child.stderr.take() {
                let mut reader = BufReader::new(stderr).lines();
                let re = Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com").expect("Invalid static tunnel regex");
                
                let start_time = std::time::Instant::now();
                while start_time.elapsed().as_secs() < 45 {
                    if let Ok(Some(line)) = reader.next_line().await {
                        println!("[Tunnel Log] {}", line);
                        if let Some(mat) = re.find(&line) {
                            let m_str: &str = mat.as_str();
                            tunnel_url = Some(format!("{}/repo.json", m_str));
                            
                            // Wait additional time for tunnel to be fully ready
                            println!("[Tunnel] URL found, waiting 5 seconds for tunnel to be ready...");
                            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
            *state.tunnel_process.lock().unwrap_or_else(|p| p.into_inner()) = Some(child);
        },
        Err(e) => {
            println!("[Tunnel] Failed to setup cloudflared: {}", e);
        }
    }

    // 9. Store state
    {
        *state.lan_url.lock().unwrap_or_else(|p| p.into_inner()) = Some(lan_url.clone());
        *state.public_url.lock().unwrap_or_else(|p| p.into_inner()) = public_url.clone();
        *state.tunnel_url.lock().unwrap_or_else(|p| p.into_inner()) = tunnel_url.clone();
        *state.serve_path.lock().unwrap_or_else(|p| p.into_inner()) = Some(path);
        *state.active_port.lock().unwrap_or_else(|p| p.into_inner()) = port;
        *state.upload_limit.lock().unwrap_or_else(|p| p.into_inner()) = upload_limit;
        *state.seed.lock().unwrap_or_else(|p| p.into_inner()) = Some(server_seed.clone());
    }

    Ok(StartServerResult {
        lan_url,
        public_url,
        tunnel_url,
        upnp_success,
        seed: Some(server_seed),
    })
}

#[tauri::command]
pub fn get_repo_server_status(state: tauri::State<'_, RepoServerState>) -> Result<Option<StartServerResult>, String> {
    let tx_lock = state.shutdown_tx.lock().unwrap_or_else(|p| p.into_inner());
    let mut is_running = tx_lock.is_some();
    
    // Additional check: if shutdown_tx is None but we have stored URLs, 
    // check if the port is still in use (server might still be running)
    if !is_running {
        let port = *state.active_port.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(_lan_url) = state.lan_url.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            // Check if port is still in use
            if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", port)) {
                // Port is free, server is not running
                drop(listener);
            } else {
                // Port is in use, server is still running despite state loss
                is_running = true;
            }
        }
    }
    
    if !is_running {
        return Ok(None);
    }
    
    Ok(Some(StartServerResult {
        lan_url: state.lan_url.lock().unwrap_or_else(|p| p.into_inner()).clone().unwrap_or_default(),
        public_url: state.public_url.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        tunnel_url: state.tunnel_url.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        upnp_success: *state.upnp_mapped.lock().unwrap_or_else(|p| p.into_inner()),
        seed: state.seed.lock().unwrap_or_else(|p| p.into_inner()).clone(),
    }))
}


#[tauri::command]
pub async fn stop_repo_server(state: tauri::State<'_, RepoServerState>) -> Result<(), String> {
    // 1. Remove UPnP mapping if it exists
    {
        let mut upnp_lock = state.upnp_mapped.lock().unwrap_or_else(|p| p.into_inner());
        if *upnp_lock {
            let port = *state.active_port.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(gateway) = search_gateway(Default::default()) {
                let _ = gateway.remove_port(PortMappingProtocol::TCP, port);
            }
            *upnp_lock = false;
        }
    }

    // 2. Stop Tunnel
    let child = state.tunnel_process.lock().unwrap_or_else(|p| p.into_inner()).take();
    if let Some(mut child) = child {
        println!("[Tunnel] Stopping tunnel...");
        let _ = child.kill().await;
    }

    // 3. Shutdown the server
    let mut tx_lock = state.shutdown_tx.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(tx) = tx_lock.take() {
        // Clear state
        *state.lan_url.lock().unwrap_or_else(|p| p.into_inner()) = None;
        *state.public_url.lock().unwrap_or_else(|p| p.into_inner()) = None;
        *state.tunnel_url.lock().unwrap_or_else(|p| p.into_inner()) = None;
        *state.serve_path.lock().unwrap_or_else(|p| p.into_inner()) = None;
        state.session_download_started.lock().unwrap_or_else(|p| p.into_inner()).clear();
        state.session_download_completed.lock().unwrap_or_else(|p| p.into_inner()).clear();
        
        let _ = tx.send(());
        Ok(())
    } else {
        Err("Le serveur n'est pas en cours d'exécution".to_string())
    }
}


async fn handle_rejection(err: warp::Rejection) -> Result<impl warp::Reply, std::convert::Infallible> {
    if err.find::<BanError>().is_some() {
        Ok(warp::reply::with_status("Forbidden: Access Denied", warp::http::StatusCode::FORBIDDEN))
    } else if err.find::<WhitelistError>().is_some() {
        Ok(warp::reply::with_status("repo.errNotWhitelisted", warp::http::StatusCode::FORBIDDEN))
    } else {
        Ok(warp::reply::with_status("Not Found", warp::http::StatusCode::NOT_FOUND))
    }
}

#[tauri::command]
pub fn get_connected_clients(state: tauri::State<'_, RepoServerState>) -> Result<Vec<serde_json::Value>, String> {
    let mut result = Vec::new();

    let clients = state.connected_clients.lock().unwrap_or_else(|p| p.into_inner());
    for (key, last_seen) in clients.iter() {
        let elapsed_secs = last_seen.elapsed().as_secs();
        
        // Parse key format: "ip|creator_id"
        let parts: Vec<&str> = key.split('|').collect();
        let ip = parts.get(0).unwrap_or(&"").to_string();
        let creator_id = parts.get(1).map(|s| s.to_string()).filter(|s| !s.is_empty());
        
        // Determine protocol
        let protocol = if ip.starts_with("127.0.0.1") || ip == "::1" { "Local" }
            else if ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.") { "LAN" }
            else { "WAN" };

        result.push(serde_json::json!({
            "ip": ip,
            "creator_id": creator_id,
            "protocol": protocol,
            "last_seen": elapsed_secs,
            "status": "idle"
        }));
    }

    Ok(result)
}

#[tauri::command]
pub fn get_active_downloads(state: tauri::State<'_, RepoServerState>) -> Result<Vec<serde_json::Value>, String> {
    let mut result = Vec::new();
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;

    // 1. Get Built-in Downloads
    {
        let mut downloads = state.active_downloads.lock().unwrap_or_else(|p| p.into_inner());
        // Remove if older than 5 seconds and 100% complete
        downloads.retain(|_, dl| {
            let progress = if dl.total_size > 0 { dl.downloaded_size as f32 / dl.total_size as f32 } else { 1.0 };
            let elapsed_secs = (now_ms - dl.start_time) / 1000;
            !(progress >= 1.0 && elapsed_secs > 5)
        });

        for (ip, dl) in downloads.iter() {
            let progress = if dl.total_size > 0 { (dl.downloaded_size as f32 / dl.total_size as f32) * 100.0 } else { 100.0 };
            let elapsed_f32 = (now_ms - dl.start_time) as f32 / 1000.0;
            let speed = if elapsed_f32 > 0.0 { dl.downloaded_size as f32 / elapsed_f32 } else { 0.0 };
            
            result.push(serde_json::json!({
                "ip": ip,
                "creator_id": dl.creator_id,
                "protocol": dl.protocol,
                "file": dl.file,
                "progress": progress,
                "speed": speed,
                "downloaded": dl.downloaded_size,
                "total": dl.total_size,
            }));
        }
    }

    // 2. Aggregate Standalone Server (External Monitoring)
    if let Some(path_str) = state.serve_path.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        let monitoring_path = std::path::PathBuf::from(path_str).join("monitoring.json");
        if monitoring_path.exists() {
            if let Ok(content) = std::fs::read_to_string(monitoring_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(arr) = json.as_array() {
                        for item in arr {
                            result.push(item.clone());
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}
