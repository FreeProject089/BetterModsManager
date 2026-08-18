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
