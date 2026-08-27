// @ts-nocheck
import { invoke, pickFolder } from '../../core/api.js';
import { toast, updateLibraryProfileSelector, toastSaved } from '../../ui/app.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import {
    originLabel, originOf, forgetOrigin, enabledOnly, isDisabled, setDisabled, recordHistory,
    hasSource, catalogLabel } from '../catalogs/catalog-index.js';
import { getLinks } from '../../core/links-config.js';
import { renderProfiles } from '../profiles/profiles.js';
import { t } from '../../core/i18n.js';
import { raiseAboveAll } from '../../ui/layer.js';

// Sub-modules
import { initRepoServer } from './repo-server.js';
import { initRepoSsh } from './repo-ssh.js';
import { initRepoMonitoring } from './repo-monitoring.js';
import { initServerModal } from './server-modal.js';
import { initRepoSync, showSyncSummary, setRepoPassword } from './repo-sync.js';
import { initModUpdates } from './mod-updates.js';
import { initRepoAdmin } from './repo-admin.js';
import { initManifestOnly } from './manifest-only.js';
import { initRemoteRefresh } from './remote-refresh.js';
import { initDiscover } from './discover.js';
import { initModpackCreator } from '../mods/modpack-creator.js';
import { fetchSourceText } from '../../core/source-fetch.js';

// Normalise a repo URL so map lookups match regardless of trailing slash / repo.json
/** Accept both feed shapes without caring which is which.
 *
 *  BMM's own browse list is a bare array; BCWEB's /api/repos.json is { repos: [...] }.
 *  Both are legitimate and both exist in the wild, so a reader insisting on one would
 *  reject half the catalogs people can actually point it at.
 */
function normaliseRepoFeed(doc: any): any[] {
    if (Array.isArray(doc)) return doc;
    if (doc && Array.isArray(doc.repos)) return doc.repos;
    return [];
}

/**
 * Repos you have taken out of the browser, by normalised URL.
 *
 * HIDDEN, never deleted — an entry belongs to the catalogue that publishes it, and BMM has
 * no way to remove it from somebody else's file. Pretending otherwise would put the list
 * back the next time that catalogue is fetched, which reads as the button not working.
 * Kept as a local preference, and restorable, because "I never want to see this one" is a
 * decision about your screen rather than about the catalogue.
 */
function hiddenRepos(): Set<string> {
    try {
        const v = JSON.parse(localStorage.getItem('bmm_repo_hidden') || '[]');
        return new Set(Array.isArray(v) ? v : []);
    } catch { return new Set(); }
}
function setRepoHidden(url: string, hide: boolean): void {
    const set = hiddenRepos();
    if (hide) set.add(url); else set.delete(url);
    try { localStorage.setItem('bmm_repo_hidden', JSON.stringify([...set])); } catch { /* preference only */ }
}

/**
 * Is the followed-catalogues strip folded?
 *
 * The count decides only the DEFAULT — folded once there are more than a handful, open
 * below that. It used to gate the STATE as well (`urls.length > 3 && folded`), so with one
 * or two catalogues the handle was drawn, clicking it wrote a preference, and nothing on
 * screen moved. A control that stores your answer and ignores it is worse than no control.
 */
function catStripFolded(count: number): boolean {
    try {
        const v = localStorage.getItem('bmm_repo_cat_folded');
        return v === null ? count > 3 : v === 'true';
    } catch { return count > 3; }
}
function setCatStripFolded(v: boolean): void {
    try { localStorage.setItem('bmm_repo_cat_folded', String(v)); } catch { /* preference only */ }
}

/** Repo-catalog URLs the user added. Shares the key the catalog index writes to, so a repo
 *  catalog pulled in by an index and one pasted by hand land in the same list — two lists
 *  would mean two places to look when removing one. */
export function readRepoCatalogs(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem('bmm_repo_catalogs') || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
    } catch { return []; }
}


/**
 * The follow/unfollow strip above the repo browser.
 *
 * `getRepos` is how Export reaches the list that is on screen. It has to be passed in:
 * the list lives in `initRepo`'s scope, and this function is a sibling, not a child.
 * Reading it directly compiled and shipped — this file is `@ts-nocheck`, so nothing
 * objected — and then threw `ReferenceError: repoList is not defined` on the first click.
 * `(repoList || [])` did not save it either: `||` still has to evaluate the name before it
 * can pick a side, so a bare undefined identifier throws rather than falling back.
 */
// `getRepos` is REQUIRED, with no default. It briefly had `= () => []`, added to fix a
// ReferenceError, and that default is why Export answered "Nothing in the list to export"
// over a screen full of repos: the one call site never passed it. A default that means
// "nothing" converts a loud crash into a quiet lie, and only the crash gets reported.
export function renderRepoCatalogStrip(reload: () => void, getRepos: () => any[]): void {
    const host = document.getElementById('repo-cat-list');
    const input = document.getElementById('repo-cat-url') as HTMLInputElement | null;
    const addBtn = document.getElementById('repo-cat-add');
    const expBtn = document.getElementById('repo-cat-export');
    if (!host || !input || !addBtn || !expBtn) return;

    // Called every time the browser opens, so the listeners must be bound ONCE. Without
    // this, the second open binds a second click handler and one click fires two reloads;
    // by the fifth open the browser refetches five times per click. The chips are repainted
    // on every call regardless — that part is cheap and must stay current.
    const already = (host as any)._bmmBound === true;
    (host as any)._bmmBound = true;

    const paint = () => {
        const urls = readRepoCatalogs();
        // ROWS, not chips.
        //
        // These were tag-shaped pills reading "discord.com · developers ● ×", where the dot
        // was a switch that looked like punctuation and the address, the on/off state and
        // where the catalogue came from were all folded into one tooltip. A followed source
        // is a thing with a state and an address, which is what every other catalogue screen
        // in BMM draws as a row — so this draws one too, in the same shape.
        // FOLDED once there are more than a handful.
        //
        // Fifteen followed catalogues is fifteen rows above the repo list — taller than the
        // panel, so the thing the panel exists for starts below the fold and the browser
        // becomes a scroll to somewhere else. Folded is remembered, and the header carries the
        // count so a fold never hides the fact that there is something behind it.
        const folded = catStripFolded(urls.length);
        host.innerHTML = urls.length
            ? `<button type="button" class="repo-cat-fold${folded ? ' is-folded' : ''}" data-cat-fold>
                 <svg class="repo-cat-chev" width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                 ${escHtml(t('repo.cat.followedN').replace('{n}', String(urls.length)))}
               </button>
               <div class="repo-cat-srcs"${folded ? ' hidden' : ''}>${urls.map((u) => {
                const off = isDisabled(u);
                // catalogLabel(u) is the LABEL — the host of the catalogue itself. originOf(u)
                // is the index that brought it in: a different question with a different
                // answer, and now shown rather than hidden behind a hover.
                const from = originOf(u);
                return `
                <div class="repo-cat-src${off ? ' is-off' : ''}">
                    <button class="repo-cat-off" data-u="${escAttr(u)}"
                            title="${escAttr(off ? t('repo.cat.on') : t('repo.cat.off'))}"
                    >${escHtml(off ? t('repo.cat.stateOff') : t('repo.cat.stateOn'))}</button>
                    <div class="repo-cat-src-main">
                        <div class="repo-cat-src-name">${escHtml(catalogLabel(u))}</div>
                        <div class="repo-cat-src-url" title="${escAttr(u)}">${escHtml(u)}</div>
                    </div>
                    ${from ? `<span class="repo-cat-via" title="${escAttr(from)}">${escHtml(
                        (t('repo.cat.via') || 'via') + ' ' + originLabel(from))}</span>` : ''}
                    <button class="repo-cat-del" data-u="${escAttr(u)}"
                            aria-label="${escAttr(t('common.remove') || 'Remove')}">×</button>
                </div>`;
            }).join('')}</div>`
            : '';

        host.querySelector('[data-cat-fold]')?.addEventListener('click', () => {
            setCatStripFolded(!folded);
            paint();
        });
        // Bound inside paint(), like .repo-cat-del: the outer listeners bind once behind the
        // _bmmBound guard, but this markup is rebuilt on every paint.
        host.querySelectorAll('.repo-cat-off').forEach((b) => b.addEventListener('click', () => {
            const u = (b as HTMLElement).dataset.u || '';
            setDisabled(u, !isDisabled(u));
            paint();
            reload();
        }));
        host.querySelectorAll('.repo-cat-del').forEach((b) => b.addEventListener('click', () => {
            const u = (b as HTMLElement).dataset.u || '';
            writeRepoCatalogs(readRepoCatalogs().filter((x) => x !== u));
            // Same three as everywhere else: forget where it came from, clear its on/off flag
            // so it does not come back switched off, and write the line that lets the history
            // bring it back.
            forgetOrigin(u);
            setDisabled(u, false);
            recordHistory({ action: 'remove', type: 'repo', url: u });
            paint();
            reload();
        }));
    };
    paint();

    if (already) return;

    addBtn.addEventListener('click', () => {
        const url = input.value.trim();
        if (!/^https?:\/\//i.test(url)) { toast(t('repo.cat.badurl') || 'Enter an http(s) address.', 'error'); return; }
        const urls = readRepoCatalogs();
        if (urls.includes(url)) { toast(t('repo.cat.dupe') || 'Already following that one.', 'info'); return; }
        writeRepoCatalogs([...urls, url]);
        input.value = '';
        paint();
        // Reloaded rather than merged in place: the browser already knows how to fetch and
        // de-duplicate, and doing it twice is two chances to disagree about which entry won.
        reload();
    });

    expBtn.addEventListener('click', () => {
        // Create a catalog FROM what is on screen. Somebody who has assembled a list worth
        // sharing should not have to hand-write JSON to share it — and the shape it writes
        // is the one this same browser reads, so a round trip is the test.
        //
        // It used to export the whole list silently. A catalog is something you publish, and
        // "everything I happen to be following, including the half I was trying out" is
        // rarely what you meant to publish — so it asks first.
        // The list on screen is a STARTING POINT, not the whole story. A catalogue worth
        // publishing is usually assembled from more than one place — what you are browsing,
        // the catalogues you already follow, and an address somebody sent you — so the
        // builder takes all three instead of silently freezing whichever list happened to be
        // loaded. An empty screen is no longer a dead end either: you can start from a URL.
        openCatalogBuilder(getRepos());
    });
}

/**
 * Build a repo catalogue: from the list on screen, from the catalogues you follow, and from
 * any repos.json address you paste.
 *
 * Every entry is written as `community`, whatever the feed it came from called itself. A
 * catalogue that could label its own entries "official" would borrow a badge it was never
 * given — the same rule the browser applies when it merges a followed catalogue in, and the
 * reason it is applied HERE rather than trusted from the document.
 */
async function openCatalogBuilder(onScreen: any[]): Promise<void> {
    document.getElementById('repo-cat-build')?.remove();

    type Row = { repo: any; from: string; on: boolean };
    // Keyed by normalised URL: the same repo reached through two catalogues is one repo, and
    // a catalogue that lists it twice is a catalogue nobody can read.
    const rows = new Map<string, Row>();
    const addRepos = (list: any[], from: string): number => {
        let added = 0;
        for (const r of list) {
            const key = normRepoUrl(r?.url || '');
            if (!key || rows.has(key)) continue;
            // OFF by default. Pre-ticking everything made "build a catalogue" mean "publish
            // every repo I happen to be looking at", and the only way to publish three was to
            // untick thirty. The list is a source to choose FROM, not a draft to prune.
            rows.set(key, { repo: r, from, on: false });
            added += 1;
        }
        return added;
    };
    addRepos(onScreen, t('repo.cat.b.screen') || 'on screen');

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.id = 'repo-cat-build';
    // INSIDE the app frame, not on <body>, and above the modal layer rather than below it.
    //
    // Two faults in three lines. `#app-window-outer` carries `contain: paint`, so an overlay
    // on <body> escapes the rounded window entirely: its dim covered the transparent Tauri
    // margins and the desktop behind them, which is the shadow bleeding past the app in the
    // report. And z-index 10000 is UNDER .modal-overlay's 11000 — the panel drew, and every
    // click landed on whatever owned the stacking context above it, which reads exactly like
    // "the modal is not clickable, clicks pass through".
    //
    // Computed rather than declared, for the reason a flat number was wrong twice: 11200 is
    // above ordinary modals and below anything that declares more, so wherever this is opened
    // from something taller it paints underneath and the button reads as dead.
    raiseAboveAll(ov, 11200);
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);

    // A modal that does not lock the page scrolls it under itself: the wheel over the dim
    // area moves the list behind, which is the "it interacts with what is behind" everybody
    // reports and nobody can quite name. Restored on close, and restored exactly — an empty
    // string, not `auto`, so a stylesheet that sets its own overflow keeps it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => {
        document.body.style.overflow = prevOverflow;
        document.removeEventListener('keydown', onKey);
        ov.remove();
    };
    // Escape closes it, like every other dialog in the app and like every dialog anywhere.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);

    let name = t('repo.cat.b.defname') || 'My repo catalogue';
    let msg: { kind: 'ok' | 'bad'; text: string } | null = null;
    let urlBox = '';
    let follow = true;
    let busy = false;

    const paint = () => {
        const list = [...rows.values()];
        const on = list.filter((r) => r.on).length;
        ov.innerHTML = `
        <div class="modal glass" style="max-width:720px; width:94%; max-height:86vh; display:flex; flex-direction:column;">
            <div class="modal-header" style="flex-shrink:0;">
                <h3>${escHtml(t('repo.cat.b.title') || 'Build a repo catalogue')}</h3>
                <button class="modal-close" type="button" data-x>&times;</button>
            </div>
            <div class="modal-body" style="flex:1; min-height:0; overflow:auto;">
                <label class="repo-cat-b-lbl">${escHtml(t('repo.cat.b.name') || 'Catalogue name')}</label>
                <input class="input" id="repo-cat-b-name" value="${escAttr(name)}" style="margin-bottom:14px;">

                <p class="repo-cat-b-lede">${escHtml(t('repo.cat.b.lede'))}</p>

                <section class="repo-cat-b-step">
                <div class="repo-cat-b-steph"><span class="repo-cat-b-stepn">1</span>${escHtml(t('repo.cat.b.step1'))}</div>
                <label class="repo-cat-b-lbl">${escHtml(t('repo.cat.b.pull') || 'Pull repos in from a catalogue')}</label>
                <div class="repo-cat-b-srcs">
                    ${readRepoCatalogs().length
                        ? readRepoCatalogs().map((u) => {
                            const from = originOf(u);
                            return `<div class="repo-cat-b-src">
                                <span class="repo-cat-b-url" title="${escAttr(u)}">${escHtml(u)}</span>
                                ${from ? `<span class="cat-index-from" title="${escAttr(from)}">${escHtml(originLabel(from))}</span>` : ''}
                                <button class="btn btn-xs" data-pull="${escAttr(u)}">${escHtml(t('repo.cat.b.pullbtn') || 'Pull')}</button>
                            </div>`;
                        }).join('')
                        : `<div class="cat-index-empty">${escHtml(t('repo.cat.b.nosrc') || 'You follow no repo catalogues yet.')}</div>`}
                </div>

                <label class="repo-cat-b-lbl" style="margin-top:12px;">${escHtml(t('repo.cat.b.add') || 'Or pull from an address')}</label>
                <div class="repo-cat-b-add">
                    <input class="input" id="repo-cat-b-url" value="${escAttr(urlBox)}" placeholder="https://example.com/repos.json">
                    <button class="btn btn-sm btn-secondary" id="repo-cat-b-fetch"${busy ? ' disabled' : ''}>${escHtml(t('repo.cat.b.fetch') || 'Pull')}</button>
                </div>
                <!-- The address above can be a protected one. This screen was the only place
                     in BMM that fetches a catalogue by URL without offering the download
                     password or the identity key it might need — so a private catalogue could
                     be pasted, refused, and there was nothing on screen to explain what was
                     missing. Mounted here and wired below, in the same file, which is what
                     check-source-access requires. -->
                <div id="repo-cat-b-access"></div>
                <label class="repo-cat-b-follow">
                    <input type="checkbox" id="repo-cat-b-follow"${follow ? ' checked' : ''}>
                    ${escHtml(t('repo.cat.b.alsofollow') || 'Follow this catalogue too, so the browser keeps showing it')}
                </label>
                ${msg ? `<div class="sched-pc-addout-${escAttr(msg.kind)}" style="margin-top:6px;">${escHtml(msg.text)}</div>` : ''}
                </section>

                <section class="repo-cat-b-step">
                <div class="repo-cat-b-steph"><span class="repo-cat-b-stepn">2</span>${escHtml(t('repo.cat.b.step2'))}</div>
                <div class="repo-cat-b-head">
                    <span>${escHtml((t('repo.cat.b.count') || '{n} of {m} selected').replace('{n}', String(on)).replace('{m}', String(list.length)))}</span>
                    <button class="btn btn-xs" data-all>${escHtml(t('repo.cat.pick.all') || 'All')}</button>
                    <button class="btn btn-xs" data-none>${escHtml(t('repo.cat.pick.none') || 'None')}</button>
                </div>
                <div class="repo-cat-b-rows">
                    ${list.length ? list.map(({ repo, from, on: sel }, i) => `
                        <label class="repo-cat-b-row">
                            <input type="checkbox" data-i="${i}"${sel ? ' checked' : ''}>
                            <span style="min-width:0;">
                                <span class="repo-cat-b-nm">${escHtml(repo.name || repo.url || '')}</span>
                                <span class="repo-cat-b-u">${escHtml(repo.url || '')}</span>
                            </span>
                            <span class="repo-cat-b-from">${escHtml(from)}</span>
                        </label>`).join('')
                        : `<div class="cat-index-empty">${escHtml(t('repo.cat.b.norepos') || 'Nothing yet — pull from a catalogue or an address above.')}</div>`}
                </div>
                </section>
            </div>
            <div class="modal-footer" style="flex-shrink:0; display:flex; gap:8px; justify-content:flex-end;">
                <button class="btn" type="button" data-x>${escHtml(t('common.cancel') || 'Cancel')}</button>
                <button class="btn btn-primary" type="button" data-go${on ? '' : ' disabled'}>${escHtml(
                    // "Export 0" reads like an instruction that will do something. With
                    // nothing chosen the button says what is missing instead.
                    on ? (t('repo.cat.pick.export') || 'Export {n}').replace('{n}', String(on))
                       : t('repo.cat.pick.exportNone'))}</button>
            </div>
        </div>`;
        wire();
    };

    /** Fetch one catalogue and merge what it holds. Reports why when it cannot. */
    const pull = async (url: string, alsoFollow: boolean) => {
        if (!/^https?:\/\//i.test(url)) { msg = { kind: 'bad', text: t('repo.cat.badurl') || 'Enter an http(s) address.' }; paint(); return; }
        busy = true; msg = { kind: 'ok', text: t('repo.cat.b.pulling') || 'Fetching…' }; paint();
        try {
            const sep = url.includes('?') ? '&' : '?';
            const raw: string = await invoke('fetch_remote_json', { url: `${url}${sep}t=${Date.now()}` }) as string;
            const list = normaliseRepoFeed(JSON.parse(raw));
            if (!list.length) {
                // Told apart from unreachable on purpose: an address that answers with the
                // wrong document is a different problem from one that does not answer.
                msg = { kind: 'bad', text: t('repo.cat.b.notfeed') || 'That answered, but it lists no repositories.' };
            } else {
                const added = addRepos(list, originLabel(url));
                msg = { kind: 'ok', text: (t('repo.cat.b.pulled') || 'Added {n} of {m} — the rest were already here.')
                    .replace('{n}', String(added)).replace('{m}', String(list.length)) };
                if (alsoFollow && !hasSource(readRepoCatalogs(), url)) {
                    writeRepoCatalogs([...readRepoCatalogs(), url]);
                    recordHistory({ action: 'add', type: 'repo', url });
                }
                urlBox = '';
            }
        } catch (e) {
            msg = { kind: 'bad', text: `${t('repo.cat.b.failed') || 'Could not read that address'} — ${String(e).slice(0, 120)}` };
        } finally { busy = false; paint(); }
    };

    function wire(): void {
        const list = [...rows.values()];
        ov.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', close));
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

        const nameEl = ov.querySelector<HTMLInputElement>('#repo-cat-b-name');
        nameEl?.addEventListener('input', () => { name = nameEl.value; });
        const urlEl = ov.querySelector<HTMLInputElement>('#repo-cat-b-url');
        urlEl?.addEventListener('input', () => { urlBox = urlEl.value; });
        const folEl = ov.querySelector<HTMLInputElement>('#repo-cat-b-follow');
        folEl?.addEventListener('change', () => { follow = folEl.checked; });

        const accessSlot = ov.querySelector('#repo-cat-b-access');
        void import('../../core/source-access.js').then((sa) => {
            if (accessSlot) accessSlot.innerHTML = sa.sourceAccessHtml('rcb');
            // Wired AFTER the markup is in the document: wireSourceAccess finds its controls
            // with getElementById, and on a detached subtree it bails out and leaves a fold
            // with no listeners — which looks exactly like one nobody has clicked yet.
            sa.wireSourceAccess('rcb', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'),
                () => {
                    close();
                    (document.getElementById('nav-settings') as HTMLElement | null)?.click();
                    setTimeout(() => document.getElementById('settings-identity-card')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
                },
                () => (ov.querySelector('#repo-cat-b-url') as HTMLInputElement | null)?.value?.trim() || '');
        });

        ov.querySelector('#repo-cat-b-fetch')?.addEventListener('click', () => { void pull((urlEl?.value || '').trim(), follow); });
        urlEl?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void pull(urlEl.value.trim(), follow); });
        ov.querySelectorAll<HTMLElement>('[data-pull]').forEach((b) => b.addEventListener('click', () => {
            // Already followed, so it is not followed again — only its contents are pulled.
            void pull(b.dataset.pull || '', false);
        }));

        ov.querySelectorAll<HTMLInputElement>('.repo-cat-b-row input[type=checkbox]').forEach((b) => b.addEventListener('change', () => {
            const r = list[Number(b.dataset.i)];
            if (r) r.on = b.checked;
            paint();
        }));
        ov.querySelector('[data-all]')?.addEventListener('click', () => { list.forEach((r) => { r.on = true; }); paint(); });
        ov.querySelector('[data-none]')?.addEventListener('click', () => { list.forEach((r) => { r.on = false; }); paint(); });

        ov.querySelector('[data-go]')?.addEventListener('click', async () => {
            const chosen = list.filter((r) => r.on).map((r) => r.repo);
            const out = chosen.map((r: any) => ({
                name: r.name, url: r.url, description: r.description || '',
                region: r.region || '',
                // community, always. See the note on this function.
                category: 'community',
            }));
            const doc = JSON.stringify({ name: name.trim() || 'My repo catalogue', generatedAt: new Date().toISOString(), repos: out }, null, 2);
            const { saveFile } = await import('../../core/api.js');
            const path = await saveFile({ defaultPath: 'repos.json', filters: [{ name: 'Repo catalog', extensions: ['json'] }] }).catch(() => null);
            if (!path) return;
            try {
                await invoke('write_text_file', { path, content: doc });
                toast((t('repo.cat.saved') || 'Wrote {n} repositories.').replace('{n}', String(out.length)), 'success');
                close();   // NOT ov.remove(): the page would stay locked with the modal gone
            } catch (e) { toast(String(e), 'error'); }
        });
    }

    paint();
}

export function writeRepoCatalogs(urls: string[]): void {
    try { localStorage.setItem('bmm_repo_catalogs', JSON.stringify([...new Set(urls)])); } catch { /* ignore */ }
}

export const normRepoUrl = (url: string): string => {
    let u = (url || '').trim();
    u = u.replace(/\/repo\.json$/i, '').replace(/\/+$/, '');
    return u.toLowerCase();
};

// ── Repo favorites (localStorage) ─────────────────────────────────────────────
const REPO_FAV_KEY = 'bmm_repo_favorites';
export const getRepoFavorites = (): string[] => {
    try { return JSON.parse(localStorage.getItem(REPO_FAV_KEY) || '[]'); } catch { return []; }
};
export const isRepoFav = (url: string): boolean => getRepoFavorites().includes(url);
export const toggleRepoFav = (url: string): boolean => {
    let favs = getRepoFavorites();
    const has = favs.includes(url);
    favs = has ? favs.filter(u => u !== url) : [...favs, url];
    localStorage.setItem(REPO_FAV_KEY, JSON.stringify(favs));
    return !has; // new state
};

// Star button markup (shared between browse + history)
const repoStarBtn = (url: string) => {
    const fav = isRepoFav(url);
    return `<button class="repo-fav-btn${fav ? ' active' : ''}" data-fav-url="${escAttr(url)}" data-tooltip="${fav ? (t('repo.unfavorite') || 'Unfavorite') : (t('repo.favorite') || 'Favorite')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </button>`;
};

export const copyToClipboard = async (text, successMsg) => {
    try {
        await navigator.clipboard.writeText(text);
        toast(successMsg || t('repo.urlCopied'), "success");
    } catch (err) {
        toast(t('repo.urlCopyError') || "Copy error", "error");
    }
};

// showConfirm now lives in ui/confirm.ts. It was never repo-specific — it drives the shared
// #modal-confirm-generic and touches no repo state — and living here meant anything that
// wanted a yes/no had to import this 4000-line module, or write its own. One did.
// Re-exported so every existing `import { showConfirm } from './repo.js'` keeps working.
// Imported as well as re-exported: `export … from` forwards the name, it does not bring it
// into this module's scope, and repo.ts calls showConfirm itself. tsc is told to skip this
// file, so nothing said so — check-undefined-names did.
import { showConfirm } from '../../ui/confirm.js';
export { showConfirm };

// --- Profile Checklist (exportable function) ---
export const loadProfilesForExport = async (profilesListEl) => {
    if (!profilesListEl) return;
    try {
        // Store currently checked profile IDs before refresh
        const currentlyChecked = new Set();
        profilesListEl.querySelectorAll('.repo-profile-cb:checked').forEach(cb => {
            currentlyChecked.add(cb.value);
        });

        const profiles = await invoke('get_profiles');
        profilesListEl.innerHTML = '';
        if (!profiles || profiles.length === 0) {
            profilesListEl.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center;">${t('repo.noProfiles')}</div>`;
            return;
        }
        profiles.forEach(p => {
            const item = document.createElement('div');
            item.className = 'repo-profile-item';
            item.style.cssText = 'display:flex; align-items:center; padding:10px 12px; margin-bottom:6px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px; cursor:pointer; transition:all 0.2s ease;';
            item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.06)'; item.style.borderColor = 'rgba(255,255,255,0.1)'; };
            item.onmouseleave = () => { item.style.background = 'rgba(255,255,255,0.03)'; item.style.borderColor = 'rgba(255,255,255,0.05)'; };

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = p.id;
            cb.className = 'repo-profile-cb';
            // Check if profile was previously checked or if it's the active profile
            cb.checked = currentlyChecked.has(p.id) || (window.activeProfileId === p.id);
            item.onclick = (e) => { if (e.target !== cb) cb.checked = !cb.checked; };

            const info = document.createElement('div');
            info.style.cssText = 'margin-left:12px; display:flex; flex-direction:column;';
            info.innerHTML = `<span style="font-size:13.5px; font-weight:600; color:var(--text-color);">${escHtml(p.name)}</span>
                <span style="font-size:11px; color:var(--text-muted); margin-top:2px;">${escHtml(t(p.game_name) || p.game_name || t('repo.genericGame'))}</span>`;
            
            item.appendChild(cb);
            item.appendChild(info);
            profilesListEl.appendChild(item);
        });
    } catch (err) {
        console.error("Failed to load profiles for export:", err);
    }
};

// --- Modpack Checklist (exportable function) ---
export const loadModpacksForExport = async (modpacksListEl) => {
    if (!modpacksListEl) return;
    try {
        const modpacks = await invoke('load_modpacks');
        modpacksListEl.innerHTML = '';
        if (!modpacks || modpacks.length === 0) {
            modpacksListEl.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; padding: 10px;">${t('modpack.noMods') || 'No modpack available'}</div>`;
            return;
        }
        modpacks.forEach(pack => {
            const item = document.createElement('div');
            item.className = 'repo-modpack-item';
            item.style.cssText = 'display:flex; flex-direction:column; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;';

            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:8px;';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = pack.id;
            cb.className = 'repo-modpack-cb';
            cb.dataset.pack = JSON.stringify(pack);

            const name = document.createElement('span');
            name.style.cssText = 'font-size:13px; font-weight:600; color:var(--text-color); flex:1;';
            name.textContent = pack.name;

            topRow.appendChild(cb);
            topRow.appendChild(name);
            item.appendChild(topRow);

            const settingsRow = document.createElement('div');
            settingsRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding-left:26px;';
            settingsRow.innerHTML = `
                <select class="repo-modpack-share-mode input-field" style="font-size:11px; padding:4px; flex:1; background: rgba(0,0,0,0.3);">
                    <option value="public">${t('modpack.sharePublic') || 'Public'}</option>
                    <option value="whitelist_repo">${t('modpack.shareWhitelistRepo') || 'Whitelist Serveur'}</option>
                    <option value="whitelist_custom">${t('modpack.shareWhitelistCustom') || 'Whitelist Dédiée'}</option>
                </select>
            `;
            
            const customWhitelistInput = document.createElement('input');
            customWhitelistInput.type = 'text';
            customWhitelistInput.className = 'input-field repo-modpack-custom-whitelist';
            customWhitelistInput.placeholder = 'IDs (sép. par virgule)';
            customWhitelistInput.style.cssText = 'font-size:11px; padding:4px; flex:1; display:none; background: rgba(0,0,0,0.3);';
            
            const shareModeSelect = settingsRow.querySelector('.repo-modpack-share-mode');
            shareModeSelect.addEventListener('change', () => {
                customWhitelistInput.style.display = shareModeSelect.value === 'whitelist_custom' ? 'block' : 'none';
            });

            settingsRow.appendChild(customWhitelistInput);
            item.appendChild(settingsRow);
            modpacksListEl.appendChild(item);
        });
    } catch (err) {
        console.error("Failed to load modpacks for export:", err);
    }
};

/**
 * An SSH error code from the backend, as a sentence.
 *
 * The backend reports failures as i18n KEYS, sometimes with `|`-separated detail. t() returns
 * the key itself on a miss, so printing String(e) puts `repo.ssh.errAuthRejected` in front of
 * the user — which is what the sync panel used to do before it grew its own explain().
 */
function explainSsh(raw: string): string {
    const [key, ...rest] = String(raw).split('|');
    const msg = t(key);
    // t() returning the key unchanged means there is no translation; the raw text is then more
    // use than the key name.
    const base = msg === key ? raw : msg;
    return rest.length ? `${base} — ${rest.join(' ')}` : base;
}

export function initRepo() {
    // The mode-info banner is gone, and so is its dismiss/restore wiring. It explained that
    // hosting works "like a classic web server" above the very controls that do it — a
    // paragraph everybody read once and then dismissed, which is the definition of a banner
    // that should not have been permanent.

    const elements = {
        // --- Export elements ---
        btnPickExport: document.getElementById('btn-pick-repo-export'),
        inputExportPath: document.getElementById('repo-export-path'),
        btnStartExport: document.getElementById('btn-start-repo-export'),
        exportProgressContainer: document.getElementById('repo-export-progress-container'),
        exportStatus: document.getElementById('repo-export-status'),
        exportPercent: document.getElementById('repo-export-percent'),
        exportFill: document.getElementById('repo-export-progress-fill'),
        inputExportSeed: document.getElementById('repo-export-seed'),
        inputExportAuthor: document.getElementById('repo-export-author-name'),
        btnCancelExport: document.getElementById('btn-cancel-repo-export'),

        // --- Sync elements ---
        inputSyncUrl: document.getElementById('repo-sync-url'),
        inputSyncGamePath: document.getElementById('repo-sync-game-path'),
        inputSyncModsPath: document.getElementById('repo-sync-mods-path'),
        inputSyncBackupPath: document.getElementById('repo-sync-backup-path'),
        btnPickSyncGame: document.getElementById('btn-pick-sync-game'),
        btnPickSyncMods: document.getElementById('btn-pick-sync-mods'),
        btnPickSyncBackup: document.getElementById('btn-pick-sync-backup'),
        btnStartSync: document.getElementById('btn-start-repo-sync'),
        syncProgressContainer: document.getElementById('repo-sync-progress-container'),
        syncStatus: document.getElementById('repo-sync-status'),
        syncPercent: document.getElementById('repo-sync-percent'),
        syncFill: document.getElementById('repo-sync-progress-fill'),
        syncDetails: document.getElementById('repo-sync-details'),
        btnPauseSync: document.getElementById('btn-pause-sync'),
        btnCancelSync: document.getElementById('btn-cancel-sync'),
        pauseText: document.getElementById('repo-sync-pause-text'),
        pausedBadge: document.getElementById('repo-sync-paused-badge'),
        inputSyncDownloadLimit: document.getElementById('repo-sync-download-limit'),
        btnFetchInfo: document.getElementById('btn-fetch-repo-info'),
        syncInfoCard: document.getElementById('repo-sync-info-card'),
        syncBadge: document.getElementById('repo-sync-author-badge'),
        syncGameBadge: document.getElementById('repo-sync-game-badge'),
        syncNameDisplay: document.getElementById('repo-sync-name-display'),
        syncAuthorDisplay: document.getElementById('repo-sync-author-display'),
        syncDescDisplay: document.getElementById('repo-sync-desc-display'),
        btnClearFetchedRepo: document.getElementById('btn-clear-fetched-repo'),
        profilesSelectionEl: document.getElementById('repo-sync-profiles-selection'),
        syncTotalSizeEl: document.getElementById('repo-sync-total-size'),
        syncUrlCard: document.getElementById('repo-sync-url-card'),
        syncPathsSection: document.getElementById('repo-sync-paths-section'),
        btnRepoHistory: document.getElementById('btn-repo-history'),

        // --- Host Server elements ---
        profilesListEl: document.getElementById('repo-export-profiles-list'),
        modpacksListEl: document.getElementById('repo-export-modpacks-list'),
        btnRefreshProfiles: document.getElementById('btn-refresh-repo-profiles'),
        btnToggleServer: document.getElementById('btn-toggle-repo-server'),
        urlContainerServer: document.getElementById('repo-server-url-container'),
        urlInputServer: document.getElementById('repo-server-url'),
        btnCopyUrlServer: document.getElementById('btn-copy-repo-url'),
        serverStatusDot: document.getElementById('repo-server-status-dot'),
        serverStatusLabel: document.getElementById('repo-server-status-label'),
        publicSection: document.getElementById('repo-server-public-section'),
        publicUrlInput: document.getElementById('repo-server-public-url'),
        btnCopyPublicUrl: document.getElementById('btn-copy-repo-public-url'),
        upnpBadgeStatus: document.getElementById('upnp-status-badge'),
        publicHintBox: document.getElementById('public-ip-hint-box'),
        repoCreatorIdContainer: document.getElementById('repo-creator-id-container'),
        repoCreatorIdValue: document.getElementById('repo-creator-id-value'),
        tunnelSection: document.getElementById('repo-server-tunnel-section'),
        tunnelUrlInput: document.getElementById('repo-server-tunnel-url'),
        btnCopyTunnelUrl: document.getElementById('btn-copy-repo-tunnel-url'),
        inputServerPort: document.getElementById('repo-server-port'),
        inputServerUploadLimit: document.getElementById('repo-server-upload-limit'),
        serverTools: document.getElementById('repo-server-tools'),
        inputMiniServerUploadLimit: document.getElementById('repo-mini-server-upload-limit'),
        statsContainer: document.getElementById('repo-server-stats-container'),
        statDls: document.getElementById('repo-server-stat-dls'),
        statBytes: document.getElementById('repo-server-stat-bytes'),

        // --- Advanced ---
        advancedToggle: document.getElementById('repo-server-advanced-toggle'),
        advancedContent: document.getElementById('repo-server-advanced-content'),
        advancedCaret: document.getElementById('repo-advanced-caret'),
        inputCloudflaredPath: document.getElementById('settings-cloudflared-path'),
        btnPickCloudflared: document.getElementById('btn-pick-cloudflared'),

        // --- Monitoring, Bans, Whitelist ---
        btnOpenMonitoring: document.getElementById('btn-open-monitoring'),
        // All three are the SAME element now. Kept as three names because the features
        // that use them are still three features — merging the UI did not merge those.
        modalMonitoring: document.getElementById('modal-server'),
        monitoringListBody: document.getElementById('monitoring-list-body'),
        monitoringEmptyHint: document.getElementById('monitoring-empty-hint'),
        btnOpenBans: document.getElementById('btn-open-bans'),
        modalBans: document.getElementById('modal-server'),
        banListContainer: document.getElementById('ban-list-container'),
        inputBanSearch: document.getElementById('ban-search'),
        selectBanFilter: document.getElementById('ban-filter-type'),
        btnUnbanAll: document.getElementById('btn-unban-all'),
        btnExportBans: document.getElementById('btn-export-bans'),
        btnAddManualBan: document.getElementById('btn-add-manual-ban'),
        manualBanIp: document.getElementById('manual-ban-ip'),
        manualBanKey: document.getElementById('manual-ban-key'),
        btnOpenWhitelist: document.getElementById('btn-open-whitelist'),
        modalWhitelist: document.getElementById('modal-server'),
        whitelistListContainer: document.getElementById('whitelist-list-container'),
        whitelistToggle: document.getElementById('whitelist-toggle'),
        whitelistToggleBtn: document.getElementById('whitelist-toggle-btn'),
        whitelistSearch: document.getElementById('whitelist-search'),
        btnClearWhitelist: document.getElementById('btn-clear-whitelist'),
        btnExportWhitelist: document.getElementById('btn-export-whitelist'),
        btnAddManualWhitelist: document.getElementById('btn-add-manual-whitelist'),
        manualWhitelistIp: document.getElementById('manual-whitelist-ip'),
        manualWhitelistKey: document.getElementById('manual-whitelist-key'),

        // --- Mini-Server ---
        btnGenMiniServer: document.getElementById('btn-generate-mini-server'),
        btnPickMiniRepo: document.getElementById('btn-pick-mini-server-repo'),
        btnPickMiniFolder: document.getElementById('btn-pick-mini-folder'),
        inputMiniRepoPath: document.getElementById('repo-mini-server-json-path'),
        cbAutoStart: document.getElementById('repo-mini-server-autostart'),
        cbDocker: document.getElementById('repo-mini-server-docker'),
        dockerOptions: document.getElementById('repo-mini-server-docker-options'),
        dockerHostSelect: document.getElementById('repo-mini-server-docker-host'),

        // --- Distribution ZIP ---
        cbZipEnable: document.getElementById('repo-export-zip-enable'),
        cbZipMods: document.getElementById('repo-export-zip-mods'),
        zipOptionsPanel: document.getElementById('repo-export-zip-options'),
        inputZipPort: document.getElementById('repo-export-server-port'),
        inputZipLimit: document.getElementById('repo-export-server-limit'),
        inputZipPass: document.getElementById('repo-export-server-pass'),
        inputZipDownloadPass: document.getElementById('repo-export-server-download-pass'),
        selectZipVersion: document.getElementById('repo-export-server-version'),
        selectZipType: document.getElementById('repo-export-server-type'),
        cbZipCloudflare: document.getElementById('repo-export-server-cloudflare'),
        cbZipUpnp: document.getElementById('repo-export-server-upnp'),
        cbZipDocker: document.getElementById('repo-export-server-docker'),
        zipDockerOptions: document.getElementById('repo-export-server-docker-options'),
        zipDockerHostSelect: document.getElementById('repo-export-server-docker-host'),
        btnToggleZipPass: document.getElementById('toggle-repo-export-pass'),

        // --- History & Previews ---
        hostHistorySelect: document.getElementById('repo-host-history-select'),
        hostHistoryContainer: document.getElementById('repo-host-history-container'),
        hostMetadataPreview: document.getElementById('repo-host-metadata-preview')
    };

    // Initialize Sub-Modules
    initRepoServer(elements);
    initRepoSsh();
    // The shell first: the three features below bind their own open buttons and listen for
    // the tab event, and neither is useful until the rail exists.
    initServerModal();
    initRepoMonitoring(elements);
    initRepoSync(elements);
    initRepoAdmin(elements);
    initManifestOnly();
    initRemoteRefresh();
    initDiscover();
    initModUpdates();

    // ── Sync / Hosting tab switcher ──────────────────────────────────────
    const activateRepoTab = (name: string) => {
        const view = document.getElementById('view-repo');
        if (!view) return;
        view.querySelectorAll('.repo-tab-btn').forEach(b => {
            b.classList.toggle('active', (b as HTMLElement).dataset.repoTab === name);
        });
        view.querySelectorAll('.repo-tab-panel').forEach(p => {
            p.classList.toggle('active', (p as HTMLElement).dataset.repoPanel === name);
        });
    };
    (window as any).activateRepoTab = activateRepoTab;
    document.querySelectorAll('#view-repo .repo-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => activateRepoTab((btn as HTMLElement).dataset.repoTab || 'sync'));
    });

    // ZIP Export Server Type Listener (lock cloudflare/upnp for "server")
    if (elements.selectZipType) {
        elements.selectZipType.addEventListener('change', (e: any) => {
            const isServer = e.target.value === 'server';
            if (isServer) {
                if (elements.cbZipCloudflare) { (elements.cbZipCloudflare as HTMLInputElement).checked = false; (elements.cbZipCloudflare as HTMLInputElement).disabled = true; }
                if (elements.cbZipUpnp) { (elements.cbZipUpnp as HTMLInputElement).checked = false; (elements.cbZipUpnp as HTMLInputElement).disabled = true; }
            } else {
                if (elements.cbZipCloudflare) (elements.cbZipCloudflare as HTMLInputElement).disabled = false;
                if (elements.cbZipUpnp) (elements.cbZipUpnp as HTMLInputElement).disabled = false;
            }
        });
        // Dispatch initial change event
        elements.selectZipType.dispatchEvent(new Event('change'));
    }

    // ── bmm:repo-focus — auto-launch + pre-fill from Quick Test ──
    document.addEventListener('bmm:repo-focus', (e: any) => {
        const section: string  = e.detail?.section ?? '';
        const prefill: any     = e.detail?.prefill ?? null;

        // Make sure the relevant tab is visible before scrolling/pre-filling
        const HOST_SECTIONS = ['host', 'gen', 'update'];
        activateRepoTab(HOST_SECTIONS.includes(section) ? 'host' : 'sync');

        if (section === 'sync') {
            // ── Pre-fill sync form fields from QT data ──
            if (prefill) {
                // A password-protected repo: seed it so the auto-fetch below doesn't prompt.
                if (typeof prefill.password === 'string') setRepoPassword(prefill.password);
                if (prefill.url && elements.inputSyncUrl)
                    (elements.inputSyncUrl as HTMLInputElement).value = prefill.url;
                if (prefill.gameDir && elements.inputSyncGamePath)
                    (elements.inputSyncGamePath as HTMLInputElement).value = prefill.gameDir;
                if (prefill.modsDir && elements.inputSyncModsPath)
                    (elements.inputSyncModsPath as HTMLInputElement).value = prefill.modsDir;
                if (prefill.backupDir && elements.inputSyncBackupPath)
                    (elements.inputSyncBackupPath as HTMLInputElement).value = prefill.backupDir;
                if (typeof prefill.downloadLimit === 'number' && elements.inputSyncDownloadLimit)
                    (elements.inputSyncDownloadLimit as HTMLInputElement).value = String(prefill.downloadLimit);
            }

            // Scroll the sync URL card into view
            const target = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Auto-click Fetch to load remote repo profiles
            setTimeout(() => {
                if (elements.btnFetchInfo) (elements.btnFetchInfo as HTMLElement).click();
            }, 300);

            // If choices were specified, wait for Fetch to complete then auto-select profiles + auto-sync
            const wantedProfileIds: string[] = (prefill?.choices || [])
                .map((c: any) => c.repoProfileId)
                .filter(Boolean);
            if (wantedProfileIds.length > 0 && elements.profilesSelectionEl) {
                let attempts = 0;
                const pollId = setInterval(() => {
                    attempts++;
                    const cbs = (elements.profilesSelectionEl as HTMLElement).querySelectorAll<HTMLInputElement>('.repo-sync-choice-cb');
                    if (cbs.length > 0) {
                        clearInterval(pollId);
                        // Auto-select matching profiles
                        cbs.forEach(cb => {
                            if (wantedProfileIds.includes(cb.dataset.repoProfileId || '')) {
                                if (!cb.checked) cb.click();
                            }
                        });
                        // Auto-click Sync after profiles are selected
                        setTimeout(() => {
                            if (elements.btnStartSync) (elements.btnStartSync as HTMLElement).click();
                        }, 400);
                    }
                    if (attempts >= 20) clearInterval(pollId); // max 10s
                }, 500);
            }

        } else if (section === 'connect') {
            // Fill URL in sync form and auto-fetch the repo info
            if (typeof prefill?.password === 'string') setRepoPassword(prefill.password);
            if (prefill?.url && elements.inputSyncUrl)
                (elements.inputSyncUrl as HTMLInputElement).value = prefill.url;
            const connectTarget = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (connectTarget) (connectTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                if (elements.btnFetchInfo) (elements.btnFetchInfo as HTMLElement).click();
            }, 300);

        } else if (section === 'disconnect') {
            // Clear the fetched repo state (equivalent to disconnecting from the UI)
            const disconnectTarget = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (disconnectTarget) (disconnectTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                if (elements.btnClearFetchedRepo) (elements.btnClearFetchedRepo as HTMLElement).click();
            }, 300);

        } else if (section === 'host') {
            // Pre-fill host server settings and start the server
            if (prefill) {
                // repo-host-path is the directory the server serves from
                const hostPathInput = document.getElementById('repo-host-path') as HTMLInputElement | null;
                if (prefill.serveDir && hostPathInput) {
                    hostPathInput.value = prefill.serveDir;
                    // Reflect the repo's saved "require BetterCommunity login" flag.
                    const reqCb = document.getElementById('repo-host-require-login') as HTMLInputElement | null;
                    if (reqCb) { invoke('get_repo_require_login', { repoDir: prefill.serveDir }).then((v) => { reqCb.checked = !!v; }).catch(() => {}); }
                }
                if (prefill.port && elements.inputServerPort)
                    (elements.inputServerPort as HTMLInputElement).value = String(prefill.port);
                if (prefill.uploadLimit !== undefined && elements.inputServerUploadLimit)
                    (elements.inputServerUploadLimit as HTMLInputElement).value = String(prefill.uploadLimit);
            }
            // Scroll to the toggle server button
            if (elements.btnToggleServer) (elements.btnToggleServer as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                if (elements.btnToggleServer) (elements.btnToggleServer as HTMLElement).click();
            }, 300);

        } else if (section === 'gen') {
            // Switch to export/gen tab if tab system is present
            const genTab = document.querySelector('[data-repo-tab="export"], [data-repo-tab="gen"]') as HTMLElement | null;
            if (genTab) genTab.click();

            // ── Pre-fill gen/export form fields from QT data ──
            if (prefill) {
                if (prefill.outputDir && elements.inputExportPath)
                    (elements.inputExportPath as HTMLInputElement).value = prefill.outputDir;
                if (prefill.authorName && elements.inputExportAuthor)
                    (elements.inputExportAuthor as HTMLInputElement).value = prefill.authorName;
                if (prefill.seed && elements.inputExportSeed)
                    (elements.inputExportSeed as HTMLInputElement).value = prefill.seed;

                // ── Select profiles matching prefill.profileIds ──
                if (Array.isArray(prefill.profileIds) && prefill.profileIds.length > 0) {
                    // Wait a tick for the profile list to be rendered
                    requestAnimationFrame(() => {
                        const allCbs = document.querySelectorAll<HTMLInputElement>('.repo-profile-cb');
                        allCbs.forEach(cb => {
                            cb.checked = prefill.profileIds.includes(cb.value);
                        });
                    });
                }

                // ── Zip output — only check the ZIP checkbox if zipOutput is explicitly true ──
                // generateServer alone (standalone .bat) does NOT produce a zip — it fills the mini server section
                if (prefill.zipOutput && elements.cbZipEnable) {
                    (elements.cbZipEnable as HTMLInputElement).checked = true;
                    elements.cbZipEnable.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // ── Server distribution options (only apply when zip output is active) ──
                if (prefill.zipOutput) {
                    requestAnimationFrame(() => {
                        // Port
                        if (prefill.port && elements.inputZipPort)
                            (elements.inputZipPort as HTMLInputElement).value = String(prefill.port);
                        // Upload limit
                        if (prefill.uploadLimit !== undefined && elements.inputZipLimit)
                            (elements.inputZipLimit as HTMLInputElement).value = String(prefill.uploadLimit);
                        // Admin password
                        if (prefill.adminPassword && elements.inputZipPass)
                            (elements.inputZipPass as HTMLInputElement).value = prefill.adminPassword;
                        // Cloudflare tunnel
                        if (prefill.useCloudflare && elements.cbZipCloudflare)
                            (elements.cbZipCloudflare as HTMLInputElement).checked = true;
                        // UPnP
                        if (prefill.useUpnp && elements.cbZipUpnp)
                            (elements.cbZipUpnp as HTMLInputElement).checked = true;
                        // Docker
                        if (prefill.useDocker && elements.cbZipDocker) {
                            (elements.cbZipDocker as HTMLInputElement).checked = true;
                            // Trigger docker toggle to show sub-options
                            elements.cbZipDocker.dispatchEvent(new Event('change', { bubbles: true }));
                            // Docker OS
                            if (prefill.dockerOs && elements.zipDockerHostSelect)
                                (elements.zipDockerHostSelect as HTMLSelectElement).value = prefill.dockerOs;
                        }
                        // Server version: std/standard → '1' (Hybrid), lux/premium → '2' (V2 Luxe)
                        if (prefill.serverVersion && elements.selectZipVersion) {
                            const vmap: Record<string, string> = { std: '1', lux: '2', standard: '1', premium: '2' };
                            const v = vmap[prefill.serverVersion] ?? prefill.serverVersion;
                            (elements.selectZipVersion as HTMLSelectElement).value = v;
                        }
                        if (prefill.serverType && elements.selectZipType) {
                            (elements.selectZipType as HTMLSelectElement).value = prefill.serverType;
                            elements.selectZipType.dispatchEvent(new Event('change'));
                        }
                    });
                }
            }

            // Scroll the export path input or start button into view
            const target = elements.btnStartExport ?? elements.inputExportPath;
            if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Auto-click the Start Export / Gen button
            setTimeout(() => {
                if (elements.btnStartExport) (elements.btnStartExport as HTMLElement).click();
            }, 300);

            // ── If standalone server (generateServer without zipOutput), pre-fill the mini server section ──
            // The mini server section is always visible — pre-fill it so after gen the user just clicks "Generate Server"
            if (prefill?.generateServer && !prefill?.zipOutput && prefill?.outputDir) {
                const miniRepoPath = elements.inputMiniRepoPath as HTMLInputElement | null;
                if (miniRepoPath) miniRepoPath.value = prefill.outputDir;

                const miniPort = document.getElementById('repo-mini-server-port') as HTMLInputElement | null;
                if (miniPort && prefill.port) miniPort.value = String(prefill.port);

                const miniLimit = document.getElementById('repo-mini-server-upload-limit') as HTMLInputElement | null;
                if (miniLimit && prefill.uploadLimit !== undefined) miniLimit.value = String(prefill.uploadLimit);

                const miniPass = document.getElementById('repo-mini-server-password') as HTMLInputElement | null;
                if (miniPass && prefill.adminPassword) miniPass.value = prefill.adminPassword;

                // Version: std→'1', lux→'2'
                const miniVer = document.getElementById('repo-mini-server-version') as HTMLSelectElement | null;
                if (miniVer && prefill.serverVersion) {
                    const vmap2: Record<string, string> = { std: '1', lux: '2', standard: '1', premium: '2' };
                    miniVer.value = vmap2[prefill.serverVersion] ?? prefill.serverVersion;
                }

                const miniCf = document.getElementById('repo-mini-server-cloudflare') as HTMLInputElement | null;
                if (miniCf && prefill.useCloudflare != null) miniCf.checked = !!prefill.useCloudflare;

                const miniUpnp = document.getElementById('repo-mini-server-upnp') as HTMLInputElement | null;
                if (miniUpnp && prefill.useUpnp != null) miniUpnp.checked = !!prefill.useUpnp;

                const miniAutoStart = elements.cbAutoStart as HTMLInputElement | null;
                if (miniAutoStart && prefill.autoStart != null) miniAutoStart.checked = !!prefill.autoStart;

                if (prefill.useDocker && elements.cbDocker) {
                    (elements.cbDocker as HTMLInputElement).checked = true;
                    elements.cbDocker.dispatchEvent(new Event('change', { bubbles: true }));
                    if (prefill.dockerOs && elements.dockerHostSelect)
                        (elements.dockerHostSelect as HTMLSelectElement).value = prefill.dockerOs;
                }

                // Scroll to mini server section after gen starts (give it a moment)
                setTimeout(() => {
                    const miniSection = document.getElementById('repo-mini-server-json-path');
                    if (miniSection) miniSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 1500);
            }

        } else if (section === 'update') {
            // ── Open the "Update existing repo" modal and pre-fill from API params ──
            // This drives the UI exactly as a human would — the user sees the modal
            // with the repo loaded, can adjust the selection, then clicks Apply.
            const btnOpenUpdate = document.getElementById('btn-open-repo-update');
            if (btnOpenUpdate) btnOpenUpdate.click();

            // Pre-fill the repo dir and trigger a load
            if (prefill?.repoDir) {
                setTimeout(async () => {
                    const pathInput = document.getElementById('repo-update-path') as HTMLInputElement | null;
                    if (pathInput) pathInput.value = prefill.repoDir;

                    // Load the repo content into the modal
                    try {
                        const repo = await invoke('read_local_repo', { repoDir: prefill.repoDir });
                        // Trigger renderLoaded via a custom event (the modal handler listens for this)
                        document.dispatchEvent(new CustomEvent('bmm:repo-update-loaded', { detail: { repo, repoDir: prefill.repoDir } }));
                    } catch (_) { /* show user-friendly error — already handled */ }
                }, 350);
            }
        }
    });

    // ── Load Settings ──
    const loadRepoSettings = async () => {
        try {
            const settings = await invoke('get_settings');
            if (elements.inputCloudflaredPath && settings.cloudflared_path) {
                elements.inputCloudflaredPath.value = settings.cloudflared_path;
            }
        } catch (e) {
            console.error("[BMM] Failed to load repo settings:", e);
        }
    };
    loadRepoSettings();

    // ── Advanced Toggle ──
    if (elements.advancedToggle) {
        elements.advancedToggle.addEventListener('click', () => {
            const isHidden = elements.advancedContent.style.display === 'none';
            elements.advancedContent.style.display = isHidden ? 'block' : 'none';
            if (elements.advancedCaret) {
                elements.advancedCaret.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
            }
        });
    }

    if (elements.btnPickCloudflared) {
        elements.btnPickCloudflared.addEventListener('click', async () => {
            const { pickFile } = await import('../../core/api.js');
            const path = await pickFile(['exe']);
            if (path) {
                elements.inputCloudflaredPath.value = path;
                try {
                    const settings = await invoke('get_settings');
                    settings.cloudflared_path = path;
                    await invoke('update_settings', { settings });
                    toast(t('repo.cloudflaredPathUpdated'), 'success');
                } catch (e) { toast(String(e), 'error'); }
            }
        });
    }

    // ── History Helpers ──
    window.saveClientHistory = (url, repoInfo = null) => {
        try {
            let history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
            history = history.filter(h => h.url !== url);
            const entry = {
                url: url,
                date: new Date().toISOString(),
                name: repoInfo?.name || '',
                author: repoInfo?.author || '',
                game: repoInfo?.game_name || '',
                description: repoInfo?.description || '',
                category: repoInfo?.category || 'private'
            };
            history.unshift(entry);
            if (history.length > 20) history.length = 20;
            localStorage.setItem('bmm_repo_history_client', JSON.stringify(history));
        } catch(e) {}
    };

    // ── Repo History Modal ──
    const initRepoHistory = () => {
        const btnHistory = document.getElementById('btn-repo-history');
        const modal = document.getElementById('modal-repo-history');
        const historyList = document.getElementById('repo-history-list');
        const emptyState = document.getElementById('repo-history-empty');
        const btnClear = document.getElementById('btn-clear-repo-history');

        const checkRepo = async (url) => {
            const start = performance.now();
            try {
                const target = url.trim().endsWith('repo.json') ? url.trim() : (url.trim().endsWith('/') ? url.trim() + 'repo.json' : url.trim() + '/repo.json');
                let finalUrl = target;
                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                    finalUrl = 'https://' + finalUrl;
                }
                
                let rawInvoke;
                if (window.__TAURI__) {
                    rawInvoke = window.__TAURI__.core.invoke;
                } else {
                    const tauriApi = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
                    rawInvoke = tauriApi.invoke;
                }
                await rawInvoke('fetch_repo_info', { url: finalUrl });
                return Math.round(performance.now() - start);
            } catch(e) {}
            return -1;
        };

        const renderHistory = () => {
            try {
                const history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                if (history.length === 0) {
                    historyList.style.display = 'none';
                    emptyState.style.display = 'block';
                    return;
                }
                historyList.style.display = 'flex';
                emptyState.style.display = 'none';

                historyList.innerHTML = history.map((entry, idx) => {
                    const date = new Date(entry.date);
                    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    const categoryColor = entry.category === 'official' ? '#2ecc71' : entry.category === 'partner' ? '#bc74ff' : '#fb923c';
                    const categoryLabel = entry.category === 'official' ? 'Official' : entry.category === 'partner' ? 'Partner' : 'Private';

                    return `
                        <div class="repo-history-item" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:12px; display:flex; gap:12px; align-items:flex-start;">
                            <div style="width:40px; height:40px; display:flex; align-items:center; justify-content:center; background:rgba(251,146,60,0.1); border-radius:6px; flex-shrink:0;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </div>
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                    <span style="font-size:13px; font-weight:600; color:var(--text-primary);">${escHtml(entry.name || 'Unknown')}</span>
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        ${repoStarBtn(entry.url)}
                                        <div style="display:flex; align-items:center; gap:4px;" class="repo-history-ping-container" data-url="${escAttr(entry.url)}">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" class="repo-history-ping-icon">
                                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                                            </svg>
                                            <span style="font-size:10px; color:var(--text-muted); font-weight:600;" class="repo-history-ping-text">Pinging...</span>
                                        </div>
                                        <span style="font-size:10px; color:var(--text-muted);">${dateStr}</span>
                                    </div>
                                </div>
                                <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
                                    <span style="font-size:10px; padding:2px 8px; background:${categoryColor}20; color:${categoryColor}; border-radius:100px; font-weight:600;">${categoryLabel}</span>
                                    ${entry.game ? `
                                        <span style="font-size:10px; color:var(--text-muted); display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:100px;">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.7;">
                                                <rect x="2" y="3" width="20" height="14" rx="2"/>
                                                <path d="M8 21h8M12 17v4"/>
                                            </svg>
                                            ${escHtml(entry.game)}
                                        </span>
                                    ` : ''}
                                </div>
                                ${entry.author ? `
                                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px; display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:100px; width:fit-content;">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.7;">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                            <circle cx="12" cy="7" r="4"/>
                                        </svg>
                                        ${escHtml(entry.author)}
                                    </div>
                                ` : ''}
                                ${entry.description ? `<div style="font-size:11px; color:var(--text-muted); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escHtml(entry.description)}</div>` : ''}
                                <div style="margin-top:8px; display:flex; gap:8px;">
                                    <button class="btn-history-connect" data-url="${escAttr(entry.url)}" style="font-size:11px; padding:4px 12px; background:rgba(59,130,246,0.15); color:var(--accent); border:1px solid rgba(59,130,246,0.3); border-radius:4px; cursor:pointer;">${t('repo.historyConnect')}</button>
                                    <button class="btn-history-delete" data-idx="${idx}" style="font-size:11px; padding:4px 8px; background:rgba(239,68,68,0.1); color:var(--bmm-danger); border:1px solid rgba(239,68,68,0.2); border-radius:4px; cursor:pointer;">${t('repo.historyDelete')}</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                historyList.querySelectorAll('.btn-history-connect').forEach(btn => {
                    btn.onclick = () => {
                        if (elements.inputSyncUrl) elements.inputSyncUrl.value = btn.dataset.url;
                        if (elements.btnFetchInfo) elements.btnFetchInfo.click();
                        modal.classList.remove('open');
                    };
                });

                historyList.querySelectorAll('.btn-history-delete').forEach(btn => {
                    btn.onclick = () => {
                        const idx = parseInt(btn.dataset.idx);
                        let history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                        history.splice(idx, 1);
                        localStorage.setItem('bmm_repo_history_client', JSON.stringify(history));
                        renderHistory();
                    };
                });

                // Favorite star handlers
                historyList.querySelectorAll('.repo-fav-btn').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        const nowFav = toggleRepoFav(btn.dataset.favUrl);
                        btn.classList.toggle('active', nowFav);
                        const svg = btn.querySelector('svg');
                        if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
                    };
                });

                // Ping history repos
                const updateHistoryPings = async () => {
                    const pingContainers = historyList.querySelectorAll('.repo-history-ping-container');
                    for (const container of pingContainers) {
                        const url = container.dataset.url;
                        if (!url) continue;
                        
                        const ping = await checkRepo(url);
                        const icon = container.querySelector('.repo-history-ping-icon');
                        const text = container.querySelector('.repo-history-ping-text');
                        
                        if (ping >= 0) {
                            const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                            icon.setAttribute('stroke', color);
                            text.style.color = color;
                            text.textContent = ping + 'ms';
                        } else {
                            icon.setAttribute('stroke', '#ef4444');
                            text.style.color = '#ef4444';
                            text.textContent = 'Offline';
                        }
                    }
                };
                updateHistoryPings();

                // Add click handler for manual ping refresh
                historyList.querySelectorAll('.repo-history-ping-container').forEach(container => {
                    container.style.cursor = 'pointer';
                    container.onclick = async () => {
                        const url = container.dataset.url;
                        if (!url) return;
                        
                        const icon = container.querySelector('.repo-history-ping-icon');
                        const text = container.querySelector('.repo-history-ping-text');
                        
                        text.textContent = 'Pinging...';
                        icon.setAttribute('stroke', 'var(--text-muted)');
                        text.style.color = 'var(--text-muted)';
                        
                        const ping = await checkRepo(url);
                        
                        if (ping >= 0) {
                            const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                            icon.setAttribute('stroke', color);
                            text.style.color = color;
                            text.textContent = ping + 'ms';
                        } else {
                            icon.setAttribute('stroke', '#ef4444');
                            text.style.color = '#ef4444';
                            text.textContent = 'Offline';
                        }
                    };
                });
            } catch(e) {
                console.error('Error loading repo history:', e);
            }
        };

        if (btnHistory) {
            btnHistory.onclick = () => {
                renderHistory();
                modal.classList.add('open');
            };
        }

        const btnClearAll = document.getElementById('btn-clear-all-repo-history');

        // "Clear" → removes only non-favorited entries (keeps favorites)
        if (btnClear) {
            btnClear.onclick = async () => {
                const ok = await showConfirm(
                    t('repo.historyClearTitle') || 'Clear history',
                    t('repo.historyClearMsg') || 'Remove all non-favorited history entries? Favorited repos are kept.',
                    true
                );
                if (!ok) return; // only delete AFTER confirmation
                const history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                const kept = history.filter(h => isRepoFav(h.url));
                localStorage.setItem('bmm_repo_history_client', JSON.stringify(kept));
                renderHistory();
            };
        }

        // "Clear All" → removes everything, including favorited entries
        if (btnClearAll) {
            btnClearAll.onclick = async () => {
                const ok = await showConfirm(
                    t('repo.historyClearAllTitle') || 'Clear everything',
                    t('repo.historyClearAllMsg') || 'Remove ALL history entries, including favorited repos? This cannot be undone.',
                    true
                );
                if (!ok) return;
                localStorage.removeItem('bmm_repo_history_client');
                renderHistory();
            };
        }
    };
    initRepoHistory();

    // ── Repo Browser ──
    const initRepoBrowser = () => {
        const btnBrowse = document.getElementById('btn-browse-repos');
        const modal = document.getElementById('modal-repo-browser');
        // The protected-source fold, mounted and wired together — markup with no listeners is
        // the failure that has now shipped on three separate screens.
        const rbMount = document.getElementById('rb-access-mount');
        if (rbMount && !rbMount.innerHTML) {
            void import('../../core/source-access.js').then((sa) => {
                rbMount.innerHTML = sa.sourceAccessHtml('rb');
                sa.wireSourceAccess('rb', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'),
                    () => {
                        (document.getElementById('nav-settings') as HTMLElement | null)?.click();
                        setTimeout(() => document.getElementById('settings-identity-card')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
                    },
                    () => (document.getElementById('rb-access-url') as HTMLInputElement | null)?.value?.trim() || '');
            });
        }
        const loadingEl = document.getElementById('repo-browser-loading');
        const contentEl = document.getElementById('repo-browser-content');
        const errorEl = document.getElementById('repo-browser-error');
        const listEl = document.getElementById('repo-browser-list');
        const btnRetry = document.getElementById('btn-retry-repo-browser');
        const filterBtns = document.querySelectorAll('.repo-browser-filter');
        const searchInput = document.getElementById('repo-browser-search');
        const regionFilter = document.getElementById('repo-browser-region-filter');
        const onlineFilter = document.getElementById('repo-browser-online-filter');
        const whitelistFilterEl = document.getElementById('repo-browser-whitelist-filter');

        let currentFilter = 'all';
        let whitelistFilter = 'all'; // 'all' | 'whitelist' | 'no-whitelist'
        let repoList = [];
        let repoPingData = new Map();

        const fetchRepoList = async () => {
            loadingEl.style.display = 'block';
            contentEl.style.display = 'none';
            errorEl.style.display = 'none';

            try {
                // Bypass browser and GitHub caching to get the absolute latest list
                const bustUrl = `${getLinks().server_browse}?t=${Date.now()}`;
                // Through the backend, NOT a webview fetch(). The webview enforces CORS and
                // bettercommunity.ch sends no Access-Control-Allow-Origin, so a direct
                // fetch fails with "blocked by CORS policy" from origin tauri.localhost —
                // and worse, it reports that even when the real problem was a 503, because
                // an error response carries no CORS headers either. The browser then hides
                // the status behind an opaque TypeError. fetch_remote_json exists for
                // exactly this and every other feed already uses it; this call was left
                // behind. It also surfaces the true status, so "the site is down" stops
                // being reported as a permissions problem.
                const text: string = await invoke('fetch_remote_json', { url: bustUrl });
                repoList = normaliseRepoFeed(JSON.parse(text));

                // Repo catalogs somebody added themselves, merged in after the official
                // list. Their entries are tagged `community` HERE rather than trusted from
                // the feed: a catalog that could label its own entries "official" would
                // borrow a badge it was never given — the same rule apply_trust enforces
                // for app catalogs.
                // SHOWN NOW, not after the last catalogue answers.
                //
                // The official feed is already in hand at this point, and everything below is
                // other people's servers, fetched one after another with a cache-buster. With
                // fifteen followed catalogues that is fifteen round trips — and until the last
                // one finished, the panel was a spinner over a hidden list nobody could
                // search, scroll or read. A slow stranger's host made BMM's own repos
                // unreachable.
                //
                // Each catalogue re-renders as it lands, so the list grows under you instead
                // of appearing at the end.
                renderRepoList();
                loadingEl.style.display = 'none';
                contentEl.style.display = 'block';

                // enabledOnly: a catalogue switched off keeps its chip and is not fetched.
                for (const catUrl of enabledOnly(readRepoCatalogs())) {
                    try {
                        const sep = catUrl.includes('?') ? '&' : '?';
                        // Same reason as the official feed above: a webview fetch to a
                        // third-party catalogue is subject to CORS, and almost no static
                        // JSON host sends the header. Followed catalogues would have failed
                        // for most people, silently, since one unreachable catalogue is
                        // swallowed on purpose here.
                        // A catalog source may be an ssh:// one; fetchSourceText picks the
                        // transport so this call site does not have to know about either.
                        const raw: string = await fetchSourceText(`${catUrl}${sep}t=${Date.now()}`);
                        for (const entry of normaliseRepoFeed(JSON.parse(raw))) {
                            // A repo already in the official list wins. The same address in
                            // both is one repo, and showing it twice with two badges makes
                            // people wonder which one is real.
                            if (repoList.some((x: any) => normRepoUrl(x.url || '') === normRepoUrl(entry.url || ''))) continue;
                            // `category` is overwritten, but what the feed CLAIMED is kept.
                            // A catalogue calling its own repos "official" cannot take the
                            // badge — and dropping the claim made a careless list and a
                            // deliberate impersonation look identical. Rendered attributed
                            // to the catalogue that said it, never as a badge of its own.
                            const claimed = String(entry.category || '').toLowerCase();
                            repoList.push({
                                ...entry,
                                category: 'community',
                                claimed_category: (claimed === 'official' || claimed === 'partner') ? claimed : undefined,
                                source_catalog: catUrl,
                            });
                        }
                        // Repainted per catalogue rather than once at the end: the point of
                        // showing the list early is lost if the additions arrive in one lump
                        // at the same moment they used to.
                        renderRepoList();
                    } catch { /* one unreachable catalog must not empty the browser */ }
                }
                // Build a url → expected-signature map (recorded by the BMM team when
                // validating the repo). repo-sync compares the live repo's signature
                // against this to detect content changed since verification.
                //
                // ONLY from the official feed. This used to run over the merged list, which
                // included followed community catalogues — so a catalogue supplied the
                // "expected" signature for its own repo and the tamper check compared the
                // author's value against the author's value. It could not grant trust
                // (isVerified starts from the cryptographic self-signature) and it could not
                // touch an official repo (an already-listed URL is skipped above), but it
                // turned a real check into a reassuring no-op for exactly the entries that
                // most need one. A check that cannot fail is worse than no check, because
                // people read it as a result.
                (window as any).__bmmRepoExpectedSig = {};
                repoList.forEach(r => {
                    if (r.category === 'community') return;
                    if (r.url && r.signature) (window as any).__bmmRepoExpectedSig[normRepoUrl(r.url)] = r.signature;
                });
                renderRepoList();
                loadingEl.style.display = 'none';
                contentEl.style.display = 'block';
            } catch (err) {
                console.error('Failed to fetch repo list:', err);
                // "No repositories yet" and "the server is refusing to answer" are different
                // facts, and showing the first for the second is how a two-hour outage reads
                // as an empty catalogue. fetch_remote_json already surfaces the real HTTP
                // status (that is why it exists rather than a webview fetch) — so use it.
                const msg = String((err as any)?.message ?? err ?? '');
                const status = msg.match(/HTTP (\d{3})/)?.[1];
                const reason = status
                    ? {
                        title: t('repo.browse.down', 'The repository list is unavailable right now'),
                        detail: t('repo.browse.downdetail', 'BetterCommunity answered HTTP {s}. This is the server, not your connection — try again shortly.').replace('{s}', status),
                      }
                    : {
                        title: t('repo.browse.empty', 'No repositories available yet'),
                        detail: t('repo.browse.emptydetail', 'The repository list will be available soon'),
                      };
                // Show empty state message instead of error
                loadingEl.style.display = 'none';
                contentEl.style.display = 'block';
                listEl.innerHTML = `
                    <div style="text-align:center; padding:40px; color:var(--text-muted);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.5;">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="2" y1="12" x2="22" y2="12"></line>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <p style="margin-top:16px; font-size:13px;">${escHtml(reason.title)}</p>
                        <p style="font-size:11px; opacity:0.7;">${escHtml(reason.detail)}</p>
                    </div>
                `;
            }
        };

        const renderRepoList = () => {
            const searchTerm = searchInput?.value?.toLowerCase() || '';
            const regionValue = regionFilter?.value || 'all';
            const onlineOnly = onlineFilter?.checked || false;
            whitelistFilter = whitelistFilterEl?.value || 'all';

            let filtered = repoList;

            // Only show repos validated by the BMM team (hash field present and non-empty).
            // This is intentional — unvalidated entries in repos.json stay hidden until
            // the team adds a hash. The Verified badge is then shown for those entries.
            filtered = filtered.filter(r => r.hash && r.hash.length > 0);

            // Ones you took out yourself. Counted before they go, so the list can say they
            // exist — a hidden entry that leaves no trace is indistinguishable from a
            // catalogue that stopped publishing it.
            const hidden = hiddenRepos();
            const hiddenCount = filtered.filter(r => hidden.has(normRepoUrl(r.url || ''))).length;
            filtered = filtered.filter(r => !hidden.has(normRepoUrl(r.url || '')));

            // Filter by category
            if (currentFilter !== 'all') {
                filtered = filtered.filter(r => r.category === currentFilter);
            }

            // Filter by search term
            if (searchTerm) {
                filtered = filtered.filter(r =>
                    r.name?.toLowerCase().includes(searchTerm) ||
                    r.description?.toLowerCase().includes(searchTerm) ||
                    r.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
                );
            }

            // Filter by region
            if (regionValue !== 'all') {
                filtered = filtered.filter(r => r.region === regionValue);
            }

            // Filter by online status - only apply if checkbox is checked
            // Offline servers are still displayed by default
            if (onlineOnly) {
                filtered = filtered.filter(r => {
                    const pingData = repoPingData.get(r.url);
                    return pingData && pingData.online;
                });
            }

            // Filter by whitelist
            if (whitelistFilter === 'whitelist') {
                filtered = filtered.filter(r => r.whitelist_enabled === true);
            } else if (whitelistFilter === 'no-whitelist') {
                filtered = filtered.filter(r => !r.whitelist_enabled);
            }

            // Favourites: optional "favourites only" filter + always float favourites to the top.
            const favOnly = (document.getElementById('repo-browser-fav-filter') as HTMLInputElement | null)?.checked;
            if (favOnly) filtered = filtered.filter(r => isRepoFav(r.url));
            // Boosted (paid promotion, from BetterCommunity) float above everything, then favourites.
            const isBoosted = (r: any) => r.featured === true || (r.featuredUntil && new Date(r.featuredUntil) > new Date());
            filtered = [...filtered].sort((a, b) => {
                const boost = (isBoosted(b) ? 1 : 0) - (isBoosted(a) ? 1 : 0);
                if (boost) return boost;
                return (isRepoFav(b.url) ? 1 : 0) - (isRepoFav(a.url) ? 1 : 0);
            });

            const hiddenNote = hiddenCount
                ? `<div class="repo-hidden-note">
                     ${escHtml(t('repo.hiddenN').replace('{n}', String(hiddenCount)))}
                     <button type="button" class="btn btn-xs btn-ghost" id="repo-unhide-all">${escHtml(t('repo.unhideAll'))}</button>
                   </div>`
                : '';
            listEl.innerHTML = hiddenNote + filtered.map(repo => `
                <div class="repo-browser-item${isBoosted(repo) ? ' repo-browser-item-boosted' : ''}" style="background:${isBoosted(repo) ? 'linear-gradient(180deg, rgba(245,158,11,0.06), rgba(255,255,255,0.03))' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isBoosted(repo) ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)'}; border-radius:12px; padding:16px; cursor:pointer; transition:all 0.2s ease;" data-url="${escAttr(repo.url)}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <div style="flex:1;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
                                <span style="font-size:14px; font-weight:700; color:var(--text-primary);">${escHtml(repo.name)}</span>
                                ${isBoosted(repo) ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(245,158,11,0.15); color:var(--bmm-warning); border:1px solid rgba(245,158,11,0.35); display:flex; align-items:center; gap:3px;" data-tooltip="${t('repo.boostedServer') || 'Boosted — featured on BetterCommunity'}"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg> Boosted</span>` : ''}
                                <span class="repo-badge" style="font-size:9px; font-weight:800; padding:2px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; ${repo.category === 'official' ? 'background:rgba(16,185,129,0.15); color:var(--bmm-success);' : repo.category === 'community' ? 'background:color-mix(in srgb, var(--bmm-warning) 15%, transparent); color:var(--bmm-warning);' : 'background:rgba(59,130,246,0.15); color:var(--bmm-accent);'}">${escHtml(repo.category)}</span>${repo.claimed_category ? `<span class="repo-claim-badge" title="${escAttr((t('repo.claimHint') || 'This catalogue calls it that. BMM did not — a repo\u2019s tier comes from the list it was fetched from, not from what that list says about itself.'))}">\u26a0 ${escHtml((t('repo.claims') || 'claims “{c}”').replace('{c}', repo.claimed_category))}</span>` : ''}${repo.source_catalog ? `<span class="repo-src-tag" title="${escAttr(repo.source_catalog)}">${escHtml(originLabel(repo.source_catalog))}</span>` : ''}
                                ${repo.hash ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(16,185,129,0.12); color:var(--bmm-success); border:1px solid rgba(16,185,129,0.25); display:flex; align-items:center; gap:3px;" data-tooltip="${t('repo.verifiedServer') || 'Verified server — hash validated by the BMM team'}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>` : ''}
                                ${repo.whitelist_enabled === true
                                    ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(34,197,94,0.12); color:var(--bmm-success); border:1px solid rgba(34,197,94,0.3); display:flex; align-items:center; gap:3px;" data-tooltip="${t('repo.whitelistServer') || 'This server uses a whitelist — access is restricted'}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Whitelist</span>`
                                    : repo.whitelist_enabled === false
                                    ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(239,68,68,0.08); color:color-mix(in srgb, var(--bmm-danger) 75%, var(--bmm-text-primary)); border:1px solid rgba(239,68,68,0.2); display:flex; align-items:center; gap:3px;" data-tooltip="${t('repo.openServer') || 'This server has no whitelist — open access'}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> Open</span>`
                                    : ''
                                }
                            </div>
                            <p style="font-size:12px; color:var(--text-secondary); margin:0; line-height:1.5;">${escHtml(repo.description || '')}</p>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end; margin-left:16px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                ${repoStarBtn(repo.url)}
                                <!-- Taken out of YOUR list, not out of the catalogue: BMM has
                                     no way to edit somebody else's file, and pretending
                                     otherwise would put the entry back on the next fetch. -->
                                <button class="repo-hide-btn" data-hide-url="${escAttr(repo.url)}"
                                        data-tooltip="${escAttr(t('repo.hideOne'))}">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                </button>
                                <span style="font-size:10px; color:var(--text-muted);">${escHtml(repo.region || 'Unknown')}</span>
                            </div>
                            ${repo.tags && repo.tags.length > 0 ? `
                                <div style="display:flex; gap:4px; flex-wrap:wrap; justify-content:flex-end;">
                                    ${repo.tags.slice(0, 2).map(tag => `<span style="font-size:9px; padding:2px 6px; background:rgba(255,255,255,0.05); border-radius:3px; color:var(--text-muted);">${escHtml(tag)}</span>`).join('')}
                                    ${repo.tags.length > 2 ? `<span style="font-size:9px; color:var(--text-muted);">+${repo.tags.length - 2}</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
                                <rect x="2" y="3" width="20" height="14" rx="2"/>
                                <path d="M8 21h8M12 17v4"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-secondary);"><span style="color:var(--accent); font-weight:600;">${repo.mods_count || 0}</span> mods</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-secondary);">${formatBytes(repo.size || 0)}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-muted);">${escHtml(repo.last_update || 'Unknown')}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;" class="repo-ping-container" data-url="${escAttr(repo.url)}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" class="repo-ping-icon">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-muted); font-weight:600;" class="repo-ping-text">Pinging...</span>
                        </div>
                        <div style="display:flex; gap:4px; margin-left:auto;">
                            ${repo.website_link ? `
                            <a href="${escAttr(repo.website_link)}" target="_blank" style="width:20px; height:20px; display:flex; align-items:center; justify-content:center; background:rgba(6,182,212,0.15); border:1px solid rgba(6,182,212,0.3); border-radius:4px; text-decoration:none; color:var(--cyan);" >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="2" y1="12" x2="22" y2="12"/>
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                                </svg>
                            </a>
                            ` : ''}
                            ${repo.discord_link ? `
                            <a href="${escAttr(repo.discord_link)}" target="_blank" data-tooltip="Discord" style="width:22px; height:22px; display:flex; align-items:center; justify-content:center; background:#5865F2; border-radius:5px; text-decoration:none; flex-shrink:0; transition:opacity 0.15s;" data-hover="opacity:0.8" data-hover-out="opacity:1">
                                <svg width="13" height="10" viewBox="0 0 71 55" fill="white" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M60.1 4.9A58.5 58.5 0 0 0 45.6.7a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.5 37.5 0 0 0 25.6.8a.2.2 0 0 0-.2-.1 58.3 58.3 0 0 0-14.5 4.2.2.2 0 0 0-.1.1C1.6 18.5-.9 31.7.3 44.8v.1a58.7 58.7 0 0 0 17.7 9 .2.2 0 0 0 .2-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.8a.2.2 0 0 1 .2 0c11.6 5.3 24.1 5.3 35.5 0a.2.2 0 0 1 .2 0l1.1.8a.2.2 0 0 1 0 .4 36 36 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47 47 0 0 0 3.6 5.9.2.2 0 0 0 .2.1 58.5 58.5 0 0 0 17.7-9v-.1c1.5-15.3-2.5-28.4-10.7-40.1a.2.2 0 0 0-.1 0ZM23.7 37c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2Z"/>
                                </svg>
                            </a>
                            ` : ''}
                        </div>
                    </div>
                    
                    ${repo.changelog_link ? `
                    <div style="margin-top:8px;">
                        <a href="${escAttr(repo.changelog_link)}" target="_blank" style="font-size:10px; color:var(--accent); text-decoration:none; display:flex; align-items:center; gap:4px; padding:3px 8px; background:rgba(59,130,246,0.1); border-radius:4px; width:fit-content;">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                                <polyline points="10 9 9 9 8 9"/>
                            </svg>
                            Changelog
                        </a>
                    </div>
                    ` : ''}
                </div>
            `).join('');

            // Favorite star handlers (must run before item-click; stop propagation)
            listEl.querySelector('#repo-unhide-all')?.addEventListener('click', () => {
                try { localStorage.removeItem('bmm_repo_hidden'); } catch { /* preference only */ }
                renderRepoList();
            });

            listEl.querySelectorAll<HTMLElement>('.repo-hide-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setRepoHidden(normRepoUrl(btn.dataset.hideUrl || ''), true);
                    renderRepoList();
                });
            });

            listEl.querySelectorAll('.repo-fav-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = btn.dataset.favUrl;
                    const nowFav = toggleRepoFav(url);
                    btn.classList.toggle('active', nowFav);
                    const svg = btn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
                });
            });

            // Add click handlers
            listEl.querySelectorAll('.repo-browser-item').forEach(item => {
                item.addEventListener('click', () => {
                    const url = item.dataset.url;
                    if (elements.inputSyncUrl) {
                        elements.inputSyncUrl.value = url;
                    }
                    // Credentials from the fold, handed to the sync that is about to run.
                    // The password seeds the session so the fetch below does not have to 401
                    // first and prompt; the key was already saved per-origin by the fold
                    // itself. Also seed the fold's URL field so opening it after picking a
                    // repo talks about THAT repo, not a blank.
                    const rbUrl = document.getElementById('rb-access-url') as HTMLInputElement | null;
                    if (rbUrl && !rbUrl.value.trim()) rbUrl.value = url || '';
                    const rbPw = (document.getElementById('rb-access-pw') as HTMLInputElement | null)?.value?.trim();
                    if (rbPw) {
                        void import('./repo-sync.js').then((m) => m.setRepoPassword(rbPw));
                    }
                    if (elements.btnFetchInfo) {
                        elements.btnFetchInfo.click();
                    }
                    modal.classList.remove('open');
                });

                item.addEventListener('mouseenter', () => {
                    item.style.background = 'rgba(255,255,255,0.06)';
                    item.style.borderColor = 'rgba(255,255,255,0.15)';
                });

                item.addEventListener('mouseleave', () => {
                    item.style.background = 'rgba(255,255,255,0.03)';
                    item.style.borderColor = 'rgba(255,255,255,0.08)';
                });
            });

            // Dynamically ping repos
            const checkRepo = async (url) => {
                const start = performance.now();
                try {
                    const target = url.trim().endsWith('repo.json') ? url.trim() : (url.trim().endsWith('/') ? url.trim() + 'repo.json' : url.trim() + '/repo.json');
                    let finalUrl = target;
                    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                        finalUrl = 'https://' + finalUrl;
                    }
                    
                    // Use native Tauri invoke to completely bypass browser CORS restrictions 
                    // and avoid api.ts wrapper that logs console.error spam on failure
                    let rawInvoke;
                    if (window.__TAURI__) {
                        rawInvoke = window.__TAURI__.core.invoke;
                    } else {
                        const tauriApi = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
                        rawInvoke = tauriApi.invoke;
                    }
                    await rawInvoke('fetch_repo_info', { url: finalUrl });
                    return Math.round(performance.now() - start);
                } catch(e) {}
                return -1;
            };

            // Process pinging sequentially or in small batches to avoid network saturation
            const updatePings = async () => {
                const pingContainers = listEl.querySelectorAll('.repo-ping-container');
                for (const container of pingContainers) {
                    const url = container.dataset.url;
                    if (!url) continue;
                    
                    const ping = await checkRepo(url);
                    const icon = container.querySelector('.repo-ping-icon');
                    const text = container.querySelector('.repo-ping-text');
                    
                    // Store ping data for online filter
                    repoPingData.set(url, { online: ping >= 0, ping });
                    
                    if (ping >= 0) {
                        const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                        icon.setAttribute('stroke', color);
                        text.style.color = color;
                        text.textContent = ping + 'ms';
                    } else {
                        icon.setAttribute('stroke', '#ef4444');
                        text.style.color = '#ef4444';
                        text.textContent = 'Offline';
                    }
                }
                
                // Add click handler for manual ping refresh
                listEl.querySelectorAll('.repo-ping-container').forEach(container => {
                    container.style.cursor = 'pointer';
                    container.onclick = async (e) => {
                        e.stopPropagation();
                        const url = container.dataset.url;
                        if (!url) return;
                        
                        const icon = container.querySelector('.repo-ping-icon');
                        const text = container.querySelector('.repo-ping-text');
                        
                        text.textContent = 'Pinging...';
                        icon.setAttribute('stroke', 'var(--text-muted)');
                        text.style.color = 'var(--text-muted)';
                        
                        const ping = await checkRepo(url);
                        
                        // Store ping data for online filter
                        repoPingData.set(url, { online: ping >= 0, ping });
                        
                        if (ping >= 0) {
                            const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                            icon.setAttribute('stroke', color);
                            text.style.color = color;
                            text.textContent = ping + 'ms';
                        } else {
                            icon.setAttribute('stroke', '#ef4444');
                            text.style.color = '#ef4444';
                            text.textContent = 'Offline';
                        }
                        
                        // Re-render if online filter is active (debounced to avoid infinite loop)
                        if (onlineFilter?.checked) {
                            setTimeout(() => renderRepoList(), 100);
                        }
                    };
                });
                
                // Re-render if online filter is active (debounced to avoid infinite loop)
                if (onlineFilter?.checked) {
                    setTimeout(() => renderRepoList(), 100);
                }
            };
            
            // Start the background ping task
            updatePings();
        };

        if (btnBrowse) {
            btnBrowse.addEventListener('click', () => {
                modal.classList.add('open');
                // Wired once per open, before the fetch: the strip must be usable while the
                // list is still loading, and binding after would leave it dead if the fetch
                // failed — which is exactly when somebody wants to add another source.
                renderRepoCatalogStrip(() => { void fetchRepoList(); }, () => repoList);
                fetchRepoList();
            });
        }

        if (btnRetry) {
            btnRetry.addEventListener('click', fetchRepoList);
        }

        const btnRefresh = document.getElementById('btn-refresh-repo-browser');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                btnRefresh.style.opacity = '0.5';
                btnRefresh.style.pointerEvents = 'none';
                const svg = btnRefresh.querySelector('svg');
                if (svg) svg.style.animation = 'spin 0.6s linear infinite';
                fetchRepoList().then(() => {
                    btnRefresh.style.opacity = '';
                    btnRefresh.style.pointerEvents = '';
                    if (svg) svg.style.animation = '';
                });
            });
        }

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                renderRepoList();
            });
        });

        // Add event listeners for new filters
        if (searchInput) {
            searchInput.addEventListener('input', renderRepoList);
        }

        if (regionFilter) {
            regionFilter.addEventListener('change', renderRepoList);
        }

        if (onlineFilter) {
            onlineFilter.addEventListener('change', renderRepoList);
        }

        if (whitelistFilterEl) {
            whitelistFilterEl.addEventListener('change', renderRepoList);
        }

        const favFilterEl = document.getElementById('repo-browser-fav-filter');
        if (favFilterEl) {
            favFilterEl.addEventListener('change', renderRepoList);
        }
    };
    initRepoBrowser();

    // ── Repo Update (incremental) ──
    // Persistent state so closing the modal does NOT stop the running update;
    // reopening shows the live progress until it finishes.
    const _ru = { running: false, percent: 0, status: '', repoDir: '', done: false, summary: '' };
    let _ruListenerAttached = false;

    const initRepoUpdate = () => {
        const modal = document.getElementById('modal-repo-update');
        const btnOpen = document.getElementById('btn-open-repo-update');
        const pathInput = document.getElementById('repo-update-path') as HTMLInputElement;
        const btnPick = document.getElementById('btn-pick-repo-update-folder');
        const contentEl = document.getElementById('repo-update-content');
        const currentEl = document.getElementById('repo-update-current');
        const addEl = document.getElementById('repo-update-add');
        const btnApply = document.getElementById('btn-apply-repo-update') as HTMLButtonElement;
        const btnCancel = document.getElementById('btn-cancel-repo-update') as HTMLButtonElement;
        const progressEl = document.getElementById('repo-update-progress');
        const statusEl = document.getElementById('repo-update-status');
        const percentEl = document.getElementById('repo-update-percent');
        const fillEl = document.getElementById('repo-update-fill');
        if (!modal || !btnOpen) return;

        let repoDir = '';

        // Reflect _ru state into the progress UI (called on every event + on open)
        const syncProgressUI = () => {
            if (!progressEl) return;
            if (_ru.running || _ru.done) {
                progressEl.style.display = 'block';
                percentEl.textContent = `${Math.round(_ru.percent)}%`;
                fillEl.style.width = `${Math.round(_ru.percent)}%`;
                statusEl.textContent = _ru.done ? (_ru.summary || t('repo.update.done') || 'Done') : _ru.status;
                fillEl.style.background = _ru.done ? 'var(--green)' : 'linear-gradient(90deg,var(--cyan),#00f0ff)';
            } else {
                progressEl.style.display = 'none';
            }
            if (btnApply) btnApply.disabled = _ru.running || !repoDir;
            if (btnCancel) btnCancel.style.display = _ru.running ? 'inline-flex' : 'none';
        };

        // After an update finishes, reload the repo content so the modal shows the
        // NEW post-update state (no need to re-pick the folder).
        const reloadCurrentRepo = async () => {
            if (!repoDir) return;
            try {
                const repo = await invoke('read_local_repo', { repoDir });
                await renderLoaded(repo);
            } catch { /* repo may have been emptied/removed */ }
        };

        // Persistent progress listener (attached once, survives modal close)
        const attachListener = async () => {
            if (_ruListenerAttached || !window.__TAURI__) return;
            _ruListenerAttached = true;
            const { listen } = (window as any).__TAURI__.event;
            await listen('bmm://repo-export-progress', (event) => {
                if (!_ru.running) return; // ignore generic export events
                const { step, progress } = event.payload;
                if (progress !== undefined) _ru.percent = progress;
                if (step) { try { _ru.status = t(JSON.parse(step).key) || step; } catch { _ru.status = t(step) || step; } }
                syncProgressUI();
            });
        };

        const renderLoaded = async (repo) => {
            // Current repo content — checkbox per mod (checked = keep, unchecked = remove)
            currentEl.innerHTML = (repo.profiles || []).map(p => `
                <div class="ru-current-block" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px;">
                    <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <span>${escHtml(p.name)} <span style="color:var(--text-muted);font-weight:400;">(${p.mods.length} mods)</span></span>
                        <button class="btn btn-xs btn-outline-danger repo-up-rm-profile" data-pid="${escAttr(p.id)}" style="font-size:10px;flex-shrink:0;">${t('repo.update.removeProfile') || 'Remove profile'}</button>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:3px;">
                        ${p.mods.map(m => `
                        <div>
                            <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);cursor:pointer;">
                                <input type="checkbox" class="repo-up-keep-mod" data-mid="${escAttr(m.id)}" checked>
                                <span>${escHtml(m.name)} <span style="color:var(--text-muted);">v${escHtml(m.version)}</span></span>
                            </label>
                            <div style="display:flex;align-items:center;gap:6px;margin:1px 0 3px 22px;font-size:9px;color:var(--text-muted);font-family:var(--font-mono);">
                                <span>repo_mod_id:</span>
                                <span style="color:var(--text-secondary);user-select:all;">${escHtml(m.id)}</span>
                                <button type="button" class="repo-up-copy-id" data-mid="${escAttr(m.id)}" data-tooltip="${escAttr(t('common.copy') || 'Copy')}" style="border:none;background:rgba(255,255,255,0.06);color:var(--text-secondary);border-radius:3px;padding:1px 5px;cursor:pointer;font-size:9px;">${t('common.copy') || 'Copy'}</button>
                            </div>
                        </div>`).join('')}
                    </div>
                </div>`).join('') || `<div style="color:var(--text-muted);font-size:12px;">${t('repo.update.empty') || 'Repo is empty'}</div>`;

            // Local profiles to add — expandable per-mod selection
            const localProfiles = await invoke('get_profiles');
            addEl.innerHTML = localProfiles.map(p => `
                <div class="ru-add-block" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;overflow:hidden;">
                    <div style="display:flex;align-items:center;gap:8px;padding:10px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" class="repo-up-add-profile" data-pid="${escAttr(p.id)}">
                        <span style="font-weight:600;flex:1;">${escHtml(p.name)} <span style="color:var(--text-muted);font-size:11px;font-weight:400;">${escHtml(p.game_name || '')}</span></span>
                        <button class="btn btn-xs btn-ghost repo-up-expand" data-pid="${escAttr(p.id)}" style="font-size:10px;">${t('repo.update.chooseMods') || 'Choose mods'}</button>
                    </div>
                    <div class="repo-up-mods" data-pid="${escAttr(p.id)}" style="display:none;padding:0 10px 10px 32px;border-top:1px solid rgba(255,255,255,0.04);"></div>
                </div>`).join('');

            contentEl.style.display = 'block';
            btnApply.disabled = false;

            currentEl.querySelectorAll('.repo-up-copy-id').forEach(b => b.addEventListener('click', (e) => {
                e.preventDefault();
                navigator.clipboard?.writeText((b as HTMLElement).dataset.mid || '').then(() => {
                    toast(t('repo.update.idCopied') || 'repo_mod_id copied', 'success');
                }).catch(() => {});
            }));

            currentEl.querySelectorAll('.repo-up-rm-profile').forEach(btn => {
                btn.addEventListener('click', () => {
                    const block = btn.closest('.ru-current-block') as HTMLElement;
                    btn.dataset.removed = btn.dataset.removed === '1' ? '0' : '1';
                    const removed = btn.dataset.removed === '1';
                    if (block) block.style.opacity = removed ? '0.4' : '1';
                    btn.textContent = removed ? (t('repo.update.removed') || 'Will remove ✓') : (t('repo.update.removeProfile') || 'Remove profile');
                });
            });

            // Expand → load that profile's mods with per-mod checkboxes
            addEl.querySelectorAll('.repo-up-expand').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pid = (btn as HTMLElement).dataset.pid;
                    const box = addEl.querySelector(`.repo-up-mods[data-pid="${pid}"]`) as HTMLElement;
                    if (!box) return;
                    if (box.style.display === 'block') { box.style.display = 'none'; return; }
                    box.style.display = 'block';
                    if (!box.dataset.loaded) {
                        box.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:6px 0;">${t('common.loading') || 'Loading…'}</div>`;
                        try {
                            const mods = await invoke('get_profile_mod_list', { profileId: pid });
                            box.innerHTML = `
                                <div style="font-size:10px;color:var(--text-muted);margin:6px 0 4px;">${t('repo.update.modsHint') || 'Checked mods will be added. Leave all checked to add the whole profile.'}</div>
                                <!-- A profile with two hundred mods is four rows each: a wall
                                     you scroll past to reach anything else on the screen.
                                     Rows are FILTERED and capped, never re-rendered — a tick
                                     and a typed changelog live in the DOM, and rebuilding the
                                     list would quietly throw both away. -->
                                <div class="ru-mods-head">
                                    <input type="search" class="input input-sm ru-mods-find"
                                           data-pid="${escAttr(pid)}" spellcheck="false"
                                           placeholder="${escAttr(t('repo.update.findMod'))}">
                                    <span class="ru-mods-count" data-pid="${escAttr(pid)}"></span>
                                </div>
                                ${(mods as any[]).map(m => `
                                <div class="ru-mod-row" data-find="${escAttr(String(m.name || '').toLowerCase())}" style="padding:1px 0;">
                                    <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);cursor:pointer;">
                                        <input type="checkbox" class="repo-up-add-mod" data-pid="${escAttr(pid)}" data-mid="${escAttr(m.id)}" checked>
                                        <span>${escHtml(m.name)} <span style="color:var(--text-muted);">v${escHtml(m.version)}</span></span>
                                    </label>
                                    <input type="text" class="repo-up-mod-changelog" data-mid="${escAttr(m.id)}"
                                        placeholder="${escAttr(t('repo.update.changelogPlaceholder') || 'Changelog for this version (optional)')}"
                                        style="width:100%;margin:3px 0 2px 22px;max-width:calc(100% - 22px);font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid var(--bmm-s08,rgba(255,255,255,0.08));background:var(--bmm-s03,rgba(255,255,255,0.03));color:var(--text-secondary);" />
                                    <div style="display:flex;align-items:center;gap:6px;margin:0 0 4px 22px;font-size:9px;color:var(--text-muted);font-family:var(--font-mono);">
                                        <span>repo_mod_id:</span>
                                        <span style="color:var(--text-secondary);user-select:all;">${escHtml(m.id)}</span>
                                        <button type="button" class="repo-up-copy-id" data-mid="${escAttr(m.id)}" data-tooltip="${escAttr(t('common.copy') || 'Copy')}" style="border:none;background:rgba(255,255,255,0.06);color:var(--text-secondary);border-radius:3px;padding:1px 5px;cursor:pointer;font-size:9px;">${t('common.copy') || 'Copy'}</button>
                                    </div>
                                </div>`).join('') || `<div style="font-size:11px;color:var(--text-muted);">${t('repo.update.noMods') || 'No mods in this profile'}</div>`}
                                <button type="button" class="btn btn-xs btn-ghost ru-mods-more" style="display:none;margin-top:4px"></button>`;
                            box.dataset.loaded = '1';

                            // ── Find, and a cap ──────────────────────────────────────
                            const rows = [...box.querySelectorAll<HTMLElement>('.ru-mod-row')];
                            const findEl = box.querySelector('.ru-mods-find') as HTMLInputElement | null;
                            const countEl = box.querySelector('.ru-mods-count') as HTMLElement | null;
                            const moreEl = box.querySelector('.ru-mods-more') as HTMLButtonElement | null;
                            const STEP = 30;
                            let shown = STEP;

                            const paintRows = () => {
                                const q = (findEl?.value || '').trim().toLowerCase();
                                let matched = 0;
                                for (const row of rows) {
                                    const hit = !q || (row.dataset.find || '').includes(q);
                                    // Past the cap it is HIDDEN, not removed — its checkbox is
                                    // still in the form and still counts when the update runs,
                                    // which is what "leave all checked" has always meant.
                                    const within = hit && matched < shown;
                                    if (hit) matched += 1;
                                    row.style.display = within ? '' : 'none';
                                }
                                const hiddenByCap = Math.max(0, matched - shown);
                                if (countEl) {
                                    countEl.textContent = q
                                        ? t('repo.update.matchN').replace('{n}', String(matched)).replace('{m}', String(rows.length))
                                        : t('repo.update.modN').replace('{n}', String(rows.length));
                                }
                                if (moreEl) {
                                    moreEl.style.display = hiddenByCap ? '' : 'none';
                                    moreEl.textContent = t('repo.update.showMore').replace('{n}', String(hiddenByCap));
                                }
                            };
                            findEl?.addEventListener('input', () => { shown = STEP; paintRows(); });
                            moreEl?.addEventListener('click', () => { shown += STEP; paintRows(); });
                            paintRows();
                            // Selecting any mod auto-checks the profile
                            const profCb = addEl.querySelector(`.repo-up-add-profile[data-pid="${pid}"]`) as HTMLInputElement;
                            box.querySelectorAll('.repo-up-add-mod').forEach(cb => cb.addEventListener('change', () => { if (profCb) profCb.checked = true; }));
                            box.querySelectorAll('.repo-up-copy-id').forEach(b => b.addEventListener('click', (e) => {
                                e.preventDefault();
                                navigator.clipboard?.writeText((b as HTMLElement).dataset.mid || '').then(() => {
                                    toast(t('repo.update.idCopied') || 'repo_mod_id copied', 'success');
                                }).catch(() => {});
                            }));
                        } catch (e) { box.innerHTML = `<div style="font-size:11px;color:var(--danger);">${escHtml(String(e))}</div>`; }
                    }
                });
            });
        };

        btnOpen.addEventListener('click', async () => {
            await attachListener();
            modal.classList.add('open');
            // If an update is still running from before, keep showing its progress
            if (_ru.running || _ru.done) {
                repoDir = _ru.repoDir;
                pathInput.value = _ru.repoDir;
                syncProgressUI();
            } else {
                repoDir = '';
                pathInput.value = '';
                contentEl.style.display = 'none';
                progressEl.style.display = 'none';
                btnApply.disabled = true;
            }
        });

        // Load a repo folder into the dialog. Shared by the folder picker and by the pull
        // below, because "did this folder turn out to hold a repo" is one question and
        // answering it twice is how the two answers start to differ.
        const loadRepoFolder = async (folder: string): Promise<boolean> => {
            try {
                const repo = await invoke('read_local_repo', { repoDir: folder });
                repoDir = folder;
                pathInput.value = folder;
                _ru.done = false;
                progressEl.style.display = 'none';
                await renderLoaded(repo);
                // Publishing back only makes sense once there is something to publish, and
                // only when a target is configured — otherwise the button is an invitation to
                // an error message.
                const m = await import('./repo-ssh.js');
                const btnPub = document.getElementById('btn-repo-update-publish') as HTMLButtonElement | null;
                if (btnPub) btnPub.style.display = m.sshTargetNames().length ? 'inline-flex' : 'none';
                return true;
            } catch {
                toast(t('repo.update.errNoRepo') || 'No valid repo.json found in this folder', 'error');
                return false;
            }
        };

        // ── the two modes ───────────────────────────────────────────────────
        //
        // Local starts from a folder and can publish nowhere; a server address is fetched and
        // published back. Both end in the same editor below, which is why they are a switch
        // rather than two screens — what changes is only where the repo comes from.
        const setMode = (remote: boolean) => {
            const url = document.getElementById('repo-update-url') as HTMLElement | null;
            const pull = document.getElementById('btn-repo-update-pull') as HTMLElement | null;
            const browse = document.getElementById('btn-pick-repo-update-folder') as HTMLElement | null;
            if (url) url.style.display = remote ? '' : 'none';
            if (pull) pull.style.display = remote ? '' : 'none';
            // Browse stays in BOTH modes. In remote it is the DESTINATION rather than the
            // source, and hiding it left the folder field read-only with no way to change
            // where a fetch would land.
            if (browse) browse.style.display = '';
            if (pathInput) pathInput.readOnly = false;
            for (const [id, on] of [['repo-update-mode-local', !remote], ['repo-update-mode-remote', remote]] as const) {
                const b = document.getElementById(id);
                b?.classList.toggle('is-on', on);
                b?.setAttribute('aria-pressed', on ? 'true' : 'false');
            }
            // The publish button belongs to the remote mode. Shown in local mode it would
            // offer to push a folder to a server nobody named.
            const pub = document.getElementById('btn-repo-update-publish') as HTMLElement | null;
            if (pub && !remote) pub.style.display = 'none';
        };
        document.getElementById('repo-update-mode-local')?.addEventListener('click', () => setMode(false));
        document.getElementById('repo-update-mode-remote')?.addEventListener('click', () => setMode(true));
        setMode(false);

        // The SSH credentials block, mounted and wired in one place so markup with no
        // listeners cannot ship — the failure that has now bitten three separate screens.
        const sshMount = document.getElementById('repo-update-ssh-mount');
        if (sshMount && !sshMount.innerHTML) {
            void import('./ssh-source.js').then((m) => {
                sshMount.innerHTML = m.sshSourceHtml('repo-update');
                m.wireSshSource('repo-update', () => {
                    (document.getElementById('nav-settings') as HTMLElement | null)?.click();
                    setTimeout(() => document.getElementById('settings-identity-card')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
                });
            });
        }

        // ── from the server ─────────────────────────────────────────────────
        //
        // The repo is fetched into a folder YOU choose, not a hidden working copy: the update
        // writes into it, and a folder you cannot see is a folder you cannot check before
        // publishing it back over what is live.
        document.getElementById('btn-repo-update-pull')?.addEventListener('click', async () => {
            const m = await import('./repo-ssh.js');
            const src = await import('./ssh-source.js');
            const names = m.sshTargetNames();
            if (!names.length) {
                // Say where to configure it rather than failing about a field never filled in.
                toast(t('repo.sync.useSshNotSet'), 'warning', 7000);
                return;
            }
            // Credentials typed into the block below, when there are any. This is the path
            // that makes a PASSWORD server usable from here at all: the stored-target helpers
            // refuse one on purpose, because nothing about a password is written down and an
            // unattended run has nobody to ask. Somebody is looking at this dialog.
            const typedCreds = src.readSshSource('repo-update');
            // The address names WHICH server. `ssh://nom` picks that target, `ssh://` the one
            // called default, and an empty field the only one you have.
            const typed = (document.getElementById('repo-update-url') as HTMLInputElement | null)?.value?.trim() || '';
            let target = names[0];
            if (typed) {
                const parsed = m.sshTargetName(typed);
                if (!parsed) { toast(t('repo.update.urlBad'), 'warning', 7000); return; }
                if (!names.includes(parsed)) { toast(t('repo.update.urlNoTarget').replace('{name}', parsed), 'warning', 8000); return; }
                target = parsed;
            }
            // Where it LANDS, decided without asking.
            //
            // A button labelled "from the server" that opens a local file explorer is the
            // opposite of what it says, and that is what this did whenever the export folder
            // was empty. Order: the export folder if there is one — it is where Publier par
            // SSH already sends from, so fetch, edit and publish speak about one place — then
            // whatever is already typed in the field, then a folder BMM keeps for this.
            // Never a dialog: the field shows where it went and stays editable.
            let folder = (document.getElementById('repo-export-path') as HTMLInputElement | null)?.value?.trim()
                || pathInput?.value?.trim() || '';
            if (!folder) {
                try { folder = await invoke('default_remote_repo_dir') as string; } catch { folder = ''; }
            }
            if (!folder) { toast(t('repo.update.noFolder'), 'warning', 7000); return; }
            const btn = document.getElementById('btn-repo-update-pull') as HTMLButtonElement | null;
            if (btn) btn.disabled = true;
            try {
                toast(t('repo.update.pulling'), 'info', 4000);
                const n = typedCreds.ssh
                    ? await m.pullWithTarget(folder, typedCreds.ssh, typedCreds.sshSecret)
                    : await m.pullStoredTarget(folder, target);
                toast((t('repo.update.pulled') || '').replace('{n}', String(n)), 'success', 5000);
                await loadRepoFolder(folder);
            } catch (e) {
                toast(explainSsh(String(e)), 'error', 9000);
            } finally {
                if (btn) btn.disabled = false;
            }
        });

        // ── and back again ──────────────────────────────────────────────────
        document.getElementById('btn-repo-update-publish')?.addEventListener('click', async () => {
            if (!repoDir) return;
            const m = await import('./repo-ssh.js');
            const src = await import('./ssh-source.js');
            const names = m.sshTargetNames();
            if (!names.length) { toast(t('repo.sync.useSshNotSet'), 'warning', 7000); return; }
            // Read here too. A fetch that used typed credentials and a publish that fell back
            // to the stored target would put the edited repo on a DIFFERENT server from the
            // one it came from, and report success for doing it.
            const pubCreds = src.readSshSource('repo-update');
            // Back to the target the address names, so a fetch and its publish cannot end up
            // on two different servers.
            const typedP = (document.getElementById('repo-update-url') as HTMLInputElement | null)?.value?.trim() || '';
            const pTarget = (typedP && m.sshTargetName(typedP)) || names[0];
            // Publishing overwrites what people are downloading right now. The confirm says
            // WHAT changes rather than "are you sure".
            const ok = await (window as any).confirmCustom?.(
                t('repo.update.publishTitle'),
                t('repo.update.publishMsg').replace('{name}', pTarget),
                'warning',
            ).catch(() => false);
            if (!ok) return;
            const btn = document.getElementById('btn-repo-update-publish') as HTMLButtonElement | null;
            if (btn) btn.disabled = true;
            try {
                const n = pubCreds.ssh
                    ? await m.publishWithTarget(repoDir, pubCreds.ssh, pubCreds.sshSecret)
                    : await m.publishStoredTarget(repoDir, pTarget);
                toast((t('repo.update.published') || '').replace('{n}', String(n)), 'success', 6000);
            } catch (e) {
                toast(explainSsh(String(e)), 'error', 9000);
            } finally {
                if (btn) btn.disabled = false;
            }
        });

        btnPick?.addEventListener('click', async () => {
            const folder = await pickFolder().catch(() => null);
            if (!folder) return;
            {
                await loadRepoFolder(folder);
            }
        });

        btnApply?.addEventListener('click', async () => {
            if (!repoDir || _ru.running) return;

            const removeProfileIds = Array.from(currentEl.querySelectorAll('.repo-up-rm-profile'))
                .filter(b => (b as HTMLElement).dataset.removed === '1')
                .map(b => (b as HTMLElement).dataset.pid);

            const removeModIds = Array.from(currentEl.querySelectorAll('.repo-up-keep-mod'))
                .filter(cb => !(cb as HTMLInputElement).checked)
                .map(cb => (cb as HTMLElement).dataset.mid);

            // Build add_profiles with per-mod selection
            const addProfiles = Array.from(addEl.querySelectorAll('.repo-up-add-profile'))
                .filter(cb => (cb as HTMLInputElement).checked)
                .map(cb => {
                    const pid = (cb as HTMLElement).dataset.pid;
                    const modCbs = Array.from(addEl.querySelectorAll(`.repo-up-add-mod[data-pid="${pid}"]`));
                    // If the mod list was expanded, honour the per-mod selection; else add all (null)
                    let modIds = null;
                    if (modCbs.length) {
                        const checked = modCbs.filter(m => (m as HTMLInputElement).checked).map(m => (m as HTMLElement).dataset.mid);
                        // null = all; only send a subset if not everything is checked
                        if (checked.length !== modCbs.length) modIds = checked;
                    }
                    return { profile_id: pid, mod_ids: modIds };
                });

            if (!removeProfileIds.length && !removeModIds.length && !addProfiles.length) {
                toast(t('repo.update.noChanges') || 'No changes selected', 'warning');
                return;
            }

            // Per-mod author changelogs (only for mods actually being added/updated)
            const addedModIds = new Set<string>();
            addProfiles.forEach(p => {
                const cbs = addEl.querySelectorAll(`.repo-up-add-mod[data-pid="${p.profile_id}"]`);
                if (!cbs.length || p.mod_ids === null) {
                    // whole profile → include every expanded mod row + leave room for non-expanded
                    cbs.forEach(cb => { if ((cb as HTMLInputElement).checked) addedModIds.add((cb as HTMLElement).dataset.mid!); });
                } else {
                    (p.mod_ids as string[]).forEach(id => addedModIds.add(id));
                }
            });
            const modChangelogs: Record<string, string> = {};
            addEl.querySelectorAll('.repo-up-mod-changelog').forEach(inp => {
                const mid = (inp as HTMLElement).dataset.mid!;
                const val = (inp as HTMLInputElement).value.trim();
                if (val && addedModIds.has(mid)) modChangelogs[mid] = val;
            });

            const authorName = localStorage.getItem('bmm_last_author') || '';

            _ru.running = true; _ru.done = false; _ru.percent = 0;
            _ru.status = t('repo.update.starting') || 'Starting…'; _ru.repoDir = repoDir; _ru.summary = '';
            syncProgressUI();

            try {
                const res = await invoke('update_server_repo', {
                    repoDir,
                    authorName: authorName || null,
                    ops: { remove_mod_ids: removeModIds, remove_profile_ids: removeProfileIds, add_profiles: addProfiles, mod_changelogs: modChangelogs }
                });
                _ru.running = false; _ru.done = true; _ru.percent = 100;
                _ru.summary = `${t('repo.update.done') || 'Repo updated'} — +${res.mods_added} / ~${res.mods_updated} / -${res.mods_removed}`;
                syncProgressUI();
                toast(_ru.summary, 'success');
                // Reload the modal content to reflect the new post-update state
                await reloadCurrentRepo();
            } catch (e) {
                _ru.running = false; _ru.done = false;
                syncProgressUI();
                const msg = String(e);
                toast(msg.includes('cancel') ? (t('repo.cancelled') || 'Cancelled') : msg, msg.includes('cancel') ? 'info' : 'error');
                // Even after a cancel, reload to show whatever state the repo is in
                await reloadCurrentRepo();
            }
        });

        // Cancel the running update (sets the shared cancel flag; the Rust loop
        // checks it per-file so it stops quickly without freezing).
        btnCancel?.addEventListener('click', () => {
            invoke('cancel_repo_export').catch(() => {});
            _ru.status = t('repo.cancelling') || 'Cancelling…';
            syncProgressUI();
        });

        // Closing the modal does NOT cancel the running update.
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

        // ── Listen for API-driven pre-load (from bmm:repo-focus section='update') ──
        // When the API quicktest drives this modal, it emits this event after opening.
        document.addEventListener('bmm:repo-update-loaded', async (e: any) => {
            const { repo, repoDir: apiDir } = e.detail || {};
            if (!repo || !apiDir) return;
            repoDir = apiDir;
            pathInput.value = apiDir;
            _ru.done = false;
            progressEl.style.display = 'none';
            await renderLoaded(repo);
        });
    };
    initRepoUpdate();

    // ── Repo Hub (multi-repo Node server) ──
    const initRepoHub = () => {
        const modal = document.getElementById('modal-repo-hub');
        const btnOpen = document.getElementById('btn-open-repo-hub');
        const pathInput = document.getElementById('repo-hub-path') as HTMLInputElement;
        const btnPick = document.getElementById('btn-pick-repo-hub-folder');
        const listEl = document.getElementById('repo-hub-list');
        const btnGen = document.getElementById('btn-generate-repo-hub') as HTMLButtonElement;
        const resultEl = document.getElementById('repo-hub-result');
        if (!modal || !btnOpen) return;

        let hubDir = '';

        const fmt = (b) => { if (!b) return '0 B'; const u=['B','KB','MB','GB','TB']; const i=Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(1)+' '+u[i]; };

        btnOpen.addEventListener('click', () => {
            hubDir = ''; pathInput.value = '';
            listEl.style.display = 'none'; listEl.innerHTML = '';
            resultEl.style.display = 'none';
            btnGen.disabled = true;
            modal.classList.add('open');
        });

        btnPick?.addEventListener('click', async () => {
            const folder = await pickFolder().catch(() => null);
            if (!folder) return;
            hubDir = folder;
            pathInput.value = folder;
            resultEl.style.display = 'none';
            try {
                const repos = await invoke('scan_repo_hub', { hubDir: folder });
                if (!repos.length) {
                    listEl.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:8px;">${t('repo.hub.none') || 'No repos found in this folder. Each repo must be its own sub-folder with a repo.json.'}</div>`;
                } else {
                    listEl.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">${repos.length} ${t('repo.hub.found') || 'repos found'}</div>` +
                        repos.map(r => `
                        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;gap:12px;">
                            <div style="flex:1; display:flex; align-items:center; gap:10px; min-width:0;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2" style="flex-shrink:0;">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                                <div style="flex:1; min-width:0;">
                                    <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.name)}</div>
                                    <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-repo-path="${escAttr(folder)}/${r.folder === '.' ? '' : escAttr(r.folder) + '/'}repo.json">${r.folder === '.' ? '(hub root)' : escHtml(r.folder)}/repo.json</div>
                                </div>
                            </div>
                            <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
                                <button class="repo-hub-copy-btn" data-path="${escAttr(folder)}/${r.folder === '.' ? '' : escAttr(r.folder) + '/'}repo.json" data-folder="${escAttr(r.folder)}" style="padding:6px 10px;font-size:11px;background:rgba(6,182,212,0.15);color:var(--cyan);border:1px solid rgba(6,182,212,0.3);border-radius:6px;cursor:pointer;white-space:nowrap;transition:all 0.15s;" data-hover="background:rgba(6,182,212,0.25)" data-tasky="repo.hub.copyPath" data-tasky-icon="copy" data-hover-out="background:rgba(6,182,212,0.15)">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:4px;vertical-align:-1px;">
                                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                                    </svg>
                                    Copy
                                </button>
                                <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${r.profiles} prof · ${r.mods} mods · ${fmt(r.size)}</span>
                            </div>
                        </div>`).join('');
                    // Add event listeners to copy buttons
                    document.querySelectorAll('.repo-hub-copy-btn').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const path = btn.getAttribute('data-path');
                            if (path) {
                                navigator.clipboard.writeText(path);
                                toast(t('common.copied') || 'Copied!', 'success');
                            }
                        });
                    });
                }
                listEl.style.display = 'flex';
                btnGen.disabled = false;
            } catch (e) {
                listEl.innerHTML = `<div style="font-size:12px;color:var(--danger);padding:8px;">${escHtml(String(e))}</div>`;
                listEl.style.display = 'flex';
                btnGen.disabled = true;
            }
        });

        // Highlight selected mode card
        document.querySelectorAll('input[name="repo-hub-mode"]').forEach(r => {
            r.addEventListener('change', () => {
                document.querySelectorAll('.repo-hub-mode-opt').forEach(l => {
                    const inp = l.querySelector('input') as HTMLInputElement;
                    (l as HTMLElement).style.borderColor = inp.checked ? 'var(--cyan)' : 'var(--border)';
                });
            });
        });

        btnGen?.addEventListener('click', async () => {
            if (!hubDir) return;
            const port = parseInt((document.getElementById('repo-hub-port') as HTMLInputElement).value) || 8080;
            const limit = parseInt((document.getElementById('repo-hub-limit') as HTMLInputElement).value) || 0;
            const adminPassword = (document.getElementById('repo-hub-adminpw') as HTMLInputElement)?.value?.trim() || null;
            const mode = (document.querySelector('input[name="repo-hub-mode"]:checked') as HTMLInputElement)?.value || 'serve';
            const serve = mode === 'serve';
            btnGen.disabled = true;
            try {
                await invoke('generate_repo_hub', { hubDir, port, uploadLimit: limit, serve, adminPassword });
                if (serve) {
                    resultEl.innerHTML = `
                        ✓ ${t('repo.hub.done') || 'Hub server generated!'}<br>
                        <span style="color:var(--text-secondary)">${t('repo.hub.runHint') || 'Run'} <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">Start-Hub.bat</code> / <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">start-hub.sh</code>.<br>${t('repo.hub.dashHint') || 'Dashboard:'} <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">http://&lt;ip&gt;:${port}/</code> · ${t('repo.hub.perRepo') || 'each repo has its own page'}</span>`;
                } else {
                    resultEl.innerHTML = `
                        ✓ ${t('repo.hub.doneStatic') || 'Static directory generated!'}<br>
                        <span style="color:var(--text-secondary)">${t('repo.hub.staticHint') || 'Edit'} <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">hub-repos.json</code> ${t('repo.hub.staticHint2') || 'to fill each repo URL, then host this folder anywhere (open index.html).'}</span>`;
                }
                resultEl.style.display = 'block';
                toast(serve ? (t('repo.hub.done') || 'Hub server generated!') : (t('repo.hub.doneStatic') || 'Static directory generated!'), 'success');
            } catch (e) {
                toast(String(e), 'error');
            } finally {
                btnGen.disabled = false;
            }
        });

        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
    };
    initRepoHub();

    const saveHostHistory = (path) => {
        try {
            let paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            paths = paths.filter(p => p !== path);
            paths.unshift(path);
            if (paths.length > 10) paths.length = 10;
            localStorage.setItem('bmm_repo_history_host', JSON.stringify(paths));
            loadHostHistory();
        } catch(e) {}
    };

    const loadHostHistory = () => {
        try {
            const paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            if (elements.hostHistorySelect) {
                if (paths.length > 0) {
                    if (elements.hostHistoryContainer) elements.hostHistoryContainer.style.display = 'block';
                    elements.hostHistorySelect.innerHTML = `<option value="">${t('repo.hostHistoryDefault')}</option>` +
                        paths.map(p => `<option value="${escAttr(p)}">${escHtml(p)}</option>`).join('');
                } else if (elements.hostHistoryContainer) {
                    elements.hostHistoryContainer.style.display = 'none';
                }
            }
        } catch(e) {}
    };
    loadHostHistory();

    const previewHostRepo = async (path) => {
        if (!path) {
            if (elements.hostMetadataPreview) elements.hostMetadataPreview.style.display = 'none';
            return;
        }
        const hostInput = document.getElementById('repo-host-path');
        if (hostInput) hostInput.value = path;
        
        try {
            if (window.__TAURI__) {
                const content = await invoke('read_file_text', { path: path + '/repo.json' }) as string;
                const repo = JSON.parse(content);
                const pCount = repo.profiles ? repo.profiles.length : 0;
                const pNames = repo.profiles ? repo.profiles.map(p => p.name).join(', ') : '';
                let totalSize = 0;
                if (repo.profiles) {
                    repo.profiles.forEach(p => {
                        if (p.mods) p.mods.forEach(m => {
                            if (m.files) m.files.forEach(f => totalSize += f.size);
                        });
                    });
                }
                if (elements.hostMetadataPreview) {
                    elements.hostMetadataPreview.style.display = 'block';
                    elements.hostMetadataPreview.innerHTML = `
                        <div style="color:var(--accent);font-weight:700;margin-bottom:4px;font-size:14px;">${escHtml(repo.name)}</div>
                        <div style="color:var(--text-secondary);margin-bottom:2px;">${t('repo.authorShort')} <span style="color:var(--text-primary)">${escHtml(repo.author || '-')}</span></div>
                        <div style="color:var(--text-secondary);margin-bottom:2px;">${t('repo.profilesCount').replace('{count}', pCount)} <span style="color:var(--text-primary)">${escHtml(pNames)}</span></div>
                        <div style="color:var(--cyan);margin-top:6px;font-family:var(--font-mono)">${t('repo.totalSizeLabel')} ${formatBytes(totalSize)}</div>
                    `;
                }
            }
        } catch (err) {
            if (elements.hostMetadataPreview) {
                elements.hostMetadataPreview.style.display = 'block';
                elements.hostMetadataPreview.innerHTML = `<div style="color:var(--danger);">${t('repo.readError')} (${err})</div>`;
            }
        }
    };

    if (elements.hostHistorySelect) {
        elements.hostHistorySelect.addEventListener('change', (e) => {
            previewHostRepo(e.target.value);
        });
    }

    // --- Profile Checklist ---
    loadProfilesForExport(elements.profilesListEl);
    loadModpacksForExport(elements.modpacksListEl);

    // Re-render these JS-built lists on language change so their labels
    // (empty states, game names, share-mode options) translate live without a refresh.
    document.addEventListener('langChanged', () => {
        loadProfilesForExport(elements.profilesListEl);
        loadModpacksForExport(elements.modpacksListEl);
    });

    // Refresh button
    if (elements.btnRefreshProfiles) {
        elements.btnRefreshProfiles.addEventListener('click', () => {
            loadProfilesForExport(elements.profilesListEl);
            loadModpacksForExport(elements.modpacksListEl);
            toast(t('repo.profilesRefreshed') || 'Profiles list refreshed', 'success');
        });
    }

    // --- Pickers ---
    if (elements.btnPickExport) {
        elements.btnPickExport.addEventListener('click', async () => {
            const folder = await pickFolder();
            if (folder) {
                elements.inputExportPath.value = folder;
                try {
                    if (window.__TAURI__) {
                        const content = await invoke('read_file_text', { path: folder + '/repo.json' }) as string;
                        const repo = JSON.parse(content);
                        if (repo.seed && elements.inputExportSeed) {
                            elements.inputExportSeed.value = repo.seed;
                            toast(t('repo.seedDetected'), 'info');
                        }
                    }
                } catch (e) { if (elements.inputExportSeed) elements.inputExportSeed.value = ''; }
            }
        });
    }

    const btnPickRepoHost = document.getElementById('btn-pick-repo-host');
    if (btnPickRepoHost) btnPickRepoHost.onclick = async () => {
        const folder = await pickFolder();
        if (folder) previewHostRepo(folder);
    };

    if (elements.btnPickSyncGame) elements.btnPickSyncGame.onclick = async () => { const f = await pickFolder(); if (f) elements.inputSyncGamePath.value = f; };
    if (elements.btnPickSyncMods) elements.btnPickSyncMods.onclick = async () => { const f = await pickFolder(); if (f) elements.inputSyncModsPath.value = f; };
    if (elements.btnPickSyncBackup) elements.btnPickSyncBackup.onclick = async () => { const f = await pickFolder(); if (f) elements.inputSyncBackupPath.value = f; };

    // --- Creator ID ---
    const initCreatorId = async () => {
        try {
            const creatorId = await invoke('get_creator_id');
            if (elements.repoCreatorIdValue) elements.repoCreatorIdValue.textContent = creatorId;
            if (elements.repoCreatorIdContainer) elements.repoCreatorIdContainer.style.display = 'block';
        } catch (err) { console.error("Failed to load Creator ID:", err); }
    };
    initCreatorId();

    // Copy-my-creator-id button (was unwired → copied nothing).
    const btnCopyCreator = document.getElementById('btn-copy-my-creator-id');
    if (btnCopyCreator && !(btnCopyCreator as any).dataset.wired) {
        (btnCopyCreator as any).dataset.wired = '1';
        btnCopyCreator.addEventListener('click', async () => {
            let id = elements.repoCreatorIdValue?.textContent?.trim() || '';
            if (!id || id === '…') { try { id = await invoke('get_creator_id'); } catch {} }
            if (!id) { toast(t('repo.errNoCreatorId') || 'Creator ID not ready', 'warning'); return; }
            try { await navigator.clipboard.writeText(id); toast(t('repo.creatorIdCopied') || 'Creator ID copied', 'success'); }
            catch { toast(t('common.error') || 'Copy failed', 'error'); }
        });
    }

    // --- Export process ---
    if (elements.btnStartExport) {
        elements.btnStartExport.addEventListener('click', async () => {
            const outPath = elements.inputExportPath.value.trim();
            const authorName = elements.inputExportAuthor ? elements.inputExportAuthor.value.trim() : "";
            if (!outPath) return toast(t('repo.errNoOutDir'), 'warning');
            if (!authorName) { toast(t('repo.errNoAuthor'), 'warning'); elements.inputExportAuthor?.focus(); return; }
            const safeAuthor = authorName.slice(0, 25);   // creator name capped at 25 chars
            localStorage.setItem('bmm_last_author', safeAuthor);
            // Telemetry (opt-in): the team tracks every creator name a user hosts under.
            try { const { track } = await import('../../core/analytics.js'); track('repo_host', { creator_name: safeAuthor }); } catch {}

            const cbs = document.querySelectorAll('.repo-profile-cb:checked');
            const profileIds = Array.from(cbs).map(c => c.value);
            if (profileIds.length === 0) return toast(t('repo.errNoProfile'), 'warning');

            let unlisten;
            try {
                // Mark the API guard busy so external API gen calls are rejected.
                try { invoke('set_repo_busy', { kind: 'gen', busy: true }); } catch (_) {}
                elements.btnStartExport.disabled = true;
                elements.exportProgressContainer.style.display = 'block';
                elements.exportStatus.textContent = t('repo.exporting');
                // Reset progress bar from any previous run (otherwise the >= guard
                // below keeps it stuck at the old 100%).
                if (elements.exportPercent) elements.exportPercent.textContent = '0%';
                if (elements.exportFill) elements.exportFill.style.width = '0%';
                if (elements.btnCancelExport) { elements.btnCancelExport.style.display = 'flex'; elements.btnCancelExport.disabled = false; }

                if (window.__TAURI__) {
                    const { listen } = (window as any).__TAURI__.event;
                    unlisten = await listen('bmm://repo-export-progress', (event) => {
                        const { step, progress } = event.payload;
                        if (progress !== undefined) {
                            const pct = Math.round(progress);
                            const currentPct = parseInt(elements.exportPercent.textContent) || 0;
                            if (pct >= currentPct) {
                                elements.exportPercent.textContent = `${pct}%`;
                                elements.exportFill.style.width = `${pct}%`;
                            }
                        }
                        if (step) elements.exportStatus.textContent = t(step) || step;
                    });
                }

                // Modpacks are chosen in "Include in the repo…" now, and written into the
                // manifest by repo_modpacks_apply. Sending null here rather than an empty
                // list on purpose: an export must not WIPE what that screen published, and
                // the Rust side leaves the field alone when it is None.
                const modpacksShareConfig = null;

                let serverOptions = null;
                if (elements.cbZipEnable && elements.cbZipEnable.checked) {
                    serverOptions = {
                        port: parseInt(elements.inputZipPort.value) || 8000,
                        upload_limit: parseInt(elements.inputZipLimit.value) || 0,
                        admin_password: elements.inputZipPass.value || "admin",
                        download_password: elements.inputZipDownloadPass ? (elements.inputZipDownloadPass.value || "") : "",
                        server_version: parseInt(elements.selectZipVersion.value) || 2,
                        server_type: elements.selectZipType ? elements.selectZipType.value : "user",
                        use_cloudflare: elements.cbZipCloudflare.checked,
                        use_upnp: elements.cbZipUpnp.checked,
                        enable_docker: elements.cbZipDocker ? elements.cbZipDocker.checked : false,
                        docker_host_type: elements.zipDockerHostSelect ? elements.zipDockerHostSelect.value : "linux"
                    };
                }

                await invoke('export_server_repo', { 
                    profileIds, 
                    outputDir: outPath, 
                    authorName,
                    seed: elements.inputExportSeed ? elements.inputExportSeed.value.trim() || null : null,
                    modpacksShareConfig: modpacksShareConfig.length > 0 ? modpacksShareConfig : null,
                    zipOutput: elements.cbZipEnable ? elements.cbZipEnable.checked : false,
                    zipMods: elements.cbZipMods ? elements.cbZipMods.checked : false,
                    serverOptions: serverOptions
                });
                saveHostHistory(outPath);
                elements.exportStatus.textContent = t('repo.exportDone');
                toastSaved(t('repo.exportSuccess'));
            } catch (err) {
                const errMsg = String(err);
                const isCancel = errMsg.includes('cancel');
                elements.exportStatus.textContent = isCancel ? t('repo.cancelled') : t('repo.exportError');
                if (!isCancel) toast(errMsg, 'error');
            } finally {
                elements.btnStartExport.disabled = false;
                if (elements.btnCancelExport) elements.btnCancelExport.style.display = 'none';
                if (unlisten) unlisten();
                // Release the API "generation in progress" guard.
                try { invoke('set_repo_busy', { kind: 'gen', busy: false }); } catch (_) {}

                // Hide progress bar if it was a cancellation
                if (elements.exportStatus.textContent === t('repo.cancelled')) {
                    elements.exportProgressContainer.style.display = 'none';
                }
            }
        });
    }

    // What else goes in the repo. Deliberately not chained to the export run — it takes a
    // FOLDER, which means it works on a repo exported five minutes ago and on one published
    // last spring, without regenerating a single mod.
    // The orientation note at the top of the Host tab.
    //
    // It answers "what am I looking at" once. After that it is a paragraph between somebody
    // and the button they came for, so it closes and stays closed — and the "How does this
    // work?" button on step 1 brings it back, which is where somebody would look for it.
    {
        const lede = document.getElementById('repo-host-lede');
        const KEY = 'bmm_repo_host_lede_hidden';
        if (lede && localStorage.getItem(KEY) === '1') lede.hidden = true;
        document.getElementById('repo-host-lede-x')?.addEventListener('click', () => {
            if (!lede) return;
            lede.hidden = true;
            try { localStorage.setItem(KEY, '1'); } catch { /* private mode: closed for this session only */ }
        });
        // The close button's tooltip says this brings it back, so it has to. A promise in a
        // tooltip that nothing implements is worse than no tooltip.
        document.querySelector('[data-act="openDiagram"][data-act-args*="hosting-flow"]')
            ?.addEventListener('click', () => {
                if (!lede) return;
                lede.hidden = false;
                try { localStorage.removeItem(KEY); } catch { /* nothing to undo */ }
            });
    }

    const btnExtras = document.getElementById('btn-repo-extras');
    if (btnExtras) {
        btnExtras.addEventListener('click', async () => {
            const { openExtrasPicker } = await import('./repo-extras.js');
            const hint = (elements.inputExportPath as HTMLInputElement | null)?.value?.trim() || '';
            await openExtrasPicker(hint || undefined);
        });
    }

    if (elements.btnCancelExport) {
        elements.btnCancelExport.onclick = async () => {
            try {
                elements.btnCancelExport.disabled = true;
                await invoke('cancel_repo_export');
                toast(t('repo.cancelExport'), 'info');
            } catch (e) {}
        };
    }

    const lastAuthor = localStorage.getItem('bmm_last_author');
    if (lastAuthor && elements.inputExportAuthor) elements.inputExportAuthor.value = lastAuthor;

    if (elements.cbZipEnable && elements.zipOptionsPanel) {
        elements.cbZipEnable.addEventListener('change', () => {
            elements.zipOptionsPanel.style.display = elements.cbZipEnable.checked ? 'block' : 'none';
        });
    }

    if (elements.btnToggleZipPass && elements.inputZipPass) {
        elements.btnToggleZipPass.addEventListener('click', () => {
            const isPass = elements.inputZipPass.type === 'password';
            elements.inputZipPass.type = isPass ? 'text' : 'password';
            elements.btnToggleZipPass.innerHTML = isPass
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        });
    }

    // ZIP Docker toggle
    if (elements.cbZipDocker) {
        elements.cbZipDocker.addEventListener('change', () => {
            if (elements.zipDockerOptions) {
                elements.zipDockerOptions.style.display = elements.cbZipDocker.checked ? 'block' : 'none';
            }
        });
    }

    // --- Events ---
    window.addEventListener('bmm://modpacks-updated', () => {
        if (elements.modpacksListEl) {
            loadModpacksForExport(elements.modpacksListEl);
        }
    });
}
