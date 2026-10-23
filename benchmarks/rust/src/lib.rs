//! BMM benchmark support library.
//!
//! - [`archive`] is the **real** `src-tauri/src/archive.rs`, included verbatim via
//!   `#[path]` (it has no `crate::` dependencies, so it compiles standalone and
//!   never drifts from the shipped code).
//! - [`fs_mirror`] and [`repo_schema`] are faithful re-implementations of the FS
//!   hot-paths (`fs_utils::list_mod_files` / `compute_file_hash` (BLAKE3) /
//!   `compute_file_sha256` / `copy_file_force_smart`) and the `models::repo`
//!   schema, kept light so this
//!   crate doesn't have to pull in `tauri` or the whole models graph.
//! - [`fixtures`] builds deterministic on-disk test data (mod trees + archives).

#[path = "../../../src-tauri/src/archive.rs"]
pub mod archive;

/// The real creator key v5 core (store, seal, pin, proof). Same rule as `archive`: it has no
/// `crate::` or `tauri` dependencies, so it compiles here verbatim.
#[path = "../../../src-tauri/src/commands/creator_v5/keystore.rs"]
pub mod creator_keystore;

/// The real universal catalogue format (1.0.2): detection, v1 → universal conversion,
/// validation. No `crate::` path in it, so it is mounted verbatim like `archive`.
#[path = "../../../src-tauri/src/commands/catalog_format.rs"]
#[allow(dead_code)]
pub mod catalog_format;

/// The real repo format module (1.0.2): `hash_file` (sha256 + chunk table) and
/// `hash_in_order`, used by repo validate / convert. Mounted verbatim as well.
#[path = "../../../src-tauri/src/commands/repo_format.rs"]
#[allow(dead_code)]
pub mod repo_format;

pub mod fixtures;
pub mod fs_mirror;
pub mod repo_schema;
