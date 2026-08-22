//! Publish a generated Server Repo to a remote machine over SSH/SFTP.
//!
//! WHY THIS EXISTS
//!
//! `export_server_repo` writes a folder. Getting that folder onto the machine that serves it
//! was, until now, someone else's problem — WinSCP, FileZilla, a USB stick. That is the step
//! people get wrong: a half-finished upload leaves subscribers with a manifest that promises
//! files nobody can download, and nothing in BMM knows it happened.
//!
//! WHAT IT DOES NOT DO
//!
//! It never stores a private key, and it never stores a passphrase. The settings hold a
//! PATH; the bytes are read at the moment of use and dropped. A key copied into BMM's
//! config would be a key in every backup, every export, and every crash report that
//! attaches settings — and the whole point of a key is that it lives in one place you chose.
//!
//! HOST KEY VERIFICATION
//!
//! First connection records the server's fingerprint; every later connection must match it.
//! Trust-on-first-use is weaker than knowing the fingerprint in advance, and stronger than
//! the alternative that was available here, which is nothing at all. A CHANGED fingerprint
//! is refused outright rather than warned about: the case it protects against is exactly
//! the one where a warning gets clicked through.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use russh::client::{self, Handler};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State, Window};
use tokio::io::AsyncWriteExt;

use crate::state::AppState;

/// Where to publish, and as whom. No secret material — `key_path` points at a file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub user: String,
    /// OpenSSH or PuTTY `.ppk` — russh reads both, which matters because Windows users
    /// generally have a .ppk and converting it is a step that goes wrong.
    pub key_path: String,
    /// Absolute path on the server. The repo's contents land INSIDE it.
    pub remote_dir: String,
}

/// Progress, one event per file plus a final summary. The frontend shows a bar; the
/// scheduler writes it to its run log.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProgress {
    pub done: u64,
    pub total: u64,
    pub bytes: u64,
    pub current: String,
}

struct KnownHostClient {
    /// The fingerprint we already trust, if this host has been seen before.
    expected: Option<String>,
    /// Filled in by the handshake so the caller can persist it on first use.
    seen: Arc<std::sync::Mutex<Option<String>>>,
}

impl Handler for KnownHostClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fp = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => {
                key.fingerprint(Default::default()).to_string()
            }
            PublicKeyOrCertificate::Certificate(c) => {
                c.public_key().fingerprint(Default::default()).to_string()
            }
        };
        if let Ok(mut g) = self.seen.lock() {
            *g = Some(fp.clone());
        }
        match &self.expected {
            // Trust on first use: nothing to compare against yet.
            None => Ok(true),
            // A host that changed its key is refused, not warned about. Answering "no" here
            // aborts the handshake before a single byte of the repo is offered to it.
            Some(known) => Ok(known == &fp),
        }
    }
}

fn read_key(path: &str, passphrase: Option<&str>) -> Result<russh::keys::PrivateKey, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("repo.ssh.errKeyRead|{}|{}", path, e))?;
    decode_secret_key(&text, passphrase).map_err(|e| {
        // An encrypted key with no passphrase is the common case and deserves its own
        // message: "invalid key" sends people looking for a corrupt file.
        let s = e.to_string();
        if passphrase.is_none() && s.to_lowercase().contains("passphrase") {
            "repo.ssh.errKeyPassphrase".to_string()
        } else {
            format!("repo.ssh.errKeyDecode|{}", s)
        }
    })
}

/// Connect + authenticate, returning the session and the server fingerprint.
async fn connect(
    target: &SshTarget,
    passphrase: Option<&str>,
    expected_fp: Option<String>,
) -> Result<(client::Handle<KnownHostClient>, String), String> {
    let key = read_key(&target.key_path, passphrase)?;
    let seen = Arc::new(std::sync::Mutex::new(None));
    let handler = KnownHostClient {
        expected: expected_fp.clone(),
        seen: seen.clone(),
    };

    let config = Arc::new(client::Config::default());
    let addr = (target.host.as_str(), target.port.unwrap_or(22));
    let mut session = client::connect(config, addr, handler)
        .await
        .map_err(|e| format!("repo.ssh.errConnect|{}|{}", target.host, e))?;

    let fp = seen
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_default();
    if expected_fp.is_some() && expected_fp != Some(fp.clone()) {
        return Err(format!("repo.ssh.errHostKeyChanged|{}", fp));
    }

    let auth = session
        .authenticate_publickey(
            target.user.clone(),
            PrivateKeyWithHashAlg::new(Arc::new(key), None),
        )
        .await
        .map_err(|e| format!("repo.ssh.errAuth|{}", e))?;
    if !auth.success() {
        // The server said no. Almost always the public key is not in authorized_keys, or is
        // there in PuTTY's SSH2 format, which OpenSSH cannot read.
        return Err("repo.ssh.errAuthRejected".to_string());
    }
    Ok((session, fp))
}

async fn open_sftp(session: &client::Handle<KnownHostClient>) -> Result<SftpSession, String> {
    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("repo.ssh.errChannel|{}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("repo.ssh.errSubsystem|{}", e))?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("repo.ssh.errSftp|{}", e))
}

/// The result of a connection test: enough to tell the user what BMM found, without
/// uploading anything.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTestResult {
    pub fingerprint: String,
    /// True when the remote directory exists and is a directory.
    pub remote_dir_exists: bool,
    /// True when a probe file could be written and removed there.
    pub writable: bool,
    pub entries: usize,
}

/// Try everything an upload needs, and change nothing.
///
/// A key that authenticates but lands in a directory it cannot write is the failure worth
/// catching, because the upload version of it fails after transferring gigabytes.
#[tauri::command]
pub async fn ssh_test_connection(
    state: State<'_, AppState>,
    target: SshTarget,
    passphrase: Option<String>,
) -> Result<SshTestResult, String> {
    let expected = known_host(&state, &target.host, target.port.unwrap_or(22));
    let (session, fingerprint) = connect(&target, passphrase.as_deref(), expected).await?;
    let sftp = open_sftp(&session).await?;

    let entries = sftp
        .read_dir(&target.remote_dir)
        .await
        .map(|d| d.count())
        .unwrap_or(0);
    let remote_dir_exists = sftp.metadata(&target.remote_dir).await.is_ok();

    // Write-and-remove, because "the directory exists" and "I may write into it" are
    // different questions and only the second one matters.
    let probe = format!("{}/.bmm-write-probe", target.remote_dir.trim_end_matches('/'));
    let writable = match sftp.create(&probe).await {
        Ok(mut f) => {
            let ok = f.write_all(b"bmm").await.is_ok();
            let _ = f.shutdown().await;
            let _ = sftp.remove_file(&probe).await;
            ok
        }
        Err(_) => false,
    };

    remember_host(&state, &target.host, target.port.unwrap_or(22), &fingerprint);
    Ok(SshTestResult {
        fingerprint,
        remote_dir_exists,
        writable,
        entries,
    })
}

/// Every file under `root`, depth-first, with its path relative to `root`.
fn walk(root: &Path) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = std::fs::read_dir(&dir).map_err(|e| format!("repo.ssh.errRead|{}", e))?;
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                let rel = p
                    .strip_prefix(root)
                    .map_err(|_| "repo.ssh.errRelPath".to_string())?
                    .to_path_buf();
                out.push((p, rel));
            }
        }
    }
    // Deterministic order: a resumed or repeated upload should behave the same way twice,
    // and read_dir order is not guaranteed.
    out.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(out)
}

/// Upload a generated repo folder to `target.remote_dir`.
///
/// The manifest is sent LAST, deliberately. A subscriber reads repo.json first and then
/// fetches what it lists; if the manifest arrives before the files it names, every client
/// syncing during the upload window gets 404s for files that are about to exist. Sending it
/// last means the repo is either the old one or the new one, never half of the new one.
#[tauri::command]
pub async fn ssh_upload_repo(
    window: Window,
    state: State<'_, AppState>,
    target: SshTarget,
    passphrase: Option<String>,
    local_dir: String,
) -> Result<u64, String> {
    let root = PathBuf::from(&local_dir);
    if !root.is_dir() {
        return Err(format!("repo.ssh.errLocalDir|{}", local_dir));
    }
    let mut files = walk(&root)?;
    // repo.json to the end (see the doc comment above).
    files.sort_by_key(|(_, rel)| rel.file_name().map(|n| n == "repo.json").unwrap_or(false));

    let expected = known_host(&state, &target.host, target.port.unwrap_or(22));
    let (session, fingerprint) = connect(&target, passphrase.as_deref(), expected).await?;
    remember_host(&state, &target.host, target.port.unwrap_or(22), &fingerprint);
    let sftp = open_sftp(&session).await?;

    let base = target.remote_dir.trim_end_matches('/').to_string();
    let total = files.len() as u64;
    let mut bytes = 0u64;
    let mut made: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (i, (abs, rel)) in files.iter().enumerate() {
        // Remote paths are ALWAYS '/'-separated. rel comes from the host filesystem, so on
        // Windows it arrives with backslashes and would create one file literally named
        // "mods\a\b.zip" instead of three directories.
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let remote = format!("{}/{}", base, rel_str);

        if let Some(parent) = rel_str.rfind('/').map(|i| &rel_str[..i]) {
            let mut acc = base.clone();
            for seg in parent.split('/') {
                acc.push('/');
                acc.push_str(seg);
                if made.insert(acc.clone()) {
                    // Already-exists is not an error: the target may hold a previous export.
                    let _ = sftp.create_dir(&acc).await;
                }
            }
        }

        let data = std::fs::read(abs).map_err(|e| format!("repo.ssh.errRead|{}", e))?;
        let mut f = sftp
            .create(&remote)
            .await
            .map_err(|e| format!("repo.ssh.errCreate|{}|{}", remote, e))?;
        f.write_all(&data)
            .await
            .map_err(|e| format!("repo.ssh.errWrite|{}|{}", remote, e))?;
        f.shutdown()
            .await
            .map_err(|e| format!("repo.ssh.errClose|{}|{}", remote, e))?;

        bytes += data.len() as u64;
        let _ = window.emit(
            "repo-ssh-progress",
            SshProgress {
                done: i as u64 + 1,
                total,
                bytes,
                current: rel_str,
            },
        );
    }
    Ok(bytes)
}

// ── known hosts ──────────────────────────────────────────────────────────────
//
// Stored in AppState settings as "host:port" -> fingerprint. Small, and it belongs with the
// rest of the app's configuration rather than in a file format of its own.

fn host_key(host: &str, port: u16) -> String {
    format!("{}:{}", host.to_lowercase(), port)
}

fn known_host(state: &State<'_, AppState>, host: &str, port: u16) -> Option<String> {
    let data = state.data.lock().ok()?;
    data.settings
        .ssh_known_hosts
        .as_ref()?
        .get(&host_key(host, port))
        .cloned()
}

fn remember_host(state: &State<'_, AppState>, host: &str, port: u16, fingerprint: &str) {
    if fingerprint.is_empty() {
        return;
    }
    if let Ok(mut data) = state.data.lock() {
        data.settings
            .ssh_known_hosts
            .get_or_insert_with(Default::default)
            .insert(host_key(host, port), fingerprint.to_string());
    }
    let _ = state.save();
}

/// Forget a host's fingerprint, so the next connection trusts whatever answers.
///
/// The escape hatch for a server that was legitimately rebuilt. It is a deliberate action
/// with a name, not a checkbox on the error — being asked to do something specific after a
/// refusal is the point.
#[tauri::command]
pub fn ssh_forget_host(state: State<'_, AppState>, host: String, port: Option<u16>) -> Result<(), String> {
    if let Ok(mut data) = state.data.lock() {
        if let Some(map) = data.settings.ssh_known_hosts.as_mut() {
            map.remove(&host_key(&host, port.unwrap_or(22)));
        }
    }
    state.save().map_err(|e| e.to_string())
}
