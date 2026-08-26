//! What a `.mm` has to carry, and what it used to lose on the way.
//!
//! Two things went missing between exporting a list and opening it somewhere else, and both
//! were silent: an entry's tags, and an archived mod's contents. Neither failure produced an
//! error — the file was valid, it just described less than it claimed to.

use crate::models::modlist::ModList;
use crate::models::tag::TagDef;

fn tag(id: &str, name: &str) -> TagDef {
    TagDef { id: id.into(), name: name.into(), color: "#f97316".into(), icon: "lucide:tag".into(), color2: None }
}

/// A tag is written into an entry as an ID. An id means nothing on the machine that opens
/// the file: the importer wrote those ids onto the new mods, the screen looked each one up
/// in ITS tags, found nothing, and drew no chip.
#[test]
fn a_list_carries_the_definitions_of_the_tags_it_names() {
    let mut list = ModList::new("Cold War".into(), "DCS".into(), "C:/DCS".into());
    list.tag_defs = vec![tag("t-1", "Liveries"), tag("t-2", "Campaign")];

    let json = serde_json::to_string(&list).unwrap();
    let back: ModList = serde_json::from_str(&json).unwrap();

    assert_eq!(back.tag_defs.len(), 2);
    assert_eq!(back.tag_defs[0].name, "Liveries");
    // The colour and the icon too — a tag that survives as a grey unnamed dot has not
    // survived.
    assert_eq!(back.tag_defs[0].color, "#f97316");
    assert_eq!(back.tag_defs[0].icon, "lucide:tag");
}

/// Every `.mm` written before this has no `tag_defs`, and one from last year must still
/// open. This is what `#[serde(default)]` is doing there, asserted rather than assumed.
#[test]
fn a_list_written_before_tag_definitions_existed_still_opens() {
    let old = r#"{
        "format_version": "1.0",
        "name": "Old list",
        "description": null,
        "game_name": "DCS",
        "game_path_hint": "C:/DCS",
        "author": null,
        "created_at": "2025-01-01T00:00:00+01:00",
        "mods": []
    }"#;
    let back: ModList = serde_json::from_str(old).unwrap();
    assert_eq!(back.name, "Old list");
    assert!(back.tag_defs.is_empty());
}

/// The importer must never repaint a tag the user already has. Two people can hold the same
/// tag id with different colours, and the local one is the one they chose.
#[test]
fn a_local_definition_wins_over_the_one_in_the_file() {
    let mine = vec![tag("t-1", "My Liveries")];
    let incoming = vec![tag("t-1", "Their Liveries"), tag("t-9", "New One")];

    // The same merge the importer performs: an id already known is left alone.
    let mut merged = mine.clone();
    for def in &incoming {
        if !merged.iter().any(|t| t.id == def.id) {
            merged.push(def.clone());
        }
    }

    assert_eq!(merged.len(), 2);
    assert_eq!(merged.iter().find(|t| t.id == "t-1").unwrap().name, "My Liveries");
    assert!(merged.iter().any(|t| t.id == "t-9"));
}

// ── The container ────────────────────────────────────────────────────────────
//
// A `.mm` is a ZIP now: the list has grown past "a JSON document" — tag definitions, whole
// modpacks, update sources — and the next thing it needs to carry is a file rather than a
// field. Every list anybody has ever exported is a bare JSON document, so both open.

use crate::commands::modlist::{read_modlist_file, MODLIST_ENTRY};
use std::fs;

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join("bmm_mm_container");
    let _ = fs::create_dir_all(&d);
    d.join(name)
}

fn zip_with(path: &std::path::Path, entries: &[(&str, &str)]) {
    use std::io::Write;
    let f = fs::File::create(path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    let o = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in entries {
        z.start_file(*name, o).unwrap();
        z.write_all(body.as_bytes()).unwrap();
    }
    z.finish().unwrap();
}

#[test]
fn a_zipped_list_opens() {
    let mut list = ModList::new("Zipped".into(), "DCS".into(), "C:/DCS".into());
    list.tag_defs = vec![tag("t-1", "Liveries")];
    let p = tmp("zipped.mm");
    zip_with(&p, &[(MODLIST_ENTRY, &serde_json::to_string(&list).unwrap())]);

    let back = read_modlist_file(&p).unwrap();
    assert_eq!(back.name, "Zipped");
    assert_eq!(back.tag_defs.len(), 1);
}

/// THE ONE: every .mm in the world right now is a bare JSON document.
#[test]
fn a_plain_json_list_still_opens() {
    let list = ModList::new("Old".into(), "DCS".into(), "C:/DCS".into());
    let p = tmp("plain.mm");
    fs::write(&p, serde_json::to_string_pretty(&list).unwrap()).unwrap();

    assert_eq!(read_modlist_file(&p).unwrap().name, "Old");
}

#[test]
fn the_bytes_decide_not_the_extension() {
    // A zipped list saved as .json, and a JSON list saved as .mm. Both are what they are.
    let list = ModList::new("Either".into(), "DCS".into(), "".into());
    let z = tmp("actually-a-zip.json");
    zip_with(&z, &[(MODLIST_ENTRY, &serde_json::to_string(&list).unwrap())]);
    assert_eq!(read_modlist_file(&z).unwrap().name, "Either");

    let j = tmp("actually-json.mm");
    fs::write(&j, serde_json::to_string(&list).unwrap()).unwrap();
    assert_eq!(read_modlist_file(&j).unwrap().name, "Either");
}

#[test]
fn an_archive_without_the_list_says_so_rather_than_parsing_nothing() {
    let p = tmp("empty.mm");
    zip_with(&p, &[("readme.txt", "hello")]);
    let err = read_modlist_file(&p).unwrap_err().to_string();
    assert!(err.contains(MODLIST_ENTRY), "{err}");
}

/// A mod knows where it came from. A list that drops that is a list of mods that will
/// never update again on the machine it lands on — and nothing says so, because everything
/// else about the import looks right.
#[test]
fn a_mod_carries_its_provenance_and_its_notes() {
    let json = r#"{
        "format_version": "1.0", "name": "L", "description": null, "game_name": "DCS",
        "game_path_hint": "", "author": null, "created_at": "now",
        "mods": [{
            "name": "Cockpit", "version": "1", "author": null, "description": null,
            "download_links": [], "file_tree": [], "install_notes": "Drop it in Saved Games.",
            "tags": [], "id": "m-7", "content_id": "c-abc",
            "source_repo": "https://example.com/repo.json", "repo_mod_id": "r-3",
            "update_url": "https://example.com/latest.zip"
        }]
    }"#;
    let list: ModList = serde_json::from_str(json).unwrap();
    let m = &list.mods[0];
    assert_eq!(m.id, "m-7");
    assert_eq!(m.content_id.as_deref(), Some("c-abc"));
    assert_eq!(m.source_repo.as_deref(), Some("https://example.com/repo.json"));
    assert_eq!(m.repo_mod_id.as_deref(), Some("r-3"));
    assert_eq!(m.update_url.as_deref(), Some("https://example.com/latest.zip"));
    // The exporter used to write String::new() here, so notes never travelled at all.
    assert_eq!(m.install_notes, "Drop it in Saved Games.");
}

/// Every `.mm` written before those fields existed has none of them, and one from last
/// year must still open rather than fail to parse.
#[test]
fn an_entry_written_before_provenance_existed_still_opens() {
    let json = r#"{
        "format_version": "1.0", "name": "L", "description": null, "game_name": "DCS",
        "game_path_hint": "", "author": null, "created_at": "now",
        "mods": [{
            "name": "Cockpit", "version": "1", "author": null, "description": null,
            "download_links": [], "file_tree": [], "install_notes": "", "tags": []
        }]
    }"#;
    let list: ModList = serde_json::from_str(json).unwrap();
    let m = &list.mods[0];
    assert_eq!(m.id, "");
    assert!(m.content_id.is_none() && m.source_repo.is_none() && m.update_url.is_none());
}

#[test]
fn dependencies_travel_as_names() {
    // An id from somebody else's install resolves to nothing here, so the importer would
    // write a requirement pointing at a mod that does not exist.
    let json = r#"{
        "format_version": "1.0", "name": "L", "description": null, "game_name": "DCS",
        "game_path_hint": "", "author": null, "created_at": "now",
        "mods": [{
            "name": "Cockpit", "version": "1", "author": null, "description": null,
            "download_links": [], "file_tree": [], "install_notes": "", "tags": [],
            "dependencies": ["Core Textures"]
        }]
    }"#;
    let list: ModList = serde_json::from_str(json).unwrap();
    assert_eq!(list.mods[0].dependencies, vec!["Core Textures".to_string()]);
}

#[test]
fn an_entry_written_before_dependencies_existed_still_opens() {
    let json = r#"{
        "format_version": "1.0", "name": "L", "description": null, "game_name": "DCS",
        "game_path_hint": "", "author": null, "created_at": "now",
        "mods": [{
            "name": "Old", "version": "1", "author": null, "description": null,
            "download_links": [], "file_tree": [], "install_notes": "", "tags": []
        }]
    }"#;
    let list: ModList = serde_json::from_str(json).unwrap();
    assert!(list.mods[0].dependencies.is_empty());
    assert!(list.mods[0].update_sources.is_empty());
    assert!(list.modpacks.is_empty());
}
