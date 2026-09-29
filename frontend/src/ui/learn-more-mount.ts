// Where the "Learn more" links go on the screens whose markup is static (index.html).
//
// Screens rendered from TypeScript (Plugins, App Catalog, Community, Server Repo) write
// a `learnMore(<topic>)` call into their own templates. The static ones cannot — their HTML is a file,
// and a link added there would need a second copy of the topic table — so this module adds them
// once at startup, by selector. Every placement is idempotent (a container that already holds a
// link is skipped), so calling it again after a re-render costs nothing.
//
// Excluded on purpose: the Scheduler and Storage Manager cards. Their own features place their
// links (they own those screens), with the same helper.
import { learnMore } from '../core/learn-more.js';

/** Append `html` to `host` unless it already carries a Learn-more link. */
function put(host: Element | null | undefined, html: string, where: InsertPosition = 'beforeend'): void {
    if (!host || !html || host.querySelector(':scope [data-learn-more]')) return;
    host.insertAdjacentHTML(where, html);
}

/** A view's header: into its actions row (created when the header has none). */
function header(viewId: string, html: string): void {
    const head = document.querySelector(`#${viewId} > .view-header`);
    if (!head) return;
    let actions = head.querySelector(':scope > .view-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'view-actions';
        head.appendChild(actions);
    }
    put(actions, html);
}

/** A Settings card, found by the i18n key of its title (ids are missing on half of them). */
function card(titleKey: string, html: string): void {
    const title = document.querySelector(`#view-settings .card-title [data-i18n="${titleKey}"], #view-settings .card-title[data-i18n="${titleKey}"]`);
    const h = title?.closest('.card-title');
    if (!h || h.querySelector('[data-learn-more]')) return;
    // A title that IS the translated element gets its textContent replaced on every language
    // switch, which would wipe the link. Its words move into a span that carries the key.
    if (h.hasAttribute('data-i18n')) {
        const span = document.createElement('span');
        span.setAttribute('data-i18n', h.getAttribute('data-i18n') || '');
        // Text only — the fold chevron (settings-fold may have added it already) stays outside.
        for (const n of [...h.childNodes]) {
            if (n instanceof Element && n.classList.contains('bmm-fold-chevron')) continue;
            span.appendChild(n);
        }
        h.removeAttribute('data-i18n');
        h.prepend(span);
        h.classList.add('lm-title-row');
    }
    // Before the fold chevron when settings-fold already added it, so the chevron stays last.
    const chev = h.querySelector(':scope > .bmm-fold-chevron');
    if (chev) chev.insertAdjacentHTML('beforebegin', html);
    else h.insertAdjacentHTML('beforeend', html);
}

export function mountLearnMoreLinks(): void {
    // ── View headers ──
    put(document.querySelector('#view-library > .lib-header-title'), `<div class="lm-row">${learnMore('mods')}</div>`);
    header('view-profiles', learnMore('profiles'));
    header('view-modlist', learnMore('modlist'));
    header('view-mapper', learnMore('mapper'));
    header('view-modpacks', learnMore('modpacks'));
    header('view-settings', learnMore('settings'));

    // ── Settings sections (Scheduler and Storage excluded: their owners place them) ──
    const end = { className: 'lm-end' };
    card('settings.language', learnMore('translate', end));
    card('settings.autoUpdateTitle', learnMore('updates', end));
    card('settings.catIndex.title', learnMore('catalog-index', end));
    card('themes.settingsTitle', learnMore('themes', end));
    card('settings.shortcutsTitle', learnMore('shortcuts', end));
    card('settings.shaTitle', learnMore('integrity', end));
    card('settings.discordRpcTitle', learnMore('integrations', end));
    card('settings.githubPatTitle', learnMore('github-pat', end));
    card('settings.benchmarkTitle', learnMore('performance', end));
    card('settings.launchPackTitle', learnMore('launch-packs', end));
    card('analytics.settingsTitle', learnMore('privacy', end));
    card('settings.securityTitle', learnMore('security', end));
    card('settings.crashTitle', learnMore('troubleshooting', end));
    card('betahub.cardTitle', learnMore('feedback', end));
    card('security.modal.title', learnMore('security', end));
}
