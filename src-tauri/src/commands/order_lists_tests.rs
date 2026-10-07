//! Saved order lists: the resolver's strength order and match quality, validation of what the
//! frontend sends, the plan of a list for a profile, and the order an activation leaves.

use super::*;
use crate::commands::order_share::{norm_name, resolve_entries};

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn m(id: &str, name: &str, version: &str) -> LibMod {
    LibMod { id: id.into(), name: name.into(), version: version.into(), ..Default::default() }
}

fn e(name: &str) -> OrderEntry {
    OrderEntry { name: name.into(), ..Default::default() }
}

fn lib() -> Vec<LibMod> {
    vec![
        LibMod { content_id: Some("cid-a".into()), ..m("id-a", "Alpha", "1.0") },
        LibMod { repo_mod_id: Some("core".into()), source_repo: Some("https://one.example/repo.json".into()), ..m("id-b", "Beta", "2.0") },
        LibMod { repo_mod_id: Some("core".into()), source_repo: Some("https://two.example/repo.json".into()), ..m("id-b2", "Beta Two", "1.0") },
        m("id-c", "Gamma Mod", "1.0"),
        m("id-d", "Delta", "1.0"),
        m("id-d2", "Delta", "2.0"),
    ]
}

fn library(mods: Vec<LibMod>) -> Library {
    Library { mods, deps: HashMap::new(), in_profile: HashSet::new() }
}

// ── The resolver ───────────────────────────────────────────────────────────────────────────

#[test]
fn every_identity_is_tried_strongest_first_and_reported() {
    let entries = vec![
        OrderEntry { id: Some("id-c".into()), ..e("Renamed since") },
        OrderEntry { content_id: Some("cid-a".into()), ..e("Alpha HD") },
        OrderEntry { repo_mod_id: Some("core".into()), source_repo: Some("https://TWO.example/repo.json/".into()), ..e("x") },
        OrderEntry { version: "2.0".into(), ..e("delta") },
        e("  gamma_mod "),
        e("Nobody"),
    ];
    let r = resolve_entries(&entries, &lib(), true);
    let got: Vec<(Option<&str>, MatchKind)> = r.iter().map(|x| (x.mod_id.as_deref(), x.quality)).collect();
    assert_eq!(
        got,
        [
            (Some("id-c"), MatchKind::Id),
            (Some("id-a"), MatchKind::Content),
            (Some("id-b2"), MatchKind::Source),
            (Some("id-d2"), MatchKind::NameVersion),
            // "Gamma Mod" was claimed by its id above: one library mod answers for one entry.
            (None, MatchKind::Missing),
            (None, MatchKind::Missing),
        ]
    );
}

#[test]
fn a_foreign_local_id_needs_the_same_name() {
    let entries = vec![OrderEntry { id: Some("id-c".into()), ..e("Something else") }];
    assert_eq!(resolve_entries(&entries, &lib(), false)[0].mod_id, None, "untrusted: the id alone is not enough");
    assert_eq!(resolve_entries(&entries, &lib(), true)[0].quality, MatchKind::Id, "a list saved here: the id is");
    let same = vec![OrderEntry { id: Some("id-c".into()), ..e("gamma mod") }];
    assert_eq!(resolve_entries(&same, &lib(), false)[0].quality, MatchKind::Id);
}

#[test]
fn a_repo_id_from_another_repo_is_not_the_same_mod() {
    // Both library mods are `core`, in different repos: the entry's repo decides.
    let one = vec![OrderEntry { repo_mod_id: Some("core".into()), source_repo: Some("https://one.example/repo.json".into()), ..e("?") }];
    assert_eq!(resolve_entries(&one, &lib(), false)[0].mod_id.as_deref(), Some("id-b"));
    let three = vec![OrderEntry { repo_mod_id: Some("core".into()), source_repo: Some("https://three.example/r.json".into()), ..e("?") }];
    assert_eq!(resolve_entries(&three, &lib(), false)[0].quality, MatchKind::Missing);
    // No repo on the entry: the repo id alone, first library mod that has it.
    let bare = vec![OrderEntry { repo_mod_id: Some("core".into()), ..e("?") }];
    assert_eq!(resolve_entries(&bare, &lib(), false)[0].quality, MatchKind::Source);
}

#[test]
fn namesakes_need_the_version_or_nobody_is_guessed() {
    let r = resolve_entries(&[e("DELTA")], &lib(), false);
    assert_eq!((r[0].mod_id.as_deref(), r[0].quality, r[0].candidates), (None, MatchKind::Ambiguous, 2));
    let r = resolve_entries(&[OrderEntry { version: "3.0".into(), ..e("Delta") }], &lib(), false);
    assert_eq!(r[0].quality, MatchKind::Ambiguous, "a version nobody has decides nothing");
    let r = resolve_entries(&[OrderEntry { version: "9".into(), ..e("Gamma-Mod") }], &lib(), false);
    assert_eq!((r[0].mod_id.as_deref(), r[0].quality, r[0].version_differs), (Some("id-c"), MatchKind::Name, true));
}

#[test]
fn names_ignore_case_spaces_underscores_and_dashes() {
    assert_eq!(norm_name(" Gamma_Mod "), norm_name("gamma-mod"));
    assert_eq!(norm_name("Gamma  Mod"), "gammamod");
    assert_ne!(norm_name("Gamma Mod 2"), norm_name("Gamma Mod"));
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────

#[test]
fn a_saved_list_is_cleaned_and_refreshed_from_the_library() {
    let input = OrderList {
        id: "forged".into(),
        name: "  My\u{0007} list  ".into(),
        profile_ids: s(&["p1", "ghost", "p1"]),
        entries: vec![
            // A local id: rewritten with everything the library knows (name, fingerprint…).
            OrderEntry { id: Some("id-a".into()), ..e("stale name") },
            OrderEntry { id: Some("id-a".into()), ..e("twice") },
            e("Not installed"),
            OrderEntry { content_id: Some("cid-x".into()), ..e("   ") },
            e(""),
        ],
        ..Default::default()
    };
    let out = sanitize(&input, None, &lib(), &s(&["p1", "p2"]), "now").unwrap();
    assert_ne!(out.id, "forged", "a new list gets an id from the backend");
    assert_eq!(out.name, "My list");
    assert_eq!(out.profile_ids, s(&["p1"]));
    let names: Vec<&str> = out.entries.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(names, ["Alpha", "Not installed", "cid-x"], "one entry per mod; an empty entry is nothing");
    assert_eq!(out.entries[0].content_id.as_deref(), Some("cid-a"));
    assert_eq!((out.created_at.as_str(), out.updated_at.as_str()), ("now", "now"));

    let again = sanitize(&OrderList { name: "Renamed".into(), ..out.clone() }, Some(&out), &lib(), &[], "later").unwrap();
    assert_eq!((again.id.as_str(), again.created_at.as_str(), again.updated_at.as_str()), (out.id.as_str(), "now", "later"));
}

#[test]
fn a_nameless_or_oversized_list_is_refused() {
    assert_eq!(sanitize(&OrderList { name: " \n ".into(), ..Default::default() }, None, &[], &[], "t").unwrap_err(), "orderList.errName");
    let big = OrderList { name: "x".into(), entries: vec![e("a"); MAX_ENTRIES + 1], ..Default::default() };
    assert_eq!(sanitize(&big, None, &[], &[], "t").unwrap_err(), "order.errTooLarge");
    let long = OrderList { name: "n".repeat(500), entries: vec![e(&"z".repeat(1000))], ..Default::default() };
    let out = sanitize(&long, None, &[], &[], "t").unwrap();
    assert_eq!((out.name.chars().count(), out.entries[0].name.chars().count()), (120, 300));
}

// ── The plan ───────────────────────────────────────────────────────────────────────────────

#[test]
fn the_plan_sorts_every_entry_and_drops_none() {
    let mut l = library(lib());
    l.deps.insert("id-a".into(), s(&["id-d"]));
    let current = s(&["id-x", "id-c", "id-d"]);
    let entries = vec![e("Gamma Mod"), e("Alpha"), e("Delta"), e("Ghost")];
    let p = plan("p", &current, &entries, &l, true);
    let states: Vec<(EntryState, usize)> = p.rows.iter().map(|r| (r.state, r.position)).collect();
    assert_eq!(states, [(EntryState::Active, 2), (EntryState::Inactive, 0), (EntryState::Missing, 0), (EntryState::Missing, 0)]);
    assert_eq!(p.to_activate.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["id-a"]);
    assert_eq!((p.already_active, p.missing, p.ambiguous), (1, 1, 1));
    // id-x is not listed: turned off by "only this list". id-d is not listed either, but
    // Alpha needs it: it stays.
    assert_eq!(p.to_deactivate.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["id-x"]);
    assert_eq!(p.placed, 1);
    assert!(!p.order_changed, "one active mod listed: nothing to reorder");
}

#[test]
fn applying_the_order_only_moves_active_mods_in_their_slots() {
    let l = library(lib());
    let current = s(&["id-a", "id-x", "id-c"]);
    let entries = vec![e("Gamma Mod"), e("Delta Missing"), e("Alpha")];
    let p = plan("p", &current, &entries, &l, true);
    assert_eq!(p.order_after, s(&["id-c", "id-x", "id-a"]));
    assert!(p.order_changed);
    assert_eq!(p.placed, 2);
}

#[test]
fn after_activation_the_list_wins_in_its_own_order() {
    // dep was pulled in by the activation; old was there before; the list is c, a.
    let current = s(&["old", "a", "dep", "c"]);
    assert_eq!(order_after_activation(&current, &s(&["c", "ghost", "a"])), s(&["old", "dep", "c", "a"]));
}

#[test]
fn dependencies_are_followed_and_cycles_end() {
    let mut deps = HashMap::new();
    deps.insert("a".to_string(), s(&["b"]));
    deps.insert("b".to_string(), s(&["c", "a"]));
    let all = with_dependencies(&s(&["a"]), &deps);
    assert_eq!(all.len(), 3);
}

// ── Import ─────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_imported_list_keeps_local_ids_only_for_what_resolved() {
    let doc = order_share::parse_text("Alpha\nUnknown\nDelta\n").unwrap();
    let mut doc2 = doc.clone();
    doc2.mods[1].id = Some("id-from-elsewhere".into());
    let out = imported(&doc2, &lib());
    assert_eq!(out.entries[0].id.as_deref(), Some("id-a"));
    assert_eq!(out.entries[0].content_id.as_deref(), Some("cid-a"), "named by everything the mod has here");
    assert_eq!(out.entries[1].id, None, "a foreign id is not kept");
    assert_eq!(out.entries[1].name, "Unknown");
    assert_eq!(out.matches.iter().map(|r| r.quality).collect::<Vec<_>>(), [MatchKind::Name, MatchKind::Missing, MatchKind::Ambiguous]);
}

#[test]
fn old_documents_and_lists_still_read() {
    // An entry written before `source_repo` existed, and a list with only a name.
    let entry: OrderEntry = serde_json::from_str(r#"{"name":"A","repo_mod_id":"r"}"#).unwrap();
    assert_eq!(entry.source_repo, None);
    let list: OrderList = serde_json::from_str(r#"{"name":"L"}"#).unwrap();
    assert!(list.entries.is_empty() && list.profile_ids.is_empty() && list.id.is_empty());
    // And an AppData without lists.
    let data: crate::state::AppData = serde_json::from_str(r#"{"profiles":[],"mods":[],"active_profile_id":null}"#).unwrap();
    assert!(data.order_lists.is_empty());
}

// ── Notes, the trust flag, sharing ─────────────────────────────────────────────────────────

fn listed(notes: &str) -> OrderList {
    OrderList { id: "l1".into(), name: "My list".into(), description: notes.into(), entries: vec![e("Alpha"), e("Nobody")], ..Default::default() }
}

#[test]
fn notes_keep_their_line_breaks_once_saved() {
    // The bug behind "rendered while editing, raw once saved": the single-line cleaner ate
    // every line break, so headings, lists and fences came back as one paragraph.
    let src = "# Title\r\n\r\n- one\n- two\n\n```mermaid\ngraph TD\n\tA-->B\n```\u{0007}\n\n";
    let out = sanitize(&listed(src), None, &lib(), &[], "t").unwrap();
    assert_eq!(out.description, "# Title\n\n- one\n- two\n\n```mermaid\ngraph TD\n\tA-->B\n```");
}

#[test]
fn notes_over_the_cap_are_refused_not_cut() {
    let at_cap = "é".repeat(MAX_NOTES);
    assert_eq!(sanitize(&listed(&at_cap), None, &lib(), &[], "t").unwrap().description.chars().count(), MAX_NOTES);
    let over = "a".repeat(MAX_NOTES + 1);
    assert_eq!(sanitize(&listed(&over), None, &lib(), &[], "t").unwrap_err(), "orderList.errNotesTooLong");
    assert!(MAX_NOTES >= 20_000, "much larger than the old 2 000");
}

#[test]
fn an_imported_list_stays_imported() {
    let first = sanitize(&OrderList { imported: true, ..listed("x") }, None, &lib(), &[], "t").unwrap();
    assert!(first.imported);
    // The frontend sends the flag back cleared: the stored one wins.
    let again = sanitize(&OrderList { imported: false, ..first.clone() }, Some(&first), &lib(), &[], "t2").unwrap();
    assert!(again.imported, "editing an imported list does not make it ours");
    let own = sanitize(&listed("x"), None, &lib(), &[], "t").unwrap();
    assert!(!own.imported);
    let old: OrderList = serde_json::from_str(r#"{"name":"L"}"#).unwrap();
    assert!(!old.imported, "lists saved before the flag are our own");
}

#[test]
fn a_short_list_shares_as_a_code_with_its_notes() {
    let x = export_list(&listed("## Read me\n\nfirst"), "now");
    let code = x.code.clone().expect("short enough for a code");
    assert_eq!(x.code_len, code.chars().count());
    let doc = parse_any(&code).unwrap();
    assert_eq!(doc.notes.as_deref(), Some("## Read me\n\nfirst"));
    let back = imported(&doc, &lib());
    assert_eq!(back.notes, "## Read me\n\nfirst");
    assert_eq!(back.name.as_deref(), Some("My list"));
    assert_eq!(x.file_name, "My-list.bmmorder");
}

#[test]
fn a_long_list_has_no_code_but_the_file_carries_everything() {
    let notes = "Long notes, line one.\n\n".repeat(700);
    let notes = notes.trim_end().to_string();
    let x = export_list(&listed(&notes), "now");
    assert!(x.code.is_none(), "over the ceiling: no code");
    assert!(x.code_len > MAX_CODE && x.code_max == MAX_CODE);
    let doc = parse_file(&x.file).unwrap();
    assert_eq!(doc.notes.as_deref(), Some(notes.as_str()));
    assert_eq!(doc.mods.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["Alpha", "Nobody"]);
    // And through the import box, which recognises the file and reads it strictly.
    assert_eq!(parse_any(&x.file).unwrap(), doc);
}

fn file_json(extra: &str) -> String {
    format!(r#"{{"format":"bmm-order-list","version":1,"name":"L","entries":[{{"name":"Alpha"}}]{}}}"#, extra)
}

#[test]
fn the_list_file_is_read_strictly() {
    assert!(parse_file(&file_json("")).is_ok());
    assert!(parse_file(&format!("\u{feff}{}", file_json(""))).is_ok(), "a BOM is not an error");
    let err = |s: &str| parse_file(s).unwrap_err();
    assert_eq!(err(&file_json(r#","script":"x""#)), "orderList.errFile", "unknown field");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":1,"name":"L","entries":[{"name":"A","onload":"x"}]}"#), "orderList.errFile", "unknown entry field");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":2,"name":"L","entries":[],"newer":true}"#), "order.errVersion", "a newer file says so first");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":0,"name":"L","entries":[{"name":"A"}]}"#), "order.errVersion");
    assert_eq!(err(r#"{"format":"bmm-order","version":1,"name":"L","entries":[{"name":"A"}]}"#), "orderList.errFile", "another format");
    assert_eq!(err(r#"{"format":"bmm-order-list","name":"L","entries":[{"name":"A"}]}"#), "orderList.errFile", "no version");
    assert_eq!(err("not json"), "orderList.errFile");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":1,"name":"L","entries":[]}"#), "order.errEmpty");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":1,"name":"  ","entries":[{"name":"A"}]}"#), "orderList.errFile", "nameless");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":1,"name":"L\u0007","entries":[{"name":"A"}]}"#), "orderList.errFile", "control character");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":1,"name":"L","entries":[{"name":"A\nB"}]}"#), "orderList.errFile", "a line break in a one-line field");
    assert_eq!(err(r#"{"format":"bmm-order-list","version":1,"name":"L","entries":[{"name":" "}]}"#), "orderList.errFile", "an entry naming nothing");
    let long_name = format!(r#"{{"format":"bmm-order-list","version":1,"name":"{}","entries":[{{"name":"A"}}]}}"#, "n".repeat(121));
    assert_eq!(err(&long_name), "orderList.errFile", "oversized, not cut");
    let long_entry = format!(r#"{{"format":"bmm-order-list","version":1,"name":"L","entries":[{{"name":"A","content_id":"{}"}}]}}"#, "c".repeat(257));
    assert_eq!(err(&long_entry), "orderList.errFile");
    let notes = file_json(&format!(r#","notes":"{}""#, "a".repeat(MAX_NOTES + 1)));
    assert_eq!(err(&notes), "orderList.errNotesTooLong");
    let bell = file_json(r#","notes":"a\u0007b""#);
    assert_eq!(err(&bell), "orderList.errFile");
    let ok_notes = file_json(r##","notes":"# T\n\n\tcode\r\n""##);
    assert!(parse_file(&ok_notes).is_ok(), "line breaks and tabs are what notes are made of");
    let huge = format!("{}{}", file_json(""), " ".repeat(MAX_FILE));
    assert_eq!(err(&huge), "order.errTooLarge");
    let many = format!(r#"{{"format":"bmm-order-list","version":1,"name":"L","entries":[{}]}}"#, vec![r#"{"name":"A"}"#; MAX_ENTRIES + 1].join(","));
    assert_eq!(err(&many), "order.errTooLarge");
}

#[test]
fn a_foreign_local_id_in_a_file_is_only_a_hint() {
    let f = r#"{"format":"bmm-order-list","version":1,"name":"L","entries":[{"name":"Something else","id":"id-a"},{"name":"Alpha","id":"id-zzz"}]}"#;
    let out = imported(&parse_file(f).unwrap(), &lib());
    assert_eq!(out.matches[0].quality, MatchKind::Missing, "an id that exists here does not pull in an unrelated mod");
    assert_eq!(out.entries[0].id, None);
    assert_eq!(out.entries[1].id.as_deref(), Some("id-a"), "found by name, named by the local id");
}

#[test]
fn codes_carry_notes_under_the_same_cap_and_a_newer_version_is_refused() {
    use base64::Engine;
    let enc = |json: String| format!("{}{}", order_share::CODE_PREFIX, base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json));
    let over = enc(format!(r#"{{"format":"bmm-order","version":1,"notes":"{}","mods":[{{"name":"A"}}]}}"#, "a".repeat(MAX_NOTES + 1)));
    assert_eq!(parse_any(&over).unwrap_err(), "orderList.errNotesTooLong");
    let newer = enc(r#"{"format":"bmm-order","version":9,"mods":[{"name":"A"}]}"#.to_string());
    assert_eq!(parse_any(&newer).unwrap_err(), "order.errVersion");
    // Documents written before notes existed still read, and say nothing.
    let old = enc(r#"{"format":"bmm-order","version":1,"mods":[{"name":"A"}]}"#.to_string());
    assert_eq!(parse_any(&old).unwrap().notes, None);
}

#[test]
fn file_names_are_made_of_the_list_name() {
    assert_eq!(file_name_for("Skyrim: base + ENB"), "Skyrim-base-ENB.bmmorder");
    assert_eq!(file_name_for("../../etc/passwd"), "etc-passwd.bmmorder");
    assert_eq!(file_name_for("   "), "order-list.bmmorder");
    assert_eq!(file_name_for("Liste épique"), "Liste-épique.bmmorder");
}
