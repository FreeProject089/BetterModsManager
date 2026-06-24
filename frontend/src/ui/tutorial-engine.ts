// @ts-nocheck
/**
 * tutorial-engine.ts — Step-by-step tutorial runner for BMM.
 *
 * Bottom-center floating card. Supports drag-to-reposition and minimize-to-pill.
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

// Drag state
let _isDragging = false;
let _dragOffX   = 0;
let _dragOffY   = 0;
let _panelLeft: number | null = null;
let _panelTop:  number | null = null;

// Minimize state
let _isMinimized = false;

// ── Tutorial demo data (ephemeral example profile + mods) ──────────────────
let _demoCreated = false;
let _demoPrevActive: string | null = null;
// Tutorials whose steps demonstrate mod/profile features and benefit from a
// concrete example when the user has no real data yet.
const DEMO_TUTORIALS = new Set(['basics']);

async function _setupDemo(): Promise<void> {
    try {
        const res: any = await invoke('tutorial_setup_demo');
        _demoCreated    = !!res?.created;
        _demoPrevActive = res?.prevActive ?? null;
        if (_demoCreated) {
            // Make the example profile + mods appear in the live UI immediately.
            (window as any)._refreshProfilesFn?.();
            (window as any)._refreshModsFn?.(true);
        }
    } catch (e) {
        console.warn('[tutorial] setup demo failed:', e);
        _demoCreated = false;
    }
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
    } catch (e) {
        console.warn('[tutorial] cleanup demo failed:', e);
    }
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
}

export function closeTutorialEngine(): void {
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
            setTimeout(() => { panel.remove(); _panelLeft = null; _panelTop = null; }, 220);
        } else {
            panel.classList.add('closing');
            panel.addEventListener('animationend', () => panel.remove(), { once: true });
        }
    }
    if (_onClose) _onClose();
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
    const overlay = el?.closest('.modal-overlay') as HTMLElement | null;
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
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('button,select,input')) return;

        const parent = panel.parentElement;
        if (!parent) return;

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
        _dragOffX   = e.clientX - _panelLeft!;
        _dragOffY   = e.clientY - _panelTop!;
        panel.classList.add('dragging');
        e.preventDefault();

        function onMove(me: MouseEvent) {
            if (!_isDragging) return;
            const pr = parent!.getBoundingClientRect();
            let l  = me.clientX - _dragOffX;
            let tp = me.clientY - _dragOffY;
            l  = Math.max(0, Math.min(l,  pr.width  - panel.offsetWidth));
            tp = Math.max(0, Math.min(tp, pr.height - panel.offsetHeight));
            _panelLeft = l; _panelTop = tp;
            panel.style.left = `${l}px`;
            panel.style.top  = `${tp}px`;
        }
        function onUp() {
            _isDragging = false;
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
    panel.classList.add('minimized');
    _applyDragPosition(panel);

    const tut  = _tutorial!;
    const step = _currentStep();

    panel.innerHTML = `
        <div class="tut-min-pill">
            <img src="${step.img || 'assets/Tasky.png'}" alt="Tasky" class="tut-min-mascot" />
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
    document.getElementById('btn-tut-restore')?.addEventListener('click', () => { panel.classList.remove('minimized'); _restore(); });
    document.getElementById('btn-tut-close-min')?.addEventListener('click', () => { panel.classList.remove('minimized'); closeTutorialEngine(); });
}

// ── Render ───────────────────────────────────────────────────────────────────

function _renderStep(): void {
    _cleanup();

    const tut   = _tutorial!;
    const part  = _currentPart();
    const step  = _currentStep();
    const panel = document.getElementById('tut-engine-panel')!;

    panel.classList.remove('minimized');
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

        <div class="tut-card-body">
            <div class="tut-step-header">
                <div class="tut-avatar">
                    <img src="${step.img || 'assets/Tasky.png'}" alt="Tasky" />
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
        panel.addEventListener('animationend', () => { panel.remove(); _panelLeft = null; _panelTop = null; }, { once: true });
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
    if (!step.action) markStepComplete(_tutorial!.id, _currentPart().id, step.id);
    _cleanup();

    if (_stepIndex < _totalSteps() - 1)                { _stepIndex++; }
    else if (_partIndex < _tutorial!.parts.length - 1) { _partIndex++; _stepIndex = 0; }
    else                                               { _finishTutorial(); return; }
    _renderStep();
}

function _finishTutorial(): void {
    _cleanup();
    const panel = document.getElementById('tut-engine-panel')!;
    const tut   = _tutorial!;
    panel.classList.remove('minimized');
    _applyDragPosition(panel);

    panel.innerHTML = `
        <div class="tut-finish-screen">
            <div class="tut-finish-glow" style="background:${tut.color}"></div>
            <img src="assets/Tasky_Happy.png" alt="Tasky" class="tut-finish-mascot" />
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
            panel.remove(); _panelLeft = null; _panelTop = null;
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

function _highlightElement(selector: string, idx: number = 0): void {
    const target = document.getElementById(selector)
        || document.querySelector(`[id="${selector}"]`)
        || document.querySelector(`.${selector}`);
    if (target) _drawHighlight(target, idx);
}

function _drawHighlight(target: Element, idx: number = 0): void {
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    // Smart placement: keep the coach card off the highlighted target.
    if (idx === 0) _autoPlacePanel(r);

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
function _autoPlacePanel(targetRect: DOMRect): void {
    if (_panelLeft !== null || _panelTop !== null) return; // user positioned it
    const panel = document.getElementById('tut-engine-panel');
    if (!panel || panel.classList.contains('minimized')) return;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    // Target in the lower ~half → move the card to the top, else keep it bottom.
    panel.classList.toggle('tut-anchor-top', targetCenterY > vh * 0.52);
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

    const targetOf = (el: HTMLElement): Element | undefined => (el as { _tutTarget?: Element })._tutTarget;
    const rectOf = (el: HTMLElement): DOMRect => {
        const t = targetOf(el);
        return (t?.getBoundingClientRect() ?? el.getBoundingClientRect()) as DOMRect;
    };

    // Temp demo values: type a sample into writable text fields, then restore them
    // at the end (so nothing junk is left behind).
    const filled: { el: HTMLInputElement; prev: string }[] = [];
    const demoFill = (el: Element | undefined) => {
        if (!el) return;
        const inp = el as HTMLInputElement;
        const tag = inp.tagName;
        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        const typable = (tag === 'INPUT' && ['text', 'search', 'url', 'email', 'number', ''].includes(type)) || tag === 'TEXTAREA';
        if (!typable || inp.readOnly || inp.disabled) return;
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
                // Temp: undo the demo values.
                filled.forEach(f => { f.el.value = f.prev; f.el.dispatchEvent(new Event('input', { bubbles: true })); });
            }, 650);
            return;
        }
        const r = rectOf(hls[i]);
        const tx = r.left + r.width / 2;
        const ty = r.top + r.height / 2;
        ghost.style.left = `${tx}px`;
        ghost.style.top = `${ty}px`;
        const tgt = targetOf(hls[i]);
        setTimeout(() => {
            ghost.classList.add('clicking');
            _ghostClickPulse(tx, ty, color);
            demoFill(tgt);
            setTimeout(() => ghost.classList.remove('clicking'), 300);
            i++;
            setTimeout(visit, 760);
        }, 760);
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
            return;
        }
        highlights.forEach(hlEl => {
            const hl     = hlEl as HTMLElement;
            const target = (hl as any)._tutTarget as HTMLElement | null;
            if (!target || !target.isConnected) { hl.remove(); return; }
            const r = target.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) { hl.remove(); return; }
            const pad        = 4;
            const cs         = window.getComputedStyle(target);
            const baseRadius = parseFloat(cs.borderTopLeftRadius) || 8;
            hl.style.top         = `${r.top - pad}px`;
            hl.style.left        = `${r.left - pad}px`;
            hl.style.width       = `${r.width + pad * 2}px`;
            hl.style.height      = `${r.height + pad * 2}px`;
            hl.style.borderRadius= `${baseRadius + pad}px`;
        });
    }, 150);
}
