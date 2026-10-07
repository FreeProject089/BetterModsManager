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
