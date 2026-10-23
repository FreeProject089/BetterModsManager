/**
 * activation-indicator.ts — the app-wide activity pill for mods being turned on or off.
 *
 * Sits in the title bar, so it is on screen whatever view is open: the mod in flight, where it
 * is in its job (3/12), the bytes copied, the jobs waiting, and the one Cancel that stops it.
 * It shows the jobs of core/activation-jobs.ts AND the batches other screens run on the
 * backend (Enable all, an order list): those arrive as the same `bmm://mod-op-progress`
 * events. Hidden when nothing runs. Built once; an update rewrites a few text nodes and one
 * custom property, never the markup.
 */
import { t } from '../core/i18n.js';
import { formatBytes } from '../core/utils.js';
import {
    initActivationJobs, onActivationChange, getActivationJobs, currentActivation, externalActivity,
    cancelActivationJob, cancelAllActivationJobs, cancelExternal,
} from '../core/activation-jobs.js';

let root: HTMLElement | null = null;
let parts: {
    verb: HTMLElement; name: HTMLElement; count: HTMLElement; bytes: HTMLElement; queued: HTMLElement;
    fill: HTMLElement; cancel: HTMLButtonElement; cancelAll: HTMLButtonElement;
} | null = null;
let shownJobId: number | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let inited = false;

function span(cls: string): HTMLElement {
    const s = document.createElement('span');
    s.className = cls;
    return s;
}

function mount(): HTMLElement {
    if (root && root.isConnected) return root;
    const el = document.createElement('div');
    el.className = 'actjob-pill';
    el.id = 'actjob-pill';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;

    const spin = span('actjob-spin');
    spin.setAttribute('aria-hidden', 'true');
    const text = span('actjob-text');
    const verb = span('actjob-verb');
    const name = span('actjob-name');
    text.append(verb, name);
    const count = span('actjob-count');
    const bytes = span('actjob-bytes');
    const queued = span('actjob-queued');
    const bar = span('actjob-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = span('actjob-fill');
    bar.append(fill);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'actjob-cancel';
    cancel.addEventListener('click', () => { void onCancel(false); });
    const cancelAll = document.createElement('button');
    cancelAll.type = 'button';
    cancelAll.className = 'actjob-cancel actjob-cancel-all';
    cancelAll.hidden = true;
    cancelAll.addEventListener('click', () => { void onCancel(true); });

    el.append(spin, text, count, bytes, bar, queued, cancel, cancelAll);
    const host = document.querySelector('.titlebar-left') || document.querySelector('.titlebar') || document.body;
    host.appendChild(el);
    root = el;
    parts = { verb, name, count, bytes, queued, fill, cancel, cancelAll };
    return el;
}

async function onCancel(all: boolean): Promise<void> {
    if (!parts) return;
    parts.cancel.disabled = true;
    parts.cancelAll.disabled = true;
    parts.cancel.textContent = t('actjob.cancelling');
    const cur = currentActivation();
    try {
        if (all) {
            await cancelAllActivationJobs();
        } else if (cur) {
            await cancelActivationJob(cur.job.id);
        }
        // A batch another screen runs on the backend (Enable all, an order list) is not one of
        // our jobs: it is stopped the way that screen's own Cancel stops it.
        if (all || !cur) await cancelExternal();
    } catch { /* the pill redraws from the state either way */ }
    if (parts) { parts.cancel.disabled = false; parts.cancelAll.disabled = false; }
    render();
}

function setText(el: HTMLElement, s: string): void {
    if (el.textContent !== s) el.textContent = s;
}

function render(): void {
    const cur = currentActivation();
    const ext = externalActivity();
    const jobs = getActivationJobs();
    const waitingJobs = jobs.filter((j) => j.state === 'queued').length;

    if (!cur && !ext.length && !waitingJobs) {
        if (root && !root.hidden && !hideTimer) {
            root.classList.add('is-leaving');
            hideTimer = setTimeout(() => {
                hideTimer = null;
                if (root && !currentActivation() && !externalActivity().length) { root.hidden = true; root.classList.remove('is-leaving'); }
            }, 260);
        }
        shownJobId = null;
        return;
    }
    const el = mount();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    el.classList.remove('is-leaving');
    el.hidden = false;
    const p = parts!;

    let op: 'enable' | 'disable' = 'enable';
    let name = '';
    let done = 0, total = 0;
    let countText = '';
    let queuedMods = 0;
    if (cur) {
        op = cur.job.mode;
        name = cur.item.name;
        done = cur.item.bytesDone;
        total = cur.item.bytesTotal;
        const idx = cur.job.items.indexOf(cur.item) + 1;
        if (cur.job.items.length > 1) countText = t('actjob.count', { n: String(idx), m: String(cur.job.items.length) });
        if (shownJobId !== cur.job.id) { shownJobId = cur.job.id; el.dataset.job = String(cur.job.id); }
        queuedMods = cur.job.items.filter((i) => i.phase === 'queued').length;
    } else if (ext.length) {
        const a = ext[ext.length - 1];
        op = a.op;
        done = a.bytesDone;
        total = a.bytesTotal;
        name = a.name || '';
    }
    for (const j of jobs) if (j.state === 'queued' && (!cur || j.id !== cur.job.id)) queuedMods += j.items.length;

    el.classList.toggle('is-disable', op === 'disable');
    setText(p.verb, t(op === 'enable' ? 'actjob.enabling' : 'actjob.disabling'));
    setText(p.name, name);
    p.name.title = name;
    setText(p.count, countText);
    p.count.hidden = !countText;
    const showBytes = total > 0;
    setText(p.bytes, showBytes ? `${formatBytes(Math.min(done, total))} / ${formatBytes(total)}` : '');
    p.bytes.hidden = !showBytes;
    const pct = total > 0 ? Math.min(1, done / total) : 0;
    p.fill.style.setProperty('--actjob-p', String(pct));
    el.classList.toggle('is-indeterminate', total <= 0);
    setText(p.queued, queuedMods > 0 ? t('actjob.queued', { n: String(queuedMods) }) : '');
    p.queued.hidden = queuedMods <= 0;
    if (!p.cancel.disabled) setText(p.cancel, t('actjob.cancel'));
    p.cancel.title = t('actjob.cancelTip');
    const others = jobs.filter((j) => j.state === 'queued' || j.state === 'running').length;
    p.cancelAll.hidden = others < 2;
    setText(p.cancelAll, t('actjob.cancelAll'));
    el.setAttribute('aria-label', t('actjob.ariaLabel'));
}

/** Mount the pill's listener (the pill itself is built on the first activity). Idempotent. */
export function initActivationIndicator(): void {
    if (inited) return;
    inited = true;
    initActivationJobs();
    onActivationChange(render);
    document.addEventListener('langChanged', () => { if (root && !root.hidden) render(); });
}
