//! Server credentials for maintaining a remote repo.
//!
//! # Why nothing is written to disk
//!
//! The obvious move was to reuse the store that already holds the signing key: a hex value
//! plus a machine-bound seal. But that seal is a SHA-256 tamper check, **not encryption** —
//! it proves the value was not edited and not copied from another machine, while the value
//! itself sits in the file in the clear.
//!
//! That is defensible for the signing seed, which is regenerable and never leaves the
//! machine. It is not defensible for a server password, which is reusable, often shared with
//! other services, and valuable to anyone who reads the file.
//!
//! So credentials live in memory for the session and are gone when BMM exits. Persisting
//! them needs a real secret store — the OS keychain — which is a dependency and a decision,
//! not something to slip in behind a hash.
//!
//! # Why plain FTP is refused by default
//!
//! FTP sends the password in clear text on the wire. Someone who wanted their repo private
//! enough to put a password on it is not served by handing that password to the network.
//! `Transport::Ftp` is therefore opt-in per connection and carries a warning the UI must
//! show, rather than being the silent default it would naturally become.

use std::collections::HashMap;
use std::sync::Mutex;

use lazy_static::lazy_static;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    /// SFTP over SSH. The default, and the only one that protects the password.
    Sftp,
    /// FTP over TLS.
    Ftps,
    /// Plain FTP — credentials travel in clear text.
    Ftp,
}

impl Transport {
    /// True when the password crosses the network readable by anyone on the path.
    pub fn is_cleartext(self) -> bool {
        matches!(self, Transport::Ftp)
    }

    pub fn default_port(self) -> u16 {
        match self {
            Transport::Sftp => 22,
            Transport::Ftps | Transport::Ftp => 21,
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCredentials {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: String,
    pub transport: Transport,
    /// Directory on the server holding the mods, e.g. `/var/www/files/mods`.
    pub remote_dir: String,
}

/// What a caller may see about a stored credential. Deliberately has no password field —
/// a struct that can carry one is a struct that eventually gets logged or serialised into
/// a response.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInfo {
    pub repo_key: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub transport: Transport,
    pub remote_dir: String,
    /// True when this connection sends its password in clear text.
    pub cleartext_warning: bool,
}

lazy_static! {
    /// Keyed by repo URL. Session-only: never read from or written to disk.
    static ref CREDS: Mutex<HashMap<String, RepoCredentials>> = Mutex::new(HashMap::new());
}

pub fn info_of(repo_key: &str, c: &RepoCredentials) -> CredentialInfo {
    CredentialInfo {
        repo_key: repo_key.to_string(),
        host: c.host.clone(),
        port: c.port.unwrap_or_else(|| c.transport.default_port()),
        username: c.username.clone(),
        transport: c.transport,
        remote_dir: c.remote_dir.clone(),
        cleartext_warning: c.transport.is_cleartext(),
    }
}

fn validate(c: &RepoCredentials) -> Result<(), String> {
    if c.host.trim().is_empty() {
        return Err("Host is required".into());
    }
    if c.username.trim().is_empty() {
        return Err("Username is required".into());
    }
    // A path traversal in the remote dir would let a mistyped or hostile value walk out of
    // the intended directory on the *server*, where BMM has write access via these very
    // credentials — the one place an upload should never wander.
    if c.remote_dir.split(['/', '\\']).any(|seg| seg == "..") {
        return Err("Remote directory must not contain '..'".into());
    }
    Ok(())
}

/// Store credentials for this session. Returns what is safe to show back.
#[tauri::command]
pub fn set_repo_credentials(
    repo_key: String,
    creds: RepoCredentials,
) -> Result<CredentialInfo, String> {
    validate(&creds)?;
    let info = info_of(&repo_key, &creds);
    let mut map = CREDS.lock().unwrap_or_else(|p| p.into_inner());
    map.insert(repo_key, creds);
    Ok(info)
}

#[tauri::command]
pub fn forget_repo_credentials(repo_key: String) -> bool {
    let mut map = CREDS.lock().unwrap_or_else(|p| p.into_inner());
    map.remove(&repo_key).is_some()
}

/// Everything held this session, passwords excluded by construction.
#[tauri::command]
pub fn list_repo_credentials() -> Vec<CredentialInfo> {
    let map = CREDS.lock().unwrap_or_else(|p| p.into_inner());
    let mut out: Vec<_> = map.iter().map(|(k, c)| info_of(k, c)).collect();
    out.sort_by(|a, b| a.repo_key.cmp(&b.repo_key));
    out
}

pub(crate) fn get(repo_key: &str) -> Option<RepoCredentials> {
    let map = CREDS.lock().unwrap_or_else(|p| p.into_inner());
    map.get(repo_key).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creds(transport: Transport, dir: &str) -> RepoCredentials {
        RepoCredentials {
            host: "files.example".into(),
            port: None,
            username: "me".into(),
            password: "hunter2".into(),
            transport,
            remote_dir: dir.into(),
        }
    }

    #[test]
    fn what_a_caller_can_see_never_includes_the_password() {
        let info = info_of("repo-1", &creds(Transport::Sftp, "/srv/mods"));
        // Serialised because that is the path a password would actually escape by.
        let json = serde_json::to_string(&info).unwrap();
        assert!(!json.contains("hunter2"), "password leaked into the response: {json}");
        assert!(json.contains("files.example"));
    }

    #[test]
    fn a_cleartext_transport_is_flagged_so_the_ui_can_say_so() {
        assert!(info_of("r", &creds(Transport::Ftp, "/srv")).cleartext_warning);
        for safe in [Transport::Sftp, Transport::Ftps] {
            assert!(!info_of("r", &creds(safe, "/srv")).cleartext_warning, "{safe:?}");
        }
    }

    #[test]
    fn the_default_port_follows_the_transport() {
        assert_eq!(info_of("r", &creds(Transport::Sftp, "/srv")).port, 22);
        assert_eq!(info_of("r", &creds(Transport::Ftps, "/srv")).port, 21);
        let mut c = creds(Transport::Sftp, "/srv");
        c.port = Some(2222);
        assert_eq!(info_of("r", &c).port, 2222);
    }

    #[test]
    fn a_traversal_in_the_remote_directory_is_refused() {
        // These credentials carry write access to the server, so a wandering path is an
        // upload landing somewhere it was never meant to.
        for bad in ["/srv/../etc", "..", "mods/../../root", r"mods\..\..\x"] {
            assert!(validate(&creds(Transport::Sftp, bad)).is_err(), "{bad:?} should be refused");
        }
        for ok in ["/srv/mods", "mods", "/var/www/files/mods", "a..b/mods"] {
            assert!(validate(&creds(Transport::Sftp, ok)).is_ok(), "{ok:?} should be allowed");
        }
    }

    #[test]
    fn an_incomplete_credential_is_refused_before_it_reaches_a_socket() {
        let mut c = creds(Transport::Sftp, "/srv");
        c.host = "   ".into();
        assert!(validate(&c).is_err());
        let mut c = creds(Transport::Sftp, "/srv");
        c.username = String::new();
        assert!(validate(&c).is_err());
    }
}
