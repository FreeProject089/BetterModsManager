//! Custom sandboxed pages (navbar "Page" kind).
//!
//! A custom page is **untrusted** HTML/CSS/JS/WASM stored under
//! `<app_data>/custom_pages/<id>/`. It is served read-only through the
//! `bmmpage://` URI scheme with a strict Content-Security-Policy (`page_csp`), and
//! rendered in an iframe with `sandbox` *without* `allow-same-origin` (opaque `null`
//! origin). It cannot touch the BMM DOM, `__TAURI__`/`invoke`, cookies/localStorage or
//! another page's bundle; the only thing it can do with `window.parent` is `postMessage`.
//!
//! Capabilities ARE wired, default-deny, per page:
//!  - the page calls the `bmm.js` SDK (`PAGE_SDK_JS`, written into every bundle), which
//!    `postMessage`s the parent; the broker (`frontend/src/ui/custom-page-broker.ts`)
//!    answers only for a capability in the page's grants (`grants.json`, `page_set_grant`:
//!    ticked in the navbar editor, or chosen item by item in the review step of a `.bmmnav`
//!    import, which creates the page with nothing and records the answer in
//!    `grants_meta.json`; `KNOWN_CAPS` is the whole list):
//!    `storage` (a per-page key-value file, quota-capped), `notifications`, `network`,
//!    `read` (app name/version/platform, current theme), `clipboard` (done by the parent
//!    frame) and `system` (aggregate OS/hardware facts, never names, files or processes);
//!  - `network` is further limited to the page's own origin allow-list
//!    (`net_origins.json`, `clean_origin`): those origins are added to the page's CSP, and
//!    `page_fetch` re-checks the grant and the origin itself, follows redirects only within
//!    the list and caps the body;
//!  - every command that acts for a page (`page_storage_*`, `page_fetch`, `page_system_info`,
//!    `page_require_grant`) re-checks on the Rust side through `require_cap`: the id must be an
//!    installed page, the capability in its EFFECTIVE grants, and the caller not a page frame;
//!  - grants, storage and origins live outside the read-only bundle, in
//!    `<app_data>/custom_pages_data/<id>/`, and `delete_custom_page` removes them with it.
//!
//! Without any grant a page can compute and render, and reach nothing outside its bundle.

use std::borrow::Cow;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize, Deserialize, Clone)]
pub struct PagePermission {
    pub cap: String,
    #[serde(default)]
    pub origins: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PageManifest {
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    /// "html" | "js" | "wasm" — informational; the sandbox is identical either way.
    #[serde(default = "default_runtime")]
    pub runtime: String,
    /// Declared capabilities. NONE are granted automatically — reserved for a
    /// later permission phase. Present so manifests are forward-compatible.
    #[serde(default)]
    pub permissions: Vec<PagePermission>,
}
fn default_version() -> String {
    "1.0.0".into()
}
fn default_entry() -> String {
    "index.html".into()
}
fn default_runtime() -> String {
    "html".into()
}

#[derive(Serialize, Clone)]
pub struct PageMeta {
    pub id: String,
    pub name: String,
    pub runtime: String,
    pub entry: String,
}

fn pages_root<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("custom_pages")
}

/// A page id must be a short, filesystem-safe slug (no traversal, no separators).
fn sanitize_id(id: &str) -> Option<String> {
    if id.is_empty() || id.len() > 64 {
        return None;
    }
    if id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Some(id.to_string())
    } else {
        None
    }
}

fn unique_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("p{:x}", n)
}

/// The wrapper every document in a page bundle gets: the shared stylesheet, the SDK, and the
/// page's own script when it has one.
///
/// Built by concatenation rather than one big format string so the pieces stay readable, and
/// extracted because index.html and every sub-page MUST be produced the same way. The head
/// existed twice already (create and update); a sub-page generated from a third copy would
/// have been a page that quietly lost its styling the first time somebody edited one of them.
fn page_document(has_js: bool, title: Option<&str>, html: &str) -> String {
    let mut doc = String::from("<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n");
    if let Some(t) = title {
        doc.push_str("<title>");
        doc.push_str(&html_escape_title(t));
        doc.push_str("</title>\n");
    }
    doc.push_str("<link rel=\"stylesheet\" href=\"style.css\">\n");
    doc.push_str("<script src=\"bmm.js\" defer></script>\n");
    if has_js {
        doc.push_str("<script src=\"app.js\" defer></script>\n");
    }
    doc.push_str("</head>\n<body>\n");
    doc.push_str(html);
    doc.push_str("\n</body>\n</html>\n");
    doc
}

/// A title is written into markup, so the characters that could close the element or open an
/// attribute are escaped. The page is sandboxed and same-bundle, but a title that silently
/// truncates the document at a stray `<` is a bug whatever the threat model says.
fn html_escape_title(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// A sub-page's file name, from a slug somebody typed.
///
/// Deliberately narrower than `sanitize_id`: this becomes a FILE NAME. The protocol handler
/// already refuses `..` and canonicalises against the page root, but a slug is user input and
/// the check belongs where the name is minted, not only where it is served. Lowercase ASCII,
/// digits and hyphens. `index` is refused because that is the page's own entry document and
/// overwriting it from here would replace the page with one of its sub-pages.
fn sanitize_slug(slug: &str) -> Option<String> {
    let s = slug.trim().to_ascii_lowercase();
    if s.is_empty() || s.len() > 40 || s == "index" {
        return None;
    }
    if s
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        Some(s)
    } else {
        None
    }
}

/// One extra document in a page bundle.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PageDoc {
    pub slug: String,
    pub title: String,
}

/// The same, plus the markup inside <body> — what the editor loads.
#[derive(serde::Serialize)]
pub struct PageDocSource {
    pub slug: String,
    pub title: String,
    pub html: String,
}

fn read_title(doc: &str, fallback: &str) -> String {
    let open = "<title>";
    match doc.find(open) {
        Some(a) => {
            let a = a + open.len();
            match doc[a..].find("</title>") {
                Some(b) => doc[a..a + b].trim().to_string(),
                None => fallback.to_string(),
            }
        }
        None => fallback.to_string(),
    }
}

/// Every document in a page's bundle except its entry.
#[tauri::command]
pub fn list_page_docs<R: Runtime>(app: AppHandle<R>, id: String) -> Vec<PageDoc> {
    let id = match sanitize_id(&id) {
        Some(i) => i,
        None => return Vec::new(),
    };
    let dir = pages_root(&app).join(&id);
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".html") || name == "index.html" {
                continue;
            }
            let slug = name.trim_end_matches(".html").to_string();
            if sanitize_slug(&slug).is_none() {
                continue;
            }
            // The title is read back OUT of the document rather than mirrored in the
            // manifest: one place to change it, and a file edited by hand outside the app
            // still lists correctly instead of showing a name nothing on disk agrees with.
            let title = std::fs::read_to_string(e.path())
                .map(|t| read_title(&t, &slug))
                .unwrap_or_else(|_| slug.clone());
            out.push(PageDoc { slug, title });
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// Read one sub-page back for editing.
#[tauri::command]
pub fn get_page_doc<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    slug: String,
) -> Result<PageDocSource, String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let slug = sanitize_slug(&slug).ok_or("invalid name")?;
    let path = pages_root(&app).join(&id).join(format!("{}.html", slug));
    let doc = std::fs::read_to_string(&path).map_err(|_| "sub-page not found".to_string())?;
    let html = match (doc.find("<body>"), doc.rfind("</body>")) {
        (Some(a), Some(b)) if b > a => doc[a + "<body>".len()..b].trim().to_string(),
        _ => String::new(),
    };
    let title = read_title(&doc, &slug);
    Ok(PageDocSource { slug, title, html })
}

/// Create or overwrite one sub-page.
#[tauri::command]
pub fn save_page_doc<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    slug: String,
    title: String,
    html: String,
) -> Result<PageDoc, String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let slug = sanitize_slug(&slug)
        .ok_or("a name may use lowercase letters, digits and hyphens, and cannot be \"index\"")?;
    let dir = pages_root(&app).join(&id);
    if !dir.exists() {
        return Err("page not found".into());
    }
    // The sub-page loads app.js exactly when the index does, so one script runs across the
    // whole bundle — an author should not discover that their code stopped working at the
    // first link they followed.
    let has_js = dir.join("app.js").exists();
    let trimmed = title.trim();
    let title = if trimmed.is_empty() { slug.clone() } else { trimmed.to_string() };
    let doc = page_document(has_js, Some(&title), &html);
    std::fs::write(dir.join(format!("{}.html", slug)), doc).map_err(|e| e.to_string())?;
    Ok(PageDoc { slug, title })
}

#[tauri::command]
pub fn delete_page_doc<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    slug: String,
) -> Result<(), String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let slug = sanitize_slug(&slug).ok_or("invalid name")?;
    let path = pages_root(&app).join(&id).join(format!("{}.html", slug));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod subpage_roundtrip {
    use super::{page_document, read_title};

    /// The parsing half of the round trip: what save writes, get_page_doc must read back.
    /// Both sides are exercised here against a real string rather than a real AppHandle,
    /// because the only Tauri-specific part is which directory it lands in.
    #[test]
    fn a_saved_document_reads_back_exactly() {
        let body = "<p><a href=\"index.html\">Back</a></p>
<h1>About</h1>";
        let doc = page_document(true, Some("About us"), body);

        // get_page_doc's extraction, verbatim.
        let html = match (doc.find("<body>"), doc.rfind("</body>")) {
            (Some(a), Some(b)) if b > a => doc[a + "<body>".len()..b].trim().to_string(),
            _ => String::new(),
        };
        assert_eq!(html, body, "the body must survive the round trip unchanged");
        assert_eq!(read_title(&doc, "fallback"), "About us");
    }

    /// A body containing the literal text "</body>" must not truncate the read-back. rfind
    /// is what makes this work, and a later edit to `find` would break it silently.
    #[test]
    fn a_body_mentioning_its_own_closing_tag_still_round_trips() {
        let body = "<pre>write &lt;/body&gt; here</pre>";
        let doc = page_document(false, Some("Docs"), body);
        let html = match (doc.find("<body>"), doc.rfind("</body>")) {
            (Some(a), Some(b)) if b > a => doc[a + "<body>".len()..b].trim().to_string(),
            _ => String::new(),
        };
        assert_eq!(html, body);
    }
}

#[cfg(test)]
mod subpage_tests {
    use super::{page_document, sanitize_slug, html_escape_title, read_title};

    #[test]
    fn a_slug_is_a_file_name_and_is_treated_as_one() {
        assert_eq!(sanitize_slug("About Us"), None); // a space is not a file name here
        assert_eq!(sanitize_slug("../../etc/passwd"), None);
        assert_eq!(sanitize_slug("index"), None); // that is the page's own entry
        assert_eq!(sanitize_slug(""), None);
        assert_eq!(sanitize_slug("a".repeat(41).as_str()), None);
        assert_eq!(sanitize_slug("  About  "), Some("about".to_string()));
        assert_eq!(sanitize_slug("part-2"), Some("part-2".to_string()));
    }

    /// Every document must carry the stylesheet and the SDK, or a sub-page renders unstyled
    /// and its bmm.* calls are undefined — the failure this shares one builder to avoid.
    #[test]
    fn every_document_carries_the_shared_bundle() {
        let d = page_document(true, Some("About"), "<p>hi</p>");
        assert!(d.contains("href=\"style.css\""));
        assert!(d.contains("src=\"bmm.js\""));
        assert!(d.contains("src=\"app.js\""));
        assert!(d.contains("<title>About</title>"));
        assert!(d.contains("<p>hi</p>"));
        // No app.js when the page has none, or the browser logs a 404 on every sub-page.
        assert!(!page_document(false, None, "x").contains("app.js"));
    }

    #[test]
    fn a_title_cannot_close_its_own_element() {
        let d = page_document(false, Some("</title><script>bad()</script>"), "");
        assert!(!d.contains("<script>bad()"));
        assert_eq!(html_escape_title("a<b>&\"c\""), "a&lt;b&gt;&amp;&quot;c&quot;");
    }

    #[test]
    fn the_title_survives_a_round_trip() {
        let d = page_document(false, Some("Getting started"), "<p>x</p>");
        assert_eq!(read_title(&d, "fallback"), "Getting started");
        assert_eq!(read_title("<html><head></head></html>", "fallback"), "fallback");
    }
}

#[tauri::command]
pub fn list_custom_pages<R: Runtime>(app: AppHandle<R>) -> Vec<PageMeta> {
    let root = pages_root(&app);
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let id = e.file_name().to_string_lossy().to_string();
            if sanitize_id(&id).is_none() {
                continue;
            }
            if let Ok(txt) = std::fs::read_to_string(e.path().join("manifest.json")) {
                if let Ok(m) = serde_json::from_str::<PageManifest>(&txt) {
                    out.push(PageMeta {
                        id,
                        name: m.name,
                        runtime: m.runtime,
                        entry: m.entry,
                    });
                }
            }
        }
    }
    out
}

/// Create a simple HTML/CSS page (the safe, scriptless default). `html` is the
/// body markup; `css` is the stylesheet. JS/WASM import is a separate path.
#[tauri::command]
pub fn create_custom_page<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    html: String,
    css: String,
    js: Option<String>,
) -> Result<PageMeta, String> {
    let id = unique_id();
    let dir = pages_root(&app).join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Inline scripts/handlers are blocked by the page CSP (script-src 'self'),
    // so user JS goes in a same-origin file `app.js` (loaded after bmm.js).
    let js = js.unwrap_or_default();
    let has_js = !js.trim().is_empty();
    let runtime = if has_js { "js" } else { "html" };

    let doc = page_document(has_js, None, &html);
    std::fs::write(dir.join("index.html"), doc).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("style.css"), css).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("bmm.js"), PAGE_SDK_JS).map_err(|e| e.to_string())?;
    if has_js {
        std::fs::write(dir.join("app.js"), js).map_err(|e| e.to_string())?;
    }

    let manifest = PageManifest {
        name: name.clone(),
        version: default_version(),
        entry: default_entry(),
        runtime: runtime.into(),
        permissions: vec![],
    };
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| e.to_string())?;

    Ok(PageMeta {
        id,
        name,
        runtime: runtime.into(),
        entry: "index.html".into(),
    })
}

/// Create a page from a shared `.bmmnav` file. The page is created with NO capability and NO
/// network origin, whatever the file lists: `requested` and `requested_origins` are only
/// recorded (`grants_meta.json`, `import-pending`) so the import review can show them, and
/// nothing is effective until the user answers it (`page_apply_reviewed_grants`). Always a
/// NEW page: an import never writes to an existing one, so re-importing a file cannot raise
/// the grants of a page already installed.
#[tauri::command]
pub fn create_imported_custom_page<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    html: String,
    css: String,
    js: Option<String>,
    requested: Vec<String>,
    requested_origins: Vec<String>,
) -> Result<ImportedPage, String> {
    let meta = create_custom_page(app.clone(), name, html, css, js)?;
    let dir = pages_data_root(&app).join(&meta.id);
    match mark_import_pending_in(&dir, &requested, &requested_origins) {
        Ok(review) => Ok(ImportedPage { page: meta, review }),
        Err(e) => {
            let _ = delete_custom_page(app, meta.id);
            Err(e)
        }
    }
}

#[derive(Serialize)]
pub struct ImportedPage {
    pub page: PageMeta,
    pub review: GrantsMeta,
}

/// Copy a picked file (e.g. a `.wasm` module, image, or `.js`) into a page's
/// bundle so the page can load it (`fetch('module.wasm')`, `<img src>`, …).
/// Validates the destination name and extension, and caps the size.
/// A relative path inside a page bundle, validated as a path rather than as a name.
///
/// `import_page_file` only ever accepted a bare filename, which is why a bundle could not
/// have folders. This accepts `assets/img/logo.png` and refuses everything that is not that:
/// an absolute path, a Windows drive, a `..` segment, an empty or dot-leading segment, and
/// anything over eight levels deep or 200 characters.
///
/// It is the FIRST of two checks. The second is on the resolved path — a symlink pointing
/// out of the bundle contains no `..` and would sail through this one.
fn sanitize_rel(rel: &str) -> Option<String> {
    let r = rel.trim().replace('\\', "/");
    if r.is_empty() || r.len() > 200 || r.starts_with('/') || r.contains(':') {
        return None;
    }
    let parts: Vec<&str> = r.split('/').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() || parts.len() > 8 {
        return None;
    }
    for p in &parts {
        if *p == ".." || p.starts_with('.') || p.len() > 64 {
            return None;
        }
    }
    Some(parts.join("/"))
}

/// Extensions a page bundle may hold. Shared by the single-file and whole-folder imports so
/// they cannot drift — a type refused one way and accepted the other is the kind of gap
/// nobody finds on purpose.
fn page_ext_ok(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    [
        ".wasm", ".js", ".mjs", ".json", ".css", ".html", ".png", ".jpg", ".jpeg", ".gif",
        ".svg", ".webp", ".avif", ".woff", ".woff2", ".ttf", ".otf", ".txt", ".csv", ".md",
        ".mp3", ".ogg", ".wav", ".mp4", ".webm",
    ]
    .iter()
    .any(|e| n.ends_with(e))
}

/// Never overwritable, whatever the path says: the SDK and the entry document.
fn page_reserved(rel: &str) -> bool {
    matches!(rel, "bmm.js" | "index.html" | "manifest.json")
}

/// The whole bundle, biggest first, as a flat list of relative paths.
#[derive(serde::Serialize)]
pub struct PageFile {
    pub path: String,
    pub bytes: u64,
    pub reserved: bool,
}

/// What is actually in a page's folder.
///
/// The bundle used to be write-only — you could import a file and never see it again. This
/// is what makes it a folder you can work in rather than a place things disappear into.
#[tauri::command]
pub fn list_page_files<R: Runtime>(app: AppHandle<R>, id: String) -> Vec<PageFile> {
    let id = match sanitize_id(&id) {
        Some(i) => i,
        None => return Vec::new(),
    };
    let root = pages_root(&app).join(&id);
    let mut out = Vec::new();
    fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut Vec<PageFile>, depth: usize) {
        if depth > 8 || out.len() > 2000 {
            return;
        }
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, root, out, depth + 1);
                } else if let Ok(rel) = p.strip_prefix(root) {
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    let bytes = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    let reserved = page_reserved(&rel);
                    out.push(PageFile { path: rel, bytes, reserved });
                }
            }
        }
    }
    walk(&root, &root, &mut out, 0);
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out
}

/// Copy one file in, anywhere in the bundle.
#[tauri::command]
pub fn import_page_path<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    src_path: String,
    dest_rel: String,
) -> Result<String, String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let rel = sanitize_rel(&dest_rel).ok_or("invalid destination path")?;
    if page_reserved(&rel) {
        return Err("reserved name".into());
    }
    if !page_ext_ok(&rel) {
        return Err("unsupported file type".into());
    }
    let root = pages_root(&app).join(&id);
    if !root.exists() {
        return Err("page not found".into());
    }
    let meta = std::fs::metadata(&src_path).map_err(|e| e.to_string())?;
    if meta.len() > 16 * 1024 * 1024 {
        return Err("file too large (max 16 MB)".into());
    }
    let dest = root.join(&rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // The second check, on the RESOLVED path. Canonicalising the parent (the file may not
    // exist yet) and confirming it is still inside the bundle is what a `..`-free symlink
    // cannot get past.
    let (cr, cd) = (
        std::fs::canonicalize(&root).map_err(|e| e.to_string())?,
        std::fs::canonicalize(dest.parent().unwrap_or(&root)).map_err(|e| e.to_string())?,
    );
    if !cd.starts_with(&cr) {
        return Err("destination escapes the page folder".into());
    }
    std::fs::copy(&src_path, &dest).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Copy a whole folder in, keeping its shape.
///
/// Returns what it took and what it skipped, because a silent partial copy is worse than a
/// refusal: an author whose fonts folder half-arrived would debug their CSS.
#[derive(serde::Serialize)]
pub struct ImportReport {
    pub copied: Vec<String>,
    pub skipped: Vec<String>,
    pub bytes: u64,
}

#[tauri::command]
pub fn import_page_dir<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    src_dir: String,
    dest_rel: String,
) -> Result<ImportReport, String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    // An empty destination means the bundle root; otherwise a validated sub-path.
    let base = if dest_rel.trim().is_empty() {
        String::new()
    } else {
        sanitize_rel(&dest_rel).ok_or("invalid destination path")?
    };
    let root = pages_root(&app).join(&id);
    if !root.exists() {
        return Err("page not found".into());
    }
    let src = std::path::Path::new(&src_dir);
    if !src.is_dir() {
        return Err("not a folder".into());
    }

    let mut rep = ImportReport { copied: Vec::new(), skipped: Vec::new(), bytes: 0 };

    // Bounded on all three axes a runaway copy could blow: depth, file count, total bytes.
    // A page bundle is a page, not a backup target.
    fn walk(
        dir: &std::path::Path,
        srcroot: &std::path::Path,
        root: &std::path::Path,
        base: &str,
        rep: &mut ImportReport,
        depth: usize,
    ) {
        if depth > 6 || rep.copied.len() >= 500 || rep.bytes >= 64 * 1024 * 1024 {
            return;
        }
        let rd = match std::fs::read_dir(dir) { Ok(r) => r, Err(_) => return };
        for e in rd.flatten() {
            let p = e.path();
            let rel_src = match p.strip_prefix(srcroot) { Ok(r) => r, Err(_) => continue };
            let rel = rel_src.to_string_lossy().replace('\\', "/");
            let target = if base.is_empty() { rel.clone() } else { format!("{}/{}", base, rel) };
            if p.is_dir() {
                walk(&p, srcroot, root, base, rep, depth + 1);
                continue;
            }
            let clean = match sanitize_rel(&target) { Some(c) => c, None => { rep.skipped.push(rel); continue } };
            if page_reserved(&clean) || !page_ext_ok(&clean) {
                rep.skipped.push(rel);
                continue;
            }
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            if size > 16 * 1024 * 1024 || rep.bytes + size > 64 * 1024 * 1024 {
                rep.skipped.push(rel);
                continue;
            }
            let dest = root.join(&clean);
            if let Some(parent) = dest.parent() {
                if std::fs::create_dir_all(parent).is_err() { rep.skipped.push(rel); continue; }
            }
            match (std::fs::canonicalize(root), std::fs::canonicalize(dest.parent().unwrap_or(root))) {
                (Ok(cr), Ok(cd)) if cd.starts_with(&cr) => {}
                _ => { rep.skipped.push(rel); continue }
            }
            if std::fs::copy(&p, &dest).is_ok() {
                rep.bytes += size;
                rep.copied.push(clean);
            } else {
                rep.skipped.push(rel);
            }
        }
    }
    walk(src, src, &root, &base, &mut rep, 0);
    Ok(rep)
}

/// Remove one file from a bundle. Never the SDK, the entry, or the manifest.
#[tauri::command]
pub fn delete_page_file<R: Runtime>(app: AppHandle<R>, id: String, rel: String) -> Result<(), String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let rel = sanitize_rel(&rel).ok_or("invalid path")?;
    if page_reserved(&rel) {
        return Err("that file belongs to the page itself".into());
    }
    let root = pages_root(&app).join(&id);
    let target = root.join(&rel);
    match (std::fs::canonicalize(&root), std::fs::canonicalize(&target)) {
        (Ok(cr), Ok(ct)) if ct.starts_with(&cr) => {
            std::fs::remove_file(&ct).map_err(|e| e.to_string())?;
            Ok(())
        }
        _ => Err("not in this page".into()),
    }
}

#[cfg(test)]
mod page_asset_tests {
    use super::{sanitize_rel, page_ext_ok, page_reserved};

    /// The string check. It cannot see symlinks — that is what the canonicalise in each
    /// command is for — but everything spelled as an escape has to die here.
    #[test]
    fn a_destination_path_is_validated_as_a_path() {
        assert_eq!(sanitize_rel("assets/img/logo.png"), Some("assets/img/logo.png".to_string()));
        assert_eq!(sanitize_rel("assets\\img\\logo.png"), Some("assets/img/logo.png".to_string()));
        assert_eq!(sanitize_rel("a//b/c.png"), Some("a/b/c.png".to_string()));
        assert_eq!(sanitize_rel("../../etc/passwd"), None);
        assert_eq!(sanitize_rel("a/../../b.png"), None);
        assert_eq!(sanitize_rel("/etc/passwd"), None);
        assert_eq!(sanitize_rel("C:/Windows/system32"), None);
        assert_eq!(sanitize_rel(".hidden/x.png"), None);
        assert_eq!(sanitize_rel(""), None);
        assert_eq!(sanitize_rel("a/b/c/d/e/f/g/h/i/j.png"), None); // deeper than 8
    }

    #[test]
    fn the_page_cannot_be_overwritten_by_its_own_assets() {
        assert!(page_reserved("bmm.js"));
        assert!(page_reserved("index.html"));
        assert!(page_reserved("manifest.json"));
        assert!(!page_reserved("assets/bmm.js")); // a copy in a folder is not the SDK
    }

    #[test]
    fn only_the_types_a_page_can_use() {
        assert!(page_ext_ok("a/b/logo.PNG"));
        assert!(page_ext_ok("font.woff2"));
        assert!(!page_ext_ok("payload.exe"));
        assert!(!page_ext_ok("script.bat"));
        assert!(!page_ext_ok("noextension"));
    }
}

#[tauri::command]
pub fn import_page_file<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    src_path: String,
    dest_name: String,
) -> Result<String, String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    // Destination must be a plain filename (no path, no traversal).
    let name = std::path::Path::new(&dest_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid name")?
        .to_string();
    if name.contains("..") || name.starts_with('.') || name.len() > 64 {
        return Err("invalid name".into());
    }
    let ext_ok = [
        ".wasm", ".js", ".mjs", ".json", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg",
        ".woff2", ".txt", ".csv",
    ]
    .iter()
    .any(|e| name.to_ascii_lowercase().ends_with(e));
    if !ext_ok {
        return Err("unsupported file type".into());
    }
    // Never let an imported file overwrite the SDK or the entry document.
    if matches!(name.as_str(), "bmm.js" | "index.html") {
        return Err("reserved name".into());
    }
    let src = std::path::Path::new(&src_path);
    let meta = std::fs::metadata(src).map_err(|e| e.to_string())?;
    if meta.len() > 16 * 1024 * 1024 {
        return Err("file too large (max 16 MB)".into());
    }
    let dir = pages_root(&app).join(&id);
    if !dir.exists() {
        return Err("page not found".into());
    }
    std::fs::copy(src, dir.join(&name)).map_err(|e| e.to_string())?;
    Ok(name)
}

#[derive(Serialize)]
pub struct PageSource {
    pub name: String,
    pub html: String,
    pub css: String,
    pub js: String,
}

/// Read back a page's editable source (name + HTML body + CSS + JS) so it can be
/// re-opened in the editor. The HTML is extracted from between the body tags of
/// the generated index.html.
#[tauri::command]
pub fn get_custom_page_source<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<PageSource, String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let dir = pages_root(&app).join(&id);
    if !dir.exists() {
        return Err("page not found".into());
    }
    let name = std::fs::read_to_string(dir.join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<PageManifest>(&t).ok())
        .map(|m| m.name)
        .unwrap_or_default();
    let index = std::fs::read_to_string(dir.join("index.html")).unwrap_or_default();
    let html = match (index.find("<body>"), index.rfind("</body>")) {
        (Some(a), Some(b)) if b > a => index[a + "<body>".len()..b].trim().to_string(),
        _ => String::new(),
    };
    let css = std::fs::read_to_string(dir.join("style.css")).unwrap_or_default();
    let js = std::fs::read_to_string(dir.join("app.js")).unwrap_or_default();
    Ok(PageSource {
        name,
        html,
        css,
        js,
    })
}

/// Overwrite an existing page's bundle (name/HTML/CSS/JS). Keeps the page id, and
/// leaves its grants / storage / network origins (in custom_pages_data) untouched.
#[tauri::command]
pub fn update_custom_page<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    html: String,
    css: String,
    js: Option<String>,
) -> Result<(), String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let dir = pages_root(&app).join(&id);
    if !dir.exists() {
        return Err("page not found".into());
    }
    let js = js.unwrap_or_default();
    let has_js = !js.trim().is_empty();
    let doc = page_document(has_js, None, &html);
    std::fs::write(dir.join("index.html"), doc).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("style.css"), css).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("bmm.js"), PAGE_SDK_JS).map_err(|e| e.to_string())?; // refresh SDK
    let app_js = dir.join("app.js");
    if has_js {
        std::fs::write(&app_js, js).map_err(|e| e.to_string())?;
    } else if app_js.exists() {
        let _ = std::fs::remove_file(&app_js);
    }
    // Update the manifest's name + runtime.
    let manifest = PageManifest {
        name,
        version: default_version(),
        entry: default_entry(),
        runtime: if has_js { "js".into() } else { "html".into() },
        permissions: vec![],
    };
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_custom_page<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let id = sanitize_id(&id).ok_or("invalid id")?;
    let dir = pages_root(&app).join(&id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    // Also drop the page's runtime data (storage + grants).
    let data = pages_data_root(&app).join(&id);
    if data.exists() {
        let _ = std::fs::remove_dir_all(&data);
    }
    Ok(())
}

/// The tiny page-side SDK written into every page bundle as `bmm.js`. It is the
/// *only* way a page talks to BMM: it wraps `postMessage` to the parent broker
/// in promises. The page must still have been granted each capability, or calls
/// reject with `permission_denied`.
const PAGE_SDK_JS: &str = r#"(function(){
  var seq=0, pending={};
  function call(cap, method, args){
    return new Promise(function(res,rej){
      var reqId=++seq; pending[reqId]={res:res,rej:rej};
      parent.postMessage({__bmm:true,reqId:reqId,cap:cap,method:method,args:args||{}}, '*');
    });
  }
  window.addEventListener('message', function(e){
    var d=e.data; if(!d||d.__bmmReply!==true) return;
    var p=pending[d.reqId]; if(!p) return; delete pending[d.reqId];
    if(d.error) p.rej(new Error(d.error)); else p.res(d.ok);
  });
  window.bmm={
    storage:{
      get:function(k){return call('storage','get',{key:k});},
      set:function(k,v){return call('storage','set',{key:String(k),value:String(v)});},
      remove:function(k){return call('storage','remove',{key:k});},
      keys:function(){return call('storage','keys',{});},
      clear:function(){return call('storage','clear',{});}
    },
    notify:function(msg,type){return call('notifications','notify',{msg:String(msg),type:type});},
    // Internet GET — only if the page was granted `network` AND the URL's origin
    // is on its allow-list (else rejects). Returns {status, body}.
    fetch:function(url){return call('network','fetch',{url:String(url)});},
    // Read a few non-sensitive values (app.name/app.version/app.platform/theme.current)
    // if granted `read`. Never exposes BMM data, files, or the system.
    read:function(scope){return call('read','get',{scope:String(scope)});},
    // Clipboard (needs `clipboard`). write resolves true; read returns the text.
    clipboard:{
      write:function(text){return call('clipboard','write',{text:String(text)});},
      read:function(){return call('clipboard','read',{});}
    },
    // Safe read-only system info (needs `system`): {os,arch,osVersion,
    // kernelVersion,cpuCount,memTotalMb,memAvailableMb,uptimeSec}. No file/shell.
    system:{
      info:function(){return call('system','info',{}).then(function(s){try{return JSON.parse(s);}catch(e){return s;}});}
    }
  };
})();
"#;

// ── Per-page runtime data (storage + permission grants) ───────────────────
//
// Kept OUTSIDE the page bundle (which is read-only) in a sibling tree:
//   <app_data>/custom_pages_data/<id>/{storage.json, grants.json}
// Every entry is namespaced by page id, so one page can never read another's
// data. A page only reaches this through the postMessage broker, and only for
// capabilities its grants list explicitly contains (default-deny).

/// Capabilities that may be granted to a page. Anything not in this set is rejected.
/// `network` is further constrained by a per-page allow-list of origins;
/// `read` exposes only a few non-sensitive read-only values (never FS/shell/BMM data).
const KNOWN_CAPS: &[&str] = &[
    "storage",
    "notifications",
    "network",
    "read",
    "clipboard",
    "system",
];
/// Cap on a single fetched response (bytes) to bound memory.
const MAX_FETCH_BYTES: usize = 8 * 1024 * 1024;
/// Hard cap on a single page's key-value store (serialized JSON), to bound disk use.
const MAX_STORAGE_BYTES: usize = 2 * 1024 * 1024;

fn pages_data_root<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("custom_pages_data")
}
/// The page's data folder, created. Only for the editor's own writes (grants, origins):
/// every command that acts FOR a page goes through `require_cap`, which never creates
/// anything for an id that is not an installed page.
fn page_data_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<PathBuf> {
    let id = page_installed_in(&pages_root(app), id)?;
    let dir = pages_data_root(app).join(&id);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

// ── Who granted what: the review record ───────────────────────────────────
//
// `grants.json` says WHAT a page holds; `grants_meta.json` says HOW it came to hold it.
// The distinction exists because of `.bmmnav` import: the file used to list capabilities
// and origins and the importer re-granted every one of them with nothing shown, so a shared
// navbar was a way to hand a stranger's script `network` + `system` + `clipboard` on a
// machine whose owner never ticked a box. An imported page is now created in the
// `import-pending` state, in which its effective grants and origins are EMPTY whatever the
// files on disk say, and it leaves that state only through the user's review
// (`page_apply_reviewed_grants`, recorded as `import-review`) or the user's own ticks in
// the editor (`user`).

const GRANTS_META: &str = "grants_meta.json";
/// Imported, not reviewed yet: nothing is effective.
const SRC_IMPORT_PENDING: &str = "import-pending";
/// Set by the user in the import review step.
const SRC_IMPORT_REVIEW: &str = "import-review";
/// Ticked by the user in the navbar editor.
const SRC_USER: &str = "user";

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrantsMeta {
    /// `import-pending` | `import-review` | `user`; empty for a page that predates the record.
    #[serde(default)]
    pub source: String,
    /// What the imported file asked for (known capabilities only, cleaned origins). Kept after
    /// the review so the editor can say what was asked and what was refused.
    #[serde(default)]
    pub requested: Vec<String>,
    #[serde(default)]
    pub requested_origins: Vec<String>,
    /// Unix seconds of the user's review.
    #[serde(default)]
    pub reviewed_at: Option<u64>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The id as an INSTALLED page: a well-formed slug with a bundle and a manifest. Anything
/// else — a traversal, an id that was never created, one that was deleted — is not a page,
/// and nothing is read, created or granted for it.
fn page_installed_in(pages_root: &std::path::Path, id: &str) -> Option<String> {
    let id = sanitize_id(id)?;
    pages_root.join(&id).join("manifest.json").is_file().then_some(id)
}

fn read_meta_in(dir: &std::path::Path) -> GrantsMeta {
    std::fs::read_to_string(dir.join(GRANTS_META))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn write_meta_in(dir: &std::path::Path, meta: &GrantsMeta) -> Result<(), String> {
    std::fs::write(dir.join(GRANTS_META), serde_json::to_string(meta).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// `grants.json` as stored, limited to known capabilities and de-duplicated.
fn stored_grants_in(dir: &std::path::Path) -> Vec<String> {
    let raw: Vec<String> = std::fs::read_to_string(dir.join("grants.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for c in raw {
        if KNOWN_CAPS.contains(&c.as_str()) && !out.contains(&c) {
            out.push(c);
        }
    }
    out
}
fn stored_origins_in(dir: &std::path::Path) -> Vec<String> {
    // Cleaned on READ as well as on write: the file can arrive by a `.DATABMM` restore
    // (navigation/pages-data) without ever passing page_set_net_origins.
    std::fs::read_to_string(dir.join("net_origins.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
        .iter()
        .filter_map(|o| clean_origin(o))
        .collect()
}

/// What the page actually holds: nothing while an import awaits its review.
fn effective_grants_in(dir: &std::path::Path) -> Vec<String> {
    if read_meta_in(dir).source == SRC_IMPORT_PENDING {
        return Vec::new();
    }
    stored_grants_in(dir)
}
fn effective_origins_in(dir: &std::path::Path) -> Vec<String> {
    if read_meta_in(dir).source == SRC_IMPORT_PENDING {
        return Vec::new();
    }
    stored_origins_in(dir)
}

/// The Rust-side gate of every command that acts FOR a page. The page id must be an
/// installed page and the capability must be in its EFFECTIVE grants. Returns the page's
/// data folder (created only once both hold).
///
/// The broker checks the same thing from its cache first; this is the check that counts.
/// Before it, `page_storage_*` trusted the broker entirely: anything able to invoke them
/// read and wrote any page's store with no grant at all, and an id like `p1` for a page
/// that never existed created a data folder for it.
fn require_cap_in(
    pages_root: &std::path::Path,
    data_root: &std::path::Path,
    id: &str,
    cap: &str,
) -> Result<PathBuf, String> {
    let id = page_installed_in(pages_root, id).ok_or_else(|| "unknown_page: not an installed custom page".to_string())?;
    if !KNOWN_CAPS.contains(&cap) {
        return Err(format!("permission_denied: unknown capability \"{cap}\""));
    }
    let dir = data_root.join(&id);
    if !effective_grants_in(&dir).iter().any(|c| c == cap) {
        return Err(format!("permission_denied: this page does not hold the \"{cap}\" permission"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn require_cap<R: Runtime>(app: &AppHandle<R>, id: &str, cap: &str) -> Result<PathBuf, String> {
    require_cap_in(&pages_root(app), &pages_data_root(app), id, cap)
}

/// Is this IPC caller a custom page's own frame? A page runs at an opaque origin (`null`,
/// sandbox without allow-same-origin) served from `bmmpage`. It has no invoke key and should
/// never reach IPC at all; if a webview change ever let it, the page could name any page id
/// it liked. So the commands that act for a page refuse a page caller outright and only
/// accept the id from BMM's own frame, where the broker resolved it from the iframe element
/// that sent the message (`pageIdFor`, by contentWindow — never by what the page says).
fn caller_is_page_frame(origin: Option<&str>) -> bool {
    let Some(o) = origin.map(|o| o.trim().to_ascii_lowercase()) else { return false };
    if o == "null" || o.starts_with("bmmpage:") {
        return true;
    }
    reqwest::Url::parse(&o)
        .ok()
        .and_then(|u| u.host_str().map(|h| h == "bmmpage.localhost" || h.ends_with(".bmmpage.localhost")))
        .unwrap_or(false)
}
fn refuse_page_caller(request: &tauri::ipc::Request<'_>) -> Result<(), String> {
    let origin = request.headers().get("Origin").and_then(|v| v.to_str().ok());
    if caller_is_page_frame(origin) {
        return Err("permission_denied: a custom page cannot call this directly".into());
    }
    Ok(())
}

fn read_kv_in(dir: &std::path::Path) -> std::collections::BTreeMap<String, String> {
    std::fs::read_to_string(dir.join("storage.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn write_kv_in(dir: &std::path::Path, kv: &std::collections::BTreeMap<String, String>) -> Result<(), String> {
    let txt = serde_json::to_string(kv).map_err(|e| e.to_string())?;
    if txt.len() > MAX_STORAGE_BYTES {
        return Err("storage quota exceeded".into());
    }
    std::fs::write(dir.join("storage.json"), txt).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn page_storage_get<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
    key: String,
) -> Result<Option<String>, String> {
    refuse_page_caller(&request)?;
    let dir = require_cap(&app, &id, "storage")?;
    Ok(read_kv_in(&dir).get(&key).cloned())
}
#[tauri::command]
pub fn page_storage_set<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    refuse_page_caller(&request)?;
    let dir = require_cap(&app, &id, "storage")?;
    if key.len() > 512 {
        return Err("key too long".into());
    }
    let mut kv = read_kv_in(&dir);
    kv.insert(key, value);
    write_kv_in(&dir, &kv)
}
#[tauri::command]
pub fn page_storage_remove<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
    key: String,
) -> Result<(), String> {
    refuse_page_caller(&request)?;
    let dir = require_cap(&app, &id, "storage")?;
    let mut kv = read_kv_in(&dir);
    kv.remove(&key);
    write_kv_in(&dir, &kv)
}
#[tauri::command]
pub fn page_storage_keys<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<String>, String> {
    refuse_page_caller(&request)?;
    let dir = require_cap(&app, &id, "storage")?;
    Ok(read_kv_in(&dir).keys().cloned().collect())
}
#[tauri::command]
pub fn page_storage_clear<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    refuse_page_caller(&request)?;
    let dir = require_cap(&app, &id, "storage")?;
    write_kv_in(&dir, &std::collections::BTreeMap::new())
}

/// The broker's authoritative check for the capabilities it serves itself (notifications,
/// clipboard, app info): the same gate as the Rust-served ones, so the broker's cache is a
/// shortcut and never the decision.
#[tauri::command]
pub fn page_require_grant<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
    cap: String,
) -> Result<(), String> {
    refuse_page_caller(&request)?;
    require_cap(&app, &id, &cap).map(|_| ())
}

fn read_grants<R: Runtime>(app: &AppHandle<R>, id: &str) -> Vec<String> {
    match page_installed_in(&pages_root(app), id) {
        Some(id) => effective_grants_in(&pages_data_root(app).join(id)),
        None => Vec::new(),
    }
}

/// The page's EFFECTIVE grants (empty while an import awaits review).
#[tauri::command]
pub fn page_grants_get<R: Runtime>(app: AppHandle<R>, id: String) -> Vec<String> {
    read_grants(&app, &id)
}

/// How the page's grants were set, and what an imported file asked for.
#[tauri::command]
pub fn page_grant_review_get<R: Runtime>(app: AppHandle<R>, id: String) -> GrantsMeta {
    match page_installed_in(&pages_root(&app), &id) {
        Some(id) => read_meta_in(&pages_data_root(&app).join(id)),
        None => GrantsMeta::default(),
    }
}

/// A user's own tick in the editor. On a page still awaiting its import review the stored
/// grants are empty (written so by `mark_import_pending_in`), so this starts from nothing,
/// and the page leaves the pending state as `user`: what it holds is what the user ticked.
fn set_grant_in(dir: &std::path::Path, cap: &str, granted: bool) -> Result<Vec<String>, String> {
    if !KNOWN_CAPS.contains(&cap) {
        return Err("unknown capability".into());
    }
    let mut meta = read_meta_in(dir);
    let mut grants = if meta.source == SRC_IMPORT_PENDING { Vec::new() } else { stored_grants_in(dir) };
    grants.retain(|c| c != cap);
    if granted {
        grants.push(cap.to_string());
    }
    std::fs::write(dir.join("grants.json"), serde_json::to_string(&grants).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if meta.source == SRC_IMPORT_PENDING {
        // The origins the file asked for were never approved: drop them with the state.
        std::fs::write(dir.join("net_origins.json"), "[]").map_err(|e| e.to_string())?;
    }
    meta.source = SRC_USER.into();
    write_meta_in(dir, &meta)?;
    Ok(grants)
}

#[tauri::command]
pub fn page_set_grant<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cap: String,
    granted: bool,
) -> Result<Vec<String>, String> {
    let dir = page_data_dir(&app, &id).ok_or("invalid id")?;
    set_grant_in(&dir, &cap, granted)
}

/// An imported page starts here: no grants, no origins, whatever its file listed, and a
/// record of what the file asked for so the review can show it.
fn mark_import_pending_in(
    dir: &std::path::Path,
    requested: &[String],
    requested_origins: &[String],
) -> Result<GrantsMeta, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut caps: Vec<String> = Vec::new();
    for c in requested {
        if KNOWN_CAPS.contains(&c.as_str()) && !caps.contains(c) {
            caps.push(c.clone());
        }
    }
    let mut origins: Vec<String> = Vec::new();
    for o in requested_origins.iter().filter_map(|o| clean_origin(o)) {
        if !origins.iter().any(|x| x.eq_ignore_ascii_case(&o)) {
            origins.push(o);
        }
    }
    std::fs::write(dir.join("grants.json"), "[]").map_err(|e| e.to_string())?;
    std::fs::write(dir.join("net_origins.json"), "[]").map_err(|e| e.to_string())?;
    let meta = GrantsMeta { source: SRC_IMPORT_PENDING.into(), requested: caps, requested_origins: origins, reviewed_at: None };
    write_meta_in(dir, &meta)?;
    Ok(meta)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ReviewedGrants {
    pub grants: Vec<String>,
    pub origins: Vec<String>,
}

/// Apply the user's answer to the import review. Only on a page still pending, only
/// capabilities and origins the file asked for, origins only alongside `network`. An empty
/// answer ("grant none") is the normal case and leaves the page with nothing.
fn apply_review_in(dir: &std::path::Path, caps: &[String], origins: &[String]) -> Result<ReviewedGrants, String> {
    let mut meta = read_meta_in(dir);
    if meta.source != SRC_IMPORT_PENDING {
        return Err("review_not_pending: this page has no import review waiting".into());
    }
    let mut grants: Vec<String> = Vec::new();
    for c in caps {
        if !meta.requested.contains(c) {
            return Err(format!("not_requested: the imported file did not ask for \"{c}\""));
        }
        if !grants.contains(c) {
            grants.push(c.clone());
        }
    }
    let mut kept: Vec<String> = Vec::new();
    if grants.iter().any(|c| c == "network") {
        for raw in origins {
            let o = clean_origin(raw).ok_or_else(|| format!("not_requested: \"{raw}\" is not an origin"))?;
            if !meta.requested_origins.iter().any(|r| r.eq_ignore_ascii_case(&o)) {
                return Err(format!("not_requested: the imported file did not ask for {o}"));
            }
            if !kept.iter().any(|k| k.eq_ignore_ascii_case(&o)) {
                kept.push(o);
            }
        }
    }
    std::fs::write(dir.join("grants.json"), serde_json::to_string(&grants).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::write(dir.join("net_origins.json"), serde_json::to_string(&kept).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    meta.source = SRC_IMPORT_REVIEW.into();
    meta.reviewed_at = Some(now_secs());
    write_meta_in(dir, &meta)?;
    Ok(ReviewedGrants { grants, origins: kept })
}

#[tauri::command]
pub fn page_apply_reviewed_grants<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    caps: Vec<String>,
    origins: Vec<String>,
) -> Result<ReviewedGrants, String> {
    let dir = page_data_dir(&app, &id).ok_or("invalid id")?;
    apply_review_in(&dir, &caps, &origins)
}

// ── Network capability: per-page allow-listed origins + a guarded fetch ───
// A page never fetches the internet directly (CSP connect-src forbids it). When
// granted `network`, it calls the broker, which calls `page_fetch`. The backend
// re-checks the grant AND that the URL's origin is on the page's explicit
// allow-list before performing a plain GET. No headers/cookies from BMM are
// forwarded; the response is size-capped and returned as text.

/// The page's EFFECTIVE origins (empty while an import awaits review, or for an id that is
/// not an installed page).
fn read_net_origins<R: Runtime>(app: &AppHandle<R>, id: &str) -> Vec<String> {
    match page_installed_in(&pages_root(app), id) {
        Some(id) => effective_origins_in(&pages_data_root(app).join(id)),
        None => Vec::new(),
    }
}

/// `scheme://host[:port]` rebuilt from a parse, or `None`.
///
/// These strings are spliced into the page's Content-Security-Policy, and the old filter
/// (starts with http(s)://, no `/` after it) let `https://a.example; worker-src *` or
/// `https://a.example *` through — a new directive, or a wildcard beside the one origin the
/// user approved. Rebuilt from the parsed URL, an origin can hold nothing but an origin.
fn clean_origin(raw: &str) -> Option<String> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() || raw.len() >= 256 || raw.chars().any(|c| c.is_whitespace() || c == ';' || c == ',') {
        return None;
    }
    let u = reqwest::Url::parse(raw).ok()?;
    if !matches!(u.scheme(), "http" | "https")
        || !u.username().is_empty() || u.password().is_some()
        || u.query().is_some() || u.fragment().is_some()
        || !(u.path().is_empty() || u.path() == "/")
    {
        return None;
    }
    let host = u.host_str()?;
    Some(match u.port() {
        Some(port) => format!("{}://{}:{}", u.scheme(), host, port),
        None => format!("{}://{}", u.scheme(), host),
    })
}

#[tauri::command]
pub fn page_net_origins_get<R: Runtime>(app: AppHandle<R>, id: String) -> Vec<String> {
    read_net_origins(&app, &id)
}

#[tauri::command]
pub fn page_set_net_origins<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    origins: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = page_data_dir(&app, &id).ok_or("invalid id")?;
    set_origins_in(&dir, &origins)
}

/// A user's own origin list from the editor. Like `set_grant_in`, it ends a pending import
/// review as `user` — the grants stay empty until the user ticks one.
fn set_origins_in(dir: &std::path::Path, origins: &[String]) -> Result<Vec<String>, String> {
    // Keep only well-formed http(s) origins (scheme://host[:port], no path). See clean_origin.
    let clean: Vec<String> = origins.iter().filter_map(|o| clean_origin(o)).collect();
    std::fs::write(
        dir.join("net_origins.json"),
        serde_json::to_string(&clean).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut meta = read_meta_in(dir);
    if meta.source == SRC_IMPORT_PENDING {
        std::fs::write(dir.join("grants.json"), "[]").map_err(|e| e.to_string())?;
    }
    meta.source = SRC_USER.into();
    write_meta_in(dir, &meta)?;
    Ok(clean)
}

#[derive(Serialize)]
pub struct FetchResult {
    pub status: u16,
    pub body: String,
}

fn url_origin(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").map(|r| ("https://", r)).or_else(|| {
        url.strip_prefix("http://").map(|r| ("http://", r))
    })?;
    let (scheme, after) = rest;
    let host = after.split('/').next().unwrap_or("");
    if host.is_empty() {
        return None;
    }
    Some(format!("{}{}", scheme, host))
}

/// Is this origin (as `url_origin` returns it) on the list? Case-insensitively: a host is.
fn origin_allowed(origin: &str, allowed: &[String]) -> bool {
    allowed.iter().any(|o| o.eq_ignore_ascii_case(origin))
}

/// The broker's client: a redirect is followed only while it stays on the page's allow-list,
/// and at most five times. Built per call — the list is per page, and a page fetch is rare.
fn page_fetch_client(allowed: Vec<String>) -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many redirects");
            }
            let ok = url_origin(attempt.url().as_str())
                .map(|o| origin_allowed(&o, &allowed))
                .unwrap_or(false);
            if ok { attempt.follow() } else { attempt.stop() }
        }))
        .build()
        .unwrap_or_default()
}

#[cfg(test)]
mod page_network_tests {
    use super::*;

    #[test]
    fn an_origin_can_only_be_an_origin() {
        assert_eq!(clean_origin("https://api.example.com/").as_deref(), Some("https://api.example.com"));
        assert_eq!(clean_origin("http://LOCALHOST:8080").as_deref(), Some("http://localhost:8080"));
        for bad in [
            "https://a.example; worker-src *", "https://a.example;worker-src", "https://a.example *",
            "https://a.example 'unsafe-eval'",
            "https://a.example/path", "https://u:p@a.example", "https://a.example?x=1",
            "ftp://a.example", "javascript:alert(1)", "*", "https://", "",
        ] {
            assert_eq!(clean_origin(bad), None, "accepted {bad:?}");
        }
    }

    /// The trigger: an allowed site redirecting into the LAN. Served by a local listener that
    /// answers one request with a 302 to a second address that is NOT on the list, and would
    /// answer "INTERNAL" if it were ever reached.
    #[tokio::test]
    async fn a_redirect_off_the_allow_list_is_not_followed() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let inner = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let inner_addr = inner.local_addr().unwrap();
        let outer = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let outer_addr = outer.local_addr().unwrap();
        let reached_inner = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = reached_inner.clone();
        tokio::spawn(async move {
            if let Ok((mut s, _)) = inner.accept().await {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf).await;
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nINTERNAL").await;
            }
        });
        tokio::spawn(async move {
            if let Ok((mut s, _)) = outer.accept().await {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf).await;
                let resp = format!("HTTP/1.1 302 Found\r\nLocation: http://{inner_addr}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                let _ = s.write_all(resp.as_bytes()).await;
            }
        });
        // Different ports are different origins: only the outer one is allowed.
        let allowed = vec![format!("http://{outer_addr}")];
        let resp = page_fetch_client(allowed).get(format!("http://{outer_addr}/")).send().await.unwrap();
        assert_eq!(resp.status().as_u16(), 302, "the redirect was followed");
        assert!(!reached_inner.load(std::sync::atomic::Ordering::SeqCst), "the LAN address was fetched");
    }
}

#[tauri::command]
pub async fn page_fetch<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
    url: String,
) -> Result<FetchResult, String> {
    // 1) The caller is BMM's frame, the id an installed page, and that page holds `network`.
    refuse_page_caller(&request)?;
    require_cap(&app, &id, "network")?;
    // 2) The URL's origin must be on this page's explicit allow-list.
    let origin = url_origin(&url).ok_or("invalid url")?;
    let allowed = read_net_origins(&app, &id);
    if !origin_allowed(&origin, &allowed) {
        return Err("origin_not_allowed".into());
    }
    // 3) Plain GET, no BMM credentials, size-capped — and a redirect is followed only to
    //    an origin on the same list. The shared client follows up to ten anywhere, so one
    //    allowed site answering `302 Location: http://192.168.1.1/` (or 127.0.0.1:<the BMM
    //    API>) had BMM fetch the LAN for a sandboxed page and hand it the body (CWE-918).
    let resp = page_fetch_client(allowed).get(&url)
        .timeout(std::time::Duration::from_secs(20))
        .send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    // Streamed against the cap rather than buffered whole and measured afterwards.
    let mut resp = resp;
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_FETCH_BYTES {
            return Err("response too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    Ok(FetchResult { status, body })
}

/// Safe, read-only system info for the `system` capability. Exposes only
/// non-identifying, aggregate hardware/OS facts — NEVER the hostname, user name,
/// file system, processes, env vars, or any way to run code. The page must hold
/// the `system` grant (re-checked here, defence-in-depth).
#[tauri::command]
pub fn page_system_info<R: Runtime>(
    request: tauri::ipc::Request<'_>,
    app: AppHandle<R>,
    id: String,
) -> Result<String, String> {
    refuse_page_caller(&request)?;
    require_cap(&app, &id, "system")?;
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu();
    let info = serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "osVersion": sysinfo::System::os_version().unwrap_or_default(),
        "kernelVersion": sysinfo::System::kernel_version().unwrap_or_default(),
        "cpuCount": sys.cpus().len(),
        "memTotalMb": sys.total_memory() / (1024 * 1024),
        "memAvailableMb": sys.available_memory() / (1024 * 1024),
        "uptimeSec": sysinfo::System::uptime(),
    });
    Ok(info.to_string())
}

fn mime_for(f: &str) -> &'static str {
    let l = f.to_ascii_lowercase();
    if l.ends_with(".html") || l.ends_with(".htm") {
        "text/html; charset=utf-8"
    } else if l.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if l.ends_with(".js") || l.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if l.ends_with(".wasm") {
        "application/wasm"
    } else if l.ends_with(".json") {
        "application/json"
    } else if l.ends_with(".png") {
        "image/png"
    } else if l.ends_with(".jpg") || l.ends_with(".jpeg") {
        "image/jpeg"
    } else if l.ends_with(".gif") {
        "image/gif"
    } else if l.ends_with(".svg") {
        "image/svg+xml"
    } else if l.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
}

/// The CSP served with a page document. `default-src 'none'` denies everything;
/// only the page's OWN bundle (same id) may be loaded/fetched — `connect-src` is
/// scoped to this page's path, so a page can fetch its own assets (incl. `.wasm`)
/// but **never the internet** (internet goes through the broker `network` cap and
/// its per-page origin allow-list) and **never another page's bundle**.
/// `wasm-unsafe-eval` enables WASM instantiation.
fn page_csp(id: &str, net_origins: &[String]) -> String {
    // If the page has the `network` capability, its allow-listed origins are added
    // to connect-src AND img/media-src, so a normal `fetch()` / <img> to those
    // sites works directly (no broker needed) — much simpler to use. The broker
    // `bmm.fetch` remains for non-CORS APIs. With no network grant, only the
    // page's own bundle is reachable.
    let extra = if net_origins.is_empty() {
        String::new()
    } else {
        format!(" {}", net_origins.join(" "))
    };
    format!(
        "default-src 'none'; \
         script-src 'self' 'wasm-unsafe-eval'; \
         style-src 'self' 'unsafe-inline'; \
         img-src 'self' data:{extra}; \
         font-src 'self' data:; \
         media-src 'self' data:{extra}; \
         connect-src 'self' bmmpage://{id} http://bmmpage.localhost/{id}/ https://bmmpage.localhost/{id}/{extra}; \
         frame-src 'none'; child-src 'none'; object-src 'none'; \
         base-uri 'none'; form-action 'none';",
        id = id,
        extra = extra
    )
}

/// `bmmpage://<id>/<file>` handler. Serves files read-only from a single page's
/// folder, refusing anything outside it (path-traversal guarded) and stamping a
/// strict CSP. Registered on the Tauri builder.
pub fn bmmpage_protocol<R: Runtime>(
    ctx: tauri::UriSchemeContext<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    use tauri::http::{Response, StatusCode};

    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Owned(Vec::new()))
            .unwrap()
    };

    let app = ctx.app_handle();
    let uri = request.uri();
    let host = uri.host().unwrap_or("");
    let path = uri.path().trim_start_matches('/');

    // The id may arrive as the host (`bmmpage://<id>/file`) or, on platforms
    // that rewrite custom schemes to `http://bmmpage.localhost/<id>/file`, as
    // the first path segment. Handle both.
    let (raw_id, file) = if host.is_empty() || host.ends_with("localhost") {
        let mut it = path.splitn(2, '/');
        (
            it.next().unwrap_or("").to_string(),
            it.next().unwrap_or("index.html").to_string(),
        )
    } else {
        (
            host.to_string(),
            if path.is_empty() {
                "index.html".to_string()
            } else {
                path.to_string()
            },
        )
    };

    let id = match sanitize_id(&raw_id) {
        Some(i) => i,
        None => return not_found(),
    };
    let file = if file.is_empty() {
        "index.html".to_string()
    } else {
        file
    };
    if file.contains("..") {
        return not_found();
    }

    let root = pages_root(app).join(&id);
    let full = root.join(&file);

    // Confine strictly to the page folder (defence-in-depth on top of the
    // ".." check, resolving symlinks).
    match (std::fs::canonicalize(&root), std::fs::canonicalize(&full)) {
        (Ok(r), Ok(f)) if f.starts_with(&r) => match std::fs::read(&f) {
            Ok(bytes) => {
                // Relax connect/img/media-src to the page's allow-listed origins
                // only when it actually holds the `network` capability.
                let origins = if read_grants(app, &id).iter().any(|c| c == "network") {
                    read_net_origins(app, &id)
                } else {
                    Vec::new()
                };
                Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime_for(&file))
                .header("Content-Security-Policy", page_csp(&id, &origins))
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store")
                // The page runs at an opaque `null` origin (sandbox), so reading its
                // OWN bundle via fetch()/instantiateStreaming (e.g. .wasm) is a
                // cross-origin read and needs CORS. The scheme is webview-internal
                // and read-only, so allowing any origin to read a page's own bundle
                // is safe (no external site can issue bmmpage:// requests).
                .header("Access-Control-Allow-Origin", "*")
                .body(Cow::Owned(bytes))
                .unwrap()
            }
            Err(_) => not_found(),
        },
        _ => not_found(),
    }
}

#[cfg(test)]
mod page_grant_review_tests {
    use super::*;
    use std::path::Path;

    /// An installed page `id` under `pages`.
    fn install(pages: &Path, id: &str) {
        let d = pages.join(id);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("manifest.json"), r#"{"name":"t"}"#).unwrap();
    }
    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }
    fn roots() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let pages = t.path().join("custom_pages");
        let data = t.path().join("custom_pages_data");
        std::fs::create_dir_all(&pages).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        (t, pages, data)
    }

    /// The defect: a `.bmmnav` listing capabilities and origins had every one of them applied
    /// on import. Now nothing is effective until the review, even if the files on disk say
    /// otherwise (a grants.json already there, e.g. from a restore under the same id).
    #[test]
    fn an_import_grants_nothing_until_it_is_reviewed() {
        let (_t, pages, data) = roots();
        install(&pages, "pimp");
        let dir = data.join("pimp");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("grants.json"), r#"["network","system","storage"]"#).unwrap();
        let meta = mark_import_pending_in(
            &dir,
            &s(&["network", "system", "storage", "shell", "network"]),
            &s(&["https://evil.example", "https://a.example; worker-src *"]),
        )
        .unwrap();
        assert_eq!(meta.source, "import-pending");
        assert_eq!(meta.requested, s(&["network", "system", "storage"]), "unknown caps and duplicates are not recorded");
        assert_eq!(meta.requested_origins, s(&["https://evil.example"]), "a non-origin is not recorded");
        assert!(effective_grants_in(&dir).is_empty());
        assert!(effective_origins_in(&dir).is_empty());
        for cap in ["storage", "network", "system", "clipboard"] {
            let e = require_cap_in(&pages, &data, "pimp", cap).unwrap_err();
            assert!(e.starts_with("permission_denied"), "{cap}: {e}");
        }
        // Even if something rewrote grants.json while pending, pending still means nothing.
        std::fs::write(dir.join("grants.json"), r#"["storage"]"#).unwrap();
        assert!(require_cap_in(&pages, &data, "pimp", "storage").is_err());
    }

    #[test]
    fn grant_none_is_a_review_and_leaves_nothing() {
        let (_t, pages, data) = roots();
        install(&pages, "pnone");
        let dir = data.join("pnone");
        mark_import_pending_in(&dir, &s(&["storage", "network"]), &s(&["https://api.example"])).unwrap();
        let r = apply_review_in(&dir, &[], &[]).unwrap();
        assert!(r.grants.is_empty() && r.origins.is_empty());
        let meta = read_meta_in(&dir);
        assert_eq!(meta.source, "import-review", "recorded as the user's review");
        assert!(meta.reviewed_at.is_some());
        assert_eq!(meta.requested, s(&["storage", "network"]), "what was asked stays on record");
        assert!(require_cap_in(&pages, &data, "pnone", "storage").is_err());
    }

    #[test]
    fn a_partial_review_grants_only_what_was_ticked() {
        let (_t, pages, data) = roots();
        install(&pages, "ppart");
        let dir = data.join("ppart");
        mark_import_pending_in(
            &dir,
            &s(&["storage", "network", "system"]),
            &s(&["https://a.example", "https://b.example"]),
        )
        .unwrap();
        let r = apply_review_in(&dir, &s(&["storage", "network"]), &s(&["https://A.example/"])).unwrap();
        assert_eq!(r.grants, s(&["storage", "network"]));
        assert_eq!(r.origins, s(&["https://a.example"]));
        assert!(require_cap_in(&pages, &data, "ppart", "storage").is_ok());
        assert!(require_cap_in(&pages, &data, "ppart", "network").is_ok());
        assert!(require_cap_in(&pages, &data, "ppart", "system").is_err(), "not ticked");
        assert_eq!(effective_origins_in(&dir), s(&["https://a.example"]));
    }

    #[test]
    fn origins_need_network_and_must_have_been_asked_for() {
        let (_t, _pages, data) = roots();
        let dir = data.join("porig");
        mark_import_pending_in(&dir, &s(&["storage", "network"]), &s(&["https://a.example"])).unwrap();
        // Ticking an origin without `network` keeps no origin.
        let r = apply_review_in(&dir, &s(&["storage"]), &s(&["https://a.example"])).unwrap();
        assert!(r.origins.is_empty());

        let dir = data.join("porig2");
        mark_import_pending_in(&dir, &s(&["network"]), &s(&["https://a.example"])).unwrap();
        let e = apply_review_in(&dir, &s(&["network"]), &s(&["https://other.example"])).unwrap_err();
        assert!(e.starts_with("not_requested"), "{e}");
        let e = apply_review_in(&dir, &s(&["system"]), &[]).unwrap_err();
        assert!(e.starts_with("not_requested"), "a capability the file never asked for: {e}");
        assert!(effective_grants_in(&dir).is_empty(), "a refused review applies nothing");
    }

    /// Re-importing cannot escalate: an import never writes to an installed page (it always
    /// creates a new one), and the review entry point refuses a page that is not pending, so
    /// it cannot be used to raise the grants of a page the user already reviewed.
    #[test]
    fn a_second_review_cannot_escalate() {
        let (_t, _pages, data) = roots();
        let dir = data.join("pre");
        mark_import_pending_in(&dir, &s(&["storage", "network", "system"]), &s(&["https://a.example"])).unwrap();
        apply_review_in(&dir, &s(&["storage"]), &[]).unwrap();
        let e = apply_review_in(&dir, &s(&["storage", "network", "system"]), &s(&["https://a.example"])).unwrap_err();
        assert!(e.starts_with("review_not_pending"), "{e}");
        assert_eq!(effective_grants_in(&dir), s(&["storage"]));
        assert!(effective_origins_in(&dir).is_empty());
    }

    #[test]
    fn a_user_tick_on_a_pending_page_starts_from_nothing() {
        let (_t, _pages, data) = roots();
        let dir = data.join("ptick");
        mark_import_pending_in(&dir, &s(&["storage", "network"]), &s(&["https://a.example"])).unwrap();
        std::fs::write(dir.join("grants.json"), r#"["network"]"#).unwrap();
        std::fs::write(dir.join("net_origins.json"), r#"["https://a.example"]"#).unwrap();
        let g = set_grant_in(&dir, "storage", true).unwrap();
        assert_eq!(g, s(&["storage"]), "the file's network did not ride along");
        assert!(effective_origins_in(&dir).is_empty(), "the file's origins were dropped");
        assert_eq!(read_meta_in(&dir).source, "user");

        let dir = data.join("ptick2");
        mark_import_pending_in(&dir, &s(&["network"]), &s(&["https://a.example"])).unwrap();
        std::fs::write(dir.join("grants.json"), r#"["network"]"#).unwrap();
        set_origins_in(&dir, &s(&["https://b.example"])).unwrap();
        assert!(effective_grants_in(&dir).is_empty(), "typing an origin grants nothing");
    }

    #[test]
    fn storage_is_refused_without_the_grant() {
        let (_t, pages, data) = roots();
        install(&pages, "pstore");
        let e = require_cap_in(&pages, &data, "pstore", "storage").unwrap_err();
        assert!(e.starts_with("permission_denied"), "{e}");
        let dir = data.join("pstore");
        std::fs::create_dir_all(&dir).unwrap();
        set_grant_in(&dir, "storage", true).unwrap();
        assert_eq!(require_cap_in(&pages, &data, "pstore", "storage").unwrap(), dir);
        set_grant_in(&dir, "storage", false).unwrap();
        assert!(require_cap_in(&pages, &data, "pstore", "storage").is_err(), "revoked");
    }

    /// A page id the backend does not know is refused, and nothing is created for it.
    #[test]
    fn a_forged_page_id_is_refused() {
        let (_t, pages, data) = roots();
        install(&pages, "preal");
        let dir = data.join("preal");
        std::fs::create_dir_all(&dir).unwrap();
        set_grant_in(&dir, "storage", true).unwrap();
        for forged in ["pfake", "../preal", "preal/..", "preal\\x", "", "preal ", "preal\u{0}"] {
            let e = require_cap_in(&pages, &data, forged, "storage").unwrap_err();
            assert!(e.starts_with("unknown_page"), "{forged:?}: {e}");
        }
        assert!(!data.join("pfake").exists(), "no data folder for an id that is not a page");
        // A real page without the grant cannot borrow another page's.
        install(&pages, "pother");
        assert!(require_cap_in(&pages, &data, "pother", "storage").is_err());
        // A capability name that is not one is refused, not looked up.
        assert!(require_cap_in(&pages, &data, "preal", "fs").is_err());
    }

    #[test]
    fn a_page_frame_cannot_be_the_caller() {
        for o in ["null", "NULL", "bmmpage://preal", "http://bmmpage.localhost", "https://bmmpage.localhost/preal/"] {
            assert!(caller_is_page_frame(Some(o)), "{o}");
        }
        for o in ["http://tauri.localhost", "tauri://localhost", "http://localhost:1420", "http://bmmpage.localhost.evil.example"] {
            assert!(!caller_is_page_frame(Some(o)), "{o}");
        }
        assert!(!caller_is_page_frame(None), "no Origin header: the invoke key is the gate");
    }

    #[test]
    fn legacy_pages_keep_their_grants() {
        // A page from before the review record (no grants_meta.json) is not pending.
        let (_t, pages, data) = roots();
        install(&pages, "plegacy");
        let dir = data.join("plegacy");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("grants.json"), r#"["storage","bogus"]"#).unwrap();
        assert_eq!(effective_grants_in(&dir), s(&["storage"]));
        assert!(require_cap_in(&pages, &data, "plegacy", "storage").is_ok());
    }
}
