//! Secret redaction for the diagnostic reports BMM writes (crash and clean-exit zips).
//!
//! Those zips exist to be attached to a bug report, so whatever is inside them leaves the
//! machine. They used to carry the whole data file — GitHub token, local API token, the
//! per-plugin tokens, the OS-scheduler key — in clear.
//!
//! Two layers, because either one alone misses something:
//!
//! 1. **By key.** Any JSON written into a report (the data-file snapshot, the frontend dump)
//!    has every value under a secret-looking key replaced by a marker. The whole value goes:
//!    `plugin_tokens` is a map whose KEYS are the tokens, so redacting only string leaves
//!    would have kept every one of them.
//! 2. **By value.** Every secret found by layer 1 — in the live data file on disk as well as in
//!    the JSON handed over — is then scrubbed as a literal from EVERY text entry (logs,
//!    replay, dumps). A token that was logged, typed into a recorded input or echoed in an
//!    IPC argument is caught here even though no key names it. Pattern rules cover what no
//!    data file knows about: credentials inside URLs, `Authorization:` headers and the
//!    shapes of GitHub tokens.
//!
//! The marker says THAT a value was redacted and how long it was — never a prefix or suffix,
//! which for a short secret is most of it.

use regex::Regex;
use serde_json::Value;
use std::path::Path;
use std::sync::OnceLock;

/// Shorter literals are not scrubbed from free text: a 3-letter "secret" would mangle every
/// log line that happens to contain those letters. Every real secret BMM stores (UUID API
/// tokens, GitHub tokens, plugin tokens) is far longer. Under a secret KEY a value of any
/// length is still redacted — this only bounds the free-text pass.
pub const MIN_LITERAL_LEN: usize = 6;

/// The name of the entry a redacted report carries. Its presence is how the one-time pass over
/// reports written by older versions tells an already-clean zip from one it must rewrite.
pub const REDACTION_ENTRY: &str = "redaction.txt";

pub fn marker(len: usize) -> String {
    format!("[REDACTED: {} chars]", len)
}

/// `githubToken` / `github_token` / `GITHUB-TOKEN` → ["github", "token"].
fn key_words(k: &str) -> Vec<String> {
    let mut s = String::with_capacity(k.len() + 4);
    let mut prev_lower = false;
    for c in k.chars() {
        if c.is_ascii_uppercase() {
            if prev_lower {
                s.push('_');
            }
            s.push(c.to_ascii_lowercase());
            prev_lower = false;
        } else {
            prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
            s.push(c.to_ascii_lowercase());
        }
    }
    s.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect()
}

/// Does this JSON key name a secret?
///
/// Word-based, not substring-based: `author` is not `auth`, and `hotkey` is not `key`.
/// Errs toward redacting — hiding a harmless value in a crash report costs a little
/// debugging; keeping a secret costs the secret.
pub fn is_secret_key(k: &str) -> bool {
    const WORDS: &[&str] = &[
        "token", "tokens", "secret", "secrets", "password", "passwords", "passwd", "pwd",
        "passphrase", "cookie", "cookies", "webhook", "webhooks", "credential", "credentials",
        "creds", "jwt", "bearer", "authorization", "apikey", "privatekey", "sharekey",
        "signingkey", "auth", "oauth", "authz",
    ];
    let words = key_words(k);
    if words.iter().any(|w| WORDS.contains(&w.as_str())) {
        return true;
    }
    // `os_schedule_key`, `api_key`, `share_key`: a key ending in "key" is a key.
    matches!(words.last().map(String::as_str), Some("key") | Some("keys"))
}

fn marker_for(v: &Value) -> Value {
    match v {
        Value::Null => Value::Null,
        Value::String(s) => Value::String(marker(s.chars().count())),
        Value::Object(m) => Value::String(format!("[REDACTED: object with {} entries]", m.len())),
        Value::Array(a) => Value::String(format!("[REDACTED: list of {} items]", a.len())),
        other => Value::String(marker(other.to_string().chars().count())),
    }
}

fn collect_literals(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => {
            if s.chars().count() >= MIN_LITERAL_LEN {
                out.push(s.clone());
            }
        }
        Value::Object(m) => {
            for (k, v) in m {
                // Map KEYS can be the secret: plugin_tokens is token → plugin id.
                if k.chars().count() >= MIN_LITERAL_LEN {
                    out.push(k.clone());
                }
                collect_literals(v, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| collect_literals(x, out)),
        Value::Number(n) => {
            let s = n.to_string();
            if s.len() >= MIN_LITERAL_LEN {
                out.push(s);
            }
        }
        _ => {}
    }
}

/// Replace every value under a secret key, collecting what was removed.
fn redact_value(v: &mut Value, found: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            for (k, child) in m.iter_mut() {
                if is_secret_key(k) {
                    collect_literals(child, found);
                    *child = marker_for(child);
                } else {
                    redact_value(child, found);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| redact_value(x, found)),
        _ => {}
    }
}

struct Patterns {
    url_param: Regex,
    userinfo: Regex,
    header: Regex,
    bearer: Regex,
    github: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        // ?password=… / &token=… / ?k=… (a BCWEB share key) inside any URL or query string.
        url_param: Regex::new(
            r#"(?i)([?&](?:password|passwd|pass|pwd|passphrase|token|access_token|refresh_token|id_token|api_key|apikey|key|k|secret|client_secret|auth|code)=)([^&#\s"'<>]+)"#,
        )
        .expect("url_param regex"),
        // scheme://user:PASSWORD@host
        userinfo: Regex::new(r#"(?i)([a-z][a-z0-9+.\-]*://[^/\s:@"'<>]+:)([^@/\s"'<>]+)(@)"#)
            .expect("userinfo regex"),
        // Authorization: Bearer X / X-Repo-Password: X / "x-bmm-token": "X"
        header: Regex::new(
            r#"(?i)((?:authorization|proxy-authorization|x-[a-z0-9\-]*(?:token|password|secret|key)|api[-_]?key|set-cookie|cookie)"?\s*[:=]\s*"?(?:(?:bearer|basic|token)\s+)?)([^\s"',;]+)"#,
        )
        .expect("header regex"),
        bearer: Regex::new(r#"(?i)(\bbearer\s+)([A-Za-z0-9._~+/=\-]{8,})"#).expect("bearer regex"),
        github: Regex::new(r#"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"#)
            .expect("github regex"),
    })
}

/// Replace capture group `g` of every match with a marker, leaving markers already written
/// alone (a literal pass may already have put `[REDACTED: …]` where the value was).
fn replace_group(re: &Regex, text: &str, g: usize) -> String {
    re.replace_all(text, |c: &regex::Captures| {
        let whole = c.get(0).map(|m| m.as_str()).unwrap_or("");
        let Some(val) = c.get(g) else { return whole.to_string() };
        if val.as_str().starts_with("[REDACTED") {
            return whole.to_string();
        }
        let start = c.get(0).unwrap().start();
        let (a, b) = (val.start() - start, val.end() - start);
        format!("{}{}{}", &whole[..a], marker(val.as_str().chars().count()), &whole[b..])
    })
    .into_owned()
}

fn replace_bytes(hay: &[u8], needle: &[u8], with: &[u8]) -> Vec<u8> {
    if needle.is_empty() || hay.len() < needle.len() {
        return hay.to_vec();
    }
    let mut out = Vec::with_capacity(hay.len());
    let mut i = 0;
    while i < hay.len() {
        if hay[i..].starts_with(needle) {
            out.extend_from_slice(with);
            i += needle.len();
        } else {
            out.push(hay[i]);
            i += 1;
        }
    }
    out
}

/// Collects the secrets that must not appear in a report, then scrubs text with them.
#[derive(Default)]
pub struct Redactor {
    literals: Vec<String>,
}

impl Redactor {
    pub fn new() -> Self {
        Self::default()
    }

    fn add_literals(&mut self, mut found: Vec<String>) {
        self.literals.append(&mut found);
        // Longest first, so a secret that contains another is replaced whole.
        self.literals.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        self.literals.dedup();
    }

    /// Learn every secret held in a JSON document (the data file, a snapshot, a dump).
    pub fn absorb_json_text(&mut self, text: &str) {
        if let Ok(mut v) = serde_json::from_str::<Value>(text) {
            let mut found = Vec::new();
            redact_value(&mut v, &mut found);
            self.add_literals(found);
        }
    }

    /// Learn the secrets in the live data file. Missing or unreadable is not an error: the
    /// report is still written, and the key and pattern layers still apply.
    pub fn absorb_data_file(&mut self, path: &Path) {
        if let Ok(text) = std::fs::read_to_string(path) {
            self.absorb_json_text(&text);
        }
    }

    /// Free text: every known secret, then URL credentials, auth headers and token shapes.
    pub fn scrub_text(&self, text: &str) -> String {
        let mut s = text.to_string();
        for lit in &self.literals {
            if s.contains(lit.as_str()) {
                s = s.replace(lit.as_str(), &marker(lit.chars().count()));
            }
            // The same secret as it appears inside a JSON string (escaped quotes/backslashes).
            if let Ok(q) = serde_json::to_string(lit) {
                let esc = &q[1..q.len() - 1];
                if esc != lit && s.contains(esc) {
                    s = s.replace(esc, &marker(lit.chars().count()));
                }
            }
        }
        let p = patterns();
        s = replace_group(&p.url_param, &s, 2);
        s = replace_group(&p.userinfo, &s, 2);
        s = replace_group(&p.header, &s, 2);
        s = replace_group(&p.bearer, &s, 2);
        s = p
            .github
            .replace_all(&s, |c: &regex::Captures| marker(c[0].chars().count()))
            .into_owned();
        s
    }

    /// A JSON document: secret keys redacted structurally, then the text pass over the result.
    /// Not JSON (a truncated dump, say) → the text pass alone.
    pub fn redact_json_text(&self, text: &str) -> String {
        match serde_json::from_str::<Value>(text) {
            Ok(mut v) => {
                let mut found = Vec::new();
                redact_value(&mut v, &mut found);
                let out = serde_json::to_string_pretty(&v).unwrap_or_default();
                // Secrets found HERE but not absorbed beforehand are scrubbed too.
                let mut local = Redactor { literals: self.literals.clone() };
                local.add_literals(found);
                local.scrub_text(&out)
            }
            Err(_) => self.scrub_text(text),
        }
    }

    /// Bytes of an entry that may or may not be text (the session replay, a legacy entry).
    pub fn scrub_bytes(&self, bytes: &[u8]) -> Vec<u8> {
        match std::str::from_utf8(bytes) {
            Ok(s) => self.scrub_text(s).into_bytes(),
            Err(_) => {
                let mut out = bytes.to_vec();
                for lit in &self.literals {
                    out = replace_bytes(&out, lit.as_bytes(), marker(lit.chars().count()).as_bytes());
                }
                out
            }
        }
    }
}

/// The note every redacted report carries (and the marker of one).
pub fn redaction_note() -> String {
    "Secrets in this report were redacted before it was written.\n\
     Values under token / secret / password / key / auth / cookie / webhook / credential\n\
     fields, credentials inside URLs, Authorization headers and GitHub tokens appear as\n\
     [REDACTED: N chars]. The length is kept; no part of the value is.\n\
     DxDiag is not part of this report: it is attached separately, only when you tick it.\n"
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_keys_are_recognised_by_word_not_substring() {
        for k in [
            "github_token", "githubToken", "api_token", "apiToken", "os_schedule_key",
            "plugin_tokens", "password", "X-Repo-Password", "passphrase", "cookie",
            "webhookUrl", "credentials", "authorization", "auth", "key_auth_keys", "apiKey",
            "shareKey", "client_secret",
        ] {
            assert!(is_secret_key(k), "{k} must be treated as a secret");
        }
        for k in ["author", "author_id", "authors", "hotkey", "api_port", "language", "name", "url", "id"] {
            assert!(!is_secret_key(k), "{k} is not a secret");
        }
    }

    /// Every settings field whose NAME smells of a secret must be classified as one. A field
    /// added later (`discord_webhook`, `bc_session_token`…) fails here instead of shipping
    /// in clear in the next crash zip.
    #[test]
    fn every_secret_looking_settings_field_is_redacted() {
        let v = serde_json::to_value(crate::state::AppSettings::default()).unwrap();
        let keys: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        for must in ["github_token", "api_token", "os_schedule_key", "plugin_tokens"] {
            assert!(keys.iter().any(|k| k == must), "settings field {must} was renamed — update the redaction tests");
            assert!(is_secret_key(must));
        }
        const SMELLS: &[&str] = &["token", "secret", "password", "passwd", "passphrase", "key", "auth", "cookie", "webhook", "credential", "jwt"];
        for k in &keys {
            let lk = k.to_ascii_lowercase();
            if SMELLS.iter().any(|s| lk.contains(s)) {
                assert!(is_secret_key(k), "settings field `{k}` looks secret but would be written in clear");
            }
        }
    }

    #[test]
    fn marker_never_keeps_a_prefix() {
        let mut r = Redactor::new();
        r.absorb_json_text(r#"{"github_token":"ghp_abcdefghijklmnopqrstuvwxyz0123456789"}"#);
        let out = r.scrub_text("token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 end");
        assert!(!out.contains("ghp_"), "{out}");
        assert!(out.contains("[REDACTED: 40 chars]"), "{out}");
    }

    #[test]
    fn map_keys_under_a_secret_key_are_secrets_too() {
        let mut r = Redactor::new();
        r.absorb_json_text(r#"{"settings":{"plugin_tokens":{"tok-plugin-aaaaaaaa":"com.x.plugin"}}}"#);
        let red = r.redact_json_text(r#"{"settings":{"plugin_tokens":{"tok-plugin-aaaaaaaa":"com.x.plugin"}}}"#);
        assert!(!red.contains("tok-plugin-aaaaaaaa"), "{red}");
        assert!(r.scrub_text("called by tok-plugin-aaaaaaaa").contains("[REDACTED: 19 chars]"));
    }

    #[test]
    fn url_credentials_and_headers_are_scrubbed_without_any_data_file() {
        let r = Redactor::new();
        let out = r.scrub_text(
            "GET https://repo.example/r.json?password=hunter2hunter&x=1 \
             https://bob:s3cretpass@host.example/p \
             Authorization: Bearer abcdefghijklmnop \
             X-Repo-Password: repo-pass-value",
        );
        for bad in ["hunter2hunter", "s3cretpass", "abcdefghijklmnop", "repo-pass-value"] {
            assert!(!out.contains(bad), "{bad} survived: {out}");
        }
        assert!(out.contains("x=1"), "a harmless param must survive: {out}");
    }
}
