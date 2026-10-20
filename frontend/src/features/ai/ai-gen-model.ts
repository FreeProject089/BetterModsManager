// ai-gen-model.ts — the pure rules behind « Rédaction » (the generator) in the Laya dialog and the
// drafting dialog. No DOM, no i18n, no network: tests/ai-gen.test.mjs loads it in node.
//
// The network half is Rust's (commands/ai_gen.rs): the probe, the stream, the prompts. This file
// only knows the shapes, the local server presets, how a typed address is read (the same rule as
// Rust's `normalize_gen_base`, to show « will use … » while typing), how to word a probe, and the
// draft's diff / apply / undo.

/** A local server people run: its usual address. */
export interface GenPreset { id: 'lmstudio' | 'ollama' | 'llamacpp' | 'custom'; url: string; port: number | null }
export const GEN_PRESETS: GenPreset[] = [
    { id: 'lmstudio', url: 'http://127.0.0.1:1234/v1', port: 1234 },
    { id: 'ollama', url: 'http://127.0.0.1:11434/v1', port: 11434 },
    { id: 'llamacpp', url: 'http://127.0.0.1:8080/v1', port: 8080 },
    { id: 'custom', url: '', port: null },
];

const SUFFIXES = ['/chat/completions', '/completions', '/embeddings', '/models', '/api/v0', '/api/tags', '/api/chat', '/api/generate'];

/** The OpenAI-compatible base for an address as typed (mirror of Rust `normalize_gen_base`). */
export function normalizeBase(raw: string): string {
    const t = String(raw || '').trim();
    if (!t) return '';
    const withScheme = t.includes('://') ? t : `http://${t}`;
    let u: URL;
    try { u = new URL(withScheme); } catch { return t; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return t;
    u.hash = '';
    if (u.search) return u.toString();
    if (u.hostname === '0.0.0.0') u.hostname = '127.0.0.1';
    else if (u.hostname === '[::]') u.hostname = '[::1]';
    let path = u.pathname.replace(/\/+$/, '');
    for (;;) {
        const lower = path.toLowerCase();
        const s = SUFFIXES.find((x) => lower.endsWith(x));
        if (!s) break;
        path = path.slice(0, path.length - s.length).replace(/\/+$/, '');
    }
    u.pathname = path || '/v1';
    return u.toString().replace(/\/+$/, '');
}

/** Which preset an address belongs to (by port on a loopback host), else 'custom'. */
export function presetOfUrl(url: string): GenPreset['id'] {
    try {
        const u = new URL(normalizeBase(url));
        const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
        const p = GEN_PRESETS.find((x) => x.port === port);
        return p ? p.id : 'custom';
    } catch { return 'custom'; }
}

export interface ModelInfo { id: string; kind: string; loaded: boolean | null }
export interface ProbeStep { step: string; ok: boolean; url: string; status: number | null; error: string | null; detail: string | null; optional: boolean; ms: number }
export interface Probe {
    ok: boolean; base: string; typed?: string | null; server: string; models: ModelInfo[]; suggested: string | null;
    steps: ProbeStep[]; error: string | null; detail: string | null; chatOk: boolean | null; latencyMs: number;
}

/** The step that decided the outcome: the first failed non-optional one. */
export function failedStep(p: Probe | null | undefined): ProbeStep | null {
    if (!p) return null;
    return (p.steps || []).find((s) => !s.ok && !s.optional) || null;
}

/** Models sorted for the picker: loaded first, writing models before embedding models. */
export function sortModels(models: ModelInfo[]): ModelInfo[] {
    const rank = (m: ModelInfo) => (m.kind === 'embedding' ? 2 : 0) + (m.loaded === true ? 0 : 1);
    return [...(models || [])].map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m);
}

/** The model to keep selected after a probe: the current one if the server has it, else the suggestion. */
export function pickModel(models: ModelInfo[], current: string, suggested: string | null): string {
    const cur = String(current || '').trim();
    if (cur && (models || []).some((m) => m.id === cur)) return cur;
    return suggested || cur;
}

/**
 * The words for a probe outcome, as i18n keys + variables (the UI translates them):
 * a headline and, when something failed, the hint that fits the step and the code.
 */
export function probeKeys(p: Probe): { tone: 'ok' | 'warn' | 'err'; head: string; hint: string | null; vars: Record<string, string> } {
    const f = failedStep(p);
    const vars: Record<string, string> = {
        n: String((p.models || []).length), base: p.base || '', ms: String(p.latencyMs ?? ''),
        detail: p.detail || f?.detail || '', status: String(f?.status ?? ''), url: f?.url || p.base || '',
    };
    if (p.ok) {
        const head = p.chatOk === true ? 'ai.gen.okChat' : 'ai.gen.okModels';
        return { tone: 'ok', head, hint: null, vars };
    }
    const code = p.error || f?.error || 'unknown';
    if (code.startsWith('ai.url.')) return { tone: 'err', head: 'ai.gen.badAddress', hint: code, vars };
    const map: Record<string, [string, string]> = {
        refused: ['ai.gen.errRefused', 'ai.gen.hintRefused'],
        timeout: ['ai.gen.errTimeout', 'ai.gen.hintTimeout'],
        unreachable: ['ai.gen.errUnreachable', 'ai.gen.hintRefused'],
        wrong_path: ['ai.gen.errWrongPath', 'ai.gen.hintWrongPath'],
        bad_response: ['ai.gen.errBadResponse', 'ai.gen.hintWrongPath'],
        no_models: ['ai.gen.errNoModels', 'ai.gen.hintNoModels'],
        model_error: ['ai.gen.errModel', 'ai.gen.hintModel'],
        http_401: ['ai.gen.errAuth', 'ai.gen.hintAuth'],
        http_403: ['ai.gen.errAuth', 'ai.gen.hintAuth'],
        http_404: ['ai.gen.errNotFound', 'ai.gen.hintWrongPath'],
    };
    const hit = map[code] || (code.startsWith('http_') ? ['ai.gen.errHttp', 'ai.gen.hintWrongPath'] as [string, string] : ['ai.gen.errUnknown', null as unknown as string]);
    return { tone: code === 'no_models' ? 'warn' : 'err', head: hit[0], hint: hit[1] || null, vars };
}

// ── Drafting ─────────────────────────────────────────────────────────────────

export type DraftPreset = 'describe_mod' | 'release_notes' | 'summarize_list' | 'translate' | 'shorten' | 'clarify' | 'free';
export const DRAFT_PRESETS: DraftPreset[] = ['describe_mod', 'release_notes', 'summarize_list', 'translate', 'shorten', 'clarify', 'free'];
/** What a preset works from: the text in the field, extra context, or a mod's own files. */
export const PRESET_INPUT: Record<DraftPreset, 'text' | 'context' | 'mod'> = {
    describe_mod: 'mod', release_notes: 'context', summarize_list: 'context', translate: 'text', shorten: 'text', clarify: 'text', free: 'text',
};
/** A rewrite of the field replaces it; new text from facts goes after what is there when the field is not empty. */
export function defaultMode(preset: DraftPreset, current: string): ApplyMode {
    if (!String(current || '').trim()) return 'replace';
    return PRESET_INPUT[preset] === 'text' ? 'replace' : 'append';
}

/** Same check as Rust `missing_input`: the i18n key of what is missing, or null. */
export function missingInput(preset: DraftPreset, text: string, context: string, hasMod: boolean, instructions = ''): string | null {
    const t = !!String(text || '').trim(), c = !!String(context || '').trim();
    switch (preset) {
        case 'describe_mod': return !hasMod && !t && !c ? 'ai.draft.noFacts' : null;
        case 'release_notes': case 'summarize_list': return !t && !c ? 'ai.draft.noContext' : null;
        case 'translate': case 'shorten': case 'clarify': return t ? null : 'ai.draft.noText';
        default: return t || c || String(instructions || '').trim() ? null : 'ai.draft.noText';
    }
}

export type ApplyMode = 'replace' | 'insert' | 'append';

/** The field after applying `draft`: replace all, insert at the selection, or append after a blank line. */
export function applyDraft(current: string, draft: string, mode: ApplyMode, selStart = -1, selEnd = -1): { value: string; caret: number } {
    const cur = String(current || '');
    const d = String(draft || '').trim();
    if (mode === 'replace' || !cur.trim()) return { value: d, caret: d.length };
    if (mode === 'append') {
        const base = cur.replace(/\s+$/, '');
        const value = `${base}\n\n${d}`;
        return { value, caret: value.length };
    }
    const s = selStart >= 0 && selStart <= cur.length ? selStart : cur.length;
    const e = selEnd >= s && selEnd <= cur.length ? selEnd : s;
    // Inserted inside a sentence: keep one space on each side, never glue words together.
    const before = cur.slice(0, s), after = cur.slice(e);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    const value = before + lead + d + trail + after;
    return { value, caret: before.length + lead.length + d.length };
}

/** Clip a value to a field's maxlength (0 or less = no limit). */
export function clipTo(value: string, maxLength: number): { value: string; clipped: boolean } {
    if (!(maxLength > 0) || value.length <= maxLength) return { value, clipped: false };
    return { value: value.slice(0, maxLength), clipped: true };
}

export interface DiffPart { op: 'eq' | 'add' | 'del'; text: string }

/** Word-level diff (LCS on words and spaces). Long texts fall back to « all removed, all added ». */
export function wordDiff(a: string, b: string): DiffPart[] {
    const A = String(a || '').match(/\s+|[^\s]+/g) || [];
    const B = String(b || '').match(/\s+|[^\s]+/g) || [];
    if (A.length * B.length > 4_000_000) {
        return [...(A.length ? [{ op: 'del' as const, text: A.join('') }] : []), ...(B.length ? [{ op: 'add' as const, text: B.join('') }] : [])];
    }
    const n = A.length, m = B.length;
    const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out: DiffPart[] = [];
    const push = (op: DiffPart['op'], text: string) => {
        const last = out[out.length - 1];
        if (last && last.op === op) last.text += text; else out.push({ op, text });
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
        else if (L[i + 1][j] >= L[i][j + 1]) { push('del', A[i]); i++; }
        else { push('add', B[j]); j++; }
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('add', B[j++]);
    return out;
}

/** Counts for the « Changes » tab label. */
export function diffStats(parts: DiffPart[]): { added: number; removed: number } {
    const words = (s: string) => (s.match(/[^\s]+/g) || []).length;
    let added = 0, removed = 0;
    for (const p of parts) { if (p.op === 'add') added += words(p.text); else if (p.op === 'del') removed += words(p.text); }
    return { added, removed };
}

/** A short list of the enabled mods for « Summarise a mod list »: « Name (version) », one per line. */
export function modListText(mods: Array<{ name?: string; version?: string; enabled?: boolean }>, max = 120): string {
    const on = (mods || []).filter((m) => m && m.enabled !== false && String(m.name || '').trim());
    const lines = on.slice(0, max).map((m) => `- ${String(m.name).trim()}${m.version ? ` (${String(m.version).trim()})` : ''}`);
    if (on.length > max) lines.push(`- … +${on.length - max}`);
    return lines.join('\n');
}
