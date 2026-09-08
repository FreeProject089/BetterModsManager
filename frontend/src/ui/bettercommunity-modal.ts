// What BetterCommunity actually is, from inside BMM.
//
// BMM talks to bettercommunity.ch constantly — the repo browser, the catalogues, the blog
// screen, the update feed, telemetry, the plugin sources — and the app never once said what
// that place is. A person who noticed the name in Settings had two ways to find out: leave
// the app, or not bother.
//
// So: one screen that answers it, and is honest about the part that matters most, which is
// that none of it is required. BMM manages mods on a machine with no network and no account;
// everything here is the optional half.
//
// NO CHROME. Two earlier versions of this screen got progressively more decorated —
// first eight rows in one column, then two bordered panels with coloured top rails — and
// the decoration was the problem both times. A short explanation dressed as a product
// page reads as marketing, and a person meeting a dialog at startup is already primed to
// think that.
//
// So: two labelled groups, a term on the left and a line on the right, and nothing
// separating anything but space. No boxes, no rails, no tinted icons. The reader can
// take in the terms in one pass and read only the lines that interest them, which is
// what a term-and-definition list is for.
//
// Every address comes from the links registry (links-config.ts), never typed here. That
// registry is loaded from BCWEB at startup with a bundled fallback, which is the whole point
// of it: the Discord invite can be rotated without shipping a new BMM.
import { t } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import { getLinks } from '../core/links-config.js';
import { invoke } from '../core/api.js';
import { raiseAboveAll } from './layer.js';

/** Set once "Don't show again" is ticked. Never shown at start after that. */
const OPTOUT_KEY = 'bmm_bc_intro_optout';

/** One entry: what it is called, and one line saying what it is. No icon — eight small
 *  glyphs on one screen decorate it without telling anybody anything. */
interface Row { title: string; body: string; }

/**
 * The site's three.
 *
 * It had four, and two of them were the same thing: "Server Repos" and "Catalogues" are
 * both HOSTING, which is what the site actually sells, and splitting them made the answer
 * to "what is this place" longer without making it fuller. Hosting is one entry that says
 * what it holds today and what it will hold — somebody's own website or Discord bot —
 * because that is the direction of the thing and a person deciding whether to care should
 * hear it.
 */
const SITE_ROWS = (): Row[] => [
    { title: t('bc.site.host'), body: t('bc.site.host.d') },
    { title: t('bc.site.pub'), body: t('bc.site.pub.d') },
    { title: t('bc.site.blog'), body: t('bc.site.blog.d') },
];

/** The bot's four are unchanged — they were right. Only their presentation is different. */
const BOT_ROWS = (): Row[] => [
    { title: t('bc.bot.news'), body: t('bc.bot.news.d') },
    { title: t('bc.bot.roles'), body: t('bc.bot.roles.d') },
    { title: t('bc.bot.give'), body: t('bc.bot.give.d') },
    { title: t('bc.bot.level'), body: t('bc.bot.level.d') },
];

/** A term and its definition. `<dt>`/`<dd>` because that is what these are, which also
 *  gives a screen reader the pairing the two columns give everyone else. */
const rowHtml = (r: Row): string =>
    `<dt class="bc-t">${escHtml(r.title)}</dt><dd class="bc-d">${escHtml(r.body)}</dd>`;

/** One half of the answer: a label, a line about it, and its terms. */
const groupHtml = (title: string, note: string, rows: Row[]): string => `
        <h3 class="bc-h">${escHtml(title)}</h3>
        <p class="bc-note">${escHtml(note)}</p>
        <dl class="bc-dl">${rows.map(rowHtml).join('')}</dl>`;

let _open: HTMLElement | null = null;

/**
 * Show it at start unless the reader has said not to.
 *
 * Deliberately NOT "first run only". An opt-out that had one chance to fire is a control
 * that does nothing, and somebody who dismissed this unread on the day they installed BMM
 * is exactly who might want it the second time.
 *
 * It stands aside for onboarding, which owns the first launch and is a sequence rather than
 * a dialog — two overlays at once means one is behind the other with no way to tell.
 *
 * Returns whether it took the slot, so the caller can leave the other start-up nudge for
 * another day. One interruption per launch.
 */
export function maybeShowBetterCommunityIntro(): boolean {
    try {
        if (localStorage.getItem(OPTOUT_KEY) === '1') return false;
        if (document.getElementById('onboarding-overlay')) return false;
        // Long enough for the app to have painted; short enough to still read as part of
        // starting up rather than as something that interrupted you later.
        setTimeout(() => openBetterCommunity(true), 900);
        return true;
    } catch {
        // localStorage can throw outright (a locked-down profile), and the safe direction is
        // silence: a nudge that cannot remember being dismissed must not show at all.
        return false;
    }
}

/**
 * Open the BetterCommunity screen. Idempotent: a second call while it is open does nothing
 * rather than stacking a second copy behind the first, which is what every "the button
 * stopped working" report about a modal turns out to be.
 *
 * `atStart` draws the "don't show again" control. Opened deliberately — from the Community
 * screen or the command palette — there is nothing to suppress, and offering to hide
 * something somebody just asked for is noise.
 */
export function openBetterCommunity(atStart = false): void {
    if (_open?.isConnected) return;
    const L = getLinks();

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    // Above whatever opened it — this is reachable from the tutorial hub and from the
    // command palette, and a flat z-index would put it under one of them.
    raiseAboveAll(ov, 11400);
    _open = ov;

    const close = (): void => {
        ov.remove();
        _open = null;
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    document.addEventListener('keydown', onKey);

    // Buttons, not anchors. `window.open(url, '_blank')` is a NO-OP in the Tauri v2
    // webview — that is why the credits links stopped working after the v2 migration — so
    // every one of these would have looked right and done nothing. The backend opener hands
    // the URL to the real browser.
    //
    // A link the registry does not carry renders as nothing at all rather than as a dead
    // button: an address that is not configured is not a feature the reader should see.
    const link = (href: string, label: string, cls = 'btn btn-sm btn-secondary'): string =>
        href ? `<button type="button" class="${cls}" data-bc-url="${escAttr(href)}">${escHtml(label)}</button>` : '';

    ov.innerHTML = `
        <div class="modal bc-modal" role="dialog" aria-modal="true" aria-labelledby="bc-title">
            <div class="bc-hero">
                <span class="bc-mark"><img src="assets/BC_white.webp" alt=""></span>
                <span class="bc-hero-txt">
                    <span class="bc-hero-t" id="bc-title">BetterCommunity</span>
                    <span class="bc-hero-s">${escHtml(t('bc.sub'))}</span>
                </span>
                <button class="bc-x" id="bc-x" aria-label="${escAttr(t('common.close'))}">&times;</button>
            </div>
            <div class="modal-body bc-body">
                <p class="bc-lede">${escHtml(t('bc.lede'))}</p>
                <p class="bc-opt">
                    <strong>${escHtml(t('bc.opt.t'))}</strong> ${escHtml(t('bc.opt.b'))}
                </p>
                ${groupHtml(t('bc.site'), t('bc.site.lede'), SITE_ROWS())}
                ${groupHtml(t('bc.bot'), t('bc.bot.lede'), BOT_ROWS())}
            </div>
            <div class="modal-footer bc-foot">
                ${atStart
        ? `<label class="bc-hide"><input type="checkbox" id="bc-optout"> ${escHtml(t('bc.hide'))}</label>`
        : '<span class="bc-foot-gap"></span>'}
                <span class="bc-actions">
                    ${link(L.discord, t('bc.join'))}
                    ${link(L.bettercommunity, t('bc.open'), 'btn btn-sm btn-accent')}
                </span>
            </div>
        </div>`;

    ov.querySelector('#bc-x')?.addEventListener('click', close);
    // Written when the box is TICKED, not when the dialog closes: somebody who ticks it and
    // then presses Escape has still said no, and a preference that depended on which exit
    // they used would be a coin flip.
    ov.querySelector<HTMLInputElement>('#bc-optout')?.addEventListener('change', (e) => {
        const on = (e.target as HTMLInputElement).checked;
        try {
            if (on) localStorage.setItem(OPTOUT_KEY, '1');
            else localStorage.removeItem(OPTOUT_KEY);
        } catch { /* nothing here can fix a storage that refuses to write */ }
    });
    ov.querySelectorAll<HTMLElement>('[data-bc-url]').forEach((b) => {
        // `invoke` straight from core/api rather than app.ts's openExternal: importing the
        // app frame from a dialog it opens is a cycle, and the dep-graph ratchet says so.
        // Same backend command, one module closer to the leaf.
        b.addEventListener('click', () => {
            const url = b.dataset.bcUrl || '';
            if (url) void invoke('open_external', { url }).catch(() => { /* the browser refused; nothing here can fix it */ });
        });
    });
    // Click-outside closes, click-inside does not. Compared against the overlay itself
    // rather than using `contains`, so a click that starts on the backdrop and ends on the
    // dialog (a drag over the edge) does not close it.
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });

    // The frame, not <body>: the window is transparent and the app is inset 40px from its
    // top/left, so an overlay on <body> spreads its dim across that invisible margin.
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    (ov.querySelector('#bc-x') as HTMLElement | null)?.focus();
}
