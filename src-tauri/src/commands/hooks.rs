//! Waiting for something outside BMM to say "now".
//!
//! A scheduled task could wait for a CLOCK and for a file, and that is most of it — but not
//! the case that keeps coming up: a build finished, a server came up, a script somewhere
//! else got to the end. Those things know when they happened; BMM was the only one who had
//! to guess by polling.
//!
//! A hook is a named pigeonhole. Something posts to `POST /api/hook` with a name, this
//! records it, and a task waiting on that name wakes up. The task polls this in memory
//! rather than the network, so the wait costs nothing.
//!
//! **This is a LOCAL doorbell.** The API listens on 127.0.0.1 only, so a service on the
//! internet cannot ring it without a tunnel the user sets up on purpose — and the route
//! needs the API token like every other. What it is really for is the other things on this
//! machine: a script, a game, another tool, the CLI.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// One ring of the doorbell.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HookHit {
    /// Milliseconds since the epoch. What a waiting task compares against, so it can ignore
    /// rings that happened before it started waiting.
    pub at: u64,
    /// Whatever the caller sent. Free-form on purpose: this is a doorbell, and what the
    /// caller wants to say through it is not BMM's business.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// The pigeonholes.
///
/// Bounded, and that is not a detail: a task that waits on a hook nothing ever posts to
/// leaves the name in here, and a caller in a loop could otherwise grow it without limit in
/// a process that stays open for weeks.
static HOOKS: Mutex<Option<HashMap<String, Vec<HookHit>>>> = Mutex::new(None);

/// Per name. Old rings are dropped first, because the interesting one is the latest.
const MAX_PER_HOOK: usize = 50;
/// Names. A caller inventing a new name every time is a bug in the caller, and this keeps it
/// from becoming a leak in BMM.
const MAX_HOOKS: usize = 200;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A hook name that cannot be anything but a name.
///
/// It arrives in a URL and is used as a map key, and it is echoed back to a screen. Narrow
/// rather than escaped: there is no reason for a doorbell to be called `../../etc`.
pub fn safe_hook_name(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .take(64)
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect();
    cleaned.trim_matches(|c| c == '.' || c == '_').to_string()
}

/// Record a ring. Returns the name it was filed under, which is not always the name given.
#[tauri::command]
pub fn hook_fire(name: String, data: Option<serde_json::Value>) -> Result<String, String> {
    let name = safe_hook_name(&name);
    if name.is_empty() {
        return Err("hooks.errName".to_string());
    }
    let mut guard = HOOKS.lock().map_err(|_| "hooks.errBusy".to_string())?;
    let map = guard.get_or_insert_with(HashMap::new);

    if !map.contains_key(&name) && map.len() >= MAX_HOOKS {
        // Refused rather than evicting somebody else's hook: dropping a name a task is
        // waiting on would make that task hang forever for a reason nothing reports.
        return Err("hooks.errTooMany".to_string());
    }
    let list = map.entry(name.clone()).or_default();
    list.push(HookHit { at: now_ms(), data: data.unwrap_or(serde_json::Value::Null) });
    if list.len() > MAX_PER_HOOK {
        let cut = list.len() - MAX_PER_HOOK;
        list.drain(0..cut);
    }
    Ok(name)
}

/// The rings for one name that happened at or after `since`.
///
/// Reading does NOT clear them. Two tasks can wait on the same doorbell, and a read that
/// consumed would mean whichever polled first silently ate the other's wake-up.
#[tauri::command]
pub fn hook_poll(name: String, since: Option<u64>) -> Vec<HookHit> {
    let name = safe_hook_name(&name);
    let since = since.unwrap_or(0);
    let Ok(guard) = HOOKS.lock() else { return Vec::new() };
    let Some(map) = guard.as_ref() else { return Vec::new() };
    map.get(&name)
        .map(|v| v.iter().filter(|h| h.at >= since).cloned().collect())
        .unwrap_or_default()
}

/// Every name that has ever been rung this session, with how many times.
///
/// For the screen that asks "is my webhook actually arriving?" — which is the first question
/// when a wait never ends, and the one that used to have no answer at all.
#[tauri::command]
pub fn hook_list() -> Vec<(String, usize)> {
    let Ok(guard) = HOOKS.lock() else { return Vec::new() };
    let Some(map) = guard.as_ref() else { return Vec::new() };
    let mut out: Vec<(String, usize)> = map.iter().map(|(k, v)| (k.clone(), v.len())).collect();
    out.sort();
    out
}

/// Forget one name, or all of them.
#[tauri::command]
pub fn hook_clear(name: Option<String>) -> usize {
    let Ok(mut guard) = HOOKS.lock() else { return 0 };
    let Some(map) = guard.as_mut() else { return 0 };
    match name.map(|n| safe_hook_name(&n)).filter(|n| !n.is_empty()) {
        Some(n) => map.remove(&n).map(|v| v.len()).unwrap_or(0),
        None => {
            let n = map.values().map(|v| v.len()).sum();
            map.clear();
            n
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh(name: &str) -> String {
        // Each test uses its own name: the store is process-wide and `cargo test` runs
        // these on several threads at once, so a shared name would make one test's rings
        // arrive in another's poll.
        let n = format!("{}-{}", name, now_ms());
        hook_clear(Some(n.clone()));
        n
    }

    #[test]
    fn a_name_is_a_name_and_nothing_else() {
        assert_eq!(safe_hook_name("build-done"), "build-done");
        assert_eq!(safe_hook_name("  spaced  "), "spaced");
        assert_eq!(safe_hook_name("../../etc/passwd"), "etc_passwd");
        assert_eq!(safe_hook_name("a/b\\c"), "a_b_c");
        assert_eq!(safe_hook_name("..."), "");
        assert_eq!(safe_hook_name(""), "");
        assert_eq!(safe_hook_name(&"x".repeat(200)).len(), 64, "a name is bounded");
    }

    #[test]
    fn a_ring_is_recorded_and_can_be_read_twice() {
        let n = fresh("ring");
        hook_fire(n.clone(), Some(serde_json::json!({ "build": 42 }))).unwrap();
        let first = hook_poll(n.clone(), None);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].data["build"], 42);
        // Reading does not consume. Two tasks can wait on the same doorbell, and a read
        // that cleared would mean whichever polled first ate the other's wake-up.
        assert_eq!(hook_poll(n, None).len(), 1);
    }

    #[test]
    fn only_rings_from_after_the_wait_started_count() {
        let n = fresh("since");
        hook_fire(n.clone(), None).unwrap();
        let started = now_ms() + 1;
        assert!(hook_poll(n.clone(), Some(started)).is_empty(), "an older ring is not this wait's");

        // Wait for the clock to actually pass `started` before ringing again.
        //
        // This is not test-flakiness padding: the stamps are milliseconds, and two calls in
        // a row land in the SAME millisecond, so without this the second ring is stamped
        // before the moment the wait began and correctly does not count. Found by the test
        // failing, which is the behaviour working.
        //
        // The comparison is `at >= since` rather than `>`, so a ring in the very
        // millisecond a wait starts DOES count — the safer direction, since a task that
        // rings a doorbell and then waits on it should not miss its own ring.
        while now_ms() < started {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        hook_fire(n.clone(), None).unwrap();
        assert_eq!(hook_poll(n, Some(started)).len(), 1);
    }

    #[test]
    fn an_empty_name_is_refused_rather_than_filed_under_nothing() {
        assert_eq!(hook_fire("...".into(), None).unwrap_err(), "hooks.errName");
    }

    #[test]
    fn one_name_cannot_grow_without_limit() {
        let n = fresh("bound");
        for i in 0..(MAX_PER_HOOK + 20) {
            hook_fire(n.clone(), Some(serde_json::json!({ "i": i }))).unwrap();
        }
        let got = hook_poll(n, None);
        assert_eq!(got.len(), MAX_PER_HOOK);
        // The OLD ones went. The latest ring is the interesting one — a wait is looking for
        // what just happened, not for what happened forty rings ago.
        assert_eq!(got.last().unwrap().data["i"], (MAX_PER_HOOK + 19) as i64);
    }

    #[test]
    fn clearing_one_name_leaves_the_others() {
        let a = fresh("keep-a");
        let b = fresh("keep-b");
        hook_fire(a.clone(), None).unwrap();
        hook_fire(b.clone(), None).unwrap();
        assert_eq!(hook_clear(Some(a.clone())), 1);
        assert!(hook_poll(a, None).is_empty());
        assert_eq!(hook_poll(b, None).len(), 1);
    }
}
