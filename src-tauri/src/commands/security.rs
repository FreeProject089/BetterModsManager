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

#[cfg(target_os = "windows")]
fn get_hwid_v4() -> String {
    use winreg::enums::*;
    use winreg::RegKey;
    use std::collections::BTreeMap;

    let mut m: BTreeMap<&str, String> = BTreeMap::new();
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

    if m.is_empty() { return "fallback_v4_emergency_identity".to_string(); }
    let mut raw = String::from("BMM-HWID-V4|");
    for (k, v) in &m { raw.push_str(k); raw.push(':'); raw.push_str(v); raw.push('|'); }
    raw
}

#[cfg(not(target_os = "windows"))]
fn get_hwid_v4() -> String { "non_windows_v4_identity".to_string() }

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

/// Writes the signing key seed + seal to registry.
/// Silently ignores errors — registry is best-effort hardening,
/// the app works fine without it.
#[cfg(target_os = "windows")]
fn write_key_to_registry(seed: &[u8; 32]) {
    use winreg::enums::*;
    use winreg::RegKey;
    let seed_hex = hex::encode(seed);
    let machine_guid = get_machine_guid();
    let seal = compute_seal_v4(&seed_hex, &machine_guid);

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((key, _)) = hkcu.create_subkey("SOFTWARE\\BetterModsManager\\Identity") {
        let version: u32 = 4;
        let _ = key.set_value("V", &version);
        let _ = key.set_value("K", &seed_hex);
        let _ = key.set_value("S", &seal);
    }
}

#[cfg(not(target_os = "windows"))]
fn write_key_to_registry(_seed: &[u8; 32]) {}

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
// Key path helper
// ─────────────────────────────────────────────────────────────────────────────
pub fn get_keys_path(handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = handle
        .path_resolver()
        .app_data_dir()
        .ok_or("Impossible de trouver le dossier AppData")?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("creator_v4.key"))
}

// ─────────────────────────────────────────────────────────────────────────────
// Load or generate signing key
//
// Priority (highest → lowest):
//   1. Registry  — sealed, machine-bound, survives hardware swaps
//   2. File      — AppData cache, migrated to registry
//   3. Hardware  — fresh derivation from HWID v3
//
// Once locked in registry, hardware changes do NOT change the Creator ID.
// This is intentional: a user who upgrades their GPU/RAM/etc. stays the same
// identity on any server they were already connected to.
// ─────────────────────────────────────────────────────────────────────────────
pub fn load_or_generate_keys(handle: &AppHandle) -> Result<SigningKey, String> {
    let path = get_keys_path(handle)?;

    let app_dir = handle.path_resolver().app_data_dir();
    let v3_path = app_dir.as_ref().map(|d| d.join("creator_v3.key"));
    let v2_path = app_dir.as_ref().map(|d| d.join("creator_v2.key"));

    // ── 1. Registry (fastest, most tamper-resistant; v4 or migratable v3) ─
    if let Some((seed, version)) = read_key_from_registry() {
        // Promote to v4 storage only when needed (migrating a v3 entry, or the
        // file cache is missing) — keeps the same seed, so the Creator ID is
        // unchanged, and avoids a registry write on every call.
        if version != 4 { write_key_to_registry(&seed); }
        if !path.exists() { let _ = fs::write(&path, &seed); }
        return Ok(SigningKey::from_bytes(&seed));
    }

    // ── 2. File cache — v4, then legacy v3, then legacy v2 (32-byte raw seed)
    //    Any existing key is reused as-is (same seed → same Creator ID) and
    //    promoted to v4 storage. Only a brand-new machine reaches step 3.
    for candidate in [Some(path.clone()), v3_path.clone(), v2_path.clone()].into_iter().flatten() {
        if candidate.exists() {
            if let Ok(raw) = fs::read(&candidate) {
                if let Ok(arr) = <[u8; 32]>::try_from(raw) {
                    let _ = fs::write(&path, &arr);
                    write_key_to_registry(&arr);
                    return Ok(SigningKey::from_bytes(&arr));
                }
            }
        }
    }

    // ── 3. Fresh v4 derivation — first launch on a new machine ───────────
    //    WMIC-free HWID + iterated-SHA256 KDF.
    let seed = derive_seed_v4(&get_hwid_v4(), &get_machine_guid());
    let _ = fs::write(&path, &seed);
    write_key_to_registry(&seed);

    Ok(SigningKey::from_bytes(&seed))
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
