// ai-model.ts — the pure half of the optional AI features (no DOM, no Tauri, no i18n).
//
// Imported by the dialogs AND by the node tests (tests/ai-model.test.mjs load the compiled
// file), which is why nothing here may import anything: what is tested is exactly what runs.
//
// The rules that matter live in Rust (commands/ai_core.rs): the master switch, the provider
// gate, the URL checks, the redaction. This file only shapes what the user sees and ticks:
//   · suggestion rows, each with its source and confidence, NOTHING pre-applied;
//   · the `fields` object built from the ticked rows only — the apply call writes that and
//     nothing else;
//   · "have I already sent this report?" against the local report history.

/** One suggestion as `ai_suggest_mod_metadata` returns it. */
export interface AiSuggestion {
    field: 'name' | 'version' | 'author' | 'description' | 'tags' | 'links' | 'language' | 'nsfw' | string;
    value: unknown;
    source: 'file' | 'folder' | 'laya' | 'bettercommunity' | 'api' | string;
    origin: string;
    confidence: number;
    applicable: boolean;
    note?: string;
}

export interface AiSettings {
    enabled: boolean;
    classifier: 'off' | 'embedded' | 'bettercommunity' | 'local' | string;
    /** The user picked the classifier in Settings; until then an installed built-in model is the default. */
    classifier_chosen?: boolean;
    /** « Rédaction »: off | local (an OpenAI-compatible server on this PC) | external (a remote API, the user's key). */
    generative: 'off' | 'local' | 'external' | string;
    mod_suggest: boolean;
    report_triage: boolean;
    description_drafts: boolean;
    /** « Ask Laya » and the library's smart search may let Laya route and rank (the search runs regardless). */
    ask?: boolean;
    /** « Ask Laya » may add a written answer from the generator, citing the sources found. */
    ask_generate?: boolean;
    /** The local generator (loopback only) and its model. */
    gen_local_url?: string;
    gen_local_model?: string;
    local_url: string;
    local_allow_remote: boolean;
    external_url: string;
    external_model: string;
    bc_consent: boolean;
    timeout_ms: number;
    installer_choice?: boolean | null;
}

/** A row of the suggestion dialog. `checked` starts FALSE: the user opts in, field by field. */
export interface SuggestionRow {
    key: string;
    field: string;
    value: unknown;
    display: string;
    current: string;
    source: string;
    origin: string;
    confidence: number;
    applicable: boolean;
    checked: boolean;
    note: string;
}

/** The subset of a mod the dialog compares against. */
export interface ModView {
    name?: string;
    version?: string;
    author?: string | null;
    description?: string | null;
    tags?: string[];
    download_links?: Array<{ url: string }>;
}

const SCALAR = new Set(['name', 'version', 'author', 'description']);
export const APPLICABLE_FIELDS = ['name', 'version', 'author', 'description', 'tags', 'links'] as const;

function asText(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v && 'url' in (v as any)) return String((v as any).url || '');
    return String(v);
}

/** Rows for the dialog. `tagName` resolves a tag id to its display name. */
export function rowsFromSuggestions(list: AiSuggestion[], mod: ModView, tagName: (id: string) => string): SuggestionRow[] {
    return (Array.isArray(list) ? list : []).map((s, i) => {
        const field = String(s.field || '');
        let display = asText(s.value);
        let current = '';
        if (field === 'tags') { display = s.note || tagName(asText(s.value)) || asText(s.value); current = (mod.tags || []).map(tagName).join(', '); }
        else if (field === 'links') { current = (mod.download_links || []).map((l) => l.url).join('\n'); }
        else if (field === 'nsfw') { display = s.value === true ? 'yes' : 'no'; }
        else if (SCALAR.has(field)) { current = String((mod as any)[field] ?? ''); }
        return {
            key: `${field}:${i}`,
            field,
            value: s.value,
            display,
            current,
            source: String(s.source || ''),
            origin: String(s.origin || ''),
            confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0)),
            applicable: !!s.applicable && (APPLICABLE_FIELDS as readonly string[]).includes(field),
            checked: false,
            note: String(s.note || ''),
        };
    });
}

/**
 * Tick a row. Scalar fields are exclusive: ticking one "description" unticks the other
 * alternative, because only one value can be written.
 */
export function toggleRow(rows: SuggestionRow[], key: string, on: boolean): SuggestionRow[] {
    const target = rows.find((r) => r.key === key);
    if (!target || !target.applicable) return rows;
    return rows.map((r) => {
        if (r.key === key) return { ...r, checked: on };
        if (on && SCALAR.has(target.field) && r.field === target.field) return { ...r, checked: false };
        return r;
    });
}

/**
 * The apply payload from the ticked rows only. Hints (language, adult content) never reach
 * it, and a field with nothing ticked is absent — absent means "leave it alone".
 */
export function buildFields(rows: SuggestionRow[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const tags: string[] = [];
    const links: Array<{ url: string; label: string; link_type?: string }> = [];
    for (const r of rows) {
        if (!r.checked || !r.applicable) continue;
        if (SCALAR.has(r.field)) out[r.field] = asText(r.value);
        else if (r.field === 'tags') { const id = asText(r.value); if (id && !tags.includes(id)) tags.push(id); }
        else if (r.field === 'links') {
            const v = r.value as any;
            const url = asText(v);
            if (url && !links.some((l) => l.url === url)) links.push({ url, label: String(v?.label || ''), link_type: v?.link_type });
        }
    }
    if (tags.length) out.tags = tags;
    if (links.length) out.links = links;
    return out;
}

/** Bytes → "327 MB" (decimal units, like the installer and the docs). */
export function fmtBytes(n: number): string {
    const v = Math.max(0, Number(n) || 0);
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
    if (v >= 1e6) return `${Math.round(v / 1e6)} MB`;
    if (v >= 1e3) return `${Math.round(v / 1e3)} kB`;
    return `${v} B`;
}

/** 0..1 → "87 %"-style integer. */
export function pct(c: number): number { return Math.round(Math.max(0, Math.min(1, Number(c) || 0)) * 100); }

// ── Reports: have I sent this already? ──────────────────────────────────────

const STOP = new Set(('the and for with this that when from have has was are not but you your into then ' +
    'les des une pour avec dans est pas que qui sur quand mais vous par sont ' +
    'bmm mod mods app').split(' '));

/** A report's signature: its distinct meaningful words (≥ 3 letters, no stop-words), max 40. */
export function reportSig(title: string, body = ''): string[] {
    const words = `${title} ${String(body).slice(0, 400)}`
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP.has(w));
    return [...new Set(words)].slice(0, 40);
}

export function jaccard(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0;
    const A = new Set(a), B = new Set(b);
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
}

export interface HistoryEntry { id?: string; title?: string; date?: string; sig?: string[]; type?: string }

/**
 * Recent reports (last `days`) that look like this one. Title-only history entries (written
 * before signatures existed) are compared by their title words.
 */
export function similarReports(title: string, body: string, history: HistoryEntry[], now = Date.now(), days = 30, threshold = 0.5): Array<{ entry: HistoryEntry; score: number }> {
    const mine = reportSig(title, body);
    const mineTitle = reportSig(title);
    const cutoff = now - days * 86_400_000;
    const out: Array<{ entry: HistoryEntry; score: number }> = [];
    for (const e of Array.isArray(history) ? history : []) {
        const at = Date.parse(String(e?.date || ''));
        if (!Number.isFinite(at) || at < cutoff) continue;
        const theirs = Array.isArray(e.sig) && e.sig.length ? e.sig : reportSig(String(e.title || ''));
        const score = Math.max(jaccard(mine, theirs), jaccard(mineTitle, reportSig(String(e.title || ''))));
        if (score >= threshold) out.push({ entry: e, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** Can a provider be asked at all? Mirrors the Rust gate so the UI can explain, not decide. */
export function providerBlock(s: Pick<AiSettings, 'enabled' | 'classifier' | 'bc_consent'> | null | undefined, feature: 'mod' | 'report'): '' | 'ai_off' | 'no_provider' | 'no_consent' | 'feature_off' {
    if (!s || !s.enabled) return 'ai_off';
    const f = feature === 'mod' ? (s as any).mod_suggest : (s as any).report_triage;
    if (f === false) return 'feature_off';
    if (s.classifier === 'local' || s.classifier === 'embedded') return '';
    if (s.classifier === 'bettercommunity') return s.bc_consent ? '' : 'no_consent';
    return 'no_provider';
}

// ── « Laya intégré »: the install state machine ─────────────────────────────
//
// One state, derived from what Rust reports (`ai_embedded_status`) and what the install is
// doing right now (the `ai-embedded-progress` events). The Settings block draws exactly one
// of these, so there is no « Install » button beside a progress bar, no « Remove » during a
// download, and an error always comes with a way out (retry, open the folder).

export type EmbState = 'killed' | 'absent' | 'partial' | 'outdated' | 'no_space' | 'downloading' | 'verifying' | 'unpacking' | 'installed' | 'loaded' | 'error';

export interface EmbStatus {
    installed?: boolean; loaded?: boolean; partialBytes?: number; outdated?: boolean;
    neededBytes?: number; freeBytes?: number | null; downloadBytes?: number;
}
export interface EmbLive { phase?: 'download' | 'verify' | 'unpack' | ''; error?: string }

export function embState(st: EmbStatus | null | undefined, live: EmbLive = {}, killed = false): EmbState {
    if (killed) return 'killed';
    if (live.phase === 'download') return 'downloading';
    if (live.phase === 'verify') return 'verifying';
    if (live.phase === 'unpack') return 'unpacking';
    if (live.error) return 'error';
    const s = st || {};
    if (s.installed) return s.loaded ? 'loaded' : 'installed';
    if (typeof s.freeBytes === 'number' && typeof s.neededBytes === 'number' && s.freeBytes < s.neededBytes) return 'no_space';
    if (s.outdated) return 'outdated';
    if ((s.partialBytes || 0) > 0) return 'partial';
    return 'absent';
}

/** 1.5 MB/s-style speed (decimal units, like fmtBytes). */
export function fmtSpeed(bytesPerSec: number): string {
    const v = Math.max(0, Number(bytesPerSec) || 0);
    if (v <= 0) return '';
    return `${fmtBytes(v)}/s`;
}

/** Seconds → "1:05" / "12:00" / "1 h 02". Empty when unknown. */
export function fmtEta(secs: number | null | undefined): string {
    if (secs == null || !Number.isFinite(Number(secs)) || Number(secs) < 0) return '';
    const s = Math.round(Number(secs));
    if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "embedded:no_space:<needed>:<free>" → the two numbers, else null. */
export function parseNoSpace(err: string): { needed: number; free: number } | null {
    const m = /embedded:no_space:(\d+):(\d+)/.exec(String(err || ''));
    return m ? { needed: Number(m[1]), free: Number(m[2]) } : null;
}

// ── « Ask Laya »: shaping the answer for the dialog ─────────────────────────

export interface AskHit { kind: string; id: string; title: string; snippet: string; score: number; laya?: number | null; action: any }
export interface AskAnswer {
    question: string; intent: string; intent_p: number; routed_by: string; hits: AskHit[];
    files: Array<{ mod_id: string; mod_name: string; enabled: boolean; files: string[]; total: number }>;
    conflicts: Array<{ a_id: string; a_name: string; b_id: string; b_name: string; both_enabled: boolean; count: number; sample: string[] }>;
    laya: boolean; low_confidence: boolean; notes: string[]; ms: number;
}

/** Group hits by what they are, in the order the intent makes most useful. */
export function groupHits(a: Pick<AskAnswer, 'intent' | 'hits'>): Array<{ kind: string; hits: AskHit[] }> {
    const order: Record<string, string[]> = {
        docs: ['doc', 'article', 'setting', 'command', 'mod', 'profile'],
        setting: ['setting', 'doc', 'article', 'command', 'mod', 'profile'],
        command: ['command', 'setting', 'doc', 'article', 'mod', 'profile'],
        mods: ['mod', 'profile', 'doc', 'article', 'setting', 'command'],
        files: ['mod', 'doc', 'article', 'setting', 'command', 'profile'],
        conflicts: ['mod', 'doc', 'article', 'setting', 'command', 'profile'],
    };
    const ord = order[a.intent] || order.docs;
    const by = new Map<string, AskHit[]>();
    for (const h of a.hits || []) {
        const k = h.kind === 'article' ? 'doc' : h.kind;
        if (!by.has(k)) by.set(k, []);
        by.get(k)!.push(h);
    }
    const kinds = [...new Set(ord.map((k) => (k === 'article' ? 'doc' : k)))];
    return kinds.filter((k) => by.has(k)).map((k) => ({ kind: k, hits: by.get(k)! }));
}

/** The best hit is shown first, on its own, when it clearly leads (or Laya picked it). */
export function topPick(a: Pick<AskAnswer, 'hits' | 'low_confidence'>): AskHit | null {
    const h = a.hits || [];
    if (!h.length || a.low_confidence) return null;
    if (h.length === 1) return h[0];
    return h[0].score - h[1].score >= 0.15 || (h[0].laya ?? 0) >= 0.5 ? h[0] : null;
}

/** Library « smart » search: the ids of the mods an answer ranked, best first. */
export function rankedModIds(a: Pick<AskAnswer, 'hits'> | null | undefined): string[] {
    return (a?.hits || []).filter((h) => h.kind === 'mod').map((h) => String(h.action?.mod || h.id.replace(/^mod:/, ''))).filter(Boolean);
}
