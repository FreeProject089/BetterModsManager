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

import { resolveTargets, isBareName } from './tutorial-target.js';
import { t } from '../core/i18n.js';
import { escAttr } from '../core/utils.js';
import { claimDockSpace, releaseDockSpace } from './dock-space.js';
import { reveal, coverAt, closeDialog, isShown, type Where } from './tutorial-reveal.js';
import { invoke } from '../core/api.js';
import { onBmmAction } from './tutorial-events.js';
import {
    savePosition, markStepComplete, markStepPartial, getStepStatus,
} from './tutorial-store.js';
import type { TutorialDef, TutorialPart, TutorialStep } from './tutorial-types.js';
import { uiIcon, type IconName } from './icons.js';
import { popoutButtonHtml, wirePopout, closeWindow, isPoppedOut, type PopoutSpec } from './popout.js';

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
    // The same glyph the sidebar item wears (index.html .nav-icon), so a hint points at what you see.
    profiles:  uiIcon('user', 12),
    library:   uiIcon('library', 12),
    mapper:    uiIcon('layers', 12),
    modpacks:  uiIcon('folders', 12),
    modlists:  uiIcon('clipboard-list', 12),
    repo:      uiIcon('database', 12),
    apps:      uiIcon('grid', 12),
    plugins:   uiIcon('box', 12),
    settings:  uiIcon('settings', 12),
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

// ── The guide window ─────────────────────────────────────────────────────────
//
// The coach used to be a dock that overlaid the app: a third of the window that a step's
// target could sit under, with a pill saying « hidden behind a panel » and no way out. It
// is now a window of its own inside the app — floating by default, dockable to the left,
// the right or the bottom edge, draggable by its title bar (drop it on an edge to dock it),
// minimisable — and it stays out of its target's way: when a step's control ends up under
// it, the window moves, not the reader. Where it was put is remembered; where it was moved
// to dodge a target is not, so the next lesson opens where the reader left it.
//
// The guide's logic never leaves this window: it drives this window's DOM (rings, tabs,
// dialogs) and reads it ten times a second. It can still be SHOWN in an OS window of its
// own, like the theme editor (« Pop out » in its title bar, or drag the title bar past the
// edge of BMM's window): ui/popout.ts hides the panel here and mirrors it there, and the
// clicks (next, back, skip, a step in the list, a part chip) and ←/→ come back and run on
// the real panel. The rings and the dimming stay in BMM's window, where the targets are.
// « Back to BMM » (or closing that window) puts the guide back where the reader had it.
type GuideMode = 'float' | 'left' | 'right' | 'bottom';
const POPOUT_ID = 'tutorial-guide';
/** The guide is shown in its own OS window: nothing here places it, docks it or dodges. */
let _poppedOut = false;
const TUT_POPOUT: PopoutSpec = {
    id: POPOUT_ID,
    title: () => (_tutorial ? `${t('tut.win.title')} · ${t(_tutorial.title_key)}` : t('tut.win.title')),
    panel: () => document.getElementById('tut-engine-panel'),
    isOpen: () => {
        const p = document.getElementById('tut-engine-panel');
        return !!_tutorial && !!p && !p.classList.contains('closing');
    },
    prepare: () => {
        if (_isMinimized) _restore();
        _poppedOut = true;
        _dodge = null;
        _setDockReserved(true); // with _poppedOut set: gives the app its space back
    },
    restored: () => {
        _poppedOut = false;
        const p = document.getElementById('tut-engine-panel');
        if (_ending || !_tutorial || !p || p.classList.contains('closing')) return;
        if (_isMinimized) _renderMinimizedPill();
        else _setDockReserved(true);
    },
    close: () => closeTutorialEngine(),
    dragOut: () => !_isMinimized,
};
/** Set while the lesson itself ends, so the pop-out's « restored » does not place a guide
 *  that is about to go. */
let _ending = false;
/** The lesson ends: its OS window goes with it, at once (the pop-out's watchdog would
 *  notice too, a moment later). */
function _closePopout(): void {
    if (!_poppedOut && !isPoppedOut(POPOUT_ID)) return;
    _ending = true;
    try { closeWindow(POPOUT_ID); } finally { _ending = false; _poppedOut = false; }
}
const MODE_KEY = 'bmm.tutorial.guideMode';
const POS_KEY = 'bmm.tutorial.guidePos';
const FLOAT_SIZE_KEY = 'bmm.tutorial.guideSize';
const STEPS_OPEN_KEY = 'bmm.tutorial.stepsOpen';
/** Where the window went to stay off a target. Cleared when the reader moves it themselves. */
let _dodge: { mode: GuideMode; x?: number; y?: number } | null = null;
let _lastDodgeAt = 0;
/** What the target-finding at step start could not fix; shown in the window until the step changes. */
let _revealWhere: Where | null = null;
/** Key of the status line currently drawn, so the 150ms tracker only repaints on change. */
let _whereKey = '';

// ── Tutorial demo data (ephemeral example profile + mods) ──────────────────
let _demoCreated = false;
let _demoPrevActive: string | null = null;
// Tutorials whose steps demonstrate mod/profile features and benefit from a
// concrete example when the user has no real data yet.
//
// 'quick' is absent ON PURPOSE, not by omission: the five-minute tour asks for no
// actions and touches no data, so it needs no sandbox — and creating the 🎓 profile
// would make a two-minute look-around mutate the profile list, which is exactly the
// impression a tour must not give. Do not "fix" this by adding it.
const DEMO_TUTORIALS = new Set(['basics', 'advanced', 'other', 'order']);

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
    _registerNavHint();
}

/** End the lesson. `reopenHub` decides what the user sees next:
 *
 *  true  — the hub comes back. That is what "Back to Hub" means, and only that button.
 *  false — everything goes away. This is what the X means: a user closing a tutorial is
 *          saying "stop teaching me", and answering with ANOTHER overlay is the panel
 *          refusing to be dismissed. The X used to do exactly that, because every close
 *          path shared this function and it always fired the reopen callback. */
export function closeTutorialEngine(reopenHub: boolean = false): void {
    _closePopout();
    _unregisterKeyboard();
    _unregisterNavHint();
    _unregisterLangListener();
    _cleanup();
    _cleanupDemo();
    _isMinimized = false;
    const panel = document.getElementById('tut-engine-panel');
    if (panel) {
        // The closing window gives up the id at once: a lesson started during its fade-out
        // (hub → another tutorial) gets a window of its own instead of reusing this one and
        // losing it when the fade ends. The release below only runs if no new window opened.
        panel.id = 'tut-engine-panel-closing';
        const release = () => { if (!document.getElementById('tut-engine-panel')) _setDockReserved(false); };
        if (_panelLeft !== null) {
            panel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            panel.style.opacity    = '0';
            panel.style.transform  = 'scale(0.96)';
            setTimeout(() => { panel.remove(); release(); _panelLeft = null; _panelTop = null; }, 220);
        } else {
            panel.classList.add('closing');
            // Was missing: this is the NORMAL docked close, and it never released the
            // reservation — the app stayed squeezed against a dock that no longer
            // existed. (The other branch always released; it is the rarer one.)
            panel.addEventListener('animationend', () => { panel.remove(); release(); }, { once: true });
            setTimeout(() => { panel.remove(); release(); }, 400);
        }
    }
    if (reopenHub && _onClose) _onClose();
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
    _stopFieldFlow();
    if (_modalPollInterval)        { clearInterval(_modalPollInterval);        _modalPollInterval        = null; }
    if (_highlightTrackerInterval) { clearInterval(_highlightTrackerInterval); _highlightTrackerInterval = null; }
    document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
    document.getElementById('tut-hl-layer')?.remove();
    document.getElementById('tut-ghost-cursor')?.remove();
    // The caption is a SIBLING of the ghost on <body>, not a child, so removing the
    // ghost never took it. Only the normal-completion path removed both, which is why
    // it survived minimise-then-close and sat over the app with no tutorial behind it.
    document.getElementById('tut-ghost-caption')?.remove();
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
    const el = resolveTargets(step.modal_selector)[0] || null;
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
        panel.className = 'tut-engine-panel tgw';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-label', t('tut.win.title'));
        document.getElementById('app-window-outer')?.appendChild(panel);
        // A floating window grows after it is placed (the typewriter, the step list, the
        // status line): keep its bottom edge inside the app instead of letting it run off.
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => _keepFloatInside(panel)).observe(panel);
        }
    }
}

/** Pull a floating window back inside the app after it changed size. Not while dragging. */
function _keepFloatInside(panel: HTMLElement): void {
    if (_isDragging || _poppedOut || panel.classList.contains('minimized') || !panel.classList.contains('tgw-float')) return;
    const x = parseFloat(panel.style.left);
    const y = parseFloat(panel.style.top);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = _clampFloat(panel, x, y);
    if (p.x !== Math.round(x)) panel.style.left = `${p.x}px`;
    if (p.y !== Math.round(y)) panel.style.top = `${p.y}px`;
}

/** The reader's choice of placement. The old dock-side key is read once so a reader who had
 *  docked the coach left keeps it there. */
function _chosenMode(): GuideMode {
    let v: string | null = null;
    try { v = localStorage.getItem(MODE_KEY) || localStorage.getItem('bmm.tutorial.dockSide'); } catch { /* storage off */ }
    return v === 'left' || v === 'right' || v === 'bottom' || v === 'float' ? v : 'float';
}

/** Where the window is right now: the dodge, when one is in force, else the choice. */
function _mode(): GuideMode {
    return _dodge?.mode ?? _chosenMode();
}

function _setMode(mode: GuideMode): void {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* pref only */ }
    _dodge = null;
    _setDockReserved(true);
}

const _readJson = <T,>(key: string): T | null => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; } catch { return null; }
};
const _writeJson = (key: string, v: unknown): void => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* pref only */ }
};

const _hostRect = (panel: HTMLElement): DOMRect =>
    (panel.parentElement || document.body).getBoundingClientRect();

/** Keep a floating window inside the app window, with a margin, whatever was stored. */
function _clampFloat(panel: HTMLElement, x: number, y: number): { x: number; y: number } {
    const host = _hostRect(panel);
    const w = panel.offsetWidth || 380;
    const h = panel.offsetHeight || 260;
    return {
        x: Math.round(Math.max(8, Math.min(x, host.width - w - 8))),
        y: Math.round(Math.max(8, Math.min(y, host.height - h - 8))),
    };
}

/** The grips for the current placement: the inner edge of a dock, the corner of a window. */
function _plantGrips(panel: HTMLElement): void {
    panel.querySelectorAll('.tgw-grip').forEach((g) => g.remove());
    if (panel.classList.contains('minimized')) return;
    const mode = _mode();
    const grip = document.createElement('div');
    grip.className = `tgw-grip tgw-grip-${mode}`;
    grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const start = { x: e.clientX, y: e.clientY, w: panel.offsetWidth, h: panel.offsetHeight };
        const host = _hostRect(panel);
        grip.classList.add('dragging');
        let frame = 0;
        let last = { x: e.clientX, y: e.clientY };
        const paint = () => {
            frame = 0;
            const dx = last.x - start.x;
            const dy = last.y - start.y;
            if (mode === 'left' || mode === 'right') {
                const w = Math.max(300, Math.min(start.w + (mode === 'right' ? -dx : dx), host.width * 0.6));
                document.body.style.setProperty('--tut-dock-w', `${Math.round(w)}px`);
            } else if (mode === 'bottom') {
                const h = Math.max(160, Math.min(start.h - dy, host.height * 0.7));
                document.body.style.setProperty('--tut-dock-h', `${Math.round(h)}px`);
            } else {
                panel.style.width = `${Math.round(Math.max(300, Math.min(start.w + dx, host.width - 16)))}px`;
                panel.style.height = `${Math.round(Math.max(200, Math.min(start.h + dy, host.height - 16)))}px`;
            }
        };
        const move = (me: MouseEvent) => { last = { x: me.clientX, y: me.clientY }; if (!frame) frame = requestAnimationFrame(paint); };
        const up = () => {
            grip.classList.remove('dragging');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            if (frame) { cancelAnimationFrame(frame); paint(); }
            try {
                if (mode === 'left' || mode === 'right') localStorage.setItem('bmm.tutorial.dockW', String(panel.offsetWidth));
                else if (mode === 'bottom') localStorage.setItem('bmm.tutorial.dockH', String(panel.offsetHeight));
                else _writeJson(FLOAT_SIZE_KEY, { w: panel.offsetWidth, h: panel.offsetHeight });
            } catch { /* pref only */ }
            if (mode === 'right') claimDockSpace('tutorial', panel.offsetWidth);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
    panel.appendChild(grip);
}

/** Drag the window by its title bar. A docked window comes off its edge as soon as it moves;
 *  dropping it near an edge docks it there (a preview shows which), anywhere else it floats. */
function _makeWindowDraggable(handle: HTMLElement, panel: HTMLElement): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0 || panel.classList.contains('minimized')) return;
        if ((e.target as HTMLElement).closest('button, select, input, a, .tut-chips-scroller, .tgw-menu')) return;
        const host = _hostRect(panel);
        const r0 = panel.getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        let moved = false;
        let snap: GuideMode = 'float';
        let preview: HTMLElement | null = null;
        let pos = { x: r0.left - host.left, y: r0.top - host.top };
        const grabDX = startX - r0.left;
        const grabDY = startY - r0.top;
        const edge = 28;
        const onMove = (me: MouseEvent) => {
            if (!moved) {
                if (Math.abs(me.clientX - startX) + Math.abs(me.clientY - startY) < 6) return;
                moved = true;
                _isDragging = true;
                // Off the edge: a docked column becomes a window of a sensible width, under
                // the pointer where it was grabbed.
                if (_mode() !== 'float') {
                    _dodge = { mode: 'float' };
                    _setDockReserved(true);
                }
                panel.classList.add('dragging');
            }
            const w = panel.offsetWidth;
            pos = _clampFloat(panel, me.clientX - host.left - Math.min(grabDX, w - 40), me.clientY - host.top - Math.min(grabDY, 30));
            panel.style.left = `${pos.x}px`;
            panel.style.top = `${pos.y}px`;
            snap = me.clientX - host.left < edge ? 'left'
                : host.right - me.clientX < edge ? 'right'
                : host.bottom - me.clientY < edge ? 'bottom'
                : 'float';
            if (snap !== 'float') {
                if (!preview) {
                    preview = document.createElement('div');
                    preview.className = 'tgw-snap';
                    panel.parentElement?.appendChild(preview);
                }
                preview.dataset.edge = snap;
            } else if (preview) { preview.remove(); preview = null; }
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            preview?.remove();
            if (!moved) return;
            _isDragging = false;
            panel.classList.remove('dragging');
            // Let go outside BMM's window: the guide popped out (ui/popout.ts watches the
            // same drag). The edge it crossed on the way is not a dock the reader chose.
            if (_poppedOut) { _dodge = null; return; }
            if (snap !== 'float') { _setMode(snap); return; }
            _writeJson(POS_KEY, pos);
            _setMode('float');
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
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

// ── Live nav hint ────────────────────────────────────────────────────────────
//
// The "You're on / Go to" chip used to be computed once, when the step rendered. Wander
// off to another view mid-step and it kept asserting you were on the right page — stale
// precisely when a lost user needs it to say the way back. One delegated listener while a
// lesson runs; any .nav-item click re-evaluates the chip after the active class flips.
let _navHintListener: ((e: MouseEvent) => void) | null = null;

function _registerNavHint(): void {
    _unregisterNavHint();
    _navHintListener = (e: MouseEvent) => {
        if (!(e.target as HTMLElement)?.closest?.('.nav-item')) return;
        setTimeout(_refreshNavHint, 0); // after the click has moved .active
    };
    document.addEventListener('click', _navHintListener);
}

function _unregisterNavHint(): void {
    if (_navHintListener) { document.removeEventListener('click', _navHintListener); _navHintListener = null; }
}

function _refreshNavHint(): void {
    const btn = document.getElementById('btn-tut-nav-hint') as HTMLElement | null;
    if (!btn || !_tutorial) return;
    const nav = btn.dataset.nav || '';
    if (!nav || !NAV_LABELS[nav]) return;
    const viewKey = _VIEW_ALIAS[nav] ?? nav;
    const active = (document.querySelector('.nav-item.active') as HTMLElement | null)?.dataset.view;
    const onPage = active === viewKey;
    const check = `${uiIcon('check', 12, { style: 'opacity:0.85' })}`;
    const chev  = `${uiIcon('chevron-right', 12, { style: 'margin-left:2px;opacity:0.5' })}`;
    btn.classList.toggle('on-page', onPage);
    btn.style.cursor = onPage ? 'default' : 'pointer';
    btn.setAttribute('data-tooltip', onPage ? (t('hub.alreadyHere') || 'You are already here') : t('hub.goTo') + ' ' + t(NAV_LABELS[nav]));
    btn.innerHTML = `
        ${onPage ? check : (NAV_ICONS[nav] || '')}
        <span class="tut-nav-hint-label">${onPage ? (t('hub.youreOn') || "You're on") : t('hub.goTo')}</span>
        <strong class="tut-nav-hint-page">${t(NAV_LABELS[nav])}</strong>
        ${onPage ? '' : chev}`;
}

// ── Drag ─────────────────────────────────────────────────────────────────────

function _makeDraggable(handle: HTMLElement, panel: HTMLElement): void {
    // Only the MINIMISED pill drags. The expanded card is a dock the app reflows around:
    // dragging it would leave a reserved band of empty space with the guidance floating
    // somewhere else. The pill reserves nothing — it floats over the app precisely so it
    // can be put wherever it is least in the way, which only its owner knows.
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if (!panel.classList.contains('minimized')) return;
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
    // In its own window the guide minimises with that window's button; a pill inside it
    // would only be a smaller window.
    if (_poppedOut) return;
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
    panel.classList.add('minimized', 'pill-float');
    // The pill reserves nothing — the app takes its space back while you work, and the
    // pill floats above it, draggable anywhere.
    _setDockReserved(false);
    panel.querySelectorAll('.tgw-grip').forEach((g) => g.remove());
    panel.style.width = '';
    panel.style.height = '';
    // The window's float position is not the pill's: the pill starts in its corner.
    panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = '';
    _applyDragPosition(panel); // back where you last dragged it, if you did

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
                ${uiIcon('chevron-up', 12)}
            </button>
            <button class="tut-x-btn" id="btn-tut-close-min" data-tooltip="${t('hub.close')}">
                ${uiIcon('close', 12)}
            </button>
        </div>
    `;

    const pill = panel.querySelector('.tut-min-pill') as HTMLElement | null;
    if (pill) _makeDraggable(pill, panel);
    document.getElementById('btn-tut-restore')?.addEventListener('click', () => _restore());
    document.getElementById('btn-tut-close-min')?.addEventListener('click', () => closeTutorialEngine());
}

// ── Render ───────────────────────────────────────────────────────────────────

function _renderStep(): void {
    _cleanup();

    const tut   = _tutorial!;
    const part  = _currentPart();
    const step  = _currentStep();
    const panel = document.getElementById('tut-engine-panel')!;

    // Back from the pill: the window's own placement (applied after the markup below, by
    // _setDockReserved) replaces wherever the pill was dropped.
    panel.classList.remove('minimized', 'pill-float');

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
            ${isDone ? (uiIcon('check', 12)) : ''}
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
                <button type="button" class="tut-field-row" data-field-sel="${f.sel}" data-field-key="${f.key}"${(f as any).open ? ` data-field-open="${escAttr((f as any).open)}"` : ''} data-tooltip="${t('tut.fieldGo') || 'Show me this field'}">
                    <span class="tut-field-num" style="background:${tut.color}">${i + 1}</span>
                    <span class="tut-field-desc">${t(f.key)}</span>
                </button>`).join('')}
        </div>
    ` : '';

    /* ── Nav hint (clickable). If already on the page, say so instead of "Go to". ── */
    const _navViewKey = step.nav ? (_VIEW_ALIAS[step.nav] ?? step.nav) : '';
    const _activeView = (document.querySelector('.nav-item.active') as HTMLElement | null)?.dataset.view;
    const _onPage = !!step.nav && _activeView === _navViewKey;
    const _checkSvg = `${uiIcon('check', 12, { style: 'opacity:0.85' })}`;
    const _chevSvg = `${uiIcon('chevron-right', 12, { style: 'margin-left:2px;opacity:0.5' })}`;
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

    /* ── Step list: every step of this part, where you are, what is done ── */
    let stepsOpen = false;
    try { stepsOpen = localStorage.getItem(STEPS_OPEN_KEY) === '1'; } catch { /* pref only */ }
    const stepRows = part.steps.map((s, i) => {
        const st = getStepStatus(tut.id, part.id, s.id).state;
        const cur = i === _stepIndex;
        return `<li><button type="button" class="tgw-step${cur ? ' is-current' : ''} is-${st}" data-si="${i}"${cur ? ' aria-current="step"' : ''}>
            <span class="tgw-step-dot">${st === 'complete' ? uiIcon('check', 12) : String(i + 1)}</span>
            <span class="tgw-step-name">${t(s.title_key)}</span>
        </button></li>`;
    }).join('');

    /* ── Placement menu: the four places the window can live ── */
    const mode = _chosenMode();
    const modeIcon = (m: GuideMode) => m === 'float' ? uiIcon('layers', 14)
        : uiIcon('panel-right', 14, { cls: `tgw-ico-${m}` });
    const modeItems = (['float', 'left', 'right', 'bottom'] as GuideMode[]).map((m) => `
        <button type="button" class="tgw-menu-item" role="menuitemradio" aria-checked="${m === mode}" data-mode="${m}">
            ${modeIcon(m)}<span>${t(`tut.win.${m}`)}</span>${m === mode ? `<span class="tgw-menu-check">${uiIcon('check', 12)}</span>` : ''}
        </button>`).join('');

    panel.innerHTML = `
        <div class="tut-card-topbar tgw-titlebar">
            <span class="tgw-grip-ico" data-popout-hide data-tooltip="${escAttr(t('tut.win.drag'))}">${uiIcon('grip', 14)}</span>
            <button class="tut-back-hub-btn" id="btn-tut-back-hub">
                ${uiIcon('chevron-left', 12)}
                ${t('hub.back')}
            </button>

            <div class="tut-chips-scroller">
                <div class="tut-part-chips-wrap">${partChips}</div>
            </div>

            <div class="tut-topbar-right">
                ${popoutButtonHtml('tut-min-btn', POPOUT_ID)}
                <button class="tut-min-btn" id="btn-tut-mode" data-popout-hide aria-haspopup="menu" aria-expanded="false" data-tooltip="${escAttr(t('tut.win.mode'))}" aria-label="${escAttr(t('tut.win.mode'))}">
                    ${modeIcon(mode)}
                </button>
                <button class="tut-min-btn" id="btn-tut-minimize" data-popout-hide data-tooltip="${escAttr(t('common.minimize'))}" aria-label="${escAttr(t('common.minimize'))}">
                    ${uiIcon('remove', 12)}
                </button>
                <button class="tut-x-btn" id="btn-tut-close" data-popout-hide data-tooltip="${escAttr(t('hub.close'))}" aria-label="${escAttr(t('hub.close'))}">
                    ${uiIcon('close', 12)}
                </button>
            </div>
            <div class="tgw-menu" id="tut-mode-menu" role="menu" hidden>${modeItems}</div>
        </div>

        <div class="tut-card-body tut-body-enter">
            <div class="tut-step-header">
                <div class="tut-avatar" style="color:${tut.color}">
                    ${step.icon || tut.icon || ''}
                </div>
                <div class="tut-header-text">
                    <div class="tut-header-meta">
                        <span class="tut-tutorial-label" style="color:${tut.color}">${t(tut.title_key)}</span>
                        <button type="button" class="tut-step-ctr tgw-steps-btn" id="btn-tut-steps" aria-expanded="${stepsOpen}" aria-controls="tut-steps" data-tooltip="${escAttr(t('tut.steps.toggle'))}">
                            ${uiIcon('list', 12)}<span>${_stepIndex + 1}/${_totalSteps()}</span>${uiIcon(stepsOpen ? 'chevron-up' : 'chevron-down', 12)}
                        </button>
                    </div>
                    <h3 class="tut-step-title">
                        ${step.icon ? `<span class="tut-step-icon">${step.icon}</span>` : ''}
                        ${t(step.title_key)}
                    </h3>
                </div>
            </div>

            <ol class="tgw-steps" id="tut-steps" aria-label="${escAttr(t('tut.steps.title'))}"${stepsOpen ? '' : ' hidden'}>${stepRows}</ol>

            ${navHintHtml ? `<div class="tut-nav-hint-row">${navHintHtml}</div>` : ''}

            <div class="tgw-where" id="tut-where" role="status" aria-live="polite" hidden></div>

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
                    <span class="tut-kbd-hint" data-tooltip="${escAttr(t('tut.kbdHint'))}"><kbd>←</kbd><kbd>→</kbd><kbd>M</kbd></span>
                </div>
            </div>
            <div class="tut-footer-btns">
                <div class="tgw-foot-left">
                    ${!isFirst ? `<button class="tut-prev-btn" id="btn-tut-prev">← ${t('hub.prev')}</button>` : ''}
                    ${hasTarget ? `<button class="tut-showme-btn" id="btn-tut-showme" data-tooltip="${escAttr(t('tut.showMe.tip'))}">${uiIcon('eye', 14)}${t('tut.showMe')}</button>` : ''}
                </div>
                <div class="tgw-foot-right">
                    <button class="tut-skip-all-btn" id="btn-tut-skip-all" data-tooltip="${escAttr(t('tut.skip.title'))}">${t('tut.skip')}</button>
                    <button class="tut-next-btn" id="btn-tut-next" ${(step.action && step.advance !== 'next') ? 'disabled' : ''} style="background:${tut.color};border-color:${tut.color}">${nextLabel}</button>
                </div>
            </div>
        </div>
    `;
    _setDockReserved(true);
    _whereKey = '';
    _revealWhere = null;

    /* ── Find the target, make it visible if that is safe, then light it (delayed — wait
       for nav/view to settle) ── */
    const _snapPart = _partIndex;
    const _snapStep = _stepIndex;
    setTimeout(() => {
        if (!document.getElementById('tut-engine-panel')) return;
        if (_partIndex !== _snapPart || _stepIndex !== _snapStep) return;
        void _revealAndHighlight(false);
        if (step.modal_selector) _startModalPoll(step.modal_selector, step.modal_fields);
    }, 300);

    /* ── Typewriter ── */
    _startTypewriter(t(step.text_key));

    /* ── The title bar moves the window ── */
    const topbar = panel.querySelector('.tut-card-topbar') as HTMLElement | null;
    if (topbar) _makeWindowDraggable(topbar, panel);
    // « Pop out » and « drag the title bar out of BMM's window » (ui/popout.ts).
    wirePopout(TUT_POPOUT, panel, topbar);

    /* ── Placement menu ── */
    const modeBtn = document.getElementById('btn-tut-mode');
    const menu = document.getElementById('tut-mode-menu');
    const closeMenu = () => {
        if (menu) menu.hidden = true;
        modeBtn?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', outside, true);
    };
    const outside = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('#tut-mode-menu, #btn-tut-mode')) closeMenu();
    };
    modeBtn?.addEventListener('click', () => {
        if (!menu) return;
        const open = menu.hidden;
        menu.hidden = !open;
        modeBtn.setAttribute('aria-expanded', String(open));
        if (open) {
            document.addEventListener('mousedown', outside, true);
            (menu.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
        } else closeMenu();
    });
    menu?.querySelectorAll<HTMLElement>('.tgw-menu-item').forEach((item) => {
        item.addEventListener('click', () => {
            closeMenu();
            _setMode(item.dataset.mode as GuideMode);
            _renderStep();
        });
    });
    menu?.addEventListener('keydown', (e: KeyboardEvent) => {
        const items = Array.from(menu.querySelectorAll<HTMLElement>('.tgw-menu-item'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); modeBtn?.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    });

    /* ── Step list ── */
    document.getElementById('btn-tut-steps')?.addEventListener('click', () => {
        const list = document.getElementById('tut-steps');
        if (!list) return;
        list.hidden = !list.hidden;
        try { localStorage.setItem(STEPS_OPEN_KEY, list.hidden ? '0' : '1'); } catch { /* pref only */ }
        const b = document.getElementById('btn-tut-steps');
        b?.setAttribute('aria-expanded', String(!list.hidden));
        const chev = b?.querySelector('svg:last-child');
        if (chev) chev.outerHTML = uiIcon(list.hidden ? 'chevron-down' : 'chevron-up', 12);
    });
    panel.querySelectorAll<HTMLElement>('.tgw-step').forEach((row) => {
        row.addEventListener('click', () => {
            const si = parseInt(row.dataset.si || '', 10);
            if (!Number.isFinite(si) || si === _stepIndex) return;
            _cleanup();
            _stepIndex = si;
            _renderStep();
        });
    });

    /* ── Button listeners ── */
    document.getElementById('btn-tut-back-hub')?.addEventListener('click', () => { _cleanup(); closeTutorialEngine(true); });
    document.getElementById('btn-tut-close')?.addEventListener('click', () => closeTutorialEngine());
    document.getElementById('btn-tut-minimize')?.addEventListener('click', () => _minimize());
    document.getElementById('btn-tut-prev')?.addEventListener('click', _prevStep);
    document.getElementById('btn-tut-next')?.addEventListener('click', _nextStep);

    /* ── Field rows point at their element ──────────────────────────────────────
       Field feedback: "si tu cliques, qu'il y ait une explication" — the numbered list
       described fields it never touched. A row now walks you to its element (same
       resolution as the rings, so they cannot disagree), pulses it, and has Tasky say
       the explanation AT the element — the words and the thing they describe in the
       same glance, instead of a legend on one side and anonymous rings on the other. */
    panel.querySelectorAll<HTMLElement>('.tut-field-row').forEach((row) => {
        row.addEventListener('click', () => {
            const sel = row.dataset.fieldSel || '';
            // Same resolution as the rings (_resolveFieldEl) — a second copy is how
            // a row flashes one element while the spotlight highlights another.
            let target = _resolveFieldEl(sel);
            if (!target) return;

            // The field may live behind a control the user has not pressed yet. When
            // the step data names that control (data-field-open), press it and
            // re-resolve — "show me this field" should get you to the field, not to a
            // description of where it would be.
            if (!_isOnScreen(target)) {
                const opener = row.dataset.fieldOpen
                    ? document.querySelector(row.dataset.fieldOpen) as HTMLElement | null
                    : null;
                if (opener) {
                    opener.click();
                    target = _resolveFieldEl(sel) || target;
                }
            }

            // Still not on screen: stop here. Highlighting an element with no box is
            // exactly what produced the stray ring and the badge floating over the
            // middle of the app — a wrong answer that looks like a broken app. Say
            // where it is instead.
            if (!_isOnScreen(target)) {
                const host = _closedHost(target);
                const where = host?.querySelector('.modal-title, h2, h3')?.textContent?.trim();
                (window as any).showTaskyHelp?.(
                    where
                        ? (t('tut.fieldHiddenIn') || 'That field is in \u201c{where}\u201d \u2014 open it first.').replace('{where}', where)
                        : (t('tut.fieldHidden') || 'That field is not on screen right now.'),
                    'info', true);
                return;
            }

            (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('tut-field-flash');
            setTimeout(() => target?.classList.remove('tut-field-flash'), 1600);
            // NOT isLiteral: fieldKey is an i18n key ('tut.basics.profiles.f.name'),
            // and the literal path prints its argument verbatim — the bubble showed
            // the raw key instead of the sentence.
            const key = row.dataset.fieldKey;
            if (key) (window as any).showTaskyHelp?.(key, 'info');
            // In a running flow, clicking a row moves the flow there — the list is
            // a table of contents, not just a legend.
            if (_fieldFlow) {
                const rows = Array.from(document.querySelectorAll('.tut-field-row'));
                const idx = rows.indexOf(row);
                if (idx >= 0) { _fieldFlowUnwire(); _fieldFlow.i = idx; _fieldFlowRender(); }
            }
        });
    });

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
    // The SCROLLER, not the wrap. This whole block was bound to
    // .tut-part-chips-wrap — the inner element, which is `width: max-content` and
    // therefore never has any overflow of its own. It IS the overflow; its parent is
    // what scrolls. Every scrollLeft write below was landing on an element whose
    // scrollWidth equals its clientWidth, so it silently did nothing, and with
    // `scrollbar-width: none` hiding the bar there was no other way to move the row:
    // a vertical wheel does not scroll an overflow-x container on its own. The markup
    // gained the wrapper at some point and the wiring stayed on the old node.
    const chipsWrap = (panel.querySelector('.tut-chips-scroller')
        || panel.querySelector('.tut-part-chips-wrap')) as HTMLElement | null;
    if (chipsWrap) {
        // Scroll active chip into view
        const activeChip = chipsWrap.querySelector('.tut-part-chip.active') as HTMLElement | null;
        if (activeChip) {
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
            // Only claim the wheel when the row actually overflows. Preventing default
            // unconditionally swallowed the scroll of whatever is behind a row that
            // already fits — the user's wheel would simply stop working over it.
            if (chipsWrap.scrollWidth <= chipsWrap.clientWidth) return;
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
                    ${uiIcon('check', 18, { style: 'color:var(--success)' })}
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
    _closePopout();
    _cleanup();
    _cleanupDemo();
    _unregisterLangListener();
    // Was missing: the ←/→ handler stayed registered after skipping, still driving the
    // dead lesson's state from anywhere in the app.
    _unregisterKeyboard();
    _unregisterNavHint();
    _isMinimized = false;
    const panel = document.getElementById('tut-engine-panel');
    if (panel) {
        panel.classList.add('closing');
        const gone = () => { if (!panel.isConnected) return; _setDockReserved(false); panel.remove(); _panelLeft = null; _panelTop = null; };
        panel.addEventListener('animationend', gone, { once: true });
        // No animation runs on a panel that was not drawn (Reduce animations, a hidden
        // panel): it still has to go.
        setTimeout(gone, 400);
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

/** Resolve a step's `goto` target to concrete part/step indices, or null if it names a
 *  step that does not exist (caller then falls back to the linear next, so a bad target
 *  can never strand the reader). A bare string is a step id in the current part. */
function _resolveGoto(goto: string | { part?: string; step: string }): { pIdx: number; sIdx: number } | null {
    const stepId = typeof goto === 'string' ? goto : goto.step;
    const partId = typeof goto === 'string' ? undefined : goto.part;
    const pIdx = partId ? _tutorial!.parts.findIndex(p => p.id === partId) : _partIndex;
    if (pIdx < 0) return null;
    const sIdx = _tutorial!.parts[pIdx].steps.findIndex(s => s.id === stepId);
    if (sIdx < 0) return null;
    return { pIdx, sIdx };
}

function _advanceStep(step: TutorialStep): void {
    if (!step.action) markStepComplete(_tutorial!.id, _currentPart().id, step.id);
    _cleanup();

    // An explicit jump wins over the linear order — the "go to a specific step" choice.
    if (step.goto) {
        const j = _resolveGoto(step.goto);
        if (j) { _partIndex = j.pIdx; _stepIndex = j.sIdx; _renderStep(); return; }
        // Unknown target: fall through to the linear next rather than getting stuck.
    }

    if (_stepIndex < _totalSteps() - 1)                { _stepIndex++; }
    else if (_partIndex < _tutorial!.parts.length - 1) { _partIndex++; _stepIndex = 0; }
    else                                               { _finishTutorial(); return; }
    _renderStep();
}

/** True if the step's modal is open AND the user has typed/picked something in it. */
function _isModalDirty(step: TutorialStep | undefined): boolean {
    if (!step?.modal_selector) return false;
    const el = resolveTargets(step.modal_selector)[0] || null;
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
            <div class="tut-unsaved-icon">${uiIcon('warning', 24, { style: 'color:var(--bmm-warning)' })}</div>
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
    panel.classList.remove('minimized', 'pill-float');

    panel.innerHTML = `
        <div class="tut-finish-screen">
            <div class="tut-finish-glow" style="background:${tut.color}"></div>
            <div class="tut-finish-mascot tut-finish-check" style="color:${tut.color}">
                ${uiIcon('success', 48)}
            </div>
            <div class="tut-finish-text-col">
                <h2 class="tut-finish-title">${t('hub.done')}</h2>
                <p class="tut-finish-subtitle">${t(tut.title_key)}</p>
            </div>
            <button class="tut-next-btn" id="btn-tut-finish-hub" style="background:${tut.color};border-color:${tut.color}">${t('hub.back')}</button>
        </div>
    `;

    _setDockReserved(true);
    document.getElementById('btn-tut-finish-hub')?.addEventListener('click', () => {
        _cleanupDemo();
        panel.classList.add('closing');
        // Reopen the hub once the close animation ends — but never depend on `animationend`
        // alone. Under reduced-motion, a backgrounded tab, or any path where the `.closing`
        // keyframe doesn't actually run, that event never fires and the button did nothing
        // (the reported "Back to Hub doesn't work"). A one-shot guard + timeout fallback — the
        // same shape closeTutorialEngine() already uses — makes it fire exactly once, always.
        let done = false;
        const finish = () => {
            if (done) return; done = true;
            _setDockReserved(false); panel.remove(); _panelLeft = null; _panelTop = null;
            if (_onClose) _onClose();
        };
        panel.addEventListener('animationend', finish, { once: true });
        setTimeout(finish, 450);
    });
}


// ── Inline icons in step text ────────────────────────────────────────────────
//
// The tutorial used Unicode emoji for its tip / warning / done marks. Three problems
// with that, in order of how much they matter: the glyph is whatever the platform's
// font decides, so it does not match the app's own icon set and changes shape
// between machines; it cannot take a colour from the theme, so a warning stays
// yellow-on-anything including a light theme where it disappears; and an emoji in a
// dictionary is a character a translator can silently drop or duplicate without it
// looking wrong.
//
// So the strings carry a TOKEN and the engine draws the icon. Translators see
// `:warn:`, which is obviously not prose and obviously must survive; the drawing is
// one place, in the app's own stroke style, on currentColor.
const TUT_ICONS: Record<string, IconName> = {
    tip:   'lightbulb',
    warn:  'warning',
    ok:    'check',
    heart: 'heart',
};

/** Replace `:tip:` / `:warn:` / `:ok:` / `:heart:` with an inline icon. An unknown
 *  token is left exactly as written rather than swallowed — a typo in a translation
 *  should be visible, not silently erased. */
export function expandTutIcons(text: string): string {
    return String(text ?? '').replace(/:(tip|warn|ok|heart):/g, (_m, k: string) =>
        uiIcon(TUT_ICONS[k], 14, { cls: `tut-ico tut-ico-${k}` }));
}

function _startTypewriter(text: string): void {
    const el = document.getElementById('tut-typewriter');
    if (!el) return;
    text = expandTutIcons(text);

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

        const target = (resolveTargets(modalSelector)[0] || null);
        if (target && _isElementVisible(target as HTMLElement)) {
            clearInterval(_modalPollInterval!);
            _modalPollInterval = null;
            // Remove primary highlights, then highlight the modal target (and, if the
            // step declares them, every field to fill — numbered, no dim).
            document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
            if (fields && fields.length) {
                _startFieldFlow(fields);
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
/** A ring with no spotlight and no number badge: a step declared `dim: false`. */
let _outlineOnly = false;

/** Highlight + number every field in a guide (no dim, so the form stays readable). */
function _highlightFields(fields: { sel: string; key: string }[]): void {
    _suppressDim = true;
    fields.forEach((f, i) => _highlightElement(f.sel, i));
    _suppressDim = false;
}

// ── Sequential field flow ────────────────────────────────────────────────────
//
// Field feedback: a step per field (or eight anonymous rings at once) reads as a
// form, not a lesson. The flow guides ONE field at a time and advances ITSELF on
// the user's real input — type the name, the ring moves to the next field and the
// action box explains it. No Next-clicking through a form.
//
// Advance signals per field kind:
//   text/textarea  → change (blur/Enter) with a non-empty value
//   select/checkbox/radio/color → change
//   button / grid / anything else → click
//   read-only path fields (set programmatically by a picker) → 400ms value poll
let _fieldFlow: {
    fields: { sel: string; key: string }[];
    i: number;
    unsubs: (() => void)[];
    poll: ReturnType<typeof setInterval> | null;
} | null = null;

/** Is this element actually on screen right now?
 *
 *  A field that lives in a closed modal is still IN THE DOM — the modal is a
 *  `.modal-overlay` that simply lacks `.active`. getElementById finds it happily, and
 *  everything downstream then measured a zero-sized box: the spotlight ring drew
 *  itself over nothing and the numbered badge floated in the middle of the screen
 *  attached to no field. That is the reported bug, and it is a visibility question,
 *  not a selector question. */
function _isOnScreen(el: Element | null): boolean {
    if (!el) return false;
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // offsetParent is null for display:none subtrees; position:fixed also reports
    // null, hence the explicit exemption rather than a bare null check.
    const cs = getComputedStyle(el as HTMLElement);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if ((el as HTMLElement).offsetParent === null && cs.position !== 'fixed') return false;
    return true;
}

/** The closed container a field is stuck inside, if any. Used to say WHERE rather
 *  than to force it open: adding `.active` to an overlay would show a modal whose
 *  content its real opener never initialised, which is a worse bug than this one. */
function _closedHost(el: Element | null): HTMLElement | null {
    const host = el?.closest('.modal-overlay') as HTMLElement | null;
    return host && !host.classList.contains('active') ? host : null;
}

function _resolveFieldEl(sel: string): HTMLElement | null {
    // No `[id="…"]` fallback: getElementById already returns the first element with
    // that id, so when it is null the attribute selector cannot match either — and
    // an unescaped id containing a quote would make it throw.
    let target: Element | null = isBareName(sel) ? document.getElementById(sel) : null;
    if (!target) {
        const all = resolveTargets(sel);
        // Prefer a candidate that is actually rendered. Several screens reuse a
        // class name, and picking the copy inside a closed modal over the one the
        // user is looking at is how a ring ends up pointing at nothing.
        const shown = all.filter(_isOnScreen);
        target = _preferDemo(shown.length ? shown : all);
    }
    return (_resolveCustomSelect(target) ?? target) as HTMLElement | null;
}

function _stopFieldFlow(): void {
    if (!_fieldFlow) return;
    _fieldFlow.unsubs.forEach(u => { try { u(); } catch { /* detached */ } });
    if (_fieldFlow.poll) clearInterval(_fieldFlow.poll);
    _fieldFlow = null;
}

function _fieldFlowRender(): void {
    const flow = _fieldFlow;
    if (!flow) return;
    // Panel rows reflect the journey: done / current / todo.
    document.querySelectorAll<HTMLElement>('.tut-field-row').forEach((row, idx) => {
        row.classList.toggle('done', idx < flow.i);
        row.classList.toggle('current', idx === flow.i);
    });
    document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
    const f = flow.fields[flow.i];
    const desc = document.querySelector('#tut-action-box .tut-action-desc');
    if (!f) {
        // Every field visited. The step's own action event (profile-created…) still
        // decides completion; the box goes back to describing that final act.
        if (desc && _currentStepRef()?.action) desc.textContent = t(_currentStepRef()!.action!.desc_key);
        return;
    }
    // Skip a field that has no box on screen rather than ringing it. This is the
    // same fault as the clicked row: _highlightElement measures the element, and a
    // field inside a container the user has not opened measures zero — which drew
    // the ring and its numbered badge over the middle of the app, attached to
    // nothing. Advancing past it keeps the flow honest; stopping on it would strand
    // the user on a step they cannot complete.
    if (!_isOnScreen(_resolveFieldEl(f.sel))) {
        if (flow.i < flow.fields.length - 1) { flow.i++; _fieldFlowRender(); return; }
        if (desc) desc.textContent = t('tut.fieldHidden') || 'That field is not on screen right now.';
        return;
    }
    _suppressDim = true;
    _highlightElement(f.sel, 0);
    _suppressDim = false;
    // The ring's badge counts the journey, not always "1".
    const badge = document.querySelector('.tut-highlight div');
    if (badge) badge.textContent = String(flow.i + 1);
    if (desc) desc.textContent = `${flow.i + 1}/${flow.fields.length} — ${t(f.key)}`;
    _resolveFieldEl(f.sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    _fieldFlowWire(f);
}

/** Drop the current field's listeners and value-poll.
 *
 *  This MUST run before any re-wire. _fieldFlowWire overwrites flow.poll with a
 *  fresh interval, so re-rendering without unwiring orphaned the previous one
 *  beyond the reach of _stopFieldFlow — it polled a detached input for the rest
 *  of the session — and left stale change/Enter handlers that advanced the flow
 *  from a field the ring had already left. */
function _fieldFlowUnwire(): void {
    if (!_fieldFlow) return;
    _fieldFlow.unsubs.forEach(u => { try { u(); } catch { /* detached */ } });
    _fieldFlow.unsubs = [];
    if (_fieldFlow.poll) { clearInterval(_fieldFlow.poll); _fieldFlow.poll = null; }
}

function _fieldFlowAdvance(): void {
    if (!_fieldFlow) return;
    _fieldFlowUnwire();
    _fieldFlow.i++;
    _fieldFlowRender();
}

// <input type=button|submit|reset|image> looks like an INPUT but behaves like a
// button: it never fires change/input, so routing it to those listeners left the
// flow waiting forever on a field the user had already clicked.
const CLICKY_INPUTS = new Set(['button', 'submit', 'reset', 'image']);

function _fieldFlowWire(f: { sel: string; key: string }): void {
    const flow = _fieldFlow;
    if (!flow) return;
    const el = _resolveFieldEl(f.sel);
    if (!el) return;
    const on = (target: EventTarget, ev: string, h: (e: Event) => void) => {
        target.addEventListener(ev, h);
        flow.unsubs.push(() => target.removeEventListener(ev, h));
    };
    const tag = el.tagName;
    const isText = (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'color', 'file'].includes((el as HTMLInputElement).type)) || tag === 'TEXTAREA';
    if (isText) {
        const input = el as HTMLInputElement;
        on(el, 'change', () => { if (input.value.trim()) _fieldFlowAdvance(); });
        on(el, 'keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' && input.value.trim()) _fieldFlowAdvance(); });
        // Programmatic writes (folder pickers on readonly inputs) fire no events.
        let last = input.value;
        flow.poll = setInterval(() => {
            if (!input.isConnected) return;
            if (input.value !== last && input.value.trim()) _fieldFlowAdvance();
            last = input.value;
        }, 400);
    } else if (tag === 'SELECT' || (tag === 'INPUT' && !CLICKY_INPUTS.has((el as HTMLInputElement).type))) {
        on(el, 'change', () => _fieldFlowAdvance());
        on(el, 'input', () => _fieldFlowAdvance());
    } else {
        // Buttons, icon grids, colour swatches: the click IS the act. Advance after
        // it lands so the app's own handler runs first.
        on(el, 'click', () => setTimeout(_fieldFlowAdvance, 200));
    }
}

function _currentStepRef(): TutorialStep | null {
    try { return _currentPart().steps[_stepIndex] ?? null; } catch { return null; }
}

/** One field at a time, self-advancing. */
function _startFieldFlow(fields: { sel: string; key: string }[]): void {
    _stopFieldFlow();
    _fieldFlow = { fields, i: 0, unsubs: [], poll: null };
    _fieldFlowRender();
}

const _sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Find the step's control and get it in front of the reader before lighting it: open the
 * tab or section it is in, close a leftover dialog over it when that loses nothing, scroll
 * it into view (tutorial-reveal.ts). What cannot be fixed safely is said in the guide's
 * status line, with a « Show me » that comes back here.
 *
 * `userAsked` — the reader pressed Show me: go to the step's page first (they may have
 * wandered off), and once the control is lit, play the ghost-cursor demonstration.
 */
async function _revealAndHighlight(userAsked: boolean): Promise<void> {
    const step = _currentStepRef();
    if (!step || !_tutorial) return;
    const snap = `${_tutorial.id}:${_partIndex}:${_stepIndex}`;
    const same = () => !!_tutorial && `${_tutorial.id}:${_partIndex}:${_stepIndex}` === snap;
    if (userAsked && step.nav) {
        _navigate(step.nav);
        _refreshNavHint();
        await _sleep(250);
        if (!same()) return;
    }
    _revealWhere = null;
    _whereKey = '';
    const sels = step.fields?.length
        ? step.fields.map((f) => f.sel)
        : [...(step.selector ? [step.selector] : []), ...(step.selectors ?? [])];
    // The step's own dialog is already up (the reader came back to this step): the modal
    // poll takes it from there, and its opener being covered by it is expected.
    const ownTarget = step.modal_selector ? (resolveTargets(step.modal_selector)[0] ?? null) : null;
    if (sels.length && !isShown(ownTarget)) {
        const guide = document.getElementById('tut-engine-panel');
        const primary = _resolveFieldEl(sels[0]);
        let w: Where = primary ? reveal(primary, guide, ownTarget) : { kind: 'missing' };
        if (primary && w.kind !== 'ok') {
            // A tab click or a closing dialog re-renders on the next frames: look again.
            await _sleep(120);
            if (!same()) return;
            w = reveal(primary, guide, ownTarget);
        }
        if (w.kind !== 'ok' && w.kind !== 'covered-guide' && w.kind !== 'offscreen') _revealWhere = w;
    }
    document.querySelectorAll('.tut-highlight').forEach((el) => el.remove());
    _highlightElements(step);
    _renderWhere(null);
    if (userAsked && !_revealWhere && document.querySelector('.tut-highlight')) {
        setTimeout(() => { if (same()) _showMe(true); }, 350);
    }
}

function _highlightElements(step: TutorialStep): void {
    // Field guide for fields already on the page (numbered rings, no dim).
    if (step.fields && step.fields.length) {
        _startFieldFlow(step.fields);
        return;
    }
    const selectors: string[] = [
        ...(step.selector ? [step.selector] : []),
        ...(step.selectors ?? []),
    ];
    if (selectors.length) {
        // `dim: false` — an outline without the spotlight, for a control the reader should
        // see in its surroundings (the creator's "Outline only").
        _outlineOnly = step.dim === false;
        try { selectors.forEach((sel, idx) => _highlightElement(sel, idx)); }
        finally { _outlineOnly = false; }
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
    // A bare name is an id, else a class; anything else is CSS (tutorial-target.ts). There may
    // be many matches (one per mod/pack): prefer the demo entity's.
    let target: Element | null = _preferDemo(resolveTargets(selector));
    target = _resolveCustomSelect(target) ?? null;
    if (target) _drawHighlight(target, idx);
}

/** The layer every page highlight lives in: absolutely positioned INSIDE
 *  #app-window-outer, overflow hidden, radius inherited — so the spotlight's huge
 *  box-shadow is clipped to the window instead of painting over its transparent
 *  outer margin (field screenshot: the grey covered the whole screen, rounded
 *  corners included). Rings inside an open modal stay body-mounted (z 20000):
 *  the modal overlay already owns the full window. */
function _hlLayer(): HTMLElement {
    let layer = document.getElementById('tut-hl-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'tut-hl-layer';
        layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;z-index:8990;';
        const host = document.getElementById('app-window-outer');
        if (host) host.appendChild(layer); else document.body.appendChild(layer);
    }
    return layer;
}

function _drawHighlight(target: Element, idx: number = 0): void {
    let r = target.getBoundingClientRect();
    // Bring an off-viewport target into view before ringing it. A step can point at a nav item
    // scrolled below the fold in the sidebar, or a control scrolled out of a panel — it has a
    // real size, so nothing above bailed, but the ring drew off-screen and the step looked like
    // it pointed at nothing ("the sidebar hides the action"). Scroll it to centre and re-measure
    // so the spotlight lands ON it. Instant (not smooth) so the rect below is already correct.
    if (r.width > 0 && r.height > 0) {
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
            try { (target as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* detached */ }
            r = target.getBoundingClientRect();
        }
    }
    if (r.width === 0 || r.height === 0) return;

    // Smart placement: keep the coach card off the highlighted target.
    if (idx === 0) _autoPlacePanel(r);
    // Re-measured on EVERY step, not just the first. The card's height is driven by the
    // step's text, and the reservation used to be taken once — so a lesson whose later
    // steps were wordier than its first kept step 0's height, and max-height clipped
    // them. The comment inside _setDockReserved always said it was measured; it was,
    // once.
    _setDockReserved(true);

    const cs = window.getComputedStyle(target as HTMLElement);
    const baseRadius = parseFloat(cs.borderTopLeftRadius) || 8;

    const pad = 4;
    // Use tutorial color for highlights if available
    const tutColor = _tutorial?.color ?? 'var(--accent)';
    const tutColorHex = tutColor.startsWith('#') ? tutColor : '#3b82f6';
    const hl = document.createElement('div');
    hl.className     = 'tut-highlight';
    hl.dataset.hlIdx = String(idx);
    // A ring around something INSIDE an open dialog must paint above that dialog
    // (modal overlays live at 9000-10000); a ring on the page stays under them so a
    // dialog opening is never greyed by the spotlight (see the z-index note below).
    const inModal = !!(target as HTMLElement).closest?.('.modal-generic-overlay, .modal-overlay');
    // Above EVERY modal layer, not just the low ones: the app's dialogs run from
    // mapper.css's 9000 up to the assets panel at 2000300, so a ring on an element
    // inside a high panel at 20000 would vanish under it — the same invisible-
    // highlight bug this layering was fixed to kill.
    const hlZ = inModal ? 2000400 : 8990;
    // The primary target (idx 0) carries the spotlight dim: a huge soft box-shadow
    // darkens everything EXCEPT the cut-out, so the eye lands on the right spot.
    // Secondary targets get just the coloured ring (no extra dim, to avoid stacking).
    const dim = (idx === 0 && !_suppressDim && !_outlineOnly)
        ? `0 0 0 3px ${tutColorHex}40, 0 0 0 9999px rgba(8,11,18,0.60), 0 0 34px ${tutColorHex}99`
        : `0 0 0 3px ${tutColorHex}33, 0 0 26px ${tutColorHex}80`;
    const layer = inModal ? null : _hlLayer();
    const o = layer ? layer.getBoundingClientRect() : { top: 0, left: 0 } as DOMRect;
    hl.style.cssText = `
        position:${layer ? 'absolute' : 'fixed'};
        top:${r.top - o.top - pad}px;
        left:${r.left - o.left - pad}px;
        width:${r.width + pad * 2}px;
        height:${r.height + pad * 2}px;
        border:2px solid ${tutColor};
        border-radius:${baseRadius + pad}px;
        color:${tutColor};
        box-shadow:${dim};
        /* Below EVERY modal layer and the tutorial panel, above the page. At 99990 this
           dim painted OVER the modals: the Mapper's "name the new folder" dialog opened
           invisibly under the grey, so the action could never complete and the step read
           as "clicking does nothing" (field screenshot). The spotlight's job is to dim
           the PAGE — a dialog opening is exactly what the user must see. The ceiling is
           NOT main.css's 10000: mapper.css re-declares .modal-generic-overlay at 9000,
           so the dim sits under that too. Rings on elements inside an open dialog get
           20000 instead — above the dialog they belong to (hlZ above). */
        z-index:${hlZ};
        pointer-events:none;
        transition:top 0.22s cubic-bezier(0.4,0,0.2,1), left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1), height 0.22s cubic-bezier(0.4,0,0.2,1), border-radius 0.22s ease;
    `;
    // Stash the selector so the tracker can re-measure
    (hl as any)._tutTarget = target;

    if (idx > 0 || _suppressDim) {
        const label = document.createElement('div');
        // INSIDE the ring's top-left corner, not outside it. Hanging 9px out meant
        // the badge sat on whatever neighbours the target (field screenshot: it
        // printed over the search field's own edge) and, for a target near the
        // window edge, got cut off by the layer's clip.
        label.style.cssText = `
            position:absolute; top:2px; left:2px;
            width:16px; height:16px; border-radius:50%;
            background:${tutColor}; color:#fff;
            font-size:9px; font-weight:800;
            display:flex; align-items:center; justify-content:center;
            box-shadow:0 1px 4px rgba(0,0,0,0.5);
        `;
        label.textContent = String(idx + 1);
        hl.appendChild(label);
    }

    (layer ?? document.body).appendChild(hl);
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

/** Put the guide window where its placement says, or (`on` false) give everything back:
 *  the body classes, the dock width the right edge claimed, the size variables. The name is
 *  the dock era's; every render and teardown path already calls it, so it stays the ONE
 *  writer of the window's geometry. */
function _setDockReserved(on: boolean): void {
    const panel = document.getElementById('tut-engine-panel');
    // The dock era's body classes are never set any more; clear them in case a build that
    // set them left them behind.
    document.body.classList.remove('tut-docked', 'tut-min', 'tut-dock-right', 'tut-dock-left', 'tut-dock-side');
    const shell = document.querySelector('.app-shell') as HTMLElement | null;
    if (shell) { shell.style.paddingRight = ''; shell.style.paddingLeft = ''; }
    // Popped out, the guide is in a window of its own: BMM's window keeps all its room.
    if (!on || !panel || _poppedOut) {
        document.body.classList.remove('tgw-open', 'tgw-left', 'tgw-right', 'tgw-bottom', 'tgw-float');
        document.body.style.removeProperty('--tut-dock-h');
        document.body.style.removeProperty('--tut-dock-w');
        releaseDockSpace('tutorial');
        return;
    }
    const mode = _mode();
    panel.classList.add('tgw');
    for (const m of ['float', 'left', 'right', 'bottom']) {
        panel.classList.toggle(`tgw-${m}`, m === mode);
        document.body.classList.toggle(`tgw-${m}`, m === mode);
    }
    document.body.classList.add('tgw-open');
    const host = _hostRect(panel);

    const storedW = parseInt(localStorage.getItem('bmm.tutorial.dockW') || '', 10);
    const dockW = Math.max(300, Math.min(Number.isFinite(storedW) && storedW > 0 ? storedW : 380, Math.round(host.width * 0.6)));
    const storedH = parseInt(localStorage.getItem('bmm.tutorial.dockH') || '', 10);
    const dockH = Math.max(160, Math.min(Number.isFinite(storedH) && storedH > 0 ? storedH : 230, Math.round(host.height * 0.7)));
    document.body.style.setProperty('--tut-dock-w', `${dockW}px`);
    document.body.style.setProperty('--tut-dock-h', `${dockH}px`);

    if (mode === 'float') {
        const size = _readJson<{ w: number; h: number }>(FLOAT_SIZE_KEY);
        panel.style.width = `${Math.round(Math.max(300, Math.min(size?.w || 400, host.width - 16)))}px`;
        panel.style.height = size?.h ? `${Math.round(Math.max(200, Math.min(size.h, host.height - 16)))}px` : '';
        const want = _dodge?.mode === 'float' && _dodge.x !== undefined
            ? { x: _dodge.x, y: _dodge.y ?? 0 }
            : _readJson<{ x: number; y: number }>(POS_KEY)
              // First time: bottom-right corner, where a guide window is expected.
              ?? { x: host.width - (panel.offsetWidth || 400) - 20, y: host.height - (panel.offsetHeight || 320) - 20 };
        const p = _clampFloat(panel, want.x, want.y);
        panel.style.left = `${p.x}px`;
        panel.style.top = `${p.y}px`;
        panel.style.right = '';
        panel.style.bottom = '';
    } else {
        // The placement's CSS owns the geometry of a docked window.
        panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = '';
        panel.style.width = ''; panel.style.height = '';
    }
    panel.style.transform = '';

    // Only the right edge is shared with other docks (theme editor, sandbox): dock-space.ts
    // decides how much of it there is, and surfaces that opt in lay themselves out against it.
    if (mode === 'right') {
        const granted = claimDockSpace('tutorial', dockW);
        if (granted && granted !== dockW) document.body.style.setProperty('--tut-dock-w', `${granted}px`);
    } else {
        releaseDockSpace('tutorial');
    }
    // innerHTML re-renders delete the grips; one call here re-plants them for every path.
    _plantGrips(panel);
}

/** Overlap area of two rects, after growing `b` by `pad` on every side. */
function _overlap(a: { left: number; top: number; right: number; bottom: number }, b: DOMRect, pad = 10): number {
    const w = Math.min(a.right, b.right + pad) - Math.max(a.left, b.left - pad);
    const h = Math.min(a.bottom, b.bottom + pad) - Math.max(a.top, b.top - pad);
    return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The step's target is under the window: move the WINDOW. A dock goes to the other side
 * (the bottom one to the top edge, as a floating strip there); a floating window goes to the
 * free spot nearest to where it was. Only when it helps: a target as wide as the app overlaps
 * every placement, and a window hopping between two equally bad spots helps nobody.
 */
function _dodgeTarget(target: DOMRect): void {
    const panel = document.getElementById('tut-engine-panel');
    if (!panel || panel.classList.contains('minimized') || _isDragging || _poppedOut) return;
    const now = Date.now();
    if (now - _lastDodgeAt < 700) return;
    const host = _hostRect(panel);
    const pr = panel.getBoundingClientRect();
    const here = _overlap(pr, target);
    if (!here) return;
    const w = pr.width, h = pr.height, m = 12;
    type Cand = { mode: GuideMode; x?: number; y?: number; rect: { left: number; top: number; right: number; bottom: number } };
    const at = (mode: GuideMode, x: number, y: number, cw = w, ch = h): Cand => ({
        mode, x: x - host.left, y: y - host.top, rect: { left: x, top: y, right: x + cw, bottom: y + ch },
    });
    const mode = _mode();
    const cands: Cand[] = [];
    if (mode === 'left' || mode === 'right') {
        const other: GuideMode = mode === 'left' ? 'right' : 'left';
        const x = other === 'left' ? host.left : host.right - w;
        cands.push({ mode: other, rect: { left: x, top: host.top, right: x + w, bottom: host.bottom } });
    } else {
        // A bottom strip has nowhere to go but up: it floats as a narrower window instead.
        const fw = mode === 'bottom' ? Math.min(420, host.width - 2 * m) : w;
        const fh = mode === 'bottom' ? Math.min(h, 300) : h;
        const xs = [host.right - fw - m, host.left + m, target.right + m, target.left - fw - m];
        const ys = [host.bottom - fh - m, host.top + m, target.bottom + m, target.top - fh - m];
        for (const x of xs) for (const y of ys) {
            if (x < host.left || y < host.top || x + fw > host.right || y + fh > host.bottom) continue;
            cands.push(at('float', x, y, fw, fh));
        }
    }
    let best: Cand | null = null;
    let bestScore = Infinity;
    for (const c of cands) {
        const o = _overlap(c.rect, target);
        // Overlap first; then the shortest move, so the window does not cross the screen to
        // avoid a target it could clear by sliding over.
        const dist = Math.hypot(c.rect.left - pr.left, c.rect.top - pr.top);
        const score = o * 1000 + dist;
        if (o < here && score < bestScore) { best = c; bestScore = score; }
    }
    if (!best) return;
    _lastDodgeAt = now;
    _dodge = { mode: best.mode, x: best.x, y: best.y };
    panel.classList.add('tgw-moving');
    _setDockReserved(true);
    setTimeout(() => panel.classList.remove('tgw-moving'), 260);
}

/** "Phantom" demo: float a ghost cursor from the coach card to the current
 *  spotlight target and play a click pulse — shows WHERE/how to interact without
 *  actually clicking anything (safe). */
function _showMe(navigated: boolean = false): void {
    // Visit EVERY highlighted target in order (so multi-field steps demonstrate
    // each field, not just the "next" button).
    const hls = Array.from(document.querySelectorAll('.tut-highlight')) as HTMLElement[];
    if (!hls.length) {
        // No highlight usually means the user wandered to another view — the targets
        // exist on the step's page, not this one. The button silently doing nothing here
        // is what made it read as broken: it worked, but only if you were already where
        // it assumed. Go to the step's page first, give the view a beat to render, then
        // demonstrate. `navigated` stops a second hop if the page really has no targets.
        // The page is not the only thing in the way any more: the reveal also opens the
        // control's tab and clears a leftover dialog, and says where it is when it can't.
        if (!navigated) void _revealAndHighlight(true);
        return;
    }
    const color = _tutorial?.color ?? 'var(--accent)';

    document.getElementById('tut-ghost-cursor')?.remove();
    // …and its caption, or a second Show-me stacks a new bubble over the old one.
    document.getElementById('tut-ghost-caption')?.remove();
    const ghost = document.createElement('div');
    ghost.id = 'tut-ghost-cursor';
    ghost.className = 'tut-ghost-cursor';
    ghost.style.color = color;
    ghost.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"><path d="m4 2 6 16 2.3-6.4L18.8 9.2Z"/></svg>`;
    const panel = document.getElementById('tut-engine-panel');
    // Popped out, the panel here has no box: the cursor starts from the middle-bottom.
    const pr = _poppedOut ? undefined : panel?.getBoundingClientRect();
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
            _renderWhere(null);
            return;
        }
        const guide = document.getElementById('tut-engine-panel');
        let anyInView = false;
        let status: Where | null = null;
        let offEl: HTMLElement | null = null;
        highlights.forEach(hlEl => {
            const hl     = hlEl as HTMLElement;
            const target = (hl as any)._tutTarget as HTMLElement | null;
            if (!target || !target.isConnected) { hl.remove(); return; }
            const r = target.getBoundingClientRect();
            // No box, or a box nobody can see (a closed generic dialog keeps its layout under
            // visibility:hidden): a ring there would point at nothing.
            if (r.width === 0 || r.height === 0 || !isShown(target)) { hl.remove(); return; }
            // View bounds = the nearest scroll container, else the window.
            const clip = _scrollClipRect(target);
            const vTop = clip ? clip.top : 0;
            const vBottom = clip ? clip.bottom : window.innerHeight;
            const vLeft = clip ? clip.left : 0;
            const vRight = clip ? clip.right : window.innerWidth;
            const cy = r.top + r.height / 2;
            const cx = r.left + r.width / 2;
            const inViewV = cy >= vTop - 2 && cy <= vBottom + 2;
            const inViewH = cx >= vLeft - 2 && cx <= vRight + 2;
            let inView = inViewV && inViewH;
            if (inView) {
                // In the scroll box — but is something painted over it? The guide steps aside;
                // anything else is named in the guide, with what to do about it.
                const cover = coverAt(target, guide);
                if (cover.kind === 'covered-guide') {
                    _dodgeTarget(r);
                } else if (cover.kind !== 'ok') {
                    // The step's own dialog opening over its opener is progress, not a problem.
                    const step = _currentStepRef();
                    const ownOpen = cover.kind === 'covered-dialog' && !!step?.modal_selector
                        && !!resolveTargets(step.modal_selector)[0]?.closest('.modal-overlay, .modal-generic-overlay')?.isSameNode(cover.overlay);
                    if (!ownOpen && !status) status = cover;
                    // A ring drawn on top of the dialog that hides its target points at the
                    // dialog's own fields instead; the status line says where it is.
                    if (cover.kind === 'sidebar' || cover.kind === 'covered-dialog') inView = false;
                }
            } else if (!offEl) {
                offEl = target;
                status = status ?? { kind: 'offscreen', dir: !inViewV ? (cy < vTop ? 'up' : 'down') : (cx < vLeft ? 'left' : 'right') };
            }
            hl.style.visibility = inView ? 'visible' : 'hidden';
            if (inView) anyInView = true;
            const pad        = 4;
            const cs         = window.getComputedStyle(target);
            const baseRadius = parseFloat(cs.borderTopLeftRadius) || 8;
            const layerEl = hl.parentElement && hl.parentElement.id === 'tut-hl-layer'
                ? hl.parentElement.getBoundingClientRect() : null;
            const oy = layerEl ? layerEl.top : 0;
            hl.style.top         = `${r.top - oy - pad}px`;
            hl.style.left        = `${r.left - (layerEl ? layerEl.left : 0) - pad}px`;
            hl.style.width       = `${r.width + pad * 2}px`;
            hl.style.height      = `${r.height + pad * 2}px`;
            hl.style.borderRadius= `${baseRadius + pad}px`;
        });
        // One status line, in the guide: an off-screen target only matters when nothing of
        // this step is visible; something covering the target always does.
        if (status && (status as Where).kind === 'offscreen' && anyInView) status = null;
        // The control is visible and nothing covers it: whatever the start of the step found
        // (a dialog on top, a closed tab) has been dealt with, so stop saying it.
        if (!status && anyInView) _revealWhere = null;
        _renderWhere(status, offEl);
    }, 150);
}

/**
 * The guide's status line: where the step's control is when it cannot simply be pointed
 * at, and the one button that fixes it. Replaces the floating « hidden behind a panel » pill,
 * which said something was wrong without saying what or offering a way out. `null` hides
 * it (the start-of-step finding, if any, stays until the step changes).
 */
function _renderWhere(status: Where | null, target: HTMLElement | null = null): void {
    const box = document.getElementById('tut-where');
    if (!box) return;
    const w = status ?? _revealWhere;
    const key = w ? `${w.kind}:${'dir' in w ? w.dir : ''}:${'title' in w ? w.title : ''}:${'label' in w ? w.label : ''}:${'dirty' in w ? w.dirty : ''}` : '';
    // An empty key means "nothing to say": it only matches when the line is already hidden
    // (callers reset _whereKey to '' to force a repaint, which must still hide a stale line).
    if (key === _whereKey && (key || box.hidden)) return;
    _whereKey = key;
    if (!w || w.kind === 'ok' || w.kind === 'covered-guide') { box.hidden = true; box.innerHTML = ''; return; }
    const step = _currentStepRef();
    const page = step?.nav && NAV_LABELS[step.nav] ? t(NAV_LABELS[step.nav]) : '';
    let text = '';
    let btn = '';
    let act: (() => void) | null = null;
    switch (w.kind) {
        case 'offscreen':
            text = t(`tut.where.${w.dir === 'up' ? 'above' : w.dir === 'down' ? 'below' : 'side'}`);
            btn = t('tut.where.scroll');
            act = () => target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            break;
        case 'sidebar':
            text = t('tut.where.sidebar');
            btn = t('tut.where.scroll');
            act = () => target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            break;
        case 'covered-dialog':
            text = w.title ? t('tut.where.coveredBy', { title: w.title }) : t('tut.where.covered');
            btn = w.dirty ? t('tut.where.closeDirty') : t('tut.where.close');
            act = () => { closeDialog(w.overlay); _whereKey = ''; };
            break;
        case 'covered-other':
            text = t('tut.where.covered');
            btn = t('tut.where.show');
            act = () => { void _revealAndHighlight(true); };
            break;
        case 'closed-dialog':
            text = w.title ? t('tut.where.inDialog', { title: w.title }) : t('tut.where.inClosedDialog');
            btn = t('tut.where.show');
            act = () => { void _revealAndHighlight(true); };
            break;
        case 'tab':
            text = w.label ? t('tut.where.onTab', { tab: w.label }) : t('tut.where.otherTab');
            btn = t('tut.where.show');
            act = () => { void _revealAndHighlight(true); };
            break;
        case 'missing':
        default:
            text = page ? t('tut.where.missingOn', { page }) : t('tut.where.missing');
            btn = t('tut.where.show');
            act = () => { void _revealAndHighlight(true); };
            break;
    }
    box.hidden = false;
    box.innerHTML = `
        <span class="tgw-where-ico">${uiIcon(w.kind === 'offscreen' ? (w.dir === 'up' ? 'move-up' : w.dir === 'down' ? 'move-down' : 'arrow-right') : 'eye-off', 16)}</span>
        <span class="tgw-where-text"></span>
        <button type="button" class="tgw-where-btn"></button>`;
    (box.querySelector('.tgw-where-text') as HTMLElement).textContent = text;
    const b = box.querySelector('.tgw-where-btn') as HTMLButtonElement;
    b.textContent = btn;
    b.addEventListener('click', () => act?.());
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
