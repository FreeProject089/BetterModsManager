// @ts-nocheck
// ── Custom Select ───────────────────────────────────────────────────────────────
// Replaces the OS-rendered native <select> popup (which ignores theme colours in
// the WebView, leaving unreadable dropdowns) with a fully themeable DOM listbox.
//
// Design constraints learned the hard way:
//  • DO NOT move the <select> in the DOM — app code (e.g. the mapper) calls
//    insertBefore relative to it; moving it throws NotFoundError. We hide it
//    in place and insert our UI as its next sibling.
//  • The menu is portaled to <body> with position:fixed so it is never clipped
//    by overflow ancestors nor mis-placed by a transformed ancestor.
//  • The native <select> stays the source of truth (.value / change events).

import { t } from '../core/i18n.js';

let _openCsel: any = null;

export function initCustomSelects(): void {
    enhanceAll();

    const mo = new MutationObserver(muts => {
        let scan = false;
        for (const m of muts) {
            if (m.type !== 'childList') continue;
            m.addedNodes.forEach(n => { if ((n as HTMLElement).nodeType === 1) scan = true; });
            const host = (m.target as HTMLElement)?.closest?.('select') as HTMLSelectElement | null;
            if (host && (host as any)._bmmCsel) (host as any)._bmmCsel.rebuild();
        }
        if (scan) enhanceAll();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('mousedown', e => {
        if (_openCsel && !_openCsel.hitTest(e.target as Node)) closeOpen();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOpen(); }, true);
}

function enhanceAll(): void {
    document.querySelectorAll('select:not([data-bmm-csel]):not([multiple])')
        .forEach(s => {
            // Leave the theme editor's own selects native — enhancing them interferes
            // with the editor's re-renders and control wiring. Same for the DevTools studios:
            // their panels sit at the max z-index, and the custom menu (lower z-index) would
            // render BEHIND the panel — a native <select> popup renders in the OS top layer,
            // always above it.
            if ((s as HTMLElement).closest('#bmm-theme-editor, #bte-elov, .anim-panel, .rstudio-bar')) return;
            enhance(s as HTMLSelectElement);
        });
}

function closeOpen(): void {
    if (_openCsel) { _openCsel.close(); _openCsel = null; }
}

function enhance(sel: HTMLSelectElement): void {
    if (sel.dataset.bmmCsel) return;
    sel.dataset.bmmCsel = '1';
    sel.classList.add('bmm-csel-native-hidden');   // hidden in place, NOT moved

    const ui = document.createElement('span');
    ui.className = 'bmm-csel';
    if (sel.style.width) ui.style.width = sel.style.width;
    if (sel.style.flex) ui.style.flex = sel.style.flex;
    // Carry the select's inline margins onto the visible wrapper — the native
    // <select> is hidden (display:none ⇒ its margins are ignored), so without this
    // an inline `margin-top` etc. would be lost and the trigger glues to its
    // neighbour (e.g. the mapper expand/collapse buttons).
    if (sel.style.margin) ui.style.margin = sel.style.margin;
    if (sel.style.marginTop) ui.style.marginTop = sel.style.marginTop;
    if (sel.style.marginBottom) ui.style.marginBottom = sel.style.marginBottom;
    if (sel.style.marginLeft) ui.style.marginLeft = sel.style.marginLeft;
    if (sel.style.marginRight) ui.style.marginRight = sel.style.marginRight;
    sel.insertAdjacentElement('afterend', ui);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'bmm-csel-trigger ' + (sel.className.replace('bmm-csel-native-hidden', '').trim());
    trigger.innerHTML = `<span class="bmm-csel-label"></span><svg class="bmm-csel-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    ui.appendChild(trigger);

    // Menu lives in <body> while open; parked (detached) while closed.
    const menu = document.createElement('div');
    menu.className = 'bmm-csel-menu';

    const labelEl = trigger.querySelector('.bmm-csel-label') as HTMLElement;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    /**
     * Does this list need a search box?
     *
     * By COUNT, not by an attribute on each call site. The lists that need one are the ones
     * that grew — the scheduler's actions went from twenty to seventy-nine over a year, and
     * nobody was going to revisit its markup on the day it crossed the line. A short list is
     * unchanged, because a search box above six options is furniture.
     *
     * `data-csel-search="off"` forces it away for a list that is long and still not worth
     * searching, and `"on"` forces it on for a short one whose labels are hard to scan.
     */
    const wantsSearch = () => {
        const forced = sel.dataset ? sel.dataset.cselSearch : undefined;
        if (forced === 'off') return false;
        if (forced === 'on') return true;
        return sel.options.length >= 12;
    };

    const buildMenu = () => {
        menu.innerHTML = '';
        let i = -1; // flat option index, matches sel.selectedIndex / sel.options order
        const renderOpt = (opt) => {
            i++;
            const idx = i;
            const item = document.createElement('div');
            item.className = 'bmm-csel-opt'
                + (opt.disabled ? ' disabled' : '')
                + (idx === sel.selectedIndex ? ' selected' : '');
            // Rich option: optional inline-SVG icon (data-icon) + sub description
            // (data-desc) so menus can look like the script generator's catalogue.
            const icon = opt.dataset ? opt.dataset.icon : '';
            const desc = opt.dataset ? opt.dataset.desc : '';
            const label = opt.textContent || opt.value;
            if (icon || desc) {
                item.classList.add('bmm-csel-opt-rich');
                item.innerHTML =
                    (icon ? `<span class="bmm-csel-opt-icon">${icon}</span>` : '')
                    + `<span class="bmm-csel-opt-text"><span class="bmm-csel-opt-label">${esc(label)}</span>`
                    + (desc ? `<span class="bmm-csel-opt-desc">${esc(desc)}</span>` : '')
                    + `</span>`;
            } else {
                item.textContent = label;
            }
            item.title = desc ? `${label} — ${desc}` : label;
            if (!opt.disabled) item.addEventListener('click', e => {
                e.stopPropagation();
                sel.selectedIndex = idx;
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                syncTrigger();
                closeOpen();
            });
            menu.appendChild(item);
        };
        // Walk children so <optgroup> labels become section headers (the native
        // select flattens them; here we keep the grouping the author intended).
        Array.from(sel.children).forEach(ch => {
            if (ch.tagName === 'OPTGROUP') {
                const header = document.createElement('div');
                header.className = 'bmm-csel-group';
                header.textContent = ch.label || '';
                // Remembered on the header so filtering can hide a group whose options all
                // went away. A lone heading over nothing reads as a section that failed to
                // load rather than as one that matched nothing.
                (header as any)._cselGroup = true;
                menu.appendChild(header);
                Array.from(ch.children).forEach(o => { if (o.tagName === 'OPTION') renderOpt(o); });
            } else if (ch.tagName === 'OPTION') {
                renderOpt(ch);
            }
        });

        if (wantsSearch()) buildSearch();
    };

    /**
     * The search box, added to the top of the menu.
     *
     * It FILTERS the rendered rows rather than rebuilding them. Rebuilding would drop the
     * click handlers' captured indices — each row closes over the flat option index it was
     * built with, which is what makes the grouped menu map back onto `sel.selectedIndex`.
     */
    const buildSearch = () => {
        const bar = document.createElement('div');
        bar.className = 'bmm-csel-search';
        const input = document.createElement('input');
        input.type = 'search';
        input.className = 'bmm-csel-search-input';
        input.placeholder = t('common.search');
        input.spellcheck = false;
        // A select is a form control and this box lives inside a menu attached to <body>;
        // without this, typing a space or Enter reaches whatever form is behind it.
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                // Enter takes the first thing still showing, which is what somebody who
                // typed three letters and stopped is asking for.
                const first = menu.querySelector('.bmm-csel-opt:not([hidden]):not(.disabled)') as HTMLElement | null;
                first?.click();
            }
        });
        const empty = document.createElement('div');
        empty.className = 'bmm-csel-empty';
        empty.hidden = true;
        empty.textContent = t('common.noMatch');

        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            let shown = 0;
            let group: HTMLElement | null = null;
            let groupShown = 0;
            const closeGroup = () => { if (group) group.hidden = groupShown === 0; };
            for (const node of Array.from(menu.children) as HTMLElement[]) {
                if (node === bar || node === empty) continue;
                if ((node as any)._cselGroup) { closeGroup(); group = node; groupShown = 0; continue; }
                if (!node.classList.contains('bmm-csel-opt')) continue;
                // Matched on the row's whole text, which is the label AND the description —
                // "kill" should find "Stop app / process" through its description even though
                // the word is in neither label.
                const hit = !q || (node.textContent || '').toLowerCase().includes(q);
                node.hidden = !hit;
                if (hit) { shown += 1; groupShown += 1; }
            }
            closeGroup();
            empty.hidden = shown > 0;
        });

        bar.appendChild(input);
        menu.insertBefore(bar, menu.firstChild);
        menu.appendChild(empty);
        // Focused after the menu is on screen, not here — see the open handler.
        (menu as any)._cselSearchInput = input;
    };

    const syncTrigger = () => {
        const opt = sel.options[sel.selectedIndex];
        labelEl.textContent = opt ? (opt.textContent || opt.value) : '';
        trigger.disabled = sel.disabled;
    };

    const position = () => {
        const r = trigger.getBoundingClientRect();
        // Width fits the longest option (so labels aren't truncated), but never
        // narrower than the trigger and never wider than the CSS max-width.
        menu.style.width = 'max-content';
        menu.style.minWidth = Math.max(r.width, 150) + 'px';
        // Keep the menu on-screen: if it would overflow the right edge, pull left.
        const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
        menu.style.left = Math.max(8, left) + 'px';
        const below = window.innerHeight - r.bottom;
        if (below < 260 && r.top > below) {
            menu.style.top = 'auto';
            menu.style.bottom = (window.innerHeight - r.top + 4) + 'px';
            menu.style.maxHeight = (r.top - 12) + 'px';
        } else {
            menu.style.bottom = 'auto';
            menu.style.top = (r.bottom + 4) + 'px';
            menu.style.maxHeight = (below - 12) + 'px';
        }
    };

    const api = {
        rebuild() { buildMenu(); syncTrigger(); },
        hitTest(t: Node) { return ui.contains(t) || menu.contains(t); },
        close() {
            ui.classList.remove('open');
            menu.classList.remove('bmm-csel-menu-open');
            if (menu.parentNode) menu.parentNode.removeChild(menu);
            window.removeEventListener('scroll', position, true);
            window.removeEventListener('resize', position);
        },
    };
    (sel as any)._bmmCsel = api;

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        if (ui.classList.contains('open')) { closeOpen(); return; }
        closeOpen();
        buildMenu(); syncTrigger();
        document.body.appendChild(menu);
        menu.classList.add('bmm-csel-menu-open');
        ui.classList.add('open');
        _openCsel = api;
        position();
        window.addEventListener('scroll', position, true);
        window.addEventListener('resize', position);
        const selItem = menu.querySelector('.bmm-csel-opt.selected') as HTMLElement | null;
        if (selItem) selItem.scrollIntoView({ block: 'nearest' });
        // Focused only once the menu is in the document and positioned. Focusing a detached
        // input does nothing, and focusing before positioning makes the page jump.
        const search = (menu as any)._cselSearchInput as HTMLInputElement | undefined;
        if (search) { search.value = ''; search.focus({ preventScroll: true }); }
    });

    sel.addEventListener('change', syncTrigger);

    buildMenu();
    syncTrigger();
}
