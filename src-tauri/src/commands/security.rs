use tauri::AppHandle;
use std::fs;
use std::path::PathBuf;
use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Signature, Verifier};
use rand::rngs::OsRng;
use hex;

pub fn get_keys_path(handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = handle.path_resolver().app_data_dir().ok_or("Impossible de trouver le dossier AppData")?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("creator.key"))
}

pub fn load_or_generate_keys(handle: &AppHandle) -> Result<SigningKey, String> {
    let path = get_keys_path(handle)?;
    if path.exists() {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() == 32 {
            let array: [u8; 32] = bytes.try_into().map_err(|_| "Longueur de clé invalide")?;
            return Ok(SigningKey::from_bytes(&array));
        }
    }
    
    // Generate new if not exists or invalid
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    fs::write(&path, signing_key.to_bytes()).map_err(|e| e.to_string())?;
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
