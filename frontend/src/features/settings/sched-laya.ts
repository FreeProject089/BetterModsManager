/**
 * Laya's building blocks in a scheduled task — the part with no app in it.
 *
 * The runner (scheduler.ts) calls Rust (commands/ai_ops.rs) and writes the variables; this file
 * turns what Rust answered into the shapes a task keeps, and answers the conditions that read
 * them back. Pure, so every rule is a test (tests/sched-laya.test.mjs).
 *
 * Nothing here is AI free text. A tag is one of the user's OWN tags, a cause one of the fixed
 * crash causes, a report kind one of three words, a label one the task gave: each is checked
 * again here against its list, so a provider that answers with a word of its own leaves
 * `unknown` / `none` behind and nothing a later step could run. The one free-text step,
 * `ai.explain_crash`, is tainted by the runner (sched-ai.ts) and never read here.
 *
 * The stable variable names are listed in sched-vars.ts (`LAYA_VARS`).
 */

import type { RunCtx } from './sched-vars.js';

type Ctx = RunCtx;

/** A probability: a number in [0, 1], 0 for anything else. */
export function prob(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** `a op b` for the comparison conditions. An unknown operator is `>=`. */
export function compare(a: number, op: unknown, b: number): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    switch (String(op || '>=')) {
        case '>': return a > b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '==': case '=': return a === b;
        case '!=': return a !== b;
        default: return a >= b;
    }
}

/** The numeric value of a condition field, or the default. */
function num(v: unknown, dflt: number): number {
    const n = parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : dflt;
}

const low = (v: unknown) => String(v ?? '').trim().toLowerCase();

// ── The `onEvent` filter (« seulement si ») ───────────────────────────────────

export interface WhereRule { key: string; values: string[] }

/**
 * `family=disk|memory, abstained=false` → every key must match, one of its `|` values. A part
 * with no `=` or no key is dropped (not « match everything »: a typo must not widen nothing into
 * a rule that refuses everything either, so it is simply ignored and the rest still applies).
 */
export function parseWhere(raw: unknown): WhereRule[] {
    const out: WhereRule[] = [];
    for (const part of String(raw ?? '').split(/[,;\n]/)) {
        const i = part.indexOf('=');
        if (i <= 0) continue;
        const key = part.slice(0, i).trim().replace(/^event\./, '');
        const values = part.slice(i + 1).split('|').map((v) => low(v)).filter(Boolean);
        if (/^[A-Za-z_][\w.]*$/.test(key) && values.length) out.push({ key, values });
    }
    return out.slice(0, 8);
}

/** Does the event's data satisfy the filter? No filter = every event. Case-insensitive. */
export function eventMatches(raw: unknown, data: unknown): boolean {
    const rules = parseWhere(raw);
    if (!rules.length) return true;
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return rules.every((r) => {
        const v = d[r.key];
        if (v === undefined || v === null || typeof v === 'object') return false;
        return r.values.includes(low(v));
    });
}

// ── Scores of a sort (ai.classify / ai.run_task) ──────────────────────────────

/** The map a sort leaves its scores in: `ai.scores`, or `<into>.scores`. */
export function scoresName(into: unknown): string {
    const n = String(into ?? '').trim();
    return n ? `${n}.scores` : 'ai.scores';
}

/** Rust's ranking as label → probability, kept only for the labels the step allowed. */
export function scoresOf(ranked: unknown, allowed?: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    const ok = allowed ? new Set(allowed.map((x) => x.toLowerCase())) : null;
    for (const r of Array.isArray(ranked) ? ranked : []) {
        const id = String((r as any)?.label ?? (r as any)?.id ?? '').trim();
        if (!id || id.length > 64 || (ok && !ok.has(id.toLowerCase()) && id.toLowerCase() !== 'none')) continue;
        if (Object.prototype.hasOwnProperty.call(out, id)) continue;
        out[id] = String(prob((r as any)?.p));
        if (Object.keys(out).length >= 32) break;
    }
    return out;
}

/** `aiScore`: the score Laya gave label X (any label, not only the winner) compared to a number. */
export function aiScoreHolds(ctx: Ctx, p: Record<string, unknown>): boolean {
    const map = ctx.maps?.[scoresName(p.var)];
    const want = low(p.label);
    if (!map || !want) return false;
    const key = Object.keys(map).find((k) => k.toLowerCase() === want);
    const score = key === undefined ? 0 : prob(map[key]);
    return compare(score, p.op, Math.min(1, Math.max(0, num(p.value, 0.5))));
}

/**
 * `aiAbstained`: Laya answered « je ne sais pas » in the step that wrote `<var>.abstained`
 * (`ai` for a sort, `ai.mod` for a mod's tags, `ai.report` for a triage). Nothing written = no.
 */
export function aiAbstainedHolds(ctx: Ctx, p: Record<string, unknown>): boolean {
    const v = String(p.var ?? '').trim() || 'ai';
    return Number(ctx.nums[`${v}.abstained`]) === 1;
}

// ── A mod's tags (ai.classify_mod) ────────────────────────────────────────────

export interface ModTag { id: string; name: string; p: number; uncertain: boolean }
export interface ModClass { tags: ModTag[]; adult: boolean; adultP: number; applied: string[]; abstained: boolean; autoApply: boolean }

export function modClassOf(res: unknown): ModClass {
    const r = (res && typeof res === 'object' ? res : {}) as Record<string, any>;
    const tags: ModTag[] = (Array.isArray(r.tags) ? r.tags : [])
        .filter((t: any) => t && typeof t.id === 'string' && t.id && typeof t.name === 'string')
        .slice(0, 8)
        .map((t: any) => ({ id: String(t.id).slice(0, 80), name: String(t.name).slice(0, 80), p: prob(t.p), uncertain: !!t.uncertain }));
    const applied = (Array.isArray(r.applied) ? r.applied : []).map(String).filter((id: string) => tags.some((t) => t.id === id));
    return { tags, adult: r.adult === true, adultP: prob(r.adultP), applied, abstained: !tags.length, autoApply: r.autoApply === true };
}

/** The tag a mod would be filed under first: the most confident sure one, else `none`. */
export function topTag(c: ModClass): string {
    return c.tags.find((t) => !t.uncertain)?.name || 'none';
}

const _modTags = new WeakMap<object, Map<string, string[]>>();
const _lastMod = new WeakMap<object, string>();

/** Keep a mod's tags for `modAiTag` (ids and names, this run only). */
export function rememberModTags(ctx: Ctx, modId: string, c: ModClass): void {
    let m = _modTags.get(ctx);
    if (!m) { m = new Map(); _modTags.set(ctx, m); }
    m.set(modId, c.tags.filter((t) => !t.uncertain).flatMap((t) => [t.id.toLowerCase(), t.name.toLowerCase()]));
    _lastMod.set(ctx, modId);
}

/** `modAiTag`: Laya gave mod `id` (the last one classified when empty) the tag `tag` (id or name). */
export function modAiTagHolds(ctx: Ctx, p: Record<string, unknown>): boolean {
    const id = String(p.id ?? '').trim() || _lastMod.get(ctx) || '';
    const tag = low(p.tag);
    if (!id || !tag) return false;
    return (_modTags.get(ctx)?.get(id) || []).includes(tag);
}

// ── The library check (ai.library_check) ──────────────────────────────────────

export interface LibraryCounts { total: number; untagged: number; duplicates: number; conflicts: number; suggested: number; findings: number }
export interface LibraryView { counts: LibraryCounts; lines: string[]; untaggedIds: string[]; duplicateIds: string[] }

/** What a list row says, in one short line. Names are the mods' own (never Laya's words). */
export function libraryOf(res: unknown, words: { untagged: string; duplicate: string; conflict: string; suggest: string } = { untagged: 'untagged', duplicate: 'duplicate', conflict: 'conflict', suggest: 'suggested tags' }): LibraryView {
    const r = (res && typeof res === 'object' ? res : {}) as Record<string, any>;
    const arr = (v: unknown) => (Array.isArray(v) ? v : []) as any[];
    const name = (m: any) => String(m?.name || m?.id || '').replace(/\s+/g, ' ').slice(0, 80);
    const lines: string[] = [];
    for (const m of arr(r.duplicates)) lines.push(`${words.duplicate}: ${name(m?.a)} / ${name(m?.b)}`);
    for (const m of arr(r.conflicts)) lines.push(`${words.conflict}: ${name(m?.a)} / ${name(m?.b)}`);
    for (const m of arr(r.untagged)) lines.push(`${words.untagged}: ${name(m)}`);
    for (const m of arr(r.suggested)) lines.push(`${words.suggest}: ${name(m)} → ${arr(m?.tags).map((x) => String(x).slice(0, 40)).join(', ')}`);
    const counts = {
        total: Math.max(0, Number(r.total) || 0),
        untagged: arr(r.untagged).length,
        duplicates: arr(r.duplicates).length,
        conflicts: arr(r.conflicts).length,
        suggested: arr(r.suggested).length,
        findings: 0,
    };
    counts.findings = counts.untagged + counts.duplicates + counts.conflicts;
    return {
        counts,
        lines: lines.slice(0, 300),
        untaggedIds: arr(r.untagged).map((m) => String(m?.id || '')).filter(Boolean),
        duplicateIds: arr(r.duplicates).map((m) => String(m?.b?.id || '')).filter(Boolean),
    };
}

export const LIBRARY_KINDS = ['findings', 'untagged', 'duplicates', 'conflicts', 'suggested', 'total'] as const;

/** `aiLibraryCount`: one count of the last library check compared to a number (`>= 1` by default). */
export function libraryCountHolds(ctx: Ctx, p: Record<string, unknown>): boolean {
    const kind = (LIBRARY_KINDS as readonly string[]).includes(String(p.kind)) ? String(p.kind) : 'findings';
    const v = ctx.nums[`ai.lib.${kind}`];
    if (typeof v !== 'number') return false;
    return compare(v, p.op || '>=', num(p.value, 1));
}

// ── Crash labels (ai.crash_label) ─────────────────────────────────────────────

export interface CrashLabel { report: string; date: number; family: string; cause: string; p: number; abstained: boolean; uncertain: boolean; cached: boolean; reason: string; excerpt: string }

/** Rust's items, re-checked: a cause outside the fixed list is `unknown`, and its family too. */
export function crashItemsOf(res: unknown, causeFamily: Readonly<Record<string, string>>): CrashLabel[] {
    const r = (res && typeof res === 'object' ? res : {}) as Record<string, any>;
    return (Array.isArray(r.items) ? r.items : []).slice(0, 12).map((it: any) => {
        const cause = Object.prototype.hasOwnProperty.call(causeFamily, String(it?.cause)) ? String(it.cause) : 'unknown';
        const abstained = cause === 'unknown' || it?.abstained === true;
        return {
            report: String(it?.report || '').slice(0, 120),
            date: Number(it?.date) || 0,
            family: cause === 'unknown' ? 'unknown' : causeFamily[cause],
            cause,
            p: abstained ? 0 : prob(it?.p),
            abstained,
            uncertain: it?.uncertain === true,
            cached: it?.cached === true,
            reason: String(it?.reason || '').slice(0, 300),
            excerpt: String(it?.excerpt || '').slice(0, 600),
        };
    });
}

/** One line per crash for the list variable: `report: family/cause (82%)`. */
export function crashLines(items: readonly CrashLabel[]): string[] {
    return items.map((c) => `${c.report}: ${c.family}/${c.cause}${c.abstained ? '' : ` (${Math.round(c.p * 100)}%)`}${c.uncertain ? ' ?' : ''}`);
}

/** The counts and the latest crash (the newest of the run), for the fixed variables. */
export function crashSummary(items: readonly CrashLabel[]): { count: number; unknown: number; latest: CrashLabel | null } {
    const latest = items.length ? [...items].sort((a, b) => b.date - a.date)[0] : null;
    return { count: items.length, unknown: items.filter((c) => c.abstained).length, latest };
}

const _crashes = new WeakMap<object, CrashLabel[]>();

export function rememberCrashes(ctx: Ctx, items: readonly CrashLabel[]): void {
    _crashes.set(ctx, [...(_crashes.get(ctx) || []), ...items].slice(-48));
}

/**
 * `crashCause`: the family (or the cause) is X with p ≥ min — of the latest crash, or of any
 * crash labelled in this run. Without a crash step in the run, the latest is what the trigger
 * carried (`{event.family}`, `{event.cause}`, `{event.p}` of `bmm.ai.crashLabelled`).
 */
export function crashCauseHolds(ctx: Ctx, p: Record<string, unknown>): boolean {
    const field = p.field === 'cause' ? 'cause' : 'family';
    const want = low(p.value);
    if (!want) return false;
    const min = Math.min(1, Math.max(0, num(p.min, 0)));
    const ok = (val: unknown, pr: unknown, abst: boolean) => !abst && low(val) === want && prob(pr) >= min;
    const mine = _crashes.get(ctx) || [];
    if (p.scope === 'any') return mine.some((c) => ok(c[field], c.p, c.abstained));
    if (mine.length) {
        const latest = crashSummary(mine).latest!;
        return ok(latest[field], latest.p, latest.abstained);
    }
    if (ctx.text[`ai.crash.${field}`] !== undefined) return ok(ctx.text[`ai.crash.${field}`], ctx.nums['ai.crash.p'], ctx.text['ai.crash.cause'] === 'unknown');
    if (ctx.text[`event.${field}`] !== undefined) return ok(ctx.text[`event.${field}`], ctx.text['event.p'], ctx.text['event.abstained'] === 'true');
    return false;
}

/** Since when a task's `ai.crash_label` looks: its last run's newest report, else 7 days back. */
export const FIRST_LOOK_SECS = 7 * 24 * 3600;
export function crashSince(markers: Record<string, unknown>, taskId: string, nowSecs: number): number {
    const v = Number(markers?.[taskId]);
    return Number.isFinite(v) && v > 0 ? v : Math.max(0, Math.floor(nowSecs) - FIRST_LOOK_SECS);
}

// ── Report triage (ai.triage_report) ──────────────────────────────────────────

export interface TriageHalf { label: string; p: number; abstained: boolean; uncertain: boolean }

export function triageOf(res: unknown, kinds: readonly string[], areas: readonly string[]): { kind: TriageHalf; area: TriageHalf } {
    const r = (res && typeof res === 'object' ? res : {}) as Record<string, any>;
    const half = (h: any, allowed: readonly string[]): TriageHalf => {
        const label = allowed.includes(String(h?.label)) && h?.abstained !== true ? String(h.label) : 'none';
        return { label, p: label === 'none' ? 0 : prob(h?.p), abstained: label === 'none', uncertain: h?.uncertain === true };
    };
    return { kind: half(r.kind, kinds), area: half(r.area, areas) };
}

// ── Laya's state (ai.status / aiAvailable) ────────────────────────────────────

export interface LayaState { enabled: boolean; available: boolean; installed: boolean; loaded: boolean; writer: boolean; writerRemote: boolean; provider: string; game: boolean }

export function stateOf(res: unknown): LayaState {
    const r = (res && typeof res === 'object' ? res : {}) as Record<string, any>;
    const provider = ['embedded', 'local', 'other', 'none'].includes(String(r.provider)) ? String(r.provider) : 'none';
    return {
        enabled: r.enabled === true, available: r.available === true, installed: r.installed === true,
        loaded: r.loaded === true, writer: r.writer === true, writerRemote: r.writerRemote === true, provider, game: r.game === true,
    };
}

export const STATUS_WHATS = ['available', 'enabled', 'installed', 'loaded', 'writer'] as const;

/** `aiAvailable`: one fact of Laya's state (`available` by default). */
export function statusHolds(s: LayaState, what: unknown): boolean {
    const w = (STATUS_WHATS as readonly string[]).includes(String(what)) ? String(what) as typeof STATUS_WHATS[number] : 'available';
    return s[w] === true;
}
