use crate::state::AppState;
use crate::commands::crash::log_line;
use crate::error::AppError;
use tauri::State;

#[tauri::command]
pub fn crop_and_save_webp(
    state: State<AppState>,
    profile_id: String,
    source_path: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    is_temp: Option<bool>,
) -> Result<String, AppError> {
    log_line(format!(
        "[IMAGE] Cropping image for profile '{}': {}x{} at ({},{})",
        profile_id, width, height, x, y
    ));

    // Load the source image
    let img = image::open(&source_path)
        .map_err(|e| AppError::Internal(format!("Impossible d'ouvrir l'image: {}", e)))?;

    // Validate crop bounds
    let (img_w, img_h) = (img.width(), img.height());
    if x + width > img_w || y + height > img_h {
        return Err(AppError::Internal(format!(
            "Zone de recadrage invalide: image {}x{}, crop {}x{} at ({},{})",
            img_w, img_h, width, height, x, y
        )));
    }

    // Crop
    let cropped = img.crop_imm(x, y, width, height);

    // Build output path next to data.json
    // unwrap_or is safe here — data_path always has a parent in practice
    let out_dir = state.data_path.parent().unwrap_or(std::path::Path::new("."));
    let is_temp_val = is_temp.unwrap_or(false);
    let filename = if is_temp_val {
        format!("temp_bg_{}.webp", profile_id)
    } else {
        format!("bg_{}.webp", profile_id)
    };
    let out_path = out_dir.join(&filename);

    // Save as WebP
    cropped
        .save_with_format(&out_path, image::ImageFormat::WebP)
        .map_err(|e| AppError::Internal(format!("WebP save error: {}", e)))?;

    // Only update profile's background_image field if not temp
    if !is_temp_val {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(p) = data.profiles.iter_mut().find(|p| p.id == profile_id) {
            p.background_image = Some(filename.clone());
        }
        drop(data);
        state.save()?;
    }

    let abs_path = out_path.to_string_lossy().to_string();
    log_line(format!("[IMAGE] Saved WebP background (temp={}): {}", is_temp_val, abs_path));
    Ok(abs_path)
}

#[tauri::command]
pub fn apply_profile_background(
    state: State<AppState>,
    profile_id: String,
) -> Result<String, AppError> {
    let out_dir = state.data_path.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
    let temp_filename = format!("temp_bg_{}.webp", profile_id);
    let final_filename = format!("bg_{}.webp", profile_id);
    
    let temp_path = out_dir.join(&temp_filename);
    let final_path = out_dir.join(&final_filename);

    if !temp_path.exists() {
        return Err(AppError::NotFound("Image temporaire introuvable".to_string()));
    }

    // Rename temp file to final file
    std::fs::rename(&temp_path, &final_path)
        .map_err(|e| AppError::Internal(format!("Error applying image: {}", e)))?;

    // Update profile
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(p) = data.profiles.iter_mut().find(|p| p.id == profile_id) {
            p.background_image = Some(final_filename.clone());
        }
    }
    state.save()?;

    let abs_path = final_path.to_string_lossy().to_string();
    log_line(format!("[IMAGE] Applied temp background to final: {}", abs_path));
    Ok(abs_path)
}

#[tauri::command]
pub fn remove_profile_background(
    state: State<AppState>,
    profile_id: String,
) -> Result<(), AppError> {
    let filename = {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let p = data.profiles.iter_mut().find(|p| p.id == profile_id)
            .ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
        p.background_image.take()
    };
    state.save()?;

    // Delete the file if it exists
    if let Some(f) = filename {
        let out_dir = state.data_path.parent().unwrap_or(std::path::Path::new("."));
        let path = out_dir.join(&f);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_profile_background_path(
    state: State<AppState>,
    profile_id: String,
) -> Result<Option<String>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let p = data.profiles.iter().find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
    
    if let Some(f) = &p.background_image {
        let out_dir = state.data_path.parent().unwrap_or(std::path::Path::new("."));
        let full_path = out_dir.join(f);
        if full_path.exists() {
            Ok(Some(full_path.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}
