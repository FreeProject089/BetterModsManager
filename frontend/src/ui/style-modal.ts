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

const OVERLAY_ID = 'bmm-style-modal';

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
    const o = document.getElementById(OVERLAY_ID);
    if (!o) return;
    o.classList.add('closing');
    o.addEventListener('animationend', () => o.remove(), { once: true });
    setTimeout(() => document.getElementById(OVERLAY_ID)?.remove(), 350);
}

/** Jump to the settings view and, if an anchor is given, bring that card into view. */
function goToSettings(anchorId?: string): void {
    closeStyleModal();
    (document.querySelector('.nav-item[data-view="settings"]') as HTMLElement | null)?.click();
    if (anchorId) setTimeout(() => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
}

export function openStyleModal(): void {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = el('div', 'style-modal-overlay');
    overlay.id = OVERLAY_ID;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeStyleModal(); });

    const box = el('div', 'style-modal');
    box.append(el('h2', 'style-modal-title', t('style.title') || 'Style your BMM'));
    box.append(el('p', 'style-modal-sub', t('style.sub') || 'Pick a look — it applies instantly and sticks. Everything here also lives in Settings.'));

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
            closeStyleModal();
            openStyleModal();
        }));
    }
    box.append(grid);

    const doors = el('div', 'style-modal-doors');
    const tasky = el('button', 'btn btn-secondary', t('style.tasky') || 'Tasky settings');
    tasky.setAttribute('type', 'button');
    tasky.addEventListener('click', () => goToSettings('settings-tasky-icon'));
    const all = el('button', 'btn btn-secondary', t('style.allSettings') || 'All BMM settings');
    all.setAttribute('type', 'button');
    all.addEventListener('click', () => goToSettings());
    const close = el('button', 'btn btn-primary', t('common.close') || 'Close');
    close.setAttribute('type', 'button');
    close.addEventListener('click', closeStyleModal);
    doors.append(tasky, all, close);
    box.append(doors);

    overlay.append(box);
    (document.getElementById('app-window-outer') || document.body).append(overlay);
}
