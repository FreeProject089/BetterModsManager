// launch-deck.ts — everything BMM has to say at start-up, in ONE dialog with Previous / Next.
//
// It used to be a relay of separate dialogs: a language picker, the terms, the privacy policy,
// a crash notice, the release notes, the file-access choice, the telemetry question, then a
// queue of cards (BetterCommunity, Ko-fi). Each one closed only for the next to open, and a
// returning user could close four dialogs before reaching the app. Field feedback, verbatim:
// « ça te spamme de modals chiants ».
//
// Now each of those is a STEP. A provider registers it (`registerLaunchStep`), says whether it
// belongs to this launch (`when`) and draws it into a container it is handed (`render`). After
// boot the coordinator asks every provider at once, sorts the answers and opens the deck ONCE —
// or not at all, when nobody has anything to say.
//
// Two kinds of step:
//   · informational — the reader may go past it, close the deck on it, or mute it ("Don't show
//     again", when the step offers one);
//   · required — a choice the old dialog would not let you dismiss (the terms, the file-access
//     mode, the telemetry answer). The deck waits on it: Next stays off until the choice is
//     made, the steps after it cannot be reached, and Close brings you back to it rather than
//     closing. What gets SAVED is whatever the old dialog saved; the step only moves where it
//     is asked.
//
// The ordering, gating and eligibility rules live in launch-logic.ts, pure and unit-tested.
// This file is the DOM: focus trap, keyboard (← → Esc Enter), the step indicator, themes.

import { t } from '../core/i18n.js';
import { raiseAboveAll } from './layer.js';
import {
    collectEligible, orderSteps, maxReachable, closeTarget,
    type LaunchContext, type StepLike,
} from './launch-logic.js';

export type { LaunchContext } from './launch-logic.js';

/** What a step can do to the deck it lives in. */
export interface LaunchStepApi {
    readonly ctx: LaunchContext;
    /** A required step's choice has been made: Next unlocks and the close is no longer held. */
    complete(): void;
    /** Move to the next step (or close, from the last one). */
    next(): void;
    /**
     * Close the deck, then run `fn` — for an action that opens another screen (the full release
     * notes, the feedback form for a crash). If a required step still waits, the deck goes back
     * to it instead and `fn` runs as soon as the deck does close.
     */
    closeThen(fn?: () => void): void;
}

export interface LaunchStep extends StepLike {
    /** Heading while the step is shown. A function, so a language switch re-reads it. */
    title(): string;
    /** A small word above the heading ("Required", "News"…). Optional. */
    kicker?(): string;
    /** Draw the step. Called ONCE, the first time the step is shown; the pane is kept after. */
    render(el: HTMLElement, api: LaunchStepApi): void | Promise<void>;
    /**
     * Run when the reader presses Next on this step. For a required step, a `commit` IS the
     * choice (the language step: Next = "use this language"), so Next stays enabled and
     * pressing it completes the step. Throwing keeps the reader on the step.
     */
    commit?(): void | Promise<void>;
    /** Label for the primary button while on this step, when "Next" would be the wrong word. */
    primaryLabel?(): string;
    /** "Don't show again" for an informational step: the step says where it is remembered. */
    mute?: { get(): boolean; set(on: boolean): void; label?(): string };
    /** The first time the step is actually shown (counters, "seen" flags). */
    onShown?(): void;
    /** The deck closed (restore anything borrowed, drop listeners). */
    onClosed?(): void;
}

// ── settings ────────────────────────────────────────────────────────────────────

/** '0' = the deck is off: only the required steps still open (they cannot be skipped). */
export const DECK_ENABLED_KEY = 'bmm_launch_deck_enabled';

export function deckEnabled(): boolean {
    try { return localStorage.getItem(DECK_ENABLED_KEY) !== '0'; } catch { return true; }
}
export function setDeckEnabled(on: boolean): void {
    try { localStorage.setItem(DECK_ENABLED_KEY, on ? '1' : '0'); } catch { /* private mode: stays on */ }
}

// ── registry ────────────────────────────────────────────────────────────────────

const _registry: LaunchStep[] = [];

/** Add (or replace, by id) a step provider. Order among equal priorities = registration order. */
export function registerLaunchStep(step: LaunchStep): void {
    const at = _registry.findIndex((s) => s.id === step.id);
    if (at >= 0) _registry[at] = step; else _registry.push(step);
}

export function registeredLaunchSteps(): readonly LaunchStep[] { return _registry; }

// ── the open deck ───────────────────────────────────────────────────────────────

interface Deck {
    add(step: LaunchStep): void;
    readonly ctx: LaunchContext;
    has(id: string): boolean;
}

let _deck: Deck | null = null;

export function isLaunchDeckOpen(): boolean { return _deck !== null; }

/**
 * A step that became known while the deck is already open — an announcement that arrived after
 * the deck was drawn. Asked the same `when` question; inserted after the current step so what
 * the reader is looking at never moves. Returns false when there is no deck to add it to.
 */
export async function addLaunchStepLive(step: LaunchStep): Promise<boolean> {
    const deck = _deck;
    if (!deck || deck.has(step.id)) return false;
    const ok = await collectEligible([step], deck.ctx, { deckEnabled: true, timeoutMs: 2000 });
    if (!ok.length || _deck !== deck || deck.has(step.id)) return false;
    deck.add(step);
    return true;
}

/**
 * Collect every eligible step and open the deck once.
 *
 * Resolves when the deck closes — immediately (with false) when no step is eligible, in which
 * case nothing opened at all. Never rejects: a deck that fails to draw must not take the rest
 * of the start-up with it.
 */
export async function openLaunchDeck(ctx: LaunchContext, extra: readonly LaunchStep[] = []): Promise<boolean> {
    if (_deck) return false;
    let steps: LaunchStep[];
    try {
        steps = await collectEligible([..._registry, ...extra], ctx, {
            // A deck the reader asked for opens whatever the setting says.
            deckEnabled: ctx.manual || deckEnabled(),
        });
    } catch (e) {
        console.warn('[BMM] launch deck: collecting steps failed', e);
        return false;
    }
    if (!steps.length || _deck) return false;
    await cssReady;
    if (_deck) return false;
    return new Promise<boolean>((resolve) => {
        try { mount(steps, ctx, () => resolve(true)); }
        catch (e) { console.error('[BMM] launch deck failed to open', e); _deck = null; resolve(false); }
    });
}

/**
 * The deck's stylesheet, added once. Resolves when it has loaded (or failed, or after a second):
 * the deck waits for it so it never paints for a frame as an unstyled block.
 */
const cssReady: Promise<void> = ensureCss();

function ensureCss(): Promise<void> {
    if (typeof document === 'undefined') return Promise.resolve();
    if (document.getElementById('launch-deck-css')) return Promise.resolve();
    const link = document.createElement('link');
    link.id = 'launch-deck-css';
    link.rel = 'stylesheet';
    link.href = 'css/launch-deck.css';
    const loaded = new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
        setTimeout(resolve, 1000);
    });
    document.head.appendChild(link);
    return loaded;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const X_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function mount(initial: LaunchStep[], ctx: LaunchContext, onClosed: () => void): void {
    const steps: LaunchStep[] = initial.slice();
    const done = new Set<string>();
    const panes = new Map<string, HTMLElement>();
    const shown = new Set<string>();
    const after: Array<() => void> = [];
    let index = 0;
    let closed = false;
    let hint = '';
    const opener = document.activeElement as HTMLElement | null;

    const ov = document.createElement('div');
    ov.id = 'launch-deck';
    ov.className = 'modal-overlay open ld-overlay';
    raiseAboveAll(ov, 11000);
    ov.innerHTML = `
        <div class="modal ld-deck" role="dialog" aria-modal="true" aria-labelledby="ld-title">
            <header class="ld-head">
                <div class="ld-head-txt">
                    <div class="ld-kicker" id="ld-kicker"></div>
                    <h2 class="ld-title" id="ld-title" tabindex="-1"></h2>
                </div>
                <span class="ld-count" id="ld-count" aria-hidden="true"></span>
                <button type="button" class="ld-x" id="ld-x">${X_ICON}</button>
            </header>
            <div class="ld-body" id="ld-body"></div>
            <p class="ld-hint" id="ld-hint" role="status" aria-live="polite"></p>
            <footer class="ld-foot">
                <label class="ld-mute" id="ld-mute-wrap"><input type="checkbox" id="ld-mute"><span id="ld-mute-lbl"></span></label>
                <nav class="ld-dots" id="ld-dots"></nav>
                <div class="ld-nav">
                    <button type="button" class="btn btn-secondary" id="ld-prev"></button>
                    <button type="button" class="btn btn-primary" id="ld-next"></button>
                </div>
            </footer>
            <div class="ld-sr" id="ld-live" aria-live="polite"></div>
        </div>`;

    const $ = <T extends HTMLElement>(id: string): T => ov.querySelector(`#${id}`) as T;
    const body = $<HTMLElement>('ld-body');
    const titleEl = $<HTMLElement>('ld-title');
    const kickerEl = $<HTMLElement>('ld-kicker');
    const countEl = $<HTMLElement>('ld-count');
    const hintEl = $<HTMLElement>('ld-hint');
    const dotsEl = $<HTMLElement>('ld-dots');
    const prevBtn = $<HTMLButtonElement>('ld-prev');
    const nextBtn = $<HTMLButtonElement>('ld-next');
    const xBtn = $<HTMLButtonElement>('ld-x');
    const muteWrap = $<HTMLElement>('ld-mute-wrap');
    const muteBox = $<HTMLInputElement>('ld-mute');
    const muteLbl = $<HTMLElement>('ld-mute-lbl');
    const live = $<HTMLElement>('ld-live');

    const api = (step: LaunchStep): LaunchStepApi => ({
        ctx,
        complete: () => { done.add(step.id); if (hint) hint = ''; update(false); },
        next: () => { if (steps[index]?.id === step.id) goNext(); },
        closeThen: (fn) => { if (fn) after.push(fn); requestClose(); },
    });

    function paneFor(step: LaunchStep): HTMLElement {
        let pane = panes.get(step.id);
        if (pane) return pane;
        pane = document.createElement('div');
        pane.className = 'ld-pane';
        pane.dataset.step = step.id;
        panes.set(step.id, pane);
        body.appendChild(pane);
        try {
            const r = step.render(pane, api(step));
            if (r && typeof (r as Promise<void>).catch === 'function') {
                (r as Promise<void>).catch((e) => { console.warn('[BMM] launch step failed to draw:', step.id, e); renderError(pane!); });
            }
        } catch (e) {
            console.warn('[BMM] launch step failed to draw:', step.id, e);
            renderError(pane);
        }
        return pane;
    }

    function renderError(pane: HTMLElement): void {
        const p = document.createElement('p');
        p.className = 'ld-error';
        p.textContent = t('launch.stepError');
        pane.appendChild(p);
    }

    function go(i: number, focusTitle = true, keepHint = false): void {
        if (closed || !steps.length) return;
        if (!keepHint) hint = '';
        const target = Math.max(0, Math.min(i, maxReachable(steps, done)));
        index = target;
        update(focusTitle);
    }

    async function goNext(): Promise<void> {
        const step = steps[index];
        if (!step) return;
        if (step.required && !done.has(step.id) && !step.commit) {
            hint = t('launch.requiredHint');
            update(false);
            return;
        }
        if (step.commit) {
            nextBtn.disabled = true;
            try { await step.commit(); }
            catch (e) { console.warn('[BMM] launch step commit failed:', step.id, e); nextBtn.disabled = false; return; }
            done.add(step.id);
        }
        hint = '';
        if (index >= steps.length - 1) requestClose();
        else go(index + 1);
    }

    function requestClose(): void {
        const wall = closeTarget(steps, done);
        if (wall >= 0) {
            hint = t('launch.requiredHint');
            go(wall, true, true);
            return;
        }
        close();
    }

    function close(): void {
        if (closed) return;
        closed = true;
        _deck = null;
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('langChanged', onLang);
        ov.remove();
        for (const s of steps) { try { s.onClosed?.(); } catch { /* one step's cleanup must not stop the others */ } }
        try { if (opener && opener.isConnected) opener.focus(); } catch { /* nothing to return to */ }
        onClosed();
        for (const fn of after.splice(0)) { try { fn(); } catch (e) { console.warn('[BMM] launch deck: follow-up failed', e); } }
    }

    function update(focusTitle: boolean): void {
        const step = steps[index];
        if (!step) return;
        const pane = paneFor(step);
        for (const [id, el] of panes) el.hidden = id !== step.id;
        if (!shown.has(step.id)) {
            shown.add(step.id);
            try { step.onShown?.(); } catch (e) { console.warn('[BMM] launch step onShown failed:', step.id, e); }
        }
        const n = steps.length;
        const title = step.title();
        titleEl.textContent = title;
        const kicker = step.kicker?.() || (step.required && !done.has(step.id) ? t('launch.required') : '');
        kickerEl.textContent = kicker;
        kickerEl.hidden = !kicker;
        countEl.textContent = `${index + 1} / ${n}`;
        countEl.hidden = n < 2;
        pane.setAttribute('aria-label', title);

        // Footer: mute, dots, previous / next.
        if (step.mute) {
            muteWrap.hidden = false;
            muteBox.checked = safe(() => step.mute!.get(), false);
            muteLbl.textContent = step.mute.label?.() || t('launch.mute');
        } else {
            muteWrap.hidden = true;
        }
        const reach = maxReachable(steps, done);
        dotsEl.hidden = n < 2;
        dotsEl.setAttribute('aria-label', t('launch.steps'));
        dotsEl.replaceChildren(...steps.map((s, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ld-dot' + (i === index ? ' is-current' : '') + (s.required && !done.has(s.id) ? ' is-required' : '');
            b.setAttribute('aria-label', t('launch.dotLabel', { n: String(i + 1), total: String(n), title: s.title() }));
            b.title = s.title();
            if (i === index) b.setAttribute('aria-current', 'step');
            if (i > reach) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
            b.addEventListener('click', () => go(i));
            return b;
        }));
        prevBtn.textContent = t('launch.prev');
        prevBtn.disabled = index === 0;
        prevBtn.hidden = n < 2;
        const last = index >= n - 1;
        nextBtn.textContent = step.primaryLabel?.() || (last ? t('launch.finish') : t('launch.next'));
        nextBtn.disabled = !!step.required && !done.has(step.id) && !step.commit;
        xBtn.setAttribute('aria-label', t('common.close'));
        xBtn.title = t('common.close');
        hintEl.textContent = hint;
        hintEl.hidden = !hint;
        live.textContent = t('launch.dotLabel', { n: String(index + 1), total: String(n), title });
        if (focusTitle) titleEl.focus({ preventScroll: true });
    }

    function onLang(): void { if (!closed) update(false); }

    function focusables(): HTMLElement[] {
        return Array.from(ov.querySelectorAll<HTMLElement>(FOCUSABLE))
            .filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
    }

    function typing(el: EventTarget | null): boolean {
        const n = el as HTMLElement | null;
        if (!n || !n.tagName) return false;
        if (n.isContentEditable) return true;
        const tag = n.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (tag === 'INPUT') {
            const type = (n as HTMLInputElement).type;
            // A radio group owns its own arrow keys; a checkbox does not.
            return type !== 'checkbox' && type !== 'button' && type !== 'submit';
        }
        return false;
    }

    function onKey(e: KeyboardEvent): void {
        if (closed) return;
        // Something opened ON TOP of the deck (the reader asked for it from a step) owns the
        // keyboard until it closes.
        const target = e.target as Node | null;
        if (target && target !== document.body && !ov.contains(target)) return;
        const key = typeof e.key === 'string' ? e.key : '';
        if (key === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            requestClose();
            return;
        }
        if (key === 'Tab') {
            const list = focusables();
            if (!list.length) { e.preventDefault(); titleEl.focus(); return; }
            const first = list[0], lastEl = list[list.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (e.shiftKey && (active === first || !ov.contains(active))) { e.preventDefault(); lastEl.focus(); }
            else if (!e.shiftKey && (active === lastEl || !ov.contains(active))) { e.preventDefault(); first.focus(); }
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
        if (key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (index < steps.length - 1) go(index + 1); return; }
        if (key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (index > 0) go(index - 1); return; }
        if (key === 'Enter') {
            // Enter on a control does what that control does; Enter anywhere else is the
            // primary button.
            const el = e.target as HTMLElement | null;
            if (el && el.closest('button, a, summary, label, [role="button"]')) return;
            e.preventDefault(); e.stopPropagation();
            if (!nextBtn.disabled) void goNext();
        }
    }

    prevBtn.addEventListener('click', () => { if (index > 0) go(index - 1); });
    nextBtn.addEventListener('click', () => { void goNext(); });
    xBtn.addEventListener('click', requestClose);
    muteBox.addEventListener('change', () => {
        const step = steps[index];
        try { step?.mute?.set(muteBox.checked); } catch (e) { console.warn('[BMM] launch step mute failed', e); }
    });
    // The backdrop does not close the deck: a click that misses the card is not a decision.

    _deck = {
        ctx,
        has: (id) => steps.some((s) => s.id === id),
        add: (step) => {
            if (closed || steps.some((s) => s.id === step.id)) return;
            // Placed among the steps not yet reached, by priority — never before the one on screen.
            const tail = orderSteps([...steps.slice(index + 1), step]);
            steps.splice(index + 1, steps.length - index - 1, ...tail);
            update(false);
        },
    };

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('langChanged', onLang);
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    update(true);
}

function safe<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }
