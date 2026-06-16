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
            // with the editor's re-renders and control wiring.
            if ((s as HTMLElement).closest('#bmm-theme-editor, #bte-elov')) return;
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

    const buildMenu = () => {
        menu.innerHTML = '';
        Array.from(sel.options).forEach((opt, i) => {
            const item = document.createElement('div');
            item.className = 'bmm-csel-opt'
                + (opt.disabled ? ' disabled' : '')
                + (i === sel.selectedIndex ? ' selected' : '');
            item.textContent = opt.textContent || opt.value;
            item.title = opt.textContent || opt.value;
            if (!opt.disabled) item.addEventListener('click', e => {
                e.stopPropagation();
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                syncTrigger();
                closeOpen();
            });
            menu.appendChild(item);
        });
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
    });

    sel.addEventListener('change', syncTrigger);

    buildMenu();
    syncTrigger();
}
