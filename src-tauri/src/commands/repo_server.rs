use std::sync::Mutex;
use tokio::sync::oneshot;
use warp::Filter;
use local_ip_address::local_ip;
use std::path::PathBuf;
use igd::{search_gateway, PortMappingProtocol};

pub struct RepoServerState {
    pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    pub upnp_mapped: Mutex<bool>,
}

impl Default for RepoServerState {
    fn default() -> Self {
        Self {
            shutdown_tx: Mutex::new(None),
            upnp_mapped: Mutex::new(false),
        }
    }
}

#[derive(serde::Serialize)]
pub struct StartServerResult {
    pub lan_url: String,
    pub public_url: Option<String>,
    pub upnp_success: bool,
}

#[tauri::command]
pub async fn start_repo_server(
    state: tauri::State<'_, RepoServerState>,
    path: String,
) -> Result<StartServerResult, String> {
    // 1. Check if already running
    let mut tx_lock = state.shutdown_tx.lock().unwrap();
    if tx_lock.is_some() {
        return Err("Le serveur est déjà en cours d'exécution".to_string());
    }

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
    *tx_lock = Some(tx);

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

    Ok(StartServerResult {
        lan_url,
        public_url,
        upnp_success,
    })
}

#[tauri::command]
pub async fn stop_repo_server(state: tauri::State<'_, RepoServerState>) -> Result<(), String> {
    // 1. Remove UPnP mapping if it exists
    let mut upnp_lock = state.upnp_mapped.lock().unwrap();
    if *upnp_lock {
        if let Ok(gateway) = search_gateway(Default::default()) {
            let _ = gateway.remove_port(PortMappingProtocol::TCP, 8000);
        }
        *upnp_lock = false;
    }

    // 2. Shutdown the server
    let mut tx_lock = state.shutdown_tx.lock().unwrap();
    if let Some(tx) = tx_lock.take() {
        let _ = tx.send(());
        Ok(())
    } else {
        Err("Le serveur n'est pas en cours d'exécution".to_string())
    }
}
