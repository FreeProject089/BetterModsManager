//! Custom sandboxed pages (navbar "Page" kind).
//!
//! A custom page is **untrusted** HTML/CSS/JS/WASM stored under
//! `<app_data>/custom_pages/<id>/`. It is served read-only through the
//! `bmmpage://` URI scheme with a strict Content-Security-Policy, and rendered
//! in an iframe with `sandbox` *without* `allow-same-origin` (opaque `null`
//! origin). By construction it cannot reach `window.parent`, the BMM DOM,
//! `__TAURI__`/`invoke`, cookies/localStorage, the network, or sub-frames.
//!
//! Capabilities (storage / network / …) are **not** wired here — that is a
//! later, separately-audited phase. Until then a page can compute and render
//! but has zero access to anything outside its own sandbox.

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

/// Copy a picked file (e.g. a `.wasm` module, image, or `.js`) into a page's
/// bundle so the page can load it (`fetch('module.wasm')`, `<img src>`, …).
/// Validates the destination name and extension, and caps the size.
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
fn page_data_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<PathBuf> {
    let id = sanitize_id(id)?;
    let dir = pages_data_root(app).join(&id);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn read_kv<R: Runtime>(app: &AppHandle<R>, id: &str) -> std::collections::BTreeMap<String, String> {
    page_data_dir(app, id)
        .and_then(|d| std::fs::read_to_string(d.join("storage.json")).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn write_kv<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    kv: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    let dir = page_data_dir(app, id).ok_or("invalid id")?;
    let txt = serde_json::to_string(kv).map_err(|e| e.to_string())?;
    if txt.len() > MAX_STORAGE_BYTES {
        return Err("storage quota exceeded".into());
    }
    std::fs::write(dir.join("storage.json"), txt).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn page_storage_get<R: Runtime>(app: AppHandle<R>, id: String, key: String) -> Option<String> {
    read_kv(&app, &id).get(&key).cloned()
}
#[tauri::command]
pub fn page_storage_set<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    if key.len() > 512 {
        return Err("key too long".into());
    }
    let mut kv = read_kv(&app, &id);
    kv.insert(key, value);
    write_kv(&app, &id, &kv)
}
#[tauri::command]
pub fn page_storage_remove<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    key: String,
) -> Result<(), String> {
    let mut kv = read_kv(&app, &id);
    kv.remove(&key);
    write_kv(&app, &id, &kv)
}
#[tauri::command]
pub fn page_storage_keys<R: Runtime>(app: AppHandle<R>, id: String) -> Vec<String> {
    read_kv(&app, &id).keys().cloned().collect()
}
#[tauri::command]
pub fn page_storage_clear<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    write_kv(&app, &id, &std::collections::BTreeMap::new())
}

fn read_grants<R: Runtime>(app: &AppHandle<R>, id: &str) -> Vec<String> {
    page_data_dir(app, id)
        .and_then(|d| std::fs::read_to_string(d.join("grants.json")).ok())
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn page_grants_get<R: Runtime>(app: AppHandle<R>, id: String) -> Vec<String> {
    read_grants(&app, &id)
}
#[tauri::command]
pub fn page_set_grant<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    cap: String,
    granted: bool,
) -> Result<Vec<String>, String> {
    if !KNOWN_CAPS.contains(&cap.as_str()) {
        return Err("unknown capability".into());
    }
    let dir = page_data_dir(&app, &id).ok_or("invalid id")?;
    let mut grants: Vec<String> = std::fs::read_to_string(dir.join("grants.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    grants.retain(|c| c != &cap);
    if granted {
        grants.push(cap);
    }
    std::fs::write(
        dir.join("grants.json"),
        serde_json::to_string(&grants).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(grants)
}

// ── Network capability: per-page allow-listed origins + a guarded fetch ───
// A page never fetches the internet directly (CSP connect-src forbids it). When
// granted `network`, it calls the broker, which calls `page_fetch`. The backend
// re-checks the grant AND that the URL's origin is on the page's explicit
// allow-list before performing a plain GET. No headers/cookies from BMM are
// forwarded; the response is size-capped and returned as text.

fn read_net_origins<R: Runtime>(app: &AppHandle<R>, id: &str) -> Vec<String> {
    page_data_dir(app, id)
        .and_then(|d| std::fs::read_to_string(d.join("net_origins.json")).ok())
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
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
    // Keep only well-formed http(s) origins (scheme://host[:port], no path).
    let clean: Vec<String> = origins
        .into_iter()
        .map(|o| o.trim().trim_end_matches('/').to_string())
        .filter(|o| {
            (o.starts_with("https://") || o.starts_with("http://"))
                && o.len() < 256
                && !o[8..].contains('/')
        })
        .collect();
    std::fs::write(
        dir.join("net_origins.json"),
        serde_json::to_string(&clean).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
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

#[tauri::command]
pub async fn page_fetch<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    url: String,
) -> Result<FetchResult, String> {
    // 1) The page must have been granted `network`.
    let grants = page_grants_get(app.clone(), id.clone());
    if !grants.iter().any(|c| c == "network") {
        return Err("permission_denied".into());
    }
    // 2) The URL's origin must be on this page's explicit allow-list.
    let origin = url_origin(&url).ok_or("invalid url")?;
    let allowed = read_net_origins(&app, &id);
    if !allowed.iter().any(|o| o == &origin) {
        return Err("origin_not_allowed".into());
    }
    // 3) Plain GET, no BMM credentials, size-capped.
    let resp = crate::commands::net::client().get(&url)
        .timeout(std::time::Duration::from_secs(20))
        .send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_FETCH_BYTES {
        return Err("response too large".into());
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    Ok(FetchResult { status, body })
}

/// Safe, read-only system info for the `system` capability. Exposes only
/// non-identifying, aggregate hardware/OS facts — NEVER the hostname, user name,
/// file system, processes, env vars, or any way to run code. The page must hold
/// the `system` grant (re-checked here, defence-in-depth).
#[tauri::command]
pub fn page_system_info<R: Runtime>(app: AppHandle<R>, id: String) -> Result<String, String> {
    if !read_grants(&app, &id).iter().any(|c| c == "system") {
        return Err("permission_denied".into());
    }
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
