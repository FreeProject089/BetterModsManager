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
}
