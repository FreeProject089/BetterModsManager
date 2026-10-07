// The Style modal: pick a look without leaving what you were doing.
//
// One overlay with every theme as a painted tile — a miniature fake window, the same
// caricature the installer's setup page draws — plus two doors into the real settings for
// Tasky and everything else. Doors, not copies: the settings implementation already owns
// those toggles, and a second copy here would drift from it the way every duplicated rule
// in this codebase eventually has (buildPublicProfile exists for the same reason).
//
// Built with DOM calls throughout. Theme names come from user-installable JSON files, so
// this screen interpolating markup would be an injection sink fed by theme packs.

import { t } from '../core/i18n.js';
import { invoke } from '../core/api.js';
import {
    BUILTIN_THEMES, getInstalledThemes, getActiveTheme, applyTheme, resetTheme,
    type BmmTheme,
} from '../features/themes/theme-engine.js';
import { openModal, type ModalHandle } from './modal-shell.js';
import { raiseAboveAll } from './layer.js';

const OVERLAY_ID = 'bmm-style-modal';
let _handle: ModalHandle | null = null;

// One-shot close callback, so a caller can sequence "style first, then the hub" without
// this module knowing anything about tutorials.
let _onClose: (() => void) | null = null;

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

/** The four colours a tile is painted from, with the app's own defaults where a theme
 *  inherits (bmm-default ships `vars: {}` on purpose — empty means "the base look"). */
function palette(theme: BmmTheme) {
    const v = theme.vars || {};
    return {
        bg:      v['--bmm-bg-base']      || '#0a0e17',
        surface: v['--bmm-bg-elevated']  || '#111827',
        accent:  v['--bmm-accent']       || '#3b82f6',
        ink:     v['--bmm-text-primary'] || '#f1f5f9',
    };
}

/** A miniature fake window: title bar, sidebar, card, primary button. A caricature on
 *  purpose — the point is recognising a look at a glance, not previewing a real screen. */
function tile(theme: BmmTheme, active: boolean, onPick: () => void): HTMLElement {
    const p = palette(theme);
    const b = el('button', 'style-tile');
    b.setAttribute('type', 'button');
    if (active) b.classList.add('on');
    b.style.setProperty('--tile-accent', p.accent);

    const win = el('span', 'style-tile-win');
    win.style.background = p.bg;
    const bar = el('span', 'style-tile-bar');  bar.style.background = p.surface;
    const side = el('span', 'style-tile-side'); side.style.background = p.surface;
    const card = el('span', 'style-tile-card'); card.style.background = p.surface;
    const line1 = el('span', 'style-tile-line'); line1.style.background = p.ink;
    const line2 = el('span', 'style-tile-line short'); line2.style.background = p.ink;
    const btn = el('span', 'style-tile-btn');   btn.style.background = p.accent;
    card.append(line1, line2, btn);
    win.append(bar, side, card);

    const name = el('span', 'style-tile-name', theme.name || theme.id);
    b.append(win, name);
    b.addEventListener('click', onPick);
    return b;
}

export function closeStyleModal(): void {
    // The handle's onClose (below) runs the follow-up, so a click on the dim and the Close
    // button end the same way.
    _handle?.close();
}

/** After the dialog is gone, whatever closed it: run the one-shot follow-up. */
function afterClose(): void {
    _handle = null;
    const cb = _onClose; _onClose = null;
    if (cb) { try { cb(); } catch { /* a follow-up failing must not keep the modal */ } }
}

/** Jump to the settings view and, if an anchor is given, bring that card into view. */
function goToSettings(anchorId?: string): void {
    closeStyleModal();
    (document.querySelector('.nav-item[data-view="settings"]') as HTMLElement | null)?.click();
    if (anchorId) setTimeout(() => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
}

export function openStyleModal(onClose?: () => void): void {
    if (document.getElementById(OVERLAY_ID)) return;
    _onClose = onClose ?? null;

    const grid = el('div', 'style-modal-grid');
    const activeId = getActiveTheme()?.id ?? null;

    // Built-ins first (the curated set), then installed — and no id twice: an installed
    // copy of a built-in would otherwise show as two tiles that do the same thing.
    const seen = new Set<string>();
    const themes = [...BUILTIN_THEMES, ...getInstalledThemes()].filter((th) => {
        if (!th?.id || seen.has(th.id)) return false;
        seen.add(th.id);
        return true;
    });

    for (const theme of themes) {
        grid.append(tile(theme, theme.id === activeId, async () => {
            // Default theme = clear the override rather than apply an empty skin.
            if (theme.id === 'bmm-default') resetTheme();
            else applyTheme(theme);
            await invoke('set_active_theme', { themeId: theme.id }).catch(() => {});
            // Re-render so the ring moves to the picked tile — cheaper than tracking it.
            // The close callback is carried across, not fired: picking a theme is not
            // closing the modal, and a sequenced follow-up (the tutorial hub) must wait
            // for the real close.
            const carry = _onClose; _onClose = null;
            closeStyleModal();
            openStyleModal(carry ?? undefined);
        }));
    }

    const doors = document.createDocumentFragment();
    const tasky = el('button', 'btn btn-secondary', t('style.tasky') || 'Tasky settings');
    tasky.setAttribute('type', 'button');
    tasky.addEventListener('click', () => goToSettings('settings-tasky-icon'));
    const all = el('button', 'btn btn-secondary', t('style.allSettings') || 'All BMM settings');
    all.setAttribute('type', 'button');
    all.addEventListener('click', () => goToSettings());
    const close = el('button', 'btn btn-primary', t('common.close') || 'Close');
    close.setAttribute('type', 'button');
    close.addEventListener('click', closeStyleModal);
    const start = el('div', 'modal-footer-start');
    start.append(tasky, all);
    doors.append(start, close);

    // The house shell. Not dismissible by Escape and without a ×, as before (the footer's
    // Close is the answer), but a click on the dim still closes it. Its old z-index stays the
    // floor: it is opened at the end of the first run, above everything that run put up.
    _handle = openModal({
        id: OVERLAY_ID,
        title: t('style.title') || 'Style your BMM',
        subtitle: t('style.sub') || 'Pick a look — it applies instantly and sticks. Everything here also lives in Settings.',
        size: 'lg',
        className: 'style-modal',
        body: grid,
        footer: doors,
        dismissible: false,
        backdropClose: true,
        onClose: afterClose,
    });
    raiseAboveAll(_handle.overlay, 100050);
}
