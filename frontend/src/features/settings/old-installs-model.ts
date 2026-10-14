// Old installations of BMM: the dialog's pure part (no DOM, no invoke), so a node test reads it
// without the app. old-installs.ts draws; commands::old_installs (Rust) finds and removes.
//
// The rules that matter here:
// - nothing starts ticked: a selection is only ever what the person clicked;
// - an item the scan says is not removable cannot be selected at all;
// - the selected items run in a fixed order: uninstallers first (they may remove shortcuts and
//   folders themselves), then shortcuts and caches (one confirmation for all of them), then the
//   old data folders, each with its own backup step and its own second confirmation.

/** t(key, vars) → the translation, or the key itself when there is none. */
export type T = (key: string, vars?: Record<string, string>) => string;

export type ItemKind = 'install' | 'data' | 'cache' | 'shortcut';
export type InstallerType = 'nsis' | 'msi' | 'betterinstaller' | 'unknown';

/** commands::old_installs::OldItem (camelCase on the wire). */
export interface OldItem {
    id: string;
    kind: ItemKind;
    label: string;
    version: string | null;
    installer: InstallerType | null;
    path: string | null;
    sizeBytes: number | null;
    removable: boolean;
    reason: string | null;
    warning: string | null;
    scope: 'user' | 'machine' | string;
    target: string | null;
    canSilent: boolean;
    currentLine: boolean;
    source: string | null;
}

export interface OldScan {
    items: OldItem[];
    migrated: boolean;
    runningExe: string;
    documentsDir: string | null;
}

export interface OfferAnswer { offer: boolean; neverAsk: boolean; offerIds: string[]; scan: OldScan }

const say = (t: T, key: string, en: string, vars?: Record<string, string>): string => {
    const v = t(key, vars);
    return v && v !== key ? v : en;
};

/** Whether the row's checkbox can be ticked. */
export function selectable(item: OldItem): boolean {
    return !!item.removable;
}

/** The ids the dialog opens with ticked: none, on purpose. */
export function initialSelection(_items: OldItem[]): Set<string> {
    return new Set();
}

/** Tick or untick one row; a row that is not selectable never enters the set. */
export function toggle(sel: Set<string>, item: OldItem, on: boolean): Set<string> {
    const next = new Set(sel);
    if (on && selectable(item)) next.add(item.id);
    else next.delete(item.id);
    return next;
}

/** Drop ids that are no longer in the scan or no longer removable (after a re-scan). */
export function pruneSelection(sel: Set<string>, items: OldItem[]): Set<string> {
    const ok = new Set(items.filter(selectable).map((i) => i.id));
    return new Set([...sel].filter((id) => ok.has(id)));
}

export interface RemovalPlan {
    installs: OldItem[];
    /** Shortcuts and caches: one confirmation for the lot. */
    quick: OldItem[];
    /** Old data folders: backup step + second confirmation each. */
    data: OldItem[];
}

/** The selected items, in the order they run. */
export function planRemoval(items: OldItem[], sel: Set<string>): RemovalPlan {
    const picked = items.filter((i) => sel.has(i.id) && selectable(i));
    return {
        installs: picked.filter((i) => i.kind === 'install'),
        quick: picked.filter((i) => i.kind === 'shortcut' || i.kind === 'cache'),
        data: picked.filter((i) => i.kind === 'data'),
    };
}

export function planSize(p: RemovalPlan): number {
    return p.installs.length + p.quick.length + p.data.length;
}

/** Sum of the known sizes; null when none is known. */
export function totalBytes(items: OldItem[]): number | null {
    const known = items.filter((i) => typeof i.sizeBytes === 'number');
    return known.length ? known.reduce((n, i) => n + (i.sizeBytes || 0), 0) : null;
}

export function fmtSize(n: number | null | undefined): string {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** The short kind label of a row. */
export function kindLabel(t: T, item: OldItem): string {
    switch (item.kind) {
        case 'install': return say(t, 'oldInstalls.kindInstall', 'Installed program');
        case 'data': return say(t, 'oldInstalls.kindData', 'Old data folder');
        case 'cache': return say(t, 'oldInstalls.kindCache', 'Old browser cache');
        default: return say(t, 'oldInstalls.kindShortcut', 'Shortcut');
    }
}

export function installerLabel(t: T, type: InstallerType | null): string {
    switch (type) {
        case 'nsis': return say(t, 'oldInstalls.installerNsis', 'NSIS setup');
        case 'msi': return say(t, 'oldInstalls.installerMsi', 'MSI package');
        case 'betterinstaller': return say(t, 'oldInstalls.installerBi', 'BetterInstaller');
        default: return say(t, 'oldInstalls.installerUnknown', 'Unknown installer');
    }
}

/** A Rust error is an i18n key, optionally followed by `|detail`. */
export function errorText(t: T, raw: unknown): string {
    const s = String((raw as { message?: string })?.message ?? raw ?? '');
    const bar = s.indexOf('|');
    const key = bar >= 0 ? s.slice(0, bar) : s;
    const detail = bar >= 0 ? s.slice(bar + 1) : '';
    const said = key.startsWith('oldInstalls.') ? t(key) : '';
    const head = said && said !== key ? said : (key || say(t, 'oldInstalls.errUnknown', 'Something went wrong.'));
    return detail ? `${head} (${detail})` : head;
}

/** One line for the summary after a run. */
export function summaryLine(t: T, done: number, failed: number, skipped: number): string {
    return say(t, 'oldInstalls.summary', `${done} removed, ${failed} failed, ${skipped} skipped.`, {
        done: String(done), failed: String(failed), skipped: String(skipped),
    });
}

/** The Settings card's one-line state. */
export function cardStatus(t: T, scan: OldScan | null): string {
    if (!scan) return say(t, 'oldInstalls.notScanned', 'Not scanned yet.');
    const n = scan.items.length;
    if (!n) return say(t, 'oldInstalls.nothing', 'Nothing left over from an older BMM.');
    const size = fmtSize(totalBytes(scan.items));
    return say(t, 'oldInstalls.found', `${n} item(s) found`, { n: String(n), size: size || '?' });
}
