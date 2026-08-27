use serde::{Serialize, Deserialize};
use std::collections::HashMap;

fn default_true() -> bool { true }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppImages {
    pub thumb: Option<String>,
    pub extra: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppDownload {
    pub url: String,
    /// "zip" | "exe" | "msi" | "script" — or absent.
    ///
    /// Empty is the honest reading of an omission, and it degrades correctly: the installer
    /// already decides script-vs-setup from the URL's filename, and only consults this to
    /// agree with it. Without a default, an entry stating a url and no type failed to
    /// deserialize and took its whole catalogue with it — the same trap `tags` had.
    #[serde(default)]
    pub file_type: String,
    pub size: Option<u64>,
    /// Optional sha256 checksum (CWE-494). Verified before install when present.
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppEntry {
    pub id: String,
    pub title: String,
    /// Absent is not a parse error.
    ///
    /// Every field below carries a default, and the reason is what happens without one:
    /// serde refuses the ENTRY, `fetch_app_catalogs` refuses the whole CATALOGUE, and the
    /// UI only says so when every source failed. So one community entry written without a
    /// `tags` key made an entire list vanish from the browser with a line in the console.
    ///
    /// The defaults are the honest reading of an omission — no tags, no description, "other"
    /// rather than a category invented for it, "free" rather than a price nobody stated.
    #[serde(default)]
    pub description: String,
    pub md_link: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,  // "game" | "utility" | "other"
    /// "free" | "freemium" | "paid" | "oss".
    ///
    /// `oss` is not a price and that is the point: "open source" is what people are
    /// actually looking for when they filter this column, and it says something "free"
    /// does not — free is about the money, oss is about whether you can read it.
    #[serde(default = "default_price")]
    pub price: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub version: Option<String>,
    pub requirements: Option<String>,
    pub images: Option<AppImages>,
    pub download: AppDownload,
    pub official: Option<bool>,
    pub partner: Option<bool>,
    /// Which catalog URL this entry came from (injected at merge time)
    pub source_label: Option<String>,
    /// What the SOURCE claimed this entry was — "official" or "partner" — when the tier it
    /// was actually fetched from does not grant that.
    ///
    /// The claim used to be overwritten and forgotten. Keeping it is not a softening of the
    /// rule: the entry is still community, and this never feeds a badge of its own. It is
    /// shown attributed to the catalogue that said it, so a reader sees "this list calls
    /// itself official" rather than either an endorsement BMM never gave or a silence that
    /// hides an attempt to claim one.
    #[serde(skip_deserializing)]
    pub claimed_tier: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppCatalog {
    pub version: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub apps: Vec<AppEntry>,
    /// Only honoured from the official catalog.
    /// URLs listed here receive the "Partner" badge — entries from any other
    /// source that claim partner=true are silently stripped.
    pub partner_catalogs: Option<Vec<String>>,
    /// Community catalog URLs to auto-load (no trust badge granted).
    pub community_imports: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MergedCatalog {
    pub apps: Vec<AppEntry>,
    pub sources_loaded: Vec<String>,
    pub sources_failed: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledAppInfo {
    pub id: String,
    pub title: String,
    pub install_path: String,
    pub exe_path: Option<String>,
    pub installed_at: String,
    pub version: Option<String>,
    pub usage_seconds: u64,
    pub category: Option<String>,
    pub thumb: Option<String>,
    /// true = BMM created the install_path folder → safe to delete on uninstall
    /// false = external installer; BMM only manages the exe reference
    #[serde(default = "default_true")]
    pub is_managed: bool,
    /// For setup-installed apps: command to run the app's real uninstaller
    /// (from the Windows registry UninstallString or a unins*.exe in the folder)
    #[serde(default)]
    pub uninstaller: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppsState {
    pub installed: HashMap<String, InstalledAppInfo>,
    pub favorites: Vec<String>,
    pub history: Vec<AppHistoryEntry>,
    pub community_sources: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppHistoryEntry {
    pub action: String,    // "install" | "launch" | "uninstall"
    pub app_id: String,
    pub app_title: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstallResult {
    pub app_id: String,
    pub install_path: String,
    pub executables: Vec<ExeInfo>,
    /// true when a setup/msi installer was run (BMM waited for it and auto-detected the exe)
    pub installer_launched: bool,
    /// true when BMM successfully auto-detected the installed executable
    pub auto_detected: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExeInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
}

fn default_category() -> String { "other".to_string() }
fn default_price() -> String { "free".to_string() }

#[cfg(test)]
mod entry_tests {
    use super::*;

    #[test]
    fn an_entry_with_only_the_essentials_still_parses() {
        // What a hand-written community catalogue actually looks like. Before the defaults,
        // this refused — and took every other entry in the same file with it.
        let e: AppEntry = serde_json::from_str(
            r#"{"id":"x","title":"X","download":{"url":"https://e/x.zip","file_type":"zip"}}"#,
        )
        .expect("a minimal entry must parse");
        assert!(e.tags.is_empty());
        assert_eq!(e.category, "other");
        assert_eq!(e.price, "free");
        assert_eq!(e.description, "");
    }

    #[test]
    fn a_download_with_no_stated_type_still_parses() {
        // The installer works it out from the URL's filename; the field only agrees with it.
        let e: AppEntry = serde_json::from_str(
            r#"{"id":"x","title":"X","download":{"url":"https://e/setup.exe"}}"#,
        )
        .expect("a download without a file_type must parse");
        assert_eq!(e.download.file_type, "");
    }

    #[test]
    fn what_is_stated_is_never_replaced_by_a_default() {
        let e: AppEntry = serde_json::from_str(
            r#"{"id":"x","title":"X","category":"game","price":"paid","tags":["a"],
                "description":"d","download":{"url":"https://e/x.zip","file_type":"zip"}}"#,
        )
        .unwrap();
        assert_eq!(e.category, "game");
        assert_eq!(e.price, "paid");
        assert_eq!(e.tags, vec!["a".to_string()]);
    }

    #[test]
    fn an_entry_with_no_id_is_still_refused() {
        // The defaults are for what an author may omit, not for what makes an entry an
        // entry. Something with no id cannot be installed, favourited or deduplicated.
        assert!(serde_json::from_str::<AppEntry>(
            r#"{"title":"X","download":{"url":"https://e/x.zip","file_type":"zip"}}"#
        )
        .is_err());
    }
}
