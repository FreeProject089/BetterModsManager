use crate::models::tag::TagDef;
use crate::state::AppState;
use tauri::State;
use crate::error::AppError;

#[tauri::command]
pub fn get_tags(state: State<AppState>) -> Result<Vec<TagDef>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.custom_tags.clone())
}

#[tauri::command]
pub fn create_tag(
    state: State<AppState>,
    name: String,
    color: String,
    icon: String,
) -> Result<TagDef, AppError> {
    let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let tag = TagDef {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        color,
        icon,
    };
    data.custom_tags.push(tag.clone());
    drop(data); // Drop the lock before saving to avoid deadlock
    let _ = state.save();
    Ok(tag)
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, tag_id: String) -> Result<(), AppError> {
    let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    data.custom_tags.retain(|t| t.id != tag_id);
    // Also remove the tag from all mods
    for m in &mut data.mods {
        m.tags.retain(|tid| *tid != tag_id);
    }
    drop(data); // Drop the lock before saving to avoid deadlock
    let _ = state.save();
    Ok(())
}
