// « Host a repo » as four steps — folder → manifest → start → share — painted from the real
// state, never from what was clicked last:
//   folder    the host folder field has a path;
//   manifest  its repo.json was read and BMM can serve it (repo-format.ts says so);
//   start     the built-in server runs (repo-server.ts says so);
//   share     it runs AND an address is on screen to copy.
// The first step not done is the current one. Also owns the running-server panel's visibility
// and its folded activity log (who connected, what they downloaded, this session).
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';

type Step = 'folder' | 'manifest' | 'start' | 'share';
const STEPS: Step[] = ['folder', 'manifest', 'start', 'share'];

const state = { folder: false, manifest: null as null | boolean, running: false, shareable: false };

function paint(): void {
    const flow = document.getElementById('repo-host-flow');
    if (!flow) return;
    flow.setAttribute('aria-label', t('repo.flow.aria'));
    const done: Record<Step, boolean> = {
        folder: state.folder,
        manifest: state.folder && state.manifest === true,
        start: state.running,
        share: state.running && state.shareable,
    };
    const current = STEPS.find((s) => !done[s]) || null;
    for (const s of STEPS) {
        const li = flow.querySelector<HTMLElement>(`[data-flow-step="${s}"]`);
        if (!li) continue;
        li.classList.toggle('is-done', done[s]);
        li.classList.toggle('is-current', s === current);
        li.classList.toggle('is-blocked', s === 'manifest' && state.folder && state.manifest === false);
        if (s === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
    // The blocks below the strip carry the same state on their numbered heading: the folder
    // block covers steps 1-2, the start block step 3.
    const blockDone: Record<string, boolean> = { folder: done.folder && done.manifest, start: done.start };
    const blockCurrent: Record<string, boolean> = { folder: current === 'folder' || current === 'manifest', start: current === 'start' };
    document.querySelectorAll<HTMLElement>('#view-repo [data-flow-block]').forEach((b) => {
        const k = b.dataset.flowBlock || '';
        b.classList.toggle('is-done', !!blockDone[k]);
        b.classList.toggle('is-current', !!blockCurrent[k]);
    });
    const panel = document.getElementById('repo-run-panel');
    if (panel) panel.classList.toggle('is-on', state.running);
}

/** repo-server.ts calls this whenever the server starts, stops or is found running. */
export function setHostRunning(running: boolean, shareable: boolean): void {
    state.running = running;
    state.shareable = running && shareable;
    paint();
}

const LOG_CAP = 60;
let logCount = 0;

/** One line in the session's activity log (newest first). Text only. */
export function pushHostActivity(kind: 'connect' | 'start' | 'done', text: string): void {
    const list = document.getElementById('repo-server-activity-list');
    if (!list) return;
    const li = document.createElement('li');
    li.className = `rp-act rp-act--${kind}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.innerHTML = `<span class="rp-act-time">${escHtml(time)}</span> <span class="rp-act-txt"></span>`;
    (li.querySelector('.rp-act-txt') as HTMLElement).textContent = text;
    list.prepend(li);
    while (list.children.length > LOG_CAP) list.lastElementChild?.remove();
    logCount += 1;
    const n = document.getElementById('repo-server-activity-n');
    if (n) n.textContent = String(logCount);
    const empty = document.getElementById('repo-server-activity-empty');
    if (empty) empty.hidden = true;
}

export function initRepoHostFlow(): void {
    const input = document.getElementById('repo-host-path') as HTMLInputElement | null;
    if (!input || input.dataset.flowWired) return;
    input.dataset.flowWired = '1';
    const onFolder = () => {
        state.folder = !!input.value.trim();
        state.manifest = null;
        paint();
    };
    input.addEventListener('input', onFolder);
    document.addEventListener('bmm:repo-format', (e: Event) => {
        const d = (e as CustomEvent).detail as { ok: boolean } | null;
        state.manifest = d ? d.ok : null;
        paint();
    });
    document.addEventListener('langChanged', paint);
    onFolder();
    initRepoSyncFlow();
}

// ── « Join a repo » as three steps — address → folders → sync — painted the same way ─────────
//   address  a repo was fetched (its card is on screen);
//   folders  BMM knows where the mods go: the chosen profiles' own folders (the hint says so),
//            or the game and mods folders typed for a new profile;
//   sync     the last run reached 100 %.
// Read from the page's own state (what is shown, what is filled), so a reload, a cleared repo
// or a profile ticked off moves the strip back with it.

type SyncStep = 'address' | 'folders' | 'sync';
const SYNC_STEPS: SyncStep[] = ['address', 'folders', 'sync'];

function shown(id: string): boolean {
    const el = document.getElementById(id);
    return !!el && el.style.display !== 'none' && !el.hidden;
}
function filled(id: string): boolean {
    return !!(document.getElementById(id) as HTMLInputElement | null)?.value?.trim();
}

function paintSync(): void {
    const flow = document.getElementById('repo-sync-flow');
    if (!flow) return;
    flow.setAttribute('aria-label', t('repo.flow.syncAria'));
    const address = shown('repo-sync-info-card');
    const folders = address && (shown('repo-sync-paths-existing-hint')
        || (shown('repo-sync-paths-section') && filled('repo-sync-game-path') && filled('repo-sync-mods-path')));
    const sync = address && folders
        && /^100\s*%$/.test(document.getElementById('repo-sync-percent')?.textContent?.trim() || '')
        && shown('repo-sync-progress-container');
    const done: Record<SyncStep, boolean> = { address, folders, sync };
    const current = SYNC_STEPS.find((s) => !done[s]) || null;
    for (const s of SYNC_STEPS) {
        const li = flow.querySelector<HTMLElement>(`[data-flow-step="${s}"]`);
        if (!li) continue;
        li.classList.toggle('is-done', done[s]);
        li.classList.toggle('is-current', s === current);
        if (s === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    }
    const block: Record<string, SyncStep> = { address: 'address', folders: 'folders', run: 'sync' };
    document.querySelectorAll<HTMLElement>('#view-repo [data-sync-block]').forEach((b) => {
        const s = block[b.dataset.syncBlock || ''];
        if (!s) return;
        b.classList.toggle('is-done', done[s]);
        b.classList.toggle('is-current', s === current);
    });
}

let _syncQueued = false;
function queueSync(): void {
    if (_syncQueued) return;
    _syncQueued = true;
    setTimeout(() => { _syncQueued = false; paintSync(); }, 0);
}

export function initRepoSyncFlow(): void {
    const flow = document.getElementById('repo-sync-flow');
    if (!flow || flow.dataset.flowWired) return;
    flow.dataset.flowWired = '1';
    // Style and text changes of the few nodes that carry the state; nothing else is watched.
    const mo = new MutationObserver(queueSync);
    for (const id of ['repo-sync-info-card', 'repo-sync-paths-section', 'repo-sync-paths-existing-hint', 'repo-sync-progress-container']) {
        const el = document.getElementById(id);
        if (el) mo.observe(el, { attributes: true, attributeFilter: ['style', 'hidden'] });
    }
    const pct = document.getElementById('repo-sync-percent');
    if (pct) mo.observe(pct, { childList: true, characterData: true, subtree: true });
    for (const id of ['repo-sync-game-path', 'repo-sync-mods-path']) {
        document.getElementById(id)?.addEventListener('input', queueSync);
        document.getElementById(id)?.addEventListener('change', queueSync);
    }
    document.addEventListener('langChanged', paintSync);
    paintSync();
}
