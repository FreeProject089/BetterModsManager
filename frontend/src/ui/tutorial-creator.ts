// The tutorial creator: build a .bmmtut without touching JSON.
//
// A house dialog (modal-shell openModal). It used to be a hand-built `.modal-overlay` whose
// stacking came from a `.tutc-overlay { z-index: 2000100 }` rule in main.css — which
// modal-shell.css, linked later at the same specificity, overrode with 5000: the creator
// opened BEHIND the hub that launched it. On the shell it is raised above whatever is open
// (layer.ts), like every other dialog.
//
// SHAPE
//
//   left   the tutorial's own facts (title, description, level, colour, icon, id), its
//          parts, and the selected part's steps as a list you reorder by dragging or with
//          Alt+↑/↓ (the same keys as the activation order)
//   right  the selected step: title and text (EN, or FR with the language switch), where it
//          points (page, element + Pick + live check, spotlight or outline), what it waits
//          for, and Preview — which runs THIS step in the real engine over the real app
//
// Everything writes into one document object. Save hands it to the backend, which checks,
// signs and stores it; the same document is what the hub's Share exports. The header says
// whether what you see is saved. Problems are listed as you type (tutorial-validate.ts);
// only a missing title or an unusable id stops a Save.
//
// WHAT A CREATED TUTORIAL CAN DO
//
// The document maps 1:1 onto TutorialDef (tutorial-custom.toDef), so navigation,
// highlighting, outline-only targets, optional steps and every kind of wait run in the one
// engine the official lessons use. Two deliberate limits: text is sanitised to formatting
// tags (a shared file must not script the app), and the icon is a pack reference, never SVG.
// The coach card's position is the READER's choice (dock left / right / bottom), so a step
// does not set it — the per-step choice is how its target is shown.

import { invoke, pickFile, saveFile } from '../core/api.js';
import { openIconPicker, isPackIcon, renderPackIcon } from './icon-pack.js';
import { checkCondition } from './tutorial-expr.js';
import { t } from '../core/i18n.js';
import { toast } from './app.js';
import {
    getCustomDoc, type CustomTutorialDoc, saveCustomTutorial, toDef, armWatchers, disarmWatchers,
} from './tutorial-custom.js';
import { uiIcon, uiIconEl, type IconName } from './icons.js';
import { BMM_ACTIONS } from './tutorial-events.js';
import { pickElement } from './tutorial-pick.js';
import { openModal, topOverlay, type ModalHandle } from './modal-shell.js';
import { resolveTargets, selectorSyntaxOk } from './tutorial-target.js';
import { validateDoc, issuesOf, moveItem, freeStepId, parseBmmtut, idOk, type Issue } from './tutorial-validate.js';

const VIEWS = ['library', 'profiles', 'modlist', 'repo', 'mapper', 'plugins', 'apps', 'community', 'modpacks', 'docs', 'settings'];

type Doc = CustomTutorialDoc;
type Part = Doc['parts'][number];
type Step = Part['steps'][number];
type Wait = NonNullable<Step['wait']>;
type Lang = 'en' | 'fr';
type LText = { en: string; fr?: string };

// ── small DOM helpers ───────────────────────────────────────────────────────────────────────

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

function button(label: string, cls: string, onClick: () => void, icon?: IconName, iconOnly = false): HTMLButtonElement {
    const b = el('button', cls) as HTMLButtonElement;
    b.type = 'button';
    if (icon) b.append(uiIconEl(icon, 14));
    if (iconOnly) { b.setAttribute('aria-label', label); b.title = label; }
    else b.append(el('span', '', label));
    b.addEventListener('click', onClick);
    return b;
}

function input(value: string, placeholder: string, onInput: (v: string) => void, cls = 'input input-sm'): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'text';
    i.className = cls;
    i.value = value;
    i.placeholder = placeholder;
    i.spellcheck = false;
    i.addEventListener('input', () => onInput(i.value));
    return i;
}

function select(options: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = document.createElement('select');
    s.className = 'input input-sm';
    for (const [v, label] of options) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        if (v === value) o.selected = true;
        s.append(o);
    }
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

let _fieldSeq = 0;
function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const wrap = el('div', 'bms-field tcr-field');
    const id = control.id || `tcr-f-${++_fieldSeq}`;
    const target = control.matches('input, select, textarea') ? control : control.querySelector<HTMLElement>('input, select, textarea');
    if (target && !target.id) target.id = id;
    const lab = el('label', 'bms-label', label);
    if (target) lab.setAttribute('for', target.id);
    wrap.append(lab, control);
    if (hint) wrap.append(el('div', 'tcr-hint', hint));
    return wrap;
}

/** The nav label the app shows for a view, so the page list reads in the reader's language. */
function viewLabel(v: string): string {
    const n = document.querySelector(`.nav-item[data-view="${v}"] .nav-label`);
    return (n?.textContent || '').trim() || v;
}

function blankStep(id: string): Step { return { id, title: { en: '' }, text: { en: '' } }; }

function blankDoc(): Doc {
    return {
        format: 'bmmtut',
        version: 1,
        id: `tut-${Math.random().toString(36).slice(2, 8)}`,
        title: { en: '' },
        desc: { en: '' },
        color: '#8b5cf6',
        level: 1,
        parts: [{ id: 'part-1', title: { en: 'Part 1' }, steps: [blankStep('step-1')] }],
    };
}

/** Hide every open dialog while `fn` runs (the picker, the preview): the element being taught
 *  is usually behind them. Each gets its own visibility back. */
async function withDialogsHidden<T>(fn: () => Promise<T>): Promise<T> {
    const hidden = [...document.querySelectorAll<HTMLElement>('.modal-overlay.open, .modal-generic-overlay.open')]
        .filter((o) => o.style.visibility !== 'hidden');
    for (const o of hidden) o.style.visibility = 'hidden';
    try { return await fn(); } finally { for (const o of hidden) o.style.visibility = ''; }
}

// ── the editor ──────────────────────────────────────────────────────────────────────────────

export function openTutorialCreator(editId: string | null, onSaved: () => void): void {
    document.getElementById('tutc')?.querySelector<HTMLElement>('.tcr-close')?.click();

    // Edited as a deep copy: Cancel must leave the stored document exactly as it was, and the
    // loaded cache in tutorial-custom is the same object the hub renders from.
    let lockedId: string | null = editId;
    let doc: Doc = editId ? JSON.parse(JSON.stringify(getCustomDoc(editId) || blankDoc())) : blankDoc();
    let saved = JSON.stringify(doc);
    let partIdx = 0;
    let stepIdx = 0;
    let lang: Lang = 'en';
    let handle: ModalHandle | null = null;

    const dirty = () => JSON.stringify(doc) !== saved;
    const part = (): Part => doc.parts[Math.min(partIdx, doc.parts.length - 1)];
    const step = (): Step => part().steps[Math.min(stepIdx, part().steps.length - 1)];

    /** Read/write the current language of a text, English always present. */
    const getT = (v: LText | undefined): string => (lang === 'fr' ? v?.fr : v?.en) || '';
    const setT = (v: LText | undefined, s: string): LText => {
        const base: LText = { ...(v || { en: '' }) };
        if (lang === 'fr') { if (s) base.fr = s; else delete base.fr; } else base.en = s;
        return base;
    };
    const ph = (v: LText | undefined, fallback: string): string => (lang === 'fr' && v?.en ? v.en : fallback);

    // ── header: save state + language ──
    const stateChip = el('span', 'bms-chip tcr-state');
    const langSeg = el('div', 'bms-seg tcr-lang');
    langSeg.setAttribute('role', 'group');
    langSeg.setAttribute('aria-label', t('tutc.lang'));
    const langBtns: Record<Lang, HTMLButtonElement> = {
        en: button('EN', 'bms-seg-btn', () => setLang('en')),
        fr: button('FR', 'bms-seg-btn', () => setLang('fr')),
    };
    langSeg.append(langBtns.en, langBtns.fr);
    const closeX = el('button', 'modal-close tcr-close') as HTMLButtonElement;
    closeX.type = 'button';
    closeX.setAttribute('aria-label', t('common.close'));
    closeX.innerHTML = uiIcon('close', 16);
    closeX.addEventListener('click', () => { void requestClose(); });
    const headEnd = document.createDocumentFragment();
    headEnd.append(stateChip, langSeg, closeX);
    const headWrap = el('div', 'tcr-head-end');
    headWrap.append(headEnd);

    // ── footer ──
    const issuesNote = el('span', 'modal-footer-note tcr-issues');
    const footStart = el('div', 'modal-footer-start');
    footStart.append(
        button(t('tutc.importDoc'), 'btn btn-ghost btn-sm', () => { void importDoc(); }, 'import'),
        button(t('tutc.exportDoc'), 'btn btn-ghost btn-sm', () => { void exportDoc(); }, 'export'),
        issuesNote,
    );
    const saveBtn = button(t('common.save'), 'btn btn-primary', () => { void save(); }, 'save');
    const footer = document.createDocumentFragment();
    footer.append(footStart, button(t('common.cancel'), 'btn btn-ghost', () => { void requestClose(); }), saveBtn);

    const body = el('div', 'tcr-grid');
    const side = el('div', 'tcr-side');
    const editor = el('div', 'tcr-editor');
    body.append(side, editor);

    handle = openModal({
        id: 'tutc',
        title: editId ? t('tutc.titleEdit') : t('tutc.titleNew'),
        subtitle: t('tutc.subtitle'),
        icon: uiIcon('edit', 20),
        size: 'xl',
        tall: true,
        className: 'tcr',
        body,
        footer,
        headerEnd: headWrap,
        // Not dismissible by the shell: a stray Escape or a click on the dim must not throw
        // away an unsaved lesson. The × and Escape go through requestClose, which asks.
        dismissible: false,
        onClose: () => document.removeEventListener('keydown', onKey),
    });
    handle.body.classList.add('modal-body--flush');
    // modals.ts closes the overlay of ANY clicked .modal-close by removing `.open`, before
    // requestClose could ask about unsaved work. This opts the creator out of that shortcut.
    handle.overlay.setAttribute('data-prevent-close', 'true');

    const onKey = (e: KeyboardEvent) => {
        if (!handle || topOverlay() !== handle.overlay || e.defaultPrevented) return;
        if (e.key === 'Escape') { e.preventDefault(); void requestClose(); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    };
    document.addEventListener('keydown', onKey);

    // ── state refresh without a repaint (typing must not lose the caret) ──
    let issues: Issue[] = [];
    const touched = () => {
        issues = validateDoc(doc);
        const d = dirty();
        stateChip.className = `bms-chip tcr-state${d ? ' bms-chip--warn' : lockedId ? ' bms-chip--ok' : ''}`;
        stateChip.textContent = d ? (lockedId ? t('tutc.state.unsaved') : t('tutc.state.new')) : t('tutc.state.saved');
        const blocking = issues.filter((i) => i.blocking).length;
        issuesNote.textContent = issues.length ? t('tutc.issues').replace('{n}', String(issues.length)) : t('tutc.noIssues');
        issuesNote.classList.toggle('is-bad', issues.length > 0);
        saveBtn.disabled = blocking > 0;
        saveBtn.title = blocking ? issueText(issues.find((i) => i.blocking)!) : '';
        // The step list's labels and marks follow the edits in place.
        side.querySelectorAll<HTMLElement>('.tcr-step-row').forEach((r, si) => {
            const st = part().steps[si];
            if (!st) return;
            const name = r.querySelector('.tcr-step-name');
            if (name) name.textContent = (st.title?.en || '').trim() || t('tutc.untitled');
            r.classList.toggle('has-issue', issuesOf(issues, partIdx, si).length > 0);
        });
        const list = editor.querySelector<HTMLElement>('.tcr-step-issues');
        if (list) fillStepIssues(list);
    };

    const issueText = (i: Issue): string => t(`tutc.issue.${i.code}`) + (i.detail ? `: ${i.detail}` : '');
    const fillStepIssues = (box: HTMLElement) => {
        box.textContent = '';
        const mine = issuesOf(issues, partIdx, stepIdx);
        box.hidden = !mine.length;
        for (const i of mine) {
            const li = el('li', '', issueText(i));
            li.prepend(uiIconEl('warning', 12));
            box.append(li);
        }
    };

    const setLang = (l: Lang) => { lang = l; paint(); };

    // ── painting ──
    const paint = () => {
        langBtns.en.setAttribute('aria-pressed', String(lang === 'en'));
        langBtns.fr.setAttribute('aria-pressed', String(lang === 'fr'));
        const sideScroll = side.scrollTop;
        side.textContent = '';
        side.append(metaCard(), partsBlock(), stepsBlock());
        side.scrollTop = sideScroll;
        editor.textContent = '';
        editor.append(stepEditor());
        touched();
    };

    const metaCard = (): HTMLElement => {
        const card = el('section', 'tcr-card');
        card.append(el('h3', 'tcr-card-title', t('tutc.about')));
        card.append(field(t('tutc.name'), input(getT(doc.title), ph(doc.title, t('tutc.namePh')), (v) => { doc.title = setT(doc.title, v); touched(); })));
        const desc = document.createElement('textarea');
        desc.className = 'input tcr-textarea';
        desc.rows = 2;
        desc.value = getT(doc.desc);
        desc.placeholder = ph(doc.desc, t('tutc.descPh'));
        desc.addEventListener('input', () => { doc.desc = setT(doc.desc, desc.value); touched(); });
        card.append(field(t('tutc.desc'), desc));

        const row = el('div', 'tcr-row3');
        row.append(field(t('tutc.level'), select([
            ['1', t('hub.level.1')], ['2', t('hub.level.2')], ['3', t('hub.level.3')],
        ], String(doc.level || 1), (v) => { doc.level = Number(v) as 1 | 2 | 3; touched(); })));
        const color = document.createElement('input');
        color.type = 'color';
        color.className = 'tcr-color';
        color.value = /^#[0-9a-fA-F]{6}$/.test(doc.color || '') ? (doc.color as string) : '#8b5cf6';
        color.addEventListener('input', () => { doc.color = color.value; touched(); });
        row.append(field(t('tutc.color'), color));
        const iconBtn = el('button', 'btn btn-ghost btn-sm tcr-iconbtn') as HTMLButtonElement;
        iconBtn.type = 'button';
        const paintIcon = () => {
            iconBtn.textContent = '';
            if (isPackIcon(doc.icon)) iconBtn.insertAdjacentHTML('afterbegin', renderPackIcon(doc.icon as string, 16));
            else iconBtn.append(uiIconEl('image', 14));
            iconBtn.append(el('span', '', doc.icon ? t('tutc.iconChange') : t('tutc.iconPick')));
        };
        iconBtn.addEventListener('click', async () => {
            const ref = await openIconPicker({ current: doc.icon });
            if (ref == null) return;
            doc.icon = ref || undefined;
            paintIcon();
            touched();
        });
        paintIcon();
        row.append(field(t('tutc.icon'), iconBtn));
        card.append(row);

        const idField = input(doc.id, 'my-tutorial', (v) => { doc.id = v.trim(); touched(); });
        // The id becomes the FILENAME and the progress key. Changing it on an edit would fork
        // the tutorial rather than rename it, so it locks once the document exists.
        if (lockedId) { idField.disabled = true; idField.title = t('tutc.idLocked'); }
        card.append(field(t('tutc.id'), idField, lockedId ? t('tutc.idLocked') : t('tutc.idHint')));
        return card;
    };

    const partsBlock = (): HTMLElement => {
        const box = el('section', 'tcr-card');
        const head = el('div', 'tcr-card-head');
        head.append(el('h3', 'tcr-card-title', t('tutc.parts')));
        head.append(button(t('tutc.addPart'), 'btn btn-ghost btn-xs', () => {
            const n = doc.parts.length + 1;
            let id = `part-${n}`;
            for (let k = n; doc.parts.some((p) => p.id === id); k++) id = `part-${k + 1}`;
            doc.parts.push({ id, title: { en: `${t('tutc.partN')} ${n}` }, steps: [blankStep('step-1')] });
            partIdx = doc.parts.length - 1;
            stepIdx = 0;
            paint();
        }, 'add'));
        box.append(head);

        const tabs = el('div', 'bms-tabs tcr-parts');
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', t('tutc.parts'));
        doc.parts.forEach((p, i) => {
            const b = el('button', 'bms-tab', (p.title?.en || '').trim() || p.id) as HTMLButtonElement;
            b.type = 'button';
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(i === partIdx));
            b.addEventListener('click', () => { partIdx = i; stepIdx = 0; paint(); });
            tabs.append(b);
        });
        box.append(tabs);

        const p = part();
        const row = el('div', 'tcr-part-row');
        row.append(field(t('tutc.partName'), input(getT(p.title), ph(p.title, ''), (v) => {
            p.title = setT(p.title, v);
            const tab = tabs.querySelectorAll<HTMLElement>('.bms-tab')[partIdx];
            if (tab) tab.textContent = (p.title.en || '').trim() || p.id;
            touched();
        })));
        if (doc.parts.length > 1) {
            row.append(button(t('tutc.removePart'), 'btn btn-ghost btn-sm tcr-danger', () => { void removePart(); }, 'delete', true));
        }
        box.append(row);
        return box;
    };

    const stepsBlock = (): HTMLElement => {
        const box = el('section', 'tcr-card tcr-steps-card');
        const head = el('div', 'tcr-card-head');
        head.append(el('h3', 'tcr-card-title', t('tutc.steps')));
        head.append(el('span', 'tcr-hint', t('tutc.reorderHint')));
        box.append(head);

        const p = part();
        const ol = el('ol', 'tcr-steps');
        ol.setAttribute('role', 'listbox');
        ol.setAttribute('aria-label', t('tutc.steps'));
        let dragFrom = -1;
        p.steps.forEach((st, si) => {
            const li = el('li', `tcr-step-row${si === stepIdx ? ' is-on' : ''}`);
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', String(si === stepIdx));
            li.tabIndex = si === stepIdx ? 0 : -1;
            li.draggable = true;
            const grip = el('span', 'tcr-grip');
            grip.append(uiIconEl('grip', 14));
            grip.setAttribute('aria-hidden', 'true');
            li.append(grip, el('span', 'tcr-step-n', String(si + 1)));
            li.append(el('span', 'tcr-step-name', (st.title?.en || '').trim() || t('tutc.untitled')));
            const marks = el('span', 'tcr-step-marks');
            if (st.nav) marks.append(mark('home', viewLabel(st.nav)));
            if (st.selector) marks.append(mark('eye', st.selector));
            if (st.wait || st.action) marks.append(mark('clock', t('tutc.marks.waits')));
            li.append(marks);
            const warn = el('span', 'tcr-step-warn');
            warn.append(uiIconEl('warning', 12));
            warn.setAttribute('aria-hidden', 'true');
            li.append(warn);
            li.addEventListener('click', () => { stepIdx = si; paint(); focusStep(); });
            li.addEventListener('dragstart', (e) => {
                dragFrom = si;
                li.classList.add('is-dragging');
                e.dataTransfer?.setData('text/plain', String(si));
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            });
            li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
            li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('is-drop'); });
            li.addEventListener('dragleave', () => li.classList.remove('is-drop'));
            li.addEventListener('drop', (e) => {
                e.preventDefault();
                li.classList.remove('is-drop');
                if (dragFrom < 0 || dragFrom === si) return;
                const moved = moveItem(p.steps, dragFrom, si);
                if (stepIdx === dragFrom) stepIdx = moved;
                dragFrom = -1;
                paint();
            });
            ol.append(li);
        });
        ol.addEventListener('keydown', (e) => {
            const n = p.steps.length;
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End')) {
                e.preventDefault();
                const to = e.key === 'ArrowUp' ? stepIdx - 1 : e.key === 'ArrowDown' ? stepIdx + 1 : e.key === 'Home' ? 0 : n - 1;
                stepIdx = moveItem(p.steps, stepIdx, to);
                paint();
                focusStep();
                announce(t('tutc.movedTo').replace('{n}', String(stepIdx + 1)));
                return;
            }
            let to = -1;
            if (e.key === 'ArrowDown') to = Math.min(n - 1, stepIdx + 1);
            else if (e.key === 'ArrowUp') to = Math.max(0, stepIdx - 1);
            else if (e.key === 'Home') to = 0;
            else if (e.key === 'End') to = n - 1;
            if (to < 0 || to === stepIdx) return;
            e.preventDefault();
            stepIdx = to;
            paint();
            focusStep();
        });
        box.append(ol);

        const tools = el('div', 'bms-toolbar tcr-step-tools');
        tools.append(
            button(t('tutc.addStep'), 'btn btn-secondary btn-sm', () => {
                p.steps.splice(stepIdx + 1, 0, blankStep(freeStepId(p.steps.map((s) => s.id))));
                stepIdx += 1;
                paint();
                editor.querySelector<HTMLInputElement>('.tcr-step-title')?.focus();
            }, 'add'),
            button(t('tutc.duplicate'), 'btn btn-ghost btn-sm', () => {
                const copy: Step = JSON.parse(JSON.stringify(step()));
                copy.id = freeStepId(p.steps.map((s) => s.id));
                p.steps.splice(stepIdx + 1, 0, copy);
                stepIdx += 1;
                paint();
            }, 'copy'),
            button(t('tutc.moveUp'), 'btn btn-ghost btn-sm', () => { stepIdx = moveItem(p.steps, stepIdx, stepIdx - 1); paint(); }, 'move-up', true),
            button(t('tutc.moveDown'), 'btn btn-ghost btn-sm', () => { stepIdx = moveItem(p.steps, stepIdx, stepIdx + 1); paint(); }, 'move-down', true),
        );
        if (p.steps.length > 1) {
            tools.append(button(t('tutc.removeStep'), 'btn btn-ghost btn-sm tcr-danger', () => {
                p.steps.splice(stepIdx, 1);
                stepIdx = Math.max(0, stepIdx - 1);
                paint();
            }, 'delete', true));
        }
        box.append(tools);
        const live = el('div', 'tcr-sr');
        live.setAttribute('aria-live', 'polite');
        box.append(live);
        return box;
    };

    const mark = (icon: IconName, title: string): HTMLElement => {
        const m = el('span', 'tcr-mark');
        m.title = title;
        m.append(uiIconEl(icon, 12));
        return m;
    };
    const focusStep = () => requestAnimationFrame(() => side.querySelector<HTMLElement>('.tcr-step-row.is-on')?.focus());
    const announce = (msg: string) => { const n = side.querySelector('.tcr-sr'); if (n) n.textContent = msg; };

    // ── the step editor ──
    const stepEditor = (): HTMLElement => {
        const st = step();
        const box = el('div', 'tcr-step-editor');

        const head = el('div', 'tcr-ed-head');
        head.append(el('h3', 'tcr-card-title', t('tutc.stepN').replace('{n}', String(stepIdx + 1)).replace('{total}', String(part().steps.length))));
        head.append(button(t('tutc.preview'), 'btn btn-secondary btn-sm', () => { void preview(); }, 'play'));
        box.append(head);

        const issuesBox = el('ul', 'tcr-step-issues');
        box.append(issuesBox);

        // What it says.
        box.append(field(t('tutc.stepTitle'), input(getT(st.title), ph(st.title, ''), (v) => { st.title = setT(st.title, v); touched(); }, 'input input-sm tcr-step-title')));
        const text = document.createElement('textarea');
        text.className = 'input tcr-textarea tcr-step-text';
        text.rows = 5;
        text.value = getT(st.text);
        text.placeholder = ph(st.text, '');
        text.addEventListener('input', () => { st.text = setT(st.text, text.value); touched(); });
        box.append(field(t('tutc.stepTextLbl'), text, t('tutc.stepText')));

        // Where it points.
        const where = el('section', 'tcr-card');
        where.append(el('h4', 'tcr-sub', t('tutc.where')));
        where.append(field(t('tutc.page'), select(
            [['', t('tutc.navNone')], ...VIEWS.map((v) => [v, viewLabel(v)] as [string, string])],
            st.nav || '', (v) => { st.nav = v || undefined; touched(); },
        )));
        where.append(targetField(t('tutc.target'), st.selector || '', (v) => { st.selector = v || undefined; touched(); }));
        const style = el('div', 'bms-seg tcr-style');
        style.setAttribute('role', 'group');
        style.setAttribute('aria-label', t('tutc.style'));
        const spot = button(t('tutc.style.spot'), 'bms-seg-btn', () => { delete st.dim; sync(); touched(); });
        const ring = button(t('tutc.style.ring'), 'bms-seg-btn', () => { st.dim = false; sync(); touched(); });
        const sync = () => { spot.setAttribute('aria-pressed', String(st.dim !== false)); ring.setAttribute('aria-pressed', String(st.dim === false)); };
        sync();
        style.append(spot, ring);
        where.append(field(t('tutc.style'), style, t('tutc.styleHint')));
        box.append(where);

        // What it waits for.
        box.append(waitBlock(st));

        const opt = el('label', 'tcr-check');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!st.optional;
        cb.addEventListener('change', () => { st.optional = cb.checked || undefined; touched(); });
        opt.append(cb, el('span', '', t('tutc.optional')));
        box.append(opt);

        fillStepIssues(issuesBox);
        return box;
    };

    /** An element field: the selector, Pick, Show, and a live verdict on this screen. */
    const targetField = (label: string, value: string, onSet: (v: string) => void): HTMLElement => {
        const wrap = el('div', 'tcr-target');
        const row = el('div', 'tcr-target-row');
        const i = input(value, t('tutc.selectorPh'), (v) => { onSet(v.trim()); verdict(); }, 'input input-sm tcr-target-input');
        const status = el('div', 'tcr-target-status');
        status.setAttribute('aria-live', 'polite');
        const verdict = () => {
            const q = i.value.trim();
            status.className = 'tcr-target-status';
            status.textContent = '';
            if (!q) { status.textContent = t('tutc.target.none'); return; }
            if (!selectorSyntaxOk(q)) { status.classList.add('is-bad'); status.textContent = t('tutc.target.invalid'); return; }
            const n = resolveTargets(q).filter((x) => !x.closest('#tutc')).length;
            if (n) { status.classList.add('is-ok'); status.textContent = t('tutc.target.found').replace('{n}', String(n)); }
            else { status.classList.add('is-warn'); status.textContent = t('tutc.target.missing'); }
        };
        row.append(i,
            button(t('tutc.pick'), 'btn btn-ghost btn-sm', async () => {
                const res = await withDialogsHidden(() => pickElement(t('tutc.pickHint'), t('tutc.pickCancel')));
                if (!res) return;
                i.value = res.selector;
                onSet(res.selector);
                verdict();
                // A positional path is not refused (sometimes it is the only handle there is),
                // but it is the one that breaks on someone else's screen, so it says so.
                toast(res.quality === 'positional' ? t('tutc.pickWeak') : t('tutc.pickOk'), res.quality === 'positional' ? 'warning' : 'success');
            }, 'pin'),
            button(t('tutc.test'), 'btn btn-ghost btn-sm', () => {
                const q = i.value.trim();
                const node = q ? resolveTargets(q).find((x) => !x.closest('#tutc')) as HTMLElement | undefined : undefined;
                if (!node) { toast(t('tutc.testMiss'), 'warning'); return; }
                void withDialogsHidden(async () => {
                    const prev = node.style.outline;
                    node.style.outline = '3px solid var(--bmm-accent)';
                    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await new Promise((r) => setTimeout(r, 1200));
                    node.style.outline = prev;
                });
            }, 'eye'),
        );
        wrap.append(row, status);
        verdict();
        return field(label, wrap, t('tutc.testTip'));
    };

    const waitBlock = (st: Step): HTMLElement => {
        const box = el('section', 'tcr-card');
        box.append(el('h4', 'tcr-sub', t('tutc.actLabel')));
        // The older `action` spelling reads as a wait of kind 'action'.
        const w: Wait | null = st.wait || (st.action?.event ? { kind: 'action', event: st.action.event, desc: st.action.desc } : null);
        const kinds: Array<[string, string]> = [
            ['', t('tutc.wait.none')], ['action', t('tutc.wait.action')], ['click', t('tutc.wait.click')],
            ['appear', t('tutc.wait.appear')], ['disappear', t('tutc.wait.disappear')], ['view', t('tutc.wait.view')],
            ['text', t('tutc.wait.text')], ['value', t('tutc.wait.value')], ['enabled', t('tutc.wait.enabled')],
            ['custom', t('tutc.wait.custom')],
        ];
        box.append(field(t('tutc.wait.kind'), select(kinds, w?.kind || '', (k) => {
            // The old `action` field is cleared whenever `wait` takes over, so a document never
            // carries two answers to one question.
            st.action = undefined;
            st.wait = k ? { kind: k as Wait['kind'], desc: w?.desc } : undefined;
            paint();
        })));
        if (!w) return box;

        if (w.kind === 'action') {
            const opts = Object.entries(BMM_ACTIONS).map(([name, ev]) => [ev, t(`tutc.act.${name}`)] as [string, string]);
            // A select with nothing chosen still SHOWS its first option, so a step left untouched
            // would silently wait on whatever happened to be first.
            if (!w.event) st.wait = { ...w, event: opts[0][0] };
            box.append(field(t('tutc.wait.which'), select(opts, st.wait?.event || '', (v) => { st.wait = { ...(st.wait as Wait), event: v }; touched(); })));
        }
        if (['click', 'appear', 'disappear', 'text', 'value', 'enabled'].includes(w.kind)) {
            box.append(targetField(t('tutc.wait.selector'), w.selector || '', (v) => { st.wait = { ...(st.wait as Wait), selector: v || undefined }; touched(); }));
        }
        if (w.kind === 'text' || w.kind === 'value') {
            box.append(field(t(w.kind === 'value' ? 'tutc.wait.valueLbl' : 'tutc.wait.textLbl'),
                input(w.text || '', t('tutc.wait.textPh'), (v) => { st.wait = { ...(st.wait as Wait), text: v || undefined }; touched(); })));
        }
        if (w.kind === 'view') {
            if (!w.view) st.wait = { ...w, view: VIEWS[0] };
            box.append(field(t('tutc.wait.which'), select(VIEWS.map((v) => [v, viewLabel(v)] as [string, string]), st.wait?.view || VIEWS[0],
                (v) => { st.wait = { ...(st.wait as Wait), view: v }; touched(); })));
        }
        if (w.kind === 'custom') {
            // Parsed, not eval'd, so the parser can say exactly what is wrong — an author finding
            // out now beats a reader pressing Next on a step that never unlocks.
            const msg = el('div', 'tcr-hint');
            const validate = (v: string) => {
                if (!v.trim()) { msg.textContent = t('tutc.wait.exprHelp'); msg.classList.remove('is-bad'); return; }
                const r = checkCondition(v);
                msg.textContent = r.ok ? t('tutc.wait.exprOk') : r.error;
                msg.classList.toggle('is-bad', !r.ok);
            };
            box.append(field(t('tutc.wait.exprLbl'), input(w.expr || '', t('tutc.wait.exprPh'), (v) => {
                st.wait = { ...(st.wait as Wait), expr: v || undefined };
                validate(v);
                touched();
            })), msg);
            validate(w.expr || '');
        }
        box.append(field(t('tutc.wait.desc'), input(getT(w.desc), ph(w.desc, t('tutc.wait.descPh')), (v) => {
            st.wait = { ...(st.wait as Wait), desc: setT(st.wait?.desc, v) };
            touched();
        })));
        return box;
    };

    // ── actions ──
    async function removePart(): Promise<void> {
        const { showConfirm } = await import('./confirm.js');
        if (!(await showConfirm(t('tutc.removePart'), t('tutc.removePartAsk').replace('{name}', part().title?.en || part().id), true))) return;
        doc.parts.splice(partIdx, 1);
        partIdx = Math.max(0, partIdx - 1);
        stepIdx = 0;
        paint();
    }

    async function save(): Promise<void> {
        const blocking = validateDoc(doc).find((i) => i.blocking);
        if (blocking) { toast(issueText(blocking), 'warning'); return; }
        try {
            await saveCustomTutorial(doc);
            saved = JSON.stringify(doc);
            lockedId = doc.id;
            const title = handle?.header.querySelector('.modal-title');
            if (title) title.textContent = t('tutc.titleEdit');
            toast(t('tutc.saved'), 'success');
            paint();
            onSaved();
        } catch (e) {
            toast(String(e), 'error');
        }
    }

    async function requestClose(): Promise<void> {
        if (dirty()) {
            const { showConfirm } = await import('./confirm.js');
            if (!(await showConfirm(t('tutc.discardTitle'), t('tutc.discardText'), true))) return;
        }
        handle?.close();
    }

    async function importDoc(): Promise<void> {
        const path = await pickFile([{ name: 'BMM tutorial', extensions: ['bmmtut', 'json'] }]);
        if (!path) return;
        let next: Doc | null = null;
        try { next = parseBmmtut((await invoke('read_file_text', { path })) as string); } catch { next = null; }
        if (!next) { toast(t('tutc.importBad'), 'error'); return; }
        if (dirty()) {
            const { showConfirm } = await import('./confirm.js');
            if (!(await showConfirm(t('tutc.importDoc'), t('tutc.importReplace'), true))) return;
        }
        delete (next as { bmm_signature?: unknown }).bmm_signature;
        // Into the editor, not into the store: nothing is saved until Save. A different id is a
        // different tutorial, so the lock is released.
        if (next.id !== lockedId) lockedId = null;
        if (!idOk(next.id || '')) next.id = blankDoc().id;
        doc = next;
        partIdx = 0;
        stepIdx = 0;
        paint();
        toast(t('tutc.imported'), 'success');
    }

    async function exportDoc(): Promise<void> {
        const path = await saveFile({ defaultPath: `${doc.id || 'tutorial'}.bmmtut`, filters: [{ name: 'BMM tutorial', extensions: ['bmmtut'] }] });
        if (!path) return;
        try {
            await invoke('write_text_file', { path, content: JSON.stringify(doc, null, 2) });
            toast(dirty() || !lockedId ? t('tutc.exportedDraft') : t('tuthub.exported'), 'success');
        } catch (e) { toast(String(e), 'error'); }
    }

    /** Run the selected step in the real engine, over the real app, then come back here. */
    async function preview(): Promise<void> {
        const st = step();
        const pid = '__preview';
        const one: Doc = {
            format: 'bmmtut', id: pid, title: doc.title, color: doc.color,
            parts: [{ id: 'p', title: part().title, steps: [JSON.parse(JSON.stringify(st))] }],
        };
        const { startTutorialEngine } = await import('./tutorial-engine.js');
        const { resetTutorial } = await import('./tutorial-store.js');
        const def = toDef(one);
        armWatchers(one);
        await withDialogsHidden(() => new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearInterval(poll);
                disarmWatchers();
                resetTutorial(def.id);
                resolve();
            };
            startTutorialEngine(def, null, null, finish);
            // The X ends a lesson without the callback (it means "stop"), so the panel going
            // away is the signal — the creator must come back however the preview ended.
            const poll = setInterval(() => {
                if (!document.getElementById('tut-engine-panel')) finish();
            }, 300);
        }));
        handle?.body.querySelector<HTMLElement>('.tcr-step-editor .btn-secondary')?.focus();
    }

    paint();
}
