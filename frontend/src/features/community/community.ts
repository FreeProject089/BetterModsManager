// @ts-nocheck
// ── BetterCommunity blog (in-app) ─────────────────────────────────────────────
// Reads the BCWEB blog feed (GET <base>/api/blog) and shows it inside BMM with
// project filters. Default filter is BMM-only; the user can switch to "All" or any
// other project. Reading a post pulls the full body (GET /api/blog/:slug) and
// renders it with BMM's shared markdown renderer.

import { invoke } from '../../core/api.js';
import { t, getLang } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { renderMarkdown } from '../../ui/update-notes.js';
import { getLinks } from '../../core/links-config.js';

// Same BetterCommunity base resolution as the account link in settings.ts: a dev
// test-mode override (Caddy on :80/localhost), else the configured production site.
const BC_TEST_MODE = true;
const BC_TEST_BASE = 'http://localhost:5176/';
function bcRoot(): string {
  return (BC_TEST_MODE ? BC_TEST_BASE : (getLinks()?.bettercommunity || 'https://bettercommunity.ch/')).replace(/\/+$/, '');
}
// Root-relative media URLs (/api/media/…, /media/…) would resolve against the webview
// origin (tauri.localhost) and 404. Rewrite them to absolute BCWEB URLs so images,
// video, audio and covers actually load. Absolute (https://, data:, //) are left alone.
function absUrl(u?: string): string { return u && u.startsWith('/') && !u.startsWith('//') ? `${bcRoot()}${u}` : (u || ''); }
function absMedia(html: string): string { return html.replace(/(\s(?:src|poster)=["'])\/(?!\/)/g, `$1${bcRoot()}/`); }

type Author = { id?: string; displayName?: string; avatar?: any };
type Post = {
  slug: string; title: string; titleFr?: string; excerpt?: string; excerptFr?: string;
  cover?: string; publishedAt?: string; author?: Author; authors?: Author[];
  project?: { key: string; name: string }; showcaseProject?: { slug: string; name: string };
  reactionTypes?: string[]; reactionsEnabled?: boolean;
};

// The four fixed BMM blog "spaces" + an All pill. Default is BMM.
const FILTERS = [
  { key: 'bmm', label: 'BMM' },
  { key: 'all', label: 'community.filter.all' },
  { key: 'bsm', label: 'BSM' },
  { key: 'installer', label: 'community.filter.installer' },
  { key: 'community', label: 'community.filter.community' },
];

let _posts: Post[] | null = null;
let _loading = false;
let _filter = 'all'; // show every blog by default (no need to click "show all")
let _search = '';
// Display language for blog content. Follows BMM's language when it's one the blog
// has (en/fr); any other BMM language falls back to English. User-switchable below.
const BLOG_LANGS = [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }];
let _blogLang = getLang() === 'fr' ? 'fr' : 'en';
let _view: HTMLElement | null = null;
let _openSlug: string | null = null;

function avatarSrc(a: Author): string {
  if (a?.id) return `${apiBase()}/avatar/${a.id}?size=64`;
  return typeof a?.avatar === 'string' ? a.avatar : (a?.avatar && (a.avatar as any).image) || '';
}
// Contributor avatar — the real pfp (Boring Avatar via /api/avatar/:id, or an uploaded
// photo) loaded DIRECTLY as an <img> so it shows on first render (no refresh needed);
// the coloured initials sit underneath and reappear if the image fails to load. The
// webview CSP now allows the BCWEB origin, so no native data-URL round-trip is required.
function contribAvatar(a: Author, size = 22): string {
  const name = (a?.displayName || '?').trim();
  const src = absUrl(avatarSrc(a));
  const initials = (name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('') || '?').toUpperCase();
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:hsl(${h % 360} 50% 42%)`;
  const img = src ? `<img class="community-avatar-img" src="${escAttr(src)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
  return `<span class="community-avatar community-avatar--init" style="${style}">${escHtml(initials)}${img}</span>`;
}
// Author + collaborators row: solo → avatar + name; 2+ → avatars only (like the site).
function authorsRow(p: Post): string {
  const list: Author[] = (p.authors && p.authors.length ? p.authors : (p.author ? [p.author] : []));
  if (!list.length) return `<span class="community-authors">${escHtml('BetterCommunity')}</span>`;
  const avatars = list.slice(0, 4).map((a) => contribAvatar(a)).join('');
  const name = list.length === 1 ? `<span class="community-author-name">${escHtml(list[0].displayName || '')}</span>` : '';
  return `<span class="community-authors">${avatars}${name}</span>`;
}

function apiBase(): string { return `${bcRoot()}/api`; }


function pick(p: Post) {
  const fr = _blogLang === 'fr';
  return { title: (fr && p.titleFr) || p.title, excerpt: (fr && p.excerptFr) || p.excerpt || '' };
}
function projOf(p: Post) { return p.project?.key || (p.showcaseProject ? 'community' : 'community'); }
function projName(p: Post) { return p.project?.name || p.showcaseProject?.name || 'Community'; }
function fmtDate(d?: string) { try { return d ? new Date(d).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''; } catch { return ''; } }

export function initCommunity(): void {
  _view = document.getElementById('view-community');
  (window as any).openCommunityBlog = openCommunity;
}

// Called when the user navigates to the view — fetches once, then renders.
export async function openCommunity(): Promise<void> {
  if (!_view) _view = document.getElementById('view-community');
  if (!_view) return;
  _openSlug = null;
  // Always refresh on entering the page so new posts show up without a restart.
  if (!_loading) await loadPosts();
  render();
}

async function loadPosts(): Promise<void> {
  _loading = true; render();
  try {
    const res = await fetch(`${apiBase()}/blog`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _posts = Array.isArray(data.posts) ? data.posts : [];
  } catch (e) {
    _posts = null;
    toast(t('community.loadError') || 'Could not load the community blog.', 'error');
  } finally { _loading = false; }
}

function filtered(): Post[] {
  if (!_posts) return [];
  let list = _filter === 'all' ? _posts : _posts.filter((p) => projOf(p) === _filter);
  const q = _search.trim().toLowerCase();
  if (q) list = list.filter((p) => { const { title, excerpt } = pick(p); return (title + ' ' + excerpt).toLowerCase().includes(q) || (p.authors || []).some((a) => (a.displayName || '').toLowerCase().includes(q)); });
  return list;
}

function render(): void {
  if (!_view) return;
  if (_openSlug) return; // detail view manages its own DOM

  const chips = FILTERS.map((f) => {
    const active = _filter === f.key ? ' active' : '';
    const label = f.label.includes('.') ? (t(f.label) || f.label) : f.label;
    return `<button class="community-chip${active}" data-filter="${escAttr(f.key)}">${escHtml(label)}</button>`;
  }).join('');

  let bodyHtml: string;
  if (_loading) {
    bodyHtml = `<div class="community-empty"><div class="community-spinner"></div><p>${escHtml(t('community.loading') || 'Loading…')}</p></div>`;
  } else if (_posts === null) {
    bodyHtml = `<div class="community-empty"><p>${escHtml(t('community.loadError') || 'Could not load the community blog.')}</p>
      <button class="btn btn-secondary" id="community-retry">${escHtml(t('community.retry') || 'Retry')}</button></div>`;
  } else {
    const list = filtered();
    if (list.length) {
      // Like the website's blog: the newest post is a wide "featured" hero, the rest
      // fill the card grid. Only when browsing unfiltered/unsearched (so the hero is
      // always the true latest, not a coincidental first match).
      const hero = (_filter === 'all' && !_search.trim() && list.length > 1) ? list[0] : null;
      const rest = hero ? list.slice(1) : list;
      bodyHtml = `${hero ? heroCard(hero) : ''}<div class="community-grid">${rest.map(card).join('')}</div>`;
    } else if (_filter !== 'all' && _posts.length) {
      // Nothing in this project yet, but other posts exist — nudge to "All".
      bodyHtml = `<div class="community-empty"><p>${escHtml(t('community.noneHere') || 'No posts in this section yet.')}</p>
        <button class="btn btn-secondary" id="community-show-all">${escHtml(t('community.showAll') || 'Show all posts')}</button></div>`;
    } else {
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
        <button class="btn btn-secondary" id="community-open-web" style="gap:6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          ${escHtml(t('community.openWeb') || 'Open website')}
        </button>
        <button class="btn btn-secondary" id="community-refresh" title="${escAttr(t('community.refresh') || 'Refresh')}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>
    </div>
    <div class="community-toolbar">
      <div class="community-filters">${chips}</div>
      <div class="community-toolbar-right">
        <div class="community-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="community-search" id="community-search" placeholder="${escAttr(t('community.search') || 'Search posts…')}" value="${escAttr(_search)}" />
        </div>
        <select class="community-lang" id="community-lang" title="${escAttr(t('community.lang') || 'Blog language')}">
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
const REACTION_EMOJI: Record<string, string> = {
  'thumbs-up': '👍', heart: '❤️', fire: '🔥', party: '🎉', star: '⭐',
  rocket: '🚀', laugh: '😂', smile: '🙂', sparkles: '✨', check: '✅',
};

// Project logo (like the website's coverless cards) — falls back to a monogram.
const PROJ_LOGO: Record<string, string> = { community: 'assets/BC.webp', bmm: 'assets/BMm.png' };
function projMono(p: Post): string {
  const key = projOf(p);
  const logo = PROJ_LOGO[key];
  if (logo) return `<img class="community-cover-logo" src="${logo}" alt="" />`;
  const txt = (key || 'BC').slice(0, 3).toUpperCase();
  return `<span class="community-cover-mono community-badge--${escAttr(key)}">${escHtml(txt)}</span>`;
}
function card(p: Post): string {
  const { title, excerpt } = pick(p);
  // No cover → show the project logo (like the website's coverless cards).
  const cover = p.cover
    ? `<div class="community-card-cover" style="background-image:url('${escAttr(absUrl(p.cover))}')"></div>`
    : `<div class="community-card-cover community-card-cover--none">${projMono(p)}</div>`;
  return `
    <button class="community-card" data-slug="${escAttr(p.slug)}">
      ${cover}
      <div class="community-card-body">
        <span class="community-badge community-badge--${escAttr(projOf(p))}">${escHtml(projName(p))}</span>
        <h3 class="community-card-title">${escHtml(title)}</h3>
        <p class="community-card-excerpt">${escHtml(excerpt)}</p>
        <div class="community-card-meta">
          ${authorsRow(p)}
          <span>${escHtml(fmtDate(p.publishedAt))}</span>
        </div>
      </div>
    </button>`;
}

// Wide "featured" card for the latest post — cover on one side, title/excerpt on
// the other (like the website's blog hero). Falls back to the project logo cover.
function heroCard(p: Post): string {
  const { title, excerpt } = pick(p);
  const cover = p.cover
    ? `<div class="community-hero-cover" style="background-image:url('${escAttr(absUrl(p.cover))}')"></div>`
    : `<div class="community-hero-cover community-card-cover--none">${projMono(p)}</div>`;
  return `
    <button class="community-hero" data-slug="${escAttr(p.slug)}">
      ${cover}
      <div class="community-hero-body">
        <div class="community-hero-tags">
          <span class="community-hero-latest">${escHtml(t('community.latest') || 'Latest')}</span>
          <span class="community-badge community-badge--${escAttr(projOf(p))}">${escHtml(projName(p))}</span>
        </div>
        <h2 class="community-hero-title">${escHtml(title)}</h2>
        <p class="community-hero-excerpt">${escHtml(excerpt)}</p>
        <div class="community-card-meta">
          ${authorsRow(p)}
          <span>${escHtml(fmtDate(p.publishedAt))}</span>
        </div>
      </div>
    </button>`;
}

function wire(): void {
  if (!_view) return;
  _view.querySelectorAll('.community-chip').forEach((el) => el.addEventListener('click', () => {
    _filter = (el as HTMLElement).dataset.filter || 'all'; render();
  }));
  // Cards AND the featured hero both carry data-slug → open the post.
  _view.querySelectorAll('[data-slug]').forEach((el) => el.addEventListener('click', () => {
    openPost((el as HTMLElement).dataset.slug!);
  }));
  _view.querySelector('#community-show-all')?.addEventListener('click', () => { _filter = 'all'; render(); });
  _view.querySelector('#community-refresh')?.addEventListener('click', async () => { _posts = null; await loadPosts(); render(); });
  _view.querySelector('#community-retry')?.addEventListener('click', async () => { await loadPosts(); render(); });
  _view.querySelector('#community-open-web')?.addEventListener('click', () => openExternal(`${bcRoot()}/blog`));
  const lang = _view.querySelector('#community-lang') as HTMLSelectElement | null;
  if (lang) lang.addEventListener('change', () => { _blogLang = lang.value; render(); });
  const search = _view.querySelector('#community-search') as HTMLInputElement | null;
  if (search) search.addEventListener('input', () => {
    _search = search.value; render();
    // re-render replaced the DOM — restore focus + caret to the (new) search box.
    const again = _view?.querySelector('#community-search') as HTMLInputElement | null;
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
}

function openExternal(url: string) {
  invoke('open_external_url', { url }).catch(() => { try { window.open(url, '_blank'); } catch {} });
}

async function openPost(slug: string): Promise<void> {
  if (!_view) return;
  _openSlug = slug;
  _view.innerHTML = `<div class="community-empty"><div class="community-spinner"></div></div>`;
  let post: any = null;
  try {
    const res = await fetch(`${apiBase()}/blog/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
    if (res.ok) post = (await res.json()).post;
  } catch {}
  if (!post) { toast(t('community.loadError') || 'Could not load the post.', 'error'); _openSlug = null; return render(); }

  const fr = _blogLang === 'fr';
  const translated = fr ? !!(post.bodyFr && String(post.bodyFr).trim()) : true;
  const title = (fr && post.titleFr) || post.title;
  const body = (fr && post.bodyFr) || post.body || '';
  const untranslated = !translated
    ? `<div class="community-untranslated">${escHtml(t('community.untranslated') || "Cet article n'est pas encore traduit en français — version anglaise affichée.")}</div>`
    : '';
  const authorList: Author[] = [post.author, ...((post.coAuthors || []) as Author[])].filter(Boolean);
  const authorsHtml = authorList.length
    ? `<span class="community-authors">${authorList.slice(0, 5).map((a) => contribAvatar(a, 26)).join('')}<span class="community-author-name">${escHtml(authorList.map((a) => a.displayName).filter(Boolean).join(', '))}</span></span>`
    : `<span>${escHtml('BetterCommunity')}</span>`;
  const counts = post.reactionCounts || {};
  const reactions = (post.reactionsEnabled && (post.reactionTypes || []).length)
    ? `<div class="community-reactions">${post.reactionTypes.map((rt: string) =>
        `<span class="community-reaction" title="${escAttr(rt)}"><span class="community-reaction-emoji">${REACTION_EMOJI[rt] || '⭐'}</span><span class="community-reaction-count">${counts[rt] || 0}</span></span>`).join('')}
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
        <button class="community-article-date" title="${escAttr(t('community.viewHistory') || 'View edit history')}">${escHtml(fmtDate(post.publishedAt))}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.55;margin-left:4px;vertical-align:-1px"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg></button>
      </div>
      ${untranslated}
      <div class="community-article-body md-body">${absMedia(renderMarkdown(body, { baseUrl: bcRoot() }))}</div>
      ${reactions}
      <div class="community-article-footer">
        <button class="btn btn-secondary community-open-post-web">${escHtml(t('community.openWeb') || 'Open on website')}</button>
      </div>
    </div>`;

  _view.querySelector('.community-back')?.addEventListener('click', () => { _openSlug = null; render(); });
  _view.querySelector('.community-open-post-web')?.addEventListener('click', () => openExternal(`${bcRoot()}/blog/${slug}`));
  _view.querySelector('.community-article-date')?.addEventListener('click', () => { if (post.id) openHistory(post.id); });
}

// Read-only edit-history viewer (public users see a PUBLISHED post's changelog; the
// BCWEB endpoint gates drafts/restore). Overlay appended to <body> so a re-render of the
// article view doesn't wipe it.
async function openHistory(postId: string): Promise<void> {
  const ov = document.createElement('div');
  ov.className = 'community-history-overlay';
  ov.innerHTML = `<div class="community-history-modal">
    <div class="community-history-head"><span>${escHtml(t('community.history') || 'Edit history')}</span><button class="community-history-close" aria-label="Close">✕</button></div>
    <div class="community-history-content"><div class="community-empty"><div class="community-spinner"></div></div></div>
    <div class="community-history-foot">${escHtml(t('community.historyReadonly') || 'Read-only version history for this published post.')}</div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.community-history-close')?.addEventListener('click', close);
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);

  let revs: any[] = [];
  try { const r = await fetch(`${apiBase()}/blog/${postId}/history`, { headers: { Accept: 'application/json' } }); if (r.ok) revs = (await r.json()).revisions || []; } catch {}
  const content = ov.querySelector('.community-history-content')!;
  if (!revs.length) { content.innerHTML = `<div class="community-empty"><p>${escHtml(t('community.noHistory') || 'No history available for this post.')}</p></div>`; return; }
  content.innerHTML = `
    <div class="community-history-list">${revs.map((rv, i) =>
      `<button class="community-history-item${i === 0 ? ' active' : ''}" data-rev="${escAttr(rv.id)}">
        <span class="chi-v">v${rv.version}${i === 0 ? ` · ${escHtml(t('community.latest') || 'Latest')}` : ''}</span>
        <span class="chi-meta">${escHtml(rv.editor || '')} · ${escHtml(fmtDate(rv.createdAt))}</span>
      </button>`).join('')}</div>
    <div class="community-history-preview md-body"></div>`;
  const preview = content.querySelector('.community-history-preview')!;
  const loadRev = async (revId: string, btn: Element | null) => {
    content.querySelectorAll('.community-history-item').forEach((b) => b.classList.remove('active'));
    btn?.classList.add('active');
    preview.innerHTML = `<div class="community-empty"><div class="community-spinner"></div></div>`;
    try {
      const r = await fetch(`${apiBase()}/blog/${postId}/history/${revId}`, { headers: { Accept: 'application/json' } });
      if (r.ok) { const rev = (await r.json()).revision; preview.innerHTML = absMedia(renderMarkdown(rev.body || '', { baseUrl: bcRoot() })); }
    } catch { preview.innerHTML = ''; }
  };
  content.querySelectorAll('.community-history-item').forEach((b) => b.addEventListener('click', () => loadRev((b as HTMLElement).dataset.rev!, b)));
  loadRev(revs[0].id, content.querySelector('.community-history-item'));
}
