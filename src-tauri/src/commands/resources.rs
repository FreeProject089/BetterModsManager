//! The resource governor, as the frontend and the scheduler see it (A3).
//!
//! Status, the preset (persistent, or for one scheduled task's duration), manual game mode and
//! the queue (pause / resume / cancel). All cheap: nothing here does I/O except saving the
//! document on a persistent preset change, so they stay sync commands.
//!
//! A task-scoped preset is NEVER written to `AppData.resources`: it lives in the governor,
//! the task clears it with its token in its `finally`, and a timer clears it anyway after
//! the TTL (at most 2 h), so a task killed mid-run cannot leave BMM in "Max" for good.
use crate::governor::config::Preset;
use crate::governor::game_mode::Manual;
use crate::governor::queue::TicketView;
use crate::governor::runtime::{global, TASK_PRESET_MAX};
use crate::state::AppState;
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct TaskPresetView {
    pub preset: Preset,
    pub overrides_game: bool,
    pub token: u64,
    pub remaining_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct ResourcesStatus {
    /// The user's preset (the stored document).
    pub preset: Preset,
    /// The preset in force right now (game mode or a task may differ from `preset`).
    pub effective: Preset,
    pub task: Option<TaskPresetView>,
    pub game_active: bool,
    pub game_manual: Manual,
    pub tickets: Vec<TicketView>,
}

pub(crate) fn parse<T: serde::de::DeserializeOwned>(what: &str, v: &str) -> Result<T, String> {
    serde_json::from_value(serde_json::Value::String(v.trim().to_lowercase())).map_err(|_| format!("unknown {what}: {v}"))
}

pub fn status() -> ResourcesStatus {
    let g = global();
    g.expire_task_preset();
    let (game_active, game_manual) = g.game_mode();
    let now = Instant::now();
    ResourcesStatus {
        preset: g.config().preset,
        effective: g.effective_preset(),
        task: g.task_preset().map(|t| TaskPresetView {
            preset: t.preset, overrides_game: t.overrides_game, token: t.token,
            remaining_ms: t.until.saturating_duration_since(now).as_millis() as u64,
        }),
        game_active,
        game_manual,
        tickets: g.queue().snapshot(),
    }
}

#[tauri::command]
pub fn resources_status() -> ResourcesStatus { status() }

/// `scope`: "persistent" writes the document (and survives a restart); "task" returns a token
/// the caller passes to `resources_clear_task_preset`. `ttl_secs` is capped at 2 h.
#[tauri::command]
pub fn resources_set_preset(state: State<AppState>, name: String, scope: String, ttl_secs: Option<u64>, overrides_game: Option<bool>) -> Result<Option<u64>, String> {
    let token = apply_preset(&state.data, &name, &scope, ttl_secs, overrides_game.unwrap_or(false))?;
    if token.is_none() { state.save().map_err(|e| e.to_string())?; }
    Ok(token)
}

/// What `resources_set_preset` does, minus the saving: the command and `POST
/// /api/resources/preset` (A4) share it, and each saves the document its own way. `Ok(None)`
/// = a persistent change the caller must save; `Ok(Some(token))` = a task-scoped preset.
pub fn apply_preset(data: &std::sync::Mutex<crate::state::AppData>, name: &str, scope: &str, ttl_secs: Option<u64>, overrides_game: bool) -> Result<Option<u64>, String> {
    let preset: Preset = parse("preset", name)?;
    match scope.trim() {
        "persistent" => {
            let cfg = {
                let mut data = data.lock().map_err(|_| "state lock".to_string())?;
                data.resources.preset = preset;
                data.resources.clone()
            };
            global().configure(cfg);
            Ok(None)
        }
        "task" => {
            let ttl = Duration::from_secs(ttl_secs.unwrap_or(TASK_PRESET_MAX.as_secs())).min(TASK_PRESET_MAX);
            let token = global().set_task_preset(preset, overrides_game, ttl);
            // The safety net: whatever happens to the task, the preset ends.
            std::thread::spawn(move || { std::thread::sleep(ttl + Duration::from_millis(50)); global().expire_task_preset(); });
            Ok(Some(token))
        }
        other => Err(format!("unknown scope: {other} (persistent | task)")),
    }
}

#[tauri::command]
pub fn resources_clear_task_preset(token: u64) -> bool { global().clear_task_preset(token) }

/// "auto" (detection decides), "on", "off".
#[tauri::command]
pub fn resources_game_mode(mode: String) -> Result<(), String> {
    let m: Manual = parse("game mode", &mode)?;
    global().set_game_manual(m);
    Ok(())
}

/// "pause_all" | "resume_all" | "pause" | "resume" | "cancel" (the last three need `id`).
#[tauri::command]
pub fn resources_queue(action: String, id: Option<u64>) -> Result<bool, String> {
    let q = global().queue();
    let need = || id.ok_or_else(|| format!("{action} needs an id"));
    Ok(match action.as_str() {
        "pause_all" => { q.pause_all(); true }
        "resume_all" => { q.resume_all(); true }
        "pause" => q.pause(need()?),
        "resume" => q.resume(need()?),
        "cancel" => q.cancel(need()?),
        other => return Err(format!("unknown queue action: {other}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_parse_case_insensitively_and_unknown_ones_are_refused() {
        assert_eq!(parse::<Preset>("preset", "Max").unwrap(), Preset::Max);
        assert_eq!(parse::<Manual>("game mode", " ON ").unwrap(), Manual::On);
        assert!(parse::<Preset>("preset", "turbo").is_err());
    }

    #[test]
    fn a_queue_action_on_one_ticket_needs_its_id() {
        assert!(resources_queue("cancel".into(), None).is_err());
        assert!(resources_queue("explode".into(), Some(1)).is_err());
        assert_eq!(resources_queue("cancel".into(), Some(u64::MAX)).unwrap(), false, "an unknown id changes nothing");
    }
}
