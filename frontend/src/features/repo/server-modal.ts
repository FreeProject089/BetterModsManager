// The server panel: monitoring, whitelist and bans, in one modal.
//
// They were three overlays, each with its own header telling you which of the three you had
// opened. They are three views of ONE thing — who is connected, who may connect, who may not
// — and every real task crosses them: you watch the table, you see an address you do not like,
// you ban it, you check it is gone. That was three open/close cycles and no way to see the
// other two while doing it.
//
// This owns the shell only. The panels keep the ids the old markup used, so repo-monitoring
// and repo-admin populate exactly what they populated before — a rewrite of the frame, not of
// what fills it, which is also why a break here is easy to tell from a break there.

const MODAL_ID = 'modal-server';
export type ServerTab = 'monitoring' | 'whitelist' | 'bans';

/** Fired when the visible tab changes, and when the modal closes (`tab: null`).
 *
 *  An event rather than a direct call: monitoring polls the server every second and has to
 *  stop when you are not looking at it, but this module has no business importing the
 *  monitoring feature to say so — and the feature has no business knowing a tab rail exists.
 */
export const SERVER_TAB_EVENT = 'bmm:server-tab';

const modal = () => document.getElementById(MODAL_ID);

function emit(tab: ServerTab | null): void {
    document.dispatchEvent(new CustomEvent(SERVER_TAB_EVENT, { detail: { tab } }));
}

/** Show one tab. Safe to call for a tab that is already shown. */
export function showServerTab(tab: ServerTab): void {
    const root = modal();
    if (!root) return;
    let changed = false;
    root.querySelectorAll<HTMLElement>('[data-srv-tab]').forEach((btn) => {
        const is = btn.dataset.srvTab === tab;
        if (is && btn.getAttribute('aria-selected') !== 'true') changed = true;
        btn.setAttribute('aria-selected', is ? 'true' : 'false');
        const panel = document.getElementById(`srv-panel-${btn.dataset.srvTab}`);
        if (panel) panel.hidden = !is;
    });
    if (changed) emit(tab);
}

/** Open the modal on a given tab. */
export function openServerModal(tab: ServerTab = 'monitoring'): void {
    const root = modal();
    if (!root) return;
    root.classList.add('open');
    // Emitted unconditionally on open, even when the tab did not change: reopening on the
    // same tab still has to restart what closing stopped.
    showServerTab(tab);
    emit(tab);
}

export function closeServerModal(): void {
    const root = modal();
    if (!root) return;
    root.classList.remove('open');
    emit(null);
}

/** Which tab is showing, or null when the modal is closed. */
export function currentServerTab(): ServerTab | null {
    const root = modal();
    if (!root || !root.classList.contains('open')) return null;
    const on = root.querySelector<HTMLElement>('[data-srv-tab][aria-selected="true"]');
    return (on?.dataset.srvTab as ServerTab) || null;
}

export function initServerModal(): void {
    const root = modal();
    if (!root) return;

    root.querySelectorAll<HTMLElement>('[data-srv-tab]').forEach((btn) => {
        btn.addEventListener('click', () => showServerTab(btn.dataset.srvTab as ServerTab));
    });

    root.querySelectorAll('[data-close="modal-server"]').forEach((btn) => {
        btn.addEventListener('click', closeServerModal);
    });
    // Click on the scrim, not inside the dialog.
    root.addEventListener('click', (e) => { if (e.target === root) closeServerModal(); });

    // Escape closes it, which the three old overlays never did.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && root.classList.contains('open')) closeServerModal();
    });

    // Left/right move between tabs when the rail has focus — the standard tablist behaviour,
    // and the reason the buttons carry role="tab".
    root.querySelector('.srv-tabs')?.addEventListener('keydown', (e) => {
        const ev = e as KeyboardEvent;
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        const tabs = [...root.querySelectorAll<HTMLElement>('[data-srv-tab]')];
        const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
        if (i < 0) return;
        ev.preventDefault();
        const next = tabs[(i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        showServerTab(next.dataset.srvTab as ServerTab);
        next.focus();
    });
}
