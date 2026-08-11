//! Looking at a server that may not have a `repo.json` at all.
//!
//! # Why this exists
//!
//! Subscribing used to require a manifest. A server that just serves a folder of mods —
//! which is most of them, before anyone adopts BMM — was simply not usable, even though
//! every file is right there and downloadable.
//!
//! So: read the listing, and try to find a manifest to check it against. If one is found and
//! covers a file, that file keeps the guarantee it always had. If not, the file is offered
//! **unverified**, clearly marked, and never silently.
//!
//! # Where a manifest is looked for
//!
//! Two places, in order: beside the mods folder, then one level up. The second is not a
//! guess — the layout `files_layout` describes is `<base>/mods/<id>/<path>`, so pointing BMM
//! at `.../mods` puts the manifest exactly one directory above. Looking further would start
//! attaching manifests to servers they do not belong to.
//!
//! # What "unverified" costs, stated plainly
//!
//! A hash is what proves the bytes you received are the bytes the author published. Without
//! one there is nothing to compare against: a corrupted transfer, a truncated file or a
//! substituted one all look identical to a good download.
//!
//! That is a real loss, and it is why unverified mods are opt-in, listed apart, and carry
//! the flag through to whatever installs them — rather than being quietly folded in with
//! mods that do carry a hash.

use crate::commands::repo_autoindex::crawl;
use crate::models::repo::ServerRepo;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredMod {
    /// Folder name on the server, which is also the id a manifest would use.
    pub id: String,
    pub files: usize,
    pub bytes: u64,
    /// True when every one of this mod's files is covered by a manifest we could read.
    pub verified: bool,
    /// Files present on the server that the manifest does not cover. Empty when verified.
    pub uncovered: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryReport {
    /// Where the manifest was found, or None if there is none.
    pub manifest_url: Option<String>,
    /// True when a manifest was found AND its signature verifies.
    ///
    /// Kept apart from "a manifest exists": an unsigned or broken one must not lend its
    /// authority to the files it lists, so everything under it is treated as unverified.
    pub manifest_trusted: bool,
    pub mods: Vec<DiscoveredMod>,
    pub verified_count: usize,
    pub unverified_count: usize,
}

/// Group a listing into mods and mark each against the manifest, if any.
///
/// Pure so the rules are testable without a server. `covered` maps `<mod>/<path>` to the
/// hash the manifest recorded; an empty map means "no usable manifest", which marks
/// everything unverified rather than nothing.
pub(crate) fn classify(
    listing: &[crate::commands::repo_remote::RemoteEntry],
    covered: &HashMap<String, String>,
) -> Vec<DiscoveredMod> {
    let mut by_mod: std::collections::BTreeMap<String, DiscoveredMod> = Default::default();
    for e in listing {
        let path = e.rel_path.replace('\\', "/");
        let Some(id) = path.split('/').next().filter(|s| !s.is_empty()) else { continue };
        let entry = by_mod.entry(id.to_string()).or_insert_with(|| DiscoveredMod {
            id: id.to_string(),
            files: 0,
            bytes: 0,
            verified: true,
            uncovered: Vec::new(),
        });
        entry.files += 1;
        entry.bytes += e.size;
        // A hash that is present but empty is not a hash. Treating it as coverage would hand
        // out the guarantee without the check behind it.
        if covered.get(&path).map(|h| h.trim().is_empty()).unwrap_or(true) {
            entry.verified = false;
            entry.uncovered.push(path);
        }
    }
    for m in by_mod.values_mut() {
        m.uncovered.sort();
    }
    by_mod.into_values().collect()
}

/// Every file a manifest vouches for, keyed `<mod>/<path>`.
pub(crate) fn covered_files(repo: &ServerRepo) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for p in &repo.profiles {
        for m in &p.mods {
            for f in &m.files {
                out.insert(
                    format!("{}/{}", m.id, f.relative_path.replace('\\', "/")),
                    f.sha256_hash.clone(),
                );
            }
        }
    }
    out
}

/// The URLs to try for a manifest, in order.
///
/// Beside the mods folder first, then one directory up — the layout a generated repo uses
/// puts `repo.json` exactly there. Nothing beyond that: walking further up would start
/// picking up manifests belonging to a different repo on the same host.
pub(crate) fn manifest_candidates(base_url: &str) -> Vec<String> {
    let base = base_url.trim().trim_end_matches('/');
    let mut out = vec![format!("{base}/repo.json")];
    if let Some(parent) = base.rfind('/').map(|i| &base[..i]) {
        // Stop at the scheme: "https:/" is not a directory.
        if !parent.ends_with(':') && !parent.is_empty() && parent.matches('/').count() >= 2 {
            out.push(format!("{parent}/repo.json"));
        }
    }
    out
}

/// Look at a server and report what it offers, verified or not.
#[tauri::command]
pub async fn discover_server_repo(base_url: String) -> Result<DiscoveryReport, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let listing = crawl(base_url.trim(), &client).await?;

    let mut manifest_url = None;
    let mut manifest_trusted = false;
    let mut covered: HashMap<String, String> = HashMap::new();

    for url in manifest_candidates(&base_url) {
        let Ok(resp) = client.get(&url).send().await else { continue };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(text) = resp.text().await else { continue };
        let Ok(repo) = serde_json::from_str::<ServerRepo>(&text) else {
            // Found something at that URL but it is not a manifest. Say so by leaving it
            // untrusted rather than silently trying the next one as if nothing were there.
            manifest_url = Some(url);
            break;
        };
        manifest_url = Some(url);
        // An invalid or absent signature means the manifest cannot lend authority to
        // anything: its hashes are then no better than the files vouching for themselves.
        manifest_trusted = crate::commands::security::verify_repo_signature(repo.clone());
        if manifest_trusted {
            covered = covered_files(&repo);
        }
        break;
    }

    let mods = classify(&listing, &covered);
    let verified_count = mods.iter().filter(|m| m.verified).count();
    Ok(DiscoveryReport {
        manifest_url,
        manifest_trusted,
        unverified_count: mods.len() - verified_count,
        verified_count,
        mods,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::repo_remote::RemoteEntry;

    fn e(path: &str, size: u64) -> RemoteEntry {
        RemoteEntry { rel_path: path.into(), size, mtime: Some(1) }
    }

    #[test]
    fn with_no_manifest_every_mod_is_offered_but_marked_unverified() {
        // The point of the feature: a plain folder of mods becomes usable. The point of the
        // marking: nobody is told those downloads were checked.
        let mods = classify(&[e("a/x.pak", 10), e("a/y.pak", 20), e("b/z.pak", 5)], &HashMap::new());
        assert_eq!(mods.len(), 2);
        assert!(mods.iter().all(|m| !m.verified));
        assert_eq!(mods[0].files, 2);
        assert_eq!(mods[0].bytes, 30);
        assert_eq!(mods[0].uncovered, vec!["a/x.pak", "a/y.pak"]);
    }

    #[test]
    fn a_mod_the_manifest_covers_fully_stays_verified() {
        let covered = HashMap::from([
            ("a/x.pak".to_string(), "hash1".to_string()),
            ("a/y.pak".to_string(), "hash2".to_string()),
        ]);
        let mods = classify(&[e("a/x.pak", 10), e("a/y.pak", 20)], &covered);
        assert!(mods[0].verified);
        assert!(mods[0].uncovered.is_empty());
    }

    #[test]
    fn one_uncovered_file_makes_the_whole_mod_unverified() {
        // Partial coverage is not partial safety: installing the mod writes the unchecked
        // file too, so the mod as a unit has no guarantee.
        let covered = HashMap::from([("a/x.pak".to_string(), "hash1".to_string())]);
        let mods = classify(&[e("a/x.pak", 10), e("a/new.pak", 20)], &covered);
        assert!(!mods[0].verified);
        assert_eq!(mods[0].uncovered, vec!["a/new.pak"]);
    }

    #[test]
    fn an_empty_hash_is_not_coverage() {
        // A manifest entry with a blank hash checks nothing; counting it would hand out the
        // guarantee without the check behind it.
        let covered = HashMap::from([("a/x.pak".to_string(), "   ".to_string())]);
        let mods = classify(&[e("a/x.pak", 10)], &covered);
        assert!(!mods[0].verified);
    }

    #[test]
    fn a_manifest_is_looked_for_beside_the_folder_then_one_level_up() {
        let c = manifest_candidates("https://host.tld/files/mods");
        assert_eq!(c, vec![
            "https://host.tld/files/mods/repo.json",
            "https://host.tld/files/repo.json",
        ]);
    }

    #[test]
    fn the_search_never_climbs_past_the_host() {
        // Walking further would attach a manifest belonging to a different repo on the same
        // host — or to the host's root, which has nothing to do with these mods.
        for url in ["https://host.tld/mods", "https://host.tld", "https://host.tld/"] {
            for candidate in manifest_candidates(url) {
                assert!(
                    !candidate.starts_with("https:/repo.json")
                        && candidate != "https://repo.json",
                    "{url} produced {candidate}",
                );
            }
        }
        assert_eq!(manifest_candidates("https://host.tld"), vec!["https://host.tld/repo.json"]);
    }
}
