//! A catalog that carries its own files.
//!
//! Every BMM catalog is a `catalog.json` listing things that live somewhere else, so
//! publishing one has always meant finding a host, and following one has meant the host
//! still being there. A BUNDLE is the same catalog.json with its payloads packed beside it
//! in one archive: one file to send somebody, and nothing to host.
//!
//! **The format is deliberately not new.** It is a zip with `catalog.json` at its root and
//! the payloads next to it — which is exactly the folder the builders already write. The
//! bundle IS that folder, zipped. Anything that can read the folder reads the bundle after
//! one extraction, and anyone with a zip tool can look inside without BMM.
//!
//! Extraction goes through `archive::materialize`, so a bundle gets the same zip-slip
//! refusal, the same cache and the same freshness marker as a mod archive. A second
//! extractor here would be a second place for `..` to be handled correctly.

use std::io::Write;
use std::path::{Path, PathBuf};

/// What packing produced, or refused to.
#[derive(serde::Serialize)]
pub struct BundlePacked {
    pub path: String,
    pub files: u32,
    pub bytes: u64,
    /// Entries the catalog names that are NOT in the folder. Reported rather than fatal:
    /// a catalog may legitimately mix packed files with `https://` ones, and only the
    /// person publishing it knows which of these is a mistake.
    pub missing: Vec<String>,
}

/// What a bundle turned out to hold.
#[derive(serde::Serialize)]
pub struct BundleOpened {
    /// Where it was extracted. Entries inside the catalog resolve against this.
    pub dir: String,
    /// The catalog document, verbatim, for the frontend to parse and sanitise.
    pub catalog: String,
    /// Every file in the bundle, so a reader can say what is actually in there.
    pub files: Vec<String>,
}

/// One level of a folder, files only, relative names.
fn list_files(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let name = p.file_name().and_then(|s| s.to_str()).map(|s| s.to_string());
        if let Some(name) = name {
            out.push((p, name));
        }
    }
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
}

/// Which addresses in a catalog document are meant to be files inside the bundle.
///
/// The same rule as the frontend's `bundleEntryKind`, and only the part this side needs:
/// an `http(s)` entry lives elsewhere and is none of the packer's business, and anything
/// else is not something to go looking for on disk.
fn packed_names(doc: &serde_json::Value) -> Vec<String> {
    const ARRAYS: [&str; 8] = [
        "presets", "plugins", "themes", "apps", "modpacks", "tutorials", "catalogs", "items",
    ];
    let mut out = Vec::new();
    for key in ARRAYS {
        let Some(arr) = doc.get(key).and_then(|v| v.as_array()) else { continue };
        for row in arr {
            let v = ["download_url", "url", "file", "path"]
                .iter()
                .find_map(|k| row.get(*k).and_then(|x| x.as_str()));
            let Some(v) = v else { continue };
            let v = v.trim();
            if v.is_empty() || v.contains("://") {
                continue;
            }
            // A name that would climb out of the folder is not one to look for in it.
            if v.starts_with('/') || v.starts_with('\\') || v.split(['/', '\\']).any(|s| s == "..")
            {
                continue;
            }
            out.push(v.trim_start_matches("./").to_string());
        }
    }
    out
}

/// Pack a catalog FOLDER into a single-file bundle.
///
/// Refuses a folder with no `catalog.json` at its root, and refuses one whose catalog.json
/// is not a catalog. Both refusals are the same idea: a bundle is a catalog by
/// construction, so the thing that makes it one is checked before a file is written rather
/// than discovered by whoever opens it.
#[tauri::command]
pub fn catalog_bundle_pack(dir: String, out: String) -> Result<BundlePacked, String> {
    let dir = PathBuf::from(&dir);
    let out_path = PathBuf::from(&out);
    let manifest = dir.join("catalog.json");
    if !manifest.is_file() {
        return Err("no catalog.json in that folder".into());
    }
    let text = std::fs::read_to_string(&manifest).map_err(|e| e.to_string())?;
    let doc: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("catalog.json is not valid JSON: {e}"))?;
    if !doc.is_object() {
        return Err("catalog.json is not a catalog".into());
    }

    let files = list_files(&dir);
    let have: std::collections::HashSet<&str> = files.iter().map(|(_, n)| n.as_str()).collect();
    let missing: Vec<String> = packed_names(&doc)
        .into_iter()
        .filter(|n| !have.contains(n.as_str()))
        .collect();

    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut count = 0u32;
    let mut bytes = 0u64;
    for (path, name) in &files {
        // The output can legitimately be written INTO the folder being packed, and a zip
        // that contains itself is both wrong and unbounded in the general case.
        if path == &out_path {
            continue;
        }
        let Ok(data) = std::fs::read(path) else { continue };
        zip.start_file(name.clone(), opts).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
        count += 1;
        bytes += data.len() as u64;
    }
    zip.finish().map_err(|e| e.to_string())?;

    Ok(BundlePacked {
        path: out_path.to_string_lossy().to_string(),
        files: count,
        bytes,
        missing,
    })
}

/// Open a bundle: extract it (cached) and hand back the catalog plus what is in there.
///
/// The catalog text is returned RAW. Parsing and sanitising it is the frontend's job and is
/// already written there for every catalog kind — doing half of it here would be a second
/// implementation of the same rules, in a language where the first one's tests do not run.
#[tauri::command]
pub fn catalog_bundle_open(path: String) -> Result<BundleOpened, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("no such file".into());
    }
    let dir = crate::archive::materialize(&p).map_err(|e| e.to_string())?;
    let manifest = dir.join("catalog.json");
    if !manifest.is_file() {
        return Err("not a catalog bundle: no catalog.json inside".into());
    }
    let catalog = std::fs::read_to_string(&manifest).map_err(|e| e.to_string())?;
    let files = list_files(&dir).into_iter().map(|(_, n)| n).collect();
    Ok(BundleOpened {
        dir: dir.to_string_lossy().to_string(),
        catalog,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::packed_names;

    /// The packer looks for exactly the entries that are supposed to be in the folder, and
    /// for nothing else. Getting this wrong in the "too many" direction reports phantom
    /// missing files on every mixed catalog; in the "too few" direction it ships a bundle
    /// with a hole in it and says nothing.
    #[test]
    fn only_local_names_are_looked_for() {
        let doc = serde_json::json!({
            "presets": [
                { "download_url": "a.bmmpa" },
                { "download_url": "./b.bmmpa" },
                { "download_url": "https://example.com/c.zip" },
                { "download_url": "../escape.bmmpa" },
                { "download_url": "/etc/passwd" },
                { "name": "no address at all" }
            ],
            "plugins": [ { "url": "d.zip" } ],
            "somethingElse": [ { "url": "ignored.zip" } ]
        });
        let mut got = packed_names(&doc);
        got.sort();
        assert_eq!(got, vec!["a.bmmpa", "b.bmmpa", "d.zip"]);
    }
}
