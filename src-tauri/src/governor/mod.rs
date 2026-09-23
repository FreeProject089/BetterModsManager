//! The resource governor (PLAN-BMM-RESOURCES-2026.md): one place every heavy BMM operation
//! goes through for its thread pool, its I/O policy and its priority.
//!
//! Phase G0 lands the configuration only (`config`): presets, per-disk × per-operation rules,
//! the hard bounds and the migration from `disk_limits`. Nothing calls it yet; the queue,
//! pools, copy engine and dashboard come in the later phases and read their policy from here.
pub mod config;
