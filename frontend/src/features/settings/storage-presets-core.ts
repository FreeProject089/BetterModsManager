// The Storage Manager's rule presets, the pure part: names, how a rule and a change read, and
// the drive line. No import, so a test reads it without the app (storage-presets.ts draws).
// The plans themselves are built in Rust (commands/storage_presets.rs) from the real drives.

/** t(key) → the translation, or the key itself when there is none. */
export type T = (key: string) => string;

export type PresetId = 'balanced' | 'quiet' | 'performance' | 'ssd_hdd' | 'space_watch' | 'external';

export interface IoRule { rate_mb_s?: number | null; parallel?: number | null; buffer_kib?: number | null; io_priority?: 'low' | 'normal' | null }
export interface Alert { enabled: boolean; warning_pct: number; critical_pct: number }
export interface RuleChange { disk: string; op: string; before: IoRule | null; after: IoRule | null }
export interface Changes { preset: [string, string] | null; alert: [Alert, Alert] | null; rules: RuleChange[] }
export interface Plan {
    id: PresetId; available: boolean; preset: string; alert: Alert;
    rules: Record<string, Record<string, IoRule>>;
    notes: [string, string][]; changes: Changes; fingerprint: string;
}
export interface Drive { key: string; label: string; kind: string; external: boolean; system: boolean; total_bytes: number; free_bytes: number; roles: string[] }
export interface Overview { profile: { drives: Drive[]; cores: number }; recommended: PresetId; reasons: string[]; plans: Plan[]; undo: PresetId | null }

const say = (t: T, key: string, en: string): string => { const v = t(key); return v && v !== key ? v : en; };

/** Each preset's name and one-line promise, in the order the picker shows them. */
export const PRESETS: { id: PresetId; name: [string, string]; desc: [string, string] }[] = [
    { id: 'balanced', name: ['stm.presets.balanced', 'Balanced'], desc: ['stm.presets.balancedDesc', 'The defaults, with space alerts sized for your drives.'] },
    { id: 'quiet', name: ['stm.presets.quiet', 'Quiet'], desc: ['stm.presets.quietDesc', 'BMM works slowly and in the background: for a small PC, or playing while it works.'] },
    { id: 'performance', name: ['stm.presets.performance', 'Performance / SSD'], desc: ['stm.presets.performanceDesc', 'Everything for BMM on fast drives. A hard disk keeps its backups behind the game.'] },
    { id: 'ssd_hdd', name: ['stm.presets.ssdHdd', 'Small SSD + big HDD'], desc: ['stm.presets.ssdHddDesc', 'Big steps on the SSD; on the hard disk, gentle backups and archives that wait their turn.'] },
    { id: 'space_watch', name: ['stm.presets.spaceWatch', 'Watch the space'], desc: ['stm.presets.spaceWatchDesc', 'Earlier warnings before a drive fills up, and no mod enabled on a full one.'] },
    { id: 'external', name: ['stm.presets.external', 'External drives'], desc: ['stm.presets.externalDesc', 'USB and removable drives get small steps, a low priority and one backup at a time.'] },
];

export function presetName(id: string, t: T): string {
    const p = PRESETS.find((x) => x.id === id);
    return p ? say(t, p.name[0], p.name[1]) : id;
}

/** The governor's intensity, as the Work intensity tab names it. */
export function intensityName(p: string, t: T): string {
    const m: Record<string, [string, string]> = {
        silent: ['stm.presets.int.silent', 'Silent'], balanced: ['stm.presets.int.balanced', 'Balanced'],
        max: ['stm.presets.int.max', 'Max'], custom: ['stm.presets.int.custom', 'Custom'],
    };
    return m[p] ? say(t, m[p][0], m[p][1]) : p;
}

/** A drive key as people write it: `d:\` → `D:`, `*` → All disks. */
export function diskName(key: string, t: T): string {
    if (key === '*') return say(t, 'res.allDisks', 'All disks');
    return /^[a-z]:\\$/i.test(key) ? key.slice(0, 2).toUpperCase() : key;
}

export function opName(op: string, t: T): string {
    return op === '*' ? say(t, 'stm.presets.allOps', 'all work') : say(t, 'res.k.' + op, op);
}

/** "512 KiB steps · 1 at once · low priority · cap 80 MB/s". */
export function ruleText(r: IoRule | null | undefined, t: T): string {
    if (!r) return say(t, 'stm.presets.none', 'nothing');
    const parts: string[] = [];
    if (r.buffer_kib != null) parts.push(say(t, 'stm.presets.r.buffer', '{n} KiB steps').replace('{n}', String(r.buffer_kib)));
    if (r.parallel != null) parts.push(say(t, 'stm.presets.r.parallel', '{n} at once').replace('{n}', String(r.parallel)));
    if (r.io_priority) parts.push(say(t, r.io_priority === 'low' ? 'stm.presets.r.low' : 'stm.presets.r.normal', r.io_priority === 'low' ? 'low priority' : 'normal priority'));
    if (r.rate_mb_s != null) parts.push(say(t, 'stm.presets.r.cap', 'cap {n} MB/s').replace('{n}', String(r.rate_mb_s)));
    return parts.length ? parts.join(' · ') : say(t, 'stm.presets.none', 'nothing');
}

export interface Line { kind: 'add' | 'remove' | 'change'; text: string }

/** Every change a plan makes, one readable line each, in the order: intensity, alerts, rules. */
export function changeLines(c: Changes, t: T): Line[] {
    const out: Line[] = [];
    if (c.preset) out.push({ kind: 'change', text: say(t, 'stm.presets.c.intensity', 'Work intensity: {a} → {b}').replace('{a}', intensityName(c.preset[0], t)).replace('{b}', intensityName(c.preset[1], t)) });
    if (c.alert) {
        const [a, b] = c.alert;
        const txt = (x: Alert) => x.enabled
            ? say(t, 'stm.presets.c.alertOn', 'on, warning at {w} % free, critical at {c} %').replace('{w}', String(x.warning_pct)).replace('{c}', String(x.critical_pct))
            : say(t, 'stm.presets.c.alertOff', 'off');
        out.push({ kind: 'change', text: say(t, 'stm.presets.c.alerts', 'Space alerts: {a} → {b}').replace('{a}', txt(a)).replace('{b}', txt(b)) });
    }
    for (const r of c.rules) {
        const where = `${diskName(r.disk, t)}, ${opName(r.op, t)}`;
        if (!r.before) out.push({ kind: 'add', text: say(t, 'stm.presets.c.add', '{w}: {r}').replace('{w}', where).replace('{r}', ruleText(r.after, t)) });
        else if (!r.after) out.push({ kind: 'remove', text: say(t, 'stm.presets.c.remove', '{w}: rule removed ({r})').replace('{w}', where).replace('{r}', ruleText(r.before, t)) });
        else out.push({ kind: 'change', text: say(t, 'stm.presets.c.change', '{w}: {a} → {b}').replace('{w}', where).replace('{a}', ruleText(r.before, t)).replace('{b}', ruleText(r.after, t)) });
    }
    return out;
}

/** One change as a diff row: what it touches, what it was, what it becomes. `before` is empty
 *  for an added rule, `after` for a removed one. The preview draws these as two columns. */
export interface Row { kind: 'add' | 'remove' | 'change'; where: string; before: string; after: string }

/** The same changes as changeLines, split for a diff list (intensity, alerts, then rules). */
export function changeRows(c: Changes, t: T): Row[] {
    const out: Row[] = [];
    if (c.preset) out.push({ kind: 'change', where: say(t, 'stm.presets.w.intensity', 'Work intensity'), before: intensityName(c.preset[0], t), after: intensityName(c.preset[1], t) });
    if (c.alert) {
        const txt = (x: Alert) => x.enabled
            ? say(t, 'stm.presets.c.alertOn', 'on, warning at {w} % free, critical at {c} %').replace('{w}', String(x.warning_pct)).replace('{c}', String(x.critical_pct))
            : say(t, 'stm.presets.c.alertOff', 'off');
        out.push({ kind: 'change', where: say(t, 'stm.presets.w.alerts', 'Space alerts'), before: txt(c.alert[0]), after: txt(c.alert[1]) });
    }
    for (const r of c.rules) {
        const where = `${diskName(r.disk, t)}, ${opName(r.op, t)}`;
        if (!r.before) out.push({ kind: 'add', where, before: '', after: ruleText(r.after, t) });
        else if (!r.after) out.push({ kind: 'remove', where, before: ruleText(r.before, t), after: '' });
        else out.push({ kind: 'change', where, before: ruleText(r.before, t), after: ruleText(r.after, t) });
    }
    return out;
}

export function driveKindName(kind: string, external: boolean, t: T): string {
    const m: Record<string, [string, string]> = {
        nvme: ['stm.presets.k.nvme', 'NVMe SSD'], ssd: ['stm.presets.k.ssd', 'SSD'], hdd: ['stm.presets.k.hdd', 'Hard disk'],
        network: ['stm.presets.k.network', 'Network'], cloud: ['stm.presets.k.cloud', 'Cloud'], unknown: ['stm.presets.k.unknown', 'Unknown type'],
    };
    const base = m[kind] ? say(t, m[kind][0], m[kind][1]) : kind;
    return external ? `${base} · ${say(t, 'stm.presets.k.external', 'external')}` : base;
}

export function roleNames(roles: string[], t: T): string {
    const m: Record<string, [string, string]> = { game: ['stm.presets.role.game', 'game'], mods: ['stm.presets.role.mods', 'mods'], backup: ['stm.presets.role.backup', 'backups'] };
    return roles.map((r) => (m[r] ? say(t, m[r][0], m[r][1]) : r)).join(', ');
}

/** Why the recommendation is what it is, from the Rust reason codes. */
export function reasonText(codes: string[], t: T): string {
    const m: Record<string, [string, string]> = {
        low_space: ['stm.presets.why.lowSpace', 'A drive your profiles use has less than 15 % free.'],
        ssd_and_hdd: ['stm.presets.why.ssdHdd', 'Your profiles use a hard disk, and this PC also has an SSD.'],
        external_used: ['stm.presets.why.external', 'A profile keeps files on an external drive.'],
        all_flash_many_cores: ['stm.presets.why.fast', 'Every drive your profiles use is an SSD, and the processor has 8 threads or more.'],
        few_cores: ['stm.presets.why.fewCores', 'The processor has 4 threads or fewer: BMM should leave room for the rest.'],
        default: ['stm.presets.why.default', 'Nothing on this PC calls for more than the defaults.'],
    };
    return codes.map((c) => (m[c] ? say(t, m[c][0], m[c][1]) : c)).join(' ');
}
