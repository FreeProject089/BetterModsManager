// shortcut-model.ts — what a shortcut can be bound to, with no DOM in it.
//
// A binding was a keyboard chord written « Ctrl+Shift+K ». It can now also be a mouse button, a
// turn of the wheel or gamepad buttons, from any device the webview sees. The written form is
// the same string with a device key in the last place:
//
//   Ctrl+K            keyboard (unchanged: every file written before keeps its meaning)
//   Ctrl+Mouse:3      mouse button 3 (back), with Ctrl held; 1 = middle, 4 = forward, 5+ = extra
//   Alt+Wheel:up      the wheel turned up (or down) with Alt held
//   Pad:0-4           gamepad buttons 0 and 4 held together (standard mapping), no modifier
//
// A keyboard key name never contains « : », so the two families cannot be confused, and an older
// BMM reading a newer file parses a device key as a key nobody can press: inert, never wrong.
// The shortcuts file says `version: 2` from now on; version 1 files import unchanged.
//
// Import-free, so it loads in node for the tests (tests/shortcut-model.test.mjs).

export type Device = 'key' | 'mouse' | 'wheel' | 'pad';

/** The version written in an exported shortcuts file. 1 = keyboard only, 2 = any device. */
export const SHORTCUTS_FILE_VERSION = 2;

export interface ChordLike { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string }

const MOUSE_RE = /^mouse:(\d{1,2})$/;
const WHEEL_RE = /^wheel:(up|down)$/;
const PAD_RE = /^pad:(\d{1,2})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/;

/** Which device a binding's key belongs to. */
export function deviceOf(key: string): Device {
    const k = String(key || '').toLowerCase();
    if (MOUSE_RE.test(k)) return 'mouse';
    if (WHEEL_RE.test(k)) return 'wheel';
    if (PAD_RE.test(k)) return 'pad';
    return 'key';
}

/** The left button clicks and the right one opens menus: neither can be a shortcut. */
export function mouseRecordable(button: number): boolean {
    return Number.isInteger(button) && (button === 1 || (button >= 3 && button <= 31));
}
export const mouseKey = (button: number): string => `mouse:${button}`;
export const wheelKey = (deltaY: number): string => (deltaY < 0 ? 'wheel:up' : 'wheel:down');

/** The most buttons a gamepad combination may hold. */
export const PAD_MAX = 3;
/** Gamepad buttons as a key: sorted, unique, at most PAD_MAX. Null when there are none. */
export function padKey(buttons: Iterable<number>): string | null {
    const list = [...new Set([...buttons].filter((b) => Number.isInteger(b) && b >= 0 && b < 64))].sort((a, b) => a - b);
    if (!list.length || list.length > PAD_MAX) return null;
    return 'pad:' + list.join('-');
}
export function padButtons(key: string): number[] {
    const m = PAD_RE.exec(String(key || '').toLowerCase());
    if (!m) return [];
    return [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
}
export function mouseButton(key: string): number {
    const m = MOUSE_RE.exec(String(key || '').toLowerCase());
    return m ? Number(m[1]) : -1;
}
export function wheelDir(key: string): 'up' | 'down' | null {
    const m = WHEEL_RE.exec(String(key || '').toLowerCase());
    return m ? (m[1] as 'up' | 'down') : null;
}

/** A device key that is well formed and bindable (a keyboard key returns true: not ours to judge). */
export function validDeviceKey(key: string): boolean {
    const k = String(key || '').toLowerCase();
    if (!k.includes(':')) return true;
    if (MOUSE_RE.test(k)) return mouseRecordable(mouseButton(k));
    if (WHEEL_RE.test(k)) return true;
    if (PAD_RE.test(k)) { const b = padButtons(k); return b.length > 0 && padKey(b) === k; }
    return false;
}

/**
 * Device chords BMM refuses, with the reason. The wheel alone scrolls, Ctrl+wheel zooms, Shift+wheel
 * scrolls sideways; the left and right buttons are clicking and menus. A gamepad combination
 * carries no keyboard modifier (a hand on the pad is not on Ctrl).
 */
export function deviceReserved(c: ChordLike | null): 'scroll' | 'zoom' | 'hscroll' | 'click' | 'mods' | null {
    if (!c) return null;
    const d = deviceOf(c.key);
    if (d === 'wheel') {
        const mods = [!!c.ctrl, !!c.shift, !!c.alt].filter(Boolean).length;
        if (!mods) return 'scroll';
        if (mods === 1 && c.ctrl) return 'zoom';
        if (mods === 1 && c.shift) return 'hscroll';
        return null;
    }
    if (d === 'mouse') return mouseRecordable(mouseButton(c.key)) ? null : 'click';
    if (d === 'pad') return c.ctrl || c.shift || c.alt ? 'mods' : null;
    return null;
}

/** Standard-mapping names of gamepad buttons (W3C Gamepad « standard » layout). */
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];
export function padLabel(key: string): string {
    return padButtons(key).map((b) => PAD_NAMES[b] || `#${b}`).join('+');
}

// ── Shortcuts files ─────────────────────────────────────────────────────────────────────────

/** A binding string a file may carry: short, and its last part a key or a valid device key. */
export function validBindingString(v: unknown): v is string {
    if (typeof v !== 'string' || v.length > 40) return false;
    if (v === '') return true;
    const key = (v.split('+').pop() || '').trim().toLowerCase();
    return !!key && validDeviceKey(key);
}
/** A command id a file may name. */
export const validCommandId = (id: string): boolean => /^[\w.-]{1,80}$/.test(id);

/** One entry of an imported file that has nothing to land on here. */
export interface MissingEntry {
    /** 'command' = a binding for a command this BMM does not have; else a custom shortcut's kind. */
    kind: string;
    /** The command id, or the custom shortcut's id. */
    id: string;
    /** What the file calls it: the custom shortcut's label, else the command id. */
    label: string;
    /** The binding string, '' when it has none. */
    keys: string;
}

/**
 * The entries of a parsed shortcuts file that would land on nothing: a binding whose command id
 * is unknown here (and is not one of the file's own custom shortcuts), a custom shortcut whose
 * target is gone. Nothing is dropped by this function; it only says what to ask about.
 */
export function missingEntries(
    data: { bindings?: Record<string, unknown>; custom?: Array<{ id: string; kind: string; target: string; label: string }> },
    knownCommand: (id: string) => boolean,
    targetExists: (kind: string, target: string) => boolean,
): MissingEntry[] {
    const out: MissingEntry[] = [];
    const bindings = data.bindings || {};
    const customIds = new Set((data.custom || []).map((c) => c.id));
    for (const cs of data.custom || []) {
        if (!targetExists(cs.kind, cs.target)) {
            const v = bindings[cs.id];
            out.push({ kind: cs.kind, id: cs.id, label: cs.label, keys: typeof v === 'string' ? v : '' });
        }
    }
    for (const [id, v] of Object.entries(bindings)) {
        if (customIds.has(id) || !validCommandId(id) || !validBindingString(v) || !v) continue;
        if (!knownCommand(id)) out.push({ kind: 'command', id, label: id, keys: v });
    }
    return out;
}
