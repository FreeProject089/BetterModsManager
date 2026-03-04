use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDef {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
}
