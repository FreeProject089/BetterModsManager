// The getting-started checklist, made true.
//
// The block in index.html used to be a painting: "1 / 4", a 25% bar and one green tick,
// all hardcoded — whatever the user had actually done. A progress meter that does not
// measure teaches people to ignore progress meters. This module computes the real state
// and makes every step a door to where that step happens.
//
// State is re-read on the cheap signals we have (boot, nav clicks, window focus) rather
// than by polling: the checklist lives on the library's empty state, so by definition it
// is mostly looked at early, when those signals fire constantly.

import { invoke } from '../core/api.js';

const CHECK = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

type StepId = 'lang' | 'profile' | 'mod' | 'bc';

async function stepStates(): Promise<Record<StepId, boolean>> {
    // Language: true by construction. The first-run picker blocks the app until a
    // language is chosen, so anyone SEEING this checklist has done it — which is also
    // why the old painting's one hardcoded tick happened to be right. Written as the
    // constant it is, not as a localStorage probe ||'d into one (this session already
    // buried two checks behind expressions that could not be false).
    const lang = true;

    let profile = false, mod = false;
    try {
        const profiles = (await invoke('get_profiles')) as any[] | null;
        profile = Array.isArray(profiles) && profiles.length > 0;
        // "Enable your first mod" means an ACTIVE mod, not an imported one — the step is
        // about reaching the payoff, and an inactive import changes nothing in the game.
        mod = Array.isArray(profiles) && profiles.some((p) => (p?.mods ?? []).some((m: any) => m?.active || m?.enabled));
    } catch { /* backend not ready — show what we know */ }

    // Same cache the repo screen trusts offline.
    const bc = (() => { try { return localStorage.getItem('bc_linked') === '1'; } catch { return false; } })();
    return { lang, profile, mod, bc };
}

/** Where each step is DONE. The checklist is a set of doors, not a set of labels. */
function go(step: StepId): void {
    const nav = (view: string) => (document.querySelector(`.nav-item[data-view="${view}"]`) as HTMLElement | null)?.click();
    switch (step) {
        case 'lang':    nav('settings'); break;
        case 'profile': nav('profiles'); setTimeout(() => document.getElementById('btn-new-profile')?.click(), 250); break;
        case 'mod':     nav('library'); break;
        case 'bc':      nav('community'); break;
    }
}

export async function refreshSetupChecklist(): Promise<void> {
    const box = document.getElementById('gs-checklist');
    if (!box) return;
    const st = await stepStates();
    const order: StepId[] = ['lang', 'profile', 'mod', 'bc'];
    const done = order.filter((k) => st[k]).length;

    const count = document.getElementById('gs-count');
    if (count) count.textContent = `${done} / ${order.length}`;
    const bar = document.getElementById('gs-bar');
    if (bar) bar.style.width = `${Math.round((done / order.length) * 100)}%`;

    box.querySelectorAll<HTMLElement>('.gs-step').forEach((el) => {
        const k = el.dataset.gs as StepId;
        const on = !!st[k];
        el.classList.toggle('done', on);
        const dot = el.querySelector('.gs-dot');
        if (dot) dot.innerHTML = on ? CHECK : '';
    });
}

let _wired = false;
export function initSetupChecklist(): void {
    const box = document.getElementById('gs-checklist');
    if (!box || _wired) { void refreshSetupChecklist(); return; }
    _wired = true;

    box.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.gs-step') as HTMLElement | null;
        if (btn?.dataset.gs) go(btn.dataset.gs as StepId);
    });

    // Cheap refresh signals, no polling. Nav clicks cover "I just did the thing and came
    // back"; focus covers "I linked BetterCommunity in the browser and alt-tabbed home".
    document.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest?.('.nav-item')) setTimeout(() => void refreshSetupChecklist(), 300);
    });
    window.addEventListener('focus', () => void refreshSetupChecklist());
    void refreshSetupChecklist();
}
