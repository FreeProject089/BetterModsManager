use crate::models::history::ActivityEvent;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;
use crate::error::AppError;

fn get_history_file(state: &AppState, profile_id: &str) -> Option<PathBuf> {
    // Using unwrap_or_else because this is a non-command helper; a poisoned lock
    // returns None which is handled gracefully by callers.
    let data = state.data.lock().ok()?;
    let profile = data.profiles.iter().find(|p| p.id == profile_id)?;
    Some(profile.backup_path.join("activity.json"))
}

pub fn log_activity(state: &AppState, profile_id: &str, mod_id: &str, mod_name: &str, action: &str, details: Option<String>) {
    if let Some(file_path) = get_history_file(state, profile_id) {
        let mut history: Vec<ActivityEvent> = if file_path.exists() {
            // unwrap_or_default() is intentional — corrupted history just resets cleanly
            let content = std::fs::read_to_string(&file_path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };

        history.push(ActivityEvent {
            mod_id: mod_id.to_string(),
            mod_name: mod_name.to_string(),
            action: action.to_string(),
            timestamp: chrono::Local::now().to_rfc3339(),
            details,
        });

        if let Ok(json) = serde_json::to_string_pretty(&history) {
            let _ = std::fs::write(file_path, json);
        }
    }
}

#[tauri::command]
pub fn clear_activity_history(state: State<AppState>, profile_id: String) -> Result<(), AppError> {
    if let Some(file_path) = get_history_file(&state, &profile_id) {
        if file_path.exists() {
            let _ = std::fs::remove_file(file_path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_activity_history(state: State<AppState>, profile_id: String) -> Result<Vec<ActivityEvent>, AppError> {
    let retention_days = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.settings.history_retention_days
    };

    if let Some(file_path) = get_history_file(&state, &profile_id) {
        if file_path.exists() {
            let content = std::fs::read_to_string(&file_path).unwrap_or_default();
            let mut history: Vec<ActivityEvent> = serde_json::from_str(&content).unwrap_or_default();
            
            // Auto clean
            if retention_days > 0 {
                let threshold = chrono::Local::now() - chrono::Duration::days(retention_days as i64);
                let original_len = history.len();
                history.retain(|event| {
                    if let Ok(parsed_time) = chrono::DateTime::parse_from_rfc3339(&event.timestamp) {
                        parsed_time.with_timezone(&chrono::Local) >= threshold
                    } else {
                        false
                    }
                });
                
                if history.len() < original_len {
                    if let Ok(json) = serde_json::to_string_pretty(&history) {
                        let _ = std::fs::write(&file_path, json);
                    }
                }
            }
            
            Ok(history)
        } else {
            Ok(Vec::new())
        }
    } else {
        Err(AppError::NotFound("Profil introuvable".to_string()))
    }
}
