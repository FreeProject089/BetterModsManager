//! The resources dashboard's live feed (G6): subscribe while it is open, unsubscribe when it
//! closes. With nobody subscribed the sampler does not run at all (governor/telemetry.rs).
use crate::governor::telemetry::sampler;
use tauri::Emitter;

/// Returns the number of subscribers after this one. Starts the 1 Hz loop if needed; each
/// sample is emitted as `bmm://governor-tick`.
#[tauri::command]
pub fn resources_subscribe(app: tauri::AppHandle) -> usize {
    let n = sampler().subscribe();
    sampler().run(move |s| { let _ = app.emit("bmm://governor-tick", s); });
    n
}

#[tauri::command]
pub fn resources_unsubscribe() -> usize { sampler().unsubscribe() }
