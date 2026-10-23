//! ONE catalogue format, and how every catalogue BMM already reads becomes it.
//!
//! BMM reads catalogues of eight kinds, and each kind grew its own document: `apps` with a
//! nested `download`, `plugins` with a flat `download_url`, `themes` as an object OR a bare
//! array (with the theme body sometimes inline), `presets`, `modpacks` (sometimes inside a
//! `.cbmp` zip with `file` instead of an address), `repos` (object or bare array),
//! `tutorials` (or BCWEB's pooled `items` with a `kind`), `lists`. Then a catalogue INDEX
//! (`catalogs: [{type,url}]`), BCWEB v1's feed (the same BMM-native shapes), and BetterCommunity
//! v2's signed feed (a DSSE envelope around a `CatalogFeedDoc`). Ten readers, none of them
//! able to say what a document IS before trying to read it.
//!
//! The universal format says so about itself, the way a repo manifest does since format 1.0
//! (`repo_format.rs`, whose naming this follows):
//!
//! ```json
//! { "format": "bmm-catalog", "format_version": 1, "name": "…", "items": [ { "kind": "plugin", … } ] }
//! ```
//!
//! `format_version` rather than `version`: every v1 catalogue already uses `version` for the
//! DOCUMENT's own version ("1.0"), exactly the confusion repo.json had before 1.0.
//!
//! This module owns, on `serde_json::Value` (a legacy document is exactly what a strict
//! struct cannot read), with no `crate::` path so it can be mounted alone:
//!
//!  - detection of every variant ([`detect`]);
//!  - conversion of any variant to the universal document ([`normalize`]);
//!  - validation with paths and severities ([`validate`]);
//!  - the reverse view a legacy reader consumes ([`to_legacy`], [`legacy_view`]), so the
//!    existing loaders read a universal or signed catalogue without being rewritten;
//!  - DSSE v1 + Ed25519 verification, byte-for-byte the scheme BetterCommunity v2 signs its
//!    feeds with (`packages/services/src/catalog/feed.ts`, ADR 0010 §2) ([`verify_envelope`]).

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// The value of `format` in a universal catalogue.
pub const FORMAT: &str = "bmm-catalog";
/// The format version BMM writes. An integer: a catalogue has no minor revisions to speak of,
/// a field added later is optional and ignored by an older reader.
pub const FORMAT_VERSION: u64 = 1;
/// The DSSE `payloadType` of a SIGNED universal catalogue.
pub const BMM_PAYLOAD_TYPE: &str = "application/vnd.bettermodsmanager.catalog+json; version=1";
/// The DSSE `payloadType` BetterCommunity v2 signs its feeds with (`CATALOG_FEED_TYPE` in
/// `@bc/contracts`). Restated, not imported: the two must be equal byte for byte.
pub const V2_FEED_TYPE: &str = "application/vnd.bettercommunity.catalog-feed+json; version=1";
/// v2 refuses an envelope with more signatures than this; so do we.
pub const MAX_SIGNATURES: usize = 4;
/// Beyond this a catalogue is refused rather than read: a feed is a list, not a dump.
pub const MAX_ITEMS: usize = 10_000;
const ISSUE_CAP: usize = 200;

/// Every item kind, and the array its v1 document keeps entries in. Same pairs as
/// `catalog_store::CATALOG_KINDS` (minus `index`); a test in `catalog_convert` pins them.
pub const KINDS: &[(&str, &str)] = &[
    ("app", "apps"),
    ("plugin", "plugins"),
    ("theme", "themes"),
    ("preset", "presets"),
    ("modpack", "modpacks"),
    ("repo", "repos"),
    ("tutorial", "tutorials"),
    ("list", "lists"),
];

pub fn is_kind(k: &str) -> bool { KINDS.iter().any(|(n, _)| *n == k) }
pub fn array_of(kind: &str) -> Option<&'static str> { KINDS.iter().find(|(k, _)| *k == kind).map(|(_, a)| *a) }

/// v2 catalogue templates → BMM kinds. The same table as v2's own v1 compatibility layer
/// (`services/src/compat/catalog-feed.ts`: APP reads `mods`, MODPACK reads `resources`, LIST
/// reads `links`), so an item reads as the same kind through either door.
pub fn kind_of_template(t: &str) -> Option<&'static str> {
    Some(match t {
        "mods" => "app",
        "plugins" => "plugin",
        "themes" => "theme",
        "presets" => "preset",
        "resources" => "modpack",
        "tutorials" => "tutorial",
        "links" => "list",
        _ => return None,
    })
}

// ── detection ────────────────────────────────────────────────────────────────

/// Every document shape in circulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Variant {
    /// `format: "bmm-catalog"` — this format.
    Universal,
    /// A DSSE v1 envelope (BC v2 feed, or a signed universal catalogue).
    Dsse,
    /// BC v2 `CatalogFeedDoc` (`kind: "catalog"`), the payload of a v2 feed.
    V2Feed,
    /// BC v2 `CatalogFeedIndexDoc` (`kind: "index"`).
    V2Index,
    /// BMM/BCWEB catalogue index (`catalogs: [{type,url}]`, `kind: "catalog-index"`).
    BmmIndex,
    /// A v1 BMM-native catalogue: one or more of apps/plugins/themes/presets/modpacks/repos/
    /// tutorials/lists. BCWEB v1's `catalog.json` and BC v2's compat feed are this shape.
    BmmV1,
    /// BCWEB pooled `items: [{kind, …, meta}]`.
    BcwebItems,
    /// A bare JSON array: the legacy theme catalogue or BMM's repo browse list.
    BareArray,
    /// None of the above.
    Unknown,
}

impl Variant {
    pub fn label(self) -> &'static str {
        match self {
            Variant::Universal => "bmm-catalog (universal)",
            Variant::Dsse => "DSSE signed envelope",
            Variant::V2Feed => "BetterCommunity v2 feed",
            Variant::V2Index => "BetterCommunity v2 feed index",
            Variant::BmmIndex => "catalogue index",
            Variant::BmmV1 => "BMM v1 catalogue",
            Variant::BcwebItems => "BCWEB pooled items",
            Variant::BareArray => "bare array (v1 themes / repo list)",
            Variant::Unknown => "not a catalogue",
        }
    }
}

fn is_envelope(v: &Value) -> bool {
    v.get("payloadType").is_some() && v.get("payload").is_some() && v.get("signatures").is_some()
}

/// The same narrow rule as `looksLikeIndex` in catalog-index.ts: the marker, or a non-empty
/// `catalogs` array every entry of which has a string url AND type.
pub fn looks_like_index(v: &Value) -> bool {
    let Some(o) = v.as_object() else { return false };
    let cats = o.get("catalogs").and_then(Value::as_array);
    if o.get("kind").and_then(Value::as_str).map(|k| k.eq_ignore_ascii_case("catalog-index")).unwrap_or(false)
        && cats.is_some()
    {
        return true;
    }
    match cats {
        Some(a) if !a.is_empty() => a.iter().all(|e| {
            e.get("url").map(Value::is_string).unwrap_or(false) && e.get("type").map(Value::is_string).unwrap_or(false)
        }),
        _ => false,
    }
}

/// What a document is. Shape, never the address it came from.
pub fn detect(v: &Value) -> Variant {
    if v.is_array() {
        return Variant::BareArray;
    }
    let Some(o) = v.as_object() else { return Variant::Unknown };
    if is_envelope(v) {
        return Variant::Dsse;
    }
    if o.get("format").and_then(Value::as_str) == Some(FORMAT) {
        return Variant::Universal;
    }
    let kind = o.get("kind").and_then(Value::as_str).unwrap_or("");
    if kind == "catalog" && o.get("catalog").map(Value::is_object).unwrap_or(false) && o.get("items").map(Value::is_array).unwrap_or(false) {
        return Variant::V2Feed;
    }
    if kind == "index" && o.get("catalogs").and_then(Value::as_array).is_some() {
        return Variant::V2Index;
    }
    if looks_like_index(v) {
        return Variant::BmmIndex;
    }
    if KINDS.iter().any(|(_, a)| o.get(*a).map(Value::is_array).unwrap_or(false)) {
        return Variant::BmmV1;
    }
    if o.get("items").and_then(Value::as_array).map(|a| a.iter().any(|x| x.get("kind").is_some())).unwrap_or(false) {
        return Variant::BcwebItems;
    }
    Variant::Unknown
}

// ── issues ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity { Error, Warning, Info }

/// One finding, at a JSON path (`items[3].download.sha256`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    pub severity: Severity,
    /// Stable machine code (`item.no_id`, `download.bad_sha256`, …): the words can change,
    /// these do not.
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Default)]
struct Issues(Vec<Issue>);
impl Issues {
    fn push(&mut self, severity: Severity, code: &str, path: impl Into<String>, message: impl Into<String>) {
        if self.0.len() < ISSUE_CAP {
            self.0.push(Issue { severity, code: code.into(), path: path.into(), message: message.into() });
        }
    }
    fn err(&mut self, c: &str, p: impl Into<String>, m: impl Into<String>) { self.push(Severity::Error, c, p, m) }
    fn warn(&mut self, c: &str, p: impl Into<String>, m: impl Into<String>) { self.push(Severity::Warning, c, p, m) }
    fn info(&mut self, c: &str, p: impl Into<String>, m: impl Into<String>) { self.push(Severity::Info, c, p, m) }
}

// ── small readers ────────────────────────────────────────────────────────────

/// A non-empty trimmed string, capped.
fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(|x| x.chars().take(4000).collect())
}
fn first(v: &Value, keys: &[&str]) -> Option<String> { keys.iter().find_map(|k| s(v, k)) }
fn strings(v: Option<&Value>, cap: usize) -> Vec<String> {
    v.and_then(Value::as_array).into_iter().flatten()
        .filter_map(Value::as_str).map(str::trim).filter(|x| !x.is_empty())
        .take(cap).map(String::from).collect()
}
/// `{ "fr": "…" }` with string values only; anything else is dropped.
fn i18n(v: Option<&Value>) -> Option<Value> {
    let o = v?.as_object()?;
    let m: Map<String, Value> = o.iter()
        .filter_map(|(k, x)| x.as_str().map(|t| (k.trim().to_ascii_lowercase(), Value::String(t.to_string()))))
        .filter(|(k, _)| !k.is_empty() && k.len() <= 16)
        .collect();
    if m.is_empty() { None } else { Some(Value::Object(m)) }
}
fn num(v: &Value, key: &str) -> Option<Value> {
    v.get(key).filter(|x| x.as_u64().is_some() || x.as_f64().map(|f| f >= 0.0).unwrap_or(false)).cloned()
}
/// `sha256:ABC…` → `abc…`. A value that is not 64 hex digits is kept as written so the
/// validator can name it; silently dropping it would turn a bad hash into "no hash".
pub fn clean_sha(raw: &str) -> String {
    let t = raw.trim();
    let t = t.strip_prefix("sha256:").or_else(|| t.strip_prefix("SHA256:")).unwrap_or(t);
    if t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit()) { t.to_ascii_lowercase() } else { t.to_string() }
}
pub fn is_sha256(s: &str) -> bool { s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) }

fn put(m: &mut Map<String, Value>, k: &str, v: Option<Value>) {
    if let Some(v) = v { m.insert(k.into(), v); }
}
fn put_s(m: &mut Map<String, Value>, k: &str, v: Option<String>) { put(m, k, v.map(Value::String)) }

fn download(url: Option<String>, sha: Option<String>, size: Option<Value>, file_type: Option<String>) -> Option<Value> {
    let url = url?;
    let mut d = Map::new();
    d.insert("url".into(), Value::String(url));
    put_s(&mut d, "sha256", sha.map(|x| clean_sha(&x)));
    put(&mut d, "size", size);
    put_s(&mut d, "file_type", file_type);
    Some(Value::Object(d))
}

/// The fields every kind shares, read from a v1 entry.
fn base(kind: &str, e: &Value, id: Option<String>, name: Option<String>) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("kind".into(), Value::String(kind.into()));
    put_s(&mut m, "id", id);
    put_s(&mut m, "name", name);
    put(&mut m, "name_i18n", i18n(e.get("name_i18n")));
    put_s(&mut m, "summary", s(e, "summary"));
    put_s(&mut m, "description", s(e, "description"));
    put(&mut m, "description_i18n", i18n(e.get("description_i18n")));
    put_s(&mut m, "version", s(e, "version"));
    put_s(&mut m, "author", s(e, "author"));
    let tags = strings(e.get("tags"), 32);
    if !tags.is_empty() { m.insert("tags".into(), json!(tags)); }
    m
}

/// Keys of `e` not in `known`, kept under `extra` so nothing a publisher wrote is lost in the
/// conversion (a theme's inline `vars`, an app's `requirements`, a future field).
fn extra_of(e: &Value, known: &[&str]) -> Option<Value> {
    let o = e.as_object()?;
    let m: Map<String, Value> = o.iter()
        .filter(|(k, v)| !known.contains(&k.as_str()) && !k.starts_with('_') && !v.is_null())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if m.is_empty() { None } else { Some(Value::Object(m)) }
}

const COMMON: &[&str] = &["kind", "id", "slug", "name", "title", "name_i18n", "summary", "description", "description_i18n", "version", "author", "tags", "sha256"];

fn known(extra: &[&'static str]) -> Vec<&'static str> {
    let mut k: Vec<&'static str> = COMMON.to_vec();
    k.extend_from_slice(extra);
    k
}

/// One v1 entry → one universal item. `None` when the entry is not even an object.
pub fn item_from_v1(kind: &str, e: &Value) -> Option<Value> {
    if !e.is_object() { return None; }
    let id = first(e, &["id", "slug"]);
    let item = match kind {
        "app" => {
            let mut m = base(kind, e, id, first(e, &["title", "name"]));
            let dl = e.get("download").cloned().unwrap_or(Value::Null);
            put(&mut m, "download", download(s(&dl, "url"), s(&dl, "sha256"), num(&dl, "size"), s(&dl, "file_type")));
            put_s(&mut m, "icon", e.get("images").and_then(|i| s(i, "thumb")));
            put(&mut m, "extra", extra_of(e, &known(&["download"])));
            m
        }
        "plugin" => {
            let mut m = base(kind, e, id, first(e, &["name", "title"]));
            put_s(&mut m, "game", s(e, "game"));
            put(&mut m, "download", download(first(e, &["download_url", "downloadUrl"]), s(e, "sha256"), num(e, "size"), None));
            put_s(&mut m, "icon", s(e, "icon_url"));
            put(&mut m, "extra", extra_of(e, &known(&["game", "download_url", "downloadUrl", "size", "icon_url"])));
            m
        }
        "theme" => {
            let mut m = base(kind, e, id, first(e, &["name", "title"]));
            put(&mut m, "download", download(first(e, &["download_url", "downloadUrl", "url"]), s(e, "sha256"), num(e, "size"), None));
            put(&mut m, "extra", extra_of(e, &known(&["download_url", "downloadUrl", "url", "size"])));
            m
        }
        "preset" | "list" | "tutorial" | "modpack" | "repo" => {
            let mut m = base(kind, e, id.clone(), first(e, &["name", "title"]));
            let meta = e.get("meta").cloned().unwrap_or(Value::Null);
            let url = first(e, &["download_url", "downloadUrl", "url"]).or_else(|| first(&meta, &["download_url", "downloadUrl"]));
            if kind == "repo" && m.get("id").is_none() {
                // A repo list entry is named by its address; that IS its identity.
                put_s(&mut m, "id", url.clone());
            }
            put_s(&mut m, "game", s(e, "game"));
            put(&mut m, "download", download(url, s(e, "sha256"), num(e, "size"), None));
            put(&mut m, "extra", extra_of(e, &known(&["download_url", "downloadUrl", "url", "size", "game", "meta"])));
            m
        }
        _ => return None,
    };
    Some(Value::Object(item))
}

// ── normalisation ────────────────────────────────────────────────────────────

/// Options for [`normalize`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizeOptions {
    /// What the caller expects (`plugin`, `theme`, …). Decides the one ambiguous shape — a
    /// bare array — and is otherwise only checked against what the document holds.
    pub kind: Option<String>,
    /// Where the document came from. Used for the pinned-issuer rule of signatures only.
    pub source_url: Option<String>,
    /// Keys a signature may verify against (as `/v2/feeds/keys` publishes them).
    #[serde(default)]
    pub keys: Vec<TrustedKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Normalized {
    /// The universal document. Empty (no items) when the input was refused.
    pub catalog: Value,
    /// What the input was.
    pub variant: Variant,
    pub variant_label: String,
    /// For a signed input, the variant of its payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_variant: Option<Variant>,
    pub signature: SignatureReport,
    /// True when BMM must not use this document: invalid signature, unreadable, too new.
    pub refused: bool,
    pub issues: Vec<Issue>,
}

fn empty_catalog(name: &str) -> Value {
    json!({ "format": FORMAT, "format_version": FORMAT_VERSION, "name": name, "items": [] })
}

/// Text → universal. Never panics, never errors: what it could not read is an issue.
pub fn normalize_text(text: &str, opts: &NormalizeOptions) -> Normalized {
    match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
        Ok(v) => normalize(&v, opts),
        Err(e) => {
            let mut is = Issues::default();
            is.err("json.parse", "$", format!("not JSON: {e}"));
            Normalized {
                catalog: empty_catalog(""), variant: Variant::Unknown, variant_label: Variant::Unknown.label().into(),
                inner_variant: None, signature: SignatureReport::unsigned(), refused: true, issues: is.0,
            }
        }
    }
}

/// Any variant → universal, plus validation of the result.
pub fn normalize(v: &Value, opts: &NormalizeOptions) -> Normalized {
    let variant = detect(v);
    let mut is = Issues::default();
    let mut signature = SignatureReport::unsigned();
    let mut inner_variant = None;
    let mut refused = false;

    let catalog = if variant == Variant::Dsse {
        let (rep, payload) = verify_envelope(v, &opts.keys, opts.source_url.as_deref());
        signature = rep;
        match (signature.status, payload) {
            (SigStatus::Invalid, _) | (_, None) => {
                is.err("signature.invalid", "$.signatures", signature.reason.clone().unwrap_or_else(|| "the signature does not verify".into()));
                refused = true;
                empty_catalog("")
            }
            (_, Some(bytes)) => match serde_json::from_slice::<Value>(&bytes) {
                Ok(inner) => {
                    let iv = detect(&inner);
                    inner_variant = Some(iv);
                    if iv == Variant::Dsse {
                        is.err("signature.nested", "$.payload", "an envelope inside an envelope is not read");
                        refused = true;
                        empty_catalog("")
                    } else {
                        convert(&inner, iv, opts, &mut is, "$.payload")
                    }
                }
                Err(e) => {
                    is.err("json.payload", "$.payload", format!("the signed payload is not JSON: {e}"));
                    refused = true;
                    empty_catalog("")
                }
            },
        }
    } else {
        // Unsigned. Fine — most catalogues are — UNLESS the source's key is pinned: then a
        // document without its signature is a downgrade, and is refused exactly like a bad one.
        if let Some(src) = opts.source_url.as_deref() {
            if pinned_for(src, &opts.keys) {
                signature = SignatureReport { status: SigStatus::Invalid, payload_type: None, keyid: None,
                    reason: Some("this source's key is pinned and the document is not signed".into()) };
                is.err("signature.missing", "$", "this source's key is pinned and the document is not signed");
                refused = true;
            }
        }
        if refused { empty_catalog("") } else { convert(v, variant, opts, &mut is, "$") }
    };

    if signature.status == SigStatus::UnknownKey {
        is.warn("signature.unknown_key", "$.signatures", "signed, but by a key this BMM does not know: read as unverified");
    }

    let mut catalog = catalog;
    if !refused {
        let mut found = Issues::default();
        validate_into(&catalog, &mut found);
        is.0.extend(found.0);
        if is.0.iter().any(|i| i.code == "format.too_new") { refused = true; }
        // Drop items that cannot be used at all (no id, unknown kind); the issues say which.
        if let Some(items) = catalog.get_mut("items").and_then(Value::as_array_mut) {
            items.retain(|it| it.get("id").and_then(Value::as_str).is_some()
                && it.get("kind").and_then(Value::as_str).map(is_kind).unwrap_or(false));
        }
    }
    if let (Some(k), false) = (opts.kind.as_deref(), refused) {
        let any = catalog.get("items").and_then(Value::as_array).map(|a| a.iter().any(|i| i["kind"] == k)).unwrap_or(false);
        let links = catalog.get("catalogs").and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(false);
        if is_kind(k) && !any && !links {
            is.info("kind.none", "$.items", format!("no {k} item in this catalogue"));
        }
    }
    dedupe_issues(&mut is.0);
    Normalized { catalog, variant, variant_label: variant.label().into(), inner_variant, signature, refused, issues: is.0 }
}

fn dedupe_issues(v: &mut Vec<Issue>) {
    let mut seen = std::collections::HashSet::new();
    v.retain(|i| seen.insert((i.code.clone(), i.path.clone())));
}

fn head_from_v1(v: &Value) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("format".into(), json!(FORMAT));
    m.insert("format_version".into(), json!(FORMAT_VERSION));
    put_s(&mut m, "id", s(v, "id"));
    m.insert("name".into(), Value::String(s(v, "name").unwrap_or_default()));
    put(&mut m, "name_i18n", i18n(v.get("name_i18n")));
    put_s(&mut m, "description", s(v, "description"));
    put(&mut m, "description_i18n", i18n(v.get("description_i18n")));
    put_s(&mut m, "publisher", first(v, &["publisher", "owner", "author"]));
    put_s(&mut m, "homepage", s(v, "homepage"));
    put_s(&mut m, "app", s(v, "app"));
    put_s(&mut m, "updated_at", first(v, &["updated_at", "updatedAt", "generated_at"]));
    // A v1 document's own version ("1.0") is the publisher's, not the format's: kept apart.
    put_s(&mut m, "catalog_version", s(v, "version"));
    for k in ["partner_catalogs", "community_imports"] {
        let l = strings(v.get(k), 200);
        if !l.is_empty() { m.insert(k.into(), json!(l)); }
    }
    m
}

fn links_from_index(arr: &[Value], is: &mut Issues, at: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for (i, e) in arr.iter().enumerate() {
        let kind = s(e, "type").or_else(|| s(e, "kind")).map(|k| k.to_ascii_lowercase());
        let url = s(e, "url");
        let (Some(kind), Some(url)) = (kind, url) else {
            is.warn("index.entry", format!("{at}.catalogs[{i}]"), "an index entry needs a type and a url");
            continue;
        };
        let mut m = Map::new();
        m.insert("kind".into(), Value::String(kind));
        m.insert("url".into(), Value::String(url));
        for k in ["name", "description", "owner", "app"] { put_s(&mut m, k, s(e, k)); }
        put(&mut m, "items", num(e, "items"));
        put_s(&mut m, "updated_at", first(e, &["updated_at", "updatedAt"]));
        out.push(Value::Object(m));
    }
    out
}

fn convert(v: &Value, variant: Variant, opts: &NormalizeOptions, is: &mut Issues, at: &str) -> Value {
    match variant {
        Variant::Universal => {
            let mut c = v.clone();
            // Cleaned in place: hashes lower-cased, a `sha256:` prefix dropped. Nothing else
            // is rewritten — the publisher's document is the truth.
            if let Some(items) = c.get_mut("items").and_then(Value::as_array_mut) {
                for it in items.iter_mut() {
                    if let Some(sha) = it.pointer("/download/sha256").and_then(Value::as_str).map(clean_sha) {
                        it["download"]["sha256"] = Value::String(sha);
                    }
                }
            }
            c
        }
        Variant::BmmV1 | Variant::BareArray | Variant::BcwebItems => {
            let mut head = if v.is_object() { head_from_v1(v) } else { head_from_v1(&json!({})) };
            let mut items: Vec<Value> = Vec::new();
            let mut take = |kind: &str, arr: &[Value], path: String, items: &mut Vec<Value>| {
                for (i, e) in arr.iter().enumerate() {
                    match item_from_v1(kind, e) {
                        Some(it) => items.push(it),
                        None => is.warn("item.not_object", format!("{path}[{i}]"), "not an object: dropped"),
                    }
                }
            };
            if let Some(arr) = v.as_array() {
                // The one ambiguous shape. The caller's kind decides; failing that, an entry
                // with theme colours is a theme catalogue, one with only an address a repo list.
                let kind = match opts.kind.as_deref() {
                    Some(k @ ("theme" | "repo")) => k.to_string(),
                    _ if arr.iter().any(|e| e.get("vars").is_some() || e.get("colors").is_some()) => "theme".into(),
                    _ if !arr.is_empty() && arr.iter().all(|e| e.get("url").is_some() && e.get("vars").is_none()) => "repo".into(),
                    _ => "theme".into(),
                };
                take(&kind, arr, at.to_string(), &mut items);
            } else {
                for (kind, key) in KINDS {
                    if let Some(arr) = v.get(*key).and_then(Value::as_array) {
                        take(kind, arr, format!("{at}.{key}"), &mut items);
                    }
                }
                // BCWEB's pooled `items: [{kind, …}]`. A document carrying a kind under BOTH
                // its own array and `items` (tutorials do, for two generations of reader)
                // yields each entry once: the dedupe below keeps the first.
                if let Some(arr) = v.get("items").and_then(Value::as_array) {
                    for (i, e) in arr.iter().enumerate() {
                        let kind = s(e, "kind").map(|k| k.to_ascii_lowercase()).unwrap_or_default();
                        if !is_kind(&kind) {
                            is.warn("item.kind", format!("{at}.items[{i}].kind"), format!("unknown kind {kind:?}: dropped"));
                            continue;
                        }
                        // A pooled entry keeps its fields under `meta`; lift them.
                        let mut flat = e.clone();
                        if let (Some(meta), Some(o)) = (e.get("meta").and_then(Value::as_object), flat.as_object_mut()) {
                            for (k, x) in meta { o.entry(k.clone()).or_insert_with(|| x.clone()); }
                        }
                        if let Some(it) = item_from_v1(&kind, &flat) { items.push(it); }
                    }
                }
            }
            let mut seen = std::collections::HashSet::new();
            items.retain(|it| {
                let key = format!("{}\u{0}{}", it["kind"].as_str().unwrap_or(""), it["id"].as_str().unwrap_or("").to_ascii_lowercase());
                it.get("id").is_none() || seen.insert(key)
            });
            head.insert("items".into(), Value::Array(items));
            Value::Object(head)
        }
        Variant::BmmIndex => {
            let mut head = head_from_v1(v);
            let arr = v.get("catalogs").and_then(Value::as_array).cloned().unwrap_or_default();
            head.insert("items".into(), json!([]));
            head.insert("catalogs".into(), Value::Array(links_from_index(&arr, is, at)));
            Value::Object(head)
        }
        Variant::V2Feed => from_v2_feed(v, is, at),
        Variant::V2Index => {
            let mut head = Map::new();
            head.insert("format".into(), json!(FORMAT));
            head.insert("format_version".into(), json!(FORMAT_VERSION));
            head.insert("name".into(), json!(s(v, "issuer").map(|i| format!("{i} catalogues")).unwrap_or_default()));
            put_s(&mut head, "issuer", s(v, "issuer"));
            put_s(&mut head, "updated_at", s(v, "generated_at"));
            head.insert("items".into(), json!([]));
            let mut links = Vec::new();
            for (i, c) in v.get("catalogs").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let kind = s(c, "template").and_then(|t| kind_of_template(&t));
                let (Some(kind), Some(url)) = (kind, s(c, "feed_url")) else {
                    is.warn("index.entry", format!("{at}.catalogs[{i}]"), "a v2 index entry with no known template or no feed_url: dropped");
                    continue;
                };
                let mut m = Map::new();
                m.insert("kind".into(), json!(kind));
                m.insert("url".into(), json!(url));
                put_s(&mut m, "name", s(c, "name"));
                put_s(&mut m, "description", s(c, "summary"));
                put(&mut m, "items", num(c, "items_count"));
                put_s(&mut m, "updated_at", s(c, "updated_at"));
                links.push(Value::Object(m));
            }
            head.insert("catalogs".into(), Value::Array(links));
            Value::Object(head)
        }
        Variant::Dsse => empty_catalog(""), // handled by the caller
        Variant::Unknown => {
            is.err("format.unknown", at, "not a catalogue BMM can read");
            empty_catalog("")
        }
    }
}

/// BC v2 `CatalogFeedDoc` → universal. The item id is the SLUG, as v2's own v1 compat feed
/// emits it, so the same item read through `catalog.json` and through the signed feed is one
/// item, not two; the v2 public id is kept as `extra.external_id`.
fn from_v2_feed(v: &Value, is: &mut Issues, at: &str) -> Value {
    let cat = v.get("catalog").cloned().unwrap_or(Value::Null);
    let template = s(&cat, "template").unwrap_or_default();
    let kind = kind_of_template(&template);
    let mut head = Map::new();
    head.insert("format".into(), json!(FORMAT));
    head.insert("format_version".into(), json!(FORMAT_VERSION));
    put_s(&mut head, "id", s(&cat, "slug"));
    head.insert("name".into(), json!(s(&cat, "name").unwrap_or_default()));
    put_s(&mut head, "description", s(&cat, "summary"));
    put_s(&mut head, "homepage", s(&cat, "url"));
    put_s(&mut head, "publisher", cat.get("project").and_then(|p| s(p, "name")));
    put_s(&mut head, "issuer", s(v, "issuer"));
    put_s(&mut head, "updated_at", s(v, "generated_at"));
    let mut items = Vec::new();
    let Some(kind) = kind else {
        is.err("v2.template", format!("{at}.catalog.template"), format!("unknown v2 template {template:?}"));
        head.insert("items".into(), json!([]));
        return Value::Object(head);
    };
    for (i, it) in v.get("items").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let meta = it.get("meta").cloned().unwrap_or(Value::Null);
        let mut m = Map::new();
        m.insert("kind".into(), json!(kind));
        put_s(&mut m, "id", first(it, &["slug", "id"]));
        put_s(&mut m, "name", s(&meta, "name"));
        put_s(&mut m, "summary", s(&meta, "summary"));
        put_s(&mut m, "description", s(&meta, "description").or_else(|| s(&meta, "summary")));
        let latest = s(it, "latest_version");
        put_s(&mut m, "version", latest.clone());
        let tags = strings(meta.get("tags"), 32);
        if !tags.is_empty() { m.insert("tags".into(), json!(tags)); }
        put_s(&mut m, "license", s(&meta, "licence"));
        let compat = strings(meta.get("compatibility"), 20);
        if !compat.is_empty() { m.insert("compatibility".into(), json!(compat)); }
        put_s(&mut m, "homepage", s(&meta, "homepage_url"));
        put_s(&mut m, "source_url", s(&meta, "source_url"));
        let versions: Vec<Value> = it.get("versions").and_then(Value::as_array).cloned().unwrap_or_default();
        let current = versions.iter().find(|x| s(x, "version") == latest).or_else(|| versions.first());
        if let Some(f) = current.and_then(|c| c.get("files")).and_then(Value::as_array).and_then(|f| f.first()) {
            put(&mut m, "download", download(s(f, "url"), s(f, "sha256"), num(f, "size"), None));
        }
        if !versions.is_empty() {
            m.insert("versions".into(), Value::Array(versions.iter().map(|x| {
                let mut vm = Map::new();
                put_s(&mut vm, "version", s(x, "version"));
                put_s(&mut vm, "published_at", s(x, "published_at"));
                put_s(&mut vm, "changelog", s(x, "changelog"));
                let files: Vec<Value> = x.get("files").and_then(Value::as_array).into_iter().flatten().map(|f| {
                    let mut fm = Map::new();
                    put_s(&mut fm, "name", s(f, "name"));
                    put(&mut fm, "size", num(f, "size"));
                    put_s(&mut fm, "sha256", s(f, "sha256").map(|h| clean_sha(&h)));
                    put_s(&mut fm, "url", s(f, "url"));
                    Value::Object(fm)
                }).collect();
                vm.insert("files".into(), Value::Array(files));
                Value::Object(vm)
            }).collect()));
        }
        let mut extra = Map::new();
        put_s(&mut extra, "external_id", s(it, "id"));
        put_s(&mut extra, "revision", s(it, "revision"));
        put_s(&mut extra, "rights_statement", s(&meta, "rights_statement"));
        if !extra.is_empty() { m.insert("extra".into(), Value::Object(extra)); }
        if m.get("id").is_none() { is.warn("item.no_id", format!("{at}.items[{i}]"), "a v2 item with no slug or id"); }
        items.push(Value::Object(m));
    }
    head.insert("items".into(), Value::Array(items));
    Value::Object(head)
}

// ── validation ───────────────────────────────────────────────────────────────

/// Does an address look like something a fetcher may be handed? http(s), or a relative
/// name (resolved against the catalogue's address by the reader). Never `javascript:`,
/// `file:`, `data:`.
pub fn url_ok(u: &str) -> bool {
    let low = u.trim().to_ascii_lowercase();
    if low.starts_with("https://") || low.starts_with("http://") { return true; }
    // A scheme of any other kind is refused. A relative name has no `:` before its first `/`.
    let before_slash = low.split('/').next().unwrap_or("");
    !before_slash.contains(':') && !low.starts_with("//") && !low.is_empty()
}

/// Validate a UNIVERSAL document. A legacy one is validated through [`normalize`].
#[allow(dead_code)] // public API of the format: tests, fixtures, a publisher's tooling
pub fn validate(v: &Value) -> Vec<Issue> {
    let mut is = Issues::default();
    validate_into(v, &mut is);
    let mut out = is.0;
    dedupe_issues(&mut out);
    out
}

fn validate_into<'a>(v: &Value, is: &'a mut Issues) -> &'a mut Issues {
    let Some(o) = v.as_object() else {
        is.err("format.not_object", "$", "a catalogue is a JSON object");
        return is;
    };
    match o.get("format").and_then(Value::as_str) {
        Some(FORMAT) => {}
        Some(other) => is.err("format.name", "$.format", format!("format is {other:?}, expected {FORMAT:?}")),
        None => is.err("format.missing", "$.format", format!("no \"format\": \"{FORMAT}\"")),
    }
    let fv = o.get("format_version");
    let ver = fv.and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|s| s.trim().split('.').next()?.parse().ok())));
    match ver {
        None => is.err("format.version", "$.format_version", "format_version must be an integer"),
        Some(n) if n > FORMAT_VERSION => is.err("format.too_new", "$.format_version",
            format!("format_version {n} is newer than this BMM reads ({FORMAT_VERSION})")),
        Some(0) => is.err("format.version", "$.format_version", "format_version starts at 1"),
        Some(_) if !fv.map(Value::is_u64).unwrap_or(false) => is.warn("format.version_type", "$.format_version", "write format_version as an integer"),
        _ => {}
    }
    if o.get("name").and_then(Value::as_str).map(str::trim).unwrap_or("").is_empty() {
        is.warn("catalog.no_name", "$.name", "a catalogue should have a name");
    }
    for k in ["name_i18n", "description_i18n"] {
        check_i18n(o.get(k), &format!("$.{k}"), is);
    }
    if let Some(h) = o.get("homepage").and_then(Value::as_str) {
        if !h.to_ascii_lowercase().starts_with("https://") && !h.to_ascii_lowercase().starts_with("http://") {
            is.warn("url.scheme", "$.homepage", "homepage must be http(s)");
        }
    }
    let items = match o.get("items") {
        Some(Value::Array(a)) => a.clone(),
        Some(_) => { is.err("items.not_array", "$.items", "items must be an array"); vec![] }
        None => {
            if o.get("catalogs").is_none() { is.err("items.missing", "$.items", "no items array"); }
            vec![]
        }
    };
    if items.len() > MAX_ITEMS {
        is.err("items.too_many", "$.items", format!("{} items: more than {MAX_ITEMS}", items.len()));
    }
    let mut seen_ids = std::collections::HashMap::new();
    for (i, it) in items.iter().enumerate().take(MAX_ITEMS) {
        let at = format!("$.items[{i}]");
        let Some(io) = it.as_object() else { is.err("item.not_object", at, "an item is an object"); continue };
        let kind = io.get("kind").and_then(Value::as_str).unwrap_or("");
        if kind.is_empty() {
            is.err("item.no_kind", format!("{at}.kind"), "an item needs a kind");
        } else if !is_kind(kind) {
            is.err("item.kind", format!("{at}.kind"), format!("unknown kind {kind:?} (one of: {})", KINDS.iter().map(|k| k.0).collect::<Vec<_>>().join(", ")));
        }
        let id = io.get("id").and_then(Value::as_str).map(str::trim).unwrap_or("");
        if id.is_empty() {
            is.err("item.no_id", format!("{at}.id"), "an item needs an id");
        } else if let Some(prev) = seen_ids.insert(format!("{kind}\u{0}{}", id.to_ascii_lowercase()), i) {
            is.warn("item.duplicate", format!("{at}.id"), format!("{kind} {id:?} already listed at items[{prev}]: the first wins"));
        }
        if io.get("name").and_then(Value::as_str).map(str::trim).unwrap_or("").is_empty() {
            is.warn("item.no_name", format!("{at}.name"), "an item should have a name");
        }
        for k in ["name_i18n", "description_i18n"] { check_i18n(io.get(k), &format!("{at}.{k}"), is); }
        if let Some(t) = io.get("tags") {
            if !t.as_array().map(|a| a.iter().all(Value::is_string)).unwrap_or(false) {
                is.warn("item.tags", format!("{at}.tags"), "tags must be an array of strings");
            }
        }
        let inline_theme = kind == "theme" && io.get("extra").and_then(|e| e.get("vars")).is_some();
        let cbmp_pack = kind == "modpack" && io.get("extra").and_then(|e| e.get("file")).is_some();
        match io.get("download") {
            None if inline_theme || cbmp_pack => {}
            None => is.err("download.missing", format!("{at}.download"),
                if kind == "repo" { "a repo link needs download.url (the repo address)" } else { "nothing to download: download.url is missing" }),
            Some(d) => {
                match d.get("url").and_then(Value::as_str) {
                    None => is.err("download.no_url", format!("{at}.download.url"), "download.url is missing"),
                    Some(u) if !url_ok(u) => is.err("url.scheme", format!("{at}.download.url"), format!("{u:?} is not an http(s) address or a relative name")),
                    Some(u) if u.to_ascii_lowercase().starts_with("http://") => is.info("url.http", format!("{at}.download.url"), "plain http: prefer https"),
                    _ => {}
                }
                match d.get("sha256") {
                    None if !matches!(kind, "repo" | "tutorial") => is.warn("download.no_sha256", format!("{at}.download.sha256"),
                        if kind == "plugin" { "no sha256: BMM 1.1+ refuses to install a catalogue plugin without one" } else { "no sha256: the file cannot be checked after download" }),
                    Some(Value::String(h)) if !is_sha256(h) => is.err("download.bad_sha256", format!("{at}.download.sha256"), "sha256 must be 64 lower-case hex digits"),
                    Some(x) if !x.is_string() => is.err("download.bad_sha256", format!("{at}.download.sha256"), "sha256 must be a string"),
                    _ => {}
                }
                if let Some(sz) = d.get("size") {
                    if sz.as_u64().is_none() { is.warn("download.size", format!("{at}.download.size"), "size must be a whole number of bytes"); }
                }
            }
        }
        for (vi, ver) in io.get("versions").and_then(Value::as_array).into_iter().flatten().enumerate() {
            for (fi, f) in ver.get("files").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let fat = format!("{at}.versions[{vi}].files[{fi}]");
                if let Some(h) = f.get("sha256").and_then(Value::as_str) {
                    if !is_sha256(h) { is.err("download.bad_sha256", format!("{fat}.sha256"), "sha256 must be 64 lower-case hex digits"); }
                }
                if let Some(u) = f.get("url").and_then(Value::as_str) {
                    if !url_ok(u) { is.err("url.scheme", format!("{fat}.url"), "not an http(s) address"); }
                }
            }
        }
        if io.contains_key("signature") || io.contains_key("signatures") {
            is.info("item.signature_ignored", format!("{at}.signature"), "per-item signatures are not read: sign the whole catalogue (DSSE envelope)");
        }
    }
    for (i, l) in o.get("catalogs").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let at = format!("$.catalogs[{i}]");
        let kind = l.get("kind").and_then(Value::as_str).unwrap_or("");
        if !is_kind(kind) { is.err("link.kind", format!("{at}.kind"), format!("unknown kind {kind:?}")); }
        match l.get("url").and_then(Value::as_str) {
            Some(u) if u.to_ascii_lowercase().starts_with("https://") || u.to_ascii_lowercase().starts_with("http://") => {}
            _ => is.err("link.url", format!("{at}.url"), "a linked catalogue needs an http(s) url"),
        }
    }
    is
}

fn check_i18n(v: Option<&Value>, at: &str, is: &mut Issues) {
    let Some(v) = v else { return };
    match v.as_object() {
        None => is.warn("i18n.not_map", at, "an i18n field is a map of language → text"),
        Some(m) => {
            for (k, x) in m {
                if !x.is_string() { is.warn("i18n.value", format!("{at}.{k}"), "translations are strings"); }
                if k.is_empty() || k.len() > 16 { is.warn("i18n.lang", format!("{at}.{k}"), "not a language tag"); }
            }
        }
    }
}

// ── the reverse view, for the existing readers ──────────────────────────────

/// A universal catalogue as the v1 document of ONE kind, the shape the existing reader of that
/// kind consumes. Lossless for what the reader looks at: `extra` is spread back.
pub fn to_legacy(u: &Value, kind: &str) -> Value {
    let mut out = Map::new();
    out.insert("version".into(), json!(s(u, "catalog_version").unwrap_or_else(|| "1.0".into())));
    out.insert("name".into(), json!(s(u, "name").unwrap_or_default()));
    out.insert("description".into(), json!(s(u, "description").unwrap_or_default()));
    if kind == "index" {
        let cats: Vec<Value> = u.get("catalogs").and_then(Value::as_array).into_iter().flatten().map(|l| {
            let mut m = l.as_object().cloned().unwrap_or_default();
            if let Some(k) = m.remove("kind") { m.insert("type".into(), k); }
            Value::Object(m)
        }).collect();
        out.insert("kind".into(), json!("catalog-index"));
        out.insert("catalogs".into(), Value::Array(cats));
        return Value::Object(out);
    }
    if kind == "app" {
        for k in ["partner_catalogs", "community_imports"] {
            if let Some(x) = u.get(k) { out.insert(k.into(), x.clone()); }
        }
    }
    let Some(key) = array_of(kind) else { return Value::Object(out) };
    let rows: Vec<Value> = u.get("items").and_then(Value::as_array).into_iter().flatten()
        .filter(|it| it.get("kind").and_then(Value::as_str) == Some(kind))
        .filter_map(|it| legacy_entry(kind, it))
        .collect();
    out.insert(key.into(), Value::Array(rows));
    // A tutorial catalogue is read under two names by two generations of reader.
    Value::Object(out)
}

fn legacy_entry(kind: &str, it: &Value) -> Option<Value> {
    let mut m = Map::new();
    // `extra` first, so a field the universal item states wins over a stale copy in extra.
    if let Some(e) = it.get("extra").and_then(Value::as_object) {
        for (k, v) in e { m.insert(k.clone(), v.clone()); }
    }
    let id = s(it, "id")?;
    let name = s(it, "name").unwrap_or_else(|| id.clone());
    let url = it.get("download").and_then(|d| s(d, "url"));
    let sha = it.get("download").and_then(|d| s(d, "sha256"));
    m.insert("id".into(), json!(id));
    for k in ["description", "author", "version"] {
        if let Some(x) = s(it, k) { m.insert(k.into(), json!(x)); }
    }
    if let Some(t) = it.get("tags") { m.insert("tags".into(), t.clone()); }
    if let Some(x) = it.get("name_i18n") { m.insert("name_i18n".into(), x.clone()); }
    if let Some(x) = it.get("description_i18n") { m.insert("description_i18n".into(), x.clone()); }
    match kind {
        "app" => {
            let url = url?;
            m.insert("title".into(), json!(name));
            let d = it.get("download").cloned().unwrap_or(Value::Null);
            let ft = s(&d, "file_type").unwrap_or_else(|| {
                url.rsplit('.').next().filter(|x| x.len() <= 5 && !x.contains('/')).unwrap_or("zip").to_ascii_lowercase()
            });
            let mut dm = Map::new();
            dm.insert("url".into(), json!(url));
            dm.insert("file_type".into(), json!(ft));
            put(&mut dm, "size", d.get("size").cloned());
            put_s(&mut dm, "sha256", sha);
            m.insert("download".into(), Value::Object(dm));
            if !m.contains_key("description") { m.insert("description".into(), json!("")); }
            if let Some(icon) = s(it, "icon") {
                if !m.contains_key("images") { m.insert("images".into(), json!({ "thumb": icon })); }
            }
            if !m.contains_key("requirements") {
                if let Some(c) = it.get("compatibility").and_then(Value::as_array).filter(|a| !a.is_empty()) {
                    let joined: Vec<&str> = c.iter().filter_map(Value::as_str).collect();
                    m.insert("requirements".into(), json!(joined.join(", ")));
                }
            }
        }
        "plugin" => {
            m.insert("name".into(), json!(name));
            m.insert("download_url".into(), json!(url?));
            put_s(&mut m, "sha256", sha);
            put_s(&mut m, "game", s(it, "game").or_else(|| it.get("compatibility").and_then(|c| c.get(0)).and_then(Value::as_str).map(String::from)));
            put_s(&mut m, "icon_url", s(it, "icon"));
        }
        "theme" => {
            m.insert("name".into(), json!(name));
            if url.is_none() && !m.contains_key("vars") { return None; }
            if let Some(u) = url {
                // Both: v1 put the address in `url`, the installer reads `download_url`.
                m.insert("url".into(), json!(u.clone()));
                m.insert("download_url".into(), json!(u));
            }
            put_s(&mut m, "sha256", sha);
        }
        "tutorial" => {
            m.insert("name".into(), json!(name.clone()));
            m.insert("title".into(), json!(name));
            m.insert("url".into(), json!(url?));
            put_s(&mut m, "sha256", sha);
        }
        "repo" => {
            m.insert("name".into(), json!(name));
            m.insert("url".into(), json!(url?));
        }
        "modpack" => {
            m.insert("name".into(), json!(name));
            if url.is_none() && !m.contains_key("file") { return None; }
            if let Some(u) = url { m.insert("download_url".into(), json!(u)); }
            put_s(&mut m, "sha256", sha);
            put_s(&mut m, "game", s(it, "game"));
        }
        _ => {
            // preset, list
            m.insert("name".into(), json!(name));
            m.insert("download_url".into(), json!(url?));
            put_s(&mut m, "sha256", sha);
        }
    }
    Some(Value::Object(m))
}

/// What an existing reader of `kind` should parse instead of `text`, or `None` to parse the
/// text as it always has.
///
/// `None` for every v1 document: those readers already understand them, and a round trip
/// through the universal shape would be a second chance to lose a field. `Some` for what they
/// could never read (a universal catalogue, a v2 feed, a signed envelope). `Err` when the
/// document must not be read at all — an invalid signature is never served as a catalogue.
pub fn legacy_view(text: &str, kind: &str, opts: &NormalizeOptions) -> Result<Option<Value>, String> {
    let Ok(v) = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) else { return Ok(None) };
    let variant = detect(&v);
    let pinned = opts.source_url.as_deref().map(|s| pinned_for(s, &opts.keys)).unwrap_or(false);
    if !matches!(variant, Variant::Universal | Variant::Dsse | Variant::V2Feed | Variant::V2Index) && !pinned {
        return Ok(None);
    }
    let n = normalize(&v, opts);
    if n.refused {
        let why = n.issues.iter().find(|i| i.severity == Severity::Error).map(|i| i.message.clone()).unwrap_or_else(|| "refused".into());
        return Err(format!("catalog refused: {why}"));
    }
    let want_index = n.catalog.get("catalogs").and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(false)
        && n.catalog.get("items").and_then(Value::as_array).map(|a| a.is_empty()).unwrap_or(true);
    Ok(Some(to_legacy(&n.catalog, if want_index { "index" } else { kind })))
}

// ── signatures: DSSE v1, Ed25519 ─────────────────────────────────────────────

/// A public key a signature may verify against. `public_key` is the RAW 32-byte Ed25519 key,
/// base64 — the form `/v2/feeds/keys` publishes and `PUT /v2/catalogs/{c}/source` takes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedKey {
    #[serde(default, alias = "kid")]
    pub keyid: String,
    #[serde(alias = "public_key")]
    pub public_key: String,
    /// The origin (`https://host[:port]`) this key is PINNED to: a document from there must be
    /// signed by it. Absent = trusted for any source, pinned to none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SigStatus {
    /// Not an envelope.
    Unsigned,
    /// A signature verifies against a trusted key.
    Verified,
    /// Malformed, tampered, signed by a pinned issuer's wrong key, or unsigned where a key is pinned.
    Invalid,
    /// Well-formed and signed, but by no key this BMM trusts. Read as unverified.
    UnknownKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureReport {
    pub status: SigStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload_type: Option<String>,
    /// The key that verified, or the first one the envelope names.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
impl SignatureReport {
    pub fn unsigned() -> Self { Self { status: SigStatus::Unsigned, payload_type: None, keyid: None, reason: None } }
    fn invalid(pt: Option<String>, why: &str) -> Self { Self { status: SigStatus::Invalid, payload_type: pt, keyid: None, reason: Some(why.into()) } }
}

/// DSSE's pre-authentication encoding, exactly as v2 builds it:
/// `"DSSEv1" SP LEN(type) SP type SP LEN(body) SP body`, lengths in BYTES, ASCII decimal.
pub fn pae(payload_type: &str, body: &[u8]) -> Vec<u8> {
    let t = payload_type.as_bytes();
    let mut out = Vec::with_capacity(body.len() + t.len() + 32);
    out.extend_from_slice(format!("DSSEv1 {} ", t.len()).as_bytes());
    out.extend_from_slice(t);
    out.extend_from_slice(format!(" {} ", body.len()).as_bytes());
    out.extend_from_slice(body);
    out
}

fn b64() -> base64::engine::GeneralPurpose {
    // Node's Buffer.from(x, 'base64') takes padded and unpadded input alike; v2 guards the
    // payload with /^[A-Za-z0-9+/]*={0,2}$/. Same tolerance here, same alphabet.
    base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    )
}
pub fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let t = s.trim();
    if !t.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=') { return None; }
    b64().decode(t).ok()
}
#[allow(dead_code)] // public API of the format: tests, fixtures, a publisher's tooling
pub fn b64_encode(b: &[u8]) -> String { base64::engine::general_purpose::STANDARD.encode(b) }

/// `https://Host:443/x` → `https://host:443`. No URL crate: an origin is three fields.
pub fn origin_of(url: &str) -> Option<String> {
    let low = url.trim().to_ascii_lowercase();
    let (scheme, rest) = low.split_once("://")?;
    if scheme != "https" && scheme != "http" { return None; }
    let host = rest.split(['/', '?', '#']).next()?.rsplit('@').next()?;
    if host.is_empty() { return None; }
    Some(format!("{scheme}://{host}"))
}

/// The path part of an http(s) address (`/` when none), without query or fragment.
fn path_of(url: &str) -> Option<String> {
    let (_, rest) = url.trim().split_once("://")?;
    let rest = rest.split(['?', '#']).next()?;
    Some(match rest.find('/') { Some(i) => rest[i..].to_string(), None => "/".into() })
}

/// An issuer as stored: the origin (lower-cased), plus an optional path SCOPE ending in `/`.
/// `https://BC.example` → `https://bc.example`; `https://bc.example/v2/feeds` →
/// `https://bc.example/v2/feeds/`. A scope pins only the addresses under it: BetterCommunity
/// v2 serves its signed feeds under `/v2/feeds/` and its unsigned v1-compatible `catalog.json`
/// from the same origin, and pinning the whole origin would refuse the latter as a downgrade.
pub fn issuer_of(url: &str) -> Option<String> {
    let o = origin_of(url)?;
    let p = path_of(url)?;
    let p = p.trim_end_matches('/');
    Some(if p.is_empty() { o } else { format!("{o}{p}/") })
}

/// Does a key pinned to `issuer` cover a document fetched from `source_url`? Same origin, and
/// under the issuer's path scope when it has one.
pub fn issuer_covers(issuer: &str, source_url: &str) -> bool {
    let (Some(io), Some(so)) = (origin_of(issuer), origin_of(source_url)) else { return false };
    if io != so { return false; }
    let scope = path_of(issuer).unwrap_or_else(|| "/".into());
    let scope = scope.trim_end_matches('/');
    if scope.is_empty() { return true; }
    let sp = path_of(source_url).unwrap_or_default();
    sp == scope || sp.starts_with(&format!("{scope}/"))
}

fn pinned_for(source_url: &str, keys: &[TrustedKey]) -> bool {
    keys.iter().any(|k| k.issuer.as_deref().map(|i| issuer_covers(i, source_url)).unwrap_or(false))
}

/// Verify a DSSE envelope. Returns the report and, unless it is `Invalid`, the payload bytes.
///
/// Mirrors `verifyFeed` in v2's `services/src/catalog/feed.ts`: payloadType one of the two
/// known types, 1 to 4 signatures, each a 64-byte Ed25519 signature over
/// `PAE(payloadType, payload_bytes)`; a keyid is a HINT, never trusted — every signature is
/// tried against every key.
///
/// Which keys: when the source's origin has pinned keys, ONLY those (v2's linked catalogue
/// verifies "with the declared key only"); otherwise every trusted key.
pub fn verify_envelope(env: &Value, keys: &[TrustedKey], source_url: Option<&str>) -> (SignatureReport, Option<Vec<u8>>) {
    let pt = env.get("payloadType").and_then(Value::as_str).map(String::from);
    let Some(ptype) = pt.clone() else { return (SignatureReport::invalid(None, "no payloadType"), None) };
    if ptype != V2_FEED_TYPE && ptype != BMM_PAYLOAD_TYPE {
        return (SignatureReport::invalid(pt, "unknown payloadType"), None);
    }
    let Some(payload_b64) = env.get("payload").and_then(Value::as_str) else {
        return (SignatureReport::invalid(pt, "no payload"), None);
    };
    let Some(body) = b64_decode(payload_b64) else { return (SignatureReport::invalid(pt, "payload is not base64"), None) };
    let sigs = match env.get("signatures").and_then(Value::as_array) {
        Some(a) if !a.is_empty() && a.len() <= MAX_SIGNATURES => a.clone(),
        _ => return (SignatureReport::invalid(pt, "1 to 4 signatures expected"), None),
    };
    let first_kid = sigs.iter().find_map(|x| x.get("keyid").and_then(Value::as_str)).map(String::from);

    let pinned: Vec<&TrustedKey> = keys.iter()
        .filter(|k| match (source_url, k.issuer.as_deref()) {
            (Some(src), Some(iss)) => issuer_covers(iss, src),
            _ => false,
        })
        .collect();
    let candidates: Vec<&TrustedKey> = if pinned.is_empty() { keys.iter().collect() } else { pinned.clone() };

    if candidates.is_empty() {
        return (SignatureReport { status: SigStatus::UnknownKey, payload_type: pt, keyid: first_kid,
            reason: Some("no trusted key to check against".into()) }, Some(body));
    }
    let msg = pae(&ptype, &body);
    for sg in &sigs {
        let Some(sig_bytes) = sg.get("sig").and_then(Value::as_str).and_then(b64_decode) else { continue };
        let Ok(sig_arr) = <[u8; 64]>::try_from(sig_bytes.as_slice()) else { continue };
        let sig = ed25519_dalek::Signature::from_bytes(&sig_arr);
        for k in &candidates {
            let Some(raw) = b64_decode(&k.public_key) else { continue };
            let Ok(raw32) = <[u8; 32]>::try_from(raw.as_slice()) else { continue };
            let Ok(vk) = ed25519_dalek::VerifyingKey::from_bytes(&raw32) else { continue };
            // verify_strict: no small-order keys, no malleable signatures. Node's verify (what
            // v2 signs for) accepts a superset, and every signature v2 produces passes both.
            if vk.verify_strict(&msg, &sig).is_ok() {
                return (SignatureReport { status: SigStatus::Verified, payload_type: pt, keyid: Some(k.keyid.clone()), reason: None }, Some(body));
            }
        }
    }
    // Nothing verified. Against a PINNED issuer that is a failure, full stop. Otherwise it is a
    // failure when the envelope claims one of our keys (a tampered document), and an unknown
    // signer when it names keys we have never seen.
    let claims_known = sigs.iter().filter_map(|x| x.get("keyid").and_then(Value::as_str))
        .any(|kid| candidates.iter().any(|k| !k.keyid.is_empty() && k.keyid == kid));
    if !pinned.is_empty() || claims_known {
        return (SignatureReport { status: SigStatus::Invalid, payload_type: pt, keyid: first_kid,
            reason: Some(if pinned.is_empty() { "the signature does not verify".into() } else { "not signed by this source's pinned key".into() }) }, None);
    }
    (SignatureReport { status: SigStatus::UnknownKey, payload_type: pt, keyid: first_kid,
        reason: Some("signed by a key this BMM does not know".into()) }, Some(body))
}

/// Sign a payload into a DSSE envelope. For tests, fixtures and a publisher's own tooling.
#[allow(dead_code)] // public API of the format: tests, fixtures, a publisher's tooling
pub fn sign_envelope(payload_type: &str, body: &[u8], key: &ed25519_dalek::SigningKey, keyid: &str) -> Value {
    use ed25519_dalek::Signer;
    let sig = key.sign(&pae(payload_type, body));
    json!({
        "payloadType": payload_type,
        "payload": b64_encode(body),
        "signatures": [ { "keyid": keyid, "sig": b64_encode(&sig.to_bytes()) } ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(name: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/catalog_format").join(name);
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
    }
    fn norm(name: &str, kind: Option<&str>) -> Normalized {
        normalize_text(&fx(name), &NormalizeOptions { kind: kind.map(String::from), ..Default::default() })
    }
    fn key() -> ed25519_dalek::SigningKey { ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]) }
    fn trusted(issuer: Option<&str>) -> TrustedKey {
        TrustedKey { keyid: "feed_test".into(), public_key: b64_encode(key().verifying_key().as_bytes()), issuer: issuer.map(String::from), label: None }
    }
    fn errors(n: &Normalized) -> Vec<String> {
        n.issues.iter().filter(|i| i.severity == Severity::Error).map(|i| format!("{} {}", i.code, i.path)).collect()
    }

    #[test]
    fn catalog_pae_matches_the_dsse_spec_bytes() {
        // The worked example of the DSSE spec (protocol.md), byte for byte.
        assert_eq!(pae("http://example.com/HelloWorld", b"hello world"),
            b"DSSEv1 29 http://example.com/HelloWorld 11 hello world".to_vec());
        // Lengths are BYTES, not characters: v2 measures Buffer lengths.
        assert_eq!(pae("t", "é".as_bytes()), b"DSSEv1 1 t 2 \xc3\xa9".to_vec());
    }

    #[test]
    fn catalog_every_v1_shape_is_detected_and_converted() {
        for (file, kind, n) in [
            ("v1-apps.json", "app", 2), ("v1-plugins.json", "plugin", 2), ("v1-themes-object.json", "theme", 2),
            ("v1-themes-array.json", "theme", 2), ("v1-presets.json", "preset", 1), ("v1-modpacks.json", "modpack", 2),
            ("v1-repos.json", "repo", 2), ("v1-repos-array.json", "repo", 1), ("v1-tutorials.json", "tutorial", 1),
            ("v1-lists.json", "list", 1), ("bcweb-feed-plugin.json", "plugin", 1), ("bcweb-items.json", "tutorial", 1),
            ("v2-compat-apps.json", "app", 1),
        ] {
            let r = norm(file, None);
            assert!(!r.refused, "{file}: {:?}", r.issues);
            assert!(errors(&r).is_empty(), "{file}: {:?}", errors(&r));
            let items = r.catalog["items"].as_array().unwrap();
            assert_eq!(items.iter().filter(|i| i["kind"] == kind).count(), n, "{file}: {items:?}");
            assert_eq!(r.catalog["format"], FORMAT);
            assert_eq!(r.catalog["format_version"], FORMAT_VERSION);
        }
    }

    #[test]
    fn catalog_conversions_match_the_expected_documents() {
        // The same expected files the TypeScript fallback is tested against
        // (tests/catalog-format.test.mjs): one truth for two implementations.
        for (input, expected) in EXPECTED {
            let got = norm(input, None).catalog;
            let want: Value = serde_json::from_str(&fx(expected)).unwrap();
            assert_eq!(got, want, "{input}\n got: {}", serde_json::to_string_pretty(&got).unwrap());
        }
    }

    /// Regenerates the expected documents. Run on purpose only, then READ the diff:
    /// `BMM_WRITE_EXPECTED=1 cargo test catalog_write_expected -- --ignored`
    #[test]
    #[ignore]
    fn catalog_write_expected() {
        if std::env::var("BMM_WRITE_EXPECTED").is_err() { return; }
        for (input, expected) in EXPECTED {
            let got = norm(input, None).catalog;
            let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/catalog_format").join(expected);
            std::fs::write(p, serde_json::to_string_pretty(&got).unwrap() + "\n").unwrap();
        }
    }

    const EXPECTED: &[(&str, &str)] = &[
        ("v1-plugins.json", "expected/v1-plugins.universal.json"),
        ("v1-apps.json", "expected/v1-apps.universal.json"),
        ("v1-themes-object.json", "expected/v1-themes-object.universal.json"),
        ("v1-modpacks.json", "expected/v1-modpacks.universal.json"),
        ("v1-repos-array.json", "expected/v1-repos-array.universal.json"),
        ("bcweb-items.json", "expected/bcweb-items.universal.json"),
        ("v1-tutorials.json", "expected/v1-tutorials.universal.json"),
        ("v1-lists.json", "expected/v1-lists.universal.json"),
        ("v2-feed-payload.json", "expected/v2-feed.universal.json"),
        ("v1-index.json", "expected/v1-index.universal.json"),
        ("universal.json", "expected/universal.universal.json"),
    ];

    #[test]
    fn catalog_v2_feed_reads_with_slug_ids_and_latest_file() {
        let r = norm("v2-feed-payload.json", None);
        let it = &r.catalog["items"][0];
        assert_eq!(it["kind"], "plugin");
        assert_eq!(it["id"], "fast-loader");
        assert_eq!(it["version"], "1.2.0");
        assert!(it["download"]["url"].as_str().unwrap().ends_with("/v2/catalog-files/f_120"));
        assert_eq!(it["extra"]["external_id"], "itm_0123456789abcdefghjkmnpqrs");
        assert_eq!(it["versions"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn catalog_a_signed_v2_feed_verifies_and_a_tampered_one_is_refused() {
        let payload = fx("v2-feed-payload.json");
        let env = sign_envelope(V2_FEED_TYPE, payload.as_bytes(), &key(), "feed_test");
        let opts = NormalizeOptions { keys: vec![trusted(None)], ..Default::default() };
        let ok = normalize(&env, &opts);
        assert_eq!(ok.signature.status, SigStatus::Verified, "{:?}", ok.issues);
        assert_eq!(ok.inner_variant, Some(Variant::V2Feed));
        assert!(!ok.refused);
        assert_eq!(ok.catalog["items"].as_array().unwrap().len(), 1);

        // One byte of the payload changed.
        let mut bad = env.clone();
        let mut body = payload.clone().into_bytes();
        let i = body.iter().position(|b| *b == b'F').unwrap();
        body[i] = b'G';
        bad["payload"] = json!(b64_encode(&body));
        let r = normalize(&bad, &opts);
        assert_eq!(r.signature.status, SigStatus::Invalid);
        assert!(r.refused);
        assert!(r.catalog["items"].as_array().unwrap().is_empty(), "an invalid signature must serve nothing");

        // Another payload type over the same bytes.
        let mut other = env.clone();
        other["payloadType"] = json!("application/json");
        assert_eq!(normalize(&other, &opts).signature.status, SigStatus::Invalid);

        // The committed fixtures: generated by the same key, so they pin the bytes.
        let fixed: Value = serde_json::from_str(&fx("v2-feed-signed.json")).unwrap();
        assert_eq!(normalize(&fixed, &opts).signature.status, SigStatus::Verified);
        let tampered: Value = serde_json::from_str(&fx("v2-feed-tampered.json")).unwrap();
        assert_eq!(normalize(&tampered, &opts).signature.status, SigStatus::Invalid);
    }

    #[test]
    fn catalog_unknown_signers_and_pinned_sources() {
        let payload = fx("v2-feed-payload.json");
        let stranger = ed25519_dalek::SigningKey::from_bytes(&[9u8; 32]);
        let env = sign_envelope(V2_FEED_TYPE, payload.as_bytes(), &stranger, "feed_other");
        // No keys at all: readable, flagged.
        let r = normalize(&env, &NormalizeOptions::default());
        assert_eq!(r.signature.status, SigStatus::UnknownKey);
        assert!(!r.refused);
        // Keys, none of them this signer, nothing pinned: unknown, not invalid.
        let r = normalize(&env, &NormalizeOptions { keys: vec![trusted(None)], ..Default::default() });
        assert_eq!(r.signature.status, SigStatus::UnknownKey);
        // A stranger's signature claiming OUR keyid is a forgery.
        let forged = sign_envelope(V2_FEED_TYPE, payload.as_bytes(), &stranger, "feed_test");
        assert_eq!(normalize(&forged, &NormalizeOptions { keys: vec![trusted(None)], ..Default::default() }).signature.status, SigStatus::Invalid);
        // Pinned to the source: any other signer, and no signature at all, are refused.
        let pinned = NormalizeOptions { keys: vec![trusted(Some("https://bc.example"))], source_url: Some("https://BC.example/v2/feeds/catalogs/x".into()), ..Default::default() };
        let r = normalize(&env, &pinned);
        assert_eq!(r.signature.status, SigStatus::Invalid);
        assert!(r.refused);
        let plain: Value = serde_json::from_str(&payload).unwrap();
        let r = normalize(&plain, &pinned);
        assert!(r.refused, "an unsigned document from a pinned source is a downgrade");
        assert!(legacy_view(&payload, "plugin", &pinned).is_err());
        // The same unsigned document from elsewhere is fine.
        let elsewhere = NormalizeOptions { source_url: Some("https://other.example/c.json".into()), ..pinned };
        assert!(!normalize(&plain, &elsewhere).refused);
        // A key pinned to a path SCOPE: the signed feeds under it are held to it, the same
        // origin's unsigned compat catalog.json is not.
        let scoped = |src: &str| NormalizeOptions { keys: vec![trusted(Some("https://bc.example/v2/feeds/"))], source_url: Some(src.into()), ..Default::default() };
        assert!(normalize(&plain, &scoped("https://bc.example/v2/feeds/catalogs/x")).refused);
        assert_eq!(normalize(&env, &scoped("https://bc.example/v2/feeds/catalogs/x")).signature.status, SigStatus::Invalid);
        assert!(!normalize(&plain, &scoped("https://bc.example/api/catalog.json?project=bmm")).refused);
        assert!(!normalize(&plain, &scoped("https://bc.example/v2/feedsX/y")).refused, "a scope is a path segment, not a string prefix");
    }

    #[test]
    fn catalog_issuers_and_scopes() {
        assert_eq!(issuer_of("https://BC.example").as_deref(), Some("https://bc.example"));
        assert_eq!(issuer_of("https://bc.example/").as_deref(), Some("https://bc.example"));
        assert_eq!(issuer_of("https://bc.example/v2/feeds?x=1").as_deref(), Some("https://bc.example/v2/feeds/"));
        assert_eq!(issuer_of("ftp://bc.example"), None);
        assert!(issuer_covers("https://bc.example", "https://bc.example/anything"));
        assert!(issuer_covers("https://bc.example/v2/feeds/", "https://bc.example/v2/feeds/keys"));
        assert!(issuer_covers("https://bc.example/v2/feeds/", "https://bc.example/v2/feeds"));
        assert!(!issuer_covers("https://bc.example/v2/feeds/", "https://bc.example/api/catalog.json"));
        assert!(!issuer_covers("https://bc.example/v2/feeds/", "https://evil.example/v2/feeds/catalog"));
        assert!(!issuer_covers("https://bc.example", "http://bc.example/x"), "scheme is part of the origin");
    }

    #[test]
    fn catalog_signed_universal_catalogue_round_trips_to_legacy() {
        let u = fx("universal.json");
        let env = sign_envelope(BMM_PAYLOAD_TYPE, u.as_bytes(), &key(), "me");
        let opts = NormalizeOptions { keys: vec![trusted(None)], ..Default::default() };
        let view = legacy_view(&env.to_string(), "plugin", &opts).unwrap().unwrap();
        let plugins = view["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0]["download_url"], "https://example.org/p/hello.bmmplug");
        assert_eq!(plugins[0]["sha256"].as_str().unwrap().len(), 64);
        // The real reader's model accepts it.
        let themes = legacy_view(&u, "theme", &NormalizeOptions::default()).unwrap().unwrap();
        assert_eq!(themes["themes"][0]["vars"]["--bg"], "#101010", "an inline theme keeps its body");
        let apps = legacy_view(&u, "app", &NormalizeOptions::default()).unwrap().unwrap();
        assert_eq!(apps["apps"][0]["title"], "Hello App");
        assert_eq!(apps["apps"][0]["download"]["file_type"], "zip");
    }

    #[test]
    fn catalog_legacy_documents_are_left_to_their_readers() {
        assert_eq!(legacy_view(&fx("v1-plugins.json"), "plugin", &NormalizeOptions::default()).unwrap(), None);
        assert_eq!(legacy_view("not json", "plugin", &NormalizeOptions::default()).unwrap(), None);
    }

    #[test]
    fn catalog_invalid_documents_name_every_problem() {
        let r = norm("invalid-universal.json", None);
        let codes: Vec<&str> = r.issues.iter().map(|i| i.code.as_str()).collect();
        for want in ["item.no_id", "item.kind", "download.bad_sha256", "url.scheme", "item.duplicate", "download.missing", "i18n.value", "link.url"] {
            assert!(codes.contains(&want), "missing {want} in {codes:?}");
        }
        // Paths, not just words.
        assert!(r.issues.iter().any(|i| i.path == "$.items[2].download.url" && i.code == "url.scheme"), "{:?}", r.issues);
        // Unusable items are dropped from what is served; the rest still reads.
        let ids: Vec<&str> = r.catalog["items"].as_array().unwrap().iter().filter_map(|i| i["id"].as_str()).collect();
        assert!(!ids.is_empty());
        assert!(r.catalog["items"].as_array().unwrap().iter().all(|i| is_kind(i["kind"].as_str().unwrap())));
    }

    #[test]
    fn catalog_a_newer_format_is_refused_and_garbage_is_not_a_catalogue() {
        let r = normalize(&json!({ "format": FORMAT, "format_version": 2, "name": "x", "items": [] }), &NormalizeOptions::default());
        assert!(r.refused);
        let r = normalize_text("{ nope", &NormalizeOptions::default());
        assert!(r.refused);
        assert_eq!(r.issues[0].code, "json.parse");
        let r = normalize(&json!({ "hello": 1 }), &NormalizeOptions::default());
        assert_eq!(r.variant, Variant::Unknown);
        assert!(errors(&r).iter().any(|e| e.starts_with("format.unknown")));
    }

    #[test]
    fn catalog_urls_that_must_never_be_fetched() {
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "data:text/plain,x", "//evil.example/x", ""] {
            assert!(!url_ok(bad), "{bad}");
        }
        for good in ["https://a.example/x.zip", "http://localhost:8080/x", "themes/aurora.bmmtheme", "x.json"] {
            assert!(url_ok(good), "{good}");
        }
        assert_eq!(origin_of("HTTPS://User@Host.Example:8443/a?b"), Some("https://host.example:8443".into()));
        assert_eq!(origin_of("ftp://x"), None);
    }

    #[test]
    fn catalog_bare_arrays_follow_the_callers_kind() {
        let arr = r#"[{"id":"a","name":"A","url":"https://x.example/a"}]"#;
        let as_theme = normalize_text(arr, &NormalizeOptions { kind: Some("theme".into()), ..Default::default() });
        assert_eq!(as_theme.catalog["items"][0]["kind"], "theme");
        let guessed = normalize_text(arr, &NormalizeOptions::default());
        assert_eq!(guessed.catalog["items"][0]["kind"], "repo");
    }
}
