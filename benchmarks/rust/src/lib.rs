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

pub mod fixtures;
pub mod fs_mirror;
pub mod repo_schema;
