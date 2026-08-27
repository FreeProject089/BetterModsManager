//! Naming a folder BMM already knows about, instead of typing where it is.
//!
//! A task that has to touch a plugin's bundled folder, an installed app or the mods directory
//! had one way to say so: an absolute path, typed by hand. That path is wrong on the next
//! machine, wrong after the app data folder moves, and wrong the moment the plugin is
//! reinstalled somewhere else — and it fails at 3am, inside a step, with a message about a
//! directory nobody recognises.
//!
//! So a path can be written as a SPEC instead: `plugin:my-tools/bundle/presets`, `app:obs`,
//! `mods:`, `game:`. BMM resolves it when the step runs, against what it currently knows.
//!
//! Split from the Tauri command file with no Tauri in it, so the CLI and the MCP server mount
//! the same resolver rather than growing a second one — and so the traversal guard below has
//! exactly one implementation.

use serde::{Deserialize, Serialize};

/// One place a spec can point at.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PathRoot {
    /// `plugin` · `app` · `modpack` · `profile` · `mods` · `game` · `backup` · `appdata`.
    pub kind: String,
    /// Which one, for the kinds that have several. Empty for `mods`, `game`, `appdata`.
    pub id: String,
    /// What to show a person choosing from a list.
    pub label: String,
    /// Where it actually is, right now.
    pub path: String,
}

/// A spec, split into its three parts.
///
/// `plugin:my-tools/bundle/presets` → kind `plugin`, id `my-tools`, rel `bundle/presets`.
/// `mods:` → kind `mods`, no id, no rel. A bare `mods` works too: the colon is punctuation,
/// not a requirement, and refusing over it would be refusing over a typo that means one thing.
#[derive(Debug, PartialEq)]
pub struct Spec {
    pub kind: String,
    pub id: String,
    pub rel: String,
}

/// Is this text a spec, or an ordinary path?
///
/// `C:\mods` is NOT a spec, and this is the whole reason the check is written out rather than
/// being `contains(':')`: a Windows drive letter is one character, every scheme here is more,
/// and getting that backwards would silently reinterpret every absolute path on Windows.
pub fn looks_like_spec(raw: &str) -> bool {
    let head = raw.split(&[':', '/', '\\'][..]).next().unwrap_or("");
    matches!(head, "plugin" | "app" | "modpack" | "profile" | "mods" | "game" | "backup" | "appdata")
        && !(raw.len() > 1 && raw.as_bytes()[1] == b':')
}

/// Split a spec. Returns None for anything that is not one.
pub fn parse_spec(raw: &str) -> Option<Spec> {
    let raw = raw.trim();
    if !looks_like_spec(raw) {
        return None;
    }
    let normalised = raw.replace('\\', "/");
    let (head, tail) = match normalised.split_once(':') {
        Some((h, t)) => (h.to_string(), t.to_string()),
        // `mods/sub` with no colon: the kind is the first segment.
        None => match normalised.split_once('/') {
            Some((h, t)) => (h.to_string(), t.to_string()),
            None => (normalised.clone(), String::new()),
        },
    };
    let tail = tail.trim_start_matches('/').to_string();
    // The kinds that name one of several things take the next segment as the id; the rest do
    // not have one, and eating a segment from them would turn `mods/textures` into a request
    // for a mods folder called "textures".
    let takes_id = matches!(head.as_str(), "plugin" | "app" | "modpack" | "profile");
    let (id, rel) = if takes_id {
        match tail.split_once('/') {
            Some((i, r)) => (i.to_string(), r.to_string()),
            None => (tail.clone(), String::new()),
        }
    } else {
        (String::new(), tail.clone())
    };
    Some(Spec { kind: head, id, rel })
}

/// Join a relative part onto a root, refusing anything that leaves it.
///
/// `rel` comes from a task, a manifest or an HTTP caller. Canonicalised where it exists, and
/// checked component-wise so a sibling folder whose name merely starts the same way cannot
/// pass — the `assets` / `assets-evil` case, which a string prefix test gets wrong.
///
/// A path that does not exist yet is still allowed: a task writing a new file names one on
/// purpose. It is checked lexically instead, after removing `.` and refusing `..` outright,
/// because there is nothing on disk to canonicalise.
pub fn join_inside(root: &std::path::Path, rel: &str) -> Result<std::path::PathBuf, String> {
    if rel.is_empty() {
        return Ok(root.to_path_buf());
    }
    let rel_path = std::path::Path::new(rel);
    if rel_path.is_absolute() {
        return Err("paths.errAbsolute".to_string());
    }
    for part in rel_path.components() {
        if matches!(part, std::path::Component::ParentDir) {
            return Err("paths.errOutside".to_string());
        }
    }
    let full = root.join(rel_path);
    // When both exist, the canonical check is the real one — it also catches a symlink
    // pointing out of the tree, which the lexical pass above cannot see.
    if let (Ok(root_c), Ok(full_c)) = (root.canonicalize(), full.canonicalize()) {
        if !full_c.starts_with(&root_c) {
            return Err("paths.errOutside".to_string());
        }
        return Ok(full_c);
    }
    Ok(full)
}

/// Resolve a spec against the roots BMM currently knows.
///
/// The caller collects the roots (that part needs BMM's state); this decides what the spec
/// means. Kept apart so the decision is testable without an app.
pub fn resolve_with(roots: &[PathRoot], raw: &str) -> Result<String, String> {
    let spec = parse_spec(raw).ok_or_else(|| "paths.errNotSpec".to_string())?;
    let root = roots
        .iter()
        .find(|r| r.kind == spec.kind && (spec.id.is_empty() || r.id == spec.id))
        // Named, because the usual cause is a plugin that is not installed on THIS machine,
        // and "no such plugin: my-tools" is the sentence that says so.
        .ok_or_else(|| format!("paths.errNoRoot|{}|{}", spec.kind, spec.id))?;
    let full = join_inside(std::path::Path::new(&root.path), &spec.rel)?;
    Ok(full.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(kind: &str, id: &str, path: &str) -> PathRoot {
        PathRoot { kind: kind.into(), id: id.into(), label: id.into(), path: path.into() }
    }

    #[test]
    fn a_windows_path_is_not_a_spec() {
        // The one that would break everything quietly: every absolute path on Windows has a
        // colon in it, and reading those as specs would reinterpret paths that work today.
        assert!(!looks_like_spec(r"C:\mods\thing"));
        assert!(!looks_like_spec("D:/games"));
        assert!(!looks_like_spec("/usr/share"));
        assert!(!looks_like_spec("plugins/other"), "close, but not one of the kinds");
        assert!(looks_like_spec("plugin:my-tools"));
        assert!(looks_like_spec("mods:"));
        assert!(looks_like_spec("mods"));
    }

    #[test]
    fn the_kinds_with_an_id_take_one_and_the_others_do_not() {
        assert_eq!(
            parse_spec("plugin:my-tools/bundle/presets").unwrap(),
            Spec { kind: "plugin".into(), id: "my-tools".into(), rel: "bundle/presets".into() }
        );
        assert_eq!(
            parse_spec("plugin:my-tools").unwrap(),
            Spec { kind: "plugin".into(), id: "my-tools".into(), rel: "".into() }
        );
        // `mods/textures` is the textures folder inside mods, NOT a mods folder called
        // "textures" — eating a segment here is the bug this asserts against.
        assert_eq!(
            parse_spec("mods/textures").unwrap(),
            Spec { kind: "mods".into(), id: "".into(), rel: "textures".into() }
        );
        assert_eq!(
            parse_spec("mods:").unwrap(),
            Spec { kind: "mods".into(), id: "".into(), rel: "".into() }
        );
        assert_eq!(parse_spec(r"plugin:x\bundle\y").unwrap().rel, "bundle/y", "backslashes too");
        assert!(parse_spec(r"C:\mods").is_none());
    }

    #[test]
    fn a_spec_cannot_climb_out_of_its_root() {
        let d = tempfile::tempdir().unwrap();
        let inside = d.path().join("plug");
        std::fs::create_dir_all(inside.join("bundle")).unwrap();
        std::fs::write(d.path().join("secret.txt"), b"no").unwrap();
        let roots = vec![root("plugin", "p", &inside.to_string_lossy())];

        assert!(resolve_with(&roots, "plugin:p/bundle").is_ok());
        for evil in ["plugin:p/../secret.txt", r"plugin:p\..\secret.txt", "plugin:p/bundle/../../secret.txt"] {
            assert_eq!(resolve_with(&roots, evil).unwrap_err(), "paths.errOutside", "{}", evil);
        }
        // An absolute rel would silently ignore the root it was joined to. It gets its OWN
        // error rather than the traversal one: they are refused for different reasons and a
        // reader chasing "outside" would go looking for a `..` that is not there.
        assert_eq!(resolve_with(&roots, "plugin:p/C:/windows").unwrap_err(), "paths.errAbsolute");
    }

    #[test]
    fn a_file_that_does_not_exist_yet_still_resolves() {
        // A task writing a new log names a path nothing has created. Refusing it would mean
        // the resolver only works for reading, which is half the reason to have one.
        let d = tempfile::tempdir().unwrap();
        let roots = vec![root("mods", "", &d.path().to_string_lossy())];
        let out = resolve_with(&roots, "mods:logs/today.txt").unwrap();
        assert!(out.ends_with("today.txt"));
        assert!(!std::path::Path::new(&out).exists());
    }

    #[test]
    fn an_unknown_id_says_which_one() {
        let roots = vec![root("plugin", "installed", "C:/x")];
        let e = resolve_with(&roots, "plugin:missing/bundle").unwrap_err();
        assert!(e.starts_with("paths.errNoRoot|plugin|missing"), "{}", e);
    }

    #[test]
    fn something_that_is_not_a_spec_is_refused_rather_than_guessed_at() {
        let roots = vec![root("mods", "", "C:/x")];
        assert_eq!(resolve_with(&roots, r"C:\mods\file.txt").unwrap_err(), "paths.errNotSpec");
    }
}
