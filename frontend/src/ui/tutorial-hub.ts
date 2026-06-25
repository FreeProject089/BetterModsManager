// @ts-nocheck
/**
 * tutorial-hub.ts — Central tutorial hub overlay for BMM.
 *
 * Shows a list of all available tutorials with per-tutorial progress.
 * Users can start/resume/restart any tutorial from here.
 * Supports live language switching without reopening.
 *
 * Entry points:
 *   openTutorialHub()  — Show the hub (called from onboarding or menu)
 *   closeTutorialHub() — Hide the hub
 */

import { t } from '../core/i18n.js';
import { TUTORIALS, getAllStepKeys } from './tutorial-data.js';
import {
    getTutorialCompletion, isTutorialComplete, getLastPosition,
    getAllStepStatuses, resetTutorial,
} from './tutorial-store.js';
import { startTutorialEngine, closeTutorialEngine } from './tutorial-engine.js';
import type { TutorialDef } from './tutorial-types.js';

// ── Module state ─────────────────────────────────────────────────────────────

let _hubLangListener: ((e: Event) => void) | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function openTutorialHub(): void {
    let overlay = document.getElementById('tut-hub-overlay');
    if (overlay) {
        overlay.classList.remove('closing');
        _renderHub(overlay);
        return;
    }
    overlay = document.createElement('div');
    overlay.id = 'tut-hub-overlay';
    overlay.className = 'tut-hub-overlay';
    document.getElementById('app-window-outer')?.appendChild(overlay);
    _renderHub(overlay);

    // Live language switching — re-render without closing
    if (_hubLangListener) document.removeEventListener('langChanged', _hubLangListener);
    _hubLangListener = () => {
        const o = document.getElementById('tut-hub-overlay');
        if (o) _renderHub(o);
    };
    document.addEventListener('langChanged', _hubLangListener);
}

export function closeTutorialHub(): void {
    if (_hubLangListener) {
        document.removeEventListener('langChanged', _hubLangListener);
        _hubLangListener = null;
    }
    const overlay = document.getElementById('tut-hub-overlay');
    if (overlay) {
        overlay.classList.add('closing');
        overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
        // Fallback: if the closing animation never fires (display change, reduced
        // motion, etc.) force-remove so the hub can never stay stuck on screen.
        setTimeout(() => { document.getElementById('tut-hub-overlay')?.remove(); }, 450);
    }
}

// ── Hub rendering ────────────────────────────────────────────────────────────

function _renderHub(overlay: HTMLElement): void {
    const tutorialCards = TUTORIALS.map(tut => _renderTutorialCard(tut)).join('');

    overlay.innerHTML = `
        <div class="tut-hub-backdrop" id="tut-hub-backdrop"></div>
        <div class="tut-hub-container">
            <div class="tut-hub-header">
                <div class="tut-hub-mascot-row">
                    <div class="tut-hub-mascot-wrap">
                        <img src="assets/Tasky_Happy.png" alt="Tasky" class="tut-hub-mascot" />
                        <div class="tut-hub-mascot-glow"></div>
                    </div>
                    <div>
                        <h2 class="tut-hub-title">${t('hub.title')}</h2>
                        <p class="tut-hub-subtitle">${t('hub.subtitle')}</p>
                    </div>
                </div>
                <button class="tut-hub-close" id="btn-hub-close" data-tooltip="${t('hub.close')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            <div class="tut-hub-list">
                ${tutorialCards}
            </div>

            <div class="tut-hub-footer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                <span class="tut-hub-footer-text">${t('hub.footer')}</span>
            </div>
        </div>
    `;

    document.getElementById('tut-hub-backdrop')?.addEventListener('click', closeTutorialHub);
    document.getElementById('btn-hub-close')?.addEventListener('click', closeTutorialHub);

    overlay.querySelectorAll('[data-tut-start]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tutId = (btn as HTMLElement).dataset.tutStart!;
            _launchTutorial(tutId, false);
        });
    });
    overlay.querySelectorAll('[data-tut-restart]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tutId = (btn as HTMLElement).dataset.tutRestart!;
            resetTutorial(tutId);
            _renderHub(overlay);
        });
    });
    overlay.querySelectorAll('[data-tut-resume]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tutId = (btn as HTMLElement).dataset.tutResume!;
            _launchTutorial(tutId, true);
        });
    });
    // Click a part chip → jump straight into that part.
    overlay.querySelectorAll('.tut-hub-part-chip-btn').forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const el = chip as HTMLElement;
            _launchTutorialAt(el.dataset.tut!, el.dataset.part!, el.dataset.step || null);
        });
    });
}

/** Start a tutorial at a specific part/step (clicking a part chip in the hub). */
function _launchTutorialAt(tutId: string, partId: string, stepId: string | null): void {
    const tut = TUTORIALS.find(t => t.id === tutId);
    if (!tut) return;
    closeTutorialHub();
    startTutorialEngine(tut, partId, stepId, openTutorialHub);
}

function _renderTutorialCard(tut: TutorialDef): string {
    const stepKeys = getAllStepKeys(tut);
    const { done, total } = getTutorialCompletion(tut.id, stepKeys);
    const complete = isTutorialComplete(tut.id, stepKeys);
    const hasProgress = done > 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const allStatuses = getAllStepStatuses(tut.id);

    // Parts chips — always visible, show completion state
    const partChips = tut.parts.map(p => {
        const partDone = p.steps.filter(s => allStatuses[`${p.id}:${s.id}`]?.state === 'complete').length;
        const partTotal = p.steps.length;
        const partComplete = partDone === partTotal;
        const partInProgress = partDone > 0 && !partComplete;

        let chipClass = 'tut-hub-part-chip';
        if (partComplete) chipClass += ' done';
        else if (partInProgress) chipClass += ' in-progress';

        const icon = partComplete
            ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>`
            : partInProgress
                ? `<span class="tut-hub-part-dot" style="background:${tut.color}"></span>`
                : `<span class="tut-hub-part-dot"></span>`;

        const firstStep = p.steps[0]?.id ?? '';
        return `<button type="button" class="${chipClass} tut-hub-part-chip-btn" data-tut="${tut.id}" data-part="${p.id}" data-step="${firstStep}" data-tooltip="${t('hub.startHere') || 'Start from here'}" style="${partInProgress ? `--part-color:${tut.color}` : ''}">
            ${icon}
            <span>${t(p.title_key)}</span>
            <span class="tut-hub-part-count">${partDone}/${partTotal}</span>
        </button>`;
    }).join('');

    // Action button
    let actionBtn = '';
    if (complete) {
        actionBtn = `
            <div class="tut-card-complete-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                ${t('hub.completed')}
            </div>
            <button class="btn btn-ghost tut-card-restart" data-tut-restart="${tut.id}">${t('hub.restart')}</button>
        `;
    } else if (hasProgress) {
        actionBtn = `
            <button class="btn btn-ghost tut-card-restart" data-tut-restart="${tut.id}">${t('hub.restart')}</button>
            <button class="btn btn-primary tut-card-cta" data-tut-resume="${tut.id}" style="background:${tut.color};border-color:${tut.color};box-shadow:0 4px 18px -4px ${tut.color}55">${t('hub.resume')} →</button>
        `;
    } else {
        actionBtn = `
            <span class="tut-card-hint">${t('hub.notStartedHint')}</span>
            <button class="btn btn-primary tut-card-cta" data-tut-start="${tut.id}" style="background:${tut.color};border-color:${tut.color};box-shadow:0 4px 18px -4px ${tut.color}55">${t('hub.start')} →</button>
        `;
    }

    // Progress label
    const progressLabel = complete
        ? `<span style="color:var(--success);font-weight:700">${t('hub.completed')} ✓</span>`
        : `${done}/${total} ${t('hub.stepsLabel')}`;

    return `
        <div class="tut-card ${complete ? 'is-complete' : hasProgress ? 'has-progress' : ''}" style="--tut-color:${tut.color}">
            <div class="tut-card-main">
                <div class="tut-card-header-row">
                    <div class="tut-card-icon-wrap" style="color:${tut.color};background:${tut.color}18;border-color:${tut.color}30">
                        ${tut.icon}
                    </div>
                    <div class="tut-card-info">
                        <h3 class="tut-card-title">${t(tut.title_key)}</h3>
                        <p class="tut-card-desc">${t(tut.desc_key)}</p>
                    </div>
                    <div class="tut-card-badges-col">
                        <span class="tut-card-parts-badge">${tut.parts.length} ${t('hub.parts')}</span>
                    </div>
                </div>

                <div class="tut-card-progress-row">
                    <div class="tut-card-progress-bar">
                        <div class="tut-card-progress-fill" style="width:${pct}%;background:${tut.color}"></div>
                    </div>
                    <span class="tut-card-progress-label">${progressLabel}</span>
                </div>

                <div class="tut-hub-parts-row">${partChips}</div>
            </div>
            <div class="tut-card-actions">
                ${actionBtn}
            </div>
        </div>
    `;
}

function _launchTutorial(tutId: string, resume: boolean): void {
    const tut = TUTORIALS.find(t => t.id === tutId);
    if (!tut) return;

    closeTutorialHub();

    let partId: string | null = null;
    let stepId: string | null = null;
    if (resume) {
        const pos = getLastPosition(tutId);
        partId = pos.partId;
        stepId = pos.stepId;
    }

    startTutorialEngine(tut, partId, stepId, openTutorialHub);
}
