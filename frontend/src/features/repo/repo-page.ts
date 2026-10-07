// Server Repo — the frame around the two tabs: a sticky header that says where you are, what is
// running and what to do next; real tabs (keyboard, ARIA); empty states; "Learn more".
//
// The page's markup lives in index.html and every id in it is read by repo.ts, repo-sync.ts,
// repo-server.ts and the tutorial engine. So nothing here rewrites it: the header and the tab
// strip are MOVED (same nodes, same ids) into one sticky wrapper, and the rest is added beside
// what exists. The functions behind every button are the existing ones — the header's actions
// click the real buttons, so there is still exactly one code path for "start the server".
//
// What the page lacked, from using it rather than reading it:
//   · Scroll past the tab cards and nothing said which tab you were on, whether your server
//     was up, or which repo you had joined — the status line sat in a card far below.
//   · The tabs were buttons with role="tab" and none of the behaviour the role promises:
//     no aria-selected, no arrow keys, every tab in the Tab order.
//   · The export lists' empty states spoke to a SUBSCRIBER ("the host adds them…") on the
//     host's own screen — the one person who is the host. They say what to do now, and go there.
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { learnMore } from '../../core/learn-more.js';
import { openServerModal } from './server-modal.js';
import { uiIcon } from '../../ui/icons.js';

const ICON = {
    server: (uiIcon('server', 12)),
    repo: (uiIcon('database', 12)),
    play: (uiIcon('play', 12)),
    stop: (uiIcon('stop', 12)),
    sync: (uiIcon('refresh', 12)),
    link: (uiIcon('link', 12)),
    panel: (uiIcon('activity', 12)),
};

/** The stylesheet is this page's own file, linked once. */
function ensureCss(): void {
    if (document.getElementById('repo-page-css')) return;
    const link = document.createElement('link');
    link.id = 'repo-page-css';
    link.rel = 'stylesheet';
    link.href = 'css/repo-page.css';
    document.head.appendChild(link);
}

const view = () => document.getElementById('view-repo');
const activeTab = (): string =>
    (view()?.querySelector<HTMLElement>('.repo-tab-btn.active')?.dataset.repoTab) || 'sync';

// ── Tabs: the behaviour role="tab" promises ─────────────────────────────────────────────────

/**
 * Make a row of `role="tab"` buttons behave like a tablist: exactly one tab in the Tab order,
 * the arrows (and Home/End) move AND select, `aria-selected` follows the visible state.
 *
 * `isOn` reads the state the feature already keeps (a class), so this never becomes a second
 * source of truth — `sync()` just re-reads it after the feature has changed it.
 */
function wireTablist(list: HTMLElement, tabSel: string, isOn: (b: HTMLElement) => boolean, panelFor?: (b: HTMLElement) => HTMLElement | null): () => void {
    const tabs = () => [...list.querySelectorAll<HTMLElement>(tabSel)];
    const sync = () => {
        tabs().forEach((b) => {
            const on = isOn(b);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
            const p = panelFor?.(b);
            if (p) {
                if (!p.id) p.id = `${b.id || 'tab'}-panel`;
                b.setAttribute('aria-controls', p.id);
                p.setAttribute('role', 'tabpanel');
                if (b.id) p.setAttribute('aria-labelledby', b.id);
            }
        });
    };
    list.setAttribute('aria-orientation', 'horizontal');
    list.addEventListener('keydown', (e) => {
        const all = tabs();
        const at = all.indexOf(e.target as HTMLElement);
        if (at < 0) return;
        const last = all.length - 1;
        const to = e.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
            : e.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
                : e.key === 'Home' ? 0
                    : e.key === 'End' ? last : -1;
        if (to < 0) return;
        e.preventDefault();
        all[to].click();          // the feature's own handler selects it
        all[to].focus();
        sync();
    });
    list.addEventListener('click', () => requestAnimationFrame(sync));
    sync();
    return sync;
}

// ── The sticky header ──────────────────────────────────────────────────────────────────────

interface HeadState { serverOn: boolean; serverLabel: string; joined: string; serving: string }

function readState(): HeadState {
    const btnTxt = document.getElementById('repo-server-btn-text')?.textContent?.trim() || '';
    const serverOn = !!btnTxt && btnTxt === t('repo.hostStop');
    const serverLabel = document.getElementById('repo-server-status-label')?.textContent?.trim() || '';
    const card = document.getElementById('repo-sync-info-card');
    const cardShown = !!card && card.style.display !== 'none' && getComputedStyle(card).display !== 'none';
    const joined = cardShown ? (document.getElementById('repo-sync-name-display')?.textContent?.trim() || '') : '';
    // What the running server serves: the folder's last segment, as people name their repos.
    const dir = (document.getElementById('repo-host-path') as HTMLInputElement | null)?.value?.trim() || '';
    const serving = serverOn && dir ? (dir.split(/[\\/]/).filter(Boolean).pop() || dir) : '';
    return { serverOn, serverLabel, joined, serving };
}

function renderHead(slot: HTMLElement): void {
    const s = readState();
    const tab = activeTab();
    const server = s.serverOn
        ? `<span class="rp-chip rp-chip--on" role="status">${ICON.server}<span class="rp-dot" aria-hidden="true"></span>${escHtml(s.serverLabel || t('repo.head.serverOn'))}</span>`
        : `<span class="rp-chip" role="status">${ICON.server}<span class="rp-dot" aria-hidden="true"></span>${escHtml(t('repo.serverOffline') || 'Server offline')}</span>`;
    const joined = s.joined
        ? `<span class="rp-chip rp-chip--repo" title="${escHtml(s.joined)}">${ICON.repo}<span class="rp-chip-txt">${escHtml(t('repo.head.joined', { name: s.joined }))}</span></span>`
        : `<span class="rp-chip rp-chip--muted">${ICON.repo}<span class="rp-chip-txt">${escHtml(t('repo.head.notJoined'))}</span></span>`;

    let actions = '';
    if (tab === 'sync') {
        // Disabled with the page's button: a refused signature (or a sync already running)
        // must not look like one click away from the header.
        const off = !!(document.getElementById('btn-start-repo-sync') as HTMLButtonElement | null)?.disabled;
        actions = s.joined
            ? `<button type="button" class="btn btn-primary btn-sm rp-act" data-rp-act="sync"${off ? ` disabled title="${escHtml(t('repo.sig.syncBlocked'))}"` : ''}>${ICON.sync}<span>${escHtml(t('repo.head.syncNow'))}</span></button>`
            : `<button type="button" class="btn btn-secondary btn-sm rp-act" data-rp-act="join">${ICON.link}<span>${escHtml(t('repo.head.join'))}</span></button>`;
    } else {
        actions = s.serverOn
            ? `<button type="button" class="btn btn-secondary btn-sm rp-act" data-rp-act="panel">${ICON.panel}<span>${escHtml(t('repo.serverPanelTitle') || 'Server')}</span></button>`
              + `<button type="button" class="btn btn-danger btn-sm rp-act" data-rp-act="server">${ICON.stop}<span>${escHtml(t('repo.head.stop'))}</span></button>`
            : `<button type="button" class="btn btn-secondary btn-sm rp-act" data-rp-act="server">${ICON.play}<span>${escHtml(t('repo.head.start'))}</span></button>`;
    }
    // Each tab shows what it is about: Sync, the repo you joined (and the server only when it
    // runs — then it matters from anywhere); Host, the server and what it serves.
    const status = tab === 'sync' ? joined + (s.serverOn ? server : '') : server + (s.serving ? `<span class="rp-chip rp-chip--repo" title="${escHtml(s.serving)}">${ICON.repo}<span class="rp-chip-txt">${escHtml(s.serving)}</span></span>` : '');
    const html = `<div class="rp-status">${status}</div>`
        + `<div class="rp-actions">${actions}${learnMore(tab === 'sync' ? 'repo-sync' : 'repo-host')}</div>`;
    // Only touch the DOM when something changed: this runs from observers, and replacing
    // a focused button on every mutation would steal focus from the keyboard user.
    if (slot.dataset.rpHtml !== html) { slot.dataset.rpHtml = html; slot.innerHTML = html; }
    paintTabBadges(s);
}

// ── Tab badges: what each tab holds, readable from the rail ───────────────────────────────

/** Repos this BMM has fetched (repo.ts saveClientHistory keeps the last twenty). */
function historyCount(): number {
    try {
        const h = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
        return Array.isArray(h) ? h.length : 0;
    } catch { return 0; }
}

/** Sync: how many repos you know (the History list). Host: "Live" while the server runs. */
function paintTabBadges(s: HeadState): void {
    const root = view();
    if (!root) return;
    const put = (tab: string, html: string, label: string) => {
        const btn = root.querySelector<HTMLElement>(`.repo-tab-btn[data-repo-tab="${tab}"]`);
        if (!btn) return;
        let b = btn.querySelector<HTMLElement>(':scope > .rp-tab-badge');
        if (!html) { b?.remove(); return; }
        if (!b) { b = document.createElement('span'); btn.appendChild(b); }
        const cls = `rp-tab-badge${tab === 'host' ? ' rp-tab-badge--live' : ''}`;
        if (b.className !== cls) b.className = cls;
        if (b.innerHTML !== html) b.innerHTML = html;
        b.title = label;
        b.setAttribute('aria-label', label);
    };
    const n = historyCount();
    put('sync', n ? String(n) : '', t('repo.head.historyCount', { n: String(n) }));
    put('host', s.serverOn ? `<span class="rp-dot" aria-hidden="true"></span>${escHtml(t('repo.head.live'))}` : '', t('repo.head.serverOn'));
}

function scrollToAndFocus(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => (el as HTMLElement).focus?.({ preventScroll: true }), 250);
}

function runAction(act: string): void {
    if (act === 'sync') { document.getElementById('btn-start-repo-sync')?.click(); return; }
    if (act === 'join') { scrollToAndFocus('repo-sync-url'); return; }
    if (act === 'panel') { openServerModal('monitoring'); return; }
    if (act === 'server') {
        // The real button, so validation (no folder picked, a port in use) speaks the same way
        // it always did — and it is scrolled to, because that is where its messages appear.
        const btn = document.getElementById('btn-toggle-repo-server');
        btn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn?.click();
    }
}

// ── Learn more, beside each step ───────────────────────────────────────────────────────────

function mountGroupLinks(root: HTMLElement): void {
    const put = (sel: string, topic: string) => {
        const head = root.querySelector<HTMLElement>(sel);
        if (!head || head.querySelector('[data-learn-more]')) return;
        head.insertAdjacentHTML('beforeend', learnMore(topic, { className: 'lm-end' }));
    };
    put('.repo-host-group[data-host-group="publish"] > .repo-group-h', 'repo-host');
    put('.repo-host-group[data-host-group="serve"] > .repo-group-h', 'repo-reach');
    put('[data-repo-panel="sync"] .repo-group-h', 'repo-sync');
}

// ── Mount ──────────────────────────────────────────────────────────────────────────────────

let syncTabs: (() => void) | null = null;
let syncPills: (() => void) | null = null;
let slotRef: HTMLElement | null = null;

/** Repaint what depends on the active tab. repo.ts calls this after every tab change. */
export function onRepoTabChanged(): void {
    syncTabs?.();
    syncPills?.();
    if (slotRef) renderHead(slotRef);
}

export function initRepoPage(): void {
    const root = view();
    if (!root || root.dataset.rpMounted) return;
    root.dataset.rpMounted = '1';
    ensureCss();

    // 1. One sticky wrapper for the title and the tab strip — the same nodes, moved.
    const header = root.querySelector<HTMLElement>(':scope > .view-header');
    const tabs = root.querySelector<HTMLElement>(':scope > .repo-tabs');
    if (header && tabs) {
        const sentinel = document.createElement('div');
        sentinel.className = 'rp-sentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        const sticky = document.createElement('div');
        sticky.className = 'rp-sticky';
        header.before(sentinel);
        sentinel.after(sticky);
        sticky.append(header, tabs);
        // "Stuck" = the sentinel scrolled out of the scroller: the strip compacts.
        const scroller = root.closest<HTMLElement>('.content-area') || null;
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(([en]) => sticky.classList.toggle('is-stuck', !en.isIntersecting),
                { root: scroller, threshold: 0 }).observe(sentinel);
        }
    }

    // 2. The status + actions slot: the empty `.view-actions` the markup already reserves.
    const slot = header?.querySelector<HTMLElement>('.view-actions');
    if (slot) {
        slot.classList.add('rp-head-slot');
        slotRef = slot;
        renderHead(slot);
        slot.addEventListener('click', (e) => {
            const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rp-act]');
            if (b?.dataset.rpAct) runAction(b.dataset.rpAct);
        });
        // What the header mirrors lives in three nodes that other modules write to. Watch
        // those nodes only — never the whole page.
        const mo = new MutationObserver(() => renderHead(slot));
        for (const id of ['repo-server-btn-text', 'repo-server-status-label', 'repo-sync-name-display', 'repo-sync-info-card', 'btn-start-repo-sync']) {
            const n = document.getElementById(id);
            if (n) mo.observe(n, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'disabled'] });
        }
        document.addEventListener('langChanged', () => { delete slot.dataset.rpHtml; renderHead(slot); });
    }

    // 3. Real tabs.
    if (tabs) {
        tabs.setAttribute('aria-label', t('repo.head.tabsAria'));
        syncTabs = wireTablist(tabs, '.repo-tab-btn', (b) => b.classList.contains('active'),
            (b) => root.querySelector<HTMLElement>(`.repo-tab-panel[data-repo-panel="${b.dataset.repoTab}"]`));
    }
    const pills = root.querySelector<HTMLElement>('.repo-method-tabs');
    if (pills) {
        pills.setAttribute('aria-label', t('repo.head.methodAria'));
        syncPills = wireTablist(pills, '.repo-method-pill', (b) => b.classList.contains('active'));
    }

    // 4. Learn more beside each step. The empty states' "go to" buttons (repo.ts draws them).
    mountGroupLinks(root);
    root.addEventListener('click', (e) => {
        const go = (e.target as HTMLElement).closest<HTMLElement>('[data-rp-go]')?.dataset.rpGo;
        if (go) (document.querySelector(`.nav-item[data-view="${go}"]`) as HTMLElement | null)?.click();
    });
}
