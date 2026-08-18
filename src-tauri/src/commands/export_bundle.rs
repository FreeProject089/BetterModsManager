//! The whole installation in one file: `.DATABMM`.
//!
//! The JSON export answers "my settings and my profiles". It cannot answer "everything I have"
//! because most of what BMM keeps is not in `data.json` at all — the session recordings, the
//! crash reports, the diagnostics, the launch packs, the themes and the scheduled automations
//! are FILES, and a JSON document can only carry them by inlining them, which turns a 40 MB
//! recording into a 55 MB base64 string inside a document nothing can stream.
//!
//! So this writes a ZIP. `.DATABMM` is the extension because a backup that ends in `.zip`
//! invites somebody to open it, edit a file and put it back — and a restore then reads
//! something no version of BMM ever wrote. The extension says "this belongs to BMM"; the
//! contents are an ordinary archive, deliberately, so it can still be opened by anything when
//! somebody needs to.
//!
//! Every section is optional and every section reports what it actually took, because a backup
//! that silently skipped the one folder you cared about is worse than one that failed.

use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

/// What to put in. Absent means false — an old caller asking for the JSON sections must not
/// suddenly ship somebody's crash reports.
#[derive(serde::Deserialize, Default, Clone)]
pub struct BundleOptions {
    #[serde(default)] pub app_data: bool,
    #[serde(default)] pub themes: bool,
    #[serde(default)] pub theme_presets: bool,
    #[serde(default)] pub translations: bool,
    #[serde(default)] pub launch_packs: bool,
    #[serde(default)] pub automations: bool,
    #[serde(default)] pub navigation: bool,
    #[serde(default)] pub apps: bool,
    #[serde(default)] pub replays: bool,
    #[serde(default)] pub crashes: bool,
    #[serde(default)] pub diagnostics: bool,
}

/// One line per section: what it is, how many files, how many bytes. Returned to the UI AND
/// written into the archive, so the file explains itself a year later without BMM.
#[derive(serde::Serialize, Clone)]
pub struct SectionReport {
    pub section: String,
    pub files: usize,
    pub bytes: u64,
    /// Why a section is empty, when it is. "Nothing there" and "could not read it" are
    /// different answers and only one of them is a problem.
    pub note: Option<String>,
}

#[derive(serde::Serialize)]
pub struct BundleResult {
    pub path: String,
    pub bytes: u64,
    pub sections: Vec<SectionReport>,
}

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().ok().unwrap_or_default()
}

/// Add one file, keeping its name inside `prefix`. Never fails the export: a file that vanished
/// between listing and reading is a normal race with a running app, and losing the whole backup
/// over it would be the wrong trade.
fn add_file<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    prefix: &str,
    path: &Path,
    rep: &mut SectionReport,
) {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else { return };
    let Ok(bytes) = std::fs::read(path) else { return };
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    if zip.start_file(format!("{prefix}/{name}"), opts).is_err() { return; }
    if zip.write_all(&bytes).is_err() { return; }
    rep.files += 1;
    rep.bytes += bytes.len() as u64;
}

/// Every file directly inside `dir` whose extension is in `exts` (empty = all of them).
fn add_dir<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    prefix: &str,
    dir: &Path,
    exts: &[&str],
    section: &str,
) -> SectionReport {
    let mut rep = SectionReport { section: section.to_string(), files: 0, bytes: 0, note: None };
    if !dir.exists() {
        rep.note = Some("nothing kept here yet".into());
        return rep;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        rep.note = Some("could not be read".into());
        return rep;
    };
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_file() { continue; }
        if !exts.is_empty() {
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if !exts.contains(&ext.as_str()) { continue; }
        }
        add_file(zip, prefix, &p, &mut rep);
    }
    if rep.files == 0 && rep.note.is_none() { rep.note = Some("nothing kept here yet".into()); }
    rep
}

/// Write the archive.
///
/// `app_data_json` is passed in already filtered by the existing export logic, so the two
/// exports cannot disagree about what "profiles" or "plugins" means — there is one rule for
/// that and it lives where it always did.
#[tauri::command]
pub fn export_data_bundle(
    state: State<AppState>,
    app_handle: tauri::AppHandle,
    dest_path: String,
    options: BundleOptions,
    app_data_json: Option<serde_json::Value>,
    extras: Option<serde_json::Value>,
    // The navbar layout lives in localStorage, which Rust cannot read, so the caller hands
    // it over the same way it hands over the filtered app data. Without it the pages would
    // be backed up and the buttons that reach them would not — a restore with every page
    // present and no way to open one.
    navbar_config: Option<serde_json::Value>,
) -> Result<BundleResult, AppError> {
    let _ = state.save(); // whatever is in memory belongs in the backup
    let dir = data_dir(&app_handle);

    let file = std::fs::File::create(&dest_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let json_opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut sections: Vec<SectionReport> = Vec::new();

    if options.app_data {
        let mut rep = SectionReport { section: "app_data".into(), files: 0, bytes: 0, note: None };
        let body = serde_json::to_vec_pretty(&app_data_json.clone().unwrap_or(serde_json::Value::Null))?;
        zip.start_file("app_data.json", json_opts).map_err(|e| AppError::from(e.to_string()))?;
        zip.write_all(&body)?;
        rep.files = 1;
        rep.bytes = body.len() as u64;
        sections.push(rep);
    }

    if let Some(ex) = extras.filter(|v| !v.is_null()) {
        let body = serde_json::to_vec_pretty(&ex)?;
        zip.start_file("extras.json", json_opts).map_err(|e| AppError::from(e.to_string()))?;
        zip.write_all(&body)?;
        sections.push(SectionReport { section: "extras".into(), files: 1, bytes: body.len() as u64, note: None });
    }

    if options.automations {
        // schedules.json is a single file, not a folder — the automations live in one document.
        let mut rep = SectionReport { section: "automations".into(), files: 0, bytes: 0, note: None };
        let p = dir.join("schedules.json");
        if p.exists() { add_file(&mut zip, "automations", &p, &mut rep); }
        else { rep.note = Some("no automations saved".into()); }
        sections.push(rep);
    }

    // Navigation: the navbar layout AND the custom pages it points at, which is three
    // separate places on disk and in the browser. Backing up any two of them restores
    // something broken:
    //   · the layout          → localStorage, passed in by the caller
    //   · a page's source     → custom_pages/<id>/
    //   · its permissions and stored data → custom_pages_data/<id>/
    // The permissions especially: a page restored without its grants silently loses the
    // capabilities it was written against and fails at the first thing it tries to do.
    if options.navigation {
        let mut rep = SectionReport { section: "navigation".into(), files: 0, bytes: 0, note: None };
        if let Some(cfg) = navbar_config.filter(|v| !v.is_null()) {
            let body = serde_json::to_vec_pretty(&cfg)?;
            zip.start_file("navigation/navbar.json", json_opts).map_err(|e| AppError::from(e.to_string()))?;
            zip.write_all(&body)?;
            rep.files += 1;
            rep.bytes += body.len() as u64;
        }
        let src = add_dir(&mut zip, "navigation/pages", &dir.join("custom_pages"), &[], "navigation");
        let dat = add_dir(&mut zip, "navigation/pages-data", &dir.join("custom_pages_data"), &[], "navigation");
        rep.files += src.files + dat.files;
        rep.bytes += src.bytes + dat.bytes;
        if rep.files == 0 { rep.note = Some("no custom navigation or pages".into()); }
        sections.push(rep);
    }

    if options.themes { sections.push(add_dir(&mut zip, "themes", &dir.join("themes"), &["json", "css"], "themes")); }
    if options.theme_presets { sections.push(add_dir(&mut zip, "theme-presets", &dir.join("theme-presets"), &["json"], "theme_presets")); }
    if options.translations { sections.push(add_dir(&mut zip, "Lang", &crate::fs_utils::get_lang_dir(&app_handle), &["json"], "translations")); }
    if options.launch_packs { sections.push(add_dir(&mut zip, "LaunchPacks", &dir.join("LaunchPacks"), &[], "launch_packs")); }
    if options.apps {
        let mut rep = SectionReport { section: "apps".into(), files: 0, bytes: 0, note: None };
        for name in ["apps_state.json", "apps-catalog.json"] {
            let p = dir.join(name);
            if p.exists() { add_file(&mut zip, "apps", &p, &mut rep); }
        }
        if rep.files == 0 { rep.note = Some("no app catalog kept yet".into()); }
        sections.push(rep);
    }
    if options.replays { sections.push(add_dir(&mut zip, "Replays", &dir.join("Replays"), &["bmmreplay"], "replays")); }
    if options.crashes {
        // Reports and Archive are the same thing at two ages; both are what somebody means by
        // "my crash reports".
        let mut rep = add_dir(&mut zip, "Crashes/Reports", &dir.join("Crashes").join("Reports").join("Session"), &["zip"], "crashes");
        let arch = add_dir(&mut zip, "Crashes/Archive", &dir.join("Crashes").join("Archive").join("Session"), &["zip"], "crashes");
        rep.files += arch.files;
        rep.bytes += arch.bytes;
        if rep.files > 0 { rep.note = None; }
        sections.push(rep);
    }
    if options.diagnostics { sections.push(add_dir(&mut zip, "diagnostics", &dir.join("diagnostics"), &[], "diagnostics")); }

    // The manifest goes in LAST, when every count is known, and it is the first thing anybody
    // opening the archive will read.
    let manifest = serde_json::json!({
        "format": "DATABMM",
        "version": 1,
        "app": "BetterModsManager",
        "app_version": app_handle.package_info().version.to_string(),
        "created": chrono::Utc::now().to_rfc3339(),
        "sections": sections,
    });
    // Signed, so a restore can tell whether the archive is still the one this BMM wrote.
    // It covers the manifest — which names every section and its file and byte counts — so
    // adding, removing or swapping a file inside the archive shows up as a count that no
    // longer matches a signature nobody else can produce.
    let mut manifest = manifest;
    crate::commands::doc_sign::sign_doc(&app_handle, &mut manifest, "databmm");
    zip.start_file("manifest.json", json_opts).map_err(|e| AppError::from(e.to_string()))?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;

    zip.finish().map_err(|e| AppError::from(e.to_string()))?;
    let bytes = std::fs::metadata(&dest_path).map(|m| m.len()).unwrap_or(0);
    Ok(BundleResult { path: dest_path, bytes, sections })
}
