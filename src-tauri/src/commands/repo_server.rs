use std::sync::Mutex;
use tokio::sync::oneshot;
use warp::Filter;
use local_ip_address::local_ip;
use std::path::PathBuf;
use igd::{search_gateway, PortMappingProtocol};
use tokio::process::{Command, Child};
use std::process::Stdio;
use tokio::io::{BufReader, AsyncBufReadExt};
use regex::Regex;

pub struct RepoServerState {
    pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    pub upnp_mapped: Mutex<bool>,
    pub tunnel_process: Mutex<Option<Child>>,
    pub lan_url: Mutex<Option<String>>,
    pub public_url: Mutex<Option<String>>,
    pub tunnel_url: Mutex<Option<String>>,
    pub serve_path: Mutex<Option<String>>,
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
        }
    }
}

async fn get_cloudflared_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = handle.path_resolver().app_data_dir().ok_or("Impossible de trouver le dossier AppData")?;
    let bin_dir = app_dir.join("bin");
    if !bin_dir.exists() {
        std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    }
    let cf_path = bin_dir.join("cloudflared.exe");

    if !cf_path.exists() {
        println!("[Tunnel] Downloading cloudflared...");
        let url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
        let response = reqwest::get(url).await.map_err(|e| format!("Erreur de téléchargement: {}", e))?;
        let bytes = response.bytes().await.map_err(|e| format!("Erreur de lecture: {}", e))?;
        std::fs::write(&cf_path, &bytes).map_err(|e| format!("Erreur d'écriture: {}", e))?;
        println!("[Tunnel] Download complete.");
    }

    Ok(cf_path)
}

#[derive(serde::Serialize)]
pub struct StartServerResult {
    pub lan_url: String,
    pub public_url: Option<String>,
    pub tunnel_url: Option<String>,
    pub upnp_success: bool,
}

#[tauri::command]
pub async fn start_repo_server(
    handle: tauri::AppHandle,
    state: tauri::State<'_, RepoServerState>,
    path: String,
) -> Result<StartServerResult, String> {
    // 1. Check if already running
    // 2. Validate path
    let serve_dir = PathBuf::from(&path);
    if !serve_dir.exists() || !serve_dir.is_dir() {
        return Err("Le dossier spécifié n'existe pas ou est invalide".to_string());
    }
    
    if !serve_dir.join("repo.json").exists() {
        return Err("Aucun repo.json trouvé dans ce dossier. Générez d'abord le repo ou pointez vers un dossier existant.".to_string());
    }

    // 3. Create graceful shutdown channel
    let (tx, rx) = oneshot::channel();
    {
        let mut tx_lock = state.shutdown_tx.lock().unwrap();
        if tx_lock.is_some() {
            return Err("Le serveur est déjà en cours d'exécution".to_string());
        }
        *tx_lock = Some(tx);
    }

    // 4. Setup warp routes with CORS
    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET"])
        .allow_headers(vec!["*"]);
    
    let dir = warp::fs::dir(serve_dir);
    let routes = dir.with(cors);

    // 5. Port and Address
    let port: u16 = 8000;
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    
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
                    public_ip = Some(gateway.get_external_ip().map(|ip| ip.to_string()).unwrap_or_else(|_| "Unknown".to_string()));
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

    // 7. Spawn the server in a Tokio task
    let (_addr_actual, server) = warp::serve(routes).bind_with_graceful_shutdown(addr, async {
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
            println!("[Tunnel] Starting cloudflared tunnel...");
            let mut child = Command::new(cf_path)
                .args(["tunnel", "--url", &format!("http://localhost:{}", port)])
                .stderr(Stdio::piped())
                .stdout(Stdio::null())
                .spawn()
                .map_err(|e| format!("Erreur au lancement du tunnel: {}", e))?;

            if let Some(stderr) = child.stderr.take() {
                let mut reader = BufReader::new(stderr).lines();
                let re = Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com").unwrap();
                
                // We wait for the URL in a separate task or just peek the first few lines
                // For simplicity, let's wait up to 10 seconds or until URL found
                let start_time = std::time::Instant::now();
                while start_time.elapsed().as_secs() < 10 {
                    let next_line: Result<Option<String>, _> = reader.next_line().await;
                    if let Ok(Some(line)) = next_line {
                        println!("[Tunnel Log] {}", line);
                        if let Some(mat) = re.find(&line) {
                            tunnel_url = Some(format!("{}/repo.json", mat.as_str()));
                            break;
                        }
                    } else if let Err(_) = next_line {
                        break;
                    } else {
                        // Ok(None) -> EOF
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
    }

    Ok(StartServerResult {
        lan_url,
        public_url,
        tunnel_url,
        upnp_success,
    })
}

#[tauri::command]
pub fn get_repo_server_current_status(state: tauri::State<'_, RepoServerState>) -> Result<Option<StartServerResult>, String> {
    let tx_lock = state.shutdown_tx.lock().unwrap();
    if tx_lock.is_none() {
        return Ok(None);
    }
    
    Ok(Some(StartServerResult {
        lan_url: state.lan_url.lock().unwrap().clone().unwrap_or_default(),
        public_url: state.public_url.lock().unwrap().clone(),
        tunnel_url: state.tunnel_url.lock().unwrap().clone(),
        upnp_success: *state.upnp_mapped.lock().unwrap(),
    }))
}

#[tauri::command]
pub async fn stop_repo_server(state: tauri::State<'_, RepoServerState>) -> Result<(), String> {
    // 1. Remove UPnP mapping if it exists
    {
        let mut upnp_lock = state.upnp_mapped.lock().unwrap();
        if *upnp_lock {
            if let Ok(gateway) = search_gateway(Default::default()) {
                let _ = gateway.remove_port(PortMappingProtocol::TCP, 8000);
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
