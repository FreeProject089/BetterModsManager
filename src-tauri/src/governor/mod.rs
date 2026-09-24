//! The resource governor (PLAN-BMM-RESOURCES-2026.md): one place every heavy BMM operation
//! goes through for its thread pool, its I/O policy and its priority.
//!
//!   · `config` (G0): presets, per-disk × per-operation rules, the hard bounds, the migration
//!     from `disk_limits`.
//!   · `queue` (G1): tickets, per-category slots, pause / resume / cancel, background work
//!     stepping aside while foreground work runs.
//!   · `io` (G2): the governed copy and its per-VOLUME rate limiter (the limit is shared by every
//!     copy to a disk, instead of each copy pacing itself).
//!   · `game_mode` (G4): "a game is running" as a pure state machine (enter at once, leave after
//!     30 s of absence, manual beats auto, deploy slowed and background work paused).
//!
//!   · `procs`: the one process sampler (5 s) that feeds game mode's detection.
//!   · `win`: thread priority for the pools, the per-handle I/O priority hint, the
//!     full-screen Direct3D signal (no-ops off Windows).
//!
//!   · `runtime` (G3 wiring): the one instance, `runtime::global()`: tickets, the resolved
//!     policy per volume, the per-kind rayon pools and the governed copy.
//!
//! scripts/check-governed.mjs lists every site still to be migrated onto `runtime`.
pub mod config;
pub mod queue;
pub mod io;
pub mod game_mode;
pub mod runtime;
pub mod telemetry;
pub mod procs;
pub mod win;
