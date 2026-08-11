//! Refreshing a repo whose files live on a server you cannot read locally.
//!
//! # The problem
//!
//! Updating a repo used to require BMM to see the repo folder. With a remote server that
//! means download everything, regenerate, re-upload everything — so repos stop being
//! maintained. The goal is: drop mods on the server with your usual FTP client, and have
//! the manifest catch up without pulling the whole thing back.
//!
//! # The one decision everything follows from
//!
//! Who computes the hashes. Downloading every file on every refresh is correct and
//! unusable past a few GB. Running something server-side breaks the "plain nginx is
//! enough" promise. So: a directory listing gives size and mtime per file, those are
//! compared against the previous manifest, and only what changed is fetched and hashed.
//! Everything else keeps the hash already recorded — a hash that was computed from real
//! bytes at some point.
//!
//! # What that costs, stated plainly
//!
//! Size and mtime are hints, not proof. Someone with write access to the server can change
//! a file while preserving both, and this planner would carry the old hash forward.
//!
//! That fails **closed**, which is why it is acceptable: the manifest would then advertise
//! the old hash, the client would download the modified file, the hash would not match, and
//! the download is rejected. The attack breaks the repo; it does not push content past a
//! client. The signature is still produced on the author's machine, never on the server.
//!
//! The residual risk is narrower and real: the author re-signs a manifest describing bytes
//! they did not verify. Two rules below bound it — a manifest that is not verifiably ours is
//! never trusted for hashes, and the plan always reports what it assumed.

use crate::models::repo::ServerRepo;
use std::collections::HashMap;

/// One file as the server reports it, path relative to the repo root (`<mod-id>/<path>`).
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteEntry {
    pub rel_path: String,
    pub size: u64,
    /// Unix seconds. None when the listing does not carry one — treated as "unknown",
    /// never as "unchanged".
    pub mtime: Option<i64>,
}

/// Why a refresh had to re-hash everything instead of reusing the previous manifest.
#[derive(Debug, Clone, PartialEq)]
pub enum FullRehash {
    NoPreviousManifest,
    /// Present but unsigned. An unsigned manifest has no author, so its hashes vouch for
    /// nothing — reusing them would mean contresigning whatever is on the server.
    Unsigned,
    /// Signed, but not by us, or the signature does not verify. Same conclusion.
    NotOurs,
    Requested,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RefreshPlan {
    /// Paths that keep their recorded hash — unchanged size AND mtime.
    pub carry_forward: Vec<String>,
    /// Paths to download and hash.
    pub fetch: Vec<String>,
    /// In the manifest, absent from the server.
    pub removed: Vec<String>,
    /// Set when nothing could be carried forward, with the reason.
    pub full_rehash: Option<FullRehash>,
    /// Things worth saying out loud in the report. A shortcut nobody can see is a shortcut
    /// nobody can audit.
    pub warnings: Vec<String>,
}

impl RefreshPlan {
    /// One line for the report. Always shown, including when nothing was reused.
    pub fn summary(&self) -> String {
        format!(
            "{} to hash, {} reused, {} gone",
            self.fetch.len(),
            self.carry_forward.len(),
            self.removed.len()
        )
    }
}

/// Every file the manifest knows about, keyed by `<mod-id>/<path>`.
fn manifest_files(repo: &ServerRepo) -> HashMap<String, (u64, Option<i64>)> {
    let mut out = HashMap::new();
    for profile in &repo.profiles {
        for m in &profile.mods {
            for f in &m.files {
                let key = format!("{}/{}", m.id, f.relative_path.replace('\\', "/"));
                out.insert(key, (f.size, f.mtime));
            }
        }
    }
    out
}

/// Decide what a refresh has to download.
///
/// `trusted_author_id` is this machine's creator id (the ed25519 public key that signs our
/// manifests). `verify` is the signature check, injected so this stays testable without a
/// keyring.
pub fn plan_refresh(
    listing: &[RemoteEntry],
    previous: Option<&ServerRepo>,
    trusted_author_id: Option<&str>,
    force_full: bool,
    verify: impl Fn(&ServerRepo) -> bool,
) -> RefreshPlan {
    let mut plan = RefreshPlan::default();

    let reason = if force_full {
        Some(FullRehash::Requested)
    } else {
        match previous {
            None => Some(FullRehash::NoPreviousManifest),
            Some(repo) if repo.signature.is_none() => Some(FullRehash::Unsigned),
            // Ownership before validity: a manifest signed by someone else is not ours to
            // trust even if its signature is perfectly valid.
            Some(repo)
                if trusted_author_id.is_none()
                    || repo.author_id.as_deref() != trusted_author_id
                    || !verify(repo) =>
            {
                Some(FullRehash::NotOurs)
            }
            Some(_) => None,
        }
    };

    if let Some(r) = reason {
        plan.full_rehash = Some(r);
        plan.fetch = listing.iter().map(|e| e.rel_path.clone()).collect();
        plan.fetch.sort();
        // `removed` stays empty on purpose: with nothing trusted to compare against, a
        // "removed" list would be guesswork, and a false one reads as data loss.
        return plan;
    }

    let known = manifest_files(previous.expect("checked above"));
    let mut seen = Vec::new();

    for entry in listing {
        let path = entry.rel_path.replace('\\', "/");
        seen.push(path.clone());
        match known.get(&path) {
            None => plan.fetch.push(path),
            Some((size, mtime)) => {
                if *size != entry.size {
                    plan.fetch.push(path);
                } else if mtime.is_none() || entry.mtime.is_none() {
                    // No timestamp on one side. Same size alone is far too weak to call a
                    // file unchanged, so this re-hashes — which is also the migration path
                    // for manifests written before mtime was recorded.
                    plan.warnings.push(format!("{}: no timestamp, re-hashed", path));
                    plan.fetch.push(path);
                } else if mtime != &entry.mtime {
                    plan.fetch.push(path);
                } else {
                    plan.carry_forward.push(path);
                }
            }
        }
    }

    let present: std::collections::HashSet<&String> = seen.iter().collect();
    plan.removed = known.keys().filter(|k| !present.contains(k)).cloned().collect();

    plan.fetch.sort();
    plan.carry_forward.sort();
    plan.removed.sort();
    plan.warnings.sort();
    plan
}

/// Flag a file whose bytes changed while its size did not.
///
/// Legitimate edits almost always move the size; a same-size content change is the exact
/// shape of tampering. It costs nothing to notice, since both values are already in hand
/// once the file has been re-hashed.
pub fn suspicious_same_size_change(
    old_size: u64,
    old_hash: &str,
    new_size: u64,
    new_hash: &str,
) -> bool {
    old_size == new_size && !old_hash.is_empty() && old_hash != new_hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::repo::{RepoFile, RepoMod, RepoProfile};

    fn file(path: &str, size: u64, mtime: Option<i64>) -> RepoFile {
        RepoFile {
            relative_path: path.into(),
            size,
            sha256_hash: format!("hash-of-{path}"),
            chunks: None,
            mtime,
        }
    }

    fn repo(signed: bool, author: &str, files: Vec<RepoFile>) -> ServerRepo {
        let mut r = ServerRepo::new("R".into(), "G".into());
        r.author_id = Some(author.into());
        r.signature = if signed { Some("sig".into()) } else { None };
        r.profiles = vec![RepoProfile {
            id: "p".into(),
            name: "P".into(),
            game_name: "G".into(),
            icon: None,
            color: None,
            icon_image: None,
            mods: vec![RepoMod {
                id: "cool-mod".into(),
                name: "Cool".into(),
                version: "1".into(),
                author: None,
                description: None,
                tags: vec![],
                files,
                archive: None,
                download_links: vec![],
                dependencies: vec![],
                changelog: None,
                update_url: None,
                direct_url: None,
                update_sources: vec![],
            }],
        }];
        r
    }

    fn entry(path: &str, size: u64, mtime: Option<i64>) -> RemoteEntry {
        RemoteEntry { rel_path: path.into(), size, mtime: mtime }
    }

    const OK: fn(&ServerRepo) -> bool = |_| true;
    const BAD: fn(&ServerRepo) -> bool = |_| false;

    #[test]
    fn unchanged_files_are_reused_and_only_real_changes_are_fetched() {
        let prev = repo(true, "me", vec![
            file("a.pak", 10, Some(100)),
            file("b.pak", 20, Some(200)),
            file("gone.pak", 30, Some(300)),
        ]);
        let listing = vec![
            entry("cool-mod/a.pak", 10, Some(100)),   // untouched
            entry("cool-mod/b.pak", 25, Some(200)),   // size moved
            entry("cool-mod/new.pak", 5, Some(400)),  // added
        ];

        let plan = plan_refresh(&listing, Some(&prev), Some("me"), false, OK);

        assert_eq!(plan.full_rehash, None);
        assert_eq!(plan.carry_forward, vec!["cool-mod/a.pak"]);
        assert_eq!(plan.fetch, vec!["cool-mod/b.pak", "cool-mod/new.pak"]);
        assert_eq!(plan.removed, vec!["cool-mod/gone.pak"]);
    }

    #[test]
    fn a_touched_file_of_identical_size_is_still_fetched() {
        // Same size, newer timestamp. Trusting size alone here is how a modified file keeps
        // a stale hash.
        let prev = repo(true, "me", vec![file("a.pak", 10, Some(100))]);
        let listing = vec![entry("cool-mod/a.pak", 10, Some(999))];
        let plan = plan_refresh(&listing, Some(&prev), Some("me"), false, OK);
        assert_eq!(plan.fetch, vec!["cool-mod/a.pak"]);
        assert!(plan.carry_forward.is_empty());
    }

    #[test]
    fn a_manifest_we_cannot_prove_is_ours_is_never_trusted_for_hashes() {
        let files = vec![file("a.pak", 10, Some(100))];
        let listing = vec![entry("cool-mod/a.pak", 10, Some(100))];

        for (prev, trusted, verify, expected) in [
            (repo(false, "me", files.clone()), Some("me"), OK, FullRehash::Unsigned),
            (repo(true, "someone-else", files.clone()), Some("me"), OK, FullRehash::NotOurs),
            // Signature present and claiming to be ours, but it does not verify.
            (repo(true, "me", files.clone()), Some("me"), BAD, FullRehash::NotOurs),
            // We have no identity to compare against.
            (repo(true, "me", files.clone()), None, OK, FullRehash::NotOurs),
        ] {
            let plan = plan_refresh(&listing, Some(&prev), trusted, false, verify);
            assert_eq!(plan.full_rehash, Some(expected.clone()), "{expected:?}");
            assert_eq!(plan.fetch, vec!["cool-mod/a.pak"]);
            assert!(plan.carry_forward.is_empty(), "nothing may be reused: {expected:?}");
        }
    }

    #[test]
    fn a_missing_timestamp_re_hashes_rather_than_assuming_unchanged() {
        // Both directions: an old manifest with no mtime, and a listing that omits it.
        let prev_no_mtime = repo(true, "me", vec![file("a.pak", 10, None)]);
        let plan = plan_refresh(
            &[entry("cool-mod/a.pak", 10, Some(100))], Some(&prev_no_mtime), Some("me"), false, OK);
        assert_eq!(plan.fetch, vec!["cool-mod/a.pak"]);
        assert!(!plan.warnings.is_empty(), "the assumption must be reported");

        let prev = repo(true, "me", vec![file("a.pak", 10, Some(100))]);
        let plan = plan_refresh(
            &[entry("cool-mod/a.pak", 10, None)], Some(&prev), Some("me"), false, OK);
        assert_eq!(plan.fetch, vec!["cool-mod/a.pak"]);
    }

    #[test]
    fn a_full_rehash_reports_nothing_as_removed() {
        // With nothing trusted to compare against, a "removed" list is guesswork, and a
        // wrong one reads as data loss.
        let plan = plan_refresh(&[entry("cool-mod/a.pak", 1, Some(1))], None, Some("me"), false, OK);
        assert_eq!(plan.full_rehash, Some(FullRehash::NoPreviousManifest));
        assert!(plan.removed.is_empty());
    }

    #[test]
    fn a_forced_refresh_hashes_everything_even_with_a_valid_manifest() {
        let prev = repo(true, "me", vec![file("a.pak", 10, Some(100))]);
        let plan = plan_refresh(
            &[entry("cool-mod/a.pak", 10, Some(100))], Some(&prev), Some("me"), true, OK);
        assert_eq!(plan.full_rehash, Some(FullRehash::Requested));
        assert!(plan.carry_forward.is_empty());
    }

    #[test]
    fn a_same_size_content_change_is_flagged() {
        assert!(suspicious_same_size_change(100, "aaa", 100, "bbb"));
        assert!(!suspicious_same_size_change(100, "aaa", 100, "aaa"));
        assert!(!suspicious_same_size_change(100, "aaa", 200, "bbb"));
        // No baseline to compare against is not suspicious, just new.
        assert!(!suspicious_same_size_change(100, "", 100, "bbb"));
    }

    #[test]
    fn the_summary_always_states_what_was_assumed() {
        let prev = repo(true, "me", vec![file("a.pak", 10, Some(100)), file("b.pak", 20, Some(200))]);
        let plan = plan_refresh(
            &[entry("cool-mod/a.pak", 10, Some(100)), entry("cool-mod/b.pak", 21, Some(200))],
            Some(&prev), Some("me"), false, OK);
        assert_eq!(plan.summary(), "1 to hash, 1 reused, 0 gone");
    }
}
