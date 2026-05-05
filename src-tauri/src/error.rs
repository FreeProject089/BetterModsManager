use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Erreur I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("Erreur de sérialisation: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Erreur interne: {0}")]
    Anyhow(#[from] anyhow::Error),
    #[error("État de l'application verrouillé: {0}")]
    LockError(String),
    #[error("Ressource non trouvée: {0}")]
    NotFound(String),
    #[error("Erreur interne: {0}")]
    Internal(String),
}

// Convert into string for Tauri command Results if they still return Result<T, String>
impl From<AppError> for String {
    fn from(err: AppError) -> String {
        err.to_string()
    }
}

// Convert String to AppError to catch leftover map_err(|e| e.to_string())? calls
impl From<String> for AppError {
    fn from(err: String) -> Self {
        AppError::Internal(err)
    }
}

// Allows returning Result<T, AppError> directly in commands
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
