//! MCP Tool — one search across everything BMM knows about (read-only).
//!
//! The app's Ctrl+K palette gained the same idea, but it CANNOT be reused here and the
//! reason is structural, not laziness: the palette's engine (frontend/src/core/search.ts)
//! runs in the webview, while this MCP server is deliberately standalone — `state_bridge`
//! reads `data.json` off disk so the tools work even when BMM is closed. There is no path
//! from here into the webview's memory.
//!
//! So this is a SECOND matcher, and it is deliberately a simpler one. Making it a faithful
//! port of the TypeScript scorer would mean two implementations that must be kept identical
//! forever — exactly the kind of pairing that drifts silently. An agent asking for "the A-10
//! mod" needs the right item in the list; it does not need the same tie-breaking a human
//! gets after typing three letters. The palette stays the reference for ranking.
//!
//! What it searches: installed mods, profiles, and the bundled documentation pages. The docs
//! manifest is a resource next to the executable; when it cannot be located the tool returns
//! mods and profiles and says so in `sources`, rather than pretending the docs are empty.

#![allow(dead_code)]
use crate::mcp::tools::{mods, profiles};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct SearchHit {
    /// "mod" | "profile" | "doc"
    pub kind: String,
    pub id: String,
    pub title: String,
    /// Second line: author + version, mod count, doc section.
    pub subtitle: String,
    /// 0..100. Comparable WITHIN one response only — it is a match quality, not a rating.
    pub score: u32,
    /// How to act on it: the tool a caller should reach for next.
    pub next: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub query: String,
    pub hits: Vec<SearchHit>,
    /// Which sources actually contributed. A source missing here was unavailable, which is
    /// not the same as having no matches — the caller can tell the two apart.
    pub sources: Vec<String>,
    pub truncated: bool,
}

/// Fold case and strip the common accents, so "theme" finds "thème". Not a full Unicode
/// normalisation: BMM's data is mod names and file paths, and pulling in a normalisation
/// crate for the handful of accented characters that actually occur would be a poor trade.
fn fold(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

/// Score one term against one field. Mirrors the palette's ORDER of confidence (exact,
/// prefix, word start, substring) without its fuzzy tier — a subsequence match is a guess
/// worth offering to a human scanning a list, and mostly noise to a caller that will act on
/// the first result.
fn score_term(term: &str, text: &str) -> u32 {
    if term.is_empty() || text.is_empty() {
        return 0;
    }
    if text == term {
        return 100;
    }
    if text.starts_with(term) {
        return 80;
    }
    match text.find(term) {
        Some(0) => 80,
        Some(at) => {
            let prev = text[..at].chars().next_back().unwrap_or(' ');
            if prev.is_whitespace() || prev == '-' || prev == '_' || prev == '/' || prev == '.' {
                60
            } else {
                40
            }
        }
        None => 0,
    }
}

/// Every term must match somewhere, so a second word narrows the results instead of widening
/// them. The title outweighs the secondary text, which outweighs keywords.
fn score(terms: &[String], title: &str, subtitle: &str, keywords: &str) -> u32 {
    if terms.is_empty() {
        return 0;
    }
    let (t, s, k) = (fold(title), fold(subtitle), fold(keywords));
    let mut total = 0u32;
    for term in terms {
        let best = score_term(term, &t)
            .max(score_term(term, &s) * 55 / 100)
            .max(score_term(term, &k) * 40 / 100);
        if best == 0 {
            return 0;
        }
        total += best;
    }
    total / terms.len() as u32
}

fn terms_of(query: &str) -> Vec<String> {
    fold(query)
        .split(|c: char| c.is_whitespace() || c == '-' || c == '_' || c == '/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Locate the bundled docs manifest. The MCP server runs both as a sidecar next to the app
/// and from a dev checkout, so several layouts are tried; none of them is guaranteed, which
/// is why the caller is told whether docs were searched at all.
fn docs_manifest_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    let candidates = [
        dir.join("frontend/assets/docs/manifest.json"),
        dir.join("../frontend/assets/docs/manifest.json"),
        dir.join("../../frontend/assets/docs/manifest.json"),
        dir.join("../../../frontend/assets/docs/manifest.json"),
        dir.join("resources/frontend/assets/docs/manifest.json"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

fn doc_hits(terms: &[String], out: &mut Vec<SearchHit>) -> bool {
    let Some(path) = docs_manifest_path() else { return false };
    let Ok(raw) = std::fs::read_to_string(&path) else { return false };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else { return false };
    let Some(pages) = json.get("pages").and_then(|p| p.as_array()) else { return false };

    for page in pages {
        let path_s = page.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let title_en = page.pointer("/title/en").and_then(|v| v.as_str()).unwrap_or(path_s);
        let title_fr = page.pointer("/title/fr").and_then(|v| v.as_str()).unwrap_or("");
        let section = page.get("section").and_then(|v| v.as_str()).unwrap_or("");
        let sum_en = page.pointer("/summary/en").and_then(|v| v.as_str()).unwrap_or("");
        let sum_fr = page.pointer("/summary/fr").and_then(|v| v.as_str()).unwrap_or("");
        // Both languages are searchable whichever one the app displays: a caller asks in the
        // language it was prompted in, which need not be the app's.
        let keywords = format!("{} {} {} {}", title_fr, sum_en, sum_fr, path_s);
        let s = score(terms, title_en, section, &keywords);
        if s > 0 {
            out.push(SearchHit {
                kind: "doc".into(),
                id: path_s.to_string(),
                title: title_en.to_string(),
                subtitle: section.to_string(),
                score: s,
                next: format!("bmm_read_doc or open bmm://docs/open?page={}", path_s),
            });
        }
    }
    true
}

/// Search mods, profiles and documentation in one call.
pub fn search_all(query: &str, limit: usize) -> Result<SearchResults, String> {
    let terms = terms_of(query);
    if terms.is_empty() {
        return Err("Empty query.".into());
    }
    let limit = limit.clamp(1, 100);
    let mut hits: Vec<SearchHit> = Vec::new();
    let mut sources: Vec<String> = Vec::new();

    // A source that fails is skipped and simply not listed in `sources` — one unreadable
    // source must not fail the whole search.
    if let Ok(list) = mods::list_mods(None, None) {
        sources.push("mods".into());
        for m in list {
            let subtitle = match (&m.author, m.version.as_str()) {
                (Some(a), v) if !v.is_empty() => format!("{} · v{}", a, v),
                (Some(a), _) => a.clone(),
                (None, v) if !v.is_empty() => format!("v{}", v),
                _ => String::new(),
            };
            let s = score(&terms, &m.name, &subtitle, &m.tags.join(" "));
            if s > 0 {
                hits.push(SearchHit {
                    kind: "mod".into(),
                    id: m.id.clone(),
                    title: m.name.clone(),
                    subtitle,
                    score: s,
                    next: "bmm_get_mod / bmm_set_mod_enabled".into(),
                });
            }
        }
    }

    if let Ok(list) = profiles::list_profiles() {
        sources.push("profiles".into());
        for p in list {
            let subtitle = format!("{} · {} mods", p.game_name, p.active_mod_count);
            let s = score(&terms, &p.name, &subtitle, &p.game_name);
            if s > 0 {
                hits.push(SearchHit {
                    kind: "profile".into(),
                    id: p.id.clone(),
                    title: p.name.clone(),
                    subtitle,
                    score: s,
                    next: "bmm_get_profile / bmm_set_active_profile".into(),
                });
            }
        }
    }

    if doc_hits(&terms, &mut hits) {
        sources.push("docs".into());
    }

    // Highest score first; ties go to the shorter title, then alphabetically, so the same
    // query always produces the same order.
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(a.title.len().cmp(&b.title.len()))
            .then(a.title.cmp(&b.title))
    });
    let truncated = hits.len() > limit;
    hits.truncate(limit);

    Ok(SearchResults { query: query.to_string(), hits, sources, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiers_are_ordered() {
        assert!(score_term("mods", "mods") > score_term("mod", "mods"));
        assert!(score_term("deploy", "mod deployment") > score_term("eplo", "deploy"));
        assert_eq!(score_term("xyz", "deploy"), 0);
    }

    #[test]
    fn folding_crosses_accents() {
        assert_eq!(fold("Thèmes"), "themes");
        assert_eq!(fold("Profil Créé"), "profil cree");
        // and the reverse direction: an unaccented query matches accented text
        assert!(score(&terms_of("theme"), "Thèmes personnalisés", "", "") > 0);
    }

    #[test]
    fn every_term_must_match() {
        // Both words present → a hit.
        assert!(score(&terms_of("a10 skin"), "A10 Warthog Skin Pack", "", "") > 0);
        // One word absent → no hit at all, so a second word NARROWS the results.
        assert_eq!(score(&terms_of("a10 helicopter"), "A10 Warthog Skin Pack", "", ""), 0);
    }

    #[test]
    fn title_outranks_keywords() {
        let by_title = score(&terms_of("profiles"), "Profiles", "", "");
        let by_keyword = score(&terms_of("profiles"), "Deploy mods", "", "profiles switch");
        assert!(by_title > by_keyword, "{} should beat {}", by_title, by_keyword);
    }

    #[test]
    fn empty_query_is_an_error_not_everything() {
        assert!(search_all("", 10).is_err());
        assert!(search_all("   ", 10).is_err());
    }
}
