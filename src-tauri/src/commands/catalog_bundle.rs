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
    const ARRAYS: [&str; 9] = [
        "presets", "plugins", "themes", "apps", "modpacks", "tutorials", "lists", "catalogs", "items",
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

/// A staging folder to build a bundle in, unique per call.
///
/// The single-file flow used to write its payloads into whatever folder the user picked and
/// then drop a zip beside them, which meant publishing left a pile of loose files behind in
/// a directory the person had chosen for one thing. It stages here instead and the finished
/// bundle goes wherever they said — nothing is left in either place.
#[tauri::command]
pub fn catalog_bundle_stage() -> Result<String, String> {
    let base = std::env::temp_dir().join("bmm_catalog_build");
    // Time is not a name. Two publishes in the same millisecond — or one left behind by a
    // crash — must not land in the same directory, so it counts up until one is free.
    for n in 0..500u32 {
        let dir = base.join(format!("cat_{}_{}", std::process::id(), n));
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            return Ok(dir.to_string_lossy().to_string());
        }
    }
    Err("could not make a staging folder".into())
}

/// Throw a staging folder away.
///
/// Refuses anything that is not one of ours. This deletes a directory recursively and is
/// reachable from the WebView, so it is not allowed to take a path on trust: the only
/// argument it accepts is a path inside the staging root it created.
#[tauri::command]
pub fn catalog_bundle_unstage(dir: String) -> Result<(), String> {
    let base = std::env::temp_dir().join("bmm_catalog_build");
    let p = PathBuf::from(&dir);
    let (Ok(p), Ok(base)) = (p.canonicalize(), base.canonicalize()) else {
        return Ok(()); // already gone, or never existed — nothing to do and nothing wrong
    };
    if !p.starts_with(&base) {
        return Err("refused: not a staging folder".into());
    }
    std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
}

/// Pack a catalog FOLDER into a single-file bundle.
///
/// **Only what the catalogue actually uses.** It packs `catalog.json` plus exactly the files
/// its entries name, and nothing else. The first version zipped every file in the folder,
/// which is fine for a folder BMM just wrote and catastrophic for one the user picked —
/// choosing your Desktop packed your Desktop.
///
/// Refuses a folder with no `catalog.json` at its root, and one whose catalog.json is not an
/// object. A bundle is a catalogue by construction, so what makes it one is checked before a
/// byte is written rather than discovered by whoever opens it.
///
/// ASYNC, on a blocking thread. Compressing a few hundred MB on the main thread is what made
/// BMM stop repainting mid-publish — the same mistake this codebase has fixed before, which
/// is why `spawn_blocking` is the house pattern for anything that touches a lot of disk.
#[tauri::command]
pub async fn catalog_bundle_pack(dir: String, out: String) -> Result<BundlePacked, String> {
    tauri::async_runtime::spawn_blocking(move || pack_blocking(dir, out))
        .await
        .map_err(|e| e.to_string())?
}

fn pack_blocking(dir: String, out: String) -> Result<BundlePacked, String> {
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

    let wanted = packed_names(&doc);
    let present = list_files(&dir);
    let have: std::collections::HashSet<&str> = present.iter().map(|(_, n)| n.as_str()).collect();
    let missing: Vec<String> = wanted
        .iter()
        .filter(|n| !have.contains(n.as_str()))
        .cloned()
        .collect();

    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // catalog.json first, then exactly what it names. A name appearing twice in the document
    // is one file in the archive: `start_file` on a duplicate name produces an archive whose
    // second copy is unreachable.
    let mut written: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut count = 0u32;
    let mut bytes = 0u64;
    let mut add = |zip: &mut zip::ZipWriter<std::fs::File>, name: &str| -> Result<(), String> {
        if !written.insert(name.to_string()) {
            return Ok(());
        }
        let path = dir.join(name);
        let Ok(data) = std::fs::read(&path) else { return Ok(()) };
        zip.start_file(name.to_string(), opts).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
        count += 1;
        bytes += data.len() as u64;
        Ok(())
    };

    add(&mut zip, "catalog.json")?;
    for name in &wanted {
        add(&mut zip, name)?;
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

    /// The bundle holds the catalogue and what it NAMES, and nothing else.
    ///
    /// The first version zipped every file in the folder, which is harmless for a folder BMM
    /// had just written and catastrophic for one the user picked: choosing Desktop packed the
    /// Desktop. This is the regression guard for that, and it is worth the temp directory.
    #[test]
    fn only_what_the_catalogue_uses_is_packed() {
        let dir = std::env::temp_dir().join(format!("bmm_pack_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(
            dir.join("catalog.json"),
            r#"{"name":"c","presets":[{"id":"a","download_url":"used.bmmpa"},
                                      {"id":"b","download_url":"https://x.test/remote.bmmpa"}]}"#,
        )
        .unwrap();
        std::fs::write(dir.join("used.bmmpa"), b"{}").unwrap();
        // The things that must NOT travel: a private document that happened to be in the
        // same folder, and a file the catalogue does not mention.
        std::fs::write(dir.join("tax-return.pdf"), b"private").unwrap();
        std::fs::write(dir.join("stray.bmmpa"), b"{}").unwrap();

        let out = dir.join("out.bmmbundle");
        let rep = super::pack_blocking(
            dir.to_string_lossy().to_string(),
            out.to_string_lossy().to_string(),
        )
        .expect("pack");

        let f = std::fs::File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        let mut names: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["catalog.json", "used.bmmpa"]);
        assert_eq!(rep.files, 2);
        // A remote entry is not a missing file: it lives somewhere else on purpose.
        assert!(rep.missing.is_empty(), "{:?}", rep.missing);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A catalogue naming a file the folder does not hold is reported, not fatal.
    #[test]
    fn a_named_file_that_is_absent_is_reported() {
        let dir = std::env::temp_dir().join(format!("bmm_pack_miss_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("catalog.json"),
            r#"{"name":"c","presets":[{"id":"a","download_url":"gone.bmmpa"}]}"#,
        )
        .unwrap();
        let out = dir.join("out.bmmbundle");
        let rep = super::pack_blocking(
            dir.to_string_lossy().to_string(),
            out.to_string_lossy().to_string(),
        )
        .expect("pack");
        assert_eq!(rep.missing, vec!["gone.bmmpa".to_string()]);
        assert_eq!(rep.files, 1, "catalog.json still went in");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// The files directly inside a folder, optionally filtered by extension.
///
/// For building a catalogue out of a drop folder. A `.mm` is not held by BMM — it is
/// exported — so a catalogue of mod lists can only be made from files somebody has already
/// put somewhere, and this is how that folder is read.
///
/// One level deep, on purpose. A catalogue's files sit beside its `catalog.json`; recursing
/// would sweep in whatever else happens to be under that folder, and "it published my whole
/// Documents tree" is not a mistake worth being able to make.
#[tauri::command]
pub fn list_dir_files(dir: String, exts: Option<Vec<String>>) -> Vec<String> {
    let want: Option<Vec<String>> = exts.map(|v| {
        v.into_iter()
            .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
            .filter(|e| !e.is_empty())
            .collect()
    });
    let Ok(rd) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<String> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| match want.as_ref() {
            None => true,
            Some(list) => {
                let ext = p
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                list.iter().any(|w| w == &ext)
            }
        })
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    // Sorted, so the same folder builds the same catalogue twice. read_dir order is the
    // filesystem's, which is not stable — and a catalogue whose entries shuffle between
    // builds looks changed to anything comparing them.
    out.sort();
    out
}

#[cfg(test)]
mod list_dir_tests {
    use super::*;

    #[test]
    fn only_files_in_this_folder_and_sorted() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("sub")).unwrap();
        std::fs::write(d.path().join("sub").join("deep.mm"), b"x").unwrap();
        for n in ["b.mm", "a.mm", "notes.txt"] {
            std::fs::write(d.path().join(n), b"x").unwrap();
        }
        let all = list_dir_files(d.path().to_string_lossy().to_string(), None);
        let names: Vec<String> = all.iter().map(|p| p.rsplit(['/', '\\']).next().unwrap().to_string()).collect();
        assert_eq!(names, vec!["a.mm", "b.mm", "notes.txt"]);
        // One level. "It published my whole Documents tree" is not a mistake worth being
        // able to make.
        assert!(!names.iter().any(|n| n == "deep.mm"));
    }

    #[test]
    fn the_extension_filter_is_case_insensitive_and_dot_agnostic() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("one.MM"), b"x").unwrap();
        std::fs::write(d.path().join("two.txt"), b"x").unwrap();
        let got = list_dir_files(
            d.path().to_string_lossy().to_string(),
            Some(vec![".mm".into()]),
        );
        assert_eq!(got.len(), 1, "{:?}", got);
        assert!(got[0].to_lowercase().ends_with("one.mm"));
    }

    #[test]
    fn a_folder_that_is_not_there_is_empty_rather_than_an_error() {
        assert!(list_dir_files("Z:/nope".into(), None).is_empty());
    }
}
