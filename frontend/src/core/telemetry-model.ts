// telemetry-model.ts — the pure half of telemetry consent and of the Laya usage statistics.
//
// No DOM, no Tauri, no i18n: tests/telemetry-model.test.mjs loads the compiled file, so what is
// tested is exactly what runs.
//
// Two things live here:
//   · the CATEGORIES a user can say yes or no to, and which event belongs to which one;
//   · the shaping of a Laya call into a content-free event. The rule for that half: a value
//     leaves this file only as a number, a boolean or a short enum string. A question, a mod
//     name, a file name or an error message never does; an error is reduced to its code.

export type TelemetryCategory = 'usage' | 'perf' | 'errors' | 'laya' | 'replay';

/** In display order. "Tout activer" turns every one of these on. */
export const TELEMETRY_CATEGORIES: readonly TelemetryCategory[] = ['usage', 'perf', 'errors', 'laya', 'replay'];

export type CategoryChoice = Record<TelemetryCategory, boolean>;

export function allOn(): CategoryChoice {
    return { usage: true, perf: true, errors: true, laya: true, replay: true };
}

/** At least one category on: that is what "telemetry on" means. */
export function anyOn(c: Partial<CategoryChoice>): boolean {
    return TELEMETRY_CATEGORIES.some((k) => c[k] === true);
}

/** The category an event belongs to. `$replay` is gated by its own switch before it gets here. */
export function categoryOf(event: string): TelemetryCategory {
    if (event === 'perf' || event === 'webvitals' || event === 'benchmark') return 'perf';
    if (event === '$log_js' || event === '$log_rust' || event === 'error') return 'errors';
    if (event.startsWith('laya_')) return 'laya';
    if (event === '$replay') return 'replay';
    return 'usage';
}

/** The stored choice for the categories kept in the webview (usage, perf, laya). Missing or
 *  unreadable = on: the categories only ever act once telemetry itself was accepted. */
export function parseStoredCategories(raw: string | null): { usage: boolean; perf: boolean; laya: boolean } {
    let o: any = null;
    try { o = raw ? JSON.parse(raw) : null; } catch { o = null; }
    const v = (k: string) => !(o && typeof o === 'object' && o[k] === false);
    return { usage: v('usage'), perf: v('perf'), laya: v('laya') };
}

// ── Laya usage statistics ───────────────────────────────────────────────────────────────

export const LATENCY_BUCKETS = ['<250', '250-1000', '1-3s', '3-10s', '>10s'] as const;

export function latencyBucket(ms: number): string {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 250) return '<250';
    if (n < 1000) return '250-1000';
    if (n < 3000) return '1-3s';
    if (n < 10000) return '3-10s';
    return '>10s';
}

/** An error reduced to its code: `embedded:runtime:C:\\Users\\…` → `embedded:runtime`,
 *  `timeout` → `timeout`, a sentence → `other`. Never any of the text. */
export function errorCode(err: unknown): string {
    const raw = String((err as any)?.message ?? err ?? '').trim().toLowerCase();
    const m = /^([a-z][a-z_]{1,24})(?::([a-z][a-z_]{1,24}))?(?=$|[:\s])/.exec(raw);
    if (!m) return 'other';
    // A lone word only counts when it is a known reason, or "Error" would become a code.
    if (!m[2] && !KNOWN_REASONS.has(m[1])) return 'other';
    return m[2] ? `${m[1]}:${m[2]}` : m[1];
}
const KNOWN_REASONS = new Set(['timeout', 'cancelled', 'busy', 'killed', 'ai_off', 'no_provider', 'no_consent', 'no_model',
    'feature_off', 'rate_limited', 'unreachable', 'unavailable', 'bad_response', 'bad_json', 'insufficient', 'disabled', 'not_signed_in']);

/** The provider in the dashboard's words, from BMM's AI settings. */
export function providerOf(classifier: string | null | undefined, generative = false): string {
    if (generative) return 'external';
    switch (classifier) {
        case 'embedded': return 'embedded';
        case 'bettercommunity': return 'server';
        case 'local': return 'local';
        case 'off': case '': case null: case undefined: return 'rules';
        default: return 'other';
    }
}

const FIELD_RE = /^[a-z_]{1,20}$/;
const cleanField = (f: unknown): string => { const s = String(f ?? '').toLowerCase(); return FIELD_RE.test(s) ? s : 'other'; };
/** Sources that are Laya (or another model), as opposed to what BMM read from the files. */
const AI_SOURCES = new Set(['laya', 'embedded', 'bettercommunity', 'api', 'local']);

export interface LayaEvent { event: string; props: Record<string, unknown> }

export interface ObserverState {
    classifier: string;
    /** mod id → the fields suggested for it and their source, until applied or replaced. */
    pending: Map<string, Array<{ field: string; source: string }>>;
}

export function newObserverState(): ObserverState { return { classifier: '', pending: new Map() }; }

function use(feature: string, provider: string, ok: boolean, ms: number, extra: Record<string, unknown> = {}): LayaEvent {
    return { event: 'laya_use', props: { feature, provider, ok, latency_ms: Math.round((Number(ms) || 0) / 10) * 10, latency_bucket: latencyBucket(ms), ...extra } };
}

/**
 * One finished `ai_*` command → the events it is worth (often none). Pure: the caller keeps
 * `st` between calls. Nothing from `args` or `result` is copied except counts, booleans,
 * field names and codes.
 */
export function eventsForCommand(st: ObserverState, command: string, args: Record<string, unknown>, ok: boolean, result: unknown, ms: number): LayaEvent[] {
    const r: any = result;
    switch (command) {
        case 'ai_get_settings':
        case 'ai_save_settings': {
            if (ok && r && r.settings) st.classifier = String(r.settings.enabled === false ? 'off' : (r.settings.classifier || ''));
            return [];
        }
        case 'ai_suggest_mod_metadata': {
            const draft = args.draft === true;
            const provider = providerOf(st.classifier, draft);
            const feature = draft ? 'draft' : 'mod_suggest';
            if (!ok) return [use(feature, provider, false, ms, { error: errorCode(result) })];
            const list: any[] = Array.isArray(r?.suggestions) ? r.suggestions : [];
            const offered = list.filter((s) => s && s.applicable !== false).map((s) => ({ field: cleanField(s.field), source: cleanField(s.source) }));
            const fromAi = offered.filter((s) => AI_SOURCES.has(s.source));
            const modId = String(args.modId ?? '');
            if (modId) st.pending.set(modId, offered);
            const notes: string[] = Array.isArray(r?.notes) ? r.notes.map(String) : [];
            const extra: Record<string, unknown> = {
                suggested_fields: [...new Set(offered.map((s) => s.field))].slice(0, 12),
                suggested: offered.length,
                abstained: args.useProviders !== false && fromAi.length === 0,
            };
            if (!fromAi.length && notes.length) extra.error = errorCode(notes[0]);
            return [use(feature, provider, true, ms, extra)];
        }
        case 'ai_apply_mod_metadata': {
            const modId = String(args.modId ?? '');
            const offered = st.pending.get(modId);
            if (!ok || !offered) return [];
            st.pending.delete(modId);
            const fields = args.fields && typeof args.fields === 'object' ? Object.keys(args.fields as object).map(cleanField) : [];
            const provider = providerOf(st.classifier);
            const seen = new Set<string>();
            const out: LayaEvent[] = [];
            for (const s of offered) {
                if (seen.has(s.field)) continue;
                seen.add(s.field);
                out.push({ event: 'laya_feedback', props: { feature: 'mod_suggest', field: s.field, outcome: fields.includes(s.field) ? 'accepted' : 'rejected', source: s.source, provider } });
            }
            return out;
        }
        case 'ai_ask': {
            const req: any = args.request || {};
            const feature = req.scope === 'mods' ? 'smart_search' : 'ask';
            if (!ok) return [use(feature, providerOf(st.classifier), false, ms, { error: errorCode(result) })];
            const a: any = r?.answer || {};
            const hits = Array.isArray(a.hits) ? a.hits.length : 0;
            const extra: Record<string, unknown> = {
                hits: Math.min(hits, 50),
                low_confidence: a.low_confidence === true,
                abstained: a.low_confidence === true || hits === 0,
            };
            if (r?.layaOff) extra.error = errorCode(r.layaOff);
            return [use(feature, a.laya ? providerOf(st.classifier) : 'rules', true, ms, extra)];
        }
        case 'ai_triage_report':
        case 'ai_report_precheck': {
            const feature = command === 'ai_triage_report' ? 'report_triage' : 'report_precheck';
            const provider = command === 'ai_triage_report' ? providerOf(st.classifier) : 'rules';
            return [use(feature, provider, ok, ms, ok ? {} : { error: errorCode(result) })];
        }
        case 'ai_test_connection': {
            // `target` is the provider under test: 'local' | 'bettercommunity' | 'external'.
            const target = String(args.target ?? '');
            return [use('test', target === 'external' ? 'external' : providerOf(target || st.classifier), ok, ms, ok ? {} : { error: errorCode(result) })];
        }
        case 'ai_embedded_install':
        case 'ai_embedded_remove':
        case 'ai_embedded_cancel':
        case 'ai_embedded_test': {
            const action = command === 'ai_embedded_install' ? 'install' : command === 'ai_embedded_remove' ? 'uninstall' : command === 'ai_embedded_cancel' ? 'cancel' : 'test';
            return [{ event: 'laya_model', props: ok ? { action, ok } : { action, ok, error: errorCode(result) } }];
        }
        default:
            return [];
    }
}

/** What an Ask result points at, as a kind — never its id or its title. */
export function askClickKind(a: any): string {
    if (!a || typeof a !== 'object') return 'other';
    if (a.page || a.article) return 'doc';
    if (a.command) return 'command';
    if (a.mod) return 'mod';
    if (a.profile) return 'profile';
    if (a.setting != null) return 'setting';
    return 'other';
}
