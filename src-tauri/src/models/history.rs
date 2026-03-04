use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub mod_id: String,
    pub mod_name: String,
    pub action: String,
    pub timestamp: String,
}
