// "Learn more" — one link, one registry, every screen.
//
// A screen that wants to point at its documentation writes `${learnMore('repo')}` into its
// template (or appends `learnMoreEl('repo')` to a node it builds). The attribute on the button
// carries a TOPIC KEY, never a URL or a function name: the click is resolved against the
// closed registry below, so nothing in rendered HTML can make this link open anything the
// registry does not already name. That is the same rule the deeplink manager follows for
// `bmm://docs/open` — only known destinations — kept here in one place.
//
// Each entry names a docs-hub ARTICLE (the short in-app answer) and, when there is one, the
// bundled documentation PAGE (the full write-up from BMM Docs, read in-app). The page wins
// when both are present: people who click "Learn more" asked for more than the summary.
// `tests/learn-more.test.mjs` fails when an entry points at an article or a page that does
// not exist, so a renamed article cannot leave a dead link behind on some screen.
//
// Public API (stable — other features call it):
//   learnMore(topic, opts?)      → HTML string of the link button, for templates
//   learnMoreEl(topic, opts?)    → the same button as an element, for DOM builders
//   openLearnMore(topic, from?)  → open the documentation for a topic now (e.g. from a menu)
//   hasLearnMore(topic)          → whether the registry knows the topic
//   LEARN_MORE_EVENT             → 'bmm:learn-more-open', bubbles from the clicked link (close your overlay on it)
//   LEARN_MORE                   → the registry itself (read-only)
import { t } from './i18n.js';
import { escAttr } from './utils.js';

export interface LearnTarget {
    /** A docs-hub article id (`id:` in docs/docs-hub.ts). The fallback when there is no page. */
    article?: string;
    /** A bundled documentation page path, as in assets/docs/manifest.json (no trailing slash). */
    page?: string;
    /** An anchor inside the page, without `#`. */
    hash?: string;
}

/** Topic → where its documentation lives. Add topics freely; rename one only with its callers. */
export const LEARN_MORE: Readonly<Record<string, LearnTarget>> = Object.freeze({
    // Library & mods
    'mods':               { article: 'scan', page: 'features/library' },
    'mods-scan':          { article: 'scan', page: 'how-it-works/scanning-cache' },
    'mods-activation':    { article: 'activation', page: 'how-it-works/profiles-activation' },
    'conflicts':          { article: 'conflicts', page: 'how-it-works/conflicts' },
    'load-order':         { article: 'load-order', page: 'how-it-works/load-order' },
    'dependencies':       { article: 'dependencies', page: 'how-it-works/dependencies' },
    'integrity':          { article: 'scan', page: 'how-it-works/integrity-hashing' },
    'content-ids':        { article: 'content-ids', page: 'reference/content-ids' },
    'modlist':            { article: 'what-is-bmm', page: 'features/modlist' },
    'mapper':             { article: 'mod-structure', page: 'features/mapper' },
    // Profiles & packs
    'profiles':           { article: 'first-profile', page: 'features/profiles' },
    'backups':            { article: 'backups', page: 'features/profiles' },
    'modpacks':           { article: 'modpacks', page: 'features/modpacks' },
    'launch-packs':       { article: 'launch-packs', page: 'features/launch-packs' },
    'shared-storage':     { article: 'shared-storage', page: 'features/storage' },
    'storage':            { article: 'storage-manager', page: 'features/storage' },
    'resources':          { article: 'storage-manager', page: 'how-it-works/resources' },
    // The Storage Manager's tabs, each to its own section (agent-bmm-storage)
    'storage-space':      { article: 'storage-manager', page: 'features/storage', hash: 'tabs' },
    'storage-presets':    { article: 'storage-manager', page: 'features/storage', hash: 'presets' },
    // Graphics & display is an app-wide Settings card now; the old key stays as an alias.
    'graphics':           { article: 'what-is-bmm', page: 'features/settings', hash: 'graphics' },
    'storage-graphics':   { article: 'what-is-bmm', page: 'features/settings', hash: 'graphics' },
    'resources-presets':  { article: 'storage-manager', page: 'how-it-works/resources', hash: 'presets' },
    'resources-game':     { article: 'storage-manager', page: 'how-it-works/resources', hash: 'game-mode' },
    'resources-rules':    { article: 'storage-manager', page: 'how-it-works/resources', hash: 'rules' },
    'resources-live':     { article: 'storage-manager', page: 'how-it-works/resources', hash: 'live' },
    // Sharing: server repos
    'repo':               { article: 'server-host', page: 'features/repo' },
    'repo-sync':          { article: 'server-sync', page: 'how-it-works/sync-repos' },
    'repo-host':          { article: 'server-host', page: 'features/repo' },
    'repo-ssh':           { article: 'server-publish-ssh' },
    'repo-keyauth':       { article: 'server-keyauth', page: 'reference/passphrases' },
    'repo-reach':         { article: 'server-reach' },
    'repo-admin':         { article: 'repo-admin' },
    'repo-format':        { article: 'repo-format', page: 'reference/repo-format' },
    // Catalogs, plugins, themes
    'catalogs':           { article: 'catalogs', page: 'features/apps' },
    'catalog-index':      { article: 'catalog-index', page: 'reference/catalog-index' },
    'preset-catalog':     { article: 'preset-catalog' },
    'community':          { article: 'catalogs', page: 'features/community' },
    'plugins':            { article: 'plugins', page: 'features/plugins' },
    'custom-pages':       { article: 'custom-pages' },
    'api':                { article: 'api-reference', page: 'reference/api' },
    'actions':            { article: 'actions-reference', page: 'reference/actions' },
    'themes':             { article: 'themes', page: 'features/themes' },
    'making-themes':      { article: 'themes', page: 'features/making-themes' },
    'custom-markdown':    { article: 'custom-markdown', page: 'reference/custom-markdown' },
    // Automation
    'scheduler':          { article: 'scheduler', page: 'features/scheduler' },
    'bmmscript':          { article: 'bmmscript', page: 'features/bmmscript' },
    'bmmscript-reference':{ article: 'bmmscript-reference', page: 'features/bmmscript-reference' },
    'cli':                { article: 'integrations', page: 'reference/cli' },
    'mcp':                { article: 'plugins', page: 'reference/mcp' },
    // App & settings
    'settings':           { article: 'what-is-bmm', page: 'features/settings' },
    'command-palette':    { article: 'command-palette', page: 'features/command-palette' },
    'shortcuts':          { article: 'commands', page: 'reference/commands' },
    'updates':            { article: 'staying-updated', page: 'getting-started/install' },
    'links':              { article: 'links-and-updates', page: 'reference/links-and-updates' },
    'app-cfg':            { article: 'app-cfg', page: 'reference/app-cfg' },
    'privacy':            { article: 'privacy-telemetry', page: 'features/privacy-telemetry' },
    'security':           { article: 'repo-admin', page: 'how-it-works/security' },
    'translate':          { article: 'translate-bmm', page: 'how-it-works/extending' },
    'integrations':       { article: 'integrations' },
    'performance':        { article: 'benchmarks', page: 'how-it-works/performance' },
    'offline':            { article: 'offline' },
    'feedback':           { article: 'what-is-bmm', page: 'features/feedback' },
    'github-pat':         { article: 'faq-pat', page: 'reference/github-pat' },
    'troubleshooting':    { article: 'faq-crash', page: 'reference/troubleshooting' },
    'tips':               { article: 'what-is-bmm', page: 'reference/tips' },
});

/** Fired (bubbling) from a clicked link just before the docs open. */
export const LEARN_MORE_EVENT = 'bmm:learn-more-open';

export function hasLearnMore(topic: string): boolean {
    return Object.prototype.hasOwnProperty.call(LEARN_MORE, topic);
}

export interface LearnMoreOpts {
    /** Replace the visible words ("Learn more"). Already-translated text. */
    label?: string;
    /** Icon only, the words move to the tooltip/aria-label. For tight card headers. */
    compact?: boolean;
    /** Extra classes on the button. */
    className?: string;
}

const ICON = '<svg class="lm-ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

/** The stylesheet is this helper's own file, linked the first time a link is drawn. */
function ensureCss(): void {
    if (typeof document === 'undefined' || document.getElementById('learn-more-css')) return;
    const link = document.createElement('link');
    link.id = 'learn-more-css';
    link.rel = 'stylesheet';
    link.href = 'css/learn-more.css';
    document.head.appendChild(link);
}

function words(opts?: LearnMoreOpts): { label: string; tip: string } {
    const label = opts?.label || t('learnMore.label') || 'Learn more';
    const tip = t('learnMore.tip') || 'Open the documentation for this, inside BMM';
    return { label, tip };
}

/** HTML for a "Learn more" link button. An unknown topic draws nothing (and warns once). */
export function learnMore(topic: string, opts?: LearnMoreOpts): string {
    if (!hasLearnMore(topic)) { warnUnknown(topic); return ''; }
    ensureCss();
    const { label, tip } = words(opts);
    const cls = `lm-link${opts?.compact ? ' lm-link--compact' : ''}${opts?.className ? ` ${escAttr(opts.className)}` : ''}`;
    const text = opts?.compact ? '' : `<span class="lm-label">${escAttr(label)}</span>`;
    return `<button type="button" class="${cls}" data-learn-more="${escAttr(topic)}" title="${escAttr(tip)}" aria-label="${escAttr(`${label} — ${tip}`)}">${ICON}${text}</button>`;
}

/** The same button as an element. Returns null for an unknown topic. */
export function learnMoreEl(topic: string, opts?: LearnMoreOpts): HTMLButtonElement | null {
    const html = learnMore(topic, opts);
    if (!html) return null;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content.firstElementChild as HTMLButtonElement;
}

/** Open the documentation for a topic: its page when it has one, else its article. */
export function openLearnMore(topic: string, from?: Element | null): void {
    if (!hasLearnMore(topic)) { warnUnknown(topic); return; }
    const target = LEARN_MORE[topic];
    const w = window as any;
    // A modal over the docs view would hide the page that just opened behind it. Close the
    // one the link sits in — unless it asked not to be closed (an editor with unsaved work).
    const overlay = from?.closest<HTMLElement>('.modal-overlay.open');
    if (overlay && overlay.getAttribute('data-prevent-close') !== 'true') overlay.classList.remove('open');
    // Any other container that has to get out of the way (the command palette, a floating
    // panel) listens for this on itself: it bubbles from the link that was clicked.
    try { from?.dispatchEvent(new CustomEvent(LEARN_MORE_EVENT, { bubbles: true, detail: { topic } })); } catch { /* detached */ }
    if (target.page && typeof w.openDocsPage === 'function') { w.openDocsPage(target.page, target.hash); return; }
    if (target.article && typeof w.openDocsArticleById === 'function') { w.openDocsArticleById(target.article); return; }
    // The hub was never initialised (a detached test page): the docs view is still the best
    // answer available.
    (document.querySelector('.nav-item[data-view="docs"]') as HTMLElement | null)?.click();
}

const warned = new Set<string>();
function warnUnknown(topic: string): void {
    if (warned.has(topic)) return;
    warned.add(topic);
    console.warn(`[learn-more] unknown topic "${topic}" — add it to LEARN_MORE in core/learn-more.ts`);
}

// One delegated listener for every link in the app, whatever re-renders under it.
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const el = (e.target instanceof Element) ? e.target.closest<HTMLElement>('[data-learn-more]') : null;
        const topic = el?.dataset.learnMore;
        if (!topic) return;
        e.preventDefault();
        // CAPTURE phase + stop: a link inside a clickable card header or a tab must not also
        // fold the card or switch the tab — those listeners sit below the document.
        e.stopPropagation();
        openLearnMore(topic, el);
    }, true);
}
