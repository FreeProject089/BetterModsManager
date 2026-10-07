//! A saved activation-order list: a named order of mods that is not tied to what is active.
//!
//! The order of a profile is `Profile.active_mods` and nothing else (commands/mod_order.rs).
//! A list is a different object on purpose: it may name mods that are NOT active, mods that
//! live outside the profile, even mods this machine does not have yet. It is applied to one or
//! several profiles (their active mods take its order), or activated (its mods are turned on,
//! in its order) — commands/order_lists.rs.
//!
//! Each entry names its mod by everything that identifies it (`OrderEntry`: local id, content
//! fingerprint, repo id and repo, name, version), so a list survives a renamed mod, a
//! reinstall, and the trip to another machine; the resolver picks the strongest one that
//! still answers (`order_share::resolve_entries`).

use crate::commands::order_share::OrderEntry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct OrderList {
    /// Empty on a list the frontend has not saved yet; the backend gives it one.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// The game it was made for, as a hint for the reader.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game: Option<String>,
    /// The profiles this list is meant for. Empty = a reusable list, for any profile.
    #[serde(default)]
    pub profile_ids: Vec<String>,
    /// First applied first; the last one wins a shared file.
    #[serde(default)]
    pub entries: Vec<OrderEntry>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}
