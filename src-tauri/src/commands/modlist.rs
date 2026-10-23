use tauri::Emitter;
use crate::fs_utils;
use crate::models::modlist::{DownloadLink, ModFileEntry, ModList, ModListEntry};
use crate::state::AppState;
use tauri::State;
use crate::error::AppError;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

/// Lightweight snapshot of a mod's fields — collected while holding the lock,
/// then used after releasing it so the heavy file I/O never blocks AppState.
struct ModSnapshot {
    folder: PathBuf,
    name: String,
    version: String,
    author: Option<String>,
    description: Option<String>,
    download_links: Vec<DownloadLink>,
    tags: Vec<String>,
    /// Resolved to NAMES while the lock is held — an id means nothing on the machine that
    /// opens the file.
    dependencies: Vec<String>,
    update_sources: Vec<crate::models::mod_entry::UpdateSource>,
    /// Carried through so the list keeps what the mod knows about itself: who it is, and
    /// where it updates from.
    id: String,
    content_id: Option<String>,
    source_repo: Option<String>,
    repo_mod_id: Option<String>,
    update_url: Option<String>,
    install_notes: String,
}

// `CredsRequest` and `seal_credentials` used to live here. They moved to commands/creds.rs
// when the repo export needed the same block: a repository points at the same protected
// sources a list does, and two implementations of one rule about secrets is one
// implementation that will be a version behind.
pub use crate::commands::creds::{seal_credentials, CredsRequest};

/// Cancel tokens for the .mm list operations (export, install).
///
/// Both used ONE flag in AppState. A run reset it on start, so a Cancel that arrived while the
/// previous run was still unwinding was lost, or cancelled the next one; the install flag is
/// also the repo installs' flag, so cancelling a list stopped a repo sync. And a flag is only
/// seen between steps: a 4 GB copy or a single big file in an archive ran to its end after
/// Cancel. Now each run has its own token (the id the screen sent), and the governor tickets
/// doing its work are attached to it: cancelling the run cancels them, so the copy stops at
/// its next block.
pub mod runs {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

    struct Run { flag: Arc<AtomicBool>, tickets: Vec<u64> }

    fn table() -> MutexGuard<'static, HashMap<String, Run>> {
        static T: OnceLock<Mutex<HashMap<String, Run>>> = OnceLock::new();
        T.get_or_init(Default::default).lock().unwrap_or_else(|p| p.into_inner())
    }

    fn cancel_ticket(id: u64) { crate::governor::runtime::global().queue().cancel(id); }

    /// A running operation. Dropping it forgets the token.
    pub struct Guard { key: String, pub flag: Arc<AtomicBool> }
    impl Guard {
        pub fn cancelled(&self) -> bool { self.flag.load(Ordering::SeqCst) }
        /// Stop this run from inside (a ticket cancelled from the dashboard).
        pub fn cancel(&self) { cancel_key(&self.key); }
        pub fn key(&self) -> String { self.key.clone() }
    }
    impl Drop for Guard {
        fn drop(&mut self) { table().remove(&self.key); }
    }

    /// `kind` is "export" or "install"; `id` the screen's token (a fresh one when absent).
    pub fn begin(kind: &str, id: Option<String>) -> Guard {
        let id = id
            .map(|s| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(64).collect::<String>())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let key = format!("{}:{}", kind, id);
        let flag = Arc::new(AtomicBool::new(false));
        table().insert(key.clone(), Run { flag: flag.clone(), tickets: Vec::new() });
        Guard { key, flag }
    }

    /// Tie a governor ticket to a run. Already cancelled: the ticket is cancelled at once.
    pub fn attach(key: &str, ticket: u64) {
        let mut t = table();
        if let Some(r) = t.get_mut(key) {
            if r.flag.load(Ordering::SeqCst) { drop(t); cancel_ticket(ticket); return; }
            r.tickets.push(ticket);
        }
    }
    pub fn detach(key: &str, ticket: u64) {
        if let Some(r) = table().get_mut(key) { r.tickets.retain(|&x| x != ticket); }
    }

    fn cancel_key(key: &str) -> bool {
        let tickets = {
            let mut t = table();
            let Some(r) = t.get_mut(key) else { return false };
            r.flag.store(true, Ordering::SeqCst);
            std::mem::take(&mut r.tickets)
        };
        for id in tickets { cancel_ticket(id); }
        true
    }

    /// Cancel one run of `kind`, or every run of it when `id` is None (an older screen).
    /// Returns how many runs were stopped.
    pub fn cancel(kind: &str, id: Option<&str>) -> usize {
        let prefix = format!("{}:", kind);
        let keys: Vec<String> = table().keys()
            .filter(|k| k.starts_with(&prefix) && id.is_none_or(|i| k[prefix.len()..] == *i))
            .cloned().collect();
        keys.iter().filter(|k| cancel_key(k)).count()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_cancel_reaches_its_own_run_only() {
            let a = begin("export", Some("t-a".into()));
            let b = begin("export", Some("t-b".into()));
            let c = begin("install", Some("t-a".into()));
            assert_eq!(cancel("export", Some("t-a")), 1);
            assert!(a.cancelled());
            assert!(!b.cancelled(), "another export was cancelled");
            assert!(!c.cancelled(), "an install with the same id was cancelled");
        }

        #[test]
        fn no_id_cancels_every_run_of_the_kind() {
            let a = begin("install", Some("n-a".into()));
            let b = begin("install", Some("n-b".into()));
            assert!(cancel("install", None) >= 2);
            assert!(a.cancelled() && b.cancelled());
        }

        #[test]
        fn a_finished_run_is_forgotten() {
            let key = { let g = begin("export", Some("gone".into())); g.key() };
            assert!(!table().contains_key(&key));
            assert_eq!(cancel("export", Some("gone")), 0);
        }

        #[test]
        fn cancelling_the_run_cancels_its_tickets() {
            let g = begin("install", Some("tk".into()));
            let q = crate::governor::runtime::global().queue();
            let t = q.begin_unslotted(crate::governor::config::OpKind::Scan, "test");
            attach(&g.key(), t.id());
            assert!(!t.is_cancelled());
            cancel("install", Some("tk"));
            assert!(t.is_cancelled(), "the copy would have run to its end");
            // A ticket attached after the cancel is cancelled on arrival.
            let t2 = q.begin_unslotted(crate::governor::config::OpKind::Scan, "test2");
            attach(&g.key(), t2.id());
            assert!(t2.is_cancelled());
        }
    }
}

#[tauri::command]
pub async fn export_modlist(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    handle: tauri::AppHandle,
    list_name: String,
    description: String,
    author: String,
    output_path: String,
    include_hashes: bool,
    // The screen's cancel token (runs above). None from older callers: the shared flag only.
    run_id: Option<String>,
    // Credentials for the protected sources this list names — see seal_credentials.
    creds: Option<CredsRequest>,
) -> Result<(), AppError> {
    // ── Phase 1: hold lock only long enough to read in-memory state ──────────
    let (game_name, game_path_hint, snapshots, tag_defs, packs, load_order) = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;

        let active_profile = if let Some(ref id) = data.active_profile_id {
            data.profiles.iter().find(|p| &p.id == id)
        } else {
            None
        };

        let (game_name, game_path_hint, mods_path) = match active_profile {
            Some(p) => (p.game_name.clone(), p.game_path.to_string_lossy().to_string(), Some(p.mods_path.clone())),
            None => (String::new(), String::new(), None),
        };

        let snapshots: Vec<ModSnapshot> = data.mods.iter().enumerate().filter_map(|(_i, m)| {
            if let Some(ref mp) = mods_path {
                if !m.mod_folder_path.starts_with(mp) {
                    return None;
                }
            }
            Some(ModSnapshot {
                folder: m.mod_folder_path.clone(),
                name: m.name.clone(),
                version: m.version.clone(),
                author: m.author.clone(),
                description: m.description.clone(),
                download_links: m.download_links.iter().map(|dl| DownloadLink {
                    url: dl.url.clone(),
                    link_type: dl.link_type.clone(),
                    label: dl.label.clone(),
                }).collect(),
                tags: m.tags.clone(),
                dependencies: m.dependencies.iter()
                    .filter_map(|dep| {
                        // A cross-profile reference is "profile::mod"; only the mod half can
                        // be resolved, and only within what this export can see.
                        let id = dep.rsplit("::").next().unwrap_or(dep);
                        data.mods.iter().find(|o| o.id == id).map(|o| o.name.clone())
                    })
                    .collect(),
                update_sources: m.update_sources.clone(),
                id: m.id.clone(),
                content_id: m.content_id.clone(),
                source_repo: m.source_repo.clone(),
                repo_mod_id: m.repo_mod_id.clone(),
                update_url: m.update_url.clone(),
                install_notes: m.install_notes.clone(),
            })
        }).collect();

        // The definitions of every tag these mods refer to. Collected here, under the same
        // lock, because it is the only place that can see both.
        let used: std::collections::HashSet<String> =
            snapshots.iter().flat_map(|s| s.tags.iter().cloned()).collect();
        let tag_defs: Vec<crate::models::tag::TagDef> = data.custom_tags.iter()
            .filter(|t| used.contains(&t.id))
            .cloned()
            .collect();

        // Modpacks whose mods are ALL in this list. A pack that half-installs is worse than
        // a pack that is missing — the same rule the repo manifest applies.
        let exported: std::collections::HashSet<String> =
            snapshots.iter().map(|s| s.name.clone()).collect();
        let name_of: std::collections::HashMap<String, String> = data.mods.iter()
            .map(|m| (m.id.clone(), m.name.clone()))
            .collect();
        let packs: Vec<crate::models::modpack::LocalModpack> = data.modpacks.iter()
            .filter(|p| p.mods.iter().all(|r| name_of.get(&r.mod_id).is_some_and(|n| exported.contains(n))))
            .cloned()
            .collect();

        // The profile's activation order, limited to the mods this list carries: whoever
        // applies the list gets them in the order they were on the author's machine.
        let carried: std::collections::HashSet<&String> = snapshots.iter().map(|s| &s.id).collect();
        let load_order = active_profile.and_then(|p| {
            let order: Vec<String> = p.active_mods.iter().filter(|id| carried.contains(id)).cloned().collect();
            if order.is_empty() { return None; }
            let lib: Vec<crate::commands::order_share::LibMod> =
                data.mods.iter().map(crate::commands::order_share::LibMod::from_entry).collect();
            Some(crate::commands::order_share::build_doc(&order, &lib, Some(p.name.clone()), Some(p.game_name.clone()).filter(|g| !g.is_empty())))
        });

        (game_name, game_path_hint, snapshots, tag_defs, packs, load_order)
        // lock dropped here
    };

    // ── Phase 2: process each mod off the async thread, emit progress ─────────
    let total = snapshots.len();
    let mut modlist = ModList::new(list_name, game_name, game_path_hint);
    modlist.description = Some(description);
    modlist.author = Some(author);
    modlist.tag_defs = tag_defs;
    // Before the file is written, so a refusal costs nothing: an export that walked every
    // mod and then failed on the passphrase would have spent the minutes for nothing.
    if let Some(req) = creds.as_ref() {
        modlist.credentials = seal_credentials(&state, req)?;
    }
    modlist.modpacks = packs;
    modlist.load_order = load_order;

    // Reset the cancel flag before starting
    state.export_cancelled.store(false, Ordering::SeqCst);
    let run = runs::begin("export", run_id);
    let stop = || state.export_cancelled.load(Ordering::SeqCst) || run.cancelled();

    // One governor ticket for the walk (G3b): Hash when every file is read and hashed, Scan
    // when only names and sizes are listed. Its checkpoint runs per file; a cancel from the
    // dashboard lands on the same flag as the export's own Cancel button.
    let kind = if include_hashes { crate::governor::config::OpKind::Hash } else { crate::governor::config::OpKind::Scan };
    let ticket = std::sync::Arc::new(crate::governor::runtime::global().begin_async(kind, "export mod list".to_string()).await);
    runs::attach(&run.key(), ticket.id());

    for (i, snap) in snapshots.into_iter().enumerate() {
        // Check for cancellation before each mod
        if stop() {
            state.export_cancelled.store(false, Ordering::SeqCst);
            let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
                "current": i, "total": total, "cancelled": true,
            }));
            return Err(AppError::LockError("Export cancelled by user".to_string()));
        }

        let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
            "current": i,
            "total": total,
            "mod_name": &snap.name,
        }));

        // spawn_blocking keeps the file walk off the async runtime thread
        let folder = snap.folder.clone();
        let cancel_flag = std::sync::Arc::clone(&state.export_cancelled);
        let run_flag = std::sync::Arc::clone(&run.flag);
        let t = std::sync::Arc::clone(&ticket);
        let file_tree = tokio::task::spawn_blocking(move || build_file_tree(&folder, include_hashes, &[&*cancel_flag, &*run_flag], &t))
            .await
            .unwrap_or_default();

        modlist.mods.push(ModListEntry {
            name: snap.name,
            version: snap.version,
            author: snap.author,
            description: snap.description,
            download_links: snap.download_links,
            file_tree,
            // The mod's own notes. This was String::new() — written by the exporter, read by
            // the importer, and empty in between, so placement instructions somebody wrote
            // for their own install never reached the person they sent the list to.
            install_notes: snap.install_notes,
            tags: snap.tags,
            dependencies: snap.dependencies,
            update_sources: snap.update_sources,
            id: snap.id,
            content_id: snap.content_id,
            source_repo: snap.source_repo,
            repo_mod_id: snap.repo_mod_id,
            update_url: snap.update_url,
        });
    }

    runs::detach(&run.key(), ticket.id());
    drop(ticket);
    // A cancel that landed during the LAST mod's walk: the loop above only looks before each
    // mod, so without this the list was written with that mod's file tree cut short.
    if stop() {
        state.export_cancelled.store(false, Ordering::SeqCst);
        let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
            "current": total, "total": total, "cancelled": true,
        }));
        return Err(AppError::LockError("Export cancelled by user".to_string()));
    }

    let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
        "current": total,
        "total": total,
        "done": true,
    }));

    // LOCKED, when a passphrase was given.
    //
    // A passphrase that sealed only the credentials sealed nothing anybody would notice: the
    // list opened, the mods installed, and the phrase was a formality on a door that was not
    // shut. So the whole list goes inside the envelope — mods included — and what stays
    // outside is a header: the name, the author, the game and how many mods. Enough for
    // BetterCommunity's inspector and for a person to decide whether to ask the author for
    // the phrase; not enough to install anything.
    let passphrase = creds.as_ref().map(|c| c.passphrase.as_str()).filter(|p| !p.is_empty());
    let json = if let Some(pass) = passphrase {
        let count = modlist.mods.len();
        let name = modlist.name.clone();
        let author = modlist.author.clone();
        let game_name = modlist.game_name.clone();
        let created_at = modlist.created_at.clone();

        // Signed BEFORE sealing. The signature belongs to the list, and a signature over an
        // envelope would only say who did the encrypting — which is not the question a
        // reader is asking when they open somebody's mod list.
        let mut inner = serde_json::to_value(&modlist)?;
        crate::commands::doc_sign::sign_doc(&handle, &mut inner, "mm");
        let sealed_bytes = crate::commands::secret_box::seal(
            &serde_json::to_vec(&inner)?, pass).map_err(AppError::LockError)?;

        let locked = LockedList {
            bmm_locked: true,
            name,
            author,
            game_name,
            created_at,
            mods_count: count,
            sealed: serde_json::from_slice(&sealed_bytes)?,
        };
        serde_json::to_string_pretty(&locked)?
    } else {
        // Signed on the way out, like repo.json has always been. A mod list is posted and
        // opened by strangers exactly the way a repo is, and the person opening it had no way
        // to tell whether it was still what the author wrote.
        let mut doc = serde_json::to_value(&modlist)?;
        crate::commands::doc_sign::sign_doc(&handle, &mut doc, "mm");
        serde_json::to_string_pretty(&doc)?
    };

    // Written as a ZIP. The list has grown past "a JSON document": it carries tag
    // definitions, whole modpacks and update sources, and the next thing it needs to carry
    // is a file rather than a field — an icon, a readme, a preset. A container has somewhere
    // to put those; a document has to base64 them into itself.
    //
    // The extension does not change. `.mm` is what people have, what the docs say, and what
    // BCWEB's inspector recognises — and read_modlist_file opens both shapes, so nothing
    // anybody already exported stops working.
    let entries = vec![(MODLIST_ENTRY.to_string(), json.into_bytes())];
    let manifest = crate::commands::doc_sign::archive_manifest(&handle, "mm", &entries);
    let sig = serde_json::to_vec_pretty(&manifest)?;

    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Write;
        let file = std::fs::File::create(&output_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries.iter()
            .chain(std::iter::once(&(crate::commands::doc_sign::ARCHIVE_ENTRY.to_string(), sig)))
        {
            zip.start_file(name.clone(), opts)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
            zip.write_all(data)?;
        }
        zip.finish().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::LockError(e.to_string()))??;
    Ok(())
}

/// Cancel an in-progress export. With the run's token, that run only; without (an older
/// caller), every export and the shared flag, as before.
#[tauri::command]
pub fn cancel_export_modlist(state: State<'_, AppState>, run_id: Option<String>) {
    let n = runs::cancel("export", run_id.as_deref());
    if run_id.is_none() || n == 0 {
        state.export_cancelled.store(true, Ordering::SeqCst);
    }
}

/// Walk a mod folder and record each file's relative path, size, and optional SHA-256.
/// Checks the cancel flags before every file and inside every hash (a big file stops within
/// a block, not at its end), and the governor ticket's checkpoint before every file (a
/// cancelled ticket sets the first flag).
fn build_file_tree(
    folder: &PathBuf,
    include_hashes: bool,
    flags: &[&std::sync::atomic::AtomicBool],
    ticket: &crate::governor::queue::Ticket,
) -> Vec<ModFileEntry> {
    let stop = || flags.iter().any(|f| f.load(Ordering::Relaxed));
    let mut entries = Vec::new();
    // An archived mod is a .zip, and a .zip has to be read as what is INSIDE it or the
    // exported list describes a single file called "" with the size of the archive. Every
    // other reader in the app already goes through this; this one did not, which is why a
    // list exported from a collection of archives arrived describing nothing.
    let folder = &crate::archive::mod_read_root(folder);
    if let Ok(files) = fs_utils::list_mod_files(folder) {
        for rel in files {
            if stop() { break; }
            if ticket.checkpoint().is_err() {
                if let Some(f) = flags.first() { f.store(true, Ordering::SeqCst); }
                break;
            }
            let full = folder.join(&rel);
            let size = std::fs::metadata(&full).map(|md| md.len()).unwrap_or(0);
            let sha256 = if include_hashes { hash_file_streaming(&full, &stop) } else { None };
            entries.push(ModFileEntry {
                relative_path: rel.to_string_lossy().to_string(),
                is_directory: false,
                size,
                sha256,
            });
        }
    }
    entries
}

/// SHA-256 of a file read in 64 KiB chunks — safe for large files. `None` when `stop` turns
/// true part-way (the export is being cancelled and the value is never written).
fn hash_file_streaming(path: &PathBuf, stop: &dyn Fn() -> bool) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::with_capacity(65536, file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        if stop() { return None; }
        let n = reader.read(&mut buf).ok()?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

/// Open a locked list that was FETCHED rather than opened from disk.
///
/// The catalogue reads its entries over the network, so it holds the document as text and
/// has no path to hand `import_modlist`. Same envelope, same refusal on the wrong phrase.
#[tauri::command]
pub fn open_locked_modlist(text: String, passphrase: String) -> Result<String, AppError> {
    let header: LockedList = serde_json::from_str(&text).map_err(AppError::Json)?;
    if !header.bmm_locked {
        return Err(AppError::LockError("mm.errNotLocked".into()));
    }
    let env = serde_json::to_vec(&header.sealed)?;
    let plain = crate::commands::secret_box::open(&env, &passphrase).map_err(AppError::LockError)?;
    String::from_utf8(plain).map_err(|e| AppError::LockError(e.to_string()))
}

/// What a list's sealed credentials contain, WITHOUT the key material.
///
/// The names and the hosts, so the screen can say what applying would mean. The private keys
/// themselves are never returned: they go from the envelope to disk inside Rust, the same way
/// they went from disk to the envelope on the way out. A key that passes through the webview
/// to be handed straight back is a copy of it in a second place for no reason.
#[derive(serde::Serialize)]
pub struct CredsPreview {
    pub passwords: std::collections::HashMap<String, String>,
    pub key_names: Vec<String>,
}

/// Open a list's credentials block. Nothing is applied.
///
/// Separate from applying on purpose: the screen has to be able to SAY what is in there —
/// which hosts, which keys — before anybody agrees to it. A list that installs somebody
/// else's signing identity the moment it is imported is a list that changes who you are to
/// every server you talk to, and it must be a decision, not a side effect.
#[tauri::command]
pub fn modlist_credentials_open(
    credentials: serde_json::Value,
    passphrase: String,
) -> Result<CredsPreview, AppError> {
    let env = serde_json::to_vec(&credentials)?;
    let plain = crate::commands::secret_box::open(&env, &passphrase).map_err(AppError::LockError)?;
    let doc: serde_json::Value = serde_json::from_slice(&plain)?;

    let passwords = doc
        .get("passwords")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let key_names = doc
        .get("keys")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|k| k.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(CredsPreview { passwords, key_names })
}

/// Install the NAMED keys onto this machine's ring.
///
/// Only the ones asked for by name. "Apply the credentials" is not one decision — a password
/// for a host you are about to download from and somebody else's signing key are different
/// things with different consequences, and agreeing to the first must not agree to the
/// second.
///
/// A name already on the ring is SKIPPED, never overwritten. Importing a list must not be
/// able to replace the key you sign with; that is the one change nobody would look for and
/// everybody would feel.
#[tauri::command]
pub fn modlist_credentials_apply_keys(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    credentials: serde_json::Value,
    passphrase: String,
    names: Vec<String>,
) -> Result<Vec<String>, AppError> {
    use tauri::Manager;
    let env = serde_json::to_vec(&credentials)?;
    let plain = crate::commands::secret_box::open(&env, &passphrase).map_err(AppError::LockError)?;
    let doc: serde_json::Value = serde_json::from_slice(&plain)?;
    let wanted: std::collections::HashSet<&str> = names.iter().map(|s| s.as_str()).collect();

    let existing: std::collections::HashSet<String> = {
        let data = state.data.lock().map_err(|_| AppError::LockError("state".into()))?;
        data.settings.key_auth_keys.iter().map(|e| e.name.clone()).collect()
    };

    let dir = app.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))?.join("keys");
    std::fs::create_dir_all(&dir)?;

    let mut added = Vec::new();
    for k in doc.get("keys").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        let (Some(name), Some(pem)) = (
            k.get("name").and_then(|n| n.as_str()),
            k.get("pem").and_then(|p| p.as_str()),
        ) else { continue };
        if !wanted.contains(name) || existing.contains(name) {
            continue;
        }
        // The filename is derived, never the name as it arrived: a key called `../id_rsa` in
        // somebody else's list would otherwise write outside the folder.
        let stem: String = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect();
        let path = dir.join(format!("{}.key", stem.trim_matches('-')));
        if path.exists() {
            continue;
        }
        std::fs::write(&path, pem.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        // Through key_auth_add, so it is proved to open and to sign before it is listed —
        // a key from somebody else's file is exactly the one worth checking.
        if crate::commands::repo_keyauth::key_auth_add(
            state.clone(),
            name.to_string(),
            path.to_string_lossy().to_string(),
            // An imported key that needs a passphrase is skipped rather than half-added:
            // there is nobody to ask in the middle of an import, and a key on the ring
            // that cannot sign looks usable and is not.
            None,
        )
        .is_ok()
        {
            added.push(name.to_string());
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(added)
}

#[tauri::command]
pub fn import_modlist(path: String, passphrase: Option<String>) -> Result<ModList, AppError> {
    read_modlist_file_with(std::path::Path::new(&path), passphrase.as_deref())
}

/// The name the document has inside a `.mm` archive.
pub const MODLIST_ENTRY: &str = "modlist.json";

/// Read a `.mm`, in either shape.
///
/// A `.mm` is a ZIP now — it carries the list plus the tag definitions, the modpacks and the
/// update sources, and there is more to come. The old shape is a bare JSON document, and
/// every list anybody has ever exported is one, so BOTH open here. The BYTES decide: a ZIP
/// starts with `PK`, which is not something a JSON document can start with.
///
/// Deliberately not a version field. A file written last year has no idea a version field
/// was going to exist, and asking "is this a zip" is a question the file answers about
/// itself.
/// What a LOCKED `.mm` looks like from outside.
///
/// A passphrase that only protected the credentials protected nothing anybody cares about:
/// the list opened, the mods installed, and the phrase was a formality. So a list written
/// with a passphrase seals the WHOLE thing — mods included — and leaves this outside it.
///
/// The header stays readable on purpose, and it is the smallest header that still answers
/// the questions somebody holds before deciding whether to ask its author for the phrase:
/// what is it called, who wrote it, which game, how many mods. BetterCommunity's inspector
/// and a person reading the file both get that much. What they do not get is the contents.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct LockedList {
    /// Always true. Present so the shape is recognised by its own claim rather than by the
    /// absence of `mods`, which a truncated file would also produce.
    pub bmm_locked: bool,
    pub name: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub game_name: String,
    #[serde(default)]
    pub created_at: String,
    /// How many mods are inside. A count is not a leak and it is the difference between
    /// "worth asking for the phrase" and "not worth it".
    #[serde(default)]
    pub mods_count: usize,
    /// The sealed envelope holding the real ModList.
    pub sealed: serde_json::Value,
}

/// Is this document a locked list, and what does its header say?
pub fn locked_header(bytes: &[u8]) -> Option<LockedList> {
    let text = if bytes.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
        let mut file = zip.by_name(MODLIST_ENTRY).ok()?;
        let mut t = String::new();
        std::io::Read::read_to_string(&mut file, &mut t).ok()?;
        t
    } else {
        String::from_utf8_lossy(bytes).to_string()
    };
    serde_json::from_str::<LockedList>(&text).ok().filter(|l| l.bmm_locked)
}

/// Read a list that is not locked. Only `modlist_tests` calls it — everything in the app
/// goes through `read_modlist_file_with`, which takes the passphrase — so it reads as dead
/// outside a test build. It is the unlocked-case name the tests are written against.
#[allow(dead_code)]
pub fn read_modlist_file(path: &std::path::Path) -> Result<ModList, AppError> {
    read_modlist_file_with(path, None)
}

/// The same, with the passphrase for a locked list.
///
/// A locked list without one is refused BY NAME — `mm.errLocked` — rather than failing to
/// parse. "This file is locked" and "this file is broken" are different sentences with
/// different next steps, and a serde error would say the second.
pub fn read_modlist_file_with(
    path: &std::path::Path,
    passphrase: Option<&str>,
) -> Result<ModList, AppError> {
    let bytes = std::fs::read(path)?;
    if let Some(header) = locked_header(&bytes) {
        let Some(pass) = passphrase.filter(|p| !p.is_empty()) else {
            return Err(AppError::LockError("mm.errLocked".into()));
        };
        let env = serde_json::to_vec(&header.sealed)?;
        let plain = crate::commands::secret_box::open(&env, pass)
            .map_err(AppError::LockError)?;
        return serde_json::from_slice(&plain).map_err(AppError::Json);
    }
    if bytes.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes))
            .map_err(|e| AppError::LockError(format!("not a readable .mm archive: {e}")))?;
        let mut file = zip.by_name(MODLIST_ENTRY)
            .map_err(|_| AppError::LockError(format!("this .mm has no {MODLIST_ENTRY}")))?;
        let mut text = String::new();
        std::io::Read::read_to_string(&mut file, &mut text)?;
        return serde_json::from_str(&text).map_err(AppError::Json);
    }
    let text = String::from_utf8_lossy(&bytes).to_string();
    serde_json::from_str(&text).map_err(AppError::Json)
}

#[tauri::command]
pub fn add_download_link(
    state: State<AppState>,
    mod_id: String,
    url: String,
    link_type: String,
    label: String,
) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.download_links.push(crate::models::mod_entry::DownloadLink {
                url,
                link_type,
                label,
            });
        } else {
            return Err(AppError::NotFound("Mod not found".to_string()));
        }
    }
    state.save()?;
    Ok(())
}

#[tauri::command]
pub fn remove_download_link(
    state: State<AppState>,
    mod_id: String,
    link_index: usize,
) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            if link_index < m.download_links.len() {
                m.download_links.remove(link_index);
            }
        }
    }
    state.save()?;
    Ok(())
}

#[cfg(test)]
#[path = "modlist_tests.rs"]
mod modlist_tests;

/// Fetch a `.mm` from a URL into the app's own data dir, and return where it landed.
///
/// The app's data dir, never the system temp. A shared list can carry download passwords
/// and identity keys, and on Windows the system temp is a directory every process on the
/// machine can read — which would undo, in the last step, the whole point of sealing it.
///
/// The name comes from the URL and is sanitised: it is chosen by whoever hosts the file.
#[tauri::command]
pub async fn modlist_fetch(app: tauri::AppHandle, url: String) -> Result<String, AppError> {
    fetch_to_app_data(app, url, Some("modlists".into()), None, Some("mm".into())).await
}

/// Fetch any importable file into the app's own data dir, and return where it landed.
///
/// The app's data dir, never the system temp. A shared list can carry download passwords and
/// identity keys, a backup carries everything, and on Windows the system temp is a directory
/// every process on the machine can read — which would undo, in the last step, the whole
/// point of sealing it.
///
/// `password` is the download password a protected host asks for. Sent as the same header
/// BMM's repo client sends, so one protected host works the same way whether the thing being
/// fetched is a mod or a mod list.
#[tauri::command]
pub async fn fetch_to_app_data(
    app: tauri::AppHandle,
    url: String,
    folder: Option<String>,
    password: Option<String>,
    default_ext: Option<String>,
) -> Result<String, AppError> {
    use tauri::Manager;
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::LockError("mm.errBadUrl".into()));
    }
    let mut req = crate::commands::net::client()
        .get(&url)
        .timeout(std::time::Duration::from_secs(120));
    if let Some(pw) = password.as_deref().filter(|p| !p.is_empty()) {
        req = req.header("X-Repo-Password", pw);
    }
    // And a key proof, when one is bound to this host. A protected source can ask for either
    // or both, and an import that could only send the password would fail on half of them.
    {
        let mut headers = reqwest::header::HeaderMap::new();
        crate::commands::repo_keyauth::add_proof(&mut headers, &url);
        for (k, v) in headers.iter() {
            req = req.header(k.clone(), v.clone());
        }
    }
    let res = req
        .send()
        .await
        .map_err(|e| AppError::LockError(format!("mm.errFetch|{}", e)))?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        // Named, because "401" and "the file is not there" send somebody to different places.
        return Err(AppError::LockError("repo.errPasswordRequired".into()));
    }
    if !res.status().is_success() {
        return Err(AppError::LockError(format!("mm.errFetch|{}", res.status())));
    }
    let bytes = res.bytes().await.map_err(|e| AppError::LockError(e.to_string()))?;

    let folder = crate::commands::repo_extras::safe_name(&folder.unwrap_or_else(|| "downloads".into()));
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::LockError(e.to_string()))?
        .join(folder);
    std::fs::create_dir_all(&dir)?;
    // The name comes from the URL, which is chosen by whoever hosts the file — so it goes
    // through the same narrowing a repo's carried files do, and cannot climb out of the
    // folder or arrive with a name the host would rewrite.
    let raw = url.split(['?', '#']).next().unwrap_or(&url);
    let name = crate::commands::repo_extras::safe_name(raw.rsplit('/').next().unwrap_or("download"));
    let name = match (name.contains('.'), default_ext) {
        (false, Some(ext)) => format!("{}.{}", name, ext.trim_start_matches('.')),
        _ => name,
    };
    let path = dir.join(name);
    std::fs::write(&path, &bytes)?;
    Ok(path.to_string_lossy().to_string())
}
