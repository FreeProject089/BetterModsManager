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
    use std::process::Command;
    if let Ok(output) = Command::new("wmic")
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
    if let Ok(out) = std::process::Command::new("wmic")
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

/// Writes the signing key seed + seal to registry.
/// Silently ignores errors — registry is best-effort hardening,
/// the app works fine without it.
#[cfg(target_os = "windows")]
fn write_key_to_registry(seed: &[u8; 32]) {
    use winreg::enums::*;
    use winreg::RegKey;
    let seed_hex = hex::encode(seed);
    let machine_guid = get_machine_guid();
    let seal = compute_seal(&seed_hex, &machine_guid);

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((key, _)) = hkcu.create_subkey("SOFTWARE\\BetterModsManager\\Identity") {
        let version: u32 = 3;
        let _ = key.set_value("V", &version);
        let _ = key.set_value("K", &seed_hex);
        let _ = key.set_value("S", &seal);
    }
}

#[cfg(not(target_os = "windows"))]
fn write_key_to_registry(_seed: &[u8; 32]) {}

/// Returns the cached signing key seed from registry if the seal is valid.
#[cfg(target_os = "windows")]
fn read_key_from_registry() -> Option<[u8; 32]> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key  = hkcu.open_subkey("SOFTWARE\\BetterModsManager\\Identity").ok()?;

    let version: u32 = key.get_value("V").ok()?;
    if version != 3 { return None; } // old format — re-derive

    let seed_hex: String  = key.get_value("K").ok()?;
    let stored_seal: String = key.get_value("S").ok()?;

    // Verify seal
    let machine_guid = get_machine_guid();
    let expected = compute_seal(&seed_hex, &machine_guid);
    if expected != stored_seal { return None; } // tampered / wrong machine

    // Decode seed
    let bytes = hex::decode(&seed_hex).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    Some(arr)
}

#[cfg(not(target_os = "windows"))]
fn read_key_from_registry() -> Option<[u8; 32]> { None }

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
    Ok(app_dir.join("creator_v3.key"))
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

    // ── 1. Registry (fastest, most tamper-resistant) ─────────────────────
    if let Some(seed) = read_key_from_registry() {
        let key = SigningKey::from_bytes(&seed);
        // Re-sync file cache if missing
        if !path.exists() {
            let _ = fs::write(&path, &seed);
        }
        return Ok(key);
    }

    // ── 2. File cache (legacy v2 key or v3 key from previous run) ────────
    // Accept both 32-byte raw seeds (current) and anything coercible
    if path.exists() {
        if let Ok(raw) = fs::read(&path) {
            if let Ok(arr) = raw.try_into() as Result<[u8;32], _> {
                let key = SigningKey::from_bytes(&arr);
                // Promote to registry so future runs hit path 1
                write_key_to_registry(&arr);
                return Ok(key);
            }
        }
    }

    // Also try the old v2 key file name for seamless migration
    let v2_path = handle
        .path_resolver()
        .app_data_dir()
        .map(|d| d.join("creator_v2.key"))
        .unwrap_or_default();

    if v2_path.exists() {
        if let Ok(raw) = fs::read(&v2_path) {
            if let Ok(arr) = raw.try_into() as Result<[u8;32], _> {
                let key = SigningKey::from_bytes(&arr);
                // Upgrade: write to new v3 file + registry
                let _ = fs::write(&path, &arr);
                write_key_to_registry(&arr);
                return Ok(key);
            }
        }
    }

    // ── 3. Hardware derivation — runs only on very first launch ──────────
    let hwid = get_hwid_v3();

    // Round 1
    let mut h1 = Sha256::new();
    h1.update(hwid.as_bytes());
    h1.update(b"BMM-CREATOR-ID-V3-SALT-Z8K9J2L7M4X5Q1W6");
    let round1: [u8; 32] = h1.finalize().into();

    // Round 2 — additional hardening pass
    let mut h2 = Sha256::new();
    h2.update(&round1);
    h2.update(b"BMM-ROUND2-V3-HARDENING");
    // Mix in MachineGuid again for extra binding
    h2.update(get_machine_guid().as_bytes());
    let seed: [u8; 32] = h2.finalize().into();

    let key = SigningKey::from_bytes(&seed);

    // Persist in both storages
    let _ = fs::write(&path, &seed);
    write_key_to_registry(&seed);

    Ok(key)
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
