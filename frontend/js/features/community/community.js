// @ts-nocheck
// ── BetterCommunity blog (in-app) ─────────────────────────────────────────────
// Reads the BCWEB blog feed (GET <base>/api/blog) and shows it inside BMM with a
// tag dropdown built from the tags the loaded posts actually carry (blog-tags.ts).
// Default is "All"; the choice is remembered for the session. Reading a post pulls
// the full body (GET /api/blog/:slug) and renders it with BMM's shared markdown renderer.
import { invoke } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { renderMarkdown } from '../../ui/update-notes.js';
import { bcRoot, bcApi } from '../../core/links-config.js';
import { openBetterCommunity } from '../../ui/bettercommunity-modal.js';
import { ALL_TAGS, PROJ_LOGO, blogTags, effectiveTag, tagOf } from './blog-tags.js';
// BetterCommunity base resolution is centralized in links-config.ts and driven by
// app.cfg (BCTestMode / BCTestBase): test mode → the staging base, else the production
// `bettercommunity` link. Loaded once at startup (loadBcConfig), so bcRoot() is sync.
// Root-relative media URLs (/api/media/…, /media/…) would resolve against the webview
// origin (tauri.localhost) and 404. Rewrite them to absolute BCWEB URLs so images,
// video, audio and covers actually load. Absolute (https://, data:, //) are left alone.
function absUrl(u) { return u && u.startsWith('/') && !u.startsWith('//') ? `${bcRoot()}${u}` : (u || ''); }
function absMedia(html) { return html.replace(/(\s(?:src|poster)=["'])\/(?!\/)/g, `$1${bcRoot()}/`); }
// ── GitHub-style line diff (mirrors BCWEB merge3.js) ──────────────────────────
// LCS of two line arrays → matched index pairs [i, j] (a[i] === b[j]), increasing.
const DIFF_CAP = 8000;
function lcsPairs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            pairs.push([i, j]);
            i++;
            j++;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1])
            i++;
        else
            j++;
    }
    return pairs;
}
// a → b as an ordered list of { type:'same'|'add'|'del', text }.
function diffLines(a, b) {
    const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n');
    if (A.length > DIFF_CAP || B.length > DIFF_CAP)
        return [{ type: 'del', text: String(a ?? '') }, { type: 'add', text: String(b ?? '') }];
    const out = [];
    let i = 0, j = 0;
    for (const [pi, pj] of lcsPairs(A, B)) {
        while (i < pi)
            out.push({ type: 'del', text: A[i++] });
        while (j < pj)
            out.push({ type: 'add', text: B[j++] });
        out.push({ type: 'same', text: A[i] });
        i++;
        j++;
    }
    while (i < A.length)
        out.push({ type: 'del', text: A[i++] });
    while (j < B.length)
        out.push({ type: 'add', text: B[j++] });
    return out;
}
function lineStat(a, b) {
    const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n');
    if (A.length > DIFF_CAP || B.length > DIFF_CAP)
        return { added: B.length, removed: A.length };
    const matched = lcsPairs(A, B).length;
    return { added: B.length - matched, removed: A.length - matched };
}
// Render a diff as HTML rows (green additions / red deletions / plain context).
function diffHtml(a, b, vsLabel) {
    const rows = diffLines(a, b), st = lineStat(a, b);
    const body = rows.map((r) => {
        const cls = r.type === 'add' ? ' cdiff-add' : r.type === 'del' ? ' cdiff-del' : '';
        const sign = r.type === 'add' ? '+' : r.type === 'del' ? '−' : '';
        return `<div class="cdiff-row${cls}"><span class="cdiff-gutter">${sign}</span><span class="cdiff-text">${escHtml(r.text) || '&nbsp;'}</span></div>`;
    }).join('');
    return `<div class="cdiff-stat"><span class="cdiff-added">+${st.added}</span> <span class="cdiff-removed">−${st.removed}</span> <span class="cdiff-vs">${escHtml(vsLabel)}</span></div><div class="cdiff">${body}</div>`;
}
// The tag filter. It used to be five fixed pills (BMM, All, BSM, Installer, Community);
// it is now a dropdown whose options are read off the loaded feed — see blog-tags.ts for
// why the fixed list was wrong. `_filter` is a tag key from blogTags() or ALL_TAGS, kept
// at module level so it survives leaving the page and coming back.
let _posts = null;
let _loading = false;
let _filter = ALL_TAGS; // show every blog by default (no need to click "show all")
let _search = '';
// Display language for blog content. Follows BMM's language when it's one the blog
// has (en/fr); any other BMM language falls back to English. User-switchable below.
const BLOG_LANGS = [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }];
let _blogLang = getLang() === 'fr' ? 'fr' : 'en';
let _view = null;
let _openSlug = null;
function avatarSrc(a) {
    if (a?.id)
        return `${apiBase()}/avatar/${a.id}?size=64`;
    return typeof a?.avatar === 'string' ? a.avatar : (a?.avatar && a.avatar.image) || '';
}
// Contributor avatar — the real pfp (Boring Avatar via /api/avatar/:id, or an uploaded
// photo) loaded DIRECTLY as an <img> so it shows on first render (no refresh needed);
// the coloured initials sit underneath and reappear if the image fails to load. The
// webview CSP now allows the BCWEB origin, so no native data-URL round-trip is required.
function contribAvatar(a, size = 22) {
    const name = (a?.displayName || '?').trim();
    const src = absUrl(avatarSrc(a));
    const initials = (name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('') || '?').toUpperCase();
    let h = 0;
    for (const c of name)
        h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:hsl(${h % 360} 50% 42%)`;
    const img = src ? `<img class="community-avatar-img" src="${escAttr(src)}" alt="" loading="lazy" data-onerror="hide">` : '';
    return `<span class="community-avatar community-avatar--init" style="${style}">${escHtml(initials)}${img}</span>`;
}
// Author + collaborators row: solo → avatar + name; 2+ → avatars only (like the site).
function authorsRow(p) {
    const list = (p.authors && p.authors.length ? p.authors : (p.author ? [p.author] : []));
    if (!list.length)
        return `<span class="community-authors">${escHtml('BetterCommunity')}</span>`;
    const avatars = list.slice(0, 4).map((a) => contribAvatar(a)).join('');
    const name = list.length === 1 ? `<span class="community-author-name">${escHtml(list[0].displayName || '')}</span>` : '';
    return `<span class="community-authors">${avatars}${name}</span>`;
}
// The API base comes from links-config, not from a second `+ '/api'` here. The two copies
// were the bug: the notification poller had its own and forgot the suffix.
const apiBase = bcApi;
// CORS-safe GET. The webview lives at the tauri.localhost origin, so a direct
// fetch() to the BCWEB API is cross-origin and blocked by CORS preflight (the exact
// "No 'Access-Control-Allow-Origin'" error seen against bettercommunity.ch). Route
// through the native bridge (bc_api_get) instead — Rust isn't subject to CORS. The
// bridge returns the body on 2xx and rejects on non-2xx; we parse JSON and return
// null on any failure (offline, 404, bad JSON) so callers degrade gracefully.
async function bcGet(path) {
    try {
        // quiet: the blog feed is optional and may 404 when the endpoint isn't
        // deployed at the production host — the caller degrades gracefully, so
        // there's no need to spill an RPC warning into the console every time.
        const raw = await invoke('bc_api_get', { url: `${apiBase()}${path}` }, { quiet: true });
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function pick(p) {
    const fr = _blogLang === 'fr';
    return { title: (fr && p.titleFr) || p.title, excerpt: (fr && p.excerptFr) || p.excerpt || '' };
}
function projOf(p) { return p.project?.key || (p.showcaseProject ? 'community' : 'community'); }
function projName(p) { return p.project?.name || p.showcaseProject?.name || 'Community'; }
function locale() { return getLang() === 'fr' ? 'fr-FR' : 'en-US'; }
function fmtDate(d) { try {
    return d ? new Date(d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}
catch {
    return '';
} }
export function initCommunity() {
    // Everything here is built from template literals, so applyTranslations() cannot
    // reach it — the view kept the language it was drawn in. render() is idempotent,
    // so re-running it on a language change is the whole fix.
    if (!window._commLangWired) {
        window._commLangWired = true;
        document.addEventListener('langChanged', () => { try {
            render();
        }
        catch { /* not mounted */ } });
    }
    _view = document.getElementById('view-community');
    window.openCommunityBlog = openCommunity;
    installLightbox();
}
// Called when the user navigates to the view — fetches once, then renders.
export async function openCommunity() {
    if (!_view)
        _view = document.getElementById('view-community');
    if (!_view)
        return;
    _openSlug = null;
    // Always refresh on entering the page so new posts show up without a restart.
    if (!_loading)
        await loadPosts();
    render();
}
async function loadPosts() {
    _loading = true;
    render();
    try {
        const data = await bcGet('/blog');
        if (!data)
            throw new Error('blog load failed');
        _posts = Array.isArray(data.posts) ? data.posts : [];
    }
    catch (e) {
        _posts = null;
        // NO toast. The page itself shows the failure state with a Retry — a toast on top
        // was the same fact twice, and it re-fired on EVERY visit while offline, turning a
        // calm "server unreachable" into nagging. Toasts are for failures the screen does
        // not already show.
    }
    finally {
        _loading = false;
    }
}
function filtered() {
    if (!_posts)
        return [];
    let list = _filter === ALL_TAGS ? _posts : _posts.filter((p) => tagOf(p).key === _filter);
    const q = _search.trim().toLowerCase();
    if (q)
        list = list.filter((p) => { const { title, excerpt } = pick(p); return (title + ' ' + excerpt).toLowerCase().includes(q) || (p.authors || []).some((a) => (a.displayName || '').toLowerCase().includes(q)); });
    return list;
}
function render() {
    if (!_view)
        return;
    if (_openSlug)
        return; // detail view manages its own DOM
    // Before anything reads _filter: a remembered tag the refreshed feed no longer carries
    // falls back to All (effectiveTag says why). No feed yet → the remembered one is kept.
    const tags = Array.isArray(_posts) ? blogTags(_posts) : null;
    _filter = effectiveTag(_filter, tags);
    const tagPicker = tagSelect(tags);
    let bodyHtml;
    if (_loading) {
        // A skeleton in the shape of the real edition (lead + the pair below it), not a generic
        // grid: the point of a skeleton is that the thing that arrives lands where the grey
        // boxes were. Its picture boxes carry the SAME aspect ratios as the real ones, so the
        // swap from skeleton to posts moves nothing either.
        const skCard = '<div class="community-sk-card">'
            + '<div class="skeleton community-sk-cover"></div>'
            + '<div class="community-sk-body">'
            + '<div class="skeleton skeleton-line sk-lg"></div>'
            + '<div class="skeleton skeleton-line"></div>'
            + '<div class="skeleton skeleton-line sk-sm"></div>'
            + '</div></div>';
        bodyHtml = `<div class="community-edition" aria-busy="true" aria-hidden="true">
      <div class="community-sk-lead">
        <div class="skeleton community-sk-lead-cover"></div>
        <div class="community-sk-body">
          <div class="skeleton skeleton-line sk-sm"></div>
          <div class="skeleton skeleton-line sk-lg"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line sk-sm"></div>
        </div>
      </div>
      <div class="community-pair">${skCard}${skCard}</div>
    </div>`;
    }
    else if (_posts === null) {
        // Two different situations, two different sentences: no network at all is the
        // reader's situation; network fine but BCWEB down (or 404ing) is ours. Telling
        // someone offline to "retry" against a server that is fine wastes their click.
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const msg = offline
            ? (t('community.offline') || 'You are offline. The blog will load once the connection is back.')
            : (t('community.serverDown') || 'BetterCommunity is not reachable right now — the server may be down or updating. Everything else in BMM keeps working.');
        bodyHtml = `<div class="community-empty">
      <div class="kit-callout ${offline ? 'kit-callout-info' : 'kit-callout-warning'}" style="max-width:520px;margin:0 auto 14px;text-align:left">
        <span class="kit-callout-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span>
        <div class="kit-callout-body">${escHtml(msg)}</div>
      </div>
      <button class="btn btn-secondary" id="community-retry">${escHtml(t('community.retry') || 'Retry')}</button></div>`;
    }
    else {
        const list = filtered();
        if (list.length) {
            bodyHtml = edition(list);
        }
        else if (_filter !== ALL_TAGS && _posts.length) {
            // Nothing in this project yet, but other posts exist — nudge to "All".
            bodyHtml = `<div class="community-empty"><p>${escHtml(t('community.noneHere') || 'No posts in this section yet.')}</p>
        <button class="btn btn-secondary" id="community-show-all">${escHtml(t('community.showAll') || 'Show all posts')}</button></div>`;
        }
        else {
            bodyHtml = `<div class="community-empty"><p>${escHtml(t('community.none') || 'No posts here yet.')}</p></div>`;
        }
    }
    _view.innerHTML = `
    <div class="view-header" style="margin-bottom:24px;">
      <div>
        <h1 class="view-title">${escHtml(t('nav.community') || 'BetterCommunity Blog')}</h1>
        <p class="view-subtitle">${escHtml(t('community.subtitle') || 'News & posts from the BetterCommunity blogs.')}</p>
      </div>
      <div class="view-actions">
        <!-- Before "Open website", because the question it answers comes first: this screen
             is a feed from a place the app never named, and sending somebody to a browser to
             find out what that place is was the only answer available. -->
        <button class="btn btn-secondary" id="community-about" style="gap:6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          ${escHtml(t('community.about') || 'What is BetterCommunity?')}
        </button>
        <button class="btn btn-secondary" id="community-open-web" style="gap:6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          ${escHtml(t('community.openWeb') || 'Open website')}
        </button>
        <button class="btn btn-secondary" id="community-refresh" data-tooltip="${escAttr(t('community.refresh') || 'Refresh')}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>
    </div>
    <div class="community-toolbar">
      <div class="community-filters">${tagPicker}</div>
      <div class="community-toolbar-right">
        <div class="community-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="community-search" id="community-search" placeholder="${escAttr(t('community.search') || 'Search posts…')}" value="${escAttr(_search)}" />
        </div>
        <select class="community-lang" id="community-lang" data-tooltip="${escAttr(t('community.lang') || 'Blog language')}">
          ${BLOG_LANGS.map((l) => `<option value="${l.code}"${l.code === _blogLang ? ' selected' : ''}>${escHtml(l.label)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${bodyHtml}`;
    wire();
}
// Reaction types are stored as icon *names* (see BCWEB reactions.jsx). Render them as
// emoji here so they show as real icons, not raw text like "party" (webview-safe, no
// CDN/mask dependency).
const REACTION_EMOJI = {
    'thumbs-up': '👍', heart: '❤️', fire: '🔥', party: '🎉', star: '⭐',
    rocket: '🚀', laugh: '😂', smile: '🙂', sparkles: '✨', check: '✅',
};
// ── The edition layout ────────────────────────────────────────────────────────
// The same rhythm as the website's public blog (BCWEB blog.jsx BlogList): the newest post
// leads with a large card (picture beside the text when there is room, stacked below when
// there is not), the next two sit side by side, and everything older is an archive grouped
// by month — a dateline, a title, two lines of summary, a small picture. Three shapes
// because the posts are not equal: the one that landed this morning is news, the one from
// March is a reference.
//
// Two properties are structural rather than cosmetic, and both are held in CSS:
//   · every picture box reserves its height BEFORE the picture exists (an aspect-ratio, or
//     a min-height for the lead's side-by-side cell), so the list cannot move while covers
//     arrive over a slow link — which is the normal case here, since the covers come from
//     bettercommunity.ch and the app is on someone's desktop;
//   · a post with NO cover gets drawn art instead of a blank: the project's mark over one
//     of three patterns, taken in turn down the page so two neighbours never repeat. The
//     turn is the post's index in the list that is actually on screen, so it stays even
//     after a filter or a search removes posts from the middle.
// Project logo (like the website's coverless cards) — the white rounded-chip marks, falling
// back to a monogram for a project with no bundled logo. `sizeCls` scales the mark to the
// shape it sits in: the lead's picture is a page-wide panel, the archive's is a thumbnail.
// PROJ_LOGO lives in blog-tags.ts: the tag dropdown draws the same marks.
function projMono(p, sizeCls = '') {
    const key = projOf(p);
    const logo = PROJ_LOGO[key];
    if (logo)
        return `<img class="community-cover-logo${sizeCls}" src="${logo}" alt="" />`;
    const txt = (key || 'BC').slice(0, 3).toUpperCase();
    return `<span class="community-cover-mono${sizeCls} community-badge--${escAttr(key)}">${escHtml(txt)}</span>`;
}
// One picture box, for every shape on the page. The box's height comes from `cls` (a CSS
// aspect-ratio or min-height), never from its content, so it is the same before and after
// the cover loads. `art` is the post's position in the visible list; `% 3` turns it into
// one of the three patterns, which is what stops neighbours from matching.
function coverBox(p, cls, art, sizeCls) {
    if (p.cover)
        return `<div class="${cls} community-cover-img" style="background-image:url('${escAttr(absUrl(p.cover))}')"></div>`;
    return `<div class="${cls} community-art community-art-${art % 3}" aria-hidden="true">${projMono(p, sizeCls)}</div>`;
}
// The line under every post: its date, plus the two facts a reader needs before clicking —
// that this one is a draft, and that this one is not in the language they picked.
function metaLine(p) {
    const draft = p.status && p.status !== 'PUBLISHED'
        ? `<span class="community-draft">${escHtml(t('community.draft'))}</span>` : '';
    // The feed carries titleFr/excerptFr, not the body — so this says exactly what the reader
    // can see from the list (an English title in a French listing), and the article view keeps
    // its own, fuller banner about the body.
    const untr = (_blogLang === 'fr' && !p.titleFr)
        ? `<span class="community-untr">${escHtml(t('community.notTranslated'))}</span>` : '';
    return `<span class="community-meta-line"><time datetime="${escAttr(p.publishedAt || '')}">${escHtml(fmtDate(p.publishedAt))}</time>${draft}${untr}</span>`;
}
function card(p, art) {
    const { title, excerpt } = pick(p);
    return `
    <button class="community-card" data-slug="${escAttr(p.slug)}">
      ${coverBox(p, 'community-card-cover', art, ' community-mark--md')}
      <div class="community-card-body">
        <span class="community-badge community-badge--${escAttr(projOf(p))}">${escHtml(projName(p))}</span>
        <h3 class="community-card-title">${escHtml(title)}</h3>
        ${excerpt ? `<p class="community-card-excerpt">${escHtml(excerpt)}</p>` : ''}
        <div class="community-card-meta">
          ${authorsRow(p)}
          ${metaLine(p)}
        </div>
      </div>
    </button>`;
}
// The lead: picture beside the text on a wide window, stacked below on a narrow one.
// `latest` is false once a filter or a search is on, because then the first post is the
// newest of what matched, not the newest there is — the shape stays, the claim does not.
function leadPost(p, latest) {
    const { title, excerpt } = pick(p);
    return `
    <button class="community-lead" data-slug="${escAttr(p.slug)}">
      ${coverBox(p, 'community-lead-cover', 0, ' community-mark--lg')}
      <div class="community-lead-body">
        <div class="community-lead-tags">
          ${latest ? `<span class="community-lead-latest">${escHtml(t('community.latest'))}</span>` : ''}
          <span class="community-badge community-badge--${escAttr(projOf(p))}">${escHtml(projName(p))}</span>
        </div>
        <h2 class="community-lead-title">${escHtml(title)}</h2>
        ${excerpt ? `<p class="community-lead-excerpt">${escHtml(excerpt)}</p>` : ''}
        <div class="community-card-meta">
          ${authorsRow(p)}
          ${metaLine(p)}
        </div>
      </div>
    </button>`;
}
// One archive line: the day set like a dateline (hidden when the row is too narrow to
// carry it — the meta line already has the full date), then the text, then a thumbnail.
function archiveRow(p, art) {
    const { title, excerpt } = pick(p);
    let day = '', weekday = '';
    try {
        const d = p.publishedAt ? new Date(p.publishedAt) : null;
        if (d && !isNaN(d.getTime())) {
            day = String(d.getDate());
            weekday = d.toLocaleDateString(locale(), { weekday: 'short' });
        }
    }
    catch { /* an unparseable date leaves the dateline empty rather than printing NaN */ }
    return `
    <button class="community-arch" data-slug="${escAttr(p.slug)}">
      <span class="community-arch-date" aria-hidden="true"><b>${escHtml(day)}</b><i>${escHtml(weekday)}</i></span>
      <span class="community-arch-body">
        <span class="community-badge community-badge--${escAttr(projOf(p))}">${escHtml(projName(p))}</span>
        <span class="community-arch-title">${escHtml(title)}</span>
        ${excerpt ? `<span class="community-arch-excerpt">${escHtml(excerpt)}</span>` : ''}
        <span class="community-card-meta community-arch-meta">
          ${authorsRow(p)}
          ${metaLine(p)}
        </span>
      </span>
      ${coverBox(p, 'community-arch-cover', art, ' community-mark--sm')}
    </button>`;
}
// Month headings for the archive, in the reader's language. A post with no date files under
// a heading that says so rather than under an invented month.
function byMonth(list) {
    const groups = [];
    for (const p of list) {
        let d = null;
        try {
            const x = p.publishedAt ? new Date(p.publishedAt) : null;
            if (x && !isNaN(x.getTime()))
                d = x;
        }
        catch { /* undated */ }
        const key = d ? `${d.getFullYear()}-${d.getMonth()}` : 'none';
        let g = groups[groups.length - 1];
        if (!g || g.key !== key) {
            let label = t('community.undated');
            if (d) {
                try {
                    label = d.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
                }
                catch {
                    label = String(d.getFullYear());
                }
            }
            g = { key, label, posts: [] };
            groups.push(g);
        }
        g.posts.push(p);
    }
    return groups;
}
function edition(list) {
    // The eyebrow only claims "Latest" when the first post really is the newest there is.
    const latest = _filter === ALL_TAGS && !_search.trim();
    const art = new Map(list.map((p, i) => [p, i]));
    const pair = list.slice(1, 3);
    const archive = byMonth(list.slice(3));
    return `<div class="community-edition">
    ${leadPost(list[0], latest)}
    ${pair.length ? `<div class="community-pair${pair.length > 1 ? '' : ' community-pair--one'}">${pair.map((p) => card(p, art.get(p) || 0)).join('')}</div>` : ''}
    ${archive.length ? `<div class="community-archive">
      <h2 class="community-archive-head">${escHtml(t('community.archive'))}</h2>
      ${archive.map((g) => `<section class="community-month" aria-label="${escAttr(g.label)}">
        <h3 class="community-month-label">${escHtml(g.label)}</h3>
        <div class="community-month-list">${g.posts.map((p) => archiveRow(p, art.get(p) || 0)).join('')}</div>
      </section>`).join('')}
    </div>` : ''}
  </div>`;
}
// ── The tag dropdown ──────────────────────────────────────────────────────────────
// A plain <select>, which BMM's custom-select (ui/custom-select.ts) turns into its themeable,
// keyboard-driven listbox: `data-icon` becomes the logo beside each option, `data-desc` the
// post count under it, and `data-csel-trigger-icon` puts the chosen tag's logo on the
// closed control too — BCWEB's TypeTag, logo then name.
//
// `tags` is null while there is no feed (loading, offline, server down): the control is then
// shown disabled on "All" rather than removed, so the toolbar does not change shape when the
// posts arrive.
const ALL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>';
function tagLabel(label) { return label ?? t('community.filter.community'); }
function tagCount(n) { return n === 1 ? t('community.filter.countOne') : t('community.filter.count', { n: String(n) }); }
// The tag's mark, at dropdown size. A bundled logo or the page's own icon when there is one;
// otherwise the same coloured monogram the coverless cards fall back to.
function tagMark(tag) {
    if (tag.logo)
        return `<img class="community-cover-logo community-mark--xs" src="${escAttr(absUrl(tag.logo))}" alt="" />`;
    // BSM stays BSM; a longer single word keeps its first two letters; several words give
    // their initials ("Cool Page" → CP).
    const words = (tagLabel(tag.label) || 'BC').trim().split(/\s+/).filter(Boolean);
    if (!words.length)
        words.push('BC');
    const txt = (words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 2)
        : words[0].length <= 3 ? words[0] : words[0].slice(0, 2)).toUpperCase();
    return `<span class="community-cover-mono community-mark--xs community-badge--${escAttr(tag.projectKey)}">${escHtml(txt)}</span>`;
}
function tagSelect(tags) {
    const total = (tags || []).reduce((n, tg) => n + tg.count, 0);
    const opt = (value, label, icon, count) => `<option value="${escAttr(value)}"${value === _filter ? ' selected' : ''} data-icon="${escAttr(icon)}"${count == null ? '' : ` data-desc="${escAttr(tagCount(count))}"`}>${escHtml(label)}</option>`;
    const options = [opt(ALL_TAGS, t('community.filter.all'), ALL_ICON, tags ? total : null)]
        .concat((tags || []).map((tg) => opt(tg.key, tagLabel(tg.label), tagMark(tg), tg.count)))
        .join('');
    const name = t('community.filter.label');
    return `<select class="community-tag-select" id="community-tag" aria-label="${escAttr(name)}" data-tooltip="${escAttr(name)}" data-csel-trigger-icon="on"${tags && tags.length ? '' : ' disabled'}>${options}</select>`;
}
function wire() {
    if (!_view)
        return;
    const tagSel = _view.querySelector('#community-tag');
    if (tagSel)
        tagSel.addEventListener('change', () => {
            _filter = tagSel.value || ALL_TAGS;
            render();
            // render() replaced the toolbar, and with it the dropdown the keyboard was on. The new
            // <select> is enhanced by custom-select's MutationObserver, which runs after this
            // handler returns — so the focus goes back in the next task, onto the new trigger. A
            // timer rather than requestAnimationFrame: rAF does not run while the window is hidden.
            setTimeout(() => _view?.querySelector('.bmm-csel-trigger.community-tag-select')?.focus({ preventScroll: true }), 0);
        });
    // Cards AND the featured hero both carry data-slug → open the post.
    _view.querySelectorAll('[data-slug]').forEach((el) => el.addEventListener('click', () => {
        openPost(el.dataset.slug);
    }));
    _view.querySelector('#community-show-all')?.addEventListener('click', () => { _filter = ALL_TAGS; render(); });
    _view.querySelector('#community-refresh')?.addEventListener('click', async () => { _posts = null; await loadPosts(); render(); });
    _view.querySelector('#community-retry')?.addEventListener('click', async () => { await loadPosts(); render(); });
    _view.querySelector('#community-about')?.addEventListener('click', () => openBetterCommunity());
    _view.querySelector('#community-open-web')?.addEventListener('click', () => openExternal(`${bcRoot()}/blog`));
    const lang = _view.querySelector('#community-lang');
    if (lang)
        lang.addEventListener('change', () => { _blogLang = lang.value; render(); });
    const search = _view.querySelector('#community-search');
    if (search)
        search.addEventListener('input', () => {
            _search = search.value;
            render();
            // re-render replaced the DOM — restore focus + caret to the (new) search box.
            const again = _view?.querySelector('#community-search');
            if (again) {
                again.focus();
                again.setSelectionRange(again.value.length, again.value.length);
            }
        });
}
function openExternal(url) {
    invoke('open_external_url', { url }).catch(() => { try {
        window.open(url, '_blank');
    }
    catch { } });
}
// Click any image in a post / comment / history body → blow it up full-screen; click
// anywhere (or Esc) to shrink it back. One document-level delegated handler covers the
// article view AND the body-appended overlays (history/comments), incl. future ones.
function openLightbox(src) {
    if (!src)
        return;
    const ov = document.createElement('div');
    ov.className = 'community-lightbox';
    ov.innerHTML = `<img src="${escAttr(src)}" alt="" /><button class="community-lightbox-close" aria-label="${escAttr(t('community.close') || 'Close')}">✕</button>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
    ov.addEventListener('click', close); // click the backdrop OR the image → shrink back
    const onEsc = (e) => { if (e.key === 'Escape') {
        e.stopPropagation();
        close();
    } };
    document.addEventListener('keydown', onEsc);
    requestAnimationFrame(() => ov.classList.add('open'));
}
function installLightbox() {
    if (window.__bcLightbox)
        return;
    window.__bcLightbox = true;
    document.addEventListener('click', (e) => {
        const img = e.target?.closest?.('.community-article-body img, .community-comment-body img, .community-history-preview img');
        if (!img || img.closest('.community-lightbox'))
            return;
        e.preventDefault();
        openLightbox(img.currentSrc || img.src);
    });
}
async function openPost(slug) {
    if (!_view)
        return;
    _openSlug = slug;
    _view.innerHTML = `<div class="community-empty"><div class="community-spinner"></div></div>`;
    let post = null;
    try {
        const data = await bcGet(`/blog/${encodeURIComponent(slug)}`);
        if (data)
            post = data.post;
    }
    catch { }
    if (!post) {
        toast(t('community.loadError') || 'Could not load the post.', 'error');
        _openSlug = null;
        return render();
    }
    const fr = _blogLang === 'fr';
    const translated = fr ? !!(post.bodyFr && String(post.bodyFr).trim()) : true;
    const title = (fr && post.titleFr) || post.title;
    const body = (fr && post.bodyFr) || post.body || '';
    const untranslated = !translated
        ? `<div class="community-untranslated" role="note">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
         <span><b>${escHtml(t('community.untranslatedTag') || 'Non traduit')}</b> — ${escHtml(t('community.untranslated') || "cet article n'est pas encore traduit en français ; version anglaise affichée.")}</span>
       </div>`
        : '';
    const authorList = [post.author, ...(post.coAuthors || [])].filter(Boolean);
    const authorsHtml = authorList.length
        ? `<span class="community-authors">${authorList.slice(0, 5).map((a) => contribAvatar(a, 26)).join('')}<span class="community-author-name">${escHtml(authorList.map((a) => a.displayName).filter(Boolean).join(', '))}</span></span>`
        : `<span>${escHtml('BetterCommunity')}</span>`;
    const counts = post.reactionCounts || {};
    const reactions = (post.reactionsEnabled && (post.reactionTypes || []).length)
        ? `<div class="community-reactions">${post.reactionTypes.map((rt) => `<span class="community-reaction" data-tooltip="${escAttr(rt)}"><span class="community-reaction-emoji">${REACTION_EMOJI[rt] || '⭐'}</span><span class="community-reaction-count">${counts[rt] || 0}</span></span>`).join('')}
       <span class="community-reaction-hint">${escHtml(t('community.reactHint') || 'React on the website')}</span></div>`
        : '';
    _view.innerHTML = `
    <div class="community-article">
      <button class="btn btn-secondary community-back">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        ${escHtml(t('community.back') || 'Back')}
      </button>
      ${post.cover ? `<div class="community-article-cover" style="background-image:url('${escAttr(absUrl(post.cover))}')"></div>` : ''}
      <span class="community-badge community-badge--${escAttr(post.project?.key || 'community')}">${escHtml(post.project?.name || post.showcaseProject?.name || 'Community')}</span>
      <h1 class="community-article-title">${escHtml(title)}</h1>
      <div class="community-article-meta">
        ${authorsHtml}
        <span>·</span>
        <button class="community-article-date" data-tooltip="${escAttr(t('community.viewHistory') || 'View edit history')}">${escHtml(fmtDate(post.publishedAt))}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.55;margin-left:4px;vertical-align:-1px"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg></button>
      </div>
      ${untranslated}
      <div class="community-article-body md-body">${absMedia(renderMarkdown(body, { baseUrl: bcRoot() }))}</div>
      ${reactions}
      <div class="community-article-footer">
        ${post.commentsPublic ? `<button class="btn btn-secondary community-open-comments">💬 ${escHtml(t('community.comments') || 'Comments')}</button>` : ''}
        <button class="btn btn-secondary community-open-post-web">${escHtml(t('community.openWeb') || 'Open on website')}</button>
      </div>
    </div>`;
    _view.querySelector('.community-back')?.addEventListener('click', () => { _openSlug = null; render(); });
    _view.querySelector('.community-open-post-web')?.addEventListener('click', () => openExternal(`${bcRoot()}/blog/${slug}`));
    _view.querySelector('.community-open-comments')?.addEventListener('click', () => { if (post.id)
        openComments(post.id); });
    _view.querySelector('.community-article-date')?.addEventListener('click', () => { if (post.id)
        openHistory(post.id); });
    // Any link inside the article body (download/open buttons, doc-block links, inline
    // links) must open in the user's real browser — not navigate the webview (which left
    // you stuck on the download URL). Delegated so it also covers dynamically-built blocks.
    // Blog posts carry code as often as prose; highlight what marked labelled.
    void import('../../ui/code-highlight.js').then((m) => m.highlightIn(_view)).catch(() => { });
    _view.querySelector('.community-article-body')?.addEventListener('click', (e) => {
        const a = e.target?.closest?.('a[href]');
        if (!a)
            return;
        const href = a.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href)) {
            e.preventDefault();
            openExternal(href);
        }
    });
}
// Read-only edit-history viewer (public users see a PUBLISHED post's changelog; the
// BCWEB endpoint gates drafts/restore). Overlay appended to <body> so a re-render of the
// article view doesn't wipe it.
async function openHistory(postId) {
    const L = {
        title: t('community.history.title') || 'Edit history',
        readonly: t('community.history.readonly') || 'Read-only version history for this published post.',
        none: t('community.history.none') || 'No history available for this post.',
        latest: t('community.history.latest') || 'Latest', by: t('community.history.by') || 'by',
        rendered: t('community.history.rendered') || 'Rendered', diff: t('community.history.diff') || 'Diff',
        first: t('community.history.firstVersion') || 'First version — nothing to compare against.',
        vsPrev: t('community.history.vsPrev') || 'vs previous version', close: t('community.close') || 'Close',
    };
    const ov = document.createElement('div');
    ov.className = 'community-history-overlay';
    ov.innerHTML = `<div class="community-history-modal">
    <div class="community-history-head"><span>${escHtml(L.title)}</span><button class="community-history-close" aria-label="${escAttr(L.close)}" data-tooltip="${escAttr(L.close)}">✕</button></div>
    <div class="community-history-content"><div class="community-empty"><div class="community-spinner"></div></div></div>
    <div class="community-history-foot">${escHtml(L.readonly)}</div>
  </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
    ov.addEventListener('click', (e) => { if (e.target === ov)
        close(); });
    ov.querySelector('.community-history-close')?.addEventListener('click', close);
    const onEsc = (e) => { if (e.key === 'Escape')
        close(); };
    document.addEventListener('keydown', onEsc);
    let revs = [];
    {
        const d = await bcGet(`/blog/${postId}/history`);
        if (d)
            revs = d.revisions || [];
    }
    const content = ov.querySelector('.community-history-content');
    if (!revs.length) {
        content.innerHTML = `<div class="community-empty"><p>${escHtml(L.none)}</p></div>`;
        return;
    }
    // View state: which revision, rendered-vs-diff, and en-vs-fr language.
    let mode = 'rendered';
    let lang = _blogLang === 'fr' ? 'fr' : 'en';
    let activeIdx = 0;
    const revCache = {};
    const bodyOf = (rev) => (lang === 'fr' ? (rev?.bodyFr ?? rev?.body) : rev?.body) || '';
    const fetchRev = async (revId) => {
        if (revCache[revId])
            return revCache[revId];
        {
            const d = await bcGet(`/blog/${postId}/history/${revId}`);
            if (d)
                return (revCache[revId] = d.revision);
        }
        return null;
    };
    content.innerHTML = `
    <div class="community-history-list">${revs.map((rv, i) => `<button class="community-history-item${i === 0 ? ' active' : ''}" data-idx="${i}" data-rev="${escAttr(rv.id)}">
        <span class="chi-v">v${rv.version}${i === 0 ? ` · ${escHtml(L.latest)}` : ''}</span>
        <span class="chi-meta">${rv.editor ? escHtml(`${L.by} ${rv.editor}`) + ' · ' : ''}${escHtml(fmtDate(rv.createdAt))}</span>
      </button>`).join('')}</div>
    <div class="community-history-main">
      <div class="community-history-toolbar">
        <div class="community-seg" data-seg="mode">
          <button data-val="rendered" class="active">${escHtml(L.rendered)}</button>
          <button data-val="diff">${escHtml(L.diff)}</button>
        </div>
        <div class="community-seg community-seg-lang" data-seg="lang" hidden>
          <button data-val="en"${lang === 'en' ? ' class="active"' : ''}>EN</button>
          <button data-val="fr"${lang === 'fr' ? ' class="active"' : ''}>FR</button>
        </div>
      </div>
      <div class="community-history-preview md-body"></div>
    </div>`;
    const preview = content.querySelector('.community-history-preview');
    const langSeg = content.querySelector('[data-seg="lang"]');
    const paint = async () => {
        preview.innerHTML = `<div class="community-empty"><div class="community-spinner"></div></div>`;
        const cur = await fetchRev(revs[activeIdx].id);
        if (!cur) {
            preview.innerHTML = '';
            return;
        }
        // FR toggle only makes sense when a French body exists for this or the compared version.
        const older = revs[activeIdx + 1] ? await fetchRev(revs[activeIdx + 1].id) : null;
        const hasFr = !!(cur.bodyFr || older?.bodyFr);
        langSeg.hidden = !hasFr;
        if (!hasFr)
            lang = 'en';
        if (mode === 'diff') {
            preview.classList.add('community-history-preview--diff');
            preview.innerHTML = older
                ? diffHtml(bodyOf(older), bodyOf(cur), L.vsPrev)
                : `<div class="community-empty"><p>${escHtml(L.first)}</p></div>`;
        }
        else {
            preview.classList.remove('community-history-preview--diff');
            preview.innerHTML = absMedia(renderMarkdown(bodyOf(cur) || '', { baseUrl: bcRoot() }));
        }
    };
    content.querySelectorAll('.community-history-item').forEach((b) => b.addEventListener('click', () => {
        activeIdx = Number(b.dataset.idx);
        content.querySelectorAll('.community-history-item').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        paint();
    }));
    content.querySelectorAll('.community-seg').forEach((seg) => seg.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
        const which = seg.dataset.seg, val = btn.dataset.val;
        if (which === 'mode')
            mode = val;
        else
            lang = val;
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        paint();
    })));
    paint();
}
// Read-only comments viewer (only reachable when the post is commentsPublic). Threads
// render with the author pfp + full markdown body; posting is done on the website.
async function openComments(postId) {
    const L = {
        title: t('community.comments.title') || 'Comments', none: t('community.comments.none') || 'No comments yet.',
        readonly: t('community.comments.readonly') || 'Read-only — comment on the website.',
        resolved: t('community.comments.resolved') || 'resolved', edited: t('community.comments.edited') || 'edited',
        history: t('community.comments.viewHistory') || 'Edit history', historyNone: t('community.comments.historyNone') || 'No edit history for this comment.',
        latest: t('community.history.latest') || 'Latest', by: t('community.history.by') || 'by',
        rendered: t('community.history.rendered') || 'Rendered', diff: t('community.history.diff') || 'Diff',
        first: t('community.history.firstVersion') || 'First version — nothing to compare against.',
        vsPrev: t('community.history.vsPrev') || 'vs previous version', close: t('community.close') || 'Close',
    };
    const ov = document.createElement('div');
    ov.className = 'community-history-overlay';
    ov.innerHTML = `<div class="community-history-modal">
    <div class="community-history-head"><span>${escHtml(L.title)}</span><button class="community-history-close" aria-label="${escAttr(L.close)}" data-tooltip="${escAttr(L.close)}">✕</button></div>
    <div class="community-comments-content"><div class="community-empty"><div class="community-spinner"></div></div></div>
    <div class="community-history-foot">${escHtml(L.readonly)}</div>
  </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
    ov.addEventListener('click', (e) => { if (e.target === ov)
        close(); });
    ov.querySelector('.community-history-close')?.addEventListener('click', close);
    const onEsc = (e) => { if (e.key === 'Escape')
        close(); };
    document.addEventListener('keydown', onEsc);
    let comments = [];
    {
        const d = await bcGet(`/blog/${postId}/comments`);
        if (d)
            comments = d.comments || [];
    }
    const content = ov.querySelector('.community-comments-content');
    const roots = comments.filter((c) => !c.parentId);
    if (!roots.length) {
        content.innerHTML = `<div class="community-empty"><p>${escHtml(L.none)}</p></div>`;
        return;
    }
    const one = (c, isReply = false) => `
    <div class="community-comment${isReply ? ' community-comment-reply' : ''}">
      <div class="community-comment-head">${contribAvatar({ displayName: c.author?.name, avatar: c.author?.avatar }, 24)}
        <span class="community-comment-name">${escHtml(c.author?.name || '')}</span>
        <span class="community-comment-time">${escHtml(fmtDate(c.createdAt))}${c.edited ? ' · <button class="community-comment-hist" data-cid="' + escAttr(c.id) + '">' + escHtml(L.edited) + '</button>' : ''}</span>
        ${c.resolved ? `<span class="community-comment-resolved">✓ ${escHtml(L.resolved)}</span>` : ''}</div>
      ${c.anchor && !isReply ? `<div class="community-comment-anchor"># ${escHtml(c.anchor)}</div>` : ''}
      <div class="community-comment-body md-body">${absMedia(renderMarkdown(c.body || '', { baseUrl: bcRoot() }))}</div>
    </div>`;
    content.innerHTML = roots.map((c) => one(c) + comments.filter((r) => r.parentId === c.id).map((r) => one(r, true)).join('')).join('');
    // Links inside comment bodies open in the real browser, not the webview.
    content.addEventListener('click', (e) => {
        const target = e.target;
        const histBtn = target?.closest?.('.community-comment-hist');
        if (histBtn) {
            e.preventDefault();
            openCommentHistory(postId, histBtn.dataset.cid, L);
            return;
        }
        const a = target?.closest?.('a[href]');
        const href = a?.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href)) {
            e.preventDefault();
            openExternal(href);
        }
    });
}
// Per-comment edit history (nested overlay). Same git-style diff + rendered toggle as
// the post history; comment revisions are single-language so there's no EN/FR switch.
async function openCommentHistory(postId, cid, L) {
    const ov = document.createElement('div');
    ov.className = 'community-history-overlay community-history-overlay--nested';
    ov.innerHTML = `<div class="community-history-modal">
    <div class="community-history-head"><span>${escHtml(L.history)}</span><button class="community-history-close" aria-label="${escAttr(L.close)}" data-tooltip="${escAttr(L.close)}">✕</button></div>
    <div class="community-history-content"><div class="community-empty"><div class="community-spinner"></div></div></div>
    <div class="community-history-foot">${escHtml(L.readonly)}</div>
  </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
    ov.addEventListener('click', (e) => { if (e.target === ov)
        close(); });
    ov.querySelector('.community-history-close')?.addEventListener('click', close);
    const onEsc = (e) => { if (e.key === 'Escape') {
        e.stopPropagation();
        close();
    } };
    document.addEventListener('keydown', onEsc);
    let revs = [];
    {
        const d = await bcGet(`/blog/${postId}/comments/${cid}/history`);
        if (d)
            revs = d.revisions || [];
    }
    const content = ov.querySelector('.community-history-content');
    if (!revs.length) {
        content.innerHTML = `<div class="community-empty"><p>${escHtml(L.historyNone)}</p></div>`;
        return;
    }
    let mode = 'rendered';
    let activeIdx = 0;
    content.innerHTML = `
    <div class="community-history-list">${revs.map((rv, i) => `<button class="community-history-item${i === 0 ? ' active' : ''}" data-idx="${i}">
        <span class="chi-v">v${revs.length - i}${i === 0 ? ` · ${escHtml(L.latest)}` : ''}</span>
        <span class="chi-meta">${rv.editor ? escHtml(`${L.by} ${rv.editor}`) + ' · ' : ''}${escHtml(fmtDate(rv.createdAt))}</span>
      </button>`).join('')}</div>
    <div class="community-history-main">
      <div class="community-history-toolbar">
        <div class="community-seg" data-seg="mode">
          <button data-val="rendered" class="active">${escHtml(L.rendered)}</button>
          <button data-val="diff">${escHtml(L.diff)}</button>
        </div>
      </div>
      <div class="community-history-preview md-body"></div>
    </div>`;
    const preview = content.querySelector('.community-history-preview');
    const paint = () => {
        const cur = revs[activeIdx], older = revs[activeIdx + 1];
        if (mode === 'diff') {
            preview.classList.add('community-history-preview--diff');
            preview.innerHTML = older
                ? diffHtml(older.body || '', cur.body || '', L.vsPrev)
                : `<div class="community-empty"><p>${escHtml(L.first)}</p></div>`;
        }
        else {
            preview.classList.remove('community-history-preview--diff');
            preview.innerHTML = absMedia(renderMarkdown(cur.body || '', { baseUrl: bcRoot() }));
        }
    };
    content.querySelectorAll('.community-history-item').forEach((b) => b.addEventListener('click', () => {
        activeIdx = Number(b.dataset.idx);
        content.querySelectorAll('.community-history-item').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        paint();
    }));
    content.querySelectorAll('[data-seg="mode"] button').forEach((btn) => btn.addEventListener('click', () => {
        mode = btn.dataset.val;
        content.querySelectorAll('[data-seg="mode"] button').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        paint();
    }));
    paint();
}
//# sourceMappingURL=community.js.map