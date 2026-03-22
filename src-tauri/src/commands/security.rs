use tauri::AppHandle;
use std::fs;
use std::path::PathBuf;
use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Signature, Verifier};
use hex;
use sha2::{Sha256, Digest};

#[cfg(target_os = "windows")]
fn get_wmic_value(target: &str, field: &str) -> String {
    use std::process::Command;
    if let Ok(output) = Command::new("wmic")
        .args([target, "get", field])
        .output() {
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

#[cfg(target_os = "windows")]
fn get_hwid_v2() -> String {
    use winreg::enums::*;
    use winreg::RegKey;
    use std::collections::HashMap;
    
    let mut markers = HashMap::new();

    // 1. Registry Markers (OS Level)
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(crypto) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
        if let Ok(guid) = crypto.get_value::<String, &str>("MachineGuid") {
            markers.insert("MachineGuid", guid);
        }
    }
    if let Ok(cv) = hklm.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion") {
        if let Ok(id) = cv.get_value::<String, &str>("ProductId") {
            markers.insert("ProductId", id);
        }
        if let Ok(date) = cv.get_value::<u32, &str>("InstallDate") {
            markers.insert("InstallDate", date.to_string());
        }
    }

    // 2. Physical Markers (WMIC - Hard to spoof)
    let bb = get_wmic_value("baseboard", "serialnumber");
    if !bb.is_empty() { markers.insert("BaseboardSerial", bb); }

    let bios = get_wmic_value("bios", "manufacturer");
    if !bios.is_empty() { markers.insert("BiosVendor", bios); }

    let cpu = get_wmic_value("cpu", "processorid");
    if !cpu.is_empty() { markers.insert("CpuId", cpu); }

    let disk_sn = get_wmic_value("diskdrive", "serialnumber");
    if !disk_sn.is_empty() { markers.insert("DiskSn", disk_sn); }

    let disk_model = get_wmic_value("diskdrive", "model");
    if !disk_model.is_empty() { markers.insert("DiskModel", disk_model); }

    let ram = get_wmic_value("computersystem", "totalphysicalmemory");
    if !ram.is_empty() { markers.insert("TotalRam", ram); }

    // 3. Network Markers (Volatile but useful in combo)
    if let Ok(output) = std::process::Command::new("wmic")
        .args(["path", "win32_networkadapterconfiguration", "where", "IPEnabled=True", "get", "macaddress"])
        .output() {
        let s = String::from_utf8_lossy(&output.stdout);
        if let Some(mac) = s.lines().nth(1) {
            let m = mac.trim();
            if !m.is_empty() { markers.insert("MacAddress", m.to_string()); }
        }
    }

    if markers.is_empty() {
        return "fallback_v2_emergency_identity".to_string();
    }

    // Sort markers by key to ensure stability
    let mut sorted_keys: Vec<&&str> = markers.keys().collect();
    sorted_keys.sort();

    let mut result = String::new();
    for key in sorted_keys {
        result.push_str(key);
        result.push(':');
        result.push_str(&markers[*key]);
        result.push('|');
    }
    result
}

pub fn get_salted_hwid(salt: &str) -> String {
    let hwid = get_hwid_v2();
    let mut hasher = Sha256::new();
    hasher.update(hwid.as_bytes());
    hasher.update(salt.as_bytes());
    hasher.update(b"BMM-SALTED-V1"); // Domain separation
    let hashed_bytes: [u8; 32] = hasher.finalize().into();
    hex::encode(hashed_bytes)
}

#[tauri::command]
pub fn get_salted_creator_id(salt: String) -> Result<String, String> {
    Ok(get_salted_hwid(&salt))
}

#[cfg(not(target_os = "windows"))]
fn get_hwid_v2() -> String {
    "non_windows_v2_identity".to_string()
}

pub fn get_keys_path(handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = handle.path_resolver().app_data_dir().ok_or("Impossible de trouver le dossier AppData")?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("creator_v2.key")) // Use V2 key file
}

pub fn load_or_generate_keys(handle: &AppHandle) -> Result<SigningKey, String> {
    let path = get_keys_path(handle)?;
    
    // We derive from HWID V2
    let hwid = get_hwid_v2();
    
    // Multi-pass hash for better "viciousness"
    let mut hasher = Sha256::new();
    hasher.update(hwid.as_bytes());
    
    // Domain separation with "V2" salt
    hasher.update(b"BMM-CREATOR-ID-V2-VICIOUS-SALT-Z8K9J2L7M4"); 
    
    // Add internal system entropy from MachineGuid if available
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(crypto) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
            if let Ok(guid) = crypto.get_value::<String, &str>("MachineGuid") {
                hasher.update(guid.as_bytes());
            }
        }
    }
    
    let hashed_bytes: [u8; 32] = hasher.finalize().into();
    let signing_key = SigningKey::from_bytes(&hashed_bytes);
    
    // Cache V2 key
    if !path.exists() {
        let _ = fs::write(&path, signing_key.to_bytes());
    }
    
    Ok(signing_key)
}

#[tauri::command]
pub fn get_creator_id(handle: AppHandle) -> Result<String, String> {
    let signing_key = load_or_generate_keys(&handle)?;
    let verifying_key: VerifyingKey = (&signing_key).into();
    Ok(hex::encode(verifying_key.to_bytes()))
}

/// Signe un message (le JSON du repo)
pub fn sign_message(handle: &AppHandle, message: &[u8]) -> Result<(String, String), String> {
    let signing_key = load_or_generate_keys(handle)?;
    let signature: Signature = signing_key.sign(message);
    let verifying_key: VerifyingKey = (&signing_key).into();
    
    Ok((
        hex::encode(verifying_key.to_bytes()), // Author ID
        hex::encode(signature.to_bytes()),     // Signature
    ))
}

/// Vérifie une signature
pub fn verify_signature(author_id_hex: &str, signature_hex: &str, message: &[u8]) -> bool {
    let public_key_bytes = match hex::decode(author_id_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let signature_bytes = match hex::decode(signature_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let public_key_array: [u8; 32] = match public_key_bytes.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let signature_array: [u8; 64] = match signature_bytes.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };

    let verifying_key = match VerifyingKey::from_bytes(&public_key_array) {
        Ok(k) => k,
        Err(_) => return false,
    };
    let signature = Signature::from_bytes(&signature_array);

    verifying_key.verify(message, &signature).is_ok()
}

#[tauri::command]
pub fn verify_repo_signature(repo: crate::models::repo::ServerRepo) -> bool {
    let mut repo_to_verify = repo.clone();
    let signature_hex = match repo_to_verify.signature.take() {
        Some(s) => s,
        None => return false,
    };
    let author_id_hex = match repo_to_verify.author_id.take() {
        Some(id) => id,
        None => return false,
    };

    // Stable serialization (compact)
    let json_to_verify = match serde_json::to_string(&repo_to_verify) {
        Ok(j) => j,
        Err(_) => return false,
    };

    verify_signature(&author_id_hex, &signature_hex, json_to_verify.as_bytes())
}
