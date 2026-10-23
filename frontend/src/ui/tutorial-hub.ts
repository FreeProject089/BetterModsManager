/**
 * tutorial-hub.ts — where you pick a lesson.
 *
 * A house dialog (modal-shell openModal), not a private overlay family. The hub used to be a
 * `.tut-hub-overlay` at z-index 2000000 with its own backdrop, Escape handler and close
 * button — and everything opened FROM it (the creator, the catalogue, a delete confirmation)
 * had to out-number it by hand. The creator did not, and opened behind it. On the shell, the
 * hub is raised above what is open when it opens, and anything opened from it is raised above
 * the hub by the same rule (layer.ts), with Escape, the Tab trap and focus return for free.
 *
 * LAYOUT
 *
 *   left   search · category tabs · one row per lesson (status chip, level, parts)
 *   right  the selected lesson: what it teaches, ONE progress reading, the action that fits
 *          its state (Start / Resume + Restart / Start again), and its parts, each enterable
 *
 * No durations anywhere: a lesson is as long as the reader makes it, and a number of minutes
 * is a promise this screen cannot keep. It says how many parts and steps instead.
 *
 * KEYBOARD
 *
 *   ↑ ↓ Home End   move through the lessons (the detail follows)
 *   Enter          the primary action of the selected lesson
 *   /              search
 *   ↓ in search    into the list
 *
 * Everything is built with DOM calls rather than innerHTML. `tut.icon` is SVG from the data
 * file (or a pack icon the app rendered for a custom one) and is parsed, never interpolated.
 */

import { t } from '../core/i18n.js';
import { TUTORIALS, getAllStepKeys } from './tutorial-data.js';
import {
    getTutorialCompletion, isTutorialComplete, getLastPosition,
    getAllStepStatuses, resetTutorial,
} from './tutorial-store.js';
import { startTutorialEngine } from './tutorial-engine.js';
import type { TutorialDef, TutorialCategory } from './tutorial-types.js';
import {
    loadCustomTutorials, importCustomTutorialFromFile, exportCustomTutorial,
    deleteCustomTutorial, signatureLabel, getCustomDoc, armWatchers, disarmWatchers,
} from './tutorial-custom.js';
import { toast } from './app.js';
import { openModal, type ModalHandle } from './modal-shell.js';
import { uiIcon, uiIconEl, type IconName } from './icons.js';
import { lessonStatus, matchesQuery, type LessonStatus } from './tutorial-validate.js';

// Custom tutorials, loaded when the hub opens. Kept beside TUTORIALS rather than merged into
// it: the official array is a constant other modules import, and pushing into it from here
// would make "which tutorials exist" depend on whether this screen ever opened.
let _customDefs: TutorialDef[] = [];
const allTutorials = (): TutorialDef[] => [...TUTORIALS, ..._customDefs];

type Filter = 'all' | TutorialCategory;
const CATEGORIES: Filter[] = ['all', 'start', 'essentials', 'advanced', 'tools', 'mine'];

const state = {
    handle: null as ModalHandle | null,
    selected: null as string | null,
    filter: 'all' as Filter,
    query: '',
    langListener: null as ((e: Event) => void) | null,
};

// ── pure: status, filtering ─────────────────────────────────────────────────────────────────

const categoryOf = (tut: TutorialDef): TutorialCategory =>
    tut.id.startsWith('custom:') ? 'mine' : (tut.category || 'essentials');

function statusOf(tut: TutorialDef): { status: LessonStatus; done: number; total: number } {
    const { done, total } = getTutorialCompletion(tut.id, getAllStepKeys(tut));
    return { status: lessonStatus(done, total, !!getLastPosition(tut.id).partId), done, total };
}

function visible(): TutorialDef[] {
    return allTutorials().filter((tut) => {
        if (state.filter !== 'all' && categoryOf(tut) !== state.filter) return false;
        if (!state.query.trim()) return true;
        const hay = [t(tut.title_key), t(tut.desc_key), ...tut.parts.map((p) => t(p.title_key))].join(' ');
        return matchesQuery(hay.replace(/<[^>]+>/g, ' '), state.query);
    });
}

// ── DOM helpers ─────────────────────────────────────────────────────────────────────────────

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

function button(label: string, cls: string, onClick: () => void, icon?: IconName): HTMLButtonElement {
    const b = el('button', cls) as HTMLButtonElement;
    b.type = 'button';
    if (icon) b.append(uiIconEl(icon, 14));
    b.append(el('span', '', label));
    b.addEventListener('click', onClick);
    return b;
}

/** An SVG string from the tutorial data, parsed rather than interpolated. */
function svgFrom(markup: string): Node {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
    const frag = document.createDocumentFragment();
    for (const child of Array.from(doc.documentElement.childNodes)) frag.append(document.importNode(child, true));
    return frag;
}

/** The lesson's glyph in a tile. Data markup that is a whole <svg> lands as is; bare paths
 *  are wrapped in a 24-grid stroke svg. */
function lessonTile(tut: TutorialDef, cls: string): HTMLElement {
    const tile = el('span', cls);
    tile.setAttribute('aria-hidden', 'true');
    tile.style.setProperty('--thub-color', tut.color);
    const markup = (tut.icon || '').trim();
    if (/^<svg[\s>]/i.test(markup)) tile.append(svgFrom(markup));
    else {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '18'], ['height', '18'], ['fill', 'none'],
            ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) s.setAttribute(k, v);
        s.append(svgFrom(markup));
        tile.append(s);
    }
    return tile;
}

const STATUS_LABEL: Record<LessonStatus, () => string> = {
    new: () => t('hub.badge.new'),
    progress: () => t('hub.badge.partial'),
    done: () => t('hub.badge.complete'),
};
const STATUS_TONE: Record<LessonStatus, string> = { new: '', progress: ' bms-chip--accent', done: ' bms-chip--ok' };

function statusChip(s: LessonStatus): HTMLElement {
    const c = el('span', `bms-chip thub-status${STATUS_TONE[s]}`);
    c.append(el('span', 'bms-dot'), el('span', '', STATUS_LABEL[s]()));
    return c;
}

const levelLabel = (lv?: number): string => (lv ? t(`hub.level.${lv}`) : '');

// ── public API ──────────────────────────────────────────────────────────────────────────────

export function openTutorialHub(): void {
    if (state.handle) { paint(); return; }
    // Open on the lesson you were last in, not on the first one in the file.
    if (!state.selected) {
        state.selected = allTutorials().find((x) => getLastPosition(x.id).partId && !isTutorialComplete(x.id, getAllStepKeys(x)))?.id
            ?? TUTORIALS[0]?.id ?? null;
    }

    const body = el('div', 'thub-grid');
    const foot = el('div', 'modal-footer-start');
    foot.append(
        button(t('tuthub.create'), 'btn btn-ghost btn-sm', () => openCreator(null), 'add'),
        button(t('tuthub.import'), 'btn btn-ghost btn-sm', () => { void importFile(); }, 'import'),
        button(t('tuthub.catalogs'), 'btn btn-ghost btn-sm', () => {
            void import('./tutorial-catalog.js').then((m) => m.openTutorialCatalog(refreshHub));
        }, 'store'),
    );
    const footer = document.createDocumentFragment();
    footer.append(foot, button(t('hub.close'), 'btn btn-secondary', () => closeTutorialHub()));

    state.handle = openModal({
        id: 'tut-hub',
        title: t('hub.title'),
        subtitle: t('hub.subtitle'),
        icon: uiIcon('book-open', 20),
        size: 'xl',
        tall: true,
        className: 'thub',
        body,
        footer,
        closeLabel: t('hub.close'),
        onClose: () => {
            state.handle = null;
            if (state.langListener) { document.removeEventListener('langChanged', state.langListener); state.langListener = null; }
        },
    });
    state.handle.body.classList.add('modal-body--flush');
    // A keyboard user lands in the list, on the selected lesson: the thing this screen is for.
    paint(true);

    // Custom tutorials arrive async; repaint when they do. First paint shows the official ones
    // immediately — the hub must not wait on a backend call to open.
    void loadCustomTutorials().then((defs) => { _customDefs = defs; if (state.handle) paint(); });

    state.langListener = () => {
        if (!state.handle) return;
        const h = state.handle.header;
        const title = h.querySelector('.modal-title');
        const sub = h.querySelector('.bms-sub');
        if (title) title.textContent = t('hub.title');
        if (sub) sub.textContent = t('hub.subtitle');
        paint();
    };
    document.addEventListener('langChanged', state.langListener);
}

export function closeTutorialHub(): void {
    state.handle?.close();
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────

function paint(focusList = false): void {
    const h = state.handle;
    if (!h) return;
    const grid = h.body.querySelector<HTMLElement>('.thub-grid');
    if (!grid) return;
    const hadSearchFocus = document.activeElement?.classList.contains('thub-search-input');
    const caret = hadSearchFocus ? (document.activeElement as HTMLInputElement).selectionStart : null;

    const list = visible();
    if (state.selected && !list.some((x) => x.id === state.selected)) state.selected = list[0]?.id ?? state.selected;

    grid.textContent = '';
    grid.append(rail(list), detail());

    if (hadSearchFocus) {
        const i = grid.querySelector<HTMLInputElement>('.thub-search-input');
        i?.focus();
        if (i && caret != null) i.setSelectionRange(caret, caret);
    } else if (focusList) {
        requestAnimationFrame(() => grid.querySelector<HTMLElement>('.thub-row[aria-selected="true"]')?.focus({ preventScroll: false }));
    }
}

function rail(list: TutorialDef[]): HTMLElement {
    const box = el('div', 'thub-rail');

    // ── search ──
    const search = el('label', 'pg-search thub-search');
    search.append(uiIconEl('search', 14));
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'pg-search-input thub-search-input';
    input.placeholder = t('hub.searchPh');
    input.setAttribute('aria-label', t('hub.searchPh'));
    input.value = state.query;
    input.addEventListener('input', () => { state.query = input.value; paint(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            box.querySelector<HTMLElement>('.thub-row[aria-selected="true"], .thub-row')?.focus();
        } else if (e.key === 'Escape' && input.value) {
            // Clear first; a second Escape closes the dialog.
            e.preventDefault();
            e.stopPropagation();
            state.query = '';
            paint();
        }
    });
    search.append(input);
    box.append(search);

    // ── categories ──
    const tabs = el('div', 'bms-tabs thub-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('hub.categories'));
    const all = allTutorials();
    for (const c of CATEGORIES) {
        const n = c === 'all' ? all.length : all.filter((x) => categoryOf(x) === c).length;
        // An empty official category is noise; "Mine" stays, its empty state is the invitation.
        if (!n && c !== 'mine' && c !== 'all') continue;
        const b = el('button', 'bms-tab thub-tab');
        b.setAttribute('type', 'button');
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(state.filter === c));
        b.append(el('span', '', t(`hub.cat.${c}`)), el('span', 'thub-tab-n', String(n)));
        b.addEventListener('click', () => { state.filter = c; paint(); });
        tabs.append(b);
    }
    // ←/→ between tabs, the usual tablist contract.
    tabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const btns = [...tabs.querySelectorAll<HTMLElement>('.thub-tab')];
        const i = btns.indexOf(document.activeElement as HTMLElement);
        if (i < 0) return;
        e.preventDefault();
        const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
        next.click();
        requestAnimationFrame(() => state.handle?.body.querySelectorAll<HTMLElement>('.thub-tab')[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length]?.focus());
    });
    box.append(tabs);

    // ── lessons ──
    if (!list.length) {
        box.append(emptyState());
        return box;
    }
    const ul = el('div', 'thub-list');
    ul.setAttribute('role', 'listbox');
    ul.setAttribute('aria-label', t('hub.title'));
    for (const tut of list) ul.append(row(tut));
    ul.addEventListener('keydown', (e) => onListKey(e, ul));
    box.append(ul);
    return box;
}

function emptyState(): HTMLElement {
    const box = el('div', 'bms-empty thub-empty');
    const ic = el('div', 'bms-empty-ic');
    if (state.query.trim()) {
        ic.append(uiIconEl('search', 20));
        box.append(ic, el('div', 'bms-empty-t', t('hub.empty.search')), el('p', 'bms-note', t('hub.empty.searchHint')));
        box.append(button(t('hub.empty.clear'), 'btn btn-secondary btn-sm', () => { state.query = ''; state.filter = 'all'; paint(true); }));
    } else if (state.filter === 'mine') {
        ic.append(uiIconEl('edit', 20));
        box.append(ic, el('div', 'bms-empty-t', t('hub.empty.mine')), el('p', 'bms-note', t('hub.empty.mineHint')));
        const row = el('div', 'bms-toolbar');
        row.append(
            button(t('tuthub.create'), 'btn btn-primary btn-sm', () => openCreator(null), 'add'),
            button(t('tuthub.import'), 'btn btn-secondary btn-sm', () => { void importFile(); }, 'import'),
        );
        box.append(row);
    } else {
        ic.append(uiIconEl('book-open', 20));
        box.append(ic, el('div', 'bms-empty-t', t('hub.empty.none')));
    }
    return box;
}

function row(tut: TutorialDef): HTMLElement {
    const { status } = statusOf(tut);
    const on = tut.id === state.selected;
    const r = el('div', `thub-row is-${status}`);
    r.setAttribute('role', 'option');
    r.setAttribute('aria-selected', String(on));
    r.tabIndex = on ? 0 : -1;
    r.dataset.id = tut.id;
    r.style.setProperty('--thub-color', tut.color);

    r.append(lessonTile(tut, 'thub-row-tile'));
    const mid = el('span', 'thub-row-mid');
    mid.append(el('span', 'thub-row-name', t(tut.title_key)));
    const meta = el('span', 'thub-row-meta');
    const bits = [levelLabel(tut.level), `${tut.parts.length} ${t('hub.parts')}`].filter(Boolean);
    meta.textContent = bits.join(' · ');
    mid.append(meta);
    r.append(mid, statusChip(status));

    r.addEventListener('click', () => select(tut.id, false));
    r.addEventListener('dblclick', () => primary(tut));
    return r;
}

function select(id: string, focus: boolean): void {
    state.selected = id;
    const h = state.handle;
    if (!h) return;
    // Update in place: rebuilding the list would drop the focus a keyboard user is moving.
    h.body.querySelectorAll<HTMLElement>('.thub-row').forEach((r) => {
        const on = r.dataset.id === id;
        r.setAttribute('aria-selected', String(on));
        r.tabIndex = on ? 0 : -1;
        if (on && focus) { r.focus(); r.scrollIntoView({ block: 'nearest' }); }
    });
    const old = h.body.querySelector('.thub-detail');
    if (old) old.replaceWith(detail());
}

function onListKey(e: KeyboardEvent, ul: HTMLElement): void {
    const rows = [...ul.querySelectorAll<HTMLElement>('.thub-row')];
    const i = rows.findIndex((r) => r.dataset.id === state.selected);
    let to = -1;
    if (e.key === 'ArrowDown') to = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') {
        if (i <= 0) { e.preventDefault(); state.handle?.body.querySelector<HTMLElement>('.thub-search-input')?.focus(); return; }
        to = i - 1;
    } else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = rows.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const tut = allTutorials().find((x) => x.id === state.selected);
        if (tut) primary(tut);
        return;
    }
    if (to < 0) return;
    e.preventDefault();
    const id = rows[to]?.dataset.id;
    if (id) select(id, true);
}

/** The selected lesson. */
function detail(): HTMLElement {
    const box = el('div', 'thub-detail');
    box.setAttribute('aria-live', 'polite');
    const tut = allTutorials().find((x) => x.id === state.selected);
    if (!tut) {
        const empty = el('div', 'bms-empty');
        const ic = el('div', 'bms-empty-ic');
        ic.append(uiIconEl('book-open', 20));
        empty.append(ic, el('div', 'bms-empty-t', t('hub.pick')));
        box.append(empty);
        return box;
    }
    box.style.setProperty('--thub-color', tut.color);
    const { status, done, total } = statusOf(tut);
    const pos = getLastPosition(tut.id);

    // ── head ──
    const head = el('div', 'thub-d-head');
    head.append(lessonTile(tut, 'thub-d-tile'));
    const titles = el('div', 'thub-d-titles');
    titles.append(el('h3', 'thub-d-title', t(tut.title_key)));
    const chips = el('div', 'thub-d-chips');
    chips.append(statusChip(status));
    if (tut.level) chips.append(el('span', 'bms-chip', levelLabel(tut.level)));
    chips.append(el('span', 'bms-chip', `${tut.parts.length} ${t('hub.parts')} · ${total} ${t('hub.steps')}`));
    titles.append(chips);
    head.append(titles);
    box.append(head);

    const desc = el('p', 'bms-note thub-d-desc');
    desc.textContent = t(tut.desc_key).replace(/<[^>]+>/g, '');
    box.append(desc);

    // ── ONE progress reading ──
    const prog = el('div', 'thub-d-progress');
    const bar = el('div', 'bms-progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(done));
    bar.setAttribute('aria-label', t('hub.progress'));
    const fill = el('span');
    fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    bar.append(fill);
    prog.append(bar, el('span', 'thub-d-count', t('hub.progressOf').replace('{done}', String(done)).replace('{total}', String(total))));
    box.append(prog);

    // ── the action that fits the state ──
    const actions = el('div', 'bms-toolbar thub-d-actions');
    const cta = button(
        status === 'done' ? t('hub.again') : status === 'progress' ? t('hub.resume') : t('hub.start'),
        'btn btn-primary thub-cta', () => primary(tut), status === 'done' ? 'reset' : 'play');
    actions.append(cta);
    if (status === 'progress') {
        actions.append(button(t('hub.restart'), 'btn btn-ghost', () => {
            resetTutorial(tut.id);
            launch(tut, null, null);
        }, 'reset'));
    }
    if (status === 'progress' && pos.partId) {
        const part = tut.parts.find((p) => p.id === pos.partId);
        if (part) actions.append(el('span', 'thub-d-where', `${t('hub.youreOn')} ${t(part.title_key)}`));
    }
    box.append(actions);

    // ── parts: each one enterable ──
    box.append(el('div', 'bms-label thub-d-label', t('hub.partsTitle')));
    const all = getAllStepStatuses(tut.id);
    const parts = el('ol', 'thub-parts');
    tut.parts.forEach((p, i) => {
        const pd = p.steps.filter((s) => all[`${p.id}:${s.id}`]?.state === 'complete').length;
        const ps = lessonStatus(pd, p.steps.length, false);
        const li = el('li');
        const b = el('button', `thub-part is-${ps}${p.id === pos.partId && status !== 'done' ? ' is-here' : ''}`) as HTMLButtonElement;
        b.type = 'button';
        const dot = el('span', 'thub-part-dot');
        if (ps === 'done') dot.append(uiIconEl('check', 12));
        else dot.textContent = String(i + 1);
        b.append(dot, el('span', 'thub-part-name', t(p.title_key)), el('span', 'thub-part-n', `${pd}/${p.steps.length}`));
        b.title = t('hub.startHere');
        b.addEventListener('click', () => launch(tut, p.id, p.steps[0]?.id ?? null));
        li.append(b);
        parts.append(li);
    });
    box.append(parts);

    // ── ownership ──
    const own = el('div', 'bms-toolbar thub-d-own');
    if (tut.id.startsWith('custom:')) {
        const docId = tut.id.slice('custom:'.length);
        own.append(
            button(t('tuthub.edit'), 'btn btn-ghost btn-sm', () => openCreator(docId), 'edit'),
            button(t('tuthub.export'), 'btn btn-ghost btn-sm', () => {
                void exportCustomTutorial(docId).then((p) => { if (p) toast(t('tuthub.exported'), 'success'); })
                    .catch((e) => toast(String(e), 'error'));
            }, 'export'),
            button(t('tuthub.delete'), 'btn btn-ghost btn-sm thub-danger', () => { void remove(tut, docId); }, 'delete'),
        );
    } else {
        // A built-in is not yours to change — but it can be COPIED, and the copy is an ordinary
        // custom tutorial with every string materialised.
        own.append(button(t('tuthub.fork'), 'btn btn-ghost btn-sm', () => { void fork(tut); }, 'copy'));
    }
    box.append(own);
    box.append(el('p', 'bms-note thub-d-foot', t('hub.footer')));
    return box;
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────

function primary(tut: TutorialDef): void {
    const { status } = statusOf(tut);
    if (status === 'done') { resetTutorial(tut.id); launch(tut, null, null); return; }
    const pos = getLastPosition(tut.id);
    launch(tut, pos.partId, pos.stepId);
}

function launch(tut: TutorialDef, partId: string | null, stepId: string | null): void {
    // A custom tutorial's observed waits (click, appear, a value…) need their watchers armed,
    // or those steps wait forever. They come down when the lesson hands back to the hub.
    const doc = tut.id.startsWith('custom:') ? getCustomDoc(tut.id.slice('custom:'.length)) : null;
    if (doc) armWatchers(doc); else disarmWatchers();
    closeTutorialHub();
    startTutorialEngine(tut, partId, stepId, () => { disarmWatchers(); openTutorialHub(); });
}

function openCreator(docId: string | null): void {
    void import('./tutorial-creator.js').then((m) => m.openTutorialCreator(docId, refreshHub));
}

async function importFile(): Promise<void> {
    try {
        const res = await importCustomTutorialFromFile();
        if (!res) return;
        const sig = signatureLabel(res.signature);
        toast(`${t('tuthub.imported')}: ${sig.text}`, sig.tone === 'err' ? 'warning' : 'success');
        state.selected = `custom:${res.id}`;
        state.filter = 'mine';
        refreshHub();
    } catch (e) { toast(String(e), 'error'); }
}

async function remove(tut: TutorialDef, docId: string): Promise<void> {
    const { showConfirm } = await import('./confirm.js');
    const ok = await showConfirm(t('tuthub.delete'), t('hub.deleteAsk').replace('{name}', t(tut.title_key)), true);
    if (!ok) return;
    try {
        await deleteCustomTutorial(docId);
        if (state.selected === tut.id) state.selected = TUTORIALS[0]?.id ?? null;
        toast(t('tuthub.deleted'), 'success');
        refreshHub();
    } catch (e) { toast(String(e), 'error'); }
}

async function fork(tut: TutorialDef): Promise<void> {
    try {
        const { forkBuiltin, saveCustomTutorial, listCustomDocs } = await import('./tutorial-custom.js');
        // A new id that collides with nothing: the id is the filename and the progress key, so
        // reusing one would fork the reader's progress along with the lesson.
        const taken = new Set(listCustomDocs().map((d) => d.id));
        const base = `${tut.id}-copy`;
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        await saveCustomTutorial(forkBuiltin(tut, id));
        toast(t('tuthub.forked'), 'success');
        state.selected = `custom:${id}`;
        refreshHub();
        openCreator(id);
    } catch (e) { toast(String(e), 'error'); }
}

/** Reload the custom list and repaint — after a create, an import, a delete. */
function refreshHub(): void {
    void loadCustomTutorials().then((defs) => { _customDefs = defs; if (state.handle) paint(); });
}
