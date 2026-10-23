//! App telemetry on BetterCommunity v2 (ADR 0024): BMM's queued events sent to
//! `POST /v2/apps/{app}/telemetry/batch` with the publishable app key, in v2 mode only.
//!
//! THE RULES, ON THIS SIDE
//!   * Nothing changes the consent rule: `analytics_flush` returns before anything here unless
//!     telemetry consent is on. The consent header is not taken from the webview: it is the
//!     latest telemetry receipt of the consent ledger (its categories, its text version). No
//!     receipt that grants something: nothing is sent.
//!   * The declaration (`bc_v2_telemetry.json`) is what BMM's team PUTs on
//!     `/v2/apps/{app}/telemetry`; the same file filters every event here, so nothing the server
//!     would refuse leaves the machine: an event of a category not granted, an undeclared event
//!     or an undeclared property is dropped before sending (the server refuses them too).
//!   * Minimisation before the server's own: the install is a pseudonym derived from the Creator
//!     ID (`pseudonym`), never the id itself; the precise hardware identity of `$identify`
//!     (board, machine model, monitors, disks) and names (repo, creator) are not declared, so
//!     they never leave.
//!   * Session replay (`$replay`) has no v2 home: it stays on the v1 telemetry server, which
//!     installed copies keep using until the cut-over (ADR 0024 §3).

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

use crate::commands::consent_ledger::{sha256_hex, Receipt};

pub const DECLARATION: &str = include_str!("bc_v2_telemetry.json");
/// Events per request (contract: 1 to 500).
pub const BATCH_MAX: usize = 500;
const PSEUDONYM_SALT: &str = "bmm-telemetry-bcv2:";

pub fn declaration() -> &'static Value {
    static D: OnceLock<Value> = OnceLock::new();
    D.get_or_init(|| serde_json::from_str(DECLARATION).unwrap_or(Value::Null))
}

/// The declared categories, in order.
pub fn declared_categories() -> Vec<String> {
    declaration()["categories"].as_array().map(|a| a.iter().filter_map(|c| c["key"].as_str().map(str::to_string)).collect()).unwrap_or_default()
}

fn declared_event(name: &str) -> Option<&'static Value> {
    declaration()["events"].as_array()?.iter().find(|e| e["name"] == name)
}

/// The install as v2 sees it: a stable pseudonym (`^[A-Za-z0-9_-]{8,128}$`), not the Creator ID.
pub fn pseudonym(distinct_id: &str) -> String {
    let h = sha256_hex(format!("{PSEUDONYM_SALT}{}", distinct_id.trim()).as_bytes());
    format!("bmm_{}", &h[..32])
}

/// The consent header from the ledger: the newest telemetry receipt. `accepted` grants every
/// declared category, `custom` the ones it says yes to (others no), anything else nothing.
/// None when nothing is granted: then nothing is sent.
pub fn consent_header(receipts: &[Receipt]) -> Option<Value> {
    let latest = receipts.iter().filter(|r| r.doc == "telemetry").max_by_key(|r| r.seq)?;
    let cats = declared_categories();
    let granted: BTreeMap<String, bool> = match latest.choice.as_str() {
        "accepted" => cats.iter().map(|c| (c.clone(), true)).collect(),
        "custom" => cats.iter().map(|c| (c.clone(), latest.categories.get(c).copied().unwrap_or(false))).collect(),
        _ => return None,
    };
    if !granted.values().any(|v| *v) {
        return None;
    }
    let version: String = latest.version.trim().chars().take(40).collect();
    if version.is_empty() {
        return None;
    }
    Some(json!({ "categories": granted, "version": version }))
}

/// A property value as the contract takes it: a string up to 2,000 characters, a number, a
/// boolean or null. A list or an object becomes its JSON text, cut.
fn flat_value(v: &Value) -> Value {
    match v {
        Value::Null | Value::Bool(_) => v.clone(),
        Value::Number(n) => if n.as_f64().map(f64::is_finite).unwrap_or(false) { v.clone() } else { Value::Null },
        Value::String(s) => Value::String(s.chars().take(2000).collect()),
        other => Value::String(other.to_string().chars().take(2000).collect()),
    }
}

/// One queued event as the v2 batch item, or None when it does not go to v2 (replay, an
/// undeclared event, a category not granted). Only declared properties are kept.
pub fn to_v2_event(ev: &Value, granted: &Map<String, Value>, install: &str) -> Option<Value> {
    let name = ev["event"].as_str()?;
    let decl = declared_event(name)?;
    let cat = decl["category"].as_str()?;
    if granted.get(cat).and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let allowed: Vec<&str> = decl["properties"].as_array()?.iter().filter_map(Value::as_str).collect();
    // `$identify` carries its profile under `$set`: read it at the top level.
    let mut src: Map<String, Value> = ev["properties"].as_object().cloned().unwrap_or_default();
    if let Some(set) = src.remove("$set").and_then(|s| s.as_object().cloned()) {
        for (k, v) in set {
            src.entry(k).or_insert(v);
        }
    }
    let props: Map<String, Value> = src.iter().filter(|(k, _)| allowed.contains(&k.as_str())).map(|(k, v)| (k.clone(), flat_value(v))).collect();
    let ts: String = ev["timestamp"].as_str().unwrap_or("").chars().take(40).collect();
    Some(json!({ "event": name, "distinct_id": install, "timestamp": ts, "properties": props }))
}

/// The queue split for v2: (events for v2 as (queued original, batch item), events that stay
/// for the v1 server, how many were dropped). Only `$replay` stays; the rest either goes to v2
/// or is dropped here, because the server would refuse it (not granted, not declared).
pub fn split_queue(queue: &[Value], header: &Value, install: &str) -> (Vec<(Value, Value)>, Vec<Value>, usize) {
    let granted = header["categories"].as_object().cloned().unwrap_or_default();
    let (mut v2, mut keep, mut dropped) = (Vec::new(), Vec::new(), 0usize);
    for ev in queue {
        if ev["event"] == "$replay" {
            keep.push(ev.clone());
            continue;
        }
        match to_v2_event(ev, &granted, install) {
            Some(e) => v2.push((ev.clone(), e)),
            None => dropped += 1,
        }
    }
    (v2, keep, dropped)
}

/// One request body (`ingestTelemetryBatch`, strict object).
pub fn batch_body(packet_id: &str, header: &Value, events: &[Value]) -> Value {
    json!({ "packet_id": packet_id, "consent": header, "batch": events })
}

/// What a batch answer means: sent (202), keep for later (no declaration yet, the key refused,
/// the server away), or drop (413: the body can never pass).
#[derive(Debug, PartialEq)]
pub enum BatchOutcome {
    Sent,
    Keep,
    Drop,
}
pub fn batch_outcome(status: u16) -> BatchOutcome {
    match status {
        200..=299 => BatchOutcome::Sent,
        413 | 400 | 422 => BatchOutcome::Drop,
        _ => BatchOutcome::Keep,
    }
}

/// Send the v2 part of the queue. Returns (events accepted into v2, the events that stay
/// queued, the packet ids sent). A network failure or a refusal that can change (404 not
/// declared yet, 403 key, 5xx): that batch and the later ones stay queued, as they were, for the
/// next flush.
pub async fn flush(root: &str, app_id: &str, app_key: &str, header: &Value, queue: Vec<Value>, install: &str) -> (usize, Vec<Value>, Vec<String>) {
    let (v2, mut keep, _dropped) = split_queue(&queue, header, install);
    if v2.is_empty() {
        return (0, keep, Vec::new());
    }
    let Ok(client) = crate::commands::bc_v2::v2_client(20) else { return (0, queue, Vec::new()) };
    let url = format!("{root}/v2/apps/{app_id}/telemetry/batch");
    let mut sent = 0usize;
    let mut packets = Vec::new();
    for (i, chunk) in v2.chunks(BATCH_MAX).enumerate() {
        let packet_id = uuid::Uuid::new_v4().to_string();
        let items: Vec<Value> = chunk.iter().map(|(_, e)| e.clone()).collect();
        let status = match client
            .post(&url)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", app_key.trim()))
            .json(&batch_body(&packet_id, header, &items))
            .send()
            .await
        {
            Ok(r) => r.status().as_u16(),
            Err(_) => 0,
        };
        match batch_outcome(status) {
            BatchOutcome::Sent => {
                sent += chunk.len();
                packets.push(packet_id);
            }
            BatchOutcome::Drop => {
                crate::commands::crash::log_line(format!("[ANALYTICS] v2 refused a batch for good (http_{status}): dropped"));
            }
            BatchOutcome::Keep => {
                let rest: Vec<Value> = v2[i * BATCH_MAX..].iter().map(|(o, _)| o.clone()).collect();
                crate::commands::crash::log_line(format!("[ANALYTICS] v2 batch not taken (http_{status}): {} event(s) kept", rest.len()));
                keep.extend(rest);
                return (sent, keep, packets);
            }
        }
    }
    (sent, keep, packets)
}

/// Erase this install's events on v2 (the person's request; ADR 0024 `forget`).
pub async fn forget(root: &str, app_id: &str, app_key: &str, install: &str) -> Result<u64, String> {
    let resp = crate::commands::bc_v2::v2_client(15)?
        .post(format!("{root}/v2/apps/{app_id}/telemetry/forget"))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", app_key.trim()))
        .json(&json!({ "distinct_id": install }))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(resp.json::<Value>().await.ok().and_then(|v| v["deleted"].as_u64()).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt(seq: u64, choice: &str, cats: &[(&str, bool)]) -> Receipt {
        Receipt { seq, doc: "telemetry".into(), version: "3".into(), choice: choice.into(), categories: cats.iter().map(|(k, v)| (k.to_string(), *v)).collect(), ..Default::default() }
    }

    #[test]
    fn the_declaration_matches_the_v2_contract() {
        let d = declaration();
        let key = |s: &str| {
            let b = s.as_bytes();
            (2..=40).contains(&s.len()) && b[0].is_ascii_lowercase() && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
        };
        let cats = declared_categories();
        assert!((1..=20).contains(&cats.len()));
        for c in d["categories"].as_array().unwrap() {
            assert!(key(c["key"].as_str().unwrap()));
            for f in ["name", "description"] {
                for l in ["en", "fr"] {
                    let t = c[f][l].as_str().unwrap();
                    assert!(!t.trim().is_empty() && t.chars().count() <= 300);
                }
            }
        }
        let events = d["events"].as_array().unwrap();
        assert!(events.len() <= 200);
        let mut names = std::collections::HashSet::new();
        for e in events {
            let n = e["name"].as_str().unwrap();
            assert!(names.insert(n), "{n} twice");
            assert!((2..=80).contains(&n.len()) && (n.starts_with('$') || n.as_bytes()[0].is_ascii_lowercase()), "{n}");
            assert!(n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_.:$-".contains(c)), "{n}");
            assert!(cats.contains(&e["category"].as_str().unwrap().to_string()), "{n}: undeclared category");
            let props = e["properties"].as_array().unwrap();
            assert!(props.len() <= 40, "{n}");
            for p in props {
                let p = p.as_str().unwrap();
                assert!((1..=60).contains(&p.len()) && (p.starts_with('$') || p.as_bytes()[0].is_ascii_lowercase()), "{n}.{p}");
            }
        }
        assert!(declared_event("$replay").is_none(), "replay stays on the v1 server");
    }

    #[test]
    fn the_install_is_a_pseudonym() {
        let p = pseudonym("creator-id-123");
        assert!(p.len() >= 8 && p.len() <= 128 && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
        assert_eq!(p, pseudonym("creator-id-123"));
        assert!(!p.contains("creator"));
    }

    #[test]
    fn the_consent_header_comes_from_the_ledger() {
        let all = consent_header(&[receipt(1, "accepted", &[])]).unwrap();
        assert_eq!(all["version"], "3");
        assert!(declared_categories().iter().all(|c| all["categories"][c] == true));
        let some = consent_header(&[receipt(1, "accepted", &[]), receipt(2, "custom", &[("usage", true), ("perf", false)])]).unwrap();
        assert_eq!(some["categories"]["usage"], true);
        assert_eq!(some["categories"]["perf"], false);
        assert_eq!(some["categories"]["laya"], false, "not said yes to = no");
        assert!(consent_header(&[receipt(1, "accepted", &[]), receipt(2, "withdrawn", &[])]).is_none());
        assert!(consent_header(&[receipt(1, "custom", &[("usage", false)])]).is_none());
        assert!(consent_header(&[]).is_none());
    }

    #[test]
    fn only_declared_granted_events_with_declared_properties_go() {
        let header = consent_header(&[receipt(1, "custom", &[("usage", true), ("perf", false)])]).unwrap();
        let q = vec![
            json!({ "event": "page_enter", "distinct_id": "cid", "timestamp": "t", "properties": { "view": "mods", "depth": 2, "secret": "x", "session_id": "s" } }),
            json!({ "event": "perf", "properties": { "fps_avg": 60 } }),
            json!({ "event": "unknown_event", "properties": {} }),
            json!({ "event": "$replay", "properties": { "chunk": "..." } }),
            json!({ "event": "$identify", "properties": { "$set": { "os": "windows", "motherboard": "ASUS X", "disks": [1], "app_version": "1.0.4" }, "seq": 1 } }),
        ];
        let (pairs, keep, dropped) = split_queue(&q, &header, "bmm_x");
        assert_eq!(keep.len(), 1, "replay stays for v1");
        assert_eq!(dropped, 2, "perf not granted, unknown not declared");
        let v2: Vec<Value> = pairs.into_iter().map(|(_, e)| e).collect();
        assert_eq!(v2.len(), 2);
        assert_eq!(v2[0]["distinct_id"], "bmm_x");
        assert_eq!(v2[0]["properties"], json!({ "view": "mods", "depth": 2, "session_id": "s" }));
        assert_eq!(v2[1]["properties"], json!({ "os": "windows", "app_version": "1.0.4", "seq": 1 }), "hardware identity never leaves");
    }

    #[test]
    fn values_fit_the_contract() {
        assert_eq!(flat_value(&json!("x".repeat(3000))).as_str().unwrap().len(), 2000);
        assert_eq!(flat_value(&json!([1, 2])), json!("[1,2]"));
        assert_eq!(flat_value(&json!(true)), json!(true));
        let header = consent_header(&[receipt(1, "accepted", &[])]).unwrap();
        let b = batch_body("p", &header, &[json!({ "event": "copy" })]);
        assert_eq!(b.as_object().unwrap().keys().cloned().collect::<Vec<_>>(), vec!["batch", "consent", "packet_id"]);
    }

    #[test]
    fn what_to_do_with_an_answer() {
        assert_eq!(batch_outcome(202), BatchOutcome::Sent);
        assert_eq!(batch_outcome(404), BatchOutcome::Keep, "not declared yet: the owner's step");
        assert_eq!(batch_outcome(403), BatchOutcome::Keep);
        assert_eq!(batch_outcome(0), BatchOutcome::Keep);
        assert_eq!(batch_outcome(413), BatchOutcome::Drop);
    }
}
