// The navigation steps, on screen.
//
// sched-nav-model.ts says WHAT a task may navigate to and click; this does it. Every step goes
// through `runNav`, which the scheduler's runner, the dry run's preview and the task builder's
// preview all call — one implementation, so a preview cannot show a route the real run would
// not take.
//
// Two rules hold for every step, whoever calls it:
//
//   · `preview: true` never acts. Pages, tabs, cards and items still open — that IS the
//     preview, and moving the view changes nothing — but a dialog is announced instead of
//     opened and a click is a highlight with « would click » under it.
//   · acting needs `canAct` (the task's `navigate` permission, checked by the runner before it
//     calls in) AND an allow-listed control AND an element that passes `sensitiveReason` at
//     the moment of the click.
//
// What is painted (the ring around a target, its caption, a message card) lives in one fixed
// layer inside the app frame, with pointer-events off except on the card's own buttons, so a
// highlight never swallows the click it is pointing at.

import { t } from '../../core/i18n.js';
import { resolveTargets } from '../../ui/tutorial-target.js';
import { isShown, reveal } from '../../ui/tutorial-reveal.js';
import {
    ITEM_CARD, ITEM_PAGE, MODAL_GLOBALS, NAV_ITEM_KINDS, controlById, itemSelectors, modalById, pageById,
    selectorProblem, sensitiveReason, validPageId, validTabPath, type NavItemKind,
} from './sched-nav-model.js';

export interface NavRunOpts {
    /** Show where it would go; never open a dialog or click. */
    preview: boolean;
    /** The task holds the `navigate` permission (the runner decides; this only obeys). */
    canAct: boolean;
    /** Polled between waits: a stopped run stops here too. */
    cancelled?: () => boolean;
}

export interface NavResult {
    /** False when the target was not found and the step was told to carry on. */
    ok: boolean;
    /** One translated line for the run log and the dry run. */
    note: string;
}

/** A registry label (sched-nav-model.ts keys), or the id when this build has no word for it. */
const tx = (key: string, fallback: string): string => {
    const v = key ? t(key) : '';
    return v && v !== key ? v : fallback;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait until `probe` returns something, polling; null on timeout or cancel. */
async function until<T>(probe: () => T | null | undefined, ms: number, cancelled?: () => boolean): Promise<T | null> {
    const end = Date.now() + ms;
    for (;;) {
        const v = probe();
        if (v) return v;
        if (Date.now() >= end || cancelled?.()) return null;
        await sleep(120);
    }
}

// ── The paint layer ──────────────────────────────────────────────────────────────────────────

let _layer: HTMLElement | null = null;
let _rings: { el: HTMLElement; ring: HTMLElement; cap: HTMLElement | null }[] = [];
let _raf = 0;

function frame(): HTMLElement {
    return document.getElementById('app-window-outer') || document.body;
}

/** The stylesheet, linked the first time a step paints. */
export function ensureNavCss(): void {
    if (document.getElementById('sched-nav-css')) return;
    const link = document.createElement('link');
    link.id = 'sched-nav-css';
    link.rel = 'stylesheet';
    link.href = 'css/sched-nav.css';
    document.head.appendChild(link);
}

function layer(): HTMLElement {
    ensureNavCss();
    if (_layer && _layer.isConnected) return _layer;
    _layer = document.createElement('div');
    _layer.id = 'snav-layer';
    _layer.className = 'snav-layer';
    _layer.setAttribute('aria-live', 'polite');
    frame().appendChild(_layer);
    return _layer;
}

/** Keep every ring on its element while the page scrolls or reflows. */
function track(): void {
    cancelAnimationFrame(_raf);
    const host = layer().getBoundingClientRect();
    _rings = _rings.filter((r) => r.ring.isConnected);
    for (const r of _rings) {
        const b = r.el.getBoundingClientRect();
        const gone = !r.el.isConnected || b.width <= 0 || b.height <= 0;
        r.ring.hidden = gone;
        if (r.cap) r.cap.hidden = gone;
        if (gone) continue;
        const pad = 4;
        Object.assign(r.ring.style, {
            left: `${b.left - host.left - pad}px`, top: `${b.top - host.top - pad}px`,
            width: `${b.width + pad * 2}px`, height: `${b.height + pad * 2}px`,
        });
        if (r.cap) {
            const below = b.bottom + 64 < host.bottom;
            const left = Math.max(8, Math.min(b.left - host.left, host.width - 300));
            r.cap.style.left = `${left}px`;
            r.cap.style.top = below ? `${b.bottom - host.top + 10}px` : `${Math.max(8, b.top - host.top - 46)}px`;
        }
    }
    if (_rings.length) _raf = requestAnimationFrame(track);
}

/** Draw a ring around `el`, with an optional caption. Returns its remover. */
export function paintRing(el: HTMLElement, caption = '', tone: 'go' | 'would' | 'msg' = 'go'): () => void {
    const host = layer();
    const ring = document.createElement('div');
    ring.className = `snav-ring snav-ring--${tone}`;
    host.appendChild(ring);
    let cap: HTMLElement | null = null;
    if (caption) {
        cap = document.createElement('div');
        cap.className = `snav-cap snav-cap--${tone}`;
        cap.textContent = caption;
        host.appendChild(cap);
    }
    const entry = { el, ring, cap };
    _rings.push(entry);
    track();
    return () => {
        ring.remove();
        cap?.remove();
        _rings = _rings.filter((r) => r !== entry);
    };
}

/** A line at the bottom of the app frame, for a step with nothing to point at. */
function paintNote(text: string, tone: 'go' | 'would' = 'would'): () => void {
    const el = document.createElement('div');
    el.className = `snav-note snav-note--${tone}`;
    el.textContent = text;
    layer().appendChild(el);
    return () => el.remove();
}

/** Remove everything a step painted (a stopped run, a closed preview). */
export function clearNavPaint(): void {
    cancelAnimationFrame(_raf);
    _rings = [];
    if (_layer) _layer.replaceChildren();
}

// ── Finding things ───────────────────────────────────────────────────────────────────────────

/** The first element `sel` names that is on screen, else the first at all. */
function firstTarget(sel: string): HTMLElement | null {
    const all = resolveTargets(sel).filter((e): e is HTMLElement => e instanceof HTMLElement);
    return all.find((e) => isShown(e)) || all[0] || null;
}

function viewActive(page: string): boolean {
    return !!document.getElementById(`view-${page}`)?.classList.contains('active');
}

/** The tab button for one segment of a tab path, inside the page's view. */
function tabButton(page: string, seg: string): HTMLElement | null {
    const view = document.getElementById(`view-${page}`);
    if (!view) return null;
    const q = CSS.escape(seg);
    const sels = [
        `[role="tab"][data-tab="${q}"]`, `[data-repo-tab="${q}"]`, `[data-api-sec="${q}"]`,
        `#${CSS.escape(`${page}-tab-${seg}`)}`, `[data-tab="${q}"]`,
    ];
    for (const s of sels) {
        const hit = Array.from(view.querySelectorAll<HTMLElement>(s)).find((b) => isShown(b));
        if (hit) return hit;
    }
    return null;
}

const isSelected = (b: HTMLElement): boolean =>
    b.getAttribute('aria-selected') === 'true' || b.classList.contains('active') || b.classList.contains('is-active');

/** Open a page, then each segment of its tab path. Navigation only: allowed in a preview. */
export async function openPage(page: string, tab = '', o?: NavRunOpts): Promise<void> {
    if (!validPageId(page)) throw new Error(t('snav.err.badPage', { p: page }));
    if (!viewActive(page)) {
        const item = document.querySelector<HTMLElement>(`.nav-item[data-view="${CSS.escape(page)}"]`)
            || document.querySelector<HTMLElement>(`[data-view="${CSS.escape(page)}"]`);
        if (!item) throw new Error(t('snav.err.noPage', { p: page }));
        item.click();
        if (!(await until(() => viewActive(page), 3000, o?.cancelled))) {
            throw new Error(t('snav.err.noPage', { p: page }));
        }
    }
    if (!tab) return;
    if (!validTabPath(tab)) throw new Error(t('snav.err.badTab', { t: tab }));
    for (const seg of tab.split('/')) {
        // Tabs are often drawn a beat after the view (Plugins renders on its first visit).
        const btn = await until(() => tabButton(page, seg), 3000, o?.cancelled);
        if (!btn) throw new Error(t('snav.err.noTab', { t: seg, p: page }));
        if (!isSelected(btn)) btn.click();
        await sleep(160);
    }
}

// ── The steps ────────────────────────────────────────────────────────────────────────────────

function holdMs(p: Record<string, any>, dflt: number): number {
    const n = Number(p.seconds);
    const s = Number.isFinite(n) && n >= 0 ? Math.min(n, 120) : dflt;
    return s * 1000;
}

async function hold(ms: number, o: NavRunOpts): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end && !o.cancelled?.()) await sleep(Math.min(150, end - Date.now()));
}

/** Show `el` (opening the tab or <details> it hides in), ring it, wait, unring. */
async function spotlight(el: HTMLElement, caption: string, ms: number, o: NavRunOpts, tone: 'go' | 'would' = 'go'): Promise<void> {
    reveal(el, null);
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* detached */ }
    const off = paintRing(el, caption, tone);
    try { await hold(ms, o); } finally { off(); }
}

async function stepSettingsCard(p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    const key = String(p.card || '').trim();
    if (!key) throw new Error(t('snav.err.noCard'));
    await openPage('settings', '', o);
    const find = () => Array.from(document.querySelectorAll<HTMLElement>('#view-settings .settings-sections > .glass-card'))
        .find((c) => c.dataset.cardKey === key || c.id === key) || null;
    const card = await until(find, 3000, o.cancelled);
    if (!card) throw new Error(t('snav.err.cardMissing', { k: key }));
    // A card taken off the layout is shown for this visit, the way the palette does it; a
    // folded one is unfolded. Both are the view, not a setting.
    card.classList.add('stg-card-peek');
    if (card.classList.contains('bmm-collapsed')) card.querySelector<HTMLElement>('.bmm-fold-chevron')?.click();
    const title = (card.querySelector('.card-title, h3')?.textContent || key).replace(/\s+/g, ' ').trim();
    await spotlight(card, String(p.note || '') || title, holdMs(p, 2.5), o);
    return { ok: true, note: t('snav.done.card', { k: title }) };
}

/**
 * The library draws only the rows near its scroll position, so a mod far down the list has no
 * card until the list has scrolled to it. Walk the page down a screen at a time (from the top)
 * until the card exists or the bottom is reached — the view moves, nothing else does.
 */
async function scrollLibraryTo(probe: () => HTMLElement | null, o: NavRunOpts): Promise<HTMLElement | null> {
    const sc = document.querySelector<HTMLElement>('#view-library')?.closest('.content-area') as HTMLElement | null
        || document.querySelector<HTMLElement>('.content-area');
    if (!sc) return null;
    sc.scrollTop = 0;
    for (let i = 0; i < 400 && !o.cancelled?.(); i++) {
        await sleep(90);
        const hit = probe();
        if (hit) return hit;
        const before = sc.scrollTop;
        sc.scrollTop = before + Math.max(200, sc.clientHeight * 0.8);
        if (sc.scrollTop === before) break;
    }
    return probe();
}

async function stepItem(p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    const kind = String(p.kind || '') as NavItemKind;
    const id = String(p.id || '').trim();
    if (!(NAV_ITEM_KINDS as readonly string[]).includes(kind)) throw new Error(t('snav.err.badKind', { k: kind }));
    if (!id) {
        if (p.onMissing === 'continue') return { ok: false, note: t('snav.err.noId') };
        throw new Error(t('snav.err.noId'));
    }
    const where = ITEM_PAGE[kind];
    await openPage(where.page, where.tab || '', o);
    const sels = itemSelectors(kind, CSS.escape(id));
    const probe = () => {
        for (const s of sels) { const hit = document.querySelector<HTMLElement>(s); if (hit) return hit; }
        return null;
    };
    let el: HTMLElement | null = await until(probe, kind === 'mod' ? 600 : 3000, o.cancelled);
    if (!el && kind === 'mod') el = await scrollLibraryTo(probe, o);
    if (!el) {
        if (p.onMissing === 'continue') return { ok: false, note: t('snav.miss.item', { id }) };
        throw new Error(t('snav.err.itemMissing', { id, p: where.page }));
    }
    const card = (el.closest(ITEM_CARD) as HTMLElement | null) || el;
    await spotlight(card, String(p.note || ''), holdMs(p, 2.5), o);
    return { ok: true, note: t('snav.done.item', { id }) };
}

/** A step's target: a listed control id, else a selector (highlight and wait only). */
function targetSelector(raw: string): string {
    const c = controlById(raw);
    if (c) return c.sel;
    const why = selectorProblem(raw);
    if (why) throw new Error(t('snav.err.badTarget', { s: raw.slice(0, 80) }));
    return raw;
}

async function stepHighlight(p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    const raw = String(p.target || '').trim();
    if (p.page) await openPage(String(p.page), String(p.tab || ''), o);
    const sel = targetSelector(raw);
    const el = await until(() => firstTarget(sel), Math.max(500, Number(p.waitSec ?? 3) * 1000), o.cancelled);
    if (!el) {
        if (p.onMissing === 'continue') return { ok: false, note: t('snav.miss.target', { s: raw.slice(0, 80) }) };
        throw new Error(t('snav.err.targetMissing', { s: raw.slice(0, 80) }));
    }
    await spotlight(el, String(p.note || ''), holdMs(p, 3), o);
    return { ok: true, note: t('snav.done.highlight', { s: raw.slice(0, 80) }) };
}

async function stepWait(p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    const raw = String(p.target || '').trim();
    const sel = targetSelector(raw);
    const secs = Math.min(Math.max(Number(p.timeoutSec) || 15, 1), 600);
    const el = await until(() => { const e = firstTarget(sel); return e && isShown(e) ? e : null; }, secs * 1000, o.cancelled);
    if (el) return { ok: true, note: t('snav.done.wait', { s: raw.slice(0, 80) }) };
    if (p.onTimeout === 'continue') return { ok: false, note: t('snav.miss.wait', { n: String(secs), s: raw.slice(0, 80) }) };
    throw new Error(t('snav.err.waitTimeout', { n: String(secs), s: raw.slice(0, 80) }));
}

/** A card with a title, a message and (optionally) an OK button, anchored to a target or not. */
async function stepMessage(p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    const title = String(p.title || '').trim();
    const message = String(p.message || '').trim();
    if (!title && !message) throw new Error(t('snav.err.noMessage'));
    let anchor: HTMLElement | null = null;
    let offRing: (() => void) | null = null;
    if (p.target) {
        anchor = await until(() => firstTarget(targetSelector(String(p.target))), 2000, o.cancelled);
        if (anchor) { reveal(anchor, null); offRing = paintRing(anchor, '', 'msg'); }
    }
    const card = document.createElement('div');
    card.className = 'snav-card';
    card.setAttribute('role', 'status');
    const h = document.createElement('div');
    h.className = 'snav-card-title';
    h.textContent = title;
    const b = document.createElement('div');
    b.className = 'snav-card-text';
    b.textContent = message;
    if (title) card.appendChild(h);
    if (message) card.appendChild(b);
    const waitOk = p.waitOk === true;
    let done: (() => void) | null = null;
    const answered = new Promise<void>((r) => { done = r; });
    if (waitOk) {
        const row = document.createElement('div');
        row.className = 'snav-card-actions';
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn btn-sm btn-primary';
        ok.textContent = String(p.okLabel || '') || t('common.ok');
        ok.addEventListener('click', () => done?.());
        row.appendChild(ok);
        card.appendChild(row);
    }
    layer().appendChild(card);
    if (anchor) {
        const a = anchor.getBoundingClientRect();
        const host = layer().getBoundingClientRect();
        const below = a.bottom + 140 < host.bottom;
        card.classList.add('is-anchored');
        card.style.left = `${Math.max(12, Math.min(a.left - host.left, host.width - 340))}px`;
        card.style.top = below ? `${a.bottom - host.top + 12}px` : `${Math.max(12, a.top - host.top - 140)}px`;
    }
    try {
        if (waitOk) {
            // Answered, stopped, or ten minutes: a reminder nobody saw must not hold a task forever.
            const stop = (async () => { await until(() => (o.cancelled?.() ? true : null), 600_000); })();
            await Promise.race([answered, stop]);
        } else {
            await hold(holdMs(p, 5), o);
        }
    } finally {
        card.remove();
        offRing?.();
    }
    return { ok: true, note: t('snav.done.message', { m: (title || message).slice(0, 60) }) };
}

async function stepModal(p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    const id = String(p.modal || '').trim();
    const m = modalById(id);
    if (!m) throw new Error(t('snav.err.badModal', { m: id }));
    const label = tx(m.key, id);
    if (o.preview) {
        const off = paintNote(t('snav.would.modal', { m: label }));
        try { await hold(2200, o); } finally { off(); }
        return { ok: true, note: t('snav.would.modal', { m: label }) };
    }
    if (!o.canAct) throw new Error(t('snav.err.perm'));
    const op = m.open;
    if (op.kind === 'global') {
        // Only the listed globals; a task never names a window property itself.
        const fn = MODAL_GLOBALS.includes(op.name) ? (window as any)[op.name] : null;
        if (typeof fn !== 'function') throw new Error(t('snav.err.modalMissing', { m: label }));
        fn(op.arg);
    } else {
        await openPage(op.page, op.tab || '', o);
        const btn = await until(() => document.querySelector<HTMLElement>(op.sel), 3000, o.cancelled);
        if (!btn) throw new Error(t('snav.err.modalMissing', { m: label }));
        const why = sensitiveReason(factsOf(btn));
        if (why) throw new Error(t('snav.err.sensitive', { c: label, w: why }));
        btn.click();
    }
    await sleep(250);
    return { ok: true, note: t('snav.done.modal', { m: label }) };
}

/** Read what the guard needs off an element. Also the eyedropper's guard (custom-shortcuts.ts). */
export function factsOf(el: HTMLElement): Parameters<typeof sensitiveReason>[0] {
    const form = el.closest('form, .modal, .modal-overlay, .modal-generic-overlay');
    return {
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        id: el.id,
        classes: Array.from(el.classList),
        text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        inConsent: !!el.closest('[data-consent], .consent, [id*="consent"], .telemetry-consent, #modal-eula, #modal-privacy'),
        inCredentialForm: !!form?.querySelector('input[type="password"]'),
        disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
    };
}

async function stepClick(p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    const id = String(p.control || '').trim();
    const c = controlById(id);
    if (!c) throw new Error(t('snav.err.badControl', { c: id }));
    const label = tx(c.key, id);
    await openPage(c.page, c.tab || '', o);
    const el = await until(() => document.querySelector<HTMLElement>(c.sel), 4000, o.cancelled);
    if (!el) throw new Error(t('snav.err.controlMissing', { c: label }));
    const why = sensitiveReason(factsOf(el));
    if (why) throw new Error(t('snav.err.sensitive', { c: label, w: why }));
    if (o.preview) {
        await spotlight(el, t('snav.would.click', { c: label }), 2600, o, 'would');
        return { ok: true, note: t('snav.would.click', { c: label }) };
    }
    if (!o.canAct) throw new Error(t('snav.err.perm'));
    reveal(el, null);
    const off = paintRing(el, label, 'go');
    try { await hold(500, o); } finally { off(); }
    el.click();
    return { ok: true, note: t('snav.done.click', { c: label }) };
}

/** Run one navigation step. Throws with a translated message when it cannot. */
export async function runNav(type: string, p: Record<string, any>, o: NavRunOpts): Promise<NavResult> {
    switch (type) {
        case 'nav.page': {
            const page = String(p.page || '').trim();
            if (!page) throw new Error(t('snav.err.noPageChosen'));
            await openPage(page, String(p.tab || '').trim(), o);
            const label = tx(pageById(page)?.key || '', page);
            if (p.note) {
                const off = paintNote(String(p.note), 'go');
                try { await hold(holdMs(p, 2.5), o); } finally { off(); }
            }
            return { ok: true, note: t('snav.done.page', { p: label + (p.tab ? ` › ${p.tab}` : '') }) };
        }
        case 'nav.settingsCard': return stepSettingsCard(p, o);
        case 'nav.item': return stepItem(p, o);
        case 'nav.highlight': return stepHighlight(p, o);
        case 'nav.waitFor': return stepWait(p, o);
        case 'nav.message': return stepMessage(p, o);
        case 'nav.modal': return stepModal(p, o);
        case 'nav.click': return stepClick(p, o);
    }
    throw new Error(t('snav.err.unknown', { t: type }));
}
