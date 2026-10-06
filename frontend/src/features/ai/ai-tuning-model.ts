// ai-tuning-model.ts — « Réponses de Laya »: the settings model, without a window.
//
// The rules live in Rust (commands/ai_tuning.rs): it validates every save (unknown fields,
// bounds, label lengths, reserved tokens) and decides what a probability means. This file only
// edits a copy of the config for the Settings screen, mirrors the limits so a field can say
// « trop long » before Save, and reads an import the way Rust will. A config the page gets
// wrong is refused by Rust; it is never trusted because this file said it was fine.

export type Preset = 'prudent' | 'balanced' | 'permissive' | 'custom';
export type Area = 'mod_suggest' | 'ask' | 'triage' | 'library' | 'tasks' | 'api';
export type Abstain = 'unknown' | 'flag';
export type Source = 'text' | 'file' | 'report' | 'mod_name' | 'mod_description' | 'mod_readme' | 'mod_all';
export type Action = 'none' | 'tag' | 'category' | 'note';

export const AREAS: readonly Area[] = ['mod_suggest', 'ask', 'triage', 'library', 'tasks', 'api'];
export const PRESETS: readonly Preset[] = ['prudent', 'balanced', 'permissive', 'custom'];
export const SOURCES: readonly Source[] = ['mod_all', 'mod_name', 'mod_description', 'mod_readme', 'text', 'file', 'report'];
export const ACTIONS: readonly Action[] = ['none', 'tag', 'category', 'note'];
/** The report categories a hint may describe (ai_core::REPORT_CATEGORIES). */
export const REPORT_CATEGORIES: readonly string[] = ['crash', 'bug', 'performance', 'install', 'mod_conflict', 'ui', 'other'];

export interface Tuning {
    preset: Preset;
    threshold: number;
    top_k: number;
    show_probs: boolean;
    multi_label: boolean;
    abstain: Abstain;
    temperature: number;
    margin: number;
    max_labels: number;
    auto_apply: boolean;
}

export interface LabelDef { id: string; description: string; examples: string[] }

export interface CustomTask {
    id: string;
    name: string;
    enabled: boolean;
    source: Source;
    labels: LabelDef[];
    template: string;
    tuning: Tuning | null;
    action: Action;
}

export interface LayaConfig {
    version: number;
    global: Tuning;
    features: Partial<Record<Area, Tuning | null>>;
    labels: { mod_tags: LabelDef[]; triage: LabelDef[]; templates: { mod_tags: string; triage: string } };
    tasks: CustomTask[];
    allow_program_changes: boolean;
}

/** Mirrors ai_tuning.rs (the screen's own hints; Rust checks again). */
export const LIMITS = {
    version: 1, tasks: 32, labels: 32, labelId: 64, description: 300, examples: 5, example: 200,
    template: 300, taskName: 80, taskId: 40, hints: 64, bytes: 256 * 1024,
};

/** The numeric ranges of a Tuning (the sliders' min/max/step). */
export const RANGES = {
    threshold: { min: 0, max: 0.99, step: 0.01 },
    top_k: { min: 1, max: 30, step: 1 },
    temperature: { min: 0.25, max: 4, step: 0.05 },
    margin: { min: 0, max: 0.5, step: 0.01 },
    max_labels: { min: 1, max: 10, step: 1 },
} as const;

export function defaultTuning(): Tuning {
    return { preset: 'balanced', threshold: 0, top_k: 5, show_probs: true, multi_label: false, abstain: 'unknown', temperature: 1, margin: 0, max_labels: 1, auto_apply: false };
}

export function defaultConfig(): LayaConfig {
    return {
        version: LIMITS.version, global: defaultTuning(),
        features: { mod_suggest: null, ask: null, triage: null, library: null, tasks: null, api: null },
        labels: { mod_tags: [], triage: [], templates: { mod_tags: '', triage: '' } },
        tasks: [], allow_program_changes: false,
    };
}

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Every field present and in range (what Rust's `bounded` does), from anything. */
export function normTuning(t: any): Tuning {
    const d = defaultTuning();
    const x = t && typeof t === 'object' ? t : {};
    return {
        preset: PRESETS.includes(x.preset) ? x.preset : d.preset,
        threshold: clamp(x.threshold, 0, 0.99, d.threshold),
        top_k: Math.round(clamp(x.top_k, 1, 30, d.top_k)),
        show_probs: x.show_probs !== undefined ? !!x.show_probs : d.show_probs,
        multi_label: !!x.multi_label,
        abstain: x.abstain === 'flag' ? 'flag' : 'unknown',
        temperature: clamp(x.temperature, 0.25, 4, d.temperature),
        margin: clamp(x.margin, 0, 0.5, d.margin),
        max_labels: Math.round(clamp(x.max_labels, 1, 10, d.max_labels)),
        auto_apply: !!x.auto_apply,
    };
}

/** A config from Rust (or an import) with every field the screen reads. */
export function normConfig(c: any): LayaConfig {
    const d = defaultConfig();
    const x = c && typeof c === 'object' ? c : {};
    const label = (l: any): LabelDef => ({ id: String(l?.id ?? ''), description: String(l?.description ?? ''), examples: Array.isArray(l?.examples) ? l.examples.map(String) : [] });
    const features: LayaConfig['features'] = {};
    for (const a of AREAS) features[a] = x.features?.[a] ? normTuning(x.features[a]) : null;
    return {
        version: Number(x.version) || d.version,
        global: normTuning(x.global),
        features,
        labels: {
            mod_tags: Array.isArray(x.labels?.mod_tags) ? x.labels.mod_tags.map(label) : [],
            triage: Array.isArray(x.labels?.triage) ? x.labels.triage.map(label) : [],
            templates: { mod_tags: String(x.labels?.templates?.mod_tags ?? ''), triage: String(x.labels?.templates?.triage ?? '') },
        },
        tasks: Array.isArray(x.tasks) ? x.tasks.map((t: any): CustomTask => ({
            id: String(t?.id ?? ''), name: String(t?.name ?? ''), enabled: t?.enabled !== false,
            source: SOURCES.includes(t?.source) ? t.source : 'text',
            labels: Array.isArray(t?.labels) ? t.labels.map(label) : [],
            template: String(t?.template ?? ''), tuning: t?.tuning ? normTuning(t.tuning) : null,
            action: ACTIONS.includes(t?.action) ? t.action : 'none',
        })) : [],
        allow_program_changes: !!x.allow_program_changes,
    };
}

export type PresetTable = Partial<Record<Area, Partial<Record<Preset, Tuning>>>>;

/** The settings stored for an area: its override, else the global ones. */
export function storedFor(cfg: LayaConfig, area: Area | 'global'): Tuning {
    if (area === 'global') return cfg.global;
    return cfg.features[area] || cfg.global;
}

/** What applies to an area, with a preset expanded through Rust's table (`ai_laya_get.presets`). */
export function effective(cfg: LayaConfig, area: Area, presets: PresetTable): Tuning {
    const t = storedFor(cfg, area);
    if (t.preset === 'custom') return t;
    const row = presets[area]?.[t.preset];
    return row ? { ...normTuning(row), preset: t.preset, show_probs: t.show_probs, auto_apply: t.auto_apply } : t;
}

/**
 * Pick a preset. Going to « Personnalisé » starts from what applied until now (so the sliders
 * show today's numbers, not zeros); a named preset keeps the user's show/auto-apply choices.
 */
export function withPreset(t: Tuning, p: Preset, current?: Tuning): Tuning {
    if (p === 'custom') return { ...(current ? normTuning(current) : t), preset: 'custom', show_probs: t.show_probs, auto_apply: t.auto_apply };
    return { ...t, preset: p };
}

/** Override an area (a copy of what applies) or follow the global settings again. */
export function setOverride(cfg: LayaConfig, area: Area, on: boolean): LayaConfig {
    const features = { ...cfg.features, [area]: on ? { ...storedFor(cfg, area) } : null };
    return { ...cfg, features };
}

/** Examples typed one per line (or separated by « ; »): trimmed, bounded, at most 5. */
export function parseExamples(text: string): string[] {
    return String(text || '').split(/[\n;]/).map((s) => s.trim().slice(0, LIMITS.example)).filter(Boolean).slice(0, LIMITS.examples);
}

export function examplesText(ex: string[]): string {
    return (ex || []).join('; ');
}

/** A task id from its name: lower-case, [a-z0-9_-], unique among `taken`. */
export function slugId(name: string, taken: string[]): string {
    const base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.taskId - 3) || 'task';
    let id = base;
    for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
    return id;
}

export function newTask(name: string, taken: string[]): CustomTask {
    return {
        id: slugId(name, taken), name: name.slice(0, LIMITS.taskName), enabled: true, source: 'mod_all',
        labels: [{ id: '', description: '', examples: [] }, { id: '', description: '', examples: [] }],
        template: '', tuning: null, action: 'none',
    };
}

/** Rows the user left empty are not labels. */
export function usedLabels(labels: LabelDef[]): LabelDef[] {
    return (labels || []).filter((l) => String(l.id || '').trim());
}

/** The first problem of a task, as an i18n key (null = fine). The same rules as Rust's `check`. */
export function taskProblem(t: CustomTask, others: CustomTask[]): string | null {
    if (!/^[a-z0-9_-]{1,40}$/.test(t.id)) return 'laya.cfg.badTaskId';
    if (others.some((o) => o !== t && o.id === t.id)) return 'laya.cfg.dupTaskId';
    if (!t.name.trim() || t.name.length > LIMITS.taskName || t.template.length > LIMITS.template) return 'laya.cfg.tooLong';
    const used = usedLabels(t.labels);
    const ids = new Set<string>();
    for (const l of used) {
        const k = l.id.trim().toLowerCase();
        if (k === 'none' || ids.has(k)) return 'laya.cfg.dupLabel';
        ids.add(k);
        if (l.id.length > LIMITS.labelId || l.description.length > LIMITS.description || l.examples.length > LIMITS.examples || l.examples.some((e) => e.length > LIMITS.example)) return 'laya.cfg.tooLong';
    }
    if (used.length < 2 || used.length > LIMITS.labels) return 'laya.cfg.taskLabels';
    if (t.action !== 'none' && !t.source.startsWith('mod_')) return 'laya.cfg.actionNeedsMod';
    return null;
}

/** The config as saved: empty label rows dropped, empty hints dropped. */
export function forSave(cfg: LayaConfig): LayaConfig {
    const keepHint = (l: LabelDef) => l.id.trim() && (l.description.trim() || l.examples.length);
    return {
        ...cfg,
        version: LIMITS.version,
        labels: { ...cfg.labels, mod_tags: cfg.labels.mod_tags.filter(keepHint), triage: cfg.labels.triage.filter(keepHint) },
        tasks: cfg.tasks.map((t) => ({ ...t, labels: usedLabels(t.labels) })),
    };
}

/** The export file: what Rust's `export` writes, readable by `parseImport`. */
export function exportText(cfg: LayaConfig): string {
    return JSON.stringify({ kind: 'bmm-laya-config', version: LIMITS.version, config: forSave(cfg) }, null, 2);
}

/**
 * Read an import before sending it to Rust: size, JSON, the envelope, the version. Returns the
 * object Rust gets (Rust refuses unknown fields and bad values with its own key).
 */
export function parseImport(text: string): { ok: true; value: any } | { ok: false; error: string } {
    if (String(text).length > LIMITS.bytes) return { ok: false, error: 'laya.cfg.tooBig' };
    let v: any;
    try { v = JSON.parse(text); } catch { return { ok: false, error: 'laya.cfg.badJson' }; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'laya.cfg.badJson' };
    if ('kind' in v) {
        if (v.kind !== 'bmm-laya-config') return { ok: false, error: 'laya.cfg.badJson' };
        const ver = Number(v.version);
        if (!Number.isInteger(ver) || ver < 1 || ver > LIMITS.version) return { ok: false, error: 'laya.cfg.badVersion' };
        if (!v.config || typeof v.config !== 'object') return { ok: false, error: 'laya.cfg.badJson' };
    } else if (Number(v.version) > LIMITS.version) {
        return { ok: false, error: 'laya.cfg.badVersion' };
    }
    return { ok: true, value: v };
}

/** Percent bars: the best first, rounded, none for `show = false`. */
export function bars(rows: { id: string; p: number }[], show: boolean, k = 10): { id: string; pct: number }[] {
    if (!show) return [];
    return (rows || [])
        .filter((r) => Number.isFinite(Number(r.p)))
        .map((r) => ({ id: String(r.id), pct: Math.round(Math.min(1, Math.max(0, Number(r.p))) * 100) }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, Math.max(1, k));
}

/** « Équilibré · 2 réglages par fonction · 3 tâches » — the card's one-line status. */
export function summary(cfg: LayaConfig): { preset: Preset; overrides: number; tasks: number } {
    return { preset: cfg.global.preset, overrides: AREAS.filter((a) => !!cfg.features[a]).length, tasks: cfg.tasks.length };
}
