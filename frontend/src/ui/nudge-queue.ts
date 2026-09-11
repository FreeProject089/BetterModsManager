// nudge-queue.ts — the start-up dialogs take turns, and say how many are waiting.
//
// BMM has several things it may want to say when it opens — the BetterCommunity screen, the
// Ko-fi card, and whatever comes next — and until now each decided on its own whether to
// show, on its own timer. The result was either two overlays at once (one behind the other,
// with no way to tell which) or a rule that let only ONE fire per launch, so the second was
// simply never seen. Both read as "the app surprised me".
//
// A queue fixes both at once. Every candidate says whether it WANTS to show; the ones that
// do are shown in order, one at a time, each waiting for the screen to be clear before it
// opens. And while one is up, a small pill in the corner says how many more are behind it —
// so closing a dialog and seeing another is expected rather than an ambush.
//
// The queue knows nothing about the dialogs' internals: `show()` opens one, and "closed" is
// observed the same way for all of them (dialog-traffic.ts: nothing on screen). A dialog
// that wants to join needs a `wants` and a `show`, nothing else.
import { t } from '../core/i18n.js';
import { isDialogOnScreen, whenDialogsClear } from './dialog-traffic.js';

export interface Nudge {
    id: string;
    /** Should this show on this launch? Opt-outs, snoozes, first-run rules all live here. */
    wants: () => boolean;
    /** Open it. The queue waits for the screen to be clear again before moving on. */
    show: () => void | Promise<void>;
}

const PILL_ID = 'nudge-queue-pill';

function pill(remaining: number): void {
    let el = document.getElementById(PILL_ID);
    if (remaining <= 0) { el?.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = PILL_ID;
        el.className = 'nudge-pill';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        (document.getElementById('app-window-outer') || document.body).appendChild(el);
    }
    el.textContent = remaining === 1
        ? (t('nudge.waiting.one') || '1 more message waiting')
        : (t('nudge.waiting.many') || '{n} more messages waiting').replace('{n}', String(remaining));
}

/** Resolve once the dialog `show()` opened has closed again. */
async function untilClosed(): Promise<void> {
    // Give the dialog a moment to actually be in the DOM: the Ko-fi card adds its class on
    // the next frame, and asking "is anything up?" before that would answer no and the queue
    // would race straight on to the next one — which is the stacking this exists to stop.
    await new Promise((r) => setTimeout(r, 250));
    if (!isDialogOnScreen()) return;
    await whenDialogsClear(10 * 60_000);
}

/**
 * Show every nudge that wants to, one after another.
 *
 * Returns how many were shown. Never throws: a dialog that fails to open is skipped, and the
 * pill is removed whatever happens, because a "1 more waiting" that outlives its queue is a
 * lie sitting in the corner of the screen.
 */
export async function runNudges(candidates: Nudge[]): Promise<number> {
    const queue = candidates.filter((n) => { try { return n.wants(); } catch { return false; } });
    let shown = 0;
    try {
        for (let i = 0; i < queue.length; i++) {
            // Whatever is already on screen — onboarding, an update, a crash report — goes
            // first. This is what "never two at once" means in practice.
            if (isDialogOnScreen()) await whenDialogsClear(10 * 60_000);
            // A beat between dialogs, so the next one reads as the next one and not as the
            // last one refusing to close.
            await new Promise((r) => setTimeout(r, i === 0 ? 900 : 450));
            pill(queue.length - i - 1);
            try { await queue[i].show(); shown++; } catch (e) { console.warn('[BMM] nudge failed to open:', queue[i].id, e); continue; }
            await untilClosed();
        }
    } finally {
        pill(0);
    }
    return shown;
}
