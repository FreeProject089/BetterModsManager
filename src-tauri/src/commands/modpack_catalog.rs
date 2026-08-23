// A modpack CATALOGUE, as one file.
//
// The first version of this asked for a download address per pack, because a catalogue was a
// JSON feed and the packs had to be hosted somewhere else. That is how theme and plugin
// catalogues work, and it is wrong here for a reason those do not share: a `.bmp` is a small
// SIGNED JSON DOCUMENT, not a payload. There is nothing large to keep out of the file, so
// splitting one catalogue into eleven uploads and eleven addresses bought nothing and cost
// every publisher an afternoon of URLs.
//
// A `.cbmp` is a zip:
//
//   catalog.json          { version, name, modpacks: [ { id, name, …, file } ] }
//   packs/<id>.bmp        the signed pack documents, verbatim
//
// One file to host, one address to share, and a reader that never has to trust a second
// server. `file` names the entry rather than deriving it from the id, so an id with a slash
// or a colon cannot decide where a reader looks.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use tauri::{AppHandle, State};

/// One entry, as `catalog.json` lists it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogPack {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    /// How many mods it holds. `None` is "not stated", which is not zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mods: Option<usize>,
    /// The zip entry holding the `.bmp`.
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackCatalog {
    #[serde(default = "one_zero")]
    pub version: String,
    pub name: String,
    #[serde(default)]
    pub modpacks: Vec<CatalogPack>,
}
fn one_zero() -> String { "1.0".to_string() }

/// A zip entry name that cannot escape the archive when a reader extracts it.
///
/// Not used for extraction here \u2014 nothing is written to disk from a `.cbmp` \u2014 but the name
/// travels to BCWEB and to anything else that opens one, and a catalogue is a document from
/// wherever somebody downloaded it. Refusing `..` and absolute paths at the point the name is
/// CREATED means no reader has to remember to.
fn safe_entry(id: &str, index: usize) -> String {
    let cleaned: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() {
        format!("packs/pack-{index}.bmp")
    } else {
        format!("packs/{cleaned}.bmp")
    }
}

/// Write a `.cbmp` holding the named modpacks.
#[tauri::command]
pub async fn export_modpack_catalog(
    handle: AppHandle,
    state: State<'_, crate::state::AppState>,
    name: String,
    ids: Vec<String>,
    dest_path: String,
) -> Result<usize, AppError> {
    let _ = &state;
    let title = name.trim();
    let title = if title.is_empty() { "Modpacks" } else { title };
    if ids.is_empty() {
        return Err(AppError::Internal("modpack.cat.errNoPacks".into()));
    }

    let file = std::fs::File::create(&dest_path).map_err(|e| AppError::Internal(e.to_string()))?;
    let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut entries: Vec<CatalogPack> = Vec::new();
    for (i, id) in ids.iter().enumerate() {
        let pack = match crate::commands::modpack::get_modpack_by_id(handle.clone(), id.clone()).await? {
            Some(p) => p,
            // A missing pack is SKIPPED, not fatal. Half a catalogue is worth more than none,
            // and the count returned tells the caller how many actually went in.
            None => continue,
        };
        let entry = safe_entry(&pack.id, i);

        // Signed exactly as a standalone export is. A pack pulled out of a catalogue and one
        // exported on its own must be the same document, or a signature check turns into
        // "which way did this arrive?".
        let mut doc = serde_json::to_value(&pack).map_err(|e| AppError::Internal(e.to_string()))?;
        crate::commands::doc_sign::sign_doc(&handle, &mut doc, "bmp");
        let json = serde_json::to_string_pretty(&doc).map_err(|e| AppError::Internal(e.to_string()))?;

        zip.start_file(&entry, opts).map_err(|e| AppError::Internal(e.to_string()))?;
        zip.write_all(json.as_bytes()).map_err(|e| AppError::Internal(e.to_string()))?;

        entries.push(CatalogPack {
            id: pack.id.clone(),
            name: pack.name.clone(),
            description: pack.description.clone().unwrap_or_default(),
            version: String::new(),
            mods: Some(pack.mods.len()),
            file: entry,
        });
    }

    if entries.is_empty() {
        return Err(AppError::Internal("modpack.cat.errNoPacks".into()));
    }

    let catalog = ModpackCatalog { version: one_zero(), name: title.to_string(), modpacks: entries };
    let index = serde_json::to_string_pretty(&catalog).map_err(|e| AppError::Internal(e.to_string()))?;
    // Written LAST, so a truncated archive is missing its index rather than describing packs
    // that are not in it.
    zip.start_file("catalog.json", opts).map_err(|e| AppError::Internal(e.to_string()))?;
    zip.write_all(index.as_bytes()).map_err(|e| AppError::Internal(e.to_string()))?;
    zip.finish().map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(catalog.modpacks.len())
}

/// Read the index out of a `.cbmp`, from a local path or an http(s) address.
///
/// The whole archive is fetched \u2014 a catalogue is small by construction, since a `.bmp` is a
/// text document \u2014 so there is no ranged read to get subtly wrong and no second request when
/// somebody installs.
#[tauri::command]
pub async fn read_modpack_catalog(
    handle: AppHandle,
    source: String,
) -> Result<ModpackCatalog, AppError> {
    let bytes = fetch_cbmp(&handle, &source).await?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| AppError::Internal("modpack.cat.errNotCbmp".into()))?;
    let mut index = zip
        .by_name("catalog.json")
        .map_err(|_| AppError::Internal("modpack.cat.errNoIndex".into()))?;
    let mut text = String::new();
    index.read_to_string(&mut text).map_err(|e| AppError::Internal(e.to_string()))?;
    serde_json::from_str(&text).map_err(|_| AppError::Internal("modpack.cat.errBadIndex".into()))
}

/// Install one pack out of a `.cbmp`.
#[tauri::command]
pub async fn install_from_modpack_catalog(
    handle: AppHandle,
    state: State<'_, crate::state::AppState>,
    source: String,
    entry: String,
) -> Result<crate::models::modpack::LocalModpack, AppError> {
    let bytes = fetch_cbmp(&handle, &source).await?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| AppError::Internal("modpack.cat.errNotCbmp".into()))?;

    // BY NAME, from the index the caller read \u2014 never a name the caller composed. The entry
    // comes back out of catalog.json, so a reader cannot be talked into asking for a path.
    // Read in a BLOCK so the archive and its entry are dropped before the await below. A
    // ZipArchive is not Send, and holding one across a suspension point makes the whole
    // command refuse to compile — with an error about the future, not about the zip.
    let text = {
        let mut f = zip
            .by_name(&entry)
            .map_err(|_| AppError::Internal("modpack.cat.errNoEntry".into()))?;
        let mut text = String::new();
        f.read_to_string(&mut text).map_err(|e| AppError::Internal(e.to_string()))?;
        text
    };
    drop(zip);

    // Through a temp file and the EXISTING importer, so a pack from a catalogue and one you
    // picked off your disk go through the same validation, id handling and events.
    let dir = std::env::temp_dir().join("bmm-cbmp");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal(e.to_string()))?;
    let tmp = dir.join(format!("pack-{}.bmp", std::process::id()));
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| AppError::Internal(e.to_string()))?;
    let _ = &state;
    let out = crate::commands::modpack::import_modpack(handle, Some(tmp.to_string_lossy().to_string())).await;
    let _ = std::fs::remove_file(&tmp);
    out
}

/// The archive's bytes, from disk or over HTTP.
///
/// `catalog_get` for the network case, so a `.cbmp` behind a download password or a required
/// key works exactly like every other protected source \u2014 for free, and only because this does
/// not fetch with a client of its own.
async fn fetch_cbmp(handle: &AppHandle, source: &str) -> Result<Vec<u8>, AppError> {
    let s = source.trim();
    if s.starts_with("http://") || s.starts_with("https://") {
        let bytes = crate::commands::net::catalog_get(handle, s)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("modpack.errDownload|{e}")))?
            .bytes()
            .await
            .map_err(|e| AppError::Internal(format!("modpack.errDownload|{e}")))?;
        Ok(bytes.to_vec())
    } else {
        std::fs::read(s).map_err(|e| AppError::Internal(format!("modpack.cat.errRead|{e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_entry_name_cannot_escape_the_archive() {
        // The names that matter: traversal, an absolute path, and a Windows drive. All of
        // them become one flat file under packs/.
        for bad in ["../../evil", "/etc/passwd", "C:\\windows\\system32", "..", "./../x"] {
            let e = safe_entry(bad, 0);
            assert!(e.starts_with("packs/"), "{bad} -> {e}");
            assert!(!e.contains(".."), "{bad} -> {e}");
            assert!(!e.contains('/') || e.matches('/').count() == 1, "{bad} -> {e}");
            assert!(!e.contains('\\'), "{bad} -> {e}");
        }
    }

    #[test]
    fn an_id_with_nothing_usable_still_gets_a_name() {
        // "///" cleans to empty. Falling through to an empty entry would write a zip member
        // called `packs/.bmp`, which every archive tool shows as a hidden file.
        assert_eq!(safe_entry("///", 3), "packs/pack-3.bmp");
        assert_eq!(safe_entry("", 0), "packs/pack-0.bmp");
    }

    #[test]
    fn an_ordinary_id_is_left_recognisable() {
        assert_eq!(safe_entry("winter-2026", 0), "packs/winter-2026.bmp");
    }

    #[test]
    fn the_index_survives_a_round_trip() {
        let c = ModpackCatalog {
            version: "1.0".into(),
            name: "Mine".into(),
            modpacks: vec![CatalogPack {
                id: "a".into(), name: "A".into(), description: String::new(),
                version: String::new(), mods: Some(3), file: "packs/a.bmp".into(),
            }],
        };
        let s = serde_json::to_string(&c).unwrap();
        let back: ModpackCatalog = serde_json::from_str(&s).unwrap();
        assert_eq!(back.modpacks[0].file, "packs/a.bmp");
        assert_eq!(back.modpacks[0].mods, Some(3));
    }

    #[test]
    fn an_index_missing_optional_fields_still_reads() {
        // What a hand-written or older catalogue looks like.
        let back: ModpackCatalog =
            serde_json::from_str(r#"{"name":"X","modpacks":[{"id":"a","name":"A","file":"packs/a.bmp"}]}"#).unwrap();
        assert_eq!(back.version, "1.0");
        assert_eq!(back.modpacks[0].mods, None, "not stated is not zero");
    }
}
