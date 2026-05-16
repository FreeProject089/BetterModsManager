// @ts-nocheck
/**
 * tutorial-engine.ts — Step-by-step tutorial runner for BMM.
 *
 * Bottom-center floating card. Supports drag-to-reposition and minimize-to-pill.
 * The app stays fully interactive above the card; action steps keep it interactive.
 */

import { t } from '../core/i18n.js';
import { onBmmAction } from './tutorial-events.js';
import {
    savePosition, markStepComplete, markStepPartial, getStepStatus,
} from './tutorial-store.js';
import type { TutorialDef, TutorialPart, TutorialStep } from './tutorial-types.js';

// ── State ────────────────────────────────────────────────────────────────────

let _tutorial: TutorialDef | null = null;
let _partIndex = 0;
let _stepIndex = 0;
let _actionUnsub: (() => void) | null = null;
let _typeInterval: ReturnType<typeof setInterval> | null = null;
let _onClose: (() => void) | null = null;

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
}

export function closeTutorialEngine(): void {
    _cleanup();
    _isMinimized = false;
    const panel = document.getElementById('tut-engine-panel');
    if (panel) {
        if (_panelLeft !== null) {
            // Panel was dragged — fade out instead of the translateX-based animation
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

// ── Internal ─────────────────────────────────────────────────────────────────

function _currentPart(): TutorialPart { return _tutorial!.parts[_partIndex]; }
function _currentStep(): TutorialStep { return _currentPart().steps[_stepIndex]; }
function _totalSteps(): number        { return _currentPart().steps.length; }

function _cleanup(): void {
    if (_typeInterval) { clearInterval(_typeInterval); _typeInterval = null; }
    if (_actionUnsub)  { _actionUnsub(); _actionUnsub = null; }
    document.getElementById('tut-highlight')?.remove();
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

function _navigate(nav: string | undefined): void {
    if (nav) document.getElementById(`nav-${nav}`)?.click();
}

// ── Drag ─────────────────────────────────────────────────────────────────────

function _makeDraggable(handle: HTMLElement, panel: HTMLElement): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;

        const parent = panel.parentElement;
        if (!parent) return;

        // Snapshot CSS position on first drag gesture
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
            let l = me.clientX - _dragOffX;
            let t = me.clientY - _dragOffY;
            l = Math.max(0, Math.min(l, pr.width  - panel.offsetWidth));
            t = Math.max(0, Math.min(t, pr.height - panel.offsetHeight));
            _panelLeft = l;
            _panelTop  = t;
            panel.style.left = `${l}px`;
            panel.style.top  = `${t}px`;
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

    document.getElementById('btn-tut-restore')?.addEventListener('click', () => {
        panel.classList.remove('minimized');
        _restore();
    });
    document.getElementById('btn-tut-close-min')?.addEventListener('click', () => {
        panel.classList.remove('minimized');
        closeTutorialEngine();
    });
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
        return `<button class="tut-part-chip ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}" data-pi="${i}">
            ${isDone ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            ${t(p.title_key)}
        </button>`;
    }).join('');

    /* ── Step badges ── */
    const badges = part.steps.map((s, i) => {
        const st = getStepStatus(tut.id, part.id, s.id);
        return `<span class="tut-step-badge tut-badge-${st.state}${i === _stepIndex ? ' current' : ''}"
                      title="${t(`hub.badge.${st.state}`)}"></span>`;
    }).join('');

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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                ${t('hub.back')}
            </button>

            <div class="tut-part-chips-wrap">
                ${partChips}
            </div>

            <button class="tut-min-btn" id="btn-tut-minimize" title="${t('common.minimize')}">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="tut-x-btn" id="btn-tut-close" title="${t('hub.close')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>

        <div class="tut-card-body">
            <div class="tut-mascot-col">
                <img src="${step.img || 'assets/Tasky.png'}" alt="Tasky" class="tut-mascot-img" />
            </div>
            <div class="tut-content-col">
                <div class="tut-step-meta">
                    <span class="tut-tutorial-label" style="color:${tut.color}">${t(tut.title_key)}</span>
                    <span class="tut-step-ctr">${t('hub.step').replace('{current}', String(_stepIndex + 1)).replace('{total}', String(_totalSteps()))}</span>
                    <div class="tut-badges-row">${badges}</div>
                </div>
                <h3 class="tut-step-title">
                    ${step.icon ? `<span class="tut-step-icon">${step.icon}</span>` : ''}
                    ${t(step.title_key)}
                </h3>
                <p class="tut-step-text" id="tut-typewriter"></p>
                ${actionHtml}
            </div>
        </div>

        <div class="tut-card-footer">
            ${!isFirst
                ? `<button class="tut-prev-btn" id="btn-tut-prev">← ${t('hub.prev')}</button>`
                : `<span></span>`}
            <button class="tut-next-btn" id="btn-tut-next" ${step.action ? 'disabled' : ''}>${nextLabel}</button>
        </div>
    `;

    /* ── Highlight ── */
    if (step.selector) _highlightElement(step.selector);

    /* ── Typewriter ── */
    _startTypewriter(t(step.text_key));

    /* ── Drag ── */
    const topbar = panel.querySelector('.tut-card-topbar') as HTMLElement | null;
    if (topbar) _makeDraggable(topbar, panel);

    /* ── Listeners ── */
    document.getElementById('btn-tut-back-hub')?.addEventListener('click', () => {
        _cleanup();
        closeTutorialEngine();
    });
    document.getElementById('btn-tut-close')?.addEventListener('click', () => closeTutorialEngine());
    document.getElementById('btn-tut-minimize')?.addEventListener('click', () => _minimize());
    document.getElementById('btn-tut-prev')?.addEventListener('click', _prevStep);
    document.getElementById('btn-tut-next')?.addEventListener('click', _nextStep);

    document.getElementById('btn-tut-skip-action')?.addEventListener('click', () => {
        markStepPartial(tut.id, part.id, step.id);
        document.getElementById('btn-tut-next')?.removeAttribute('disabled');
        document.getElementById('tut-action-box')?.classList.add('skipped');
    });

    panel.querySelectorAll('.tut-part-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            _cleanup();
            _partIndex = parseInt((chip as HTMLElement).dataset.pi!, 10);
            _stepIndex = 0;
            _renderStep();
        });
    });

    /* ── Action event listener ── */
    if (step.action) {
        const shell = document.querySelector('.app-shell') as HTMLElement | null;
        if (shell) shell.style.pointerEvents = '';

        _actionUnsub = onBmmAction(step.action.event, () => {
            if (_actionUnsub) { _actionUnsub(); _actionUnsub = null; }
            markStepComplete(tut.id, part.id, step.id);

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
                    return `<span class="tut-step-badge tut-badge-${st.state}${i === _stepIndex ? ' current' : ''}"
                                  title="${t(`hub.badge.${st.state}`)}"></span>`;
                }).join('');
            }

            const nextBtn = document.getElementById('btn-tut-next') as HTMLButtonElement | null;
            if (nextBtn) nextBtn.disabled = false;
        });
    }
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
            <img src="assets/Tasky_Happy.png" alt="Tasky" class="tut-finish-mascot" />
            <div class="tut-finish-text-col">
                <h2 class="tut-finish-title">${t('hub.done')}</h2>
                <p class="tut-finish-subtitle">${t(tut.title_key)}</p>
            </div>
            <button class="tut-next-btn" id="btn-tut-finish-hub">${t('hub.back')}</button>
        </div>
    `;

    document.getElementById('btn-tut-finish-hub')?.addEventListener('click', () => {
        panel.classList.add('closing');
        panel.addEventListener('animationend', () => {
            panel.remove();
            _panelLeft = null;
            _panelTop  = null;
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
    }, 14);
}

function _highlightElement(selector: string): void {
    const target = document.getElementById(selector) || document.querySelector(`.${selector}`);
    const parent = document.getElementById('app-window-outer');
    if (!target || !parent) return;

    const r  = target.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    const hl = document.createElement('div');
    hl.id           = 'tut-highlight';
    hl.style.cssText = `
        position:absolute;
        top:${r.top - pr.top - 6}px;
        left:${r.left - pr.left - 6}px;
        width:${r.width + 12}px;
        height:${r.height + 12}px;
        border:2px solid var(--accent);
        border-radius:8px;
        box-shadow:0 0 0 3px rgba(59,130,246,0.15), 0 0 24px rgba(59,130,246,0.4);
        z-index:9000;
        pointer-events:none;
        animation:tutHighlightPulse 2s ease-in-out infinite;
    `;
    parent.appendChild(hl);
}
