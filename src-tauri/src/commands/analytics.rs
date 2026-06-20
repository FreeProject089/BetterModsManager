// Telemetry / analytics — GDPR & privacy first.
//
// Design principles:
//   • OPT-IN only. Nothing is collected or sent unless `settings.analytics_consent
//     == Some(true)`. The frontend shows a clear consent prompt on first start.
//   • Local-first. Events are appended to a local queue file and flushed in
//     batches. If no endpoint is configured they simply stay on disk (no network).
//   • Transparent & erasable. The user can export the raw queued data and delete
//     everything at any time (right to access / erasure).
//   • PostHog-compatible batch payload, so the BMM team can point it at PostHog
//     (or any compatible capture endpoint) without changing the client.
//
// `distinct_id` is the Creator ID — an anonymous, hardware-derived identifier the
// user already has; no name/email is ever collected.

use std::path::PathBuf;
use tauri::{AppHandle, State};
use serde_json::{json, Value};
use crate::state::AppState;
use crate::commands::crash::log_line;

/// Gzip a byte slice (best-effort) for compressed telemetry uploads.
fn gzip_bytes(data: &[u8]) -> Option<Vec<u8>> {
    use std::io::Write;
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(data).ok()?;
    enc.finish().ok()
}

fn queue_path(app: &AppHandle) -> PathBuf {
    app.path_resolver().app_data_dir().unwrap_or_default().join("analytics_queue.jsonl")
}

fn read_queue(app: &AppHandle) -> Vec<Value> {
    std::fs::read_to_string(queue_path(app)).ok()
        .map(|s| s.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
        .unwrap_or_default()
}

fn clear_queue(app: &AppHandle) {
    let _ = std::fs::remove_file(queue_path(app));
}

fn consent_granted(state: &State<AppState>) -> bool {
    state.data.lock().map(|d| d.settings.analytics_consent == Some(true)).unwrap_or(false)
}

// ── Consent ───────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn get_analytics_consent(state: State<AppState>) -> Option<bool> {
    state.data.lock().ok().and_then(|d| d.settings.analytics_consent)
}

#[tauri::command]
pub fn set_analytics_consent(state: State<AppState>, app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|_| "lock".to_string())?;
        data.settings.analytics_consent = Some(enabled);
    }
    let _ = state.save();
    // Declining wipes anything we'd buffered (right to erasure).
    if !enabled { let _ = std::fs::remove_file(queue_path(&app_handle)); }
    log_line(format!("[ANALYTICS] consent set to {}", enabled));
    Ok(())
}

// ── System profile (collected once, sent as a $set on the user) ───────────────
struct CimInfo {
    gpus: Vec<String>,
    os: String,
    model: String,
    manuf: String,
    board: String,
    // displays: EDID-derived monitor identity (maker|model|year) + active resolutions
    monitors: Vec<String>,
    resolutions: Vec<String>,
}

/// One CIM call: ALL GPUs, OS caption, motherboard, VM signals, and connected
/// displays (EDID identity via WmiMonitorID + active resolution per controller).
fn cim_system() -> CimInfo {
    let script = "$ErrorActionPreference='SilentlyContinue';\
        Get-CimInstance Win32_VideoController | ForEach-Object { Write-Output \"GPU=$($_.Name)\"; if($_.CurrentHorizontalResolution){ Write-Output \"RES=$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)@$($_.CurrentRefreshRate)\" } };\
        $o=(Get-CimInstance Win32_OperatingSystem).Caption;\
        $cs=Get-CimInstance Win32_ComputerSystem;\
        $bb=Get-CimInstance Win32_BaseBoard;\
        Write-Output \"OS=$o\";\
        Write-Output \"MODEL=$($cs.Model)\"; Write-Output \"MANUF=$($cs.Manufacturer)\";\
        Write-Output \"BOARD=$($bb.Manufacturer) $($bb.Product)\";\
        Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | ForEach-Object {\
            $mk=(($_.ManufacturerName | Where-Object {$_ -gt 0} | ForEach-Object {[char]$_}) -join '');\
            $nm=(($_.UserFriendlyName | Where-Object {$_ -gt 0} | ForEach-Object {[char]$_}) -join '');\
            Write-Output \"MON=$mk|$nm|$($_.YearOfManufacture)\" }";
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output();
    let mut info = CimInfo { gpus: Vec::new(), os: String::new(), model: String::new(), manuf: String::new(), board: String::new(), monitors: Vec::new(), resolutions: Vec::new() };
    if let Ok(o) = out {
        for line in String::from_utf8_lossy(&o.stdout).lines() {
            if let Some(v) = line.strip_prefix("GPU=") { let v = v.trim(); if !v.is_empty() { info.gpus.push(v.to_string()); } }
            else if let Some(v) = line.strip_prefix("RES=") { let v = v.trim(); if !v.is_empty() && !v.starts_with("x") { info.resolutions.push(v.to_string()); } }
            else if let Some(v) = line.strip_prefix("MON=") { let v = v.trim().trim_matches('|'); if !v.is_empty() && v != "||" { info.monitors.push(v.to_string()); } }
            else if let Some(v) = line.strip_prefix("OS=") { info.os = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("MODEL=") { info.model = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("MANUF=") { info.manuf = v.trim().to_string(); }
            else if let Some(v) = line.strip_prefix("BOARD=") { info.board = v.trim().to_string(); }
        }
    }
    info
}

/// Pick the most relevant GPU (the discrete one): score by vendor, prefer dGPU.
fn pick_best_gpu(names: &[String]) -> String {
    let score = |n: &str| -> i32 {
        let l = n.to_lowercase();
        if l.contains("nvidia") || l.contains("geforce") || l.contains("rtx") || l.contains("gtx") || l.contains("quadro") { 4 }
        else if l.contains("radeon") || l.contains("amd ") || l.contains(" rx ") || l.contains("firepro") { 4 }
        else if l.contains("arc") { 3 }
        else if l.contains("iris") || l.contains("intel") || l.contains("uhd") || l.contains("vega") { 2 }
        else if l.contains("microsoft basic") || l.contains("standard vga") || l.contains("remote") { 0 }
        else { 1 }
    };
    names.iter().max_by_key(|n| (score(n), n.len())).cloned().unwrap_or_default()
}

/// Heuristic VM detection from model/manufacturer/GPU strings.
fn detect_vm(model: &str, manuf: &str, gpu: &str) -> bool {
    let hay = format!("{} {} {}", model, manuf, gpu).to_lowercase();
    ["vmware", "virtualbox", "vbox", "kvm", "qemu", "hyper-v", "hyperv", "virtual machine",
     "xen", "parallels", "bochs", "innotek", "microsoft corporation virtual"]
        .iter().any(|s| hay.contains(s))
}

/// Best-effort public IP (HTTPS to a plain IP-echo service). Empty on failure.
async fn public_ip() -> String {
    let client = match reqwest::Client::builder().timeout(std::time::Duration::from_secs(6)).build() {
        Ok(c) => c, Err(_) => return String::new(),
    };
    match client.get("https://api.ipify.org").send().await {
        Ok(r) => r.text().await.unwrap_or_default().trim().to_string(),
        Err(_) => String::new(),
    }
}

/// The drive root of a path (e.g. "C:" on Windows), for "same disk?" comparisons.
fn drive_of(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    if s.len() >= 2 && s.as_bytes()[1] == b':' { s[..2].to_uppercase() }
    else { s.split('\\').next().unwrap_or("").to_string() }
}

/// Per-disk hardware info (count, type, size) — no contents, just the drives.
fn collect_disks() -> (Value, f64) {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let mut list = Vec::new();
    let mut total = 0.0_f64;
    let mut seen = std::collections::HashSet::new();
    for d in disks.iter() {
        let name = d.name().to_string_lossy().to_string();
        // sysinfo lists each mount; dedupe by name so we count physical-ish drives once.
        if !seen.insert(format!("{}|{}", name, d.mount_point().to_string_lossy())) { continue; }
        let kind = match d.kind() { sysinfo::DiskKind::HDD => "HDD", sysinfo::DiskKind::SSD => "SSD", _ => "Unknown" };
        let size_gb = (d.total_space() as f64 / 1_073_741_824.0 * 10.0).round() / 10.0;
        total += d.total_space() as f64;
        list.push(json!({
            "type": kind,
            "size_gb": size_gb,
            "fs": d.file_system().to_string_lossy(),
            "removable": d.is_removable(),
            "mount": d.mount_point().to_string_lossy(),
        }));
    }
    (json!(list), total / 1_073_741_824.0)
}

/// Privacy-safe profile layout: counts + folder/disk topology only (NEVER paths
/// or contents). Tells us how users organise game/mods/backup across drives.
fn profile_layout(state: &State<AppState>) -> Value {
    let data = match state.data.lock() { Ok(d) => d, Err(_) => return json!({}) };
    let mut profiles = Vec::new();
    let mut total_mods = 0usize;
    for p in &data.profiles {
        let mod_count = data.mods.iter().filter(|m| m.mod_folder_path.starts_with(&p.mods_path)).count();
        total_mods += mod_count;
        let (gd, md, bd) = (drive_of(&p.game_path), drive_of(&p.mods_path), drive_of(&p.backup_path));
        let mut drives: Vec<String> = vec![gd.clone(), md.clone(), bd.clone()];
        drives.sort(); drives.dedup(); drives.retain(|s| !s.is_empty());
        let folders_distinct = p.game_path != p.mods_path && p.mods_path != p.backup_path && p.game_path != p.backup_path;
        profiles.push(json!({
            "game_name": p.game_name,
            "mod_count": mod_count,
            "disks_used": drives.len(),
            "all_same_disk": drives.len() <= 1,
            "folders_distinct": folders_distinct,
            "mods_on_game_disk": gd == md,
            "backup_on_game_disk": gd == bd,
        }));
    }
    let n = data.profiles.len();
    json!({
        "profile_count": n,
        "total_mods": total_mods,
        "avg_mods_per_profile": if n > 0 { (total_mods as f64 / n as f64 * 10.0).round() / 10.0 } else { 0.0 },
        "active_profile": data.active_profile_id.is_some(),
        "profiles": profiles,
    })
}

/// Anonymous machine profile: real OS/CPU/RAM/GPU/disk specs, motherboard, VM flag,
/// private + public IP, profile/folder topology, app version, locale, creator_id.
#[tauri::command]
pub async fn analytics_system_profile(state: State<'_, AppState>, app_handle: AppHandle) -> Result<Value, String> {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu();

    let cpu = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
    let cores = sys.cpus().len();
    let ram_gb = (sys.total_memory() as f64 / 1_073_741_824.0 * 10.0).round() / 10.0;
    let cim = cim_system();
    let gpu = pick_best_gpu(&cim.gpus);
    let is_vm = detect_vm(&cim.model, &cim.manuf, &gpu);

    let (disks_json, disk_total_gb) = collect_disks();
    let disk_count = disks_json.as_array().map(|a| a.len()).unwrap_or(0);

    let private_ip = local_ip_address::local_ip().map(|ip| ip.to_string()).unwrap_or_default();
    let public_ip = public_ip().await;

    let profiles = profile_layout(&state);
    let locale = state.data.lock().map(|d| d.settings.language.clone()).unwrap_or_default();
    let creator_id = crate::commands::security::get_creator_id(app_handle.clone()).unwrap_or_default();
    let app_version = app_handle.package_info().version.to_string();

    Ok(json!({
        "distinct_id": creator_id,
        "os": std::env::consts::OS,
        "os_caption": cim.os,
        "arch": std::env::consts::ARCH,
        "cpu": cpu,
        "cpu_cores": cores,
        "ram_gb": ram_gb,
        "gpu": gpu,
        "gpus": cim.gpus,
        "motherboard": cim.board,
        "machine_model": cim.model,
        "machine_manufacturer": cim.manuf,
        "is_vm": is_vm,
        "disk_count": disk_count,
        "disk_total_gb": (disk_total_gb * 10.0).round() / 10.0,
        "disks": disks_json,
        "monitors": cim.monitors,                 // EDID identity: maker|model|year
        "monitor_count": cim.monitors.len(),
        "resolutions": cim.resolutions,           // active resolution(s) e.g. 2560x1440@144
        "primary_resolution": cim.resolutions.first().cloned().unwrap_or_default(),
        "profiles_summary": profiles,
        "private_ip": private_ip,
        "public_ip": public_ip,
        "locale": locale,
        "app_version": app_version,
    }))
}

// ── Event tracking ────────────────────────────────────────────────────────────
fn now_iso() -> String { chrono::Utc::now().to_rfc3339() }

#[tauri::command]
pub fn analytics_track(
    state: State<AppState>,
    app_handle: AppHandle,
    event: String,
    properties: Option<Value>,
    distinct_id: Option<String>,
) -> Result<(), String> {
    if !consent_granted(&state) { return Ok(()); } // hard gate
    let p = queue_path(&app_handle);
    // Hard limit: 10MB file size to avoid unbounded growth if offline
    if let Ok(meta) = std::fs::metadata(&p) {
        if meta.len() > 10_485_760 { return Ok(()); }
    }
    let ev = json!({
        "event": event,
        "properties": properties.unwrap_or_else(|| json!({})),
        "distinct_id": distinct_id.unwrap_or_default(),
        "timestamp": now_iso(),
    });
    if let Some(parent) = p.parent() { let _ = std::fs::create_dir_all(parent); }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        use std::io::Write;
        if let Ok(s) = serde_json::to_string(&ev) {
            let _ = writeln!(file, "{}", s);
        }
    }
    Ok(())
}

/// Flush the queued events to a PostHog-compatible capture endpoint in one batch.
/// `endpoint`/`api_key` come from the frontend config; empty endpoint = keep local.
#[tauri::command]
pub async fn analytics_flush(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    endpoint: Option<String>,
    api_key: Option<String>,
) -> Result<usize, String> {
    if !consent_granted(&state) { return Ok(0); }
    let endpoint = match endpoint.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(e) if e.starts_with("https://") => e.to_string(),
        _ => return Ok(0), // not configured (or not HTTPS) → keep buffering locally
    };
    let batch = read_queue(&app_handle);
    if batch.is_empty() { return Ok(0); }

    // Each flush is a "packet" with a random id. The id lets the user later request
    // erasure of that exact batch (the dashboard deletes everything tagged with it).
    let packet_id = uuid::Uuid::new_v4().to_string();
    let body = json!({ "api_key": api_key.unwrap_or_default(), "packet_id": packet_id, "batch": batch });
    let client = reqwest::Client::builder()
        .user_agent("BetterModsManager")
        .timeout(std::time::Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?;
    // Gzip the payload (telemetry batches — especially rrweb replay chunks —
    // compress heavily) to cut upload size & bandwidth. The server transparently
    // decompresses Content-Encoding: gzip request bodies.
    let raw = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let req = match gzip_bytes(&raw) {
        Some(gz) => client.post(&endpoint)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::CONTENT_ENCODING, "gzip")
            .body(gz),
        None => client.post(&endpoint).json(&body),
    };
    let resp = match req.send().await {
        Ok(r) => r,
        Err(_) => return Ok(0), // Silently fail on network error to prevent console spam
    };
    if resp.status().is_success() {
        let n = batch.len();
        clear_queue(&app_handle); // clear only after a confirmed send
        // Record the sent packet locally: id + time + count + a privacy-safe
        // breakdown of WHICH event types it held (names + counts only — never the
        // property values / content).
        let mut summary: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
        for ev in &batch {
            if let Some(e) = ev.get("event").and_then(|v| v.as_str()) {
                *summary.entry(e.to_string()).or_insert(0) += 1;
            }
        }
        let mut log = read_sent(&app_handle);
        log.push(json!({ "id": packet_id, "ts": now_iso(), "count": n, "deletion_requested": false, "events": summary }));
        if log.len() > 500 { let d = log.len() - 500; log.drain(0..d); }
        write_sent(&app_handle, &log);
        Ok(n)
    } else {
        if resp.status() == reqwest::StatusCode::PAYLOAD_TOO_LARGE {
            // Unrecoverable, drop the queue so it doesn't loop forever causing lag
            let _ = std::fs::remove_file(queue_path(&app_handle));
            return Ok(0);
        }
        Ok(0) // Silently fail on other HTTP errors to prevent console spam
    }
}

// ── Sent-packet log + per-packet deletion request ─────────────────────────────
fn sent_path(app: &AppHandle) -> PathBuf {
    app.path_resolver().app_data_dir().unwrap_or_default().join("analytics_sent.json")
}
fn read_sent(app: &AppHandle) -> Vec<Value> {
    std::fs::read_to_string(sent_path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn write_sent(app: &AppHandle, v: &[Value]) {
    let p = sent_path(app);
    if let Some(parent) = p.parent() { let _ = std::fs::create_dir_all(parent); }
    if let Ok(s) = serde_json::to_string_pretty(v) { let _ = std::fs::write(p, s); }
}

/// The log of packets BMM has sent (id + time + event count — never the content),
/// newest first, so the user can request deletion of any one.
#[tauri::command]
pub fn analytics_sent_packets(app_handle: AppHandle) -> Vec<Value> {
    let mut v = read_sent(&app_handle);
    v.reverse();
    v
}

/// Ask the dashboard to erase one previously-sent packet. The deletion is applied
/// after a mandatory 72h delay (time for an admin to review) — never instantly.
#[tauri::command]
pub async fn analytics_request_deletion(
    app_handle: AppHandle,
    packet_id: String,
    endpoint: Option<String>,
    api_key: Option<String>,
) -> Result<(), String> {
    let base = endpoint.unwrap_or_default();
    // Derive the delete URL from the configured /batch/ endpoint.
    let url = base.trim().trim_end_matches('/').trim_end_matches("/batch").to_string() + "/delete-request";
    if !url.starts_with("https://") { return Err("telemetry endpoint not configured".into()); }

    let client = reqwest::Client::builder().user_agent("BetterModsManager")
        .timeout(std::time::Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
    let body = json!({ "api_key": api_key.unwrap_or_default(), "packet_id": packet_id });
    let resp = client.post(&url).json(&body).send().await.map_err(|e| format!("request failed: {}", e))?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    // The dashboard returns when the packet will be auto-erased (≤ delay window).
    let scheduled = resp.json::<Value>().await.ok()
        .and_then(|j| j.get("scheduled_at").and_then(|v| v.as_i64()));

    // Mark it locally so the UI shows "deletion requested" + the erase date.
    let mut log = read_sent(&app_handle);
    for p in log.iter_mut() {
        if p.get("id").and_then(|v| v.as_str()) == Some(packet_id.as_str()) {
            if let Some(o) = p.as_object_mut() {
                o.insert("deletion_requested".into(), Value::Bool(true));
                o.insert("deletion_requested_at".into(), Value::String(now_iso()));
                if let Some(s) = scheduled { o.insert("deletion_scheduled_at".into(), json!(s)); }
            }
        }
    }
    write_sent(&app_handle, &log);
    log_line(format!("[ANALYTICS] deletion requested for packet {}", packet_id));
    Ok(())
}

/// Transparency: return everything currently buffered (right to access).
#[tauri::command]
pub fn analytics_export(app_handle: AppHandle) -> Result<String, String> {
    let q = read_queue(&app_handle);
    serde_json::to_string_pretty(&q).map_err(|e| e.to_string())
}

/// Auto-saves a local replay bundle to the `Replays` folder without prompting.
#[tauri::command]
pub fn save_local_replay(app_handle: AppHandle, content: String) -> Result<String, String> {
    let dir = app_handle.path_resolver().app_data_dir().unwrap_or_default().join("Replays");
    let _ = std::fs::create_dir_all(&dir);
    let name = format!("bmm-session-{}.bmmreplay", chrono::Utc::now().timestamp_millis());
    let path = dir.join(&name);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    log_line(format!("[ANALYTICS] Auto-saved local replay to {:?}", path));

    // Limit to 20 local replays
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let mut files: Vec<PathBuf> = entries.filter_map(Result::ok).map(|e| e.path())
            .filter(|p| p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("bmmreplay")).collect();
        files.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH));
        if files.len() > 20 {
            for p in files.iter().take(files.len() - 20) {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    Ok(path.to_string_lossy().to_string())
}

/// Delete a specific replay file.
#[tauri::command]
pub fn delete_local_replay(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}


/// Right to erasure: wipe all locally buffered telemetry.
#[tauri::command]
pub fn analytics_clear(app_handle: AppHandle) -> Result<(), String> {
    let _ = std::fs::remove_file(queue_path(&app_handle));
    Ok(())
}

/// Clears the local sent-packet history list (does not affect the server).
#[tauri::command]
pub fn analytics_clear_sent_log(app_handle: AppHandle) -> Result<(), String> {
    let _ = std::fs::remove_file(sent_path(&app_handle));
    Ok(())
}

/// Read a Tauri asset image (asset://localhost/… or https://asset.localhost/…)
/// from disk and return it as a data: URL. Used by the session-replay recorder
/// (full mode only) so the remote dashboard can show local images it cannot
/// fetch. Capped at 3 MB; returns "" on any failure.
#[tauri::command]
pub fn replay_asset_data_url(url: String) -> String {
    use base64::Engine;
    // Strip scheme + host → percent-encoded absolute file path.
    let after_host = if let Some(i) = url.find("asset.localhost/") {
        &url[i + "asset.localhost/".len()..]
    } else if let Some(rest) = url.strip_prefix("asset://localhost/") {
        rest
    } else if let Some(rest) = url.strip_prefix("asset://") {
        rest
    } else {
        return String::new();
    };
    let enc = after_host.split(|c| c == '?' || c == '#').next().unwrap_or("");
    let path_str = percent_encoding::percent_decode_str(enc).decode_utf8_lossy().to_string();
    let path = std::path::PathBuf::from(path_str);
    let meta = match std::fs::metadata(&path) { Ok(m) => m, Err(_) => return String::new() };
    if !meta.is_file() || meta.len() > 3 * 1024 * 1024 { return String::new(); }
    let bytes = match std::fs::read(&path) { Ok(b) => b, Err(_) => return String::new() };
    let mime = match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    format!("data:{mime};base64,{b64}")
}
