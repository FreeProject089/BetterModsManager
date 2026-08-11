// @ts-nocheck
/**
 * tutorial-engine.ts — Step-by-step tutorial runner for BMM.
 *
 * Bottom DOCK: full-width bar the app reserves space for, so the lesson never covers
 * the control it is pointing at. Minimises to a slim strip.
 * - Correct navigation via .nav-item[data-view] selectors
 * - Modal/followup element detection via polling
 * - Multiple element highlights (class-based, removed on action complete/skip)
 * - Clickable nav hint
 * - Live language switching via langChanged event
 */

import { t } from '../core/i18n.js';
import { invoke } from '../core/api.js';
import { onBmmAction } from './tutorial-events.js';
import {
    savePosition, markStepComplete, markStepPartial, getStepStatus,
} from './tutorial-store.js';
import type { TutorialDef, TutorialPart, TutorialStep } from './tutorial-types.js';

// ── Nav page label / icon map ─────────────────────────────────────────────────

const NAV_LABELS: Record<string, string> = {
    profiles:  'nav.label.profiles',
    library:   'nav.label.library',
    mapper:    'nav.label.mapper',
    modpacks:  'nav.label.modpacks',
    modlists:  'nav.label.modlists',
    repo:      'nav.label.repo',
    apps:      'nav.label.apps',
    plugins:   'nav.label.plugins',
    settings:  'nav.label.settings',
};

const NAV_ICONS: Record<string, string> = {
    profiles:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    library:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    mapper:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
    modpacks:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    modlists:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    repo:      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>`,
    apps:      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l1-5h16l1 5"/><path d="M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9 13h6"/></svg>`,
    plugins:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    settings:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};

// ── State ────────────────────────────────────────────────────────────────────

let _tutorial: TutorialDef | null = null;
let _partIndex = 0;
let _stepIndex = 0;
let _actionUnsub: (() => void) | null = null;
let _typeInterval: ReturnType<typeof setInterval> | null = null;
let _modalPollInterval: ReturnType<typeof setInterval> | null = null;
let _onClose: (() => void) | null = null;
let _langListener: ((e: Event) => void) | null = null;
// Set when the user ticks "don't remind me" on the unsaved-changes warning —
// suppresses it for the rest of this tutorial session.
let _skipUnsavedWarning = false;

// Drag state
let _isDragging = false;
let _panelLeft: number | null = null;
let _panelTop:  number | null = null;

// Minimize state
let _isMinimized = false;

// ── Tutorial demo data (ephemeral example profile + mods) ──────────────────
let _demoCreated = false;
let _demoPrevActive: string | null = null;
// Tutorials whose steps demonstrate mod/profile features and benefit from a
// concrete example when the user has no real data yet.
const DEMO_TUTORIALS = new Set(['basics', 'advanced', 'other']);

// Persisted marker so a crash mid-tutorial never strands the example profile:
// set when the demo is created, cleared on cleanup, checked at next app boot.
const DEMO_FLAG_KEY = 'bmm_tutorial_demo_active';

async function _setupDemo(): Promise<void> {
    try {
        const res: any = await invoke('tutorial_setup_demo');
        _demoCreated    = !!res?.created;
        _demoPrevActive = res?.prevActive ?? null;
        if (_demoCreated) {
            try { localStorage.setItem(DEMO_FLAG_KEY, JSON.stringify({ prevActive: _demoPrevActive })); } catch { /* best effort */ }
            // Make the example profile + mods appear in the live UI immediately.
            (window as any)._refreshProfilesFn?.();
            (window as any)._refreshModsFn?.(true);
        }
    } catch (e) {
        console.warn('[tutorial] setup demo failed:', e);
        _demoCreated = false;
    }
}

/** Refresh the footer active-profile chip (it doesn't listen to profile refreshes,
 *  so after removing the demo profile it would keep showing the tutorial name). */
async function _refreshProfileChip(): Promise<void> {
    try {
        const { updateProfileChip } = await import('../features/profiles/profiles.js');
        await updateProfileChip();
    } catch { /* footer chip absent — nothing to refresh */ }
}

async function _cleanupDemo(): Promise<void> {
    if (!_demoCreated) return;
    _demoCreated = false;
    const prev = _demoPrevActive;
    _demoPrevActive = null;
    try {
        await invoke('tutorial_cleanup_demo', { prevActive: prev });
        (window as any)._refreshProfilesFn?.();
        (window as any)._refreshModsFn?.(true);
        await _refreshProfileChip();
    } catch (e) {
        console.warn('[tutorial] cleanup demo failed:', e);
    }
    try { localStorage.removeItem(DEMO_FLAG_KEY); } catch { /* best effort */ }
}

/** Boot-time safety net: if BMM crashed (or was killed) in the middle of a tutorial,
 *  the example profile survived on disk. Called once at app start — removes it. */
export async function cleanupOrphanTutorialDemo(): Promise<void> {
    let raw: string | null = null;
    try { raw = localStorage.getItem(DEMO_FLAG_KEY); } catch { /* storage unavailable */ }
    if (!raw) return;
    try {
        const { prevActive } = JSON.parse(raw);
        await invoke('tutorial_cleanup_demo', { prevActive: prevActive ?? null });
        console.log('[tutorial] removed the orphaned example profile left by a crashed session');
        (window as any)._refreshProfilesFn?.();
        (window as any)._refreshModsFn?.(true);
        await _refreshProfileChip();   // the footer chip otherwise keeps the tutorial name
    } catch (e) {
        console.warn('[tutorial] orphan demo cleanup failed:', e);
    }
    try { localStorage.removeItem(DEMO_FLAG_KEY); } catch { /* best effort */ }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startTutorialEngine(
    tutorial: TutorialDef,
    startPartId: string | null,
    startStepId: string | null,
    onClose: () => void,
): void {
    _tutorial    = tutorial;
    _onClose     = onClose;
    _isMinimized = false;
    _skipUnsavedWarning = false;
    try { (window as any).bmmTrack?.('tutorial', { id: tutorial.id, action: 'start' }); } catch {}

    _partIndex = 0;
    _stepIndex = 0;
    if (startPartId) {
        const pi = tutorial.parts.findIndex(p => p.id === startPartId);
        if (pi >= 0) {
            _partIndex = pi;
            if (startStepId) {
                const si = tutorial.parts[pi].steps.findIndex(s => s.id === startStepId);
                if (si >= 0) _stepIndex = si;
            }
        }
    }

    // Inject ephemeral example data (profile + mods) so steps about mods,
    // conflicts, hashes, integrity… have something concrete to point at when
    // the user has no real data. No-op if real mods already exist.
    if (DEMO_TUTORIALS.has(tutorial.id)) _setupDemo();

    _ensurePanel();
    _renderStep();
    _registerLangListener();
    _registerKeyboard();
}

export function closeTutorialEngine(): void {
    _unregisterKeyboard();
    _unregisterLangListener();
    _cleanup();
    _cleanupDemo();
    _isMinimized = false;
    const panel = document.getElementById('tut-engine-panel');
    if (panel) {
        if (_panelLeft !== null) {
            panel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            panel.style.opacity    = '0';
            panel.style.transform  = 'scale(0.96)';
            setTimeout(() => { _setDockReserved(false); panel.remove(); _panelLeft = null; _panelTop = null; }, 220);
        } else {
            panel.classList.add('closing');
            panel.addEventListener('animationend', () => panel.remove(), { once: true });
        }
    }
    if (_onClose) _onClose();
}

// ── Keyboard navigation ──────────────────────────────────────────────────────
// ←/→ step navigation (→ only when the step doesn't demand an action), M or Escape
// minimizes to the pill. Disabled while typing in a field so it never steals input.
let _keyListener: ((e: KeyboardEvent) => void) | null = null;
function _registerKeyboard(): void {
    _unregisterKeyboard();
    _keyListener = (e: KeyboardEvent) => {
        if (!_tutorial || !document.getElementById('tut-engine-panel')) return;
        const tgt = e.target as HTMLElement | null;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
        if (_isMinimized) {
            if (e.key.toLowerCase() === 'm') { e.preventDefault(); const p = document.getElementById('tut-engine-panel'); p?.classList.remove('minimized'); _restore(); }
            return;
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault(); _prevStep();
        } else if (e.key === 'ArrowRight') {
            const nextBtn = document.getElementById('btn-tut-next') as HTMLButtonElement | null;
            if (nextBtn && !nextBtn.disabled) { e.preventDefault(); _nextStep(); }
        } else if (e.key === 'Escape' || e.key.toLowerCase() === 'm') {
            e.preventDefault(); _minimize();
        }
    };
    document.addEventListener('keydown', _keyListener);
}
function _unregisterKeyboard(): void {
    if (_keyListener) { document.removeEventListener('keydown', _keyListener); _keyListener = null; }
}

// ── Lang listener ────────────────────────────────────────────────────────────

function _registerLangListener(): void {
    _unregisterLangListener();
    _langListener = () => {
        if (!_tutorial) return;
        if (_isMinimized) _renderMinimizedPill();
        else _renderStep();
    };
    document.addEventListener('langChanged', _langListener);
}

function _unregisterLangListener(): void {
    if (_langListener) {
        document.removeEventListener('langChanged', _langListener);
        _langListener = null;
    }
}

// ── Internal ─────────────────────────────────────────────────────────────────

function _currentPart(): TutorialPart { return _tutorial!.parts[_partIndex]; }
function _currentStep(): TutorialStep { return _currentPart().steps[_stepIndex]; }
function _totalSteps(): number        { return _currentPart().steps.length; }

function _isElementVisible(el: HTMLElement): boolean {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
}

function _cleanup(): void {
    if (_typeInterval)             { clearInterval(_typeInterval);             _typeInterval             = null; }
    if (_actionUnsub)              { _actionUnsub(); _actionUnsub = null; }
    if (_modalPollInterval)        { clearInterval(_modalPollInterval);        _modalPollInterval        = null; }
    if (_highlightTrackerInterval) { clearInterval(_highlightTrackerInterval); _highlightTrackerInterval = null; }
    document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
    document.getElementById('tut-ghost-cursor')?.remove();
    document.getElementById('tut-scroll-hint')?.remove();
    document.getElementById('tut-unsaved-overlay')?.remove();
    // Don't leave the step's modal open when moving on.
    try { _closeStepModal(_currentStep()); } catch { /* tutorial torn down */ }
    const shell = document.querySelector('.app-shell') as HTMLElement | null;
    if (shell) shell.style.pointerEvents = '';
}

/** Close the modal a step opened (via its modal_selector), using BMM's own close
 *  button so its cleanup runs. No-op if the modal isn't open. */
function _closeStepModal(step: TutorialStep | undefined): void {
    if (!step?.modal_selector) return;
    const el = document.getElementById(step.modal_selector)
        || document.querySelector(`.${step.modal_selector}`);
    const overlay = el?.closest('.modal-overlay, .modal-generic-overlay') as HTMLElement | null;
    if (overlay && overlay.classList.contains('open')) {
        const closeBtn = overlay.querySelector('[data-close], .modal-close') as HTMLElement | null;
        if (closeBtn) closeBtn.click();
        else overlay.classList.remove('open');
    }
}

function _ensurePanel(): void {
    if (!document.getElementById('tut-engine-panel')) {
        const panel = document.createElement('div');
        panel.id        = 'tut-engine-panel';
        panel.className = 'tut-engine-panel';
        document.getElementById('app-window-outer')?.appendChild(panel);
    }
}

function _applyDragPosition(panel: HTMLElement): void {
    if (_panelLeft !== null && _panelTop !== null) {
        panel.style.bottom    = 'unset';
        panel.style.transform = 'none';
        panel.style.left      = `${_panelLeft}px`;
        panel.style.top       = `${_panelTop}px`;
    }
}

/** Navigate to a view using the correct .nav-item[data-view] selector */
function _navigate(nav: string | undefined): void {
    if (!nav) return;
    // Normalize aliases — tutorial-data uses plural/alternate forms that differ from actual data-view values
    const VIEW_ALIAS: Record<string, string> = {
        modlists: 'modlist',
        mods:     'library',
    };
    const viewKey = VIEW_ALIAS[nav] ?? nav;
    const btn = document.querySelector(`.nav-item[data-view="${viewKey}"]`) as HTMLElement | null;
    btn?.click();
}

// ── Drag ─────────────────────────────────────────────────────────────────────

function _makeDraggable(handle: HTMLElement, panel: HTMLElement): void {
    // No-op since the card became a bottom dock.
    //
    // The app now reserves the dock's height and reflows above it. Dragging the bar out of
    // that band would leave a reserved strip of empty space with the guidance floating
    // somewhere else — and put the card back over the controls the dock exists to keep
    // clear. Kept as a stub rather than deleted so the call sites stay honest about what
    // the header handle does now.
    void handle; void panel;
    if (true) return;
    // eslint-disable-next-line no-unreachable
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('button,select,input')) return;

        const parent = panel.parentElement;
        if (!parent) return;

        // First drag: convert from bottom/center anchoring to explicit left/top so
        // the transform channel below is free to carry the live drag offset.
        if (_panelLeft === null) {
            const pr   = parent.getBoundingClientRect();
            const r    = panel.getBoundingClientRect();
            _panelLeft = r.left - pr.left;
            _panelTop  = r.top  - pr.top;
            panel.style.bottom    = 'unset';
            panel.style.transform = 'none';
            panel.style.left      = `${_panelLeft}px`;
            panel.style.top       = `${_panelTop}px`;
        }

        _isDragging = true;
        // Drag purely on the compositor: keep left/top fixed at their committed
        // value and carry the live offset in transform: translate3d(). Writing
        // left/top every mousemove (the old code) forced a layout each frame → the
        // visible lag. We rAF-throttle and bake the transform into left/top on drop.
        const startX = e.clientX, startY = e.clientY;
        const baseLeft = _panelLeft!, baseTop = _panelTop!;
        const pr0  = parent.getBoundingClientRect();
        const maxL = pr0.width  - panel.offsetWidth;
        const maxT = pr0.height - panel.offsetHeight;
        panel.classList.add('dragging');
        panel.style.willChange = 'transform';
        e.preventDefault();

        let curL = baseLeft, curT = baseTop, rafId = 0;
        const paint = () => {
            rafId = 0;
            panel.style.transform = `translate3d(${curL - baseLeft}px, ${curT - baseTop}px, 0)`;
        };
        function onMove(me: MouseEvent) {
            if (!_isDragging) return;
            curL = Math.max(0, Math.min(baseLeft + (me.clientX - startX), maxL));
            curT = Math.max(0, Math.min(baseTop  + (me.clientY - startY), maxT));
            _panelLeft = curL; _panelTop = curT;
            if (!rafId) rafId = requestAnimationFrame(paint);
        }
        function onUp() {
            _isDragging = false;
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            // Bake the final offset back into left/top, then clear the transform.
            panel.style.transform = 'none';
            panel.style.left      = `${_panelLeft}px`;
            panel.style.top       = `${_panelTop}px`;
            panel.style.willChange = '';
            panel.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    });
}

// ── Minimize ─────────────────────────────────────────────────────────────────

function _minimize(): void {
    _cleanup();
    _isMinimized = true;
    _renderMinimizedPill();
}

function _restore(): void {
    _isMinimized = false;
    _renderStep();
}

function _renderMinimizedPill(): void {
    const panel = document.getElementById('tut-engine-panel');
    if (!panel) return;
    panel.classList.add('minimized'); _setDockReserved(true);
    // Drop any inline width/height left by the resize grip, so the pill collapses
    // to its natural size instead of keeping the expanded panel dimensions.
    panel.style.width = '';
    panel.style.height = '';
    _applyDragPosition(panel);

    const tut  = _tutorial!;
    const step = _currentStep();

    panel.innerHTML = `
        <div class="tut-min-pill">
            <span class="tut-min-mascot" style="color:${tut.color}">${tut.icon || ''}</span>
            <div class="tut-min-info">
                <span class="tut-min-title">${t(step.title_key)}</span>
                <span class="tut-min-sub" style="color:${tut.color}">${t(tut.title_key)} &middot; ${t('hub.step').replace('{current}', String(_stepIndex + 1)).replace('{total}', String(_totalSteps()))}</span>
            </div>
            <button class="tut-min-restore-btn" id="btn-tut-restore" data-tooltip="${t('common.resume')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="5 15 12 8 19 15"/></svg>
            </button>
            <button class="tut-x-btn" id="btn-tut-close-min" data-tooltip="${t('hub.close')}">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `;

    const pill = panel.querySelector('.tut-min-pill') as HTMLElement | null;
    if (pill) _makeDraggable(pill, panel);
    document.getElementById('btn-tut-restore')?.addEventListener('click', () => { panel.classList.remove('minimized'); _setDockReserved(true); _restore(); });
    document.getElementById('btn-tut-close-min')?.addEventListener('click', () => { panel.classList.remove('minimized'); _setDockReserved(true); closeTutorialEngine(); });
}

// ── Render ───────────────────────────────────────────────────────────────────

function _renderStep(): void {
    _cleanup();

    const tut   = _tutorial!;
    const part  = _currentPart();
    const step  = _currentStep();
    const panel = document.getElementById('tut-engine-panel')!;

    panel.classList.remove('minimized'); _setDockReserved(true);
    _applyDragPosition(panel);

    /* ── Apply tutorial color CSS vars for avatar glow + top border ── */
    const colorMatch = tut.color.match(/#([0-9a-fA-F]{6})/);
    if (colorMatch) {
        const hex = colorMatch[1];
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        panel.style.setProperty('--tut-panel-color', tut.color);
        panel.style.setProperty('--tut-panel-r', String(r));
        panel.style.setProperty('--tut-panel-g', String(g));
        panel.style.setProperty('--tut-panel-b', String(b));
    } else if (tut.color.startsWith('var(')) {
        panel.style.setProperty('--tut-panel-color', tut.color);
    }

    _navigate(step.nav);
    savePosition(tut.id, part.id, step.id);
    if (step.action) markStepPartial(tut.id, part.id, step.id);

    /* ── Part chips ── */
    const partChips = tut.parts.map((p, i) => {
        const done     = p.steps.filter(s => getStepStatus(tut.id, p.id, s.id).state === 'complete').length;
        const isActive = i === _partIndex;
        const isDone   = done === p.steps.length;
        const chipStyle = isActive ? `background:${tut.color}1a;border-color:${tut.color}55;color:${tut.color}` : '';
        return `<button class="tut-part-chip ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}" data-pi="${i}" data-tooltip="${t(p.title_key)}" ${chipStyle ? `style="${chipStyle}"` : ''}>
            ${isDone ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            <span class="tut-part-chip-label">${t(p.title_key)}</span>
        </button>`;
    }).join('');

    /* ── Step badges (current part only) ── */
    const badges = part.steps.map((s, i) => {
        const st = getStepStatus(tut.id, part.id, s.id);
        const isCurrent = i === _stepIndex;
        const currentStyle = isCurrent && st.state === 'pending' ? `style="background:${tut.color};box-shadow:0 0 8px ${tut.color}88;outline-color:${tut.color}44"` : '';
        return `<span class="tut-step-badge tut-badge-${st.state}${isCurrent ? ' current' : ''}" ${currentStyle} data-tooltip="${t(`hub.badge.${st.state}`)}"></span>`;
    }).join('');

    /* ── Global progress ── */
    const allStepKeys = tut.parts.flatMap(p => p.steps.map(s => `${p.id}:${s.id}`));
    const completedCount = allStepKeys.filter(k => {
        const [pid, sid] = k.split(':');
        return getStepStatus(tut.id, pid, sid).state === 'complete';
    }).length;
    const globalPct = allStepKeys.length > 0 ? Math.round((completedCount / allStepKeys.length) * 100) : 0;

    const hasTarget = !!(step.selector || (step.selectors && step.selectors.length) || (step.action && step.nav) || (step.fields && step.fields.length) || (step.modal_fields && step.modal_fields.length));

    /* ── Field guide: numbered explanation of every field to fill ── */
    const _fieldList = step.modal_fields ?? step.fields;
    const fieldGuideHtml = _fieldList && _fieldList.length ? `
        <div class="tut-field-guide">
            <div class="tut-field-guide-title">${t('tut.fieldGuide')}</div>
            ${_fieldList.map((f, i) => `
                <div class="tut-field-row">
                    <span class="tut-field-num" style="background:${tut.color}">${i + 1}</span>
                    <span class="tut-field-desc">${t(f.key)}</span>
                </div>`).join('')}
        </div>
    ` : '';

    /* ── Nav hint (clickable). If already on the page, say so instead of "Go to". ── */
    const _navViewKey = step.nav ? (_VIEW_ALIAS[step.nav] ?? step.nav) : '';
    const _activeView = (document.querySelector('.nav-item.active') as HTMLElement | null)?.dataset.view;
    const _onPage = !!step.nav && _activeView === _navViewKey;
    const _checkSvg = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="opacity:0.85"><polyline points="20 6 9 17 4 12"/></svg>`;
    const _chevSvg = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:2px;opacity:0.5"><polyline points="9 18 15 12 9 6"/></svg>`;
    const navHintHtml = step.nav && NAV_LABELS[step.nav] ? `
        <button class="tut-nav-hint${_onPage ? ' on-page' : ''}" id="btn-tut-nav-hint" data-nav="${step.nav}"
            style="border-color:${tut.color}33;background:${tut.color}0d;cursor:${_onPage ? 'default' : 'pointer'}"
            data-tooltip="${_onPage ? (t('hub.alreadyHere') || 'You are already here') : t('hub.goTo') + ' ' + t(NAV_LABELS[step.nav])}">
            ${_onPage ? _checkSvg : (NAV_ICONS[step.nav] || '')}
            <span class="tut-nav-hint-label">${_onPage ? (t('hub.youreOn') || "You're on") : t('hub.goTo')}</span>
            <strong class="tut-nav-hint-page">${t(NAV_LABELS[step.nav])}</strong>
            ${_onPage ? '' : _chevSvg}
        </button>
    ` : '';

    /* ── Action box ── */
    const actionHtml = step.action ? `
        <div class="tut-action-box" id="tut-action-box" style="border-left-color:${tut.color};border-color:${tut.color}33;background:${tut.color}0d">
            <div class="tut-action-pulse" style="background:${tut.color}"></div>
            <div class="tut-action-text">
                <span class="tut-action-label" style="color:${tut.color}">${t('hub.action.waiting')}</span>
                <p class="tut-action-desc">${t(step.action.desc_key)}</p>
            </div>
            <button class="tut-action-skip-btn" id="btn-tut-skip-action">${step.optional ? t('hub.action.skip') : (t('hub.action.skipStep') || t('hub.action.skip'))}</button>
        </div>
    ` : '';

    /* ── Nav state ── */
    const isFirst    = _partIndex === 0 && _stepIndex === 0;
    const isVeryLast = _stepIndex === _totalSteps() - 1 && _partIndex === tut.parts.length - 1;
    const nextLabel  = isVeryLast ? t('hub.finish') : `${t('hub.next')} →`;

    panel.innerHTML = `
        <div class="tut-card-topbar">
            <button class="tut-back-hub-btn" id="btn-tut-back-hub">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                ${t('hub.back')}
            </button>

            <div class="tut-chips-scroller">
                <div class="tut-part-chips-wrap">${partChips}</div>
            </div>

            <div class="tut-topbar-right">
                <button class="tut-min-btn" id="btn-tut-minimize" data-tooltip="${t('common.minimize')}">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button class="tut-x-btn" id="btn-tut-close" data-tooltip="${t('hub.close')}">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>

        <div class="tut-card-body tut-body-enter">
            <div class="tut-step-header">
                <div class="tut-avatar" style="color:${tut.color}">
                    ${step.icon || tut.icon || ''}
                </div>
                <div class="tut-header-text">
                    <div class="tut-header-meta">
                        <span class="tut-tutorial-label" style="color:${tut.color}">${t(tut.title_key)}</span>
                        <span class="tut-step-ctr">${_stepIndex + 1}/${_totalSteps()}</span>
                    </div>
                    <h3 class="tut-step-title">
                        ${step.icon ? `<span class="tut-step-icon">${step.icon}</span>` : ''}
                        ${t(step.title_key)}
                    </h3>
                </div>
            </div>

            ${navHintHtml ? `<div class="tut-nav-hint-row">${navHintHtml}</div>` : ''}

            <div class="tut-step-scroll-area">
                <p class="tut-step-text" id="tut-typewriter"></p>
                ${fieldGuideHtml}
                ${actionHtml}
            </div>
        </div>

        <div class="tut-card-footer">
            <div class="tut-footer-top">
                <div class="tut-badges-row">${badges}</div>
                <div class="tut-footer-progress">
                    <div class="tut-footer-progress-bar">
                        <div class="tut-footer-progress-fill" style="width:${globalPct}%;background:${tut.color}"></div>
                    </div>
                    <span class="tut-footer-progress-label">${globalPct}%</span>
                    <span class="tut-kbd-hint" data-tooltip="${t('tut.kbdHint') || 'Keyboard: ← → navigate · M minimize'}"><kbd>←</kbd><kbd>→</kbd><kbd>M</kbd></span>
                </div>
            </div>
            <div class="tut-footer-btns">
                <div style="display:flex;align-items:center;gap:8px">
                    ${!isFirst ? `<button class="tut-prev-btn" id="btn-tut-prev">← ${t('hub.prev')}</button>` : ''}
                    ${hasTarget ? `<button class="tut-showme-btn" id="btn-tut-showme" data-tooltip="${t('tut.showMe.tip') || 'Show me where to interact'}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/></svg>${t('tut.showMe') || 'Show me'}</button>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="tut-skip-all-btn" id="btn-tut-skip-all" data-tooltip="${t('tut.skip.title')}">${t('tut.skip')}</button>
                    <button class="tut-next-btn" id="btn-tut-next" ${step.action ? 'disabled' : ''} style="background:${tut.color};border-color:${tut.color}">${nextLabel}</button>
                </div>
            </div>
        </div>
    `;

    /* ── Highlights (delayed — wait for nav/view to settle) ── */
    const _snapPart = _partIndex;
    const _snapStep = _stepIndex;
    setTimeout(() => {
        if (!document.getElementById('tut-engine-panel')) return;
        if (_partIndex !== _snapPart || _stepIndex !== _snapStep) return;
        _highlightElements(step);
        if (step.modal_selector) _startModalPoll(step.modal_selector, step.modal_fields);
    }, 300);

    /* ── Typewriter ── */
    _startTypewriter(t(step.text_key));

    /* ── Drag (topbar only, exclude chip scroller) ── */
    const topbar = panel.querySelector('.tut-card-topbar') as HTMLElement | null;
    if (topbar) _makeDraggable(topbar, panel);

    /* ── Button listeners ── */
    document.getElementById('btn-tut-back-hub')?.addEventListener('click', () => { _cleanup(); closeTutorialEngine(); });
    document.getElementById('btn-tut-close')?.addEventListener('click', () => closeTutorialEngine());
    document.getElementById('btn-tut-minimize')?.addEventListener('click', () => _minimize());
    document.getElementById('btn-tut-prev')?.addEventListener('click', _prevStep);
    document.getElementById('btn-tut-next')?.addEventListener('click', _nextStep);

    /* ── Clickable nav hint ── */
    document.getElementById('btn-tut-nav-hint')?.addEventListener('click', () => _navigate(step.nav));

    /* ── Skip all (quit tutorial + hub) ── */
    document.getElementById('btn-tut-skip-all')?.addEventListener('click', () => _skipTutorial());
    document.getElementById('btn-tut-showme')?.addEventListener('click', () => _showMe());

    /* ── Skip action ── */
    document.getElementById('btn-tut-skip-action')?.addEventListener('click', () => {
        markStepPartial(tut.id, part.id, step.id);
        document.getElementById('btn-tut-next')?.removeAttribute('disabled');
        document.getElementById('tut-action-box')?.classList.add('skipped');
        if (_modalPollInterval) { clearInterval(_modalPollInterval); _modalPollInterval = null; }
        document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
        // Don't leave the step's modal hanging open (e.g. skipping "create a profile"
        // while the New Profile dialog is up).
        _closeStepModal(step);
    });

    /* ── Part chip navigation ── */
    panel.querySelectorAll('.tut-part-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            _cleanup();
            _partIndex = parseInt((chip as HTMLElement).dataset.pi!, 10);
            _stepIndex = 0;
            _renderStep();
        });
    });

    /* ── Chips drag-scroll + wheel-to-horizontal ── */
    const chipsWrap = panel.querySelector('.tut-part-chips-wrap') as HTMLElement | null;
    if (chipsWrap) {
        // Scroll active chip into view
        const activeChip = chipsWrap.querySelector('.tut-part-chip.active') as HTMLElement | null;
        if (activeChip) {
            const wrapRect  = chipsWrap.getBoundingClientRect();
            const chipRect  = activeChip.getBoundingClientRect();
            const chipLeft  = activeChip.offsetLeft;
            const chipRight = chipLeft + activeChip.offsetWidth;
            if (chipRight > chipsWrap.scrollLeft + chipsWrap.clientWidth) {
                chipsWrap.scrollLeft = chipRight - chipsWrap.clientWidth + 8;
            } else if (chipLeft < chipsWrap.scrollLeft) {
                chipsWrap.scrollLeft = chipLeft - 8;
            }
        }

        // Wheel → horizontal scroll
        chipsWrap.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            chipsWrap.scrollLeft += e.deltaY || e.deltaX;
        }, { passive: false });

        // Drag-to-scroll (hold + move)
        let _chipDrag = false;
        let _chipDragX = 0;
        let _chipScrollStart = 0;
        let _chipDragMoved = false;

        chipsWrap.addEventListener('mousedown', (e: MouseEvent) => {
            _chipDrag = true;
            _chipDragMoved = false;
            _chipDragX = e.clientX;
            _chipScrollStart = chipsWrap.scrollLeft;
            chipsWrap.style.cursor = 'grabbing';
            e.preventDefault();
        });
        const onChipMove = (e: MouseEvent) => {
            if (!_chipDrag) return;
            const dx = e.clientX - _chipDragX;
            if (Math.abs(dx) > 3) _chipDragMoved = true;
            if (_chipDragMoved) chipsWrap.scrollLeft = _chipScrollStart - dx;
        };
        const onChipUp = () => {
            _chipDrag = false;
            chipsWrap.style.cursor = '';
            document.removeEventListener('mousemove', onChipMove);
            document.removeEventListener('mouseup', onChipUp);
        };
        chipsWrap.addEventListener('mousedown', () => {
            document.addEventListener('mousemove', onChipMove);
            document.addEventListener('mouseup', onChipUp);
        });
    }

    /* ── Action event listener ── */
    if (step.action) {
        const shell = document.querySelector('.app-shell') as HTMLElement | null;
        if (shell) shell.style.pointerEvents = '';

        _actionUnsub = onBmmAction(step.action.event, () => {
            if (_actionUnsub) { _actionUnsub(); _actionUnsub = null; }
            if (_modalPollInterval) { clearInterval(_modalPollInterval); _modalPollInterval = null; }
            markStepComplete(tut.id, part.id, step.id);
            document.querySelectorAll('.tut-highlight').forEach(el => el.remove());

            const box = document.getElementById('tut-action-box');
            if (box) {
                box.className = 'tut-action-box done';
                box.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                    <span class="tut-action-label" style="color:var(--success)">${t('hub.action.complete')}</span>
                `;
            }

            const badgesEl = panel.querySelector('.tut-badges-row');
            if (badgesEl) {
                badgesEl.innerHTML = part.steps.map((s, i) => {
                    const st = getStepStatus(tut.id, part.id, s.id);
                    return `<span class="tut-step-badge tut-badge-${st.state}${i === _stepIndex ? ' current' : ''}" data-tooltip="${t(`hub.badge.${st.state}`)}"></span>`;
                }).join('');
            }

            const nextBtn = document.getElementById('btn-tut-next') as HTMLButtonElement | null;
            if (nextBtn) nextBtn.disabled = false;
        });
    }
}

function _skipTutorial(): void {
    _cleanup();
    _cleanupDemo();
    _unregisterLangListener();
    _isMinimized = false;
    const panel = document.getElementById('tut-engine-panel');
    if (panel) {
        panel.classList.add('closing');
        panel.addEventListener('animationend', () => { _setDockReserved(false); panel.remove(); _panelLeft = null; _panelTop = null; }, { once: true });
    }
    // Intentionally skip _onClose so the hub does not reopen
}

function _prevStep(): void {
    _cleanup();
    if (_stepIndex > 0)      { _stepIndex--; }
    else if (_partIndex > 0) { _partIndex--; _stepIndex = _currentPart().steps.length - 1; }
    _renderStep();
}

function _nextStep(): void {
    const step = _currentStep();
    // (Removed the mid-tutorial "Unsaved changes" warning modal per user request —
    // just advance; any open dialog is closed by the normal step cleanup.)
    _advanceStep(step);
}

function _advanceStep(step: TutorialStep): void {
    if (!step.action) markStepComplete(_tutorial!.id, _currentPart().id, step.id);
    _cleanup();

    if (_stepIndex < _totalSteps() - 1)                { _stepIndex++; }
    else if (_partIndex < _tutorial!.parts.length - 1) { _partIndex++; _stepIndex = 0; }
    else                                               { _finishTutorial(); return; }
    _renderStep();
}

/** True if the step's modal is open AND the user has typed/picked something in it. */
function _isModalDirty(step: TutorialStep | undefined): boolean {
    if (!step?.modal_selector) return false;
    const el = document.getElementById(step.modal_selector)
        || document.querySelector(`.${step.modal_selector}`);
    const overlay = el?.closest('.modal-overlay, .modal-generic-overlay') as HTMLElement | null;
    if (!overlay || !overlay.classList.contains('open')) return false;
    const inputs = overlay.querySelectorAll('input, textarea, select');
    for (const node of Array.from(inputs)) {
        const inp = node as HTMLInputElement;
        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        if (inp.disabled || type === 'hidden' || type === 'button' || type === 'submit') continue;
        if ((inp.value ?? '').trim() !== '') return true;
    }
    return false;
}

/** Small "unsaved changes" warning shown before closing an edited modal mid-tutorial.
 *  Continue-without-saving only; optional "don't remind me again" for the session. */
function _showUnsavedWarning(onContinue: () => void): void {
    document.getElementById('tut-unsaved-overlay')?.remove();
    const color = _tutorial?.color ?? 'var(--accent)';
    const ov = document.createElement('div');
    ov.id = 'tut-unsaved-overlay';
    ov.className = 'tut-unsaved-overlay';
    // Anchor INSIDE the rounded app window (like every working modal in BMM):
    // - the dim + the box's shadow get clipped by the window instead of bleeding
    //   onto the transparent Tauri margins;
    // - it hit-tests in the same stacking space as the modal it covers, so clicks
    //   land on THIS dialog instead of falling through to elements behind it.
    const host = document.getElementById('app-window-outer') || document.body;
    ov.innerHTML = `
        <div class="tut-unsaved-box">
            <div class="tut-unsaved-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--bmm-warning)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
            <h3>${t('tut.unsaved.title') || 'Unsaved changes'}</h3>
            <p>${t('tut.unsaved.text') || "You started editing here but didn't save. Continue anyway? Your changes in this dialog will be discarded."}</p>
            <label class="tut-unsaved-remember"><input type="checkbox" id="tut-unsaved-remember" /> <span>${t('tut.unsaved.remember') || "Don't remind me again during this tutorial"}</span></label>
            <div class="tut-unsaved-btns">
                <button class="tut-skip-all-btn" id="tut-unsaved-cancel">${t('common.cancel') || 'Cancel'}</button>
                <button class="tut-next-btn" id="tut-unsaved-continue" style="background:${color};border-color:${color}">${t('tut.unsaved.continue') || 'Continue without saving'}</button>
            </div>
        </div>`;
    host.appendChild(ov);
    // Swallow every event at the overlay so nothing reaches the UI underneath.
    ov.addEventListener('mousedown', (e) => e.stopPropagation());
    ov.addEventListener('click', (e) => e.stopPropagation());
    ov.querySelector('#tut-unsaved-cancel')?.addEventListener('click', () => ov.remove());
    ov.querySelector('#tut-unsaved-continue')?.addEventListener('click', () => {
        if ((ov.querySelector('#tut-unsaved-remember') as HTMLInputElement | null)?.checked) {
            _skipUnsavedWarning = true;
        }
        ov.remove();
        onContinue();
    });
}

function _finishTutorial(): void {
    _cleanup();
    const panel = document.getElementById('tut-engine-panel')!;
    const tut   = _tutorial!;
    panel.classList.remove('minimized'); _setDockReserved(true);
    _applyDragPosition(panel);

    panel.innerHTML = `
        <div class="tut-finish-screen">
            <div class="tut-finish-glow" style="background:${tut.color}"></div>
            <div class="tut-finish-mascot tut-finish-check" style="color:${tut.color}">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="tut-finish-text-col">
                <h2 class="tut-finish-title">${t('hub.done')}</h2>
                <p class="tut-finish-subtitle">${t(tut.title_key)}</p>
            </div>
            <button class="tut-next-btn" id="btn-tut-finish-hub" style="background:${tut.color};border-color:${tut.color}">${t('hub.back')}</button>
        </div>
    `;

    document.getElementById('btn-tut-finish-hub')?.addEventListener('click', () => {
        _cleanupDemo();
        panel.classList.add('closing');
        panel.addEventListener('animationend', () => {
            _setDockReserved(false); panel.remove(); _panelLeft = null; _panelTop = null;
            if (_onClose) _onClose();
        }, { once: true });
    });
}

function _startTypewriter(text: string): void {
    const el = document.getElementById('tut-typewriter');
    if (!el) return;

    // If the text contains HTML tags, use instant render with fade-in
    if (/<[a-z]/i.test(text)) {
        el.innerHTML = text;
        el.classList.remove('fade-in');
        void el.offsetWidth; // force reflow
        el.classList.add('fade-in');
        return;
    }

    // Plain text: character-by-character typewriter
    el.textContent = '';
    el.classList.remove('fade-in');
    let i = 0;
    _typeInterval = setInterval(() => {
        if (i < text.length) { el.textContent += text[i++]; }
        else { clearInterval(_typeInterval!); _typeInterval = null; }
    }, 11);
}

// ── Modal polling — highlights a secondary element once it becomes visible ───

function _startModalPoll(modalSelector: string, fields?: { sel: string; key: string }[]): void {
    if (_modalPollInterval) { clearInterval(_modalPollInterval); _modalPollInterval = null; }
    let attempts = 0;
    _modalPollInterval = setInterval(() => {
        attempts++;
        if (attempts > 120) { clearInterval(_modalPollInterval!); _modalPollInterval = null; return; } // 30s timeout

        const target = document.getElementById(modalSelector) || document.querySelector(`.${modalSelector}`);
        if (target && _isElementVisible(target as HTMLElement)) {
            clearInterval(_modalPollInterval!);
            _modalPollInterval = null;
            // Remove primary highlights, then highlight the modal target (and, if the
            // step declares them, every field to fill — numbered, no dim).
            document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
            if (fields && fields.length) {
                _highlightFields(fields);
            } else {
                _highlightElement(modalSelector, 0);
            }
        }
    }, 250);
}

// ── Highlighting ─────────────────────────────────────────────────────────────

const _VIEW_ALIAS: Record<string, string> = { modlists: 'modlist', mods: 'library' };

// When true, highlights are drawn as plain numbered rings (no spotlight dim) — used
// for "field guide" multi-field highlighting where the whole form must stay visible.
let _suppressDim = false;

/** Highlight + number every field in a guide (no dim, so the form stays readable). */
function _highlightFields(fields: { sel: string; key: string }[]): void {
    _suppressDim = true;
    fields.forEach((f, i) => _highlightElement(f.sel, i));
    _suppressDim = false;
}

function _highlightElements(step: TutorialStep): void {
    // Field guide for fields already on the page (numbered rings, no dim).
    if (step.fields && step.fields.length) {
        _highlightFields(step.fields);
        return;
    }
    const selectors: string[] = [
        ...(step.selector ? [step.selector] : []),
        ...(step.selectors ?? []),
    ];
    if (selectors.length) {
        selectors.forEach((sel, idx) => _highlightElement(sel, idx));
        return;
    }
    // Every action MUST point somewhere. If a step asks the user to act but declares
    // no target, spotlight the nav item for its page so there's always an "interact
    // here" cue instead of a blank "waiting…".
    if (step.action && step.nav) {
        const viewKey = _VIEW_ALIAS[step.nav] ?? step.nav;
        const navBtn = document.querySelector(`.nav-item[data-view="${viewKey}"]`);
        if (navBtn) _drawHighlight(navBtn, 0);
    }
}

/** A native <select> is replaced app-wide by a custom dropdown: the real <select>
 *  is hidden (display:none ⇒ 0×0) and a sibling `.bmm-csel-trigger` button is shown.
 *  Resolve any hidden select to its visible trigger so highlights/Show-me land on it. */
function _resolveCustomSelect(el: Element | null | undefined): Element | null | undefined {
    if (!el) return el;
    if (el.tagName === 'SELECT' || el.classList?.contains('bmm-csel-native-hidden')) {
        const wrap = el.nextElementSibling;
        const trig = wrap?.classList?.contains('bmm-csel') ? wrap.querySelector('.bmm-csel-trigger') : null;
        if (trig) return trig;
    }
    return el;
}

/** Tutorial demo entities carry ids prefixed `__bmm_tutorial_demo`. When an action
 *  step targets a class that matches several elements (a mod card, a toggle, an Apply
 *  button…), always prefer the one tied to the demo entity so the user acts on the
 *  example — never on their real mods. */
const _DEMO_ATTR = '[data-id^="__bmm_tutorial_demo"], [data-pack-id^="__bmm_tutorial_demo"], [data-modpack-id^="__bmm_tutorial_demo"]';
function _preferDemo(matches: Element[]): Element | null {
    if (!matches.length) return null;
    return matches.find(el => el.matches(_DEMO_ATTR) || el.closest(_DEMO_ATTR)) || matches[0];
}

function _highlightElement(selector: string, idx: number = 0): void {
    let target: Element | null = document.getElementById(selector)
        || document.querySelector(`[id="${selector}"]`);
    if (!target) {
        // Class match — there may be many (one per mod/pack); prefer the demo entity's.
        target = _preferDemo(Array.from(document.querySelectorAll(`.${selector}`)));
    }
    target = _resolveCustomSelect(target) ?? null;
    if (target) _drawHighlight(target, idx);
}

function _drawHighlight(target: Element, idx: number = 0): void {
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    // Smart placement: keep the coach card off the highlighted target.
    if (idx === 0) { _autoPlacePanel(r); _setDockReserved(true); }

    const cs = window.getComputedStyle(target as HTMLElement);
    const baseRadius = parseFloat(cs.borderTopLeftRadius) || 8;

    const pad = 4;
    // Use tutorial color for highlights if available
    const tutColor = _tutorial?.color ?? 'var(--accent)';
    const tutColorHex = tutColor.startsWith('#') ? tutColor : '#3b82f6';
    const hl = document.createElement('div');
    hl.className     = 'tut-highlight';
    hl.dataset.hlIdx = String(idx);
    // The primary target (idx 0) carries the spotlight dim: a huge soft box-shadow
    // darkens everything EXCEPT the cut-out, so the eye lands on the right spot.
    // Secondary targets get just the coloured ring (no extra dim, to avoid stacking).
    const dim = (idx === 0 && !_suppressDim)
        ? `0 0 0 3px ${tutColorHex}40, 0 0 0 9999px rgba(8,11,18,0.60), 0 0 34px ${tutColorHex}99`
        : `0 0 0 3px ${tutColorHex}33, 0 0 26px ${tutColorHex}80`;
    hl.style.cssText = `
        position:fixed;
        top:${r.top - pad}px;
        left:${r.left - pad}px;
        width:${r.width + pad * 2}px;
        height:${r.height + pad * 2}px;
        border:2px solid ${tutColor};
        border-radius:${baseRadius + pad}px;
        color:${tutColor};
        box-shadow:${dim};
        z-index:99990;
        pointer-events:none;
        transition:top 0.22s cubic-bezier(0.4,0,0.2,1), left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1), height 0.22s cubic-bezier(0.4,0,0.2,1), border-radius 0.22s ease;
    `;
    // Stash the selector so the tracker can re-measure
    (hl as any)._tutTarget = target;

    if (idx > 0 || _suppressDim) {
        const label = document.createElement('div');
        label.style.cssText = `
            position:absolute; top:-9px; left:-9px;
            width:18px; height:18px; border-radius:50%;
            background:${tutColor}; color:#fff;
            font-size:10px; font-weight:800;
            display:flex; align-items:center; justify-content:center;
            box-shadow:0 2px 6px ${tutColorHex}80;
        `;
        label.textContent = String(idx + 1);
        hl.appendChild(label);
    }

    document.body.appendChild(hl);
    _startHighlightTracker();
}

/** Anchor the coach card to whichever edge is FARTHER from the spotlight target,
 *  so the guidance never sits on top of what it's pointing at. No-op once the
 *  user has dragged the card themselves. */
function _autoPlacePanel(_targetRect: DOMRect): void {
    // Deliberately empty since the card became a bottom dock.
    //
    // It used to hop to whichever half the target was not in, which made the guidance move
    // mid-lesson and could still land on the control the step was asking you to click. A
    // dock reserves its own space, so there is nothing left to avoid.
}

/** Reserve the dock's height on <body> so the app reflows above it instead of being
 *  covered — and give it back on teardown, otherwise every later view keeps a phantom
 *  band of padding it cannot explain. */
function _setDockReserved(on: boolean): void {
    document.body.classList.toggle('tut-docked', on);
    if (!on) {
        document.body.classList.remove('tut-min');
        document.body.style.removeProperty('--tut-dock-h');
        return;
    }
    const panel = document.getElementById('tut-engine-panel');
    // Measured rather than assumed: the card's height depends on the step's text, and a
    // fixed number would clip long ones or leave a gap under short ones.
    const h = panel ? Math.min(Math.max(panel.scrollHeight, 160), Math.round(window.innerHeight * 0.42)) : 200;
    document.body.style.setProperty('--tut-dock-h', `${h}px`);
    document.body.classList.toggle('tut-min', !!panel?.classList.contains('minimized'));
}

/** "Phantom" demo: float a ghost cursor from the coach card to the current
 *  spotlight target and play a click pulse — shows WHERE/how to interact without
 *  actually clicking anything (safe). */
function _showMe(): void {
    // Visit EVERY highlighted target in order (so multi-field steps demonstrate
    // each field, not just the "next" button).
    const hls = Array.from(document.querySelectorAll('.tut-highlight')) as HTMLElement[];
    if (!hls.length) return;
    const color = _tutorial?.color ?? 'var(--accent)';

    document.getElementById('tut-ghost-cursor')?.remove();
    const ghost = document.createElement('div');
    ghost.id = 'tut-ghost-cursor';
    ghost.className = 'tut-ghost-cursor';
    ghost.style.color = color;
    ghost.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"><path d="m4 2 6 16 2.3-6.4L18.8 9.2Z"/></svg>`;
    const panel = document.getElementById('tut-engine-panel');
    const pr = panel?.getBoundingClientRect();
    ghost.style.left = `${pr ? pr.left + 44 : window.innerWidth / 2}px`;
    ghost.style.top = `${pr ? pr.top + 24 : window.innerHeight - 180}px`;
    document.body.appendChild(ghost);

    // A little caption that follows the cursor and says what to DO at each stop —
    // makes "Show me" actually teach instead of just hovering.
    const caption = document.createElement('div');
    caption.id = 'tut-ghost-caption';
    caption.className = 'tut-ghost-caption';
    caption.style.background = color;
    document.body.appendChild(caption);
    const captionFor = (el: Element | undefined): string => {
        if (!el) return t('tut.showme.look');
        const node = el as HTMLElement;
        const tag = node.tagName;
        const name = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22)
            || node.getAttribute('aria-label') || (node as HTMLInputElement).placeholder || '';
        if (tag === 'SELECT' || node.getAttribute('role') === 'combobox') return t('tut.showme.pick');
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            return (node as HTMLInputElement).readOnly ? t('tut.showme.choose') : t('tut.showme.type');
        }
        if (tag === 'BUTTON' || node.closest('button')) {
            return name ? `${t('tut.showme.click')} “${name}”` : t('tut.showme.click');
        }
        return t('tut.showme.lookHere');
    };

    const targetOf = (el: HTMLElement): Element | undefined => (el as { _tutTarget?: Element })._tutTarget;
    // The element you actually CLICK for a field: a readonly path input is filled via
    // its Browse/pick button, so point the ghost there instead of the (uneditable) box.
    const actionPointOf = (t: Element | undefined): Element | undefined => {
        if (!t) return t;
        // Hidden native <select> → its visible custom-dropdown trigger.
        const csel = _resolveCustomSelect(t);
        if (csel && csel !== t) return csel;
        const inp = t as HTMLInputElement;
        if (inp.tagName === 'INPUT' && inp.readOnly) {
            const btn = inp.closest('.path-picker, .form-group')?.querySelector('button');
            if (btn) return btn;
        }
        return t;
    };
    const rectOf = (el: HTMLElement): DOMRect => {
        const ap = actionPointOf(targetOf(el));
        return (ap?.getBoundingClientRect() ?? el.getBoundingClientRect()) as DOMRect;
    };

    // Temp demo values: type a sample into writable text fields, then restore them
    // at the end (so nothing junk is left behind).
    const filled: { el: HTMLInputElement; prev: string }[] = [];
    const demoFill = (el: Element | undefined) => {
        if (!el) return;
        const inp = el as HTMLInputElement;
        const tag = inp.tagName;
        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        const typable = (tag === 'INPUT' && ['text', 'url', 'email', 'number', ''].includes(type)) || tag === 'TEXTAREA';
        if (!typable || inp.readOnly || inp.disabled) return;
        // Skip pickers / autocompletes / filters — typing a sample into a "search a
        // mod" or "add a dependency" box is wrong (it's a selection, not free text).
        const idl = (inp.id || '').toLowerCase();
        if (/depend|search|require|filter|^mod-tag$|autocomplete/.test(idl)) return;
        if (inp.getAttribute('role') === 'combobox' || inp.hasAttribute('list')) return;
        const grp = inp.closest('.form-group, .path-picker') || inp.parentElement;
        if (grp && grp.querySelector('[id*="suggest" i],[class*="suggest" i],[class*="dropdown" i]')) return;
        const sample = (inp.placeholder || 'Example').replace(/[.…]+\s*$/, '').trim() || 'Example';
        filled.push({ el: inp, prev: inp.value });
        inp.value = sample;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
    };

    let i = 0;
    const visit = () => {
        if (!document.getElementById('tut-ghost-cursor')) return;
        if (i >= hls.length) {
            setTimeout(() => {
                ghost.remove();
                caption.remove();
                // Temp: undo the demo values.
                filled.forEach(f => { f.el.value = f.prev; f.el.dispatchEvent(new Event('input', { bubbles: true })); });
            }, 650);
            return;
        }
        // Bring the real click target on-screen first, otherwise the ghost would point
        // at an element scrolled out of view.
        const ap = actionPointOf(targetOf(hls[i])) as HTMLElement | undefined;
        ap?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        // Let the scroll settle, then aim.
        setTimeout(() => {
            if (!document.getElementById('tut-ghost-cursor')) return;
            const r = rectOf(hls[i]);
            const tx = r.left + r.width / 2;
            // For tall targets (panels / file trees) aim near the top — that's where the
            // header, dropdown and first row live — not the dead centre of a huge box.
            const ty = r.height > 140 ? r.top + 34 : r.top + r.height / 2;
            ghost.style.left = `${tx}px`;
            ghost.style.top = `${ty}px`;
            const tgt = targetOf(hls[i]);
            // Caption: keep it on-screen, just above-right of the cursor.
            caption.textContent = captionFor(ap ?? (tgt as HTMLElement));
            const capX = Math.min(tx + 16, window.innerWidth - 160);
            const capY = Math.max(ty - 30, 8);
            caption.style.left = `${capX}px`;
            caption.style.top = `${capY}px`;
            caption.classList.add('show');
            setTimeout(() => {
                if (!document.getElementById('tut-ghost-cursor')) return;
                ghost.classList.add('clicking');
                _ghostClickPulse(tx, ty, color);
                demoFill(tgt);
                setTimeout(() => ghost.classList.remove('clicking'), 300);
                i++;
                setTimeout(visit, 760);
            }, 620);
        }, 280);
    };
    requestAnimationFrame(visit);
}

function _ghostClickPulse(x: number, y: number, color: string): void {
    const ring = document.createElement('div');
    ring.className = 'tut-ghost-pulse';
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.style.borderColor = color;
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 650);
}

/* ── Highlight position tracker — re-measures every 150ms ────────────────── */
let _highlightTrackerInterval: ReturnType<typeof setInterval> | null = null;

function _startHighlightTracker(): void {
    if (_highlightTrackerInterval) return;
    _highlightTrackerInterval = setInterval(() => {
        const highlights = document.querySelectorAll('.tut-highlight');
        if (highlights.length === 0) {
            clearInterval(_highlightTrackerInterval!);
            _highlightTrackerInterval = null;
            _renderScrollHint(null, null);
            return;
        }
        let anyInView = false;
        let offTarget: { el: HTMLElement; dir: 'up' | 'down' } | null = null;
        highlights.forEach(hlEl => {
            const hl     = hlEl as HTMLElement;
            const target = (hl as any)._tutTarget as HTMLElement | null;
            if (!target || !target.isConnected) { hl.remove(); return; }
            const r = target.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) { hl.remove(); return; }
            // View bounds = the nearest scroll container, else the window.
            const clip = _scrollClipRect(target);
            const vTop = clip ? clip.top : 0;
            const vBottom = clip ? clip.bottom : window.innerHeight;
            const cy = r.top + r.height / 2;
            const inView = cy >= vTop - 2 && cy <= vBottom + 2;
            hl.style.visibility = inView ? 'visible' : 'hidden';
            if (inView) anyInView = true;
            else if (!offTarget) offTarget = { el: target, dir: cy < vTop ? 'up' : 'down' };
            const pad        = 4;
            const cs         = window.getComputedStyle(target);
            const baseRadius = parseFloat(cs.borderTopLeftRadius) || 8;
            hl.style.top         = `${r.top - pad}px`;
            hl.style.left        = `${r.left - pad}px`;
            hl.style.width       = `${r.width + pad * 2}px`;
            hl.style.height      = `${r.height + pad * 2}px`;
            hl.style.borderRadius= `${baseRadius + pad}px`;
        });
        // Show a "scroll up/down" cue when the highlighted target is off-screen and
        // nothing else for this step is currently visible.
        if (!anyInView && offTarget) _renderScrollHint((offTarget as { dir: 'up' | 'down' }).dir, (offTarget as { el: HTMLElement }).el);
        else _renderScrollHint(null, null);
    }, 150);
}

/** Floating "scroll up/down" cue shown when the highlighted target is out of view.
 *  Clicking it scrolls the target into view. Pass (null, null) to remove it. */
function _renderScrollHint(dir: 'up' | 'down' | null, target: HTMLElement | null): void {
    const existing = document.getElementById('tut-scroll-hint');
    if (!dir || !target) { existing?.remove(); return; }
    const color = _tutorial?.color ?? 'var(--accent)';
    let hint = existing;
    if (!hint) {
        hint = document.createElement('button');
        hint.id = 'tut-scroll-hint';
        hint.className = 'tut-scroll-hint';
        document.body.appendChild(hint);
    }
    hint.classList.toggle('is-up', dir === 'up');
    hint.classList.toggle('is-down', dir === 'down');
    hint.style.background = color;
    const arrow = dir === 'up'
        ? '<polyline points="18 15 12 9 6 15"/>'
        : '<polyline points="6 9 12 15 18 9"/>';
    hint.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${arrow}</svg><span>${dir === 'up' ? t('tut.scroll.up') : t('tut.scroll.down')}</span>`;
    (hint as any).onclick = () => target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Rect of the nearest scrollable ancestor (to clip highlights to the scroll area). */
function _scrollClipRect(el: HTMLElement): DOMRect | null {
    let p = el.parentElement;
    while (p && p !== document.body) {
        const cs = window.getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) || /(auto|scroll)/.test(cs.overflow)) {
            return p.getBoundingClientRect();
        }
        p = p.parentElement;
    }
    return null;
}
