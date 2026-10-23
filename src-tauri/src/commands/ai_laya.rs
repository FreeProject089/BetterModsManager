//! « Laya v2 » — WHAT BMM asks the Laya classifier, and how the answers are combined.
//!
//! Mounted twice, like `ai_core` and `ai_embedded`: by the app (`commands::ai_laya`) and by the
//! CLI/MCP binary (`extra_tools/mcp_server.rs`). Only external crates and
//! `crate::commands::ai_core` (which both binaries mount) are used here.
//!
//! Laya is a calibrated CLASSIFIER: it picks one option from a list, or gives P(true) for a
//! statement. It never writes text. So precision comes from four things, all measured on the
//! hand-labelled set `src-tauri/tests/laya_eval.json` (`measure_pipeline` in `ai_embedded.rs`):
//!
//! 1. **Descriptive criteria.** « Weapons: adds or changes weapons: guns, missiles, bombs » is a
//!    question the model can answer; « Weapons » alone is a word it has to guess the meaning of.
//!    A user's tag is matched to a known concept in any of ten languages (« Armes », « Waffen »,
//!    « Оружие » → weapons); an unknown tag keeps its own name.
//! 2. **Deterministic pre-filtering.** Keywords, manifest hints and a stop-word language detector
//!    run first; the model is asked about the few candidates they leave (≤ [`MAX_CHOICE`]
//!    options per question) — fewer options, fewer tokens, fewer ways to be wrong.
//! 3. **The informative part of the text.** File lists are English path soup: the language
//!    question reads the prose lines only; a long report is cut to its most telling lines.
//! 4. **Ensembles and abstention.** Several phrasings (a yes/no per candidate AND one choice
//!    among them) and the keyword evidence are averaged; below a calibrated probability
//!    nothing is suggested — a missing hint costs less than a wrong one.

use serde_json::Value;

use crate::commands::ai_core::{self, LayaQuestion};

/// Options per `choice` question after pre-filtering (+ « none »).
pub const MAX_CHOICE: usize = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Tag concepts: what a tag MEANS, in words the model can check
// ─────────────────────────────────────────────────────────────────────────────

/// A concept a user's tag can stand for: the words that name it (any language, folded, whole
/// words) and what it means, as a criterion.
pub struct Concept {
    /// A stable name for the concept (tests, and the day a tag gets a concept picker).
    #[cfg_attr(not(test), allow(dead_code))]
    pub key: &'static str,
    /// Names of the tag itself, in the languages BMM speaks (folded: lowercase, no accents).
    pub names: &'static [&'static str],
    /// Words in a mod's text that are evidence for it (folded).
    pub evidence: &'static [&'static str],
    pub desc: &'static str,
}

pub const CONCEPTS: &[Concept] = &[
    Concept { key: "aircraft", names: &["aircraft", "aircrafts", "plane", "planes", "airplane", "avion", "avions", "aeronef", "flugzeug", "flugzeuge", "avion", "aviones", "aereo", "aerei", "aviao", "avioes", "самолет", "самолеты", "samolot", "samoloty", "航空機", "飞机", "helicopters", "helicopter", "helicoptere", "helicopteres"],
        evidence: &["aircraft", "cockpit", "jet", "fighter", "helicopter", "avion", "flugzeug", "avion", "aereo", "aviao", "кабина", "samolot", "flight", "phantom", "hornet", "viper", "mirage", "tornado", "spitfire", "eurofighter", "gauge", "gauges", "instruments", "hud", "mfd", "f-16", "f-4e", "su-27", "су-27", "kabina", "cabina"],
        desc: "adds or changes an aircraft or helicopter: its model, cockpit, flight model or systems" },
    Concept { key: "maps", names: &["map", "maps", "terrain", "terrains", "carte", "cartes", "karte", "karten", "mapa", "mapas", "mappa", "mappe", "карта", "карты", "mapy", "マップ", "地图", "theatre", "theater"],
        evidence: &["map", "terrain", "airfield", "airfields", "runway", "carte", "terrain", "karte", "mapa", "mappa", "карта", "island", "islands", "canyon", "airport", "taxiway", "flugplatz", "aeroporti", "terrains"],
        desc: "adds or changes a map or its terrain: land, airfields, cities, scenery" },
    Concept { key: "weapons", names: &["weapon", "weapons", "arme", "armes", "armement", "waffe", "waffen", "arma", "armas", "armi", "оружие", "bron", "broń", "武器"],
        evidence: &["weapon", "weapons", "missile", "missiles", "bomb", "bombs", "gun", "guns", "rocket", "rockets", "cannon", "arme", "armes", "missile", "waffe", "waffen", "arma", "armas", "misiles", "cañones", "gbu", "aim-120", "mica", "ordnance"],
        desc: "adds or changes weapons: guns, missiles, bombs, rockets" },
    Concept { key: "sound", names: &["sound", "sounds", "audio", "son", "sons", "sonido", "sonidos", "suono", "suoni", "som", "sons", "звук", "звуки", "dzwiek", "dźwięk", "サウンド", "声音", "music", "musique"],
        evidence: &["sound", "sounds", "audio", "voice", "voices", "music", "ogg", "wav", "son", "sons", "sonidos", "suoni", "звуки", "звук", "speech", "chatter", "sdef", "recorded", "recordings", "enregistrements", "stimmen", "sprachausgabe", "grabaciones"],
        desc: "changes sounds, music or voices" },
    Concept { key: "graphics", names: &["graphics", "graphic", "visuals", "visual", "graphismes", "graphisme", "grafik", "graficos", "gráficos", "grafica", "grafica", "графика", "grafika", "グラフィック", "图形", "textures", "texture"],
        evidence: &["texture", "textures", "shader", "shaders", "lighting", "reshade", "effects", "particle", "fog", "shadows", "clouds", "4k", "dds", "vram", "wolken", "shader", "текстуры", "шейдеры", "particules", "fumees", "explosions", "nvg"],
        desc: "improves how the game looks: textures, shaders, lighting, visual effects" },
    Concept { key: "interface", names: &["interface", "ui", "hud", "gui", "menus", "interfaz", "interfaccia", "интерфейс", "interfejs", "インターフェース", "界面"],
        evidence: &["interface", "ui", "hud", "menu", "menus", "kneeboard", "inventory", "labels", "screen", "interfaz", "menus"],
        desc: "changes the user interface: menus, HUD, on-screen information" },
    Concept { key: "liveries", names: &["livery", "liveries", "livree", "livrees", "skin", "skins", "paint", "paints", "lackierung", "lackierungen", "librea", "libreas", "livrea", "livree", "pintura", "pinturas", "окраска", "окраски", "malowanie", "塗装", "涂装"],
        evidence: &["livery", "liveries", "paint", "skin", "nose art", "squadron", "livree", "librea", "livrea", "pintura", "malowanie", "塗装", "окраска", "stripes", "tail codes"],
        desc: "adds a paint scheme or skin for an existing aircraft or vehicle" },
    Concept { key: "missions", names: &["mission", "missions", "campaign", "campaigns", "campagne", "campagnes", "kampagne", "einsatze", "einsätze", "mision", "misiones", "campaña", "missione", "missioni", "missao", "missoes", "миссии", "миссия", "misje", "kampania", "ミッション", "任务"],
        evidence: &["mission", "missions", "campaign", "briefing", "briefings", "miz", "campagne", "kampagne", "einsatze", "mision", "misje", "kampania", "sorties", "training"],
        desc: "adds missions or a campaign to play" },
    Concept { key: "utilities", names: &["utility", "utilities", "tool", "tools", "utilitaire", "utilitaires", "outil", "outils", "werkzeug", "werkzeuge", "herramienta", "herramientas", "utilidad", "strumento", "strumenti", "утилита", "утилиты", "narzedzie", "narzędzia", "ツール", "工具"],
        evidence: &["utility", "tool", "exe", "backup", "export", "utilitaire", "outil", "herramienta", "utilidad", "sauvegarde", "restaurar", "config"],
        desc: "is a tool or program that manages files, settings or mods; it adds no game content" },
    Concept { key: "vehicles", names: &["vehicle", "vehicles", "vehicule", "vehicules", "fahrzeug", "fahrzeuge", "vehiculo", "vehiculos", "veicolo", "veicoli", "veiculo", "техника", "pojazd", "pojazdy", "車両", "载具", "ships", "tanks"],
        evidence: &["tank", "tanks", "truck", "vehicle", "carrier", "ship", "humvee", "armor", "blindé", "blinde", "panzer", "kampfpanzer", "танк", "vab", "leopard", "abrams", "porte-avions", "tracks"],
        desc: "adds or changes ground vehicles or ships: tanks, trucks, carriers" },
    Concept { key: "characters", names: &["character", "characters", "personnage", "personnages", "charakter", "charaktere", "figuren", "personaje", "personajes", "personaggio", "personaggi", "персонаж", "персонажи", "postac", "postacie", "キャラクター", "角色", "pilots"],
        evidence: &["pilot", "pilots", "crew", "character", "characters", "faces", "pilote", "pilotes", "personnages", "personaje", "women", "npc"],
        desc: "changes people in the game: pilots, crews, characters, faces" },
    Concept { key: "gameplay", names: &["gameplay", "jouabilite", "jouabilité", "spielmechanik", "jugabilidad", "realism", "realisme", "réalisme", "mechanics"],
        evidence: &["gameplay", "realism", "realistic", "damage", "difficulty", "ai", "physics", "detection", "réaliste", "generator", "dynamic", "persistent", "consommation"],
        desc: "changes game rules or behaviour: realism, damage, difficulty, AI" },
    Concept { key: "fixes", names: &["fix", "fixes", "bugfix", "bugfixes", "patch", "patches", "correctif", "correctifs", "correction", "corrections", "fehlerbehebung", "korrekturen", "correccion", "correcciones", "correzione", "correzioni", "исправления", "poprawki", "修正", "修复"],
        evidence: &["fix", "fixes", "fixed", "corrects", "bug", "correctif", "corrige", "behebt", "corrige", "исправленные", "missing", "misaligned", "broken"],
        desc: "fixes a bug or a problem in the game or in another mod" },
    Concept { key: "adult", names: &["adult", "adults", "nsfw", "18+", "adulte", "adultes", "erwachsene", "adulto", "adultos", "взрослых", "dorosli", "dorośli", "成人"],
        evidence: &["nsfw", "18+", "nude", "nudity", "naked", "explicit", "sexy", "adult", "adults", "adulte", "adultes", "dénudés", "denudes", "pinup"],
        desc: "contains nudity or sexual content, for adults only" },
];

/// Lowercase, accents folded (the same folding the tag matcher uses).
pub fn fold(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' | 'À' | 'Á' | 'Â' | 'Ä' => 'a',
            'ç' | 'Ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'Ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'Ü' => 'u',
            'ł' => 'l',
            'ś' => 's',
            'ź' | 'ż' => 'z',
            'ę' => 'e',
            'ą' => 'a',
            c => c,
        })
        .collect::<String>()
        .to_lowercase()
}

/// Words of a text (folded, split on anything that is not a letter, a digit, `+` or `-`).
pub fn words(s: &str) -> Vec<String> {
    fold(s).split(|c: char| !(c.is_alphanumeric() || c == '+' || c == '-')).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// The concept a user's tag name stands for, if BMM knows it.
pub fn concept_for(tag_name: &str) -> Option<&'static Concept> {
    let f = fold(tag_name.trim());
    let ws = words(&f);
    CONCEPTS.iter().find(|c| c.names.iter().any(|n| fold(n) == f || ws.iter().any(|w| *w == fold(n))))
}

/// The criterion shown to the model for a tag: « Weapons — adds or changes weapons: … ».
pub fn tag_criterion(tag_name: &str) -> String {
    match concept_for(tag_name) {
        Some(c) => format!("{}: the mod {}", tag_name.trim(), c.desc),
        None => format!("{}: the mod is about {}", tag_name.trim(), tag_name.trim()),
    }
}

/// Keyword evidence for each tag, 0..1: the tag's own name in the text counts most, the
/// concept's evidence words next (saturating: three hits is as sure as keywords get).
pub fn lexical_tag_scores(text: &str, tag_names: &[String]) -> Vec<f64> {
    let ws = words(text);
    let hay = format!(" {} ", ws.join(" "));
    tag_names
        .iter()
        .map(|name| {
            let own = words(name).join(" ");
            let mut score = 0.0f64;
            if own.chars().count() >= 3 && hay.contains(&format!(" {} ", own)) {
                score += 0.6;
            }
            if let Some(c) = concept_for(name) {
                let hits = c
                    .evidence
                    .iter()
                    .filter(|e| {
                        let e = fold(e);
                        if e.contains(' ') || e.contains('-') { hay.contains(&format!(" {} ", e)) || hay.contains(&e) } else { ws.iter().any(|w| *w == e) }
                    })
                    .count();
                score += (hits as f64 * 0.25).min(0.75);
            }
            score.min(1.0)
        })
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// The informative part of a text
// ─────────────────────────────────────────────────────────────────────────────

/// Is this line prose (a sentence a person wrote), rather than a path list or a key: value
/// header? Used for the language question: « Files: Mods/aircraft/… » reads as English
/// whatever language the readme is in.
fn is_prose(line: &str) -> bool {
    let l = line.trim();
    if l.is_empty() {
        return false;
    }
    let lower = l.to_lowercase();
    for p in ["files:", "author:", "name:", "version:", "url:", "http"] {
        if lower.starts_with(p) {
            return false;
        }
    }
    let slashes = l.matches('/').count() + l.matches('\\').count();
    slashes * 12 < l.chars().count()
}

/// The prose of a text: « Description: … » / « Excerpt: … » / body lines, header keys dropped.
/// Falls back to the whole text when nothing reads as prose.
pub fn prose(text: &str) -> String {
    let lines: Vec<String> = text
        .lines()
        .filter(|l| is_prose(l))
        .map(|l| {
            let t = l.trim();
            for k in ["Description:", "Excerpt:", "Title:", "Titre :", "Titre:", "Titel:", "Título:", "Название:", "Описание:", "Beschreibung:", "Descripción:", "Nom :"] {
                if let Some(rest) = t.strip_prefix(k) {
                    return rest.trim().to_string();
                }
            }
            t.to_string()
        })
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() { text.trim().to_string() } else { lines.join("\n") }
}

const SIGNAL: &[&str] = &[
    "error", "erreur", "fehler", "panic", "panicked", "exception", "crash", "crashed", "plante", "failed", "fatal", "access violation",
    "not responding", "freeze", "froze", "stack overflow", "unwrap", "denied", "missing", "corrupt", "lost", "deleted", "slow", "lent",
];

/// A long input cut to its most telling lines, in their original order, within `budget` chars:
/// the first line (a report's title) always, then lines carrying error words, then the rest.
/// A 20 000-line log becomes the dozen lines that say what happened — the model reads at most
/// ~1000 tokens anyway, and the first 1000 of a log are start-up noise.
pub fn informative_chunks(text: &str, budget: usize) -> String {
    if text.chars().count() <= budget {
        return text.to_string();
    }
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut scored: Vec<(usize, i32)> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let f = fold(l);
            let mut s = 0i32;
            if i == 0 {
                s += 100;
            }
            s += SIGNAL.iter().filter(|w| f.contains(*w)).count() as i32 * 10;
            if is_prose(l) {
                s += 3;
            }
            // Repeated lines (a loop in a log) are worth one.
            (i, s)
        })
        .collect();
    scored.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut keep: Vec<usize> = Vec::new();
    let mut used = 0usize;
    let mut seen: Vec<String> = Vec::new();
    for (i, _) in scored {
        let l = lines[i].trim();
        let key = fold(l);
        if seen.contains(&key) {
            continue;
        }
        let n = l.chars().count().min(400) + 1;
        if used + n > budget {
            continue;
        }
        used += n;
        seen.push(key);
        keep.push(i);
    }
    keep.sort_unstable();
    keep.iter().map(|i| lines[*i].trim().chars().take(400).collect::<String>()).collect::<Vec<_>>().join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Answers: all probabilities of a choice, not only the winner
// ─────────────────────────────────────────────────────────────────────────────

/// Every option's probability for a `choice` answer (the embedded engine and laya-serve both
/// return them under `probabilities`). Falls back to the single choice at its confidence.
pub fn choice_probs(resp: &Value, id: &str) -> Vec<(String, f64)> {
    let a = resp.get("answers").and_then(|a| a.get(id));
    if let Some(m) = a.and_then(|a| a.get("probabilities")).and_then(|p| p.as_object()).filter(|m| !m.is_empty()) {
        return m.iter().filter_map(|(k, v)| v.as_f64().map(|p| (k.clone(), p))).collect();
    }
    match ai_core::laya_answer(resp, id) {
        (Some(c), _, p) => vec![(c, p.unwrap_or(0.6))],
        _ => Vec::new(),
    }
}

/// P(true) of a yes/no answer.
pub fn noul_p(resp: &Value, id: &str) -> Option<f64> {
    ai_core::laya_answer(resp, id).1
}

// ─────────────────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────────────────

/// The weights of the votes and the probability under which a tag is not suggested, fitted on
/// the even ids of laya_eval.json and checked on the odd ids and on the blind block (figures in
/// laya-model.lock.json, `pipeline`).
///
/// Two regimes, because the evidence differs. For a tag BMM knows ([`concept_for`]), the
/// keyword evidence is strong and Laya's yes/no refines it. For a tag it does not know
/// (« WWII », « Multiplayer »), there are no keywords but the tag's own name: Laya's two votes
/// carry it.
pub const TAG_W_NOUL: f64 = 0.20;
pub const TAG_W_LEX: f64 = 0.80;
pub const TAG_U_NOUL: f64 = 0.50;
pub const TAG_U_CHOICE: f64 = 0.50;
pub const TAG_THRESHOLD: f64 = 0.35;

/// The questions for a mod's tags: one choice among the pre-filtered candidates (+ « none »),
/// and one yes/no per candidate, both with the descriptive criterion. `candidates` are indexes
/// into `names`.
pub fn tag_questions(names: &[String], candidates: &[usize]) -> Vec<LayaQuestion<'static>> {
    let mut qs: Vec<LayaQuestion> = Vec::new();
    if candidates.is_empty() {
        return qs;
    }
    let mut crit: Vec<(String, String)> = candidates.iter().map(|i| (format!("t{}", i), tag_criterion(&names[*i]))).collect();
    crit.push(("none".into(), "none of these tags fits this mod".into()));
    qs.push(("tags_choice".into(), "choice", "Which tag best describes what this game mod adds or changes?".into(), crit));
    for i in candidates {
        let c = tag_criterion(&names[*i]);
        qs.push((format!("tag_{}", i), "noul", format!("A game mod gets the tag \"{}\". Does this tag fit the mod described in the text?", c), Vec::new()));
    }
    qs
}

/// The candidates worth asking about, at most `k`: the KNOWN tags with keyword evidence (best
/// first) — a known tag without any cannot reach the threshold, so asking about it is wasted
/// time — then the tags BMM has no concept for, in the user's order.
pub fn tag_candidates(names: &[String], lexical: &[f64], k: usize) -> Vec<usize> {
    let mut known: Vec<usize> = (0..names.len()).filter(|i| concept_for(&names[*i]).is_some() && lexical[*i] > 0.0).collect();
    known.sort_by(|a, b| lexical[*b].partial_cmp(&lexical[*a]).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(b)));
    let unknown = (0..names.len()).filter(|i| concept_for(&names[*i]).is_none());
    known.into_iter().chain(unknown).take(k).collect()
}

/// Combine the votes into one probability per candidate. The choice is scaled so that « clearly
/// the best of k » reads near 1, and damped by P(none), so a text that fits no tag pulls every
/// tag down.
pub fn combine_tag_votes(names: &[String], candidates: &[usize], lexical: &[f64], noul: &[Option<f64>], choice: &[(String, f64)]) -> Vec<(usize, f64)> {
    let p_none = choice.iter().find(|(k, _)| k == "none").map(|(_, p)| *p).unwrap_or(0.0);
    let n = candidates.len().max(1) as f64;
    let mut out = Vec::new();
    for (j, i) in candidates.iter().enumerate() {
        let pc = choice.iter().find(|(k, _)| *k == format!("t{}", i)).map(|(_, p)| *p).unwrap_or(0.0);
        let pc = (pc * n / 2.0).min(1.0) * (1.0 - p_none * 0.5);
        let pn = noul.get(j).copied().flatten().unwrap_or(0.0);
        let lx = lexical.get(*i).copied().unwrap_or(0.0);
        let p = if concept_for(&names[*i]).is_some() { TAG_W_NOUL * pn + TAG_W_LEX * lx } else { (TAG_U_NOUL * pn + TAG_U_CHOICE * pc + 0.5 * lx).min(1.0) };
        out.push((*i, p));
    }
    out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// The tags to suggest: above the threshold, best first, at most `max`. The app now decides
/// through `ai_tuning::decide_independent` (« Équilibré » gives this exactly; a test pins it).
#[cfg_attr(not(test), allow(dead_code))]
pub fn pick_tags(combined: &[(usize, f64)], max: usize) -> Vec<(usize, f64)> {
    combined.iter().filter(|(_, p)| *p >= TAG_THRESHOLD).take(max).cloned().collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Language
// ─────────────────────────────────────────────────────────────────────────────

/// The ten languages BMM names (the eval bench scores the hint against them).
#[cfg_attr(not(test), allow(dead_code))]
pub const LANGS: &[(&str, &str)] = &[
    ("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish"), ("it", "Italian"),
    ("pt", "Portuguese"), ("ru", "Russian"), ("pl", "Polish"), ("zh", "Chinese"), ("ja", "Japanese"),
];

/// The language hint: the stop-word / letter / script detector on the PROSE of the text (file
/// lists read as English whatever the readme's language). Laya is not asked: measured on the
/// eval set it is no language identifier (37 % right over ten languages, 15 % on short
/// snippets), so its vote only added noise — and a question.
pub fn language_hint(text: &str) -> Option<(&'static str, f32)> {
    ai_core::detect_language(&prose(text))
}

// ─────────────────────────────────────────────────────────────────────────────
// Adult content
// ─────────────────────────────────────────────────────────────────────────────

pub fn nsfw_question() -> LayaQuestion<'static> {
    (
        "nsfw".into(),
        "noul",
        "Does this game mod contain nudity, sexual content, or content marked 18+ or adults only?".into(),
        vec![("false".into(), "no, it is ordinary game content".into()), ("true".into(), "yes, it contains nudity or adult-only content".into())],
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

pub const REPORT_CRITERIA: &[(&str, &str)] = &[
    ("crash", "BMM or the game closes, quits, panics or stops by itself (crash, access violation, exits on start)"),
    ("bug", "a feature gives a wrong result or does nothing: data lost, wrong state, a button without effect"),
    ("performance", "something is slow, freezes for a while, stutters or uses too much CPU, disk or memory"),
    ("install", "installing, updating or uninstalling BMM fails or leaves files behind"),
    ("mod_conflict", "two mods or two profiles replace the same files, or the load order picks the wrong mod"),
    ("ui", "a display problem: typo, unreadable text, overlapping or misplaced element"),
    ("other", "a question, a suggestion or a feature request, not a problem"),
];
pub const SEVERITY_CRITERIA: &[(&str, &str)] = &[
    ("low", "cosmetic or a question: a typo, a colour, a small annoyance; nothing is blocked"),
    ("medium", "a feature misbehaves or is slow, but there is a workaround"),
    ("high", "the game, the install or a main feature does not work at all"),
    ("critical", "data is lost or deleted, or BMM cannot start at all"),
];

/// Under this, the category hint is not shown.
pub const CATEGORY_THRESHOLD: f64 = 0.30;

/// What a kind of problem usually costs the user — the severity BMM assumes before reading the
/// details. Measured: Laya alone answers « medium » for nearly everything (41.7 % right); this
/// prior with Laya breaking ties is right 60 % of the time on the tuning set.
pub fn severity_prior(category: &str) -> &'static str {
    match category {
        "crash" | "install" => "high",
        "ui" | "other" => "low",
        _ => "medium",
    }
}

/// Words that make any problem critical: lost data, or BMM that cannot start at all.
const CRITICAL: &[&str] = &[
    "lost", "deleted", "wiped", "disappeared", "gone", "perdu", "disparu", "efface", "supprime", "0 octet", "0 byte", "0 kb", "every start", "on startup", "at startup",
    "cannot start", "can't start", "won't start", "will not start", "au demarrage", "ne demarre plus", "des l'ouverture", "au lancement", "beim start", "startet nicht",
];

/// Severity: the prior (or « critical » when the text says data is lost or BMM cannot start),
/// with Laya's distribution as the tie-breaker (weight 0.4 against 0.6).
pub fn combine_severity(category: &str, text: &str, laya: &[(String, f64)]) -> (String, f64) {
    let f = fold(text);
    let prior = if CRITICAL.iter().any(|w| f.contains(w)) { "critical" } else { severity_prior(category) };
    let mut best = (prior.to_string(), 0.0);
    for (k, _) in SEVERITY_CRITERIA {
        let pl = laya.iter().find(|(c, _)| c == k).map(|(_, p)| *p).unwrap_or(0.0);
        let p = 0.4 * pl + if *k == prior { 0.6 } else { 0.0 };
        if p > best.1 {
            best = (k.to_string(), p);
        }
    }
    best
}

pub fn report_questions() -> Vec<LayaQuestion<'static>> {
    vec![
        ("category".into(), "choice", "What kind of problem does this report describe?".into(), REPORT_CRITERIA.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
        ("severity".into(), "choice", "How bad is this problem for the user?".into(), SEVERITY_CRITERIA.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
    ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicates
// ─────────────────────────────────────────────────────────────────────────────

pub const DUP_THRESHOLD: f64 = 0.55;
/// Weight of Laya's yes/no against the word overlap (fitted on the even ids).
pub const DUP_W_NOUL: f64 = 0.50;
/// Earlier reports asked about at most (the closest by words).
pub const DUP_CANDIDATES: usize = 3;

const STOP: &[&str] = &[
    "the", "and", "for", "with", "this", "that", "when", "from", "have", "has", "was", "are", "not", "but", "you", "your", "into", "then",
    "les", "des", "une", "pour", "avec", "dans", "est", "pas", "que", "qui", "sur", "quand", "mais", "vous", "par", "sont", "title", "titre",
    "bmm", "mod", "mods", "app", "every", "after", "all", "des", "the",
];

/// A report's distinct meaningful words (≥ 3 letters, no stop-words) — the same idea as the
/// frontend's `reportSig`.
pub fn sig(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in words(text) {
        if w.chars().count() >= 3 && !STOP.contains(&w.as_str()) && !out.contains(&w) {
            out.push(w);
        }
    }
    out
}

/// Word overlap with prefix matching (« crash » ~ « crashes », « lent » ~ « lente »).
pub fn overlap(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let near = |x: &String, y: &String| {
        let (s, l) = if x.len() <= y.len() { (x, y) } else { (y, x) };
        s == l || (s.chars().count() >= 4 && l.starts_with(s.as_str()))
    };
    let inter = a.iter().filter(|x| b.iter().any(|y| near(x, y))).count() as f64;
    inter / (a.len().min(b.len()) as f64)
}

/// The closest earlier reports by words, best first (indexes into `known`).
pub fn dup_candidates(text: &str, known: &[String], k: usize) -> Vec<(usize, f64)> {
    let s = sig(text);
    let mut v: Vec<(usize, f64)> = known.iter().enumerate().map(|(i, t)| (i, overlap(&s, &sig(t)))).collect();
    v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    v.truncate(k);
    v
}

pub fn dup_questions(known: &[String], cands: &[(usize, f64)]) -> Vec<LayaQuestion<'static>> {
    let mut qs: Vec<LayaQuestion> = Vec::new();
    for (i, _) in cands {
        let k: String = known[*i].chars().take(200).collect();
        qs.push((format!("dup_{}", i), "noul", format!("An earlier report says: \"{}\". Does the text describe the same problem as that earlier report?", k), Vec::new()));
    }
    qs
}

/// P(duplicate of i) = the yes/no vote and the word overlap, averaged.
pub fn combine_dup(cands: &[(usize, f64)], noul: &[Option<f64>]) -> Option<(usize, f64)> {
    let mut best: Option<(usize, f64)> = None;
    for (j, (i, ov)) in cands.iter().enumerate() {
        let pn = noul.get(j).copied().flatten().unwrap_or(0.0);
        let p = DUP_W_NOUL * pn + (1.0 - DUP_W_NOUL) * ov.min(1.0);
        if best.map(|b| p > b.1).unwrap_or(true) {
            best = Some((*i, p));
        }
    }
    best.filter(|(_, p)| *p >= DUP_THRESHOLD)
}

// ─────────────────────────────────────────────────────────────────────────────
// The router: which pack answers, and the pipeline around it
// ─────────────────────────────────────────────────────────────────────────────

/// A model pack as the router sees it: its id, the languages it reads ("*" = any, else a
/// comma-separated list of codes) and whether it is installed.
#[derive(Debug, Clone)]
pub struct PackRef {
    pub id: String,
    pub languages: String,
    pub installed: bool,
}

/// The packs to ask for a text in `lang` (the detector's hint), best first. A pack made for
/// that language comes before a multilingual one; with two installed candidates both are
/// returned and the caller may average them (an ensemble). Nothing installed → empty.
///
/// BMM ships ONE pack today: measured on the English part of laya_eval.json with the same
/// questions, the English checkpoint was not better than the multilingual one and an average
/// of the two not better either (laya-model.lock.json, `router`), for a second 450 MB download.
/// The router is what makes adding one later a pin, not a rewrite.
pub fn route(packs: &[PackRef], lang: Option<&str>) -> Vec<String> {
    let reads = |p: &PackRef, l: &str| p.languages.split(',').any(|x| x.trim() == l);
    let mut own: Vec<String> = Vec::new();
    let mut any: Vec<String> = Vec::new();
    for p in packs.iter().filter(|p| p.installed) {
        if p.languages == "*" {
            any.push(p.id.clone());
        } else if lang.map(|l| reads(p, l)).unwrap_or(false) {
            own.push(p.id.clone());
        }
    }
    own.into_iter().chain(any).collect()
}

/// The AI pipeline as it stands, stage by stage, for Settings, `bmm ai-status` and the MCP:
/// deterministic reading first (always, offline), then the classifier — which decides and
/// filters, never writes — then a generator, which only drafts, only if the user configured one.
pub fn pipeline(settings: &ai_core::AiSettings, killed: bool, packs: &[PackRef]) -> Value {
    let on = settings.enabled && !killed;
    let classifier = if !on { "off".to_string() } else { settings.classifier.clone() };
    // The packs the router would use for a text in no particular language, in order.
    let local_packs = route(packs, None);
    serde_json::json!([
        { "stage": "read", "what": "the mod's own files, keyword evidence, the language detector, the report's masking", "runs": "always", "network": false },
        { "stage": "classify", "what": "Laya: tags among the user's own, adult content, report category / severity / duplicate, Ask ranking", "provider": classifier,
          "packs": if classifier == "embedded" { serde_json::json!(local_packs) } else { serde_json::json!([]) },
          "network": on && matches!(settings.classifier.as_str(), "bettercommunity" | "local") },
        { "stage": "draft", "what": "a description draft, checked (no invented link, file or command; tags only from the user's own) and gated by Laya; never applied without a click", "provider": if on && settings.description_drafts { settings.generative.as_str() } else { "off" }, "network": on && settings.description_drafts && settings.generative == "external" },
        { "stage": "answer", "what": "« Ask Laya »: a written answer from the retrieved sources only, citing them; skipped when Laya abstains", "provider": if on && settings.ask_generate { settings.generative.as_str() } else { "off" }, "network": on && settings.ask_generate && settings.generative == "external" },
    ])
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tag_is_recognised_in_any_language() {
        for (name, key) in [("Weapons", "weapons"), ("Armes", "weapons"), ("Waffen", "weapons"), ("Оружие", "weapons"), ("Livrées", "liveries"), ("Cartes", "maps"), ("Correctifs", "fixes"), ("Adulte", "adult"), ("UI", "interface")] {
            assert_eq!(concept_for(name).map(|c| c.key), Some(key), "{}", name);
        }
        assert!(concept_for("Squadron 494").is_none());
        assert!(tag_criterion("Squadron 494").starts_with("Squadron 494: the mod is about"));
    }

    #[test]
    fn keyword_evidence_ranks_the_right_tag_first() {
        let names: Vec<String> = ["Aircraft", "Maps", "Weapons", "Sound"].iter().map(|s| s.to_string()).collect();
        let s = lexical_tag_scores("Adds the GBU-39 bomb with a guided missile rack", &names);
        let best = s.iter().enumerate().fold((0, -1.0), |a, (i, v)| if *v > a.1 { (i, *v) } else { a }).0;
        assert_eq!(names[best], "Weapons");
        assert_eq!(tag_candidates(&names, &s, 2)[0], 2);
        // An unknown tag is always a candidate (only Laya can judge it); a known tag without
        // any evidence never is.
        let mixed: Vec<String> = ["Weapons", "Maps", "WWII"].iter().map(|s| s.to_string()).collect();
        let lx = lexical_tag_scores("Adds the GBU-39 bomb", &mixed);
        assert_eq!(tag_candidates(&mixed, &lx, 8), vec![0, 2]);
    }

    #[test]
    fn prose_drops_paths_and_headers() {
        let t = "Name: Foo\nDescription: Remplace les sons des moteurs.\nFiles: Mods/aircraft/a.dds, Sounds/b.ogg";
        assert_eq!(prose(t), "Remplace les sons des moteurs.");
    }

    #[test]
    fn a_long_log_keeps_its_title_and_its_errors() {
        let mut t = String::from("Title: BMM closes on start\n");
        for i in 0..2000 {
            t.push_str(&format!("INFO loading plugin {}\n", i));
        }
        t.push_str("thread 'main' panicked at 'index out of bounds'\n");
        let c = informative_chunks(&t, 600);
        assert!(c.starts_with("Title: BMM closes on start"));
        assert!(c.contains("panicked"));
        assert!(c.chars().count() <= 600);
    }

    #[test]
    fn votes_below_the_threshold_are_not_suggested() {
        let combined = vec![(0usize, 0.9), (1, 0.34), (2, 0.2)];
        assert_eq!(pick_tags(&combined, 3), vec![(0, 0.9)]);
        let names: Vec<String> = ["WWII", "Naval"].iter().map(|s| s.to_string()).collect();
        let none_heavy = combine_tag_votes(&names, &[0, 1], &[0.0, 0.0], &[Some(0.2), Some(0.2)], &[("t0".into(), 0.05), ("t1".into(), 0.05), ("none".into(), 0.9)]);
        assert!(pick_tags(&none_heavy, 3).is_empty());
        let yes = combine_tag_votes(&names, &[0, 1], &[0.0, 0.0], &[Some(0.9), Some(0.1)], &[("t0".into(), 0.8), ("t1".into(), 0.1), ("none".into(), 0.1)]);
        assert_eq!(pick_tags(&yes, 3).iter().map(|x| x.0).collect::<Vec<_>>(), vec![0]);
    }

    #[test]
    fn the_language_hint_reads_the_prose_not_the_paths() {
        let t = "Name: X\nDescription: Remplace les sons des moteurs par des enregistrements réels.\nFiles: Sounds/Effects/Engines/the_engine_and_the_sound.ogg";
        assert_eq!(language_hint(t).map(|x| x.0), Some("fr"));
        assert_eq!(language_hint("Rozpakuj archiwum do folderu i włącz moda w menedżerze.").map(|x| x.0), Some("pl"));
        assert_eq!(language_hint("Requiere la última beta abierta. Problema conocido: la pantalla izquierda parpadea de noche.").map(|x| x.0), Some("es"));
    }

    #[test]
    fn duplicates_need_words_and_a_yes() {
        let known = vec!["Installer error 1603 during setup".to_string(), "Library view is slow".to_string()];
        let c = dup_candidates("Setup rolls back with error 1603", &known, 3);
        assert_eq!(c[0].0, 0);
        assert_eq!(combine_dup(&c, &[Some(0.9), Some(0.1)]).map(|x| x.0), Some(0));
        assert!(combine_dup(&c, &[Some(0.1), Some(0.1)]).is_none());
    }

    #[test]
    fn the_router_prefers_a_pack_made_for_the_language() {
        let ml = PackRef { id: "laya-multilingual".into(), languages: "*".into(), installed: true };
        let en = PackRef { id: "laya-en".into(), languages: "en".into(), installed: true };
        assert_eq!(route(&[ml.clone()], Some("fr")), vec!["laya-multilingual"]);
        assert_eq!(route(&[ml.clone(), en.clone()], Some("en")), vec!["laya-en", "laya-multilingual"]);
        assert_eq!(route(&[ml.clone(), en.clone()], Some("de")), vec!["laya-multilingual"]);
        let absent = PackRef { installed: false, ..ml };
        assert!(route(&[absent], Some("en")).is_empty());
    }

    #[test]
    fn the_pipeline_says_what_can_reach_the_network() {
        let mut s = ai_core::AiSettings::default();
        let packs = vec![PackRef { id: "laya-multilingual".into(), languages: "*".into(), installed: true }];
        let p = pipeline(&s, false, &packs);
        assert_eq!(p[1]["provider"], "off");
        s.enabled = true;
        s.classifier = "embedded".into();
        let p = pipeline(&s, false, &packs);
        assert_eq!(p[1]["network"], false);
        assert_eq!(p[1]["packs"][0], "laya-multilingual");
        s.classifier = "bettercommunity".into();
        assert_eq!(pipeline(&s, false, &packs)[1]["network"], true);
        assert_eq!(pipeline(&s, true, &packs)[1]["provider"], "off", "--no-ai wins");
    }

    #[test]
    fn severity_starts_from_the_kind_of_problem() {
        assert_eq!(combine_severity("ui", "Typo in the menu", &[("medium".into(), 0.7)]).0, "low");
        assert_eq!(combine_severity("bug", "All my profiles were deleted", &[("medium".into(), 0.9)]).0, "critical");
        assert_eq!(combine_severity("crash", "BMM closes when I click", &[]).0, "high");
    }
}
