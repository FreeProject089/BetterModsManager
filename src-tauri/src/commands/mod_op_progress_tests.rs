//! Activation progress and the costs an activation used to pay per mod.
//!
//! · the throttle that keeps `bmm://mod-op-progress` at or under PROGRESS_MAX_PER_SEC;
//! · the worker's progress line;
//! · data.json saves: same bytes as before, never an older snapshot over a newer one;
//! · two `#[ignore]` micro-benchmarks behind the numbers in the activation docs:
//!   `cargo test --release save_lock_hold_bench -- --ignored --nocapture`
//!   `cargo test --release cache_rebuild_cost_bench -- --ignored --nocapture`

use super::{parse_progress_line, ProgressThrottle, PROGRESS_MAX_PER_SEC};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[test]
fn progress_is_capped_at_the_rate_and_never_repeats_a_value() {
    let mut th = ProgressThrottle::new();
    let t0 = Instant::now();
    // A worker reporting every millisecond for two seconds, its count growing each time.
    let mut sent = Vec::new();
    for ms in 0..2000u64 {
        let now = t0 + Duration::from_millis(ms);
        if th.should_emit(now, ms + 1) { sent.push(now); }
    }
    assert!(sent.len() as u32 <= 2 * PROGRESS_MAX_PER_SEC + 1, "{} events in 2 s", sent.len());
    assert!(sent.len() >= 2 * PROGRESS_MAX_PER_SEC as usize - 1, "and still a live bar: {} events", sent.len());
    for w in sent.windows(2) {
        assert!(w[1] - w[0] >= Duration::from_millis(1000 / PROGRESS_MAX_PER_SEC as u64));
    }
}

#[test]
fn the_first_count_goes_out_at_once_and_a_stalled_count_never_does() {
    let mut th = ProgressThrottle::new();
    let t0 = Instant::now();
    assert!(th.should_emit(t0, 10), "the first figure is not held back");
    // A copy stuck on one big file: the same number for a long time is one event, not ten a second.
    for s in 1..50u64 {
        assert!(!th.should_emit(t0 + Duration::from_millis(200 * s), 10));
    }
    assert!(th.should_emit(t0 + Duration::from_secs(11), 11));
}

#[test]
fn the_worker_progress_line_is_read_and_anything_else_is_not() {
    assert_eq!(parse_progress_line("BMMPROG 12345"), Some(12345));
    assert_eq!(parse_progress_line("  BMMPROG 7  \r"), Some(7));
    for bad in ["", "BMMPROG", "BMMPROG -3", "BMMPROG 1e9", "progress 5", "thread 'main' panicked"] {
        assert_eq!(parse_progress_line(bad), None, "{bad:?}");
    }
}

fn temp_state(tag: &str) -> (crate::state::AppState, PathBuf) {
    let dir = std::env::temp_dir().join(format!("bmm-save-test-{}-{}", tag, uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("data.json");
    (crate::state::AppState::load(path.clone()), path)
}

#[test]
fn a_save_writes_the_same_document_and_rolls_the_previous_one_to_bak() {
    let (state, path) = temp_state("same");
    state.data.lock().unwrap().active_profile_id = Some("first".into());
    state.save().unwrap();
    state.data.lock().unwrap().active_profile_id = Some("second".into());
    state.save().unwrap();

    let now = std::fs::read(&path).unwrap();
    let expected = serde_json::to_vec_pretty(&*state.data.lock().unwrap()).unwrap();
    assert_eq!(now, expected, "byte for byte what the old to_writer_pretty wrote");
    let bak: serde_json::Value = serde_json::from_slice(&std::fs::read(path.with_extension("json.bak")).unwrap()).unwrap();
    assert_eq!(bak["active_profile_id"], "first", "the previous complete file is the backup");
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn concurrent_saves_never_leave_an_older_snapshot_on_disk() {
    let (state, path) = temp_state("order");
    let state = std::sync::Arc::new(state);
    let handles: Vec<_> = (0..8).map(|t| {
        let state = state.clone();
        std::thread::spawn(move || {
            for i in 0..25 {
                state.data.lock().unwrap().active_profile_id = Some(format!("{t}-{i}"));
                state.save().unwrap();
            }
        })
    }).collect();
    for h in handles { h.join().unwrap(); }
    // One more save after everything settled must equal memory; and the file written by the
    // last save of the storm already did (the ordering lock), so a reload agrees too.
    let on_disk: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let in_memory = state.data.lock().unwrap().active_profile_id.clone();
    assert_eq!(on_disk["active_profile_id"].as_str(), in_memory.as_deref());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

/// `mods` mods of `files` files each, with the file lists and hashes data.json really carries.
fn fill_library(state: &crate::state::AppState, mods: usize, files: usize) {
    let mut data = state.data.lock().unwrap();
    for m in 0..mods {
        let list: Vec<String> = (0..files).map(|f| format!("Data\\textures\\mod{m}\\sub{}\\file_{f:05}.dds", f % 7)).collect();
        let hashes: HashMap<String, String> = list.iter().map(|f| (f.clone(), format!("{:064x}", m * 7919 + f.len()))).collect();
        let entry = serde_json::json!({
            "id": format!("{m:08}-0000-4000-8000-000000000000"),
            "name": format!("Mod number {m}"),
            "version": "1.0.0",
            "author": "Someone",
            "description": "A synthetic mod for the save benchmark.",
            "dependencies": [],
            "enabled": m % 3 == 0,
            "mod_folder_path": format!("D:\\Games\\Mods\\Mod number {m}"),
            "status": "Disabled",
            "added_at": "2026-10-07T12:00:00+02:00",
            "cached_files": list,
            "file_hashes": hashes,
        });
        data.mods.push(serde_json::from_value(entry).unwrap());
    }
}

#[test]
#[ignore = "micro-benchmark: cargo test --release save_lock_hold_bench -- --ignored --nocapture"]
fn save_lock_hold_bench() {
    for (mods, files) in [(100usize, 200usize), (400, 200), (1000, 300)] {
        let (state, path) = temp_state("bench");
        fill_library(&state, mods, files);
        let runs = 5;
        let (mut old_hold, mut new_hold, mut new_total) = (Duration::ZERO, Duration::ZERO, Duration::ZERO);
        for _ in 0..runs {
            // Before: the data lock held through .bak copy + pretty write + fsync + rename.
            let t = Instant::now();
            {
                let data = state.data.lock().unwrap();
                if path.exists() { let _ = std::fs::copy(&path, path.with_extension("json.bak")); }
                crate::state::atomic_write_json(&path, &*data).unwrap();
            }
            old_hold += t.elapsed();
            // After: the lock only for serialising.
            let t = Instant::now();
            let bytes = { let data = state.data.lock().unwrap(); serde_json::to_vec_pretty(&*data).unwrap() };
            new_hold += t.elapsed();
            if path.exists() { let _ = std::fs::copy(&path, path.with_extension("json.bak")); }
            crate::state::atomic_write_bytes(&path, &bytes).unwrap();
            new_total += t.elapsed();
        }
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        println!(
            "save {mods} mods x {files} files ({:.1} MB): data lock held {:.1} ms before, {:.1} ms after (whole save {:.1} ms)",
            size as f64 / 1_048_576.0,
            old_hold.as_secs_f64() * 1000.0 / runs as f64,
            new_hold.as_secs_f64() * 1000.0 / runs as f64,
            new_total.as_secs_f64() * 1000.0 / runs as f64,
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[test]
#[ignore = "micro-benchmark: cargo test --release cache_rebuild_cost_bench -- --ignored --nocapture"]
fn cache_rebuild_cost_bench() {
    // What `invalidate_cache` at the end of enable_mod made the NEXT enable pay, under the data
    // lock: the file → mods index rebuilt from every mod's cached list (the mtime-unchanged
    // path, no disk walk). An "Enable all" of N mods paid it N times.
    for (mods, files) in [(100usize, 200usize), (400, 200), (1000, 300)] {
        let lists: Vec<(String, Vec<String>)> = (0..mods)
            .map(|m| (format!("mod-{m}"), (0..files).map(|f| format!("Data\\textures\\mod{m}\\file_{f:05}.dds")).collect()))
            .collect();
        let runs = 5;
        let t = Instant::now();
        for _ in 0..runs {
            let mut cache: HashMap<String, HashSet<PathBuf>> = HashMap::new();
            let mut index: HashMap<PathBuf, Vec<String>> = HashMap::new();
            for (id, files) in &lists {
                let set: HashSet<PathBuf> = files.iter().cloned().map(PathBuf::from).collect();
                for f in &set { index.entry(f.clone()).or_default().push(id.clone()); }
                cache.insert(id.clone(), set);
            }
            std::hint::black_box((&cache, &index));
        }
        let per = t.elapsed().as_secs_f64() * 1000.0 / runs as f64;
        println!(
            "index rebuild {mods} mods x {files} files: {per:.1} ms per enable before; an Enable all of {mods} paid ~{:.1} s of it, now 0",
            per * mods as f64 / 1000.0
        );
    }
}
