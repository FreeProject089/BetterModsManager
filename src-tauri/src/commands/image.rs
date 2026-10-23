use crate::state::AppState;
use crate::commands::crash::log_line;
use crate::error::AppError;
use crate::governor::config::OpKind;
use crate::governor::queue::Ticket;
use tauri::State;

// Image work (decode, crop, resize, encode) is governed as OpKind::Image: it holds an Image
// ticket while it runs. The helpers below TAKE the ticket as an argument and refuse any other
// kind, so the work cannot be reached without one. The commands that do it are
// `command(async)`: a synchronous command runs on the main thread in Tauri v2, and decoding a
// 4K background there froze the window for as long as it took.

fn cancelled() -> AppError {
    AppError::Internal("image.cancelled".to_string())
}

/// Refuse a ticket that is not an Image one, then wait out a pause / answer a cancel.
pub(crate) fn image_gate(ticket: &Ticket) -> Result<(), AppError> {
    if ticket.kind() != OpKind::Image {
        return Err(AppError::Internal(format!("image work needs an Image ticket, got {:?}", ticket.kind())));
    }
    ticket.checkpoint().map_err(|_| cancelled())
}

/// Decode `source`, crop it to (x, y, width, height) and write it to `out` as WebP.
pub(crate) fn crop_to_webp(
    ticket: &Ticket,
    source: &std::path::Path,
    out: &std::path::Path,
    (x, y, width, height): (u32, u32, u32, u32),
) -> Result<(), AppError> {
    image_gate(ticket)?;
    // Load the source image
    let img = image::open(source)
        .map_err(|e| AppError::Internal(format!("Impossible d'ouvrir l'image: {}", e)))?;
    ticket.add_bytes(std::fs::metadata(source).map(|m| m.len()).unwrap_or(0), 0);

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

    image_gate(ticket)?;
    // Save as WebP
    cropped
        .save_with_format(out, image::ImageFormat::WebP)
        .map_err(|e| AppError::Internal(format!("WebP save error: {}", e)))?;
    ticket.add_bytes(0, std::fs::metadata(out).map(|m| m.len()).unwrap_or(0));
    Ok(())
}

#[tauri::command(async)]
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

    let ticket = crate::governor::runtime::global().begin(OpKind::Image, &format!("crop → {}", filename));
    crop_to_webp(&ticket, std::path::Path::new(&source_path), &out_path, (x, y, width, height))?;
    drop(ticket);

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

// ── Custom profile icon (imported image) ─────────────────────────────────────

/// Import a custom icon image for a profile: copies the chosen file next to
/// data.json as `icon_<id>.<ext>` and records it on the profile. Returns the
/// absolute path of the stored icon.
#[tauri::command(async)]
pub fn import_profile_icon(
    state: State<AppState>,
    profile_id: String,
    source_path: String,
) -> Result<String, AppError> {
    let src = std::path::Path::new(&source_path);
    if !src.exists() {
        return Err(AppError::NotFound("Image source introuvable".to_string()));
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
    let out_dir = state.data_path.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
    let filename = format!("icon_{}.{}", profile_id, ext);
    let out_path = out_dir.join(&filename);

    // Remove any previous icon file with a different extension to avoid stragglers.
    for old in ["png", "jpg", "jpeg", "webp", "gif", "svg"] {
        let p = out_dir.join(format!("icon_{}.{}", profile_id, old));
        if p != out_path && p.exists() { let _ = std::fs::remove_file(&p); }
    }

    // An Image ticket and the governed copy (the icon is copied as is, not decoded).
    let gov = crate::governor::runtime::global();
    let ticket = gov.begin(OpKind::Image, &format!("icon → {}", filename));
    gov.copy(OpKind::Image, src, &out_path, Some(&ticket))
        .map_err(|e| AppError::Internal(format!("Error copying icon: {:?}", e)))?;
    drop(ticket);

    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let p = data.profiles.iter_mut().find(|p| p.id == profile_id)
            .ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
        p.icon_image = Some(filename.clone());
    }
    state.save()?;

    let abs = out_path.to_string_lossy().to_string();
    log_line(format!("[IMAGE] Imported profile icon: {}", abs));
    Ok(abs)
}

#[tauri::command]
pub fn remove_profile_icon(
    state: State<AppState>,
    profile_id: String,
) -> Result<(), AppError> {
    let filename = {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let p = data.profiles.iter_mut().find(|p| p.id == profile_id)
            .ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
        p.icon_image.take()
    };
    state.save()?;
    if let Some(f) = filename {
        let path = state.data_path.parent().unwrap_or(std::path::Path::new(".")).join(&f);
        if path.exists() { let _ = std::fs::remove_file(&path); }
    }
    Ok(())
}

#[tauri::command]
pub fn get_profile_icon_path(
    state: State<AppState>,
    profile_id: String,
) -> Result<Option<String>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let p = data.profiles.iter().find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
    if let Some(f) = &p.icon_image {
        let full = state.data_path.parent().unwrap_or(std::path::Path::new(".")).join(f);
        if full.exists() { return Ok(Some(full.to_string_lossy().to_string())); }
    }
    Ok(None)
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

#[cfg(test)]
mod governed_image_tests {
    use super::crop_to_webp;
    use crate::governor::config::OpKind;
    use crate::governor::queue::{Queue, TicketState};
    use std::sync::mpsc;
    use std::time::Duration;

    fn source_png(dir: &std::path::Path) -> std::path::PathBuf {
        let p = dir.join("src.png");
        let img = image::RgbImage::from_fn(96, 64, |x, y| image::Rgb([(x * 2) as u8, (y * 3) as u8, 128]));
        img.save(&p).unwrap();
        p
    }

    /// Image work holds an Image ticket: the crop cannot run on another kind's ticket, it waits
    /// while its Image ticket is paused (the ticket really gates the work, it is not decoration),
    /// it runs when resumed, and a cancelled ticket writes nothing.
    #[test]
    fn image_work_holds_an_image_ticket() {
        let td = tempfile::tempdir().unwrap();
        let src = source_png(td.path());
        let q = Queue::default();

        // Another kind's ticket is refused before anything is decoded or written.
        let deploy = q.begin(OpKind::Deploy, "not an image");
        let out = td.path().join("refused.webp");
        assert!(crop_to_webp(&deploy, &src, &out, (0, 0, 32, 32)).is_err());
        assert!(!out.exists());
        drop(deploy);

        // A paused Image ticket holds the work at its gate; resuming lets it through.
        let t = q.begin(OpKind::Image, "crop");
        let id = t.id();
        q.pause(id);
        let out = td.path().join("out.webp");
        let (tx, rx) = mpsc::channel();
        let (src2, out2) = (src.clone(), out.clone());
        let h = std::thread::spawn(move || {
            let r = crop_to_webp(&t, &src2, &out2, (8, 4, 40, 30)).map_err(|e| e.to_string());
            tx.send(r).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(150)).is_err(), "paused: the crop waits at its Image ticket");
        assert!(!out.exists());
        let held = q.snapshot().into_iter().find(|v| v.id == id).unwrap();
        assert_eq!((held.kind, held.state), (OpKind::Image, TicketState::Paused));
        q.resume(id);
        rx.recv_timeout(Duration::from_secs(20)).expect("resumed: the crop runs").unwrap();
        h.join().unwrap();
        let written = image::open(&out).expect("a WebP was written");
        assert_eq!((written.width(), written.height()), (40, 30));

        // A cancelled Image ticket: an error, and no output.
        let t = q.begin(OpKind::Image, "cancelled crop");
        q.cancel(t.id());
        let out = td.path().join("cancelled.webp");
        assert!(crop_to_webp(&t, &src, &out, (0, 0, 10, 10)).is_err());
        assert!(!out.exists());
    }
}
