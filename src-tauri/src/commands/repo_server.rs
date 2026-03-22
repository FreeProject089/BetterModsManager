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
        }
    }
}

async fn get_cloudflared_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. Check user settings first
    let state = handle.state::<crate::state::AppState>();
    let settings = {
        let data = state.data.lock().unwrap();
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

        let response = client.get(&url).send().await.map_err(|e| format!("Erreur de téléchargement: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("Échec du téléchargement (Status {}): {}", response.status(), url));
        }

        let bytes = response.bytes().await.map_err(|e| format!("Erreur de lecture: {}", e))?;
        std::fs::write(&cf_path, &bytes).map_err(|e| format!("Erreur d'écriture: {}", e))?;
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
        let mut tx_lock = state.shutdown_tx.lock().unwrap();
        if tx_lock.is_some() {
            return Err("Le serveur est déjà en cours d'exécution".to_string());
        }
        *tx_lock = Some(tx);
    }

    // 4. Setup warp routes with CORS and Ban Check


    let active_downloads = state.active_downloads.clone();
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

                if !full_path.is_file() {
                    println!("[Server] File Not Found: {} (decoded: {}) -> {:?}", rel_path_encoded, rel_path, full_path);
                    return Err(warp::reject::not_found());
                }

                let file = tokio::fs::File::open(&full_path).await.map_err(|_| warp::reject::not_found())?;
                let metadata = file.metadata().await.map_err(|_| warp::reject::not_found())?;
                let total_size = metadata.len();
                let file_name = rel_path.to_string();

                let upload_limit = *state.upload_limit.lock().unwrap();
                let stream = ReaderStream::new(file);
                let active_downloads_inner = active_downloads.clone();
                let ip_clone = ip.clone();

                // Track the download in state
                {
                    let mut dl_lock = active_downloads_inner.lock().unwrap();
                    let protocol = if ip.starts_with("127.0.0.1") || ip == "::1" { "Local" }
                        else if ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.") { "LAN" }
                        else { "WAN" };

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

                let tracked_stream = stream.map(move |chunk: std::io::Result<Bytes>| {
                    if let Ok(ref bytes) = chunk {
                        let mut dl_lock = active_downloads_inner.lock().unwrap();
                        if let Some(dl) = dl_lock.get_mut(&ip_clone) {
                            dl.downloaded_size += bytes.len() as u64;
                        }
                    }
                    chunk
                });

                let bytes_sent_acc = Arc::new(AsyncMutex::new(0usize));
                let interval_start = Arc::new(AsyncMutex::new(std::time::Instant::now()));

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

                let content_type = if full_path.extension().map(|e| e == "json").unwrap_or(false) { "application/json" }
                    else if full_path.extension().map(|e| e == "zip").unwrap_or(false) { "application/zip" }
                    else { "application/octet-stream" };

                let response = warp::http::Response::builder()
                    .header("Content-Length", total_size)
                    .header("Content-Type", content_type)
                    .body(warp::hyper::Body::wrap_stream(final_stream))
                    .map_err(|_| warp::reject::not_found())?;

                Ok::<_, warp::Rejection>(response)
            }
        });

    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET"])
        .allow_headers(vec!["*", "x-creator-key", "x-creator-id"]);
    
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
                    *state.upnp_mapped.lock().unwrap() = true;
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
                .spawn()
                .map_err(|e| format!("Erreur au lancement du tunnel: {}", e))?;

            if let Some(stderr) = child.stderr.take() {
                let mut reader = BufReader::new(stderr).lines();
                let re = Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com").unwrap();
                
                let start_time = std::time::Instant::now();
                while start_time.elapsed().as_secs() < 30 {
                    if let Ok(Some(line)) = reader.next_line().await {
                        println!("[Tunnel Log] {}", line);
                        if let Some(mat) = re.find(&line) {
                            let m_str: &str = mat.as_str();
                            tunnel_url = Some(format!("{}/repo.json", m_str));
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
            *state.tunnel_process.lock().unwrap() = Some(child);
        },
        Err(e) => {
            println!("[Tunnel] Failed to setup cloudflared: {}", e);
        }
    }

    // 9. Store state
    {
        *state.lan_url.lock().unwrap() = Some(lan_url.clone());
        *state.public_url.lock().unwrap() = public_url.clone();
        *state.tunnel_url.lock().unwrap() = tunnel_url.clone();
        *state.serve_path.lock().unwrap() = Some(path);
        *state.active_port.lock().unwrap() = port;
        *state.upload_limit.lock().unwrap() = upload_limit;
        *state.seed.lock().unwrap() = Some(server_seed.clone());
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
    let tx_lock = state.shutdown_tx.lock().unwrap();
    if tx_lock.is_none() {
        return Ok(None);
    }
    
    Ok(Some(StartServerResult {
        lan_url: state.lan_url.lock().unwrap().clone().unwrap_or_default(),
        public_url: state.public_url.lock().unwrap().clone(),
        tunnel_url: state.tunnel_url.lock().unwrap().clone(),
        upnp_success: *state.upnp_mapped.lock().unwrap(),
        seed: state.seed.lock().unwrap().clone(),
    }))
}

#[tauri::command]
pub async fn stop_repo_server(state: tauri::State<'_, RepoServerState>) -> Result<(), String> {
    // 1. Remove UPnP mapping if it exists
    {
        let mut upnp_lock = state.upnp_mapped.lock().unwrap();
        if *upnp_lock {
            let port = *state.active_port.lock().unwrap();
            if let Ok(gateway) = search_gateway(Default::default()) {
                let _ = gateway.remove_port(PortMappingProtocol::TCP, port);
            }
            *upnp_lock = false;
        }
    }

    // 2. Stop Tunnel
    let child = state.tunnel_process.lock().unwrap().take();
    if let Some(mut child) = child {
        println!("[Tunnel] Stopping tunnel...");
        let _ = child.kill().await;
    }

    // 3. Shutdown the server
    let mut tx_lock = state.shutdown_tx.lock().unwrap();
    if let Some(tx) = tx_lock.take() {
        // Clear state
        *state.lan_url.lock().unwrap() = None;
        *state.public_url.lock().unwrap() = None;
        *state.tunnel_url.lock().unwrap() = None;
        *state.serve_path.lock().unwrap() = None;
        
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
pub fn get_active_downloads(state: tauri::State<'_, RepoServerState>) -> Result<Vec<serde_json::Value>, String> {
    let mut result = Vec::new();
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;

    // 1. Get Built-in Downloads
    {
        let mut downloads = state.active_downloads.lock().unwrap();
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
    if let Some(path_str) = state.serve_path.lock().unwrap().as_ref() {
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
