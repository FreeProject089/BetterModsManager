/**
 * mods-job-anim.ts — the Library cards follow their mod's activation: queued → copying (with
 * the bytes) → done / failed, then settle into their new state with the order number popping
 * in. Deactivation is the same walk the other way.
 *
 * Driven by core/activation-jobs.ts (which hears every `bmm://mod-op-progress`, whoever
 * started the work) and applied card by card: a progress event touches the one card it is
 * about, never the list. The list is virtualised, so a card scrolled into view mid-copy is
 * dressed by `applyCardActivity` from renderModList.
 *
 * Motion is CSS only (css/activation-jobs.css) and stands down under prefers-reduced-motion
 * and BMM's own « Reduce animations » (body.bmm-no-anim): the states still show, they just do
 * not move.
 */
import { appState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { initActivationJobs, onActivationChange, modActivity } from '../../core/activation-jobs.js';
import type { ModActivity } from '../../core/activation-jobs.js';

/** mods-list.ts's card redraw, handed in by initMods (importing it here closed a cycle). */
let updateCardState: (card: HTMLElement, mod: any) => void = () => {};

const PHASE_CLASSES = ['job-queued', 'job-running', 'job-done', 'job-failed', 'job-cancelled', 'job-op-disable', 'job-indeterminate'];
let wired = false;

function signature(a: ModActivity | null): string {
    if (!a) return '';
    return `${a.op}|${a.phase}|${a.pct == null ? '' : Math.round(a.pct * 100)}`;
}

function stateLabel(a: ModActivity): string {
    const pct = a.pct == null ? '' : String(Math.round(a.pct * 100));
    switch (a.phase) {
        case 'queued': return t('actjob.stateQueued');
        case 'running':
            if (!pct) return t(a.op === 'enable' ? 'actjob.stateEnabling' : 'actjob.stateDisabling');
            return t(a.op === 'enable' ? 'actjob.stateCopying' : 'actjob.stateRemoving', { pct });
        case 'done': return t(a.op === 'enable' ? 'actjob.stateOn' : 'actjob.stateOff');
        case 'failed': return t('actjob.stateFailed');
        default: return t('actjob.stateCancelled');
    }
}

function ensureParts(card: HTMLElement): { label: HTMLElement; bar: HTMLElement } {
    let label = card.querySelector(':scope > .mod-job-state') as HTMLElement | null;
    let bar = card.querySelector(':scope > .mod-job-bar') as HTMLElement | null;
    if (!label) {
        label = document.createElement('span');
        label.className = 'mod-job-state';
        label.setAttribute('aria-live', 'polite');
        card.appendChild(label);
    }
    if (!bar) {
        bar = document.createElement('span');
        bar.className = 'mod-job-bar';
        bar.setAttribute('aria-hidden', 'true');
        bar.appendChild(document.createElement('span'));
        card.appendChild(bar);
    }
    return { label, bar };
}

/** Dress one card for what its mod is doing now (or undress it). Cheap when nothing changed. */
export function applyCardActivity(card: HTMLElement, modId: string): void {
    const a = modActivity(modId);
    const sig = signature(a);
    if ((card.dataset.jobSig || '') === sig) return;
    const before = card.dataset.jobPhase || '';
    card.dataset.jobSig = sig;
    card.classList.remove(...PHASE_CLASSES);
    if (!a) {
        card.querySelector(':scope > .mod-job-state')?.remove();
        card.querySelector(':scope > .mod-job-bar')?.remove();
        delete card.dataset.jobPhase;
        card.style.removeProperty('--job-p');
        return;
    }
    card.classList.add(`job-${a.phase}`);
    if (a.op === 'disable') card.classList.add('job-op-disable');
    if (a.phase === 'running' && a.pct == null) card.classList.add('job-indeterminate');
    card.style.setProperty('--job-p', String(a.phase === 'done' ? 1 : a.pct ?? 0));
    const { label } = ensureParts(card);
    const text = stateLabel(a);
    if (label.textContent !== text) label.textContent = text;
    card.dataset.jobPhase = a.phase;
    if (a.phase === 'done' && before !== 'done') settle(card, modId, a.op);
}

/**
 * The mod just finished: put the card in its new state now (toggle, dot, pill, order badge)
 * instead of waiting for the next full refresh. The model is corrected the same way, so a
 * re-render before that refresh draws the same thing.
 */
function settle(card: HTMLElement, modId: string, op: 'enable' | 'disable'): void {
    const S = appState.state as any;
    const mods: any[] = S.allMods || [];
    const mod = mods.find((m) => m.id === modId);
    if (!mod) return;
    const on = op === 'enable';
    if (!!mod.enabled !== on || (on && !mod.activation_order)) {
        if (on) {
            const top = mods.reduce((mx, m) => (m.enabled && m.id !== modId ? Math.max(mx, m.activation_order || 0) : mx), 0);
            mod.activation_order = top + 1;
        } else if (mod.activation_order) {
            const old = mod.activation_order;
            for (const m of mods) if (m.enabled && m.id !== modId && m.activation_order > old) m.activation_order -= 1;
            mod.activation_order = 0;
            renumberVisible(modId);
        }
        mod.enabled = on;
    }
    // A card toggle in flight owns its card until its own finally (it may still revert it).
    if (S.processingMods && S.processingMods.has(modId)) return;
    if (card.isConnected) updateCardState(card, mod);
}

/** After a disable, the order numbers below it moved up by one: redraw those badges only. */
function renumberVisible(except: string): void {
    const mods: any[] = (appState.state as any).allMods || [];
    const byId = new Map(mods.map((m) => [m.id, m]));
    document.querySelectorAll<HTMLElement>('#mod-list-viewport > .mod-card.enabled').forEach((c) => {
        const id = c.dataset.id || '';
        if (id === except) return;
        const b = c.querySelector('.badge-accent');
        const m = byId.get(id);
        if (b && m && m.activation_order) {
            const s = `#${m.activation_order}`;
            if (b.textContent !== s) b.textContent = s;
        }
    });
}

function refreshVisible(): void {
    document.querySelectorAll<HTMLElement>('#mod-list-viewport > .mod-card').forEach((c) => {
        const id = c.dataset.id;
        if (id) applyCardActivity(c, id);
    });
}

/** Wire the cards to the activity feed. Idempotent; called from initMods. */
export function initCardActivityAnimation(redrawCard: (card: HTMLElement, mod: any) => void): void {
    updateCardState = redrawCard;
    if (wired) return;
    wired = true;
    initActivationJobs();
    onActivationChange(refreshVisible);
    document.addEventListener('langChanged', () => {
        document.querySelectorAll<HTMLElement>('#mod-list-viewport > .mod-card[data-job-sig]').forEach((c) => { c.dataset.jobSig = '~'; });
        refreshVisible();
    });
}
