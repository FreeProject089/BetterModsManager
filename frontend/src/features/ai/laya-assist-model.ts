// laya-assist-model.ts — the pure half of Laya in the feedback dialog and the crash manager.
//
// Import-free on purpose: tests/laya-assist.test.mjs loads the compiled file in node, so what
// is tested is exactly what runs. No DOM, no Tauri, no i18n.
//
// What is decided here, and only here:
//   · which Laya answers become PROPOSALS (an abstained answer is none; a kept guess is marked
//     uncertain) — nothing in this file changes a report, the dialog applies a proposal on the
//     user's click;
//   · « have I already reported this? » against the local report history;
//   · which of the PC's crash reports fits the description being written;
//   · how crash reports group (same failure, different run) and how a label filter reads.
// The model calls, the gate (master switch, kill switch) and the masking live in Rust
// (commands/ai_assist.rs, commands/ai_core.rs).

export const REPORT_KINDS = ['feedback', 'bug', 'crash'] as const;
export const APP_AREAS = ['mods', 'profiles', 'load_order', 'downloads', 'launch', 'settings', 'interface', 'performance', 'ai', 'other'] as const;
/** Crash cause families, then each cause with its family. Mirrors `ai_assist::CRASH_FAMILIES` /
 *  `CRASH_CAUSES` (tests/laya-assist.test.mjs reads the Rust file and compares). */
export const CRASH_FAMILIES = ['mod_files', 'game', 'disk', 'network', 'app_ui', 'app_backend', 'ai', 'updater', 'memory', 'unknown'] as const;
export const CAUSE_FAMILY: Readonly<Record<string, string>> = {
    mod_archive: 'mod_files', mod_conflict: 'mod_files', mod_deploy: 'mod_files',
    game_launch: 'game', game_files: 'game',
    disk_full: 'disk', permission: 'disk', file_missing: 'disk',
    network_offline: 'network', network_server: 'network',
    ui_script: 'app_ui', webview: 'app_ui',
    internal_error: 'app_backend', background_task: 'app_backend', data_corrupt: 'app_backend',
    ai_engine: 'ai',
    update_failed: 'updater',
    out_of_memory: 'memory',
    other: 'unknown',
};
export const CRASH_CAUSES = Object.keys(CAUSE_FAMILY);
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type ReportKind = typeof REPORT_KINDS[number];

/** One answer of `ai_tuning::decision_json` (the fields this file reads). */
export interface LayaDecision {
    label?: string;
    p?: number;
    labels?: Array<{ id: string; p: number }>;
    abstained?: boolean;
    uncertain?: boolean;
    showProbs?: boolean;
}

/** `ai_triage_report`'s `triage` object (category / severity / duplicate). */
export interface Triage {
    category?: string | null;
    category_p?: number | null;
    severity?: string | null;
    severity_p?: number | null;
    duplicate_of?: number | null;
    duplicate_p?: number | null;
    uncertain?: boolean;
    show_probs?: boolean;
}

export type ProposalField = 'kind' | 'category' | 'severity' | 'area' | 'tag' | 'duplicate' | 'attach';

export interface Proposal {
    /** Stable: `field:value`. A dismissed or accepted id is not proposed again. */
    id: string;
    field: ProposalField;
    value: string;
    /** 0..1, or null when the user hid the percentages (or there is none, e.g. a tag). */
    p: number | null;
    uncertain: boolean;
    /** Free detail for the row (a duplicate's title, a crash zip's name). Never HTML. */
    detail?: string;
}

/** What the user accepted, as sent in the report's `meta.laya`. */
export interface Accepted { category?: string; severity?: string; area?: string; tags: string[]; related?: string }

const clamp01 = (x: unknown): number => Math.max(0, Math.min(1, Number(x) || 0));

/** A triage category in the dialog's three kinds. */
export function kindFromCategory(category: string | null | undefined): ReportKind | null {
    if (!category) return null;
    if (category === 'crash') return 'crash';
    if (['bug', 'performance', 'install', 'mod_conflict', 'ui'].includes(category)) return 'bug';
    return null;
}

/** The accepted label of a decision, or null (abstained, nothing, or not in `allowed`). */
export function decided(d: LayaDecision | null | undefined, allowed: readonly string[]): { id: string; p: number; uncertain: boolean } | null {
    if (!d || d.abstained) return null;
    const top = Array.isArray(d.labels) && d.labels.length ? d.labels[0] : null;
    if (!top || !allowed.includes(String(top.id))) return null;
    return { id: String(top.id), p: clamp01(top.p), uncertain: !!d.uncertain };
}

/**
 * The proposals for a report being written, from what Laya answered. `current` is what the
 * dialog already holds: a proposal that would change nothing is not made.
 */
export function proposalsFrom(
    triage: Triage | null | undefined,
    assist: { kind?: LayaDecision | null; area?: LayaDecision | null } | null | undefined,
    current: { kind: string; accepted: Accepted },
    text = '',
): Proposal[] {
    const out: Proposal[] = [];
    const showT = triage?.show_probs !== false;
    const prob = (p: unknown, show: boolean) => (show && p != null && Number.isFinite(Number(p)) ? clamp01(p) : null);
    // Kind: Laya's own kind question first (it knows « suggestion »), else the triage category.
    const k = decided(assist?.kind, REPORT_KINDS);
    if (k && k.id !== current.kind) out.push({ id: `kind:${k.id}`, field: 'kind', value: k.id, p: prob(k.p, assist?.kind?.showProbs !== false), uncertain: k.uncertain });
    else if (!k && triage?.category) {
        const kc = kindFromCategory(triage.category);
        if (kc && kc !== current.kind) out.push({ id: `kind:${kc}`, field: 'kind', value: kc, p: prob(triage.category_p, showT), uncertain: !!triage.uncertain });
    }
    if (triage?.category && triage.category !== current.accepted.category) {
        out.push({ id: `category:${triage.category}`, field: 'category', value: String(triage.category), p: prob(triage.category_p, showT), uncertain: !!triage.uncertain });
    }
    if (triage?.severity && (SEVERITIES as readonly string[]).includes(triage.severity) && triage.severity !== current.accepted.severity) {
        out.push({ id: `severity:${triage.severity}`, field: 'severity', value: String(triage.severity), p: prob(triage.severity_p, showT), uncertain: false });
    }
    const a = decided(assist?.area, APP_AREAS);
    if (a && a.id !== current.accepted.area) out.push({ id: `area:${a.id}`, field: 'area', value: a.id, p: prob(a.p, assist?.area?.showProbs !== false), uncertain: a.uncertain });
    for (const tag of suggestTags(text, a?.id || current.accepted.area || '', triage?.category || current.accepted.category || '')) {
        if (!current.accepted.tags.includes(tag)) out.push({ id: `tag:${tag}`, field: 'tag', value: tag, p: null, uncertain: false });
    }
    return out;
}

/** Proposals not yet accepted or dismissed. */
export function pending(list: Proposal[], seen: ReadonlySet<string>): Proposal[] {
    const ids = new Set<string>();
    return list.filter((p) => !seen.has(p.id) && !ids.has(p.id) && (ids.add(p.id), true));
}

/** Accept one proposal into the labels sent with the report (kind and attach are applied by the dialog). */
export function accept(acc: Accepted, p: Proposal): Accepted {
    const next: Accepted = { ...acc, tags: [...acc.tags] };
    if (p.field === 'category') next.category = p.value;
    else if (p.field === 'severity') next.severity = p.value;
    else if (p.field === 'area') next.area = p.value;
    else if (p.field === 'tag' && !next.tags.includes(p.value) && next.tags.length < 8) next.tags.push(p.value);
    else if (p.field === 'duplicate') next.related = p.value;
    return next;
}

/** Remove one accepted label (its chip's ×). */
export function unaccept(acc: Accepted, field: ProposalField, value: string): Accepted {
    const next: Accepted = { ...acc, tags: acc.tags.filter((t) => !(field === 'tag' && t === value)) };
    if (field === 'category') delete next.category;
    if (field === 'severity') delete next.severity;
    if (field === 'area') delete next.area;
    if (field === 'duplicate') delete next.related;
    return next;
}

/** `meta.laya` for the report, or null when the user accepted nothing. */
export function metaOf(acc: Accepted): Accepted | null {
    const m: Accepted = { tags: acc.tags.slice(0, 8) };
    if (acc.category) m.category = acc.category;
    if (acc.severity) m.severity = acc.severity;
    if (acc.area) m.area = acc.area;
    if (acc.related) m.related = acc.related;
    return m.category || m.severity || m.area || m.related || m.tags.length ? m : null;
}

// ── Tags: a fixed vocabulary, matched on words (no model) ──────────────────

const TAG_WORDS: Array<[string, RegExp]> = [
    ['startup', /\b(startup|start up|launch(?:ing)? bmm|au d[ée]marrage|d[ée]marr)/i],
    ['update', /\b(update|updating|mise à jour|mettre à jour|upgrade)/i],
    ['download', /\b(download|t[ée]l[ée]charg)/i],
    ['install', /\b(install|installer|installation)/i],
    ['profile', /\b(profile|profil)/i],
    ['load-order', /\b(load order|ordre de chargement)/i],
    ['theme', /\b(theme|th[èe]me|dark mode|light mode|mode sombre|mode clair)/i],
    ['translation', /\b(translation|traduction|language|langue)/i],
    ['freeze', /\b(freez|froze|hang|fig[ée]|bloqu)/i],
    ['slow', /\b(slow|lent|lag)/i],
];

/** Up to three tags: the area and category Laya gave, then words found in the text. */
export function suggestTags(text: string, area: string, category: string): string[] {
    const out: string[] = [];
    const add = (t: string) => { if (t && t !== 'other' && !out.includes(t) && out.length < 3) out.push(t); };
    if (area) add(area.replace(/_/g, '-'));
    if (category && category !== 'crash' && category !== 'bug') add(category.replace(/_/g, '-'));
    const s = String(text || '').slice(0, 6000);
    for (const [tag, re] of TAG_WORDS) if (re.test(s)) add(tag);
    return out;
}

// ── « Already reported? » ───────────────────────────────────────────────────

const STOP = new Set(('the and for with this that when from have has was are not but you your into then ' +
    'les des une pour avec dans est pas que qui sur quand mais vous par sont ' +
    'bmm mod mods app').split(' '));

/** Distinct meaningful words (≥ 3 letters, no stop-words, accents folded), max 60. */
export function words(text: string): string[] {
    const w = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !STOP.has(x) && !/^\d+$/.test(x));
    return [...new Set(w)].slice(0, 60);
}

export function overlap(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0;
    const A = new Set(a), B = new Set(b);
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
}

export interface HistoryLike { id?: string; title?: string; date?: string; sig?: string[]; type?: string }

/**
 * Earlier reports (last `days`) that look like this one, best first, at most 3. The title
 * counts on its own too: two people rarely describe the same bug with the same words, but a
 * person reporting it twice often reuses their title. A report of the same type scores a
 * little higher.
 */
export function likelyDuplicates(title: string, desc: string, kind: string, history: HistoryLike[], now = Date.now(), days = 60, threshold = 0.4): Array<{ entry: HistoryLike; score: number }> {
    const mine = words(`${title} ${String(desc || '').slice(0, 600)}`);
    const mineT = words(title);
    if (mine.length < 2) return [];
    const cutoff = now - days * 86_400_000;
    const myType = kind === 'feedback' ? 'feedback' : 'bug';
    const out: Array<{ entry: HistoryLike; score: number }> = [];
    for (const e of Array.isArray(history) ? history : []) {
        if (!e || typeof e !== 'object') continue;
        const at = Date.parse(String(e.date || ''));
        if (!Number.isFinite(at) || at < cutoff) continue;
        const theirs = Array.isArray(e.sig) && e.sig.length ? e.sig.map(String) : words(String(e.title || ''));
        let score = Math.max(overlap(mine, theirs), overlap(mineT, words(String(e.title || ''))));
        if (e.type && e.type !== myType) score *= 0.8;
        if (score >= threshold) out.push({ entry: e, score: Math.min(1, score) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ── Crash reports ───────────────────────────────────────────────────────────

export interface CrashDigest { path: string; excerpt: string; reason: string; date?: number }

/**
 * A crash's identity across runs: its reason with the parts that change every time removed —
 * numbers, hex addresses, quoted values, paths, durations.
 */
export function crashSignature(reason: string, excerpt = ''): string[] {
    const src = String(reason || '').trim() || String(excerpt || '').split('\n').slice(0, 3).join(' ');
    const norm = src
        .replace(/0x[0-9a-f]+/gi, ' ')
        .replace(/(['"`]).*?\1/g, ' ')
        .replace(/[a-z]:\\[^\s]*/gi, ' ')
        .replace(/\/[^\s]*\//g, ' ')
        .replace(/\d+/g, ' ');
    return words(norm);
}

export interface CrashGroup { key: number; members: string[]; rep: string }

/**
 * Group crash reports that are the same failure. Greedy, in the given order (newest first):
 * each report joins the first group whose representative's signature overlaps enough, else
 * starts its own. Reports with no readable text stay alone.
 */
export function groupCrashes(items: CrashDigest[], threshold = 0.6): CrashGroup[] {
    const groups: Array<CrashGroup & { sig: string[] }> = [];
    for (const it of Array.isArray(items) ? items : []) {
        if (!it || !it.path) continue;
        const sig = crashSignature(it.reason, it.excerpt);
        const g = sig.length ? groups.find((x) => x.sig.length && overlap(x.sig, sig) >= threshold) : undefined;
        if (g) g.members.push(it.path);
        else groups.push({ key: groups.length + 1, members: [it.path], rep: it.path, sig });
    }
    return groups.map(({ key, members, rep }) => ({ key, members, rep }));
}

/** Signatures remembered as « groups already seen », at most. */
export const SEEN_GROUPS_MAX = 100;

/**
 * Which of these crashes start a group BMM has not seen before (the `bmm.ai.crashGroup` event):
 * a crash whose signature overlaps no remembered one enough. Returns the indices that are new
 * and the memory to keep (new signatures first, bounded). Two new crashes of the same failure in
 * one call are ONE new group: the second is matched against the first.
 */
export function newCrashGroups(seen: readonly string[][], items: ReadonlyArray<{ reason?: string; excerpt?: string }>, threshold = 0.6): { fresh: number[]; seen: string[][] } {
    const mem: string[][] = (Array.isArray(seen) ? seen : []).filter((s) => Array.isArray(s) && s.length).map((s) => s.map(String));
    const fresh: number[] = [];
    (Array.isArray(items) ? items : []).forEach((it, i) => {
        const sig = crashSignature(String(it?.reason || ''), String(it?.excerpt || ''));
        if (!sig.length) return;
        if (mem.some((m) => overlap(m, sig) >= threshold)) return;
        mem.unshift(sig);
        fresh.push(i);
    });
    return { fresh, seen: mem.slice(0, SEEN_GROUPS_MAX) };
}

/** Path → its group key. */
export function groupOf(groups: CrashGroup[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const g of groups) for (const p of g.members) m.set(p, g.key);
    return m;
}

/** Each member gets its representative's answer (one Laya call per group): its label, its evidence. */
export function spreadLabels<T>(groups: CrashGroup[], byRep: Map<string, T>): Map<string, T> {
    const out = new Map<string, T>();
    for (const g of groups) {
        const d = byRep.get(g.rep);
        if (d !== undefined) for (const p of g.members) out.set(p, d);
    }
    return out;
}

export interface CrashCause { id: string; family: string; p: number | null; uncertain: boolean }

/** The label a crash shows: its cause and family, `uncertain` kept, `unknown` when Laya abstained. */
export function causeOf(d: LayaDecision | null | undefined): CrashCause | null {
    if (!d) return null;
    const top = decided(d, CRASH_CAUSES);
    if (!top) return { id: 'unknown', family: 'unknown', p: null, uncertain: false };
    return { id: top.id, family: CAUSE_FAMILY[top.id] || 'unknown', p: d.showProbs === false ? null : top.p, uncertain: top.uncertain };
}

/** The evidence of a label as sent by Rust, bounded again and reduced to strings (shown as text). */
export interface Evidence { words: string[]; lines: string[] }
export function evidenceOf(raw: unknown): Evidence {
    const list = (v: unknown, n: number, len: number): string[] => (Array.isArray(v) ? v : [])
        .filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x: string) => x.trim().slice(0, len));
    const r = (raw && typeof raw === 'object' ? raw : {}) as { words?: unknown; lines?: unknown };
    return { words: list(r.words, 6, 60), lines: list(r.lines, 3, 200) };
}

const byCount = (counts: Map<string, number>) => [...counts].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));

/** The cause chips: each cause present (in `family`, when given), with its count, most frequent first. */
export function labelCounts(labels: Map<string, LayaDecision>, family = ''): Array<{ id: string; n: number }> {
    const counts = new Map<string, number>();
    for (const d of labels.values()) {
        const c = causeOf(d);
        if (c && (!family || c.family === family)) counts.set(c.id, (counts.get(c.id) || 0) + 1);
    }
    return byCount(counts);
}

/** The family chips: each family present, with its count, most frequent first. */
export function familyCounts(labels: Map<string, LayaDecision>): Array<{ id: string; n: number }> {
    const counts = new Map<string, number>();
    for (const d of labels.values()) {
        const c = causeOf(d);
        if (c) counts.set(c.family, (counts.get(c.family) || 0) + 1);
    }
    return byCount(counts);
}

/** The family a filter is in: `family:x` → x, `cause:y` → y's family, else ''. */
export function filterFamily(filter: string): string {
    if (filter.startsWith('family:')) return filter.slice(7);
    if (filter.startsWith('cause:')) { const id = filter.slice(6); return id === 'unknown' ? 'unknown' : (CAUSE_FAMILY[id] || ''); }
    return '';
}

/** Does a row pass the filter? `filter` = '' (all), `family:<id>`, `cause:<id>` or `group:<key>`. */
export function passes(path: string, filter: string, labels: Map<string, LayaDecision>, groups: Map<string, number>): boolean {
    if (!filter) return true;
    if (filter.startsWith('group:')) return String(groups.get(path) ?? '') === filter.slice(6);
    const c = causeOf(labels.get(path));
    if (!c) return false;
    if (filter.startsWith('family:')) return c.family === filter.slice(7);
    if (filter.startsWith('cause:')) return c.id === filter.slice(6);
    return false;
}

/**
 * The crash report that fits the description best, for « attach this one? ». `zips` newest
 * first. Text similarity first; recency breaks ties. Null when nothing fits or the best one is
 * already attached.
 */
export function bestCrashFor(desc: string, zips: CrashDigest[], attached: string[], minScore = 0.08): { path: string; score: number } | null {
    const mine = words(desc);
    if (mine.length < 2 || !zips.length) return null;
    let best: { path: string; score: number } | null = null;
    zips.forEach((z, i) => {
        const sim = overlap(mine, words(`${z.reason} ${z.excerpt}`));
        const score = sim + 0.02 * Math.max(0, 5 - i);
        if (sim >= minScore && (!best || score > best.score)) best = { path: z.path, score };
    });
    const b = best as { path: string; score: number } | null;
    return b && !attached.includes(b.path) ? b : null;
}

/** Should the dialog ask Laya while the user types? Only when nothing leaves this PC. */
export function autoAssist(s: { enabled?: boolean; classifier?: string; local_allow_remote?: boolean; report_triage?: boolean } | null | undefined): boolean {
    if (!s || !s.enabled || s.report_triage === false) return false;
    if (s.classifier === 'embedded') return true;
    return s.classifier === 'local' && !s.local_allow_remote;
}
