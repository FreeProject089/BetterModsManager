use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDef {
    pub id: String,
    pub name: String,
    pub color: String,
    /// Icon-pack ref ("lucide:x" | "si:x" | "data:image/...") or "" for none.
    pub icon: String,
    /// Gradient end colour. None = flat tag. #[serde(default)] keeps every
    /// pre-gradient tags.json (and every shared profile/repo carrying tags)
    /// loading unchanged.
    #[serde(default)]
    pub color2: Option<String>,
}
