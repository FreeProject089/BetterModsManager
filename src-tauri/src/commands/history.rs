use crate::models::history::ActivityEvent;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn get_history_file(state: &AppState, profile_id: &str) -> Option<PathBuf> {
    let data = state.data.lock().unwrap();
    let profile = data.profiles.iter().find(|p| p.id == profile_id)?;
    Some(profile.backup_path.join("activity.json"))
}

pub fn log_activity(state: &AppState, profile_id: &str, mod_id: &str, mod_name: &str, action: &str) {
    if let Some(file_path) = get_history_file(state, profile_id) {
        let mut history: Vec<ActivityEvent> = if file_path.exists() {
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
        });

        if let Ok(json) = serde_json::to_string_pretty(&history) {
            let _ = std::fs::write(file_path, json);
        }
    }
}

#[tauri::command]
pub fn get_activity_history(state: State<AppState>, profile_id: String) -> Result<Vec<ActivityEvent>, String> {
    if let Some(file_path) = get_history_file(&state, &profile_id) {
        if file_path.exists() {
            let content = std::fs::read_to_string(&file_path).unwrap_or_default();
            let history = serde_json::from_str(&content).unwrap_or_default();
            Ok(history)
        } else {
            Ok(Vec::new())
        }
    } else {
        Err("Profil introuvable".to_string())
    }
}
