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

use tauri::Manager;
use std::path::{Path, PathBuf};
use std::io::Write;
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
    app.path().app_data_dir().ok().unwrap_or_default().join("analytics_queue.jsonl")
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
    let out = crate::commands::proc::hidden_command("powershell")
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
    match crate::commands::net::client()
        .get("https://api.ipify.org")
        .timeout(std::time::Duration::from_secs(6))
        .send().await
    {
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

/// EXTRA precise hardware identity — only collected when the user opts into the
/// weekly-benchmark / extra mode. Includes serials & identifiers (motherboard SN,
/// machine UUID, BIOS version, disk serials, MAC, TPM/Secure-Boot/UEFI, OS build…)
/// gathered in one PowerShell/WMI pass. Windows-only (empty object elsewhere).
fn collect_extra_hardware() -> Value {
    #[cfg(not(target_os = "windows"))]
    { return json!({}); }
    #[cfg(target_os = "windows")]
    {
        let script = "$ErrorActionPreference='SilentlyContinue';\
            $bb=Get-CimInstance Win32_BaseBoard; Write-Output \"BOARD_SN=$($bb.SerialNumber)\"; Write-Output \"BOARD=$($bb.Manufacturer) $($bb.Product)\";\
            $bios=Get-CimInstance Win32_BIOS; Write-Output \"BIOS_VER=$($bios.SMBIOSBIOSVersion)\"; Write-Output \"BIOS_DATE=$($bios.ReleaseDate)\"; Write-Output \"BIOS_MAN=$($bios.Manufacturer)\";\
            $csp=Get-CimInstance Win32_ComputerSystemProduct; Write-Output \"UUID=$($csp.UUID)\";\
            $os=Get-CimInstance Win32_OperatingSystem; Write-Output \"OS_VER=$($os.Version)\"; Write-Output \"OS_BUILD=$($os.BuildNumber)\";\
            $cs=Get-CimInstance Win32_ComputerSystem; Write-Output \"LOGICAL=$($cs.NumberOfLogicalProcessors)\";\
            $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; Write-Output \"CORES=$($cpu.NumberOfCores)\"; Write-Output \"THREADS=$($cpu.ThreadCount)\"; Write-Output \"L2=$($cpu.L2CacheSize)\"; Write-Output \"L3=$($cpu.L3CacheSize)\";\
            $fw=$env:firmware_type; if(-not $fw){ try { $fw=(Get-ComputerInfo -Property BiosFirmwareType).BiosFirmwareType } catch {} }; Write-Output \"FIRMWARE=$fw\";\
            try { Write-Output \"SECUREBOOT=$(Confirm-SecureBootUEFI)\" } catch { Write-Output \"SECUREBOOT=unknown\" };\
            try { $tpm=Get-Tpm; Write-Output \"TPM=$($tpm.TpmPresent)/$($tpm.TpmReady)\" } catch { Write-Output \"TPM=unknown\" };\
            Get-CimInstance Win32_DiskDrive | ForEach-Object { Write-Output \"DISK=$($_.Model)|$($_.SerialNumber)|$([math]::Round($_.Size/1GB))|$($_.InterfaceType)\" };\
            Get-CimInstance Win32_NetworkAdapter -Filter \"PhysicalAdapter=true AND MACAddress IS NOT NULL\" | ForEach-Object { Write-Output \"MAC=$($_.MACAddress)\" }";
        let out = crate::commands::proc::hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output();
        let mut o = serde_json::Map::new();
        let mut disks: Vec<Value> = Vec::new();
        let mut macs: Vec<Value> = Vec::new();
        if let Ok(out) = out {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let (k, v) = match line.split_once('=') { Some(kv) => kv, None => continue };
                let v = v.trim();
                let put = |o: &mut serde_json::Map<String, Value>, key: &str| { o.insert(key.into(), json!(v)); };
                match k {
                    "BOARD_SN" => put(&mut o, "motherboard_serial"),
                    "BOARD" => put(&mut o, "motherboard"),
                    "BIOS_VER" => put(&mut o, "bios_version"),
                    "BIOS_DATE" => put(&mut o, "bios_date"),
                    "BIOS_MAN" => put(&mut o, "bios_manufacturer"),
                    "UUID" => put(&mut o, "machine_uuid"),
                    "OS_VER" => put(&mut o, "os_version"),
                    "OS_BUILD" => put(&mut o, "os_build"),
                    "LOGICAL" => { o.insert("logical_processors".into(), json!(v.parse::<i64>().unwrap_or(0))); }
                    "CORES" => { o.insert("cpu_cores".into(), json!(v.parse::<i64>().unwrap_or(0))); }
                    "THREADS" => { o.insert("cpu_threads".into(), json!(v.parse::<i64>().unwrap_or(0))); }
                    "L2" => { o.insert("l2_cache_kb".into(), json!(v.parse::<i64>().unwrap_or(0))); }
                    "L3" => { o.insert("l3_cache_kb".into(), json!(v.parse::<i64>().unwrap_or(0))); }
                    "FIRMWARE" => put(&mut o, "firmware_type"),  // "1"=BIOS/legacy "2"=UEFI, or text
                    "SECUREBOOT" => put(&mut o, "secure_boot"),
                    "TPM" => put(&mut o, "tpm"),                 // "present/ready"
                    "DISK" => {
                        let p: Vec<&str> = v.split('|').collect();
                        disks.push(json!({
                            "model": p.first().copied().unwrap_or("").trim(),
                            "serial": p.get(1).copied().unwrap_or("").trim(),
                            "size_gb": p.get(2).and_then(|s| s.trim().parse::<i64>().ok()).unwrap_or(0),
                            "interface": p.get(3).copied().unwrap_or("").trim(),
                        }));
                    }
                    "MAC" => { if !v.is_empty() { macs.push(json!(v)); } }
                    _ => {}
                }
            }
        }
        o.insert("disks".into(), json!(disks));
        o.insert("mac_addresses".into(), json!(macs));
        json!(o)
    }
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
pub async fn analytics_system_profile(state: State<'_, AppState>, app_handle: AppHandle, extra: Option<bool>) -> Result<Value, String> {
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
    // Precise hardware identity — ONLY when the user opted into extra mode (weekly bench).
    let hw_extra = if extra == Some(true) { collect_extra_hardware() } else { Value::Null };

    Ok(json!({
        "distinct_id": creator_id,
        "hw_extra": hw_extra,
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

/// Telemetry is sent over HTTPS in production. For LOCAL dev we also accept plain
/// http to LOOPBACK (localhost / 127.0.0.1 / *.localhost) so the desktop app can post
/// to a local BCWEB/telemetry stack without an HTTPS tunnel. Never plaintext to a
/// non-loopback host (that would leak telemetry in the clear over the network).
fn endpoint_allowed(e: &str) -> bool {
    let e = e.trim();
    e.starts_with("https://")
        || e.starts_with("http://localhost")
        || e.starts_with("http://127.0.0.1")
        || e.starts_with("http://telemetry.localhost:5176")
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
        Some(e) if endpoint_allowed(e) => e.to_string(),
        _ => return Ok(0), // not configured (or plaintext to a remote host) → keep buffering locally
    };
    let batch = read_queue(&app_handle);
    if batch.is_empty() { return Ok(0); }

    // Each flush is a "packet" with a random id. The id lets the user later request
    // erasure of that exact batch (the dashboard deletes everything tagged with it).
    let packet_id = uuid::Uuid::new_v4().to_string();
    let body = json!({ "api_key": api_key.unwrap_or_default(), "packet_id": packet_id, "batch": batch });
    // Gzip the payload (telemetry batches — especially rrweb replay chunks —
    // compress heavily) to cut upload size & bandwidth. The server transparently
    // decompresses Content-Encoding: gzip request bodies.
    let raw = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let req = match gzip_bytes(&raw) {
        Some(gz) => crate::commands::net::client().post(&endpoint)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::CONTENT_ENCODING, "gzip")
            .body(gz),
        None => crate::commands::net::client().post(&endpoint).json(&body),
    };
    // UA + timeout per-request (the shared client carries neither) — preserves the
    // previous behaviour without rebuilding a client for every flush.
    let req = req
        .header(reqwest::header::USER_AGENT, "BetterModsManager")
        .timeout(std::time::Duration::from_secs(15));
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
    app.path().app_data_dir().ok().unwrap_or_default().join("analytics_sent.json")
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

/// Query the dashboard for the received/processed status of previously-sent
/// packets. Routed through Rust (reqwest) rather than a webview fetch: the
/// browser fetch needs the custom `ngrok-skip-browser-warning` header, which
/// forces a CORS preflight that ngrok-free's interstitial intercepts (no
/// Access-Control-Allow-Origin). reqwest has no CORS and sends a non-browser
/// User-Agent, so it reaches the endpoint directly. Returns the `statuses` map
/// ({ id: status }); empty object on any failure (best-effort, never throws).
#[tauri::command]
pub async fn analytics_packet_status(
    endpoint: Option<String>,
    ids: Vec<String>,
) -> Value {
    let base = endpoint.unwrap_or_default();
    let base = base.trim().trim_end_matches('/').trim_end_matches("/batch");
    if !endpoint_allowed(base) || ids.is_empty() {
        return json!({});
    }
    let url = format!("{}/api/packet-status?ids={}", base, ids.join(","));
    let resp = match crate::commands::net::client()
        .get(&url)
        .header(reqwest::header::USER_AGENT, "BetterModsManager")
        .timeout(std::time::Duration::from_secs(10))
        .header("ngrok-skip-browser-warning", "true")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return json!({}),
    };
    if !resp.status().is_success() {
        return json!({});
    }
    resp.json::<Value>()
        .await
        .ok()
        .and_then(|j| j.get("statuses").cloned())
        .unwrap_or_else(|| json!({}))
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
    if !endpoint_allowed(&url) { return Err("telemetry endpoint not configured".into()); }

    let body = json!({ "api_key": api_key.unwrap_or_default(), "packet_id": packet_id });
    let resp = crate::commands::net::client().post(&url)
        .header(reqwest::header::USER_AGENT, "BetterModsManager")
        .timeout(std::time::Duration::from_secs(15))
        .json(&body).send().await.map_err(|e| format!("request failed: {}", e))?;
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

/// Right to access (GDPR): file a request for a copy of all data tied to this
/// Creator ID. An admin reviews it on the dashboard and e-mails the export back
/// manually (we never auto-send personal data to an unverified address).
#[tauri::command]
pub async fn analytics_request_data(
    app_handle: AppHandle,
    email: String,
    endpoint: Option<String>,
    api_key: Option<String>,
) -> Result<(), String> {
    let email = email.trim().to_string();
    if !email.contains('@') || email.len() < 5 { return Err("invalid email".into()); }
    let base = endpoint.unwrap_or_default();
    let url = base.trim().trim_end_matches('/').trim_end_matches("/batch").to_string() + "/data-request";
    if !endpoint_allowed(&url) { return Err("telemetry endpoint not configured".into()); }
    let creator_id = crate::commands::security::get_creator_id(app_handle.clone()).unwrap_or_default();

    let body = json!({ "api_key": api_key.unwrap_or_default(), "creator_id": creator_id, "email": email });
    let resp = crate::commands::net::client().post(&url)
        .header(reqwest::header::USER_AGENT, "BetterModsManager")
        .timeout(std::time::Duration::from_secs(15))
        .json(&body).send().await.map_err(|e| format!("request failed: {}", e))?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    log_line(format!("[ANALYTICS] data-access request filed for creator {}", creator_id));
    Ok(())
}

/// Transparency: return everything currently buffered (right to access).
#[tauri::command]
pub fn analytics_export(app_handle: AppHandle) -> Result<String, String> {
    let q = read_queue(&app_handle);
    serde_json::to_string_pretty(&q).map_err(|e| e.to_string())
}

// ─── REPLAY SPOOL ────────────────────────────────────────────────────────────
//
// The session recorder used to hold the whole rrweb event stream in the webview and
// re-serialise it in full every 45s, which is what put Tauri out of memory on a long
// idle session. It now streams events here as they happen and this module assembles
// the .bmmreplay at flush time — so the frontend's peak is one small batch, and the
// full document only ever exists as bytes moving through a file handle.
//
// Layout:  <appdata>/Spool/<id>/seg-000001.ndjson …   one JSON event per line.
// A segment == one rrweb "checkout" chunk, and each starts with a full snapshot, so a
// segment is self-contained: dropping the oldest whole segment always leaves something
// playable. That is what makes the rolling window a file delete instead of an array copy.

fn spool_root(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().ok().unwrap_or_default().join("Spool")
}
/// Resolve a spool id to its directory, refusing anything that isn't a plain name —
/// the id crosses the IPC boundary, so `..` must not be able to walk out (CWE-22).
fn spool_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid spool id".into());
    }
    Ok(spool_root(app).join(id))
}
fn segment_files(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| rd.flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "ndjson").unwrap_or(false))
            .collect())
        .unwrap_or_default();
    v.sort();     // zero-padded names ⇒ lexicographic order is chronological
    v
}

/// Open a spool for a new recording session. Also clears any spool left behind by a
/// previous run that never got to finalise (a hard crash), so they can't accumulate.
#[tauri::command]
pub fn replay_spool_begin(app_handle: AppHandle) -> Result<String, String> {
    let root = spool_root(&app_handle);
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() { let _ = std::fs::remove_dir_all(e.path()); }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let dir = spool_dir(&app_handle, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Append a batch of already-serialised events to segment `seq`. `lines` is the batch
/// joined by \n — the frontend serialises one event at a time, so nothing large is ever
/// held on that side. Returns the spool's total size so the caller can decide to trim.
#[tauri::command]
pub fn replay_spool_append(app_handle: AppHandle, id: String, seq: u32, lines: String) -> Result<u64, String> {
    let dir = spool_dir(&app_handle, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("seg-{:06}.ndjson", seq));
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    f.write_all(lines.as_bytes()).map_err(|e| e.to_string())?;
    if !lines.ends_with('\n') { f.write_all(b"\n").map_err(|e| e.to_string())?; }
    Ok(segment_files(&dir).iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum())
}

/// Rolling window: delete oldest whole segments until the spool fits `max_bytes`.
/// Never deletes the last one — a spool with no segments would mean no recording at all.
#[tauri::command]
pub fn replay_spool_trim(app_handle: AppHandle, id: String, max_bytes: u64) -> Result<u64, String> {
    let dir = spool_dir(&app_handle, &id)?;
    let mut files = segment_files(&dir);
    let size = |p: &PathBuf| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let mut total: u64 = files.iter().map(size).sum();
    while total > max_bytes && files.len() > 1 {
        let oldest = files.remove(0);
        total = total.saturating_sub(size(&oldest));
        let _ = std::fs::remove_file(&oldest);
    }
    Ok(total)
}

/// Assemble the spool into a real .bmmreplay, STREAMING: the events array is copied
/// line by line straight from the segments, so peak memory is one event — never the
/// whole session. `meta_json` / `console_json` are small JSON fragments from the caller.
/// `mode` = "crash" (the single rolling buffer a crash report attaches) or "list" (a
/// saved replay). `dest_path` overrides both, for "export to a file the user picked".
/// Returns the written path.
#[tauri::command]
pub fn replay_spool_finalize(
    app_handle: AppHandle,
    id: String,
    meta_json: String,
    console_json: String,
    rust_log: String,
    mode: String,
    dest_path: Option<String>,
) -> Result<String, String> {
    let dir = spool_dir(&app_handle, &id)?;
    let files = segment_files(&dir);
    if files.is_empty() { return Err("empty spool".into()); }

    let app_dir = app_handle.path().app_data_dir().ok().unwrap_or_default();
    let out_path = if let Some(p) = dest_path.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(p)      // the user picked it in the save dialog
    } else if mode == "list" {
        let d = app_dir.join("Replays");
        let _ = std::fs::create_dir_all(&d);
        d.join(format!("bmm-session-{}.bmmreplay", chrono::Utc::now().timestamp_millis()))
    } else {
        let _ = std::fs::create_dir_all(&app_dir);
        app_dir.join("last_crash_session.bmmreplay")
    };
    // Write to a temp file and rename, so a crash mid-write can never leave a truncated
    // .bmmreplay where a complete one used to be.
    let tmp_path = out_path.with_extension("bmmreplay.part");
    {
        let mut out = std::io::BufWriter::new(std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?);
        // meta_json arrives as a complete object; splice it open and continue the object.
        let meta = meta_json.trim();
        let meta_inner = meta.strip_prefix('{').and_then(|s| s.strip_suffix('}')).unwrap_or("");
        out.write_all(b"{").map_err(|e| e.to_string())?;
        if !meta_inner.trim().is_empty() {
            out.write_all(meta_inner.as_bytes()).map_err(|e| e.to_string())?;
            out.write_all(b",").map_err(|e| e.to_string())?;
        }
        out.write_all(b"\"events\":[").map_err(|e| e.to_string())?;
        let mut first = true;
        let mut skipped = 0usize;
        for seg in &files {
            let f = match std::fs::File::open(seg) { Ok(f) => f, Err(_) => continue };
            for line in std::io::BufRead::lines(std::io::BufReader::new(f)) {
                let line = match line { Ok(l) => l, Err(_) => continue };
                let l = line.trim();
                if l.is_empty() { continue; }
                // A hard kill can leave the final line half-written. Copying it would
                // produce invalid JSON, so drop anything that isn't a complete object.
                if !l.starts_with('{') || !l.ends_with('}') { skipped += 1; continue; }
                if !first { out.write_all(b",").map_err(|e| e.to_string())?; }
                out.write_all(l.as_bytes()).map_err(|e| e.to_string())?;
                first = false;
            }
        }
        if skipped > 0 {
            log_line(format!("[REPLAY] spool {}: skipped {} incomplete event line(s)", id, skipped));
        }
        out.write_all(b"],\"console\":").map_err(|e| e.to_string())?;
        out.write_all(if console_json.trim().is_empty() { "[]" } else { console_json.trim() }.as_bytes()).map_err(|e| e.to_string())?;
        out.write_all(b",\"rustLog\":").map_err(|e| e.to_string())?;
        let log = serde_json::to_string(&rust_log).unwrap_or_else(|_| "\"\"".into());
        out.write_all(log.as_bytes()).map_err(|e| e.to_string())?;
        out.write_all(b"}").map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, &out_path).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

/// Drop a spool's contents (end of session, or the user turned the recorder off).
#[tauri::command]
pub fn replay_spool_clear(app_handle: AppHandle, id: String) -> Result<(), String> {
    let dir = spool_dir(&app_handle, &id)?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Auto-saves a local replay bundle to the `Replays` folder without prompting.
#[tauri::command]
pub fn save_local_replay(app_handle: AppHandle, content: String) -> Result<String, String> {
    let dir = app_handle.path().app_data_dir().ok().unwrap_or_default().join("Replays");
    let _ = std::fs::create_dir_all(&dir);
    let name = format!("bmm-session-{}.bmmreplay", chrono::Utc::now().timestamp_millis());
    let path = dir.join(&name);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    log_line(format!("[ANALYTICS] Auto-saved local replay to {:?}", path));

    // Retention is handled by the configurable `prune_sessions` (count + total size),
    // called by the caller after saving — so no hard 20-cap here anymore.

    Ok(path.to_string_lossy().to_string())
}

/// Delete a specific replay file. Confined to the app's own `Replays` folder — the
/// frontend only ever deletes files it listed from there, so an unvalidated path (e.g.
/// from a compromised webview) can't remove arbitrary files off disk (CWE-22 hardening).
/// `AppHandle` is injected by Tauri, so the JS `invoke('delete_local_replay', { path })`
/// call is unchanged.
#[tauri::command]
pub fn delete_local_replay(app_handle: AppHandle, path: String) -> Result<(), String> {
    let root = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("Replays");
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
    let canon_target = std::path::PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    if !canon_target.starts_with(&canon_root) {
        return Err("refused: path is outside the Replays folder".into());
    }
    std::fs::remove_file(&canon_target).map_err(|e| e.to_string())
}

/// Overwrite the single rolling "crash buffer". The session is ALWAYS recorded in
/// memory and flushed here, but this file is NOT a saved replay (never shown in the
/// list, never sent). It exists only so a crash report can attach the session just
/// before the crash. Saving a *real* replay to the list happens via
/// `save_local_replay`, and only when the user enables the Session recorder.
#[tauri::command]
pub fn save_crash_session(app_handle: AppHandle, content: String) -> Result<(), String> {
    let dir = app_handle.path().app_data_dir().ok().unwrap_or_default();
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(dir.join("last_crash_session.bmmreplay"), content).map_err(|e| e.to_string())
}

/// Prune saved sessions to the user's limits: keep at most `max_count` of the
/// newest, and delete oldest until the total is under `max_mb` megabytes. Applies
/// to BOTH the saved replays (Replays/*.bmmreplay) and the "Session" crash reports
/// (Reports/Session + Archive/Session *.zip), so the manager never floods. Returns
/// how many files were deleted.
#[tauri::command]
pub fn prune_sessions(app_handle: AppHandle, max_count: usize, max_mb: u64) -> usize {
    let root = app_handle.path().app_data_dir().ok().unwrap_or_default();
    let max_bytes = max_mb.saturating_mul(1024 * 1024);
    // (modified_time, size, path) for every prunable session-ish file.
    let mut items: Vec<(std::time::SystemTime, u64, PathBuf)> = Vec::new();
    let mut collect = |dir: PathBuf, exts: &[&str]| {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
                if !exts.contains(&ext) {
                    continue;
                }
                if let Ok(m) = e.metadata() {
                    items.push((m.modified().unwrap_or(std::time::UNIX_EPOCH), m.len(), p));
                }
            }
        }
    };
    collect(root.join("Replays"), &["bmmreplay"]);
    let crashes = root.join("Crashes");
    collect(crashes.join("Reports").join("Session"), &["zip"]);
    collect(crashes.join("Archive").join("Session"), &["zip"]);

    // Newest first.
    items.sort_by(|a, b| b.0.cmp(&a.0));
    let max_count = max_count.max(1);

    let mut deleted = 0usize;
    let mut running: u64 = 0;
    for (i, (_, size, path)) in items.iter().enumerate() {
        running = running.saturating_add(*size);
        let over_count = i >= max_count;
        let over_size = max_bytes > 0 && running > max_bytes;
        if over_count || over_size {
            if std::fs::remove_file(path).is_ok() {
                deleted += 1;
            }
        }
    }
    deleted
}

/// List saved local replays (the persistent ones, when recording is enabled),
/// newest first — so the UI can play/delete/export them without importing a file.
#[tauri::command]
pub fn list_saved_replays(app_handle: AppHandle) -> Vec<serde_json::Value> {
    let dir = app_handle.path().app_data_dir().ok().unwrap_or_default().join("Replays");
    let mut out: Vec<(std::time::SystemTime, serde_json::Value)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("bmmreplay") {
                continue;
            }
            let meta = std::fs::metadata(&p).ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta.and_then(|m| m.modified().ok()).unwrap_or(std::time::UNIX_EPOCH);
            let ts = modified.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            out.push((modified, serde_json::json!({
                "name": p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
                "path": p.to_string_lossy().to_string(),
                "size": size,
                "ts": ts,
            })));
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.into_iter().map(|(_, v)| v).collect()
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
