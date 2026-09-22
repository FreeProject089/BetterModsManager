use tauri::Manager;
use tauri::AppHandle;
use std::fs;
use std::path::PathBuf;
use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Signature, Verifier};
use hex;
use sha2::{Sha256, Digest};

// ─────────────────────────────────────────────────────────────────────────────
// WMIC helper — single-value query
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "windows")]
fn get_wmic_value(target: &str, field: &str) -> String {
    if let Ok(output) = crate::commands::proc::hidden_command("wmic")
        .args([target, "get", field])
        .output()
    {
        let s = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = s.lines().collect();
        if lines.len() >= 2 {
            let val = lines[1].trim();
            if !val.is_empty() && val.to_lowercase() != field.to_lowercase() {
                return val.to_string();
            }
        }
    }
    String::new()
}

// ─────────────────────────────────────────────────────────────────────────────
// HWID v3 — richer, without volatile sources
// Sources kept   : MachineGuid, ProductId, InstallDate,
//                  BaseboardSerial, BiosSerial, SystemUUID,
//                  CpuId, DiskSn, DiskModel, VolumeSn
// Sources removed: MacAddress (VPN-volatile), TotalRam (upgrades)
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "windows")]
fn get_hwid_v3() -> String {
    use winreg::enums::*;
    use winreg::RegKey;
    use std::collections::BTreeMap; // BTreeMap → always sorted

    let mut m: BTreeMap<&str, String> = BTreeMap::new();

    // ── OS-level markers (registry) ──────────────────────────────────────
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    if let Ok(crypto) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
        if let Ok(v) = crypto.get_value::<String, _>("MachineGuid") {
            m.insert("MachineGuid", v);
        }
    }
    if let Ok(cv) = hklm.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion") {
        if let Ok(v) = cv.get_value::<String, _>("ProductId")    { m.insert("ProductId", v); }
        if let Ok(v) = cv.get_value::<u32, _>("InstallDate")     { m.insert("InstallDate", v.to_string()); }
    }

    // ── Hardware markers (WMIC) ──────────────────────────────────────────
    // Motherboard serial
    let bb = get_wmic_value("baseboard", "serialnumber");
    if !bb.is_empty() { m.insert("BaseboardSerial", bb); }

    // BIOS serial (not vendor — more unique)
    let bios_sn = get_wmic_value("bios", "serialnumber");
    if !bios_sn.is_empty() { m.insert("BiosSerial", bios_sn); }

    // System UUID (motherboard-level, very stable)
    let uuid = get_wmic_value("csproduct", "uuid");
    if !uuid.is_empty() && uuid != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" {
        m.insert("SystemUUID", uuid);
    }

    // CPU processor ID
    let cpu = get_wmic_value("cpu", "processorid");
    if !cpu.is_empty() { m.insert("CpuId", cpu); }

    // Primary disk: serial + model
    let disk_sn    = get_wmic_value("diskdrive", "serialnumber");
    let disk_model = get_wmic_value("diskdrive", "model");
    if !disk_sn.is_empty()    { m.insert("DiskSn",    disk_sn);    }
    if !disk_model.is_empty() { m.insert("DiskModel", disk_model); }

    // C: volume serial (filesystem-level, survives disk format changes less
    //   likely than MAC spoofing, still a useful extra signal)
    if let Ok(out) = crate::commands::proc::hidden_command("wmic")
        .args(["logicaldisk", "where", "DeviceID='C:'", "get", "VolumeSerialNumber"])
        .output()
    {
        let s = String::from_utf8_lossy(&out.stdout);
        if let Some(v) = s.lines().nth(1) {
            let v = v.trim();
            if !v.is_empty() { m.insert("VolumeSn", v.to_string()); }
        }
    }

    if m.is_empty() {
        return "fallback_v3_emergency_identity".to_string();
    }

    // BTreeMap guarantees stable order → stable hash
    let mut raw = String::new();
    for (k, v) in &m {
        raw.push_str(k);
        raw.push(':');
        raw.push_str(v);
        raw.push('|');
    }
    raw
}

#[cfg(not(target_os = "windows"))]
fn get_hwid_v3() -> String { "non_windows_v3_identity".to_string() }

// ─────────────────────────────────────────────────────────────────────────────
// HWID v4 — WMIC-free.
// `wmic` was removed from Windows 11 24H2+, so v3's hardware markers silently come
// back empty on modern machines, weakening the identity. v4 reads the same markers
// via a single CIM (PowerShell Get-CimInstance) call, falling back to `wmic` only
// on older Windows where PowerShell/CIM yields nothing. Registry markers are kept.
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "windows")]
fn get_cim_hwid_fields() -> std::collections::BTreeMap<&'static str, String> {
    use std::collections::BTreeMap;
    let mut out: BTreeMap<&'static str, String> = BTreeMap::new();
    // One PowerShell call collects everything as KEY=VALUE lines.
    let script = "\
$ErrorActionPreference='SilentlyContinue';\
$cs=Get-CimInstance Win32_ComputerSystemProduct;\
$bb=Get-CimInstance Win32_BaseBoard;\
$bios=Get-CimInstance Win32_BIOS;\
$cpu=Get-CimInstance Win32_Processor|Select-Object -First 1;\
$disk=Get-CimInstance Win32_DiskDrive|Sort-Object Index|Select-Object -First 1;\
$vol=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\";\
Write-Output \"SystemUUID=$($cs.UUID)\";\
Write-Output \"BaseboardSerial=$($bb.SerialNumber)\";\
Write-Output \"BiosSerial=$($bios.SerialNumber)\";\
Write-Output \"CpuId=$($cpu.ProcessorId)\";\
Write-Output \"DiskSn=$($disk.SerialNumber)\";\
Write-Output \"DiskModel=$($disk.Model)\";\
Write-Output \"VolumeSn=$($vol.VolumeSerialNumber)\"";
    if let Ok(o) = crate::commands::proc::hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .output()
    {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines() {
            if let Some((k, v)) = line.split_once('=') {
                let v = v.trim();
                if v.is_empty() || v.eq_ignore_ascii_case("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF") { continue; }
                let key: Option<&'static str> = match k.trim() {
                    "SystemUUID" => Some("SystemUUID"),
                    "BaseboardSerial" => Some("BaseboardSerial"),
                    "BiosSerial" => Some("BiosSerial"),
                    "CpuId" => Some("CpuId"),
                    "DiskSn" => Some("DiskSn"),
                    "DiskModel" => Some("DiskModel"),
                    "VolumeSn" => Some("VolumeSn"),
                    _ => None,
                };
                if let Some(k) = key { out.insert(k, v.to_string()); }
            }
        }
    }
    out
}

/// The raw v4 markers as a map. v4 folds them into one string (below); v5 hashes them per
/// group into its fingerprint (`creator_v5::fingerprint_for`). Never sent anywhere raw.
#[cfg(target_os = "windows")]
pub(crate) fn hwid_v4_fields() -> std::collections::BTreeMap<&'static str, String> {
    use winreg::enums::*;
    use winreg::RegKey;
    use std::collections::BTreeMap;

    let mut m: BTreeMap<&'static str, String> = BTreeMap::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(crypto) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
        if let Ok(v) = crypto.get_value::<String, _>("MachineGuid") { m.insert("MachineGuid", v); }
    }
    if let Ok(cv) = hklm.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion") {
        if let Ok(v) = cv.get_value::<String, _>("ProductId") { m.insert("ProductId", v); }
        if let Ok(v) = cv.get_value::<u32, _>("InstallDate") { m.insert("InstallDate", v.to_string()); }
    }

    // Hardware markers via CIM (works where wmic is gone).
    for (k, v) in get_cim_hwid_fields() { m.insert(k, v); }

    // Old Windows where PowerShell/CIM produced nothing → fall back to wmic.
    let have_hw = ["SystemUUID", "CpuId", "BaseboardSerial", "BiosSerial", "DiskSn"]
        .iter().any(|k| m.contains_key(*k));
    if !have_hw {
        let bb = get_wmic_value("baseboard", "serialnumber");
        if !bb.is_empty() { m.insert("BaseboardSerial", bb); }
        let bios = get_wmic_value("bios", "serialnumber");
        if !bios.is_empty() { m.insert("BiosSerial", bios); }
        let uuid = get_wmic_value("csproduct", "uuid");
        if !uuid.is_empty() && uuid != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" { m.insert("SystemUUID", uuid); }
        let cpu = get_wmic_value("cpu", "processorid");
        if !cpu.is_empty() { m.insert("CpuId", cpu); }
        let dsn = get_wmic_value("diskdrive", "serialnumber");
        if !dsn.is_empty() { m.insert("DiskSn", dsn); }
    }
    m
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn hwid_v4_fields() -> std::collections::BTreeMap<&'static str, String> { std::collections::BTreeMap::new() }

/// The constants v4 fell back to when it could read nothing. Every install that hit one of
/// them derived the SAME private key — see `legacy_root_seed`.
const HWID_V4_FALLBACK_WINDOWS: &str = "fallback_v4_emergency_identity";
const HWID_V4_FALLBACK_OTHER: &str = "non_windows_v4_identity";

/// Byte-for-byte the string v4 derived its seed from, so an install that reaches the fresh
/// derivation path gets the same Creator ID it always had.
fn get_hwid_v4() -> String {
    let m = hwid_v4_fields();
    if m.is_empty() {
        return if cfg!(target_os = "windows") { HWID_V4_FALLBACK_WINDOWS } else { HWID_V4_FALLBACK_OTHER }.to_string();
    }
    let mut raw = String::from("BMM-HWID-V4|");
    for (k, v) in &m { raw.push_str(k); raw.push(':'); raw.push_str(v); raw.push('|'); }
    raw
}

/// v4 seed derivation: domain-separated, then iterated SHA-256 as a work factor so
/// a known Creator ID can't be cheaply brute-forced back to a forged HWID. Cheap
/// one-time cost (only on a brand-new install, before the key is cached).
fn derive_seed_v4(hwid: &str, machine_guid: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"BMM-CREATOR-ID-V4|");
    h.update(hwid.as_bytes());
    h.update(b"|MG:");
    h.update(machine_guid.as_bytes());
    let mut cur: [u8; 32] = h.finalize().into();
    for _ in 0..200_000 {
        let mut hh = Sha256::new();
        hh.update(cur);
        hh.update(b"BMM-V4-KDF");
        cur = hh.finalize().into();
    }
    cur
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry persistence — sealed key cache
//   HKCU\SOFTWARE\BetterModsManager\Identity
//     V  (REG_DWORD) = 3
//     K  (REG_SZ)    = hex(signing_key_bytes[32])
//     S  (REG_SZ)    = SHA256(K + "|" + MachineGuid + "|BMM-SEAL-V3")
//
// The seal ties the stored key to THIS machine's MachineGuid.
// Copying the registry to another PC won't pass seal verification.
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "windows")]
fn get_machine_guid() -> String {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
        .and_then(|k| k.get_value::<String, _>("MachineGuid"))
        .unwrap_or_default()
}

#[cfg(not(target_os = "windows"))]
fn get_machine_guid() -> String { String::new() }

fn compute_seal(seed_hex: &str, machine_guid: &str) -> String {
    let mut h = Sha256::new();
    h.update(seed_hex.as_bytes());
    h.update(b"|");
    h.update(machine_guid.as_bytes());
    h.update(b"|BMM-SEAL-V3");
    hex::encode(h.finalize())
}

fn compute_seal_v4(seed_hex: &str, machine_guid: &str) -> String {
    let mut h = Sha256::new();
    h.update(seed_hex.as_bytes());
    h.update(b"|");
    h.update(machine_guid.as_bytes());
    h.update(b"|BMM-SEAL-V4");
    hex::encode(h.finalize())
}

/// Returns the cached signing key seed from registry if the seal is valid.
/// Returns `(seed, version)` from the registry if the seal is valid.
#[cfg(target_os = "windows")]
fn read_key_from_registry() -> Option<([u8; 32], u32)> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key  = hkcu.open_subkey("SOFTWARE\\BetterModsManager\\Identity").ok()?;

    let version: u32 = key.get_value("V").ok()?;
    let seed_hex: String  = key.get_value("K").ok()?;
    let stored_seal: String = key.get_value("S").ok()?;

    // Verify the seal with the algorithm matching the stored version. v3 entries
    // still validate (and are promoted to v4 by load_or_generate_keys), so the
    // Creator ID is preserved across the upgrade.
    let machine_guid = get_machine_guid();
    let expected = match version {
        4 => compute_seal_v4(&seed_hex, &machine_guid),
        3 => compute_seal(&seed_hex, &machine_guid),
        _ => return None, // unknown/older format — re-derive
    };
    if expected != stored_seal { return None; } // tampered / wrong machine

    // Decode seed
    let bytes = hex::decode(&seed_hex).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    Some((arr, version))
}

#[cfg(not(target_os = "windows"))]
fn read_key_from_registry() -> Option<([u8; 32], u32)> { None }

// ─────────────────────────────────────────────────────────────────────────────
// Salted HWID (for external use — e.g. download tokens)
// ─────────────────────────────────────────────────────────────────────────────
pub fn get_salted_hwid(salt: &str) -> String {
    let hwid = get_hwid_v3();
    let mut h = Sha256::new();
    h.update(hwid.as_bytes());
    h.update(salt.as_bytes());
    h.update(b"BMM-SALTED-V1");
    hex::encode(h.finalize())
}

#[tauri::command]
pub fn get_salted_creator_id(salt: String) -> Result<String, String> {
    Ok(get_salted_hwid(&salt))
}

// ─────────────────────────────────────────────────────────────────────────────
// The v4 root, for the v5 store (commands/creator_v5.rs)
//
// v5 keeps the Creator ID v4 would have produced — that is what makes it the same identity
// for every repo owner, ban list and account link that already knows it. These helpers find
// that seed (registry, then the v4/v3/v2 files, then a fresh derivation) and, once the v5
// store holds a verified DPAPI-protected copy, delete the plaintext ones.
// ─────────────────────────────────────────────────────────────────────────────
const LEGACY_KEY_FILES: [&str; 3] = ["creator_v4.key", "creator_v3.key", "creator_v2.key"];

/// Is this seed the one every fallback install shares? Costs two v4 derivations, and runs
/// once, at migration.
fn is_shared_fallback_seed(seed: &[u8; 32]) -> bool {
    [HWID_V4_FALLBACK_WINDOWS, HWID_V4_FALLBACK_OTHER]
        .iter()
        .any(|c| &derive_seed_v4(c, "") == seed)
}

/// The seed v4 would use here, and whether it is a shared fallback seed (which must not be
/// carried forward as anybody's identity).
pub(crate) fn legacy_root_seed(handle: &AppHandle) -> ([u8; 32], bool) {
    // 1. Registry (sealed to this machine's MachineGuid).
    if let Some((seed, _version)) = read_key_from_registry() {
        return (seed, is_shared_fallback_seed(&seed));
    }
    // 2. The plaintext files, newest format first.
    if let Ok(dir) = handle.path().app_data_dir() {
        for name in LEGACY_KEY_FILES {
            if let Ok(raw) = fs::read(dir.join(name)) {
                if let Ok(arr) = <[u8; 32]>::try_from(raw) {
                    return (arr, is_shared_fallback_seed(&arr));
                }
            }
        }
    }
    // 3. First launch: the v4 derivation, so a returning machine gets its old id back.
    let hwid = get_hwid_v4();
    let shared = hwid == HWID_V4_FALLBACK_WINDOWS || hwid == HWID_V4_FALLBACK_OTHER;
    (derive_seed_v4(&hwid, &get_machine_guid()), shared)
}

/// Remove the plaintext v2/v3/v4 key copies. Called only after the v5 store was written and
/// read back. An older BMM started afterwards re-derives the same seed from hardware, so a
/// downgrade keeps its Creator ID.
pub(crate) fn scrub_legacy_plaintext(handle: &AppHandle) {
    if let Ok(dir) = handle.path().app_data_dir() {
        for name in LEGACY_KEY_FILES { let _ = fs::remove_file(dir.join(name)); }
    }
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        if let Ok(k) = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("SOFTWARE\\BetterModsManager\\Identity", KEY_ALL_ACCESS)
        {
            for v in ["V", "K", "S"] { let _ = k.delete_value(v); }
        }
    }
}

/// The ROOT signing key — the private half of the Creator ID.
///
/// Since v5 this comes from the DPAPI-protected store. The root signs repos and v1 proofs,
/// exactly as before, so every existing verifier keeps working; v5 proofs are signed by the
/// separate active key (`creator_v5::creator_proof_v5`).
pub fn load_or_generate_keys(handle: &AppHandle) -> Result<SigningKey, String> {
    crate::commands::creator_v5::load_store(handle)?.root_key()
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Tauri commands
// ─────────────────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn get_creator_id(handle: AppHandle) -> Result<String, String> {
    let signing_key = load_or_generate_keys(&handle)?;
    let verifying_key: VerifyingKey = (&signing_key).into();
    Ok(hex::encode(verifying_key.to_bytes()))
}

/// How long a creator proof stays valid. It is a bearer token — whoever holds a live one can
/// replay it at the audience it names — so the window is small. Making another costs one
/// signature, which is nothing.
const CREATOR_PROOF_TTL_SECONDS: u64 = 120;

/// Prove this install holds the private half of its Creator ID, to one named audience.
///
/// Returns `bmmc1.<base64url(payload)>.<base64url(signature)>`, where the payload is
/// `{"cid":<hex public key>,"aud":<origin>,"exp":<unix seconds>}`.
///
/// `aud` is the ONLY thing the caller decides, and it is an origin: scheme, host and port,
/// with anything else refused rather than trimmed. That is what stops a proof captured by one
/// server from opening another, and it is also why this is not a signing oracle — everything
/// else in the signed bytes is written here.
#[tauri::command]
pub fn creator_proof(handle: AppHandle, aud: String) -> Result<String, String> {
    use base64::Engine;
    let b64u = base64::engine::general_purpose::URL_SAFE_NO_PAD;

    // An origin, not a URL. `https://host` or `https://host:port` — a path, a query or a
    // fragment means the caller passed a whole URL, and signing that would bind the proof to
    // one endpoint of a server instead of to the server.
    let aud = aud.trim().trim_end_matches('/');
    let rest = aud
        .strip_prefix("https://")
        .or_else(|| aud.strip_prefix("http://"))
        .ok_or_else(|| "Audience must be an http(s) origin".to_string())?;
    if rest.is_empty() || rest.contains('/') || rest.contains('?') || rest.contains('#') {
        return Err("Audience must be an origin, not a URL".to_string());
    }

    let signing_key = load_or_generate_keys(&handle)?;
    let verifying_key: VerifyingKey = (&signing_key).into();
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "System clock is before the epoch".to_string())?
        .as_secs()
        + CREATOR_PROOF_TTL_SECONDS;

    // Hand-built rather than serde: three fields, and the field ORDER is part of what gets
    // signed. A derived struct that someone later reorders would silently change the bytes.
    let payload = format!(
        r#"{{"cid":"{}","aud":"{}","exp":{}}}"#,
        hex::encode(verifying_key.to_bytes()),
        aud,
        exp
    );
    let payload_b64 = b64u.encode(payload.as_bytes());
    let signature: Signature = signing_key.sign(payload_b64.as_bytes());
    Ok(format!(
        "bmmc1.{}.{}",
        payload_b64,
        b64u.encode(signature.to_bytes())
    ))
}

/// Shared HTTP client for the BetterCommunity API calls (blog feed, account link,
/// avatars) — the process-wide pooled client from `commands::net`, so these keep-alive
/// to the BC host instead of rebuilding a client + TLS handshake per call. Per-request
/// timeouts are set on the RequestBuilder.
#[inline]
fn bc_http_client() -> &'static reqwest::Client {
    crate::commands::net::client()
}

// ── BetterCommunity API key ──────────────────────────────────────────────────
//
// BCWEB notifications live behind an API key, and a key is a credential: it must not
// go into localStorage, where every script in the webview can read it and where it
// sits in a file a backup will happily copy around.
//
// So it lives here, in app-data, and it is never handed back to the frontend. The
// webview can set it, ask WHETHER one exists, and clear it — it can never read it.
// That is the whole point: a compromised page cannot exfiltrate what it was never
// given, and every request that needs the key is made by this process.
//
// It is stored in clear on disk, which is a real limitation and worth naming: anyone
// who can read the app-data folder can read the key. Two things make that the right
// trade rather than a shrug. The folder already holds the user's profile paths and
// configuration, so it is already an asset worth protecting; and the key is SCOPED —
// `notifications:read` grants reading notifications and nothing else, which is
// exactly what a scope system is for. The alternative that removes this limitation
// is the OS credential store, which costs an FFI dependency and works on one
// platform.

/// The BetterCommunity API key's file, beside data.json. Named once: the report redactor
/// reads it too, since the key lives outside data.json and no snapshot would reveal it.
pub const BC_API_KEY_FILE: &str = "bcweb-api-key";

fn bc_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app-data directory: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(BC_API_KEY_FILE))
}

/// Store the user's BetterCommunity API key. An empty value clears it, so the UI
/// does not need a separate "clear" path for the obvious gesture of emptying a field.
#[tauri::command]
pub fn set_bcweb_api_key(app: AppHandle, key: String) -> Result<bool, String> {
    let path = bc_key_path(&app)?;
    let key = key.trim();
    if key.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(false);
    }
    fs::write(&path, key.as_bytes()).map_err(|e| format!("Could not save the key: {}", e))?;
    Ok(true)
}

/// Whether a key is stored. Deliberately NOT the key itself — see the module note.
#[tauri::command]
pub fn has_bcweb_api_key(app: AppHandle) -> bool {
    bc_key_path(&app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false)
}

/// Fetch this account's notifications from BCWEB.
///
/// `since` is an ISO timestamp — the newest one the caller already holds — so a
/// poller receives only what arrived after it, instead of re-reading the same list
/// every few minutes and de-duplicating it itself.
///
/// The URL is built here from the caller's base rather than taken whole, so a
/// compromised page cannot point the Authorization header at a server of its
/// choosing. That is the difference between a proxy and a credential oracle.
#[tauri::command(async)]
pub async fn bcweb_notifications(
    app: AppHandle,
    base: String,
    since: Option<String>,
) -> Result<String, String> {
    let key = bc_key_path(&app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "no_key".to_string())?;

    let base = base.trim().trim_end_matches('/');
    if !base.starts_with("https://") && !base.starts_with("http://") {
        return Err("Bad API base".to_string());
    }
    let mut url = format!("{}/v1/notifications", base);
    if let Some(s) = since.as_ref().filter(|s| !s.trim().is_empty()) {
        // An ISO-8601 timestamp needs its ':' and '+' escaped in a query string.
        // Hand-encoding the two characters that actually occur beats adding a crate
        // for it — and anything else in this value is refused rather than encoded,
        // because a since value that is not a timestamp is a bug, not a string to carry.
        let raw = s.trim();
        if !raw.chars().all(|c| c.is_ascii_alphanumeric() || ":-+.TZtz".contains(c)) {
            return Err("Bad since value".to_string());
        }
        url.push_str(&format!("?since={}", raw.replace(':', "%3A").replace('+', "%2B")));
    }

    let resp = bc_http_client()
        .get(&url)
        .header("Authorization", format!("Bearer {}", key))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // 401 gets its own name so the UI can say "your key was revoked or expired"
        // rather than showing a raw body the user cannot act on.
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err("bad_key".to_string());
        }
        return Err(if text.is_empty() { format!("http_{}", status.as_u16()) } else { text });
    }
    Ok(text)
}

/// Proxy a GET to a BetterCommunity API URL from Rust. The webview lives at the
/// `tauri.localhost` origin, so a direct `fetch()` to the BCWEB API is a cross-origin
/// request subject to browser CORS (and fails when the base doesn't send the right
/// header, e.g. hitting the wrong port in dev). Doing it here — from the native
/// process — is not subject to CORS at all, and is harder to tamper with client-side.
#[tauri::command]
pub async fn bc_api_get(url: String) -> Result<String, String> {
    let resp = bc_http_client()
        .get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // Surface the response body on error (it carries the JSON `error` code the
        // caller may want) — or a synthetic http_<code> when the body is empty.
        return Err(if text.is_empty() { format!("http_{}", status.as_u16()) } else { text });
    }
    Ok(text)
}

/// Proxy a JSON POST to a BetterCommunity API URL from Rust (same CORS-bypass rationale
/// as `bc_api_get`). `body` is the raw JSON string to send.
#[tauri::command]
pub async fn bc_api_post(url: String, body: String) -> Result<String, String> {
    let resp = bc_http_client()
        .post(&url)
        .timeout(std::time::Duration::from_secs(12))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(if text.is_empty() { format!("http_{}", status.as_u16()) } else { text });
    }
    Ok(text)
}

/// Fetch a URL and return it as a `data:<type>;base64,…` URL. Used for BetterCommunity
/// avatars: the webview's CSP `img-src` doesn't allow the (dev) BCWEB origin, and a
/// cross-origin `background-image` would be blocked — but a `data:` URL always renders.
/// Works for both boring-avatar SVGs and uploaded photos (follows the 302 redirect).
#[tauri::command]
pub async fn bc_fetch_data_url(url: String) -> Result<String, String> {
    use base64::Engine;
    let resp = bc_http_client()
        .get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("http_{}", resp.status().as_u16()));
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/svg+xml")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", ct, b64))
}

/// Sign a message (repo JSON) → returns (author_id_hex, signature_hex)
pub fn sign_message(handle: &AppHandle, message: &[u8]) -> Result<(String, String), String> {
    let signing_key = load_or_generate_keys(handle)?;
    let signature: Signature = signing_key.sign(message);
    let verifying_key: VerifyingKey = (&signing_key).into();
    Ok((
        hex::encode(verifying_key.to_bytes()),
        hex::encode(signature.to_bytes()),
    ))
}

/// Verify a repo signature
pub fn verify_signature(author_id_hex: &str, signature_hex: &str, message: &[u8]) -> bool {
    let pub_bytes = match hex::decode(author_id_hex) { Ok(b) => b, Err(_) => return false };
    let sig_bytes = match hex::decode(signature_hex) { Ok(b) => b, Err(_) => return false };

    let pub_arr: [u8; 32] = match pub_bytes.try_into() { Ok(a) => a, Err(_) => return false };
    let sig_arr: [u8; 64] = match sig_bytes.try_into() { Ok(a) => a, Err(_) => return false };

    let vk = match VerifyingKey::from_bytes(&pub_arr) { Ok(k) => k, Err(_) => return false };
    vk.verify(message, &Signature::from_bytes(&sig_arr)).is_ok()
}

#[tauri::command]
pub fn verify_repo_signature(repo: crate::models::repo::ServerRepo) -> bool {
    let mut repo_to_verify = repo.clone();
    let signature_hex = match repo_to_verify.signature.take() { Some(s) => s, None => return false };
    let author_id_hex = match repo_to_verify.author_id.take() { Some(id) => id, None => return false };
    let json_to_verify = match serde_json::to_string(&repo_to_verify) { Ok(j) => j, Err(_) => return false };
    verify_signature(&author_id_hex, &signature_hex, json_to_verify.as_bytes())
}
