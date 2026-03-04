use crate::models::tag::TagDef;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn get_tags(state: State<AppState>) -> Result<Vec<TagDef>, String> {
    let data = state.data.lock().unwrap();
    Ok(data.custom_tags.clone())
}

#[tauri::command]
pub fn create_tag(
    state: State<AppState>,
    name: String,
    color: String,
    icon: String,
) -> Result<TagDef, String> {
    let mut data = state.data.lock().unwrap();
    let tag = TagDef {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        color,
        icon,
    };
    data.custom_tags.push(tag.clone());
    let _ = state.save();
    Ok(tag)
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, tag_id: String) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.custom_tags.retain(|t| t.id != tag_id);
    // Also remove the tag from all mods
    for m in &mut data.mods {
        m.tags.retain(|tid| *tid != tag_id);
    }
    let _ = state.save();
    Ok(())
}
