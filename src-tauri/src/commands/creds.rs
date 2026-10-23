use crate::state::AppState;
use crate::error::AppError;

/// What an export screen asks for when the "include credentials" fold is used.
///
/// The PASSWORDS come from the frontend because that is the only place they exist: BMM keeps
/// them for the run and never writes them down, so only passwords typed since launch can be
/// carried. The KEYS are gathered here instead — the ring and the files it names are the
/// backend's, and routing private key material through the webview to hand it straight back
/// would be a copy of it in a second place for no reason.
#[derive(serde::Deserialize, Default)]
pub struct CredsRequest {
    #[serde(default)]
    pub passwords: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub include_keys: bool,
    #[serde(default)]
    pub passphrase: String,
}

/// Build the sealed credentials block, or refuse.
///
/// Refuses without a passphrase rather than writing them in the clear. The whole reason this
/// exists is that the thing being written travels between strangers, and a marked-private
/// secret in a shared file is a secret that has been shared.
///
/// Only this block is ever encrypted, never the whole document: a `.mm` and a `repo.json` are
/// both meant to be readable by BMM, by BetterCommunity's inspector and by a person deciding
/// whether to trust them, and a file nobody can read is a file nobody can check. What is
/// inside is the part that must not be readable.
pub fn seal_credentials(
    state: &tauri::State<'_, AppState>,
    req: &CredsRequest,
) -> Result<Option<serde_json::Value>, AppError> {
    let want_pw = !req.passwords.is_empty();
    if !want_pw && !req.include_keys {
        return Ok(None);
    }
    if req.passphrase.is_empty() {
        return Err(AppError::Internal("mm.creds.errNoPass".into()));
    }

    let mut keys: Vec<serde_json::Value> = Vec::new();
    if req.include_keys {
        let ring: Vec<(String, String)> = {
            let data = state.data.lock().map_err(|_| AppError::LockError("state".into()))?;
            data.settings.key_auth_keys.iter().map(|e| (e.name.clone(), e.path.clone())).collect()
        };
        for (name, path) in ring {
            // An unreadable key is SKIPPED, never a failed export: the document itself is
            // still worth writing, and the count says how many made it.
            if let Ok(pem) = std::fs::read_to_string(&path) {
                keys.push(serde_json::json!({ "name": name, "pem": pem }));
            }
        }
    }

    let plain = serde_json::json!({
        "passwords": req.passwords,
        "keys": keys,
    });
    let bytes = serde_json::to_vec(&plain)?;
    let sealed = crate::commands::secret_box::seal(&bytes, &req.passphrase).map_err(AppError::Internal)?;
    let value: serde_json::Value = serde_json::from_slice(&sealed)?;
    Ok(Some(value))
}
