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
    settings:  'nav.label.settings',
};

const NAV_ICONS: Record<string, string> = {
    profiles:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    library:   `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    mapper:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
    modpacks:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    modlists:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    repo:      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>`,
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

    _ensurePanel();
    _renderStep();
    _registerLangListener();
}

export function closeTutorialEngine(): void {
    _unregisterLangListener();
    _cleanup();
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
    const shell = document.querySelector('.app-shell') as HTMLElement | null;
    if (shell) shell.style.pointerEvents = '';
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
            <button class="tut-min-restore-btn" id="btn-tut-restore" title="${t('common.resume')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="5 15 12 8 19 15"/></svg>
            </button>
            <button class="tut-x-btn" id="btn-tut-close-min" title="${t('hub.close')}">
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

    _navigate(step.nav);
    savePosition(tut.id, part.id, step.id);
    if (step.action) markStepPartial(tut.id, part.id, step.id);

    /* ── Part chips ── */
    const partChips = tut.parts.map((p, i) => {
        const done     = p.steps.filter(s => getStepStatus(tut.id, p.id, s.id).state === 'complete').length;
        const isActive = i === _partIndex;
        const isDone   = done === p.steps.length;
        return `<button class="tut-part-chip ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}" data-pi="${i}" title="${t(p.title_key)}">
            ${isDone ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            <span class="tut-part-chip-label">${t(p.title_key)}</span>
        </button>`;
    }).join('');

    /* ── Step badges (current part only) ── */
    const badges = part.steps.map((s, i) => {
        const st = getStepStatus(tut.id, part.id, s.id);
        return `<span class="tut-step-badge tut-badge-${st.state}${i === _stepIndex ? ' current' : ''}" title="${t(`hub.badge.${st.state}`)}"></span>`;
    }).join('');

    /* ── Global progress ── */
    const allStepKeys = tut.parts.flatMap(p => p.steps.map(s => `${p.id}:${s.id}`));
    const completedCount = allStepKeys.filter(k => {
        const [pid, sid] = k.split(':');
        return getStepStatus(tut.id, pid, sid).state === 'complete';
    }).length;
    const globalPct = allStepKeys.length > 0 ? Math.round((completedCount / allStepKeys.length) * 100) : 0;

    /* ── Nav hint (clickable) ── */
    const navHintHtml = step.nav && NAV_LABELS[step.nav] ? `
        <button class="tut-nav-hint" id="btn-tut-nav-hint" data-nav="${step.nav}"
            style="border-color:${tut.color}33;background:${tut.color}0d;cursor:pointer"
            title="${t('hub.goTo')} ${t(NAV_LABELS[step.nav])}">
            ${NAV_ICONS[step.nav] || ''}
            <span class="tut-nav-hint-label">${t('hub.goTo')}</span>
            <strong class="tut-nav-hint-page">${t(NAV_LABELS[step.nav])}</strong>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:2px;opacity:0.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
    ` : '';

    /* ── Action box ── */
    const actionHtml = step.action ? `
        <div class="tut-action-box" id="tut-action-box">
            <div class="tut-action-pulse"></div>
            <div class="tut-action-text">
                <span class="tut-action-label">${t('hub.action.waiting')}</span>
                <p class="tut-action-desc">${t(step.action.desc_key)}</p>
            </div>
            ${step.optional ? `<button class="tut-action-skip-btn" id="btn-tut-skip-action">${t('hub.action.skip')}</button>` : ''}
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
                <button class="tut-min-btn" id="btn-tut-minimize" title="${t('common.minimize')}">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button class="tut-x-btn" id="btn-tut-close" title="${t('hub.close')}">
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
                ${!isFirst
                    ? `<button class="tut-prev-btn" id="btn-tut-prev">← ${t('hub.prev')}</button>`
                    : `<span></span>`}
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="tut-skip-all-btn" id="btn-tut-skip-all" title="${t('tut.skip.title')}">${t('tut.skip')}</button>
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
        if (step.modal_selector) _startModalPoll(step.modal_selector);
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

    /* ── Skip action ── */
    document.getElementById('btn-tut-skip-action')?.addEventListener('click', () => {
        markStepPartial(tut.id, part.id, step.id);
        document.getElementById('btn-tut-next')?.removeAttribute('disabled');
        document.getElementById('tut-action-box')?.classList.add('skipped');
        if (_modalPollInterval) { clearInterval(_modalPollInterval); _modalPollInterval = null; }
        document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
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
                    return `<span class="tut-step-badge tut-badge-${st.state}${i === _stepIndex ? ' current' : ''}" title="${t(`hub.badge.${st.state}`)}"></span>`;
                }).join('');
            }

            const nextBtn = document.getElementById('btn-tut-next') as HTMLButtonElement | null;
            if (nextBtn) nextBtn.disabled = false;
        });
    }
}

function _skipTutorial(): void {
    _cleanup();
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
    el.textContent = '';
    let i = 0;
    _typeInterval = setInterval(() => {
        if (i < text.length) { el.textContent += text[i++]; }
        else { clearInterval(_typeInterval!); _typeInterval = null; }
    }, 12);
}

// ── Modal polling — highlights a secondary element once it becomes visible ───

function _startModalPoll(modalSelector: string): void {
    if (_modalPollInterval) { clearInterval(_modalPollInterval); _modalPollInterval = null; }
    let attempts = 0;
    _modalPollInterval = setInterval(() => {
        attempts++;
        if (attempts > 120) { clearInterval(_modalPollInterval!); _modalPollInterval = null; return; } // 30s timeout

        const target = document.getElementById(modalSelector) || document.querySelector(`.${modalSelector}`);
        if (target && _isElementVisible(target as HTMLElement)) {
            clearInterval(_modalPollInterval!);
            _modalPollInterval = null;
            // Remove primary highlights and highlight the modal target instead
            document.querySelectorAll('.tut-highlight').forEach(el => el.remove());
            _highlightElement(modalSelector, 0);
        }
    }, 250);
}

// ── Highlighting ─────────────────────────────────────────────────────────────

function _highlightElements(step: TutorialStep): void {
    const selectors: string[] = [
        ...(step.selector ? [step.selector] : []),
        ...(step.selectors ?? []),
    ];
    selectors.forEach((sel, idx) => _highlightElement(sel, idx));
}

function _highlightElement(selector: string, idx: number = 0): void {
    const target = document.getElementById(selector)
        || document.querySelector(`[id="${selector}"]`)
        || document.querySelector(`.${selector}`);
    if (!target) return;

    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const cs = window.getComputedStyle(target as HTMLElement);
    const baseRadius = parseFloat(cs.borderTopLeftRadius) || 8;

    const pad = 4;
    const hl = document.createElement('div');
    hl.className     = 'tut-highlight';
    hl.dataset.hlIdx = String(idx);
    hl.style.cssText = `
        position:fixed;
        top:${r.top - pad}px;
        left:${r.left - pad}px;
        width:${r.width + pad * 2}px;
        height:${r.height + pad * 2}px;
        border:2px solid var(--accent);
        border-radius:${baseRadius + pad}px;
        box-shadow:0 0 0 3px rgba(59,130,246,0.18), 0 0 28px rgba(59,130,246,0.45);
        z-index:99990;
        pointer-events:none;
        transition:top 0.18s ease, left 0.18s ease, width 0.18s ease, height 0.18s ease, border-radius 0.18s ease;
        animation:tutHighlightPulse 2s ease-in-out infinite;
    `;
    // Stash the selector so the tracker can re-measure
    (hl as any)._tutTarget = target;

    if (idx > 0) {
        const label = document.createElement('div');
        label.style.cssText = `
            position:absolute; top:-9px; right:-9px;
            width:17px; height:17px; border-radius:50%;
            background:var(--accent); color:#fff;
            font-size:9px; font-weight:800;
            display:flex; align-items:center; justify-content:center;
            box-shadow:0 2px 6px rgba(59,130,246,0.5);
        `;
        label.textContent = String(idx + 1);
        hl.appendChild(label);
    }

    document.body.appendChild(hl);
    _startHighlightTracker();
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
