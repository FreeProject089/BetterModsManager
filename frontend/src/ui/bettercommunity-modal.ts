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
// SHORT ENOUGH TO READ, AND IT FITS. Three versions of this screen got progressively
// less decorated and stayed too long: eight rows with icons, then two bordered panels,
// then seven term-and-definition pairs. At the 680px minimum window height the last pair
// was below the fold, which tells you the real problem was never the chrome — it was that
// a dialog appearing uninvited at startup was answering questions nobody had asked yet.
//
// One question is asked: what is this place. Answering it took one more round than it
// should have, because four versions running answered a DIFFERENT question — they listed
// what you can do here (host your repos, tools for devs, one bot in your server) and never
// once said what the place is. Somebody who did not already know finished the screen still
// not knowing.
//
// So the two facts that were missing hold the two positions that carry:
//
//   the SUBTITLE says what it is      — the site every Better* project shares
//   the LEDE says why you are seeing it — BMM takes its repos, catalogues and news from
//                                        there, and you can publish yours
//
// and neither repeats the other, which the pair before them did: the subtitle said "where
// the Better* projects live" and the lede said BMM reads from "here", so the screen named
// the same relationship twice and defined the place once, in six words, in a header.
//
// The two halves then carry only what the lede has not. The detail is what the buttons
// are for.
//
// THE ACTIONS ARE IN THE FOOTER, and getting there took two wrong turns. First they were
// in the footer unlabelled, where nothing said which belonged to what. Then they moved
// INTO each half, directly under its lines — which stops the reading twice, once going
// down and once coming back, and left two buttons aligned with nothing.
//
// The fix for the original ambiguity was never position. It was labels: "Explore the
// site", "Join the Discord", "Add the bot" each say what they do standing alone.
//
// What carries the structure is two cards. A single hairline was tried first, on the
// argument that a line separates without boxing — but it left the right half's text sitting
// against the modal edge with nothing holding it. The bordered panels that failed earlier
// failed for being tall, icon-laden and full of prose, not for having borders.
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

/** Discord's own glyph, on both buttons that lead to Discord. Two buttons sharing a mark
 *  and sitting side by side say "these are the same place" without a word. */
const DISCORD_GLYPH = '<svg class="bc-btn-i" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.22.645-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.078.078 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.332c-1.183 0-2.157-1.085-2.157-2.42s.955-2.42 2.157-2.42c1.21 0 2.176 1.085 2.156 2.42 0 1.335-.956 2.42-2.156 2.42zm7.974 0c-1.183 0-2.157-1.085-2.157-2.42s.955-2.42 2.157-2.42c1.21 0 2.176 1.085 2.156 2.42 0 1.335-.946 2.42-2.156 2.42z"/></svg>';

/** The BetterCommunity mark, on the button that opens BetterCommunity. Same image as the
 *  one at the top of this dialog, so the accent button is visibly the same destination. */
const BC_GLYPH = '<img class="bc-btn-mark" src="assets/BC_white.webp" alt="" aria-hidden="true">';

/**
 * One column: a label, then its items as a list.
 *
 * It used to be two prose lines with the first set brighter, which was the right shape for
 * two prose lines. Each half is really a list — five separate doors on the site side, a
 * feature set on the bot side — and five things written as prose is a paragraph nobody
 * finishes: the reader has to hold the whole sentence to find the one item that applies to
 * them. A list lets the eye pick its row and skip the rest.
 *
 * Variable-length on purpose, so neither half has to pad or drop an item to match the other.
 */
const columnHtml = (title: string, lines: string[]): string => `
            <section class="bc-col">
                <h3 class="bc-h">${escHtml(title)}</h3>
                <ul class="bc-list">
                    ${lines.map((l) => `<li class="bc-li">${escHtml(l)}</li>`).join('')}
                </ul>
            </section>`;

let _open: HTMLElement | null = null;

/**
 * Is another dialog already on screen?
 *
 * Asked as "is anything up", not "is onboarding up". A screen that stands aside for whatever
 * is there needs no list of the things it must stand aside for — and the next dialog somebody
 * adds is covered without anybody remembering to come back here, which is the part that did
 * not happen last time.
 */
function somethingElseIsUp(): boolean {
    return !!document.querySelector('#onboarding-overlay, .modal, [role="dialog"], .ptb-modal, #upd-card');
}

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
        if (somethingElseIsUp()) return false;
        // Long enough for the app to have painted; short enough to still read as part of
        // starting up rather than as something that interrupted you later.
        //
        // Checked AGAIN when the timer fires, and that is the whole fix. Checking only here
        // asks the question 900 ms before the answer matters: on a fresh profile the
        // onboarding sequence starts inside that window, so the check passed, the timer
        // fired, and two overlays ended up stacked — exactly what the comment above claims
        // this prevents. The update-notes screen did the same, because it was never in the
        // list of things to stand aside for.
        setTimeout(() => { if (!somethingElseIsUp()) openBetterCommunity(true); }, 900);
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
    // Each button wears the mark of the place it opens, and that is the grouping: the two
    // Discord buttons carry the same glyph and sit next to each other, so "add the bot" and
    // "join the server" read as two doors into one thing rather than as three unrelated
    // options. The site's button carries the mark already at the top of this dialog.
    const link = (href: string, label: string, icon: string, cls = 'btn btn-sm btn-secondary'): string =>
        href ? `<button type="button" class="${cls}" data-bc-url="${escAttr(href)}">${icon}${escHtml(label)}</button>` : '';

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
                <div class="bc-split">
                    <!-- Each key written out rather than mapped over an array of them:
                         Array.map hands the INDEX to t()'s second parameter, and a key list
                         built at runtime is invisible to check-i18n-keys, which reads
                         literal t() calls. -->
                    ${columnHtml(t('bc.site'), [
        t('bc.site.1'), t('bc.site.2'), t('bc.site.3'), t('bc.site.4'), t('bc.site.5'),
    ])}
                    ${columnHtml(t('bc.bot'), [
        t('bc.bot.1'), t('bc.bot.2'), t('bc.bot.3'), t('bc.bot.4'), t('bc.bot.5'), t('bc.bot.6'),
    ])}
                </div>
                <!-- Kept, as one muted line, even though the mock dropped it. A dialog
                     that opens by itself to talk about an online platform owes the reader
                     the sentence saying they need none of it. The tick and the rule it used
                     to wear were carrying structure the card borders carry now. -->
                <p class="bc-ok"><b>${escHtml(t('bc.opt.t'))}</b> ${escHtml(t('bc.opt.b'))}</p>
            </div>
            <div class="modal-footer bc-foot">
                ${atStart
        ? `<label class="bc-hide"><input type="checkbox" id="bc-optout"> ${escHtml(t('bc.hide'))}</label>`
        : '<span class="bc-foot-gap"></span>'}
                <span class="bc-actions">
                    ${link(L.discord_bot_invite, t('bc.addbot'), DISCORD_GLYPH)}
                    ${link(L.discord, t('bc.join'), DISCORD_GLYPH)}
                    ${link(L.bettercommunity, t('bc.open'), BC_GLYPH, 'btn btn-sm btn-accent')}
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
