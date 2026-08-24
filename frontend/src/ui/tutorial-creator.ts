// The tutorial creator: build a .bmmtut without touching JSON.
//
// SHAPE OF THE EDITOR
//
// One panel, three zones: the tutorial's own facts (id, title, colour), the part list, and
// the selected part's steps. A step edits in place — title, text, the view it navigates to,
// the element it highlights, the action it waits for. Everything writes into one document
// object and Save hands that to the backend, which validates, signs and stores it; the same
// document is what Export shares. There is no second representation to drift.
//
// WHAT MAKES A CREATED TUTORIAL EQUAL TO AN OFFICIAL ONE
//
// Nothing here is a lesser format. The document maps 1:1 onto TutorialDef (via
// tutorial-custom.toDef), so navigation, highlighting, multi-selector spotlights, optional
// steps and action-gated steps — the whole engine vocabulary — are all expressible. The two
// deliberate exceptions: text is sanitised to formatting tags (a shared file must not script
// the app), and the icon is fixed (arbitrary SVG in innerHTML is the same problem again).
//
// THE "TEST" BUTTON
//
// A selector typed by hand is a guess; the button flashes the element it matches right now,
// or says plainly that nothing matches. Authors will run BMM on a different screen state
// than their readers — this does not prove the tutorial, it catches typos, and the label
// says which.

import { invoke } from '../core/api.js';
import { checkCondition } from './tutorial-expr.js';
import { t } from '../core/i18n.js';
import { toast } from './app.js';
import { getCustomDoc, type CustomTutorialDoc } from './tutorial-custom.js';
import { BMM_ACTIONS } from './tutorial-events.js';
import { pickElement } from './tutorial-pick.js';

const VIEWS = ['library', 'profiles', 'modlist', 'repo', 'mapper', 'plugins', 'apps', 'community', 'modpacks', 'docs', 'settings'];

type Doc = CustomTutorialDoc;

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

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

function blankDoc(): Doc {
    return {
        format: 'bmmtut',
        version: 1,
        id: `tut-${Math.random().toString(36).slice(2, 8)}`,
        title: { en: '' },
        desc: { en: '' },
        color: '#8b5cf6',
        parts: [{ id: 'part-1', title: { en: 'Part 1' }, steps: [{ id: 'step-1', title: { en: '' }, text: { en: '' } }] }],
    };
}

export function openTutorialCreator(editId: string | null, onSaved: () => void): void {
    document.querySelectorAll('.tutc-overlay').forEach((n) => n.remove());

    // Edited as a deep copy: Cancel must leave the stored document exactly as it was, and
    // the loaded cache in tutorial-custom is the same object the hub renders from.
    const doc: Doc = editId
        ? JSON.parse(JSON.stringify(getCustomDoc(editId) || blankDoc()))
        : blankDoc();
    let partIdx = 0;

    const overlay = el('div', 'modal-overlay tutc-overlay open');
    const panel = el('div', 'tutc-panel');
    overlay.append(panel);

    const paint = () => {
        panel.textContent = '';

        // ── head ──
        const head = el('div', 'tutc-head');
        head.append(el('h2', 'tutc-title', editId ? t('tutc.titleEdit') : t('tutc.titleNew')));
        const close = el('button', 'modal-close');
        close.setAttribute('type', 'button');
        close.textContent = '×';
        close.addEventListener('click', () => overlay.remove());
        head.append(close);
        panel.append(head);

        // ── the tutorial's own facts ──
        const meta = el('div', 'tutc-meta');
        const idField = input(doc.id, 'id (a-z, 0-9, -)', (v) => { doc.id = v; });
        // The id becomes the FILENAME and the progress key. Changing it on an edit forks
        // the tutorial rather than renaming it, so it locks once the document exists.
        if (editId) { idField.disabled = true; idField.title = t('tutc.idLocked'); }
        meta.append(labelled(t('tutc.id'), idField));
        meta.append(labelled(t('tutc.name'), input(doc.title.en, 'My tutorial', (v) => { doc.title.en = v; })));
        meta.append(labelled(t('tutc.nameFr'), input(doc.title.fr || '', '(optionnel)', (v) => { doc.title.fr = v || undefined; })));
        meta.append(labelled(t('tutc.desc'), input(doc.desc?.en || '', '', (v) => { doc.desc = { ...(doc.desc || { en: '' }), en: v }; })));
        const color = document.createElement('input');
        color.type = 'color';
        color.className = 'tutc-color';
        color.value = /^#/.test(doc.color || '') ? (doc.color as string) : '#8b5cf6';
        color.addEventListener('input', () => { doc.color = color.value; });
        meta.append(labelled(t('tutc.color'), color));
        panel.append(meta);

        // ── parts rail ──
        const rail = el('div', 'tutc-parts');
        doc.parts.forEach((p, i) => {
            const b = el('button', 'tutc-part-chip' + (i === partIdx ? ' on' : ''), p.title?.en || p.id);
            b.setAttribute('type', 'button');
            b.addEventListener('click', () => { partIdx = i; paint(); });
            rail.append(b);
        });
        const addP = el('button', 'tutc-part-chip tutc-add', `+ ${t('tutc.addPart')}`);
        addP.setAttribute('type', 'button');
        addP.addEventListener('click', () => {
            doc.parts.push({ id: `part-${doc.parts.length + 1}`, title: { en: `Part ${doc.parts.length + 1}` }, steps: [{ id: 'step-1', title: { en: '' }, text: { en: '' } }] });
            partIdx = doc.parts.length - 1;
            paint();
        });
        rail.append(addP);
        panel.append(rail);

        // ── selected part ──
        const part = doc.parts[partIdx];
        const pHead = el('div', 'tutc-part-head');
        pHead.append(labelled(t('tutc.partName'), input(part.title?.en || '', '', (v) => { part.title = { ...(part.title || { en: '' }), en: v }; })));
        if (doc.parts.length > 1) {
            const del = el('button', 'btn btn-ghost btn-sm', t('tutc.removePart'));
            del.setAttribute('type', 'button');
            del.addEventListener('click', () => { doc.parts.splice(partIdx, 1); partIdx = Math.max(0, partIdx - 1); paint(); });
            pHead.append(del);
        }
        panel.append(pHead);

        const steps = el('div', 'tutc-steps');
        part.steps.forEach((st, si) => steps.append(stepEditor(part, st, si, paint)));
        const addS = el('button', 'btn btn-secondary btn-sm', `+ ${t('tutc.addStep')}`);
        addS.setAttribute('type', 'button');
        addS.addEventListener('click', () => {
            part.steps.push({ id: `step-${part.steps.length + 1}`, title: { en: '' }, text: { en: '' } });
            paint();
        });
        steps.append(addS);
        panel.append(steps);

        // ── foot ──
        const foot = el('div', 'tutc-foot');
        foot.append(el('span', 'tutc-hint', t('tutc.tagsHint')));
        const save = el('button', 'btn btn-primary', t('common.save'));
        save.setAttribute('type', 'button');
        save.addEventListener('click', async () => {
            if (!doc.title.en.trim()) { toast(t('tutc.needName'), 'warning'); return; }
            try {
                await invoke('tutorial_custom_save', { doc });
                toast(t('tutc.saved'), 'success');
                overlay.remove();
                onSaved();
            } catch (e) {
                toast(String(e), 'error');
            }
        });
        foot.append(save);
        panel.append(foot);
    };

    // Same order as the catalogue beside it: attached, then painted. Nothing here looks
    // itself up by id today, but the two dialogs are read together and one of them having the
    // safe order is not a property worth relying on.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    (document.getElementById('app-window-outer') || document.body).append(overlay);
    paint();
}

function labelled(label: string, field: HTMLElement): HTMLElement {
    const wrap = el('label', 'tutc-field');
    wrap.append(el('span', 'tutc-label', label));
    wrap.append(field);
    return wrap;
}

function stepEditor(part: Doc['parts'][0], st: Doc['parts'][0]['steps'][0], si: number, repaint: () => void): HTMLElement {
    const box = el('div', 'tutc-step');
    const head = el('div', 'tutc-step-head');
    head.append(el('span', 'tutc-step-n', String(si + 1)));
    head.append(input(st.title?.en || '', t('tutc.stepTitle'), (v) => { st.title = { ...(st.title || { en: '' }), en: v }; }, 'input input-sm tutc-step-title'));
    if (part.steps.length > 1) {
        const del = el('button', 'tutc-step-del', '×');
        del.setAttribute('type', 'button');
        del.title = t('tutc.removeStep');
        del.addEventListener('click', () => { part.steps.splice(si, 1); repaint(); });
        head.append(del);
    }
    box.append(head);

    const text = document.createElement('textarea');
    text.className = 'input tutc-step-text';
    text.rows = 3;
    text.placeholder = t('tutc.stepText');
    text.value = st.text?.en || '';
    text.addEventListener('input', () => { st.text = { ...(st.text || { en: '' }), en: text.value }; });
    box.append(text);

    const row = el('div', 'tutc-step-row');
    // Which view the step opens. Empty = stay where the reader is.
    const nav = document.createElement('select');
    nav.className = 'input input-sm';
    const optNone = document.createElement('option');
    optNone.value = ''; optNone.textContent = t('tutc.navNone');
    nav.append(optNone);
    for (const v of VIEWS) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        if (st.nav === v) o.selected = true;
        nav.append(o);
    }
    nav.addEventListener('change', () => { st.nav = nav.value || undefined; });
    row.append(nav);

    const sel = input(st.selector || '', t('tutc.selectorPh'), (v) => { st.selector = v || undefined; });
    row.append(sel);

    // Point at the thing instead of describing it. The panel hides while picking — the
    // element being pointed at is usually behind this dialog, and a picker you have to close
    // the editor to use is a picker nobody reaches for.
    const pick = el('button', 'btn btn-ghost btn-sm', t('tutc.pick'));
    pick.setAttribute('type', 'button');
    pick.title = t('tutc.pickTip');
    pick.addEventListener('click', async () => {
        const overlay = box.closest('.tutc-overlay') as HTMLElement | null;
        if (overlay) overlay.style.visibility = 'hidden';
        const res = await pickElement(t('tutc.pickHint'), t('tutc.pickCancel'));
        if (overlay) overlay.style.visibility = '';
        if (!res) return;
        sel.value = res.selector;
        st.selector = res.selector;
        // A positional path is not refused — sometimes it is the only handle there is — but
        // the one weak answer says so, because it is the one that breaks on someone else's
        // screen and the author is the only person who can judge that.
        toast(res.quality === 'positional' ? t('tutc.pickWeak') : t('tutc.pickOk'),
            res.quality === 'positional' ? 'warning' : 'success');
    });
    row.append(pick);
    const test = el('button', 'btn btn-ghost btn-sm', t('tutc.test'));
    test.setAttribute('type', 'button');
    test.title = t('tutc.testTip');
    test.addEventListener('click', () => {
        const q = sel.value.trim();
        if (!q) return;
        let node: Element | null = null;
        try { node = document.querySelector(q.startsWith('#') || q.startsWith('.') ? q : `#${q}`); } catch { node = null; }
        if (!node) { toast(t('tutc.testMiss'), 'warning'); return; }
        // A 1.2s outline, then gone — enough to see WHICH element, without leaving state.
        const h = node as HTMLElement;
        const prev = h.style.outline;
        h.style.outline = '3px solid var(--accent)';
        h.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { h.style.outline = prev; }, 1200);
    });
    row.append(test);
    box.append(row);

    // ── what the step waits for ──
    //
    // Five kinds, not one. The app's own announced moments are a short list that only grows
    // by editing the feature being taught; the other four are OBSERVED — a click, an element
    // appearing or going away, a view opening — so a lesson can gate on anything visible
    // without anybody instrumenting it first.
    const w = st.wait || (st.action?.event ? { kind: 'action' as const, event: st.action.event, desc: st.action.desc } : null);
    const kindSel = document.createElement('select');
    kindSel.className = 'input input-sm';
    for (const [v, label] of [
        ['', t('tutc.wait.none')],
        ['action', t('tutc.wait.action')],
        ['click', t('tutc.wait.click')],
        ['appear', t('tutc.wait.appear')],
        ['disappear', t('tutc.wait.disappear')],
        ['view', t('tutc.wait.view')],
        ['text', t('tutc.wait.text')],
        ['value', t('tutc.wait.value')],
        ['enabled', t('tutc.wait.enabled')],
        ['custom', t('tutc.wait.custom')],
    ] as const) {
        const o = document.createElement('option');
        o.value = v; o.textContent = label;
        if ((w?.kind || '') === v) o.selected = true;
        kindSel.append(o);
    }
    kindSel.addEventListener('change', () => {
        const k = kindSel.value;
        // The old `action` field is cleared whenever `wait` takes over, so a document never
        // carries two answers to one question — the reader would have to guess which wins.
        st.action = undefined;
        st.wait = k ? { kind: k as never, desc: w?.desc } : undefined;
        repaint();
    });
    box.append(labelled(t('tutc.actLabel'), kindSel));

    if (w?.kind === 'action') {
        const act = document.createElement('select');
        act.className = 'input input-sm';
        for (const [name, event] of Object.entries(BMM_ACTIONS)) {
            const o = document.createElement('option');
            o.value = event as string;
            o.textContent = name.toLowerCase().replace(/_/g, ' ');
            if (w.event === event) o.selected = true;
            act.append(o);
        }
        // A select with nothing chosen still SHOWS its first option, so a step left untouched
        // would silently wait on whatever happened to be first in the registry.
        if (!w.event) st.wait = { ...w, event: act.value };
        act.addEventListener('change', () => { st.wait = { ...(st.wait || { kind: 'action' }), event: act.value }; });
        box.append(labelled(t('tutc.wait.which'), act));
    }

    if (w && (w.kind === 'click' || w.kind === 'appear' || w.kind === 'disappear'
        || w.kind === 'text' || w.kind === 'value' || w.kind === 'enabled')) {
        const wrow = el('div', 'tutc-step-row');
        const wsel = input(w.selector || '', t('tutc.selectorPh'), (v) => {
            st.wait = { ...(st.wait || { kind: w.kind }), selector: v || undefined };
        });
        wrow.append(wsel);
        const wpick = el('button', 'btn btn-ghost btn-sm', t('tutc.pick'));
        wpick.setAttribute('type', 'button');
        wpick.addEventListener('click', async () => {
            const overlay = box.closest('.tutc-overlay') as HTMLElement | null;
            if (overlay) overlay.style.visibility = 'hidden';
            const res = await pickElement(t('tutc.pickHint'), t('tutc.pickCancel'));
            if (overlay) overlay.style.visibility = '';
            if (!res) return;
            wsel.value = res.selector;
            st.wait = { ...(st.wait || { kind: w.kind }), selector: res.selector };
        });
        wrow.append(wpick);
        box.append(labelled(t('tutc.wait.selector'), wrow));
    }

    // The text to wait for. Empty is meaningful and the hint says so: for a value it means
    // "anything at all", which is what "until the box is filled in" actually is.
    if (w && (w.kind === 'text' || w.kind === 'value')) {
        const ti = input(w.text || '', t('tutc.wait.textPh'), (v) => {
            st.wait = { ...(st.wait || { kind: w.kind }), text: v || undefined };
        });
        box.append(labelled(t(w.kind === 'value' ? 'tutc.wait.valueLbl' : 'tutc.wait.textLbl'), ti));
    }

    if (w?.kind === 'custom') {
        // Checked as it is typed. The condition is parsed, not eval'd, so the parser can say
        // exactly what is wrong — and an author finding out at authoring time beats a reader
        // finding out by pressing Next on a step that never unlocks.
        const msg = el('div', 'tutc-hint', '');
        const validate = (v: string) => {
            if (!v.trim()) { msg.textContent = t('tutc.wait.exprHelp'); msg.classList.remove('is-bad'); return; }
            const r = checkCondition(v);
            msg.textContent = r.ok ? t('tutc.wait.exprOk') : r.error;
            msg.classList.toggle('is-bad', !r.ok);
        };
        const ex = input(w.expr || '', t('tutc.wait.exprPh'), (v) => {
            st.wait = { ...(st.wait || { kind: 'custom' }), expr: v || undefined };
            validate(v);
        });
        validate(w.expr || '');
        box.append(labelled(t('tutc.wait.exprLbl'), ex));
        box.append(msg);
    }

    if (w?.kind === 'view') {
        const vs = document.createElement('select');
        vs.className = 'input input-sm';
        for (const v of VIEWS) {
            const o = document.createElement('option');
            o.value = v; o.textContent = v;
            if (w.view === v) o.selected = true;
            vs.append(o);
        }
        if (!w.view) st.wait = { ...w, view: vs.value };
        vs.addEventListener('change', () => { st.wait = { ...(st.wait || { kind: 'view' }), view: vs.value }; });
        box.append(labelled(t('tutc.wait.which'), vs));
    }

    return box;
}
