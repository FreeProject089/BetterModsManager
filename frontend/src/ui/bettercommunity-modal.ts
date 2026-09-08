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
// Every address comes from the links registry (links-config.ts), never typed here. That
// registry is loaded from BCWEB at startup with a bundled fallback, which is the whole point
// of it: the Discord invite can be rotated without shipping a new BMM.
import { t } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import { getLinks } from '../core/links-config.js';
import { invoke } from '../core/api.js';
import { raiseAboveAll } from './layer.js';

/** One row of the "what it does" lists: an icon path, a title, a line of explanation. */
interface Row { icon: string; title: string; body: string; }

const svg = (d: string): string =>
    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICON = {
    server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M12 22V12"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    trend: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
};

/** The rows are declared, not inlined, so the two lists read as two lists. */
const SITE_ROWS = (): Row[] => [
    { icon: ICON.server, title: t('bc.site.repo') || 'Server Repos', body: t('bc.site.repo.d') || 'Host a mod repository people sync from — the same repos the Server Repo screen connects to.' },
    { icon: ICON.box, title: t('bc.site.cat') || 'Catalogues', body: t('bc.site.cat.d') || 'Publish plugins, themes, automations and presets. The catalogue sources BMM follows are these.' },
    { icon: ICON.news, title: t('bc.site.blog') || 'The blog and the docs', body: t('bc.site.blog.d') || 'Release notes and guides. The Community screen in BMM reads this feed directly.' },
    { icon: ICON.user, title: t('bc.site.acct') || 'An account, if you want one', body: t('bc.site.acct.d') || 'It is what publishing and hosting are attached to. Reading needs nothing.' },
];

const BOT_ROWS = (): Row[] => [
    { icon: ICON.bell, title: t('bc.bot.news') || 'Announcements', body: t('bc.bot.news.d') || 'New posts and releases land in the channel you pick, as embeds rather than bare links.' },
    { icon: ICON.shield, title: t('bc.bot.roles') || 'Roles and gating', body: t('bc.bot.roles.d') || 'Link a Discord account to a BetterCommunity one and roles follow — supporters, testers, whoever you decide.' },
    { icon: ICON.gift, title: t('bc.bot.give') || 'Giveaways and Ko-fi', body: t('bc.bot.give.d') || 'Run a giveaway from a command; a tip posts itself, with the message the tipper wrote.' },
    { icon: ICON.trend, title: t('bc.bot.level') || 'Levels and points', body: t('bc.bot.level.d') || 'Activity earns XP and points to spend in a shop you configure. Only linked accounts are credited.' },
];

const rowHtml = (r: Row): string => `
    <div class="bc-row">
        <span class="bc-row-ic">${svg(r.icon)}</span>
        <div class="bc-row-txt">
            <div class="bc-row-t">${escHtml(r.title)}</div>
            <div class="bc-row-b">${escHtml(r.body)}</div>
        </div>
    </div>`;

let _open: HTMLElement | null = null;

/**
 * Open the BetterCommunity screen. Idempotent: a second call while it is open does nothing
 * rather than stacking a second copy behind the first, which is what every "the button
 * stopped working" report about a modal turns out to be.
 */
export function openBetterCommunity(): void {
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
    // every one of these would have looked right and done nothing. `openExternal` goes
    // through the backend, which hands the URL to the real browser.
    //
    // A link the registry does not carry renders as nothing at all rather than as a dead
    // button: an address that is not configured is not a feature the reader should see.
    const link = (href: string, label: string, cls = 'btn btn-sm btn-secondary'): string =>
        href ? `<button type="button" class="${cls}" data-bc-url="${escAttr(href)}">${escHtml(label)}</button>` : '';

    ov.innerHTML = `
        <div class="modal bc-modal" role="dialog" aria-modal="true" aria-labelledby="bc-title">
            <div class="modal-header">
                <div class="bc-head">
                    <span class="bc-mark"><img src="assets/BC_white.webp" alt=""></span>
                    <div>
                        <div class="modal-title" id="bc-title">BetterCommunity</div>
                        <div class="bc-sub">${escHtml(t('bc.sub') || 'The platform BMM is part of.')}</div>
                    </div>
                </div>
                <button class="modal-close" id="bc-x" aria-label="${escAttr(t('common.close') || 'Close')}">&times;</button>
            </div>
            <div class="modal-body bc-body">
                <p class="bc-lede">${escHtml(t('bc.lede') || 'BetterCommunity hosts the repos, catalogues and blog that BMM reads. It is where a mod list becomes something other people can install.')}</p>

                <div class="bc-sec-h">${escHtml(t('bc.site') || 'The site')}</div>
                ${SITE_ROWS().map(rowHtml).join('')}

                <div class="bc-sec-h">${escHtml(t('bc.bot') || 'The Discord bot')}</div>
                <p class="bc-note">${escHtml(t('bc.bot.lede') || 'One bot, added to your own server, configured from your BetterCommunity dashboard rather than by editing a config file.')}</p>
                ${BOT_ROWS().map(rowHtml).join('')}

                <div class="bc-optional">
                    <strong>${escHtml(t('bc.opt.t') || 'None of this is required.')}</strong>
                    ${escHtml(t('bc.opt.b') || 'BMM installs, sorts and deploys mods on a machine with no network and no account. Everything above is the half that involves other people.')}
                </div>
            </div>
            <div class="modal-footer bc-foot">
                ${link(L.bettercommunity, t('bc.open') || 'Open the site', 'btn btn-sm btn-accent')}
                ${link(L.discord, t('bc.join') || 'Join the Discord')}
                ${link(L.github_repo, 'GitHub')}
                ${link(L.kofi_community, 'Ko-fi')}
            </div>
        </div>`;

    ov.querySelector('#bc-x')?.addEventListener('click', close);
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
