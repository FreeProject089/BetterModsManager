//! A stable name for a thing, so two people can tell they have the same one.
//!
//! A mod already has this: `derive_content_id` fingerprints its folder, and the same files on
//! any machine give the same answer. Nothing else did. A modpack, a plugin and an automation
//! all carry a local `id` minted when they were created — `sched-<timestamp>`, a uuid — which
//! is a different string on every machine that has the same content.
//!
//! So "is this the pack I already have" was unanswerable. Importing the same modpack from a
//! repo and from a catalogue produced two entries with two ids and no way to notice, and
//! sharing one meant telling somebody a number that meant nothing on their side.
//!
//! Same rule as the mod one: **hash what the thing IS, never what it is called here.** A name
//! and a description are edited; the members are the pack.

use sha2::{Digest, Sha256};

/// The prefix every derived id carries, so it can never be mistaken for a local one.
///
/// A local modpack id is a uuid and a task id is `sched-<millis>`; a content id looks like
/// neither, which matters the first time somebody pastes one into the wrong field.
pub const PREFIX: &str = "bmmc1:";

/// Fold a set of already-stable parts into one id.
///
/// Sorted before hashing, because the order two lists happen to be in is not part of what they
/// are — a pack whose mods were added in a different order is the same pack, and a rule that
/// says otherwise makes the whole idea useless.
///
/// Empty parts are skipped rather than hashed as "": a member with no fingerprint contributes
/// nothing, which is honest, instead of contributing a constant that every incomplete pack
/// would share.
pub fn fold(kind: &str, parts: &[String]) -> String {
    let mut keep: Vec<&String> = parts.iter().filter(|p| !p.trim().is_empty()).collect();
    keep.sort();
    keep.dedup();
    let mut h = Sha256::new();
    h.update(kind.as_bytes());
    h.update([0u8]);
    for p in keep {
        h.update(p.trim().as_bytes());
        h.update([0u8]);
    }
    format!("{}{:x}", PREFIX, h.finalize())
}

/// A modpack's content id: what it contains, not what it is called.
///
/// Each member contributes its own sha256 when it has one and its mod id otherwise. A pack
/// assembled from the same mods on two machines lands on the same id even when the local
/// entries were created at different times under different uuids.
pub fn modpack_id(mods: &[(String, String)]) -> String {
    let parts: Vec<String> = mods
        .iter()
        .map(|(mod_id, sha)| if sha.trim().is_empty() { mod_id.clone() } else { sha.clone() })
        .collect();
    fold("modpack", &parts)
}

/// A plugin's content id.
///
/// Its declared id plus everything it ships. The declared id is included here and NOT for a
/// modpack, and the difference is real: a plugin author chooses `com.me.tools` and means it to
/// be the identity, while a modpack's name is a label somebody typed.
pub fn plugin_id(declared_id: &str, files: &[String]) -> String {
    let mut parts = vec![declared_id.trim().to_string()];
    parts.extend(files.iter().cloned());
    fold("plugin", &parts)
}

/// An automation's content id: its steps, as JSON, with the local bookkeeping removed.
///
/// `id`, `lastRun`, `lastResult`, `history` and `enabled` all describe THIS machine. Two people
/// running the same automation must get the same id, and one of them having run it must not
/// change the answer.
pub fn task_id(task: &serde_json::Value) -> String {
    let mut copy = task.clone();
    if let Some(o) = copy.as_object_mut() {
        for k in ["id", "lastRun", "lastResult", "history", "enabled", "osSchedule", "createdAt"] {
            o.remove(k);
        }
    }
    // Serialised through a BTreeMap-backed value so key order cannot change the hash. serde_json
    // preserves insertion order by default, and two editors writing the same task in a different
    // field order would otherwise produce two ids.
    let canonical = canonical_json(&copy);
    fold("task", &[canonical])
}

/// JSON with every object's keys in sorted order, so equal documents hash equally.
fn canonical_json(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap_or_default(), canonical_json(&map[*k])))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        serde_json::Value::Array(items) => {
            // Arrays keep their order: a task's steps are a sequence, and sorting them would
            // make two different automations look identical.
            format!("[{}]", items.iter().map(canonical_json).collect::<Vec<_>>().join(","))
        }
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_same_members_in_a_different_order_are_the_same_pack() {
        let a = modpack_id(&[("m1".into(), "aaa".into()), ("m2".into(), "bbb".into())]);
        let b = modpack_id(&[("m2".into(), "bbb".into()), ("m1".into(), "aaa".into())]);
        assert_eq!(a, b, "the order mods were added in is not part of what the pack is");
    }

    #[test]
    fn a_different_member_is_a_different_pack() {
        let a = modpack_id(&[("m1".into(), "aaa".into())]);
        let b = modpack_id(&[("m1".into(), "ccc".into())]);
        assert_ne!(a, b);
    }

    #[test]
    fn a_member_with_no_fingerprint_falls_back_to_its_id() {
        // Better than hashing an empty string, which every incomplete pack would share.
        let a = modpack_id(&[("m1".into(), String::new())]);
        let b = modpack_id(&[("m1".into(), String::new())]);
        assert_eq!(a, b);
        assert_ne!(a, modpack_id(&[("m2".into(), String::new())]));
    }

    #[test]
    fn every_id_says_what_it_is() {
        // A local modpack id is a uuid and a task id is `sched-<millis>`. This looks like
        // neither, which is the point the first time one is pasted into the wrong field.
        assert!(modpack_id(&[("a".into(), "b".into())]).starts_with(PREFIX));
        assert!(plugin_id("x", &[]).starts_with(PREFIX));
        assert!(task_id(&json!({ "steps": [] })).starts_with(PREFIX));
    }

    #[test]
    fn two_kinds_never_collide() {
        // The kind is hashed in, so a plugin and a modpack built from the same string are
        // still two different things.
        assert_ne!(fold("plugin", &["x".into()]), fold("modpack", &["x".into()]));
    }

    #[test]
    fn local_bookkeeping_does_not_change_a_task() {
        let bare = json!({ "name": "T", "steps": [{ "kind": "action" }] });
        let lived_in = json!({
            "id": "sched-123", "name": "T", "enabled": true, "lastRun": 99,
            "lastResult": "ok", "history": [{ "at": 1 }], "osSchedule": true,
            "createdAt": 5, "steps": [{ "kind": "action" }],
        });
        assert_eq!(task_id(&bare), task_id(&lived_in), "running it must not rename it");
    }

    #[test]
    fn key_order_does_not_change_a_task() {
        let one: serde_json::Value = serde_json::from_str(r#"{"name":"T","steps":[]}"#).unwrap();
        let two: serde_json::Value = serde_json::from_str(r#"{"steps":[],"name":"T"}"#).unwrap();
        assert_eq!(task_id(&one), task_id(&two));
    }

    #[test]
    fn step_order_is_the_one_thing_that_must_not_be_sorted() {
        // The one place sorting would be wrong: steps are a sequence.
        let a = json!({ "steps": [{ "kind": "a" }, { "kind": "b" }] });
        let b = json!({ "steps": [{ "kind": "b" }, { "kind": "a" }] });
        assert_ne!(task_id(&a), task_id(&b));
    }
}

/// The content id of one thing BMM holds, by kind and local id.
///
/// One command rather than three, because the answer is the same shape and the caller is a
/// copy button that does not care which kind it is looking at.
#[tauri::command]
pub fn content_id_of(
    state: tauri::State<'_, crate::state::AppState>,
    app: tauri::AppHandle,
    kind: String,
    id: String,
) -> Result<String, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    match kind.as_str() {
        "modpack" => {
            let pack = data
                .modpacks
                .iter()
                .find(|m| m.id == id)
                .ok_or_else(|| "cid.errNoModpack".to_string())?;
            let members: Vec<(String, String)> = pack
                .mods
                .iter()
                .map(|m| (m.mod_id.clone(), m.sha256.clone()))
                .collect();
            Ok(modpack_id(&members))
        }
        "plugin" => {
            let p = data
                .installed_plugins
                .iter()
                .find(|p| p.manifest.id == id)
                .ok_or_else(|| "cid.errNoPlugin".to_string())?;
            let mut files: Vec<String> = p.manifest.scripts.clone();
            files.extend(p.manifest.folders.clone());
            files.extend(p.manifest.automations.clone());
            files.extend(p.manifest.assets.iter().map(|a| a.path.clone()));
            Ok(plugin_id(&p.manifest.id, &files))
        }
        "task" => {
            drop(data);
            // Tasks live in their own file, not in AppData's struct.
            let doc = crate::commands::scheduler::get_schedules(app)?;
            let found = doc
                .as_array()
                .and_then(|a| a.iter().find(|t| t.get("id").and_then(|x| x.as_str()) == Some(id.as_str())))
                .ok_or_else(|| "cid.errNoTask".to_string())?;
            Ok(task_id(found))
        }
        other => Err(format!("cid.errKind|{}", other)),
    }
}
