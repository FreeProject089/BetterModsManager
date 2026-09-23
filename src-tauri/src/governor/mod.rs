//! The resource governor (PLAN-BMM-RESOURCES-2026.md): one place every heavy BMM operation
//! goes through for its thread pool, its I/O policy and its priority.
//!
//!   · `config` (G0): presets, per-disk × per-operation rules, the hard bounds, the migration
//!     from `disk_limits`.
//!   · `queue` (G1): tickets, per-category slots, pause / resume / cancel, background work
//!     stepping aside while foreground work runs.
//!
//! Nothing calls it yet: the pools, the copy engine and the dashboard come in the later
//! phases, and scripts/check-governed.mjs lists every site still to be migrated.
pub mod config;
pub mod queue;
