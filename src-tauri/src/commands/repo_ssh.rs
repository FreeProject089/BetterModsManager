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

/// Where to publish, and as whom. No secret material — `key_path` points at a file, and the
/// password (when that is the method) is passed per call and never lands in this struct.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub user: String,
    /// OpenSSH or PuTTY `.ppk` — russh reads both, which matters because Windows users
    /// generally have a .ppk and converting it is a step that goes wrong.
    ///
    /// Empty when `auth` is "password".
    #[serde(default)]
    pub key_path: String,
    /// Absolute path on the server. The repo's contents land INSIDE it.
    pub remote_dir: String,
    /// "key" (default) or "password".
    ///
    /// A password is what most people actually have. Requiring a key first meant generating
    /// one, converting it, and getting it into authorized_keys before anything could be
    /// tested at all — three steps that each fail quietly, before the feature had proved it
    /// worked even once. Both methods are offered; neither secret is ever stored.
    #[serde(default)]
    pub auth: Option<String>,
}

impl SshTarget {
    fn port_or_default(&self) -> u16 {
        self.port.unwrap_or(22)
    }
    fn uses_password(&self) -> bool {
        self.auth.as_deref() == Some("password")
    }
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
    /// "up" or "down". One event name for both directions, because the panel shows one bar
    /// and only ever runs one transfer at a time — a second event name would mean two
    /// listeners that must agree on which is active.
    pub direction: &'static str,
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
///
/// `secret` is the key passphrase, or the account password when `target.auth` is "password".
/// One parameter for both because it is the same thing from the caller's side: the one piece
/// of information that must not be stored, read at the moment of use.
async fn connect(
    target: &SshTarget,
    secret: Option<&str>,
    expected_fp: Option<String>,
) -> Result<(client::Handle<KnownHostClient>, String), String> {
    // Read the key BEFORE opening the socket, so a bad path or a missing passphrase fails
    // immediately instead of after a connection the server then has to time out.
    let key = if target.uses_password() {
        None
    } else {
        Some(read_key(&target.key_path, secret)?)
    };
    let seen = Arc::new(std::sync::Mutex::new(None));
    let handler = KnownHostClient {
        expected: expected_fp.clone(),
        seen: seen.clone(),
    };

    let config = Arc::new(client::Config::default());
    let addr = (target.host.as_str(), target.port_or_default());
    let read_seen = || seen.lock().ok().and_then(|g| g.clone()).unwrap_or_default();

    let mut session = match client::connect(config, addr, handler).await {
        Ok(s) => s,
        Err(e) => {
            // A CHANGED HOST KEY ARRIVES HERE, not after the call.
            //
            // check_server_key answers false on a mismatch, and russh aborts the handshake
            // on the spot — so `connect` returns Err and the comparison that used to sit
            // below it could never run. It was dead code, and the effect was that the one
            // message this whole mechanism exists to show ("the server's fingerprint
            // changed") was replaced by a generic "connection failed: Unknown server key".
            //
            // That is the worst possible substitution: a man-in-the-middle reads as a server
            // being down, and the natural next step is to clear the saved fingerprint to
            // "fix" it. Found by running against a real server; nothing in the types or the
            // compiler could have shown it.
            let fp = read_seen();
            if expected_fp.is_some() && !fp.is_empty() && expected_fp.as_deref() != Some(fp.as_str()) {
                return Err(format!("repo.ssh.errHostKeyChanged|{}", fp));
            }
            return Err(format!("repo.ssh.errConnect|{}|{}", target.host, e));
        }
    };

    let fp = read_seen();
    // Second line of defence. The handler above should already have refused a mismatch, but
    // this costs nothing and does not depend on russh continuing to abort on a false answer.
    if expected_fp.is_some() && expected_fp != Some(fp.clone()) {
        return Err(format!("repo.ssh.errHostKeyChanged|{}", fp));
    }

    let auth = match key {
        Some(k) => session
            .authenticate_publickey(
                target.user.clone(),
                PrivateKeyWithHashAlg::new(Arc::new(k), None),
            )
            .await
            .map_err(|e| format!("repo.ssh.errAuth|{}", e))?,
        None => session
            .authenticate_password(target.user.clone(), secret.unwrap_or_default())
            .await
            .map_err(|e| format!("repo.ssh.errAuth|{}", e))?,
    };
    if !auth.success() {
        // The server said no. With a key that almost always means the public key is not in
        // authorized_keys, or is there in PuTTY's SSH2 format, which OpenSSH cannot read.
        // With a password it can also mean the server refuses password auth outright
        // (`PasswordAuthentication no`), which is common on hardened hosts and reads
        // identically to a wrong password — hence the separate hint in the message.
        return Err(if target.uses_password() {
            "repo.ssh.errAuthRejectedPassword".to_string()
        } else {
            "repo.ssh.errAuthRejected".to_string()
        });
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
    secret: Option<String>,
) -> Result<SshTestResult, String> {
    let expected = known_host(&state, &target.host, target.port_or_default());
    let (session, fingerprint) = connect(&target, secret.as_deref(), expected).await?;
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

    remember_host(&state, &target.host, target.port_or_default(), &fingerprint);
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
    secret: Option<String>,
    local_dir: String,
) -> Result<u64, String> {
    let root = PathBuf::from(&local_dir);
    if !root.is_dir() {
        return Err(format!("repo.ssh.errLocalDir|{}", local_dir));
    }
    let mut files = walk(&root)?;
    // repo.json to the end (see the doc comment above).
    files.sort_by_key(|(_, rel)| rel.file_name().map(|n| n == "repo.json").unwrap_or(false));

    let expected = known_host(&state, &target.host, target.port_or_default());
    let (session, fingerprint) = connect(&target, secret.as_deref(), expected).await?;
    remember_host(&state, &target.host, target.port_or_default(), &fingerprint);
    let sftp = open_sftp(&session).await?;

    let base = target.remote_dir.trim_end_matches('/').to_string();
    upload_tree(&sftp, &base, &files, |p| {
        let _ = window.emit("repo-ssh-progress", p);
    })
    .await
}

/// Send every file in `files` (absolute path, path relative to the export root) into `base`.
///
/// Separate from the command so it can be tested: the command's signature takes a `Window`
/// and a `State`, neither of which a test can construct. Everything worth getting wrong is
/// in here.
async fn upload_tree<F: FnMut(SshProgress)>(
    sftp: &SftpSession,
    base: &str,
    files: &[(PathBuf, PathBuf)],
    mut on_progress: F,
) -> Result<u64, String> {
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
            let mut acc = base.to_string();
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
        on_progress(SshProgress {
            done: i as u64 + 1,
            total,
            bytes,
            current: rel_str,
            direction: "up",
        });
    }
    Ok(bytes)
}

// ── browsing, and syncing back down ──────────────────────────────────────────

/// One entry in a remote directory listing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// List a remote directory.
///
/// This exists so the remote folder can be CHOSEN rather than typed. An absolute path typed
/// from memory is the single most common way this feature failed for people: `/var/www/repo`
/// when the account lands in `/home/you`, a trailing slash, a capital letter on a
/// case-sensitive filesystem. The connection test then reports "not writable" and there is
/// nothing on screen to say the path simply does not exist.
#[tauri::command]
pub async fn ssh_list_dir(
    state: State<'_, AppState>,
    target: SshTarget,
    secret: Option<String>,
    path: Option<String>,
) -> Result<Vec<RemoteEntry>, String> {
    let expected = known_host(&state, &target.host, target.port_or_default());
    let (session, fingerprint) = connect(&target, secret.as_deref(), expected).await?;
    remember_host(&state, &target.host, target.port_or_default(), &fingerprint);
    let sftp = open_sftp(&session).await?;

    // No path given means "wherever this account starts", which is the useful default and
    // saves the user knowing their own home directory's absolute path.
    let dir = match path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => p.to_string(),
        None => sftp.canonicalize(".").await.unwrap_or_else(|_| "/".to_string()),
    };

    let mut out: Vec<RemoteEntry> = sftp
        .read_dir(&dir)
        .await
        .map_err(|e| format!("repo.ssh.errListDir|{}|{}", dir, e))?
        .map(|e| RemoteEntry {
            name: e.file_name(),
            is_dir: e.file_type().is_dir(),
            size: e.metadata().size.unwrap_or(0),
        })
        .collect();
    // Directories first, then names — the order a file manager uses, so the folder you are
    // looking for is never buried under a hundred files.
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Resolve a remote path the way the server sees it (expands `.`, `~` is NOT expanded by
/// SFTP, so it is rejected earlier). Used by the picker to show where "Home" actually is.
#[tauri::command]
pub async fn ssh_resolve_path(
    state: State<'_, AppState>,
    target: SshTarget,
    secret: Option<String>,
    path: String,
) -> Result<String, String> {
    let expected = known_host(&state, &target.host, target.port_or_default());
    let (session, fingerprint) = connect(&target, secret.as_deref(), expected).await?;
    remember_host(&state, &target.host, target.port_or_default(), &fingerprint);
    let sftp = open_sftp(&session).await?;
    sftp.canonicalize(&path)
        .await
        .map_err(|e| format!("repo.ssh.errListDir|{}|{}", path, e))
}

/// Every FILE under a remote directory, depth-first, with its path relative to the root.
///
/// Recursion is written as an explicit stack rather than an async recursive fn: an async fn
/// that awaits itself needs boxing, and the boxed future here would allocate once per
/// directory for no gain.
async fn walk_remote(sftp: &SftpSession, root: &str) -> Result<Vec<(String, u64)>, String> {
    let mut out = Vec::new();
    let mut stack = vec![String::new()]; // relative paths, "" is the root itself
    while let Some(rel) = stack.pop() {
        let abs = if rel.is_empty() {
            root.to_string()
        } else {
            format!("{}/{}", root, rel)
        };
        let entries = sftp
            .read_dir(&abs)
            .await
            .map_err(|e| format!("repo.ssh.errListDir|{}|{}", abs, e))?;
        for e in entries {
            let name = e.file_name();
            let child = if rel.is_empty() { name.clone() } else { format!("{}/{}", rel, name) };
            if e.file_type().is_dir() {
                stack.push(child);
            } else if e.file_type().is_file() {
                // Symlinks are skipped rather than followed: a link pointing outside the repo
                // would copy arbitrary server files onto the user's disk, and one pointing at
                // its own parent never terminates.
                out.push((child, e.metadata().size.unwrap_or(0)));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

/// Pull a repo DOWN from the server into `local_dir`.
///
/// The mirror of publishing, and the half that was missing: until now BMM could push a repo
/// it had just generated, but could not fetch back the one actually being served. That is
/// what you need to edit a repo from a second machine, to recover after losing the local
/// copy, or simply to check that what is online is what you think it is.
///
/// Existing local files are overwritten; local files with no remote counterpart are LEFT
/// ALONE. Deleting them would make "sync down" capable of destroying an unrelated folder
/// somebody pointed it at by accident.
#[tauri::command]
pub async fn ssh_download_repo(
    window: Window,
    state: State<'_, AppState>,
    target: SshTarget,
    secret: Option<String>,
    local_dir: String,
) -> Result<u64, String> {
    let root = PathBuf::from(&local_dir);
    std::fs::create_dir_all(&root).map_err(|e| format!("repo.ssh.errLocalDir|{}|{}", local_dir, e))?;

    let expected = known_host(&state, &target.host, target.port_or_default());
    let (session, fingerprint) = connect(&target, secret.as_deref(), expected).await?;
    remember_host(&state, &target.host, target.port_or_default(), &fingerprint);
    let sftp = open_sftp(&session).await?;

    let base = target.remote_dir.trim_end_matches('/').to_string();
    if sftp.metadata(&base).await.is_err() {
        return Err(format!("repo.ssh.errRemoteMissing|{}", base));
    }
    download_tree(&sftp, &base, &root, |p| {
        let _ = window.emit("repo-ssh-progress", p);
    })
    .await
}

/// Copy every file under the remote `base` into the local `root`.
///
/// Separate from the command for the same reason as upload_tree, and it carries the guard
/// that matters most here: safe_join.
async fn download_tree<F: FnMut(SshProgress)>(
    sftp: &SftpSession,
    base: &str,
    root: &Path,
    mut on_progress: F,
) -> Result<u64, String> {
    let files = walk_remote(sftp, base).await?;
    let total = files.len() as u64;
    let mut bytes = 0u64;

    for (i, (rel, _size)) in files.iter().enumerate() {
        // A remote name is not trusted to be a safe relative path. A server that answers
        // with `../../.ssh/authorized_keys` would otherwise write outside local_dir
        // entirely (CWE-22) — the classic zip-slip, over SFTP.
        let dest = safe_join(root, rel)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("repo.ssh.errLocalWrite|{}|{}", parent.display(), e))?;
        }

        let remote = format!("{}/{}", base, rel);
        let mut f = sftp
            .open(&remote)
            .await
            .map_err(|e| format!("repo.ssh.errOpenRemote|{}|{}", remote, e))?;
        let mut buf = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut f, &mut buf)
            .await
            .map_err(|e| format!("repo.ssh.errReadRemote|{}|{}", remote, e))?;
        std::fs::write(&dest, &buf)
            .map_err(|e| format!("repo.ssh.errLocalWrite|{}|{}", dest.display(), e))?;

        bytes += buf.len() as u64;
        on_progress(SshProgress {
            done: i as u64 + 1,
            total,
            bytes,
            current: rel.clone(),
            direction: "down",
        });
    }
    Ok(bytes)
}

/// Join a server-supplied relative path onto a local root, refusing anything that escapes.
///
/// Rejects rather than sanitises: silently rewriting `../x` to `x` would put a file the user
/// never asked for in a place they did not expect, and call it success.
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut out = root.to_path_buf();
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." || seg.contains('\\') || seg.contains(':') {
            return Err(format!("repo.ssh.errUnsafePath|{}", rel));
        }
        out.push(seg);
    }
    // Belt and braces: even with the segment checks above, the result must still sit under
    // the root. `starts_with` on components, not on the string, so `/tmp/repo-evil` does not
    // pass for root `/tmp/repo`.
    if !out.starts_with(root) {
        return Err(format!("repo.ssh.errUnsafePath|{}", rel));
    }
    Ok(out)
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

// ── tests ────────────────────────────────────────────────────────────────────
//
// Two kinds, deliberately separated.
//
// safe_join is pure and always runs: it is the CWE-22 guard, and a guard nothing exercises
// is a guard nobody knows is broken.
//
// The rest needs a real SFTP server and is OPT-IN, gated on BMM_SSH_TEST_HOST. It skips
// silently otherwise rather than failing, because a developer without Docker running is not
// a broken build — but it prints WHY it skipped, so "all green" never quietly means "nothing
// ran". Bring one up with:
//
//   docker run -d --name bmm-sftp-test -p 2222:22 atmoz/sftp:alpine 'testuser:testpass:1001::upload'
//
// then set BMM_SSH_TEST_HOST=127.0.0.1 BMM_SSH_TEST_PORT=2222 BMM_SSH_TEST_USER=testuser
// BMM_SSH_TEST_PASS=testpass BMM_SSH_TEST_DIR=/upload  (+ BMM_SSH_TEST_KEY for key auth).
//
// ON WINDOWS, run it with MSYS_NO_PATHCONV=1 if you use Git Bash. Without it, MSYS rewrites
// the POSIX-looking value of BMM_SSH_TEST_DIR into a Windows path, and the first run failed
// trying to create `C:/Program Files/Git/upload/bmm-roundtrip/...` on the server. The error
// names a path nobody typed, which is a confusing half-hour if you have not seen it before.
//
// For key auth, put the PUBLIC key in the container:
//   ssh-keygen -t ed25519 -N '' -f ./bmm_test_key
//   docker exec bmm-sftp-test sh -c "mkdir -p /home/testuser/.ssh && \
//     printf '%s\n' '<contents of bmm_test_key.pub>' > /home/testuser/.ssh/authorized_keys && \
//     chown -R testuser /home/testuser/.ssh && chmod 700 /home/testuser/.ssh && \
//     chmod 600 /home/testuser/.ssh/authorized_keys"
#[cfg(test)]
mod tests {
    use super::*;

    // ── safe_join ────────────────────────────────────────────────────────────

    #[test]
    fn safe_join_builds_ordinary_paths() {
        let root = Path::new("/tmp/repo");
        assert_eq!(safe_join(root, "repo.json").unwrap(), root.join("repo.json"));
        assert_eq!(
            safe_join(root, "mods/foo/data.pak").unwrap(),
            root.join("mods").join("foo").join("data.pak")
        );
        // Empty and "." segments are noise, not an error.
        assert_eq!(safe_join(root, "./mods//foo").unwrap(), root.join("mods").join("foo"));
    }

    #[test]
    fn safe_join_refuses_anything_that_escapes() {
        let root = Path::new("/tmp/repo");
        // The attack this exists for: a server answering with a path that climbs out.
        for evil in [
            "../evil",
            "mods/../../evil",
            "../../.ssh/authorized_keys",
            r"..\evil",              // backslash: a Windows separator the server may send
            "C:/Windows/System32",   // a drive letter is not a relative path
        ] {
            assert!(
                safe_join(root, evil).is_err(),
                "safe_join accepted an escaping path: {evil}"
            );
        }
    }

    #[test]
    fn safe_join_refuses_a_sibling_that_merely_shares_a_prefix() {
        // `starts_with` on a STRING would accept this: "/tmp/repo-evil" begins with
        // "/tmp/repo". Path::starts_with compares components, which is why it is used.
        assert!(safe_join(Path::new("/tmp/repo"), "../repo-evil/x").is_err());
    }

    // ── against a real server ────────────────────────────────────────────────

    struct Live {
        target: SshTarget,
        secret: String,
        key_path: Option<String>,
    }

    fn live() -> Option<Live> {
        let host = std::env::var("BMM_SSH_TEST_HOST").ok()?;
        Some(Live {
            target: SshTarget {
                host,
                port: std::env::var("BMM_SSH_TEST_PORT").ok().and_then(|p| p.parse().ok()),
                user: std::env::var("BMM_SSH_TEST_USER").unwrap_or_else(|_| "testuser".into()),
                key_path: String::new(),
                remote_dir: std::env::var("BMM_SSH_TEST_DIR").unwrap_or_else(|_| "/upload".into()),
                auth: Some("password".into()),
            },
            secret: std::env::var("BMM_SSH_TEST_PASS").unwrap_or_else(|_| "testpass".into()),
            key_path: std::env::var("BMM_SSH_TEST_KEY").ok(),
        })
    }

    macro_rules! skip_unless_live {
        () => {
            match live() {
                Some(l) => l,
                None => {
                    eprintln!("SKIPPED: set BMM_SSH_TEST_HOST to run this against a real server");
                    return;
                }
            }
        };
    }

    #[tokio::test]
    async fn password_auth_connects_and_opens_sftp() {
        let l = skip_unless_live!();
        let (session, fp) = connect(&l.target, Some(&l.secret), None)
            .await
            .expect("password auth should succeed");
        assert!(!fp.is_empty(), "the handshake must yield a fingerprint");
        open_sftp(&session).await.expect("sftp subsystem should open");
    }

    #[tokio::test]
    async fn a_wrong_password_is_rejected_with_its_own_code() {
        let l = skip_unless_live!();
        // `expect_err` would need the Ok type to be Debug, and russh's Handle is not.
        let err = match connect(&l.target, Some("definitely-not-the-password"), None).await {
            Ok(_) => panic!("a wrong password must not authenticate"),
            Err(e) => e,
        };
        // Its own code, because a server with `PasswordAuthentication no` fails identically
        // and the message has to be able to say so.
        assert_eq!(err, "repo.ssh.errAuthRejectedPassword", "got: {err}");
    }

    #[tokio::test]
    async fn a_changed_host_key_is_refused() {
        let l = skip_unless_live!();
        let err = match connect(&l.target, Some(&l.secret), Some("SHA256:not-this-servers-key".into())).await {
            Ok(_) => panic!("a mismatched fingerprint must abort the handshake"),
            Err(e) => e,
        };
        assert!(
            err.starts_with("repo.ssh.errHostKeyChanged|"),
            "expected a host-key error, got: {err}"
        );
    }

    #[tokio::test]
    async fn key_auth_connects() {
        let l = skip_unless_live!();
        let Some(key) = l.key_path.clone() else {
            eprintln!("SKIPPED: set BMM_SSH_TEST_KEY to exercise key auth");
            return;
        };
        let target = SshTarget { key_path: key, auth: Some("key".into()), ..l.target.clone() };
        let (session, _fp) = connect(&target, None, None).await.expect("key auth should succeed");
        open_sftp(&session).await.expect("sftp subsystem should open");
    }

    /// Upload a nested tree, list it back, download it, and compare the bytes.
    ///
    /// This is the test the feature actually needed: every path bug lives between a local
    /// tree and a remote one, and none of them is visible to the compiler.
    #[tokio::test]
    async fn round_trip_preserves_the_tree_and_its_bytes() {
        let l = skip_unless_live!();
        let (session, _fp) = connect(&l.target, Some(&l.secret), None).await.expect("connect");
        let sftp = open_sftp(&session).await.expect("sftp");

        let base = format!("{}/bmm-roundtrip", l.target.remote_dir.trim_end_matches('/'));
        let _ = sftp.create_dir(&base).await; // may already exist from a previous run

        // A local tree with a nested directory, because a flat one would never catch the
        // backslash bug: on Windows `rel` arrives as `mods\a\file.bin`.
        let src = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(src.path().join("mods").join("alpha")).unwrap();
        std::fs::write(src.path().join("repo.json"), b"{\"version\":1}").unwrap();
        std::fs::write(src.path().join("mods").join("alpha").join("data.bin"), vec![7u8; 5000]).unwrap();
        std::fs::write(src.path().join("mods").join("readme.txt"), b"hello").unwrap();

        let mut files = walk(src.path()).expect("walk");
        files.sort_by_key(|(_, rel)| rel.file_name().map(|n| n == "repo.json").unwrap_or(false));
        // The manifest goes last: subscribers read it and then fetch what it lists.
        assert_eq!(
            files.last().unwrap().1.file_name().unwrap(),
            "repo.json",
            "repo.json must be ordered last"
        );

        let mut seen_up = Vec::new();
        let sent = upload_tree(&sftp, &base, &files, |p| seen_up.push(p.current.clone()))
            .await
            .expect("upload");
        assert_eq!(sent, 13 + 5000 + 5, "uploaded byte count");
        assert_eq!(seen_up.len(), 3, "one progress event per file");
        // Progress reports forward slashes even though Windows produced backslashes.
        assert!(
            seen_up.iter().all(|p| !p.contains('\\')),
            "a remote path must never contain a backslash: {seen_up:?}"
        );

        // The server's own view of what arrived.
        let mut remote = walk_remote(&sftp, &base).await.expect("walk_remote");
        remote.sort();
        let names: Vec<&str> = remote.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(
            names,
            vec!["mods/alpha/data.bin", "mods/readme.txt", "repo.json"],
            "the nested directory must exist on the server as directories, not as one file"
        );

        // And back down.
        let dst = tempfile::tempdir().expect("tempdir");
        let mut seen_down = Vec::new();
        let got = download_tree(&sftp, &base, dst.path(), |p| seen_down.push(p.direction))
            .await
            .expect("download");
        assert_eq!(got, sent, "the same number of bytes must come back");
        assert!(seen_down.iter().all(|d| *d == "down"), "direction must be reported as down");

        for (rel, _) in &remote {
            let a = std::fs::read(safe_join(src.path(), rel).unwrap()).unwrap();
            let b = std::fs::read(safe_join(dst.path(), rel).unwrap()).unwrap();
            assert_eq!(a, b, "bytes differ after the round trip for {rel}");
        }
    }

    #[tokio::test]
    async fn listing_reports_directories_before_files() {
        let l = skip_unless_live!();
        let (session, _fp) = connect(&l.target, Some(&l.secret), None).await.expect("connect");
        let sftp = open_sftp(&session).await.expect("sftp");
        let base = format!("{}/bmm-roundtrip", l.target.remote_dir.trim_end_matches('/'));
        let _ = sftp.create_dir(&base).await;

        // Mirrors what ssh_list_dir does, minus the Tauri state it needs for known-hosts.
        let mut entries: Vec<RemoteEntry> = sftp
            .read_dir(&base)
            .await
            .expect("read_dir")
            .map(|e| RemoteEntry {
                name: e.file_name(),
                is_dir: e.file_type().is_dir(),
                size: e.metadata().size.unwrap_or(0),
            })
            .collect();
        entries.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        if entries.len() >= 2 {
            let first_file = entries.iter().position(|e| !e.is_dir);
            let last_dir = entries.iter().rposition(|e| e.is_dir);
            if let (Some(f), Some(d)) = (first_file, last_dir) {
                assert!(d < f, "every directory must sort before every file");
            }
        }
    }
}
