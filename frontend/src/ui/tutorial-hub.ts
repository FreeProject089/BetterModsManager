/**
 * tutorial-hub.ts — where you pick a lesson.
 *
 * Rebuilt. The version this replaces gave every tutorial a card carrying THREE progress
 * indicators at once: a percentage bar, an "n/m steps" label, and a row of part chips each
 * with its own n/m. Three answers to one question, none of which is the one you have when
 * you open this screen — which is "where was I, and what is next".
 *
 * So: a list of lessons on the left, and the selected lesson's parts on the right. One
 * progress reading per level. The right pane is the only place a part can be started from,
 * which also removes the old card's two-or-three competing buttons.
 *
 * Everything is built with DOM calls rather than innerHTML. Nothing here is user-authored
 * today, but `tut.icon` is raw SVG from the data file and the titles come through t() —
 * a screen that interpolates markup invites the day someone makes one of those dynamic.
 */

import { t } from '../core/i18n.js';
import { TUTORIALS, getAllStepKeys } from './tutorial-data.js';
import {
    getTutorialCompletion, isTutorialComplete, getLastPosition,
    getAllStepStatuses, resetTutorial,
} from './tutorial-store.js';
import { startTutorialEngine } from './tutorial-engine.js';
import type { TutorialDef } from './tutorial-types.js';
import {
    loadCustomTutorials, importCustomTutorialFromFile, exportCustomTutorial,
    deleteCustomTutorial, signatureLabel,
} from './tutorial-custom.js';
import { toast } from './app.js';

// Custom tutorials, loaded when the hub opens. Kept beside TUTORIALS rather than merged
// into it: the official array is a constant other modules import, and pushing into it from
// here would make "which tutorials exist" depend on whether this screen ever opened.
let _customDefs: TutorialDef[] = [];
const allTutorials = (): TutorialDef[] => [...TUTORIALS, ..._customDefs];

let _langListener: ((e: Event) => void) | null = null;
let _selected: string | null = null;

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

/** An SVG string from the tutorial data, parsed rather than interpolated. */
function svg(markup: string): Node {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
    const frag = document.createDocumentFragment();
    // Take the children of the wrapper, so a full <svg> in the data still lands correctly.
    for (const child of Array.from(doc.documentElement.childNodes)) frag.append(child);
    return frag;
}

function icon(paths: string, size = 14): SVGElement {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.5');
    s.setAttribute('stroke-linecap', 'round');
    s.append(svg(paths));
    return s;
}

const CHECK = '<polyline points="20 6 9 17 4 12"/>';
const CLOSE = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
const PLAY  = '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/>';

interface PartState { done: number; total: number; complete: boolean; started: boolean }

function partStates(tut: TutorialDef): PartState[] {
    const all = getAllStepStatuses(tut.id);
    return tut.parts.map((p) => {
        const done = p.steps.filter((s) => all[`${p.id}:${s.id}`]?.state === 'complete').length;
        return { done, total: p.steps.length, complete: done === p.steps.length && p.steps.length > 0, started: done > 0 };
    });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function openTutorialHub(): void {
    let overlay = document.getElementById('tut-hub-overlay');
    if (!overlay) {
        overlay = el('div', 'tut-hub-overlay');
        overlay.id = 'tut-hub-overlay';
        (document.getElementById('app-window-outer') || document.body).append(overlay);
    }
    overlay.classList.remove('closing');
    // Open on the lesson you were last in, not on the first one in the file.
    if (!_selected) _selected = allTutorials().find((x) => getLastPosition(x.id).partId)?.id ?? TUTORIALS[0]?.id ?? null;
    render(overlay);
    // Custom tutorials arrive async; repaint when they do. First paint shows the official
    // ones immediately — the hub must not wait on a backend call to open.
    void loadCustomTutorials().then((defs) => {
        _customDefs = defs;
        const o = document.getElementById('tut-hub-overlay');
        if (o) render(o);
    });

    if (_langListener) document.removeEventListener('langChanged', _langListener);
    _langListener = () => { const o = document.getElementById('tut-hub-overlay'); if (o) render(o); };
    document.addEventListener('langChanged', _langListener);
}

export function closeTutorialHub(): void {
    if (_langListener) { document.removeEventListener('langChanged', _langListener); _langListener = null; }
    const overlay = document.getElementById('tut-hub-overlay');
    if (!overlay) return;
    overlay.classList.add('closing');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
    // Reduced motion, a display change, a backgrounded window: if animationend never
    // fires the hub would sit on screen forever with nothing able to remove it.
    setTimeout(() => document.getElementById('tut-hub-overlay')?.remove(), 450);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render(overlay: HTMLElement): void {
    overlay.textContent = '';

    const backdrop = el('div', 'tut-hub-backdrop');
    backdrop.addEventListener('click', closeTutorialHub);

    const shell = el('div', 'tut-hub-shell');
    shell.append(rail(), detail());
    overlay.append(backdrop, shell);

    // Escape closes, once, and only while the hub is up.
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        document.removeEventListener('keydown', onKey);
        closeTutorialHub();
    };
    document.addEventListener('keydown', onKey);
}

/** Left: every lesson, one line each. */
function rail(): HTMLElement {
    const box = el('div', 'tut-hub-rail');

    const head = el('div', 'tut-hub-rail-head');
    head.append(el('div', 'tut-hub-rail-title', t('hub.title')));
    const close = el('button', 'tut-hub-close');
    close.setAttribute('type', 'button');
    close.setAttribute('aria-label', t('hub.close') || 'Close');
    close.append(icon(CLOSE, 13));
    close.addEventListener('click', closeTutorialHub);
    head.append(close);
    box.append(head);

    const list = el('div', 'tut-hub-list');
    for (const tut of allTutorials()) {
        const keys = getAllStepKeys(tut);
        const { done, total } = getTutorialCompletion(tut.id, keys);
        const complete = isTutorialComplete(tut.id, keys);

        const row = el('button', 'tut-hub-row');
        row.setAttribute('type', 'button');
        if (tut.id === _selected) row.classList.add('on');
        if (complete) row.classList.add('done');
        row.style.setProperty('--tut-color', tut.color);

        const mark = el('span', 'tut-hub-row-icon');
        mark.append(complete ? icon(CHECK, 13) : svg(tut.icon));
        row.append(mark);

        const mid = el('span', 'tut-hub-row-mid');
        mid.append(el('span', 'tut-hub-row-name', t(tut.title_key)));
        // ONE progress reading at this level: how far through, in steps. The bar is the
        // same fact drawn twice, so it is gone.
        mid.append(el('span', 'tut-hub-row-sub',
            complete ? (t('hub.completed') || 'Completed') : `${done}/${total} ${t('hub.stepsLabel') || 'steps'}`));
        row.append(mid);

        row.addEventListener('click', () => {
            _selected = tut.id;
            const o = document.getElementById('tut-hub-overlay');
            if (o) render(o);
        });
        list.append(row);
    }
    box.append(list);

    // ── yours ──
    // Create / import / catalogues, at the bottom of the rail: authoring is a rail-level
    // concern (it changes what the rail lists), not a property of any one lesson.
    const tools = el('div', 'tut-hub-tools');
    const mk = (label: string, onClick: () => void) => {
        const b = el('button', 'btn btn-ghost btn-sm', label);
        b.setAttribute('type', 'button');
        b.addEventListener('click', onClick);
        tools.append(b);
    };
    mk(t('tuthub.create'), () => {
        void import('./tutorial-creator.js').then((m) => m.openTutorialCreator(null, refreshHub));
    });
    mk(t('tuthub.import'), () => {
        void importCustomTutorialFromFile().then((res) => {
            if (!res) return;
            const sig = signatureLabel(res.signature);
            toast(`${t('tuthub.imported')} — ${sig.text}`, sig.tone === 'err' ? 'warning' : 'success');
            refreshHub();
        }).catch((e) => toast(String(e), 'error'));
    });
    mk(t('tuthub.catalogs'), () => {
        void import('./tutorial-catalog.js').then((m) => m.openTutorialCatalog(refreshHub));
    });
    box.append(tools);
    return box;
}

/** Reload the custom list and repaint — after a create, an import, a delete. */
function refreshHub(): void {
    void loadCustomTutorials().then((defs) => {
        _customDefs = defs;
        const o = document.getElementById('tut-hub-overlay');
        if (o) render(o);
    });
}

/** Right: the selected lesson, its parts, and the one button that matters. */
function detail(): HTMLElement {
    const box = el('div', 'tut-hub-detail');
    const tut = allTutorials().find((x) => x.id === _selected);
    if (!tut) {
        box.append(el('div', 'tut-hub-empty', t('hub.subtitle') || ''));
        return box;
    }
    box.style.setProperty('--tut-color', tut.color);

    const keys = getAllStepKeys(tut);
    const { done, total } = getTutorialCompletion(tut.id, keys);
    const complete = isTutorialComplete(tut.id, keys);
    const started = done > 0;
    const pos = getLastPosition(tut.id);

    box.append(el('h2', 'tut-hub-detail-title', t(tut.title_key)));
    box.append(el('p', 'tut-hub-detail-desc', t(tut.desc_key)));

    // The primary action, alone and unambiguous. The old card offered Start, Resume and
    // Restart at near-equal weight, so nothing said which one to press.
    const bar = el('div', 'tut-hub-actions');
    const cta = el('button', 'btn btn-primary tut-hub-cta');
    cta.setAttribute('type', 'button');
    cta.append(icon(PLAY, 12));
    cta.append(el('span', '', complete
        ? (t('hub.restart') || 'Restart')
        : started ? (t('hub.resume') || 'Resume') : (t('hub.start') || 'Start')));
    cta.addEventListener('click', () => {
        if (complete) resetTutorial(tut.id);
        launch(tut, complete ? null : pos.partId, complete ? null : pos.stepId);
    });
    bar.append(cta);

    // Restart is secondary and only exists once there is progress to throw away.
    if (started && !complete) {
        const again = el('button', 'btn btn-ghost');
        again.setAttribute('type', 'button');
        again.textContent = t('hub.restart') || 'Restart';
        again.addEventListener('click', () => {
            resetTutorial(tut.id);
            const o = document.getElementById('tut-hub-overlay');
            if (o) render(o);
        });
        bar.append(again);
    }
    box.append(bar);

    // The parts, as a list you can enter at any point. This is the only place a part is
    // startable from — the rail says where you are, this says where you can go.
    const states = partStates(tut);
    const list = el('div', 'tut-hub-parts');
    tut.parts.forEach((p, i) => {
        const st = states[i];
        const row = el('button', 'tut-hub-part');
        row.setAttribute('type', 'button');
        if (st.complete) row.classList.add('done');
        else if (st.started) row.classList.add('doing');
        // Where you would land if you pressed Resume — the answer to "where was I".
        if (p.id === pos.partId && !complete) row.classList.add('here');

        const dot = el('span', 'tut-hub-part-dot');
        if (st.complete) dot.append(icon(CHECK, 10));
        row.append(dot);

        row.append(el('span', 'tut-hub-part-name', t(p.title_key)));
        row.append(el('span', 'tut-hub-part-count', `${st.done}/${st.total}`));

        row.addEventListener('click', () => launch(tut, p.id, p.steps[0]?.id ?? null));
        list.append(row);
    });
    box.append(list);

    // A custom tutorial is a document you own: edit, share, delete. Official ones have no
    // such rows, and the absence is the statement — they are not yours to change.
    if (tut.id.startsWith('custom:')) {
        const docId = tut.id.slice('custom:'.length);
        const own = el('div', 'tut-hub-actions');
        const mk = (label: string, cls: string, onClick: () => void) => {
            const b = el('button', `btn ${cls} btn-sm`, label);
            b.setAttribute('type', 'button');
            b.addEventListener('click', onClick);
            own.append(b);
        };
        mk(t('tuthub.edit'), 'btn-ghost', () => {
            void import('./tutorial-creator.js').then((m) => m.openTutorialCreator(docId, refreshHub));
        });
        mk(t('tuthub.export'), 'btn-ghost', () => {
            void exportCustomTutorial(docId).then((p) => { if (p) toast(t('tuthub.exported'), 'success'); })
                .catch((e) => toast(String(e), 'error'));
        });
        mk(t('tuthub.delete'), 'btn-ghost', () => {
            void deleteCustomTutorial(docId).then(() => {
                if (_selected === tut.id) _selected = TUTORIALS[0]?.id ?? null;
                toast(t('tuthub.deleted'), 'success');
                refreshHub();
            }).catch((e) => toast(String(e), 'error'));
        });
        box.append(own);
    } else {
        // A BUILT-IN one. It is still not yours to change — but it can be COPIED, and the
        // copy is an ordinary custom tutorial: same steps, same waits, a new id, and every
        // string materialised so it no longer depends on the app's dictionary. That is the
        // difference between "read only" and "no starting point".
        const own = el('div', 'tut-hub-actions');
        const b = el('button', 'btn btn-ghost btn-sm', t('tuthub.fork') || 'Make a copy I can edit');
        b.setAttribute('type', 'button');
        b.addEventListener('click', () => {
            void (async () => {
                try {
                    const { forkBuiltin, saveCustomTutorial } = await import('./tutorial-custom.js');
                    // A new id, and one that does not collide: the id is the filename and
                    // the progress key, so reusing the built-in's would fork the reader's
                    // progress along with the lesson.
                    const base = `${tut.id}-copy`;
                    let id = base;
                    for (let n = 2; TUTORIALS.some((x) => x.id === `custom:${id}`); n++) id = `${base}-${n}`;
                    const doc = forkBuiltin(tut, id);
                    await saveCustomTutorial(doc);
                    toast(t('tuthub.forked') || 'Copied — open it under your own tutorials.', 'success');
                    refreshHub();
                    void import('./tutorial-creator.js').then((m) => m.openTutorialCreator(id, refreshHub));
                } catch (e) { toast(String(e), 'error'); }
            })();
        });
        own.append(b);
        box.append(own);
    }

    const foot = el('div', 'tut-hub-foot', t('hub.footer') || '');
    box.append(foot);
    return box;
}

function launch(tut: TutorialDef, partId: string | null, stepId: string | null): void {
    closeTutorialHub();
    startTutorialEngine(tut, partId, stepId, openTutorialHub);
}
