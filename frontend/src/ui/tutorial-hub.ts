// @ts-nocheck
/**
 * tutorial-hub.ts — Central tutorial hub overlay for BMM.
 *
 * Shows a list of all available tutorials with per-tutorial progress.
 * Users can start/resume/restart any tutorial from here.
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
}

export function closeTutorialHub(): void {
    const overlay = document.getElementById('tut-hub-overlay');
    if (overlay) {
        overlay.classList.add('closing');
        overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
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
                    <img src="assets/Tasky_Happy.png" alt="Tasky" class="tut-hub-mascot" />
                    <div>
                        <h2 class="tut-hub-title">${t('hub.title')}</h2>
                        <p class="tut-hub-subtitle">${t('hub.subtitle')}</p>
                    </div>
                </div>
                <button class="tut-hub-close" id="btn-hub-close" title="${t('hub.close')}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            <div class="tut-hub-list">
                ${tutorialCards}
            </div>

            <div class="tut-hub-footer">
                <span class="tut-hub-footer-text">${t('hub.footer')}</span>
            </div>
        </div>
    `;

    // Close hub on backdrop click
    document.getElementById('tut-hub-backdrop')?.addEventListener('click', closeTutorialHub);
    document.getElementById('btn-hub-close')?.addEventListener('click', closeTutorialHub);

    // Bind tutorial card buttons
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
            _renderHub(overlay); // re-render with reset progress
        });
    });
    overlay.querySelectorAll('[data-tut-resume]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tutId = (btn as HTMLElement).dataset.tutResume!;
            _launchTutorial(tutId, true);
        });
    });
}

function _renderTutorialCard(tut: TutorialDef): string {
    const stepKeys = getAllStepKeys(tut);
    const { done, total } = getTutorialCompletion(tut.id, stepKeys);
    const complete = isTutorialComplete(tut.id, stepKeys);
    const { partId, stepId } = getLastPosition(tut.id);
    const hasProgress = done > 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const allStatuses = getAllStepStatuses(tut.id);

    // Mini step badge row
    const miniBadges = stepKeys.map(key => {
        const s = allStatuses[key] ?? { state: 'pending' };
        return `<span class="tut-mini-badge tut-badge-${s.state}" title="${t(`hub.badge.${s.state}`)}"></span>`;
    }).join('');

    // Parts summary
    const partsSummary = tut.parts.map(p => {
        const partDone = p.steps.filter(s => allStatuses[`${p.id}:${s.id}`]?.state === 'complete').length;
        const partPct = p.steps.length > 0 ? Math.round((partDone / p.steps.length) * 100) : 0;
        return `
            <div class="tut-part-row">
                <span class="tut-part-name">${t(p.title_key)}</span>
                <div class="tut-part-bar"><div class="tut-part-bar-fill" style="width:${partPct}%; background:${tut.color}"></div></div>
                <span class="tut-part-pct">${partPct}%</span>
            </div>
        `;
    }).join('');

    // Action button
    let actionBtn = '';
    if (complete) {
        actionBtn = `
            <div class="tut-card-complete-badge">${t('hub.completed')} ✓</div>
            <button class="btn btn-ghost tut-card-restart" data-tut-restart="${tut.id}" style="font-size:11px">${t('hub.restart')}</button>
        `;
    } else if (hasProgress) {
        actionBtn = `
            <button class="btn btn-primary tut-card-cta" data-tut-resume="${tut.id}" style="background:${tut.color};border-color:${tut.color}">${t('hub.resume')}</button>
            <button class="btn btn-ghost tut-card-restart" data-tut-restart="${tut.id}" style="font-size:11px">${t('hub.restart')}</button>
        `;
    } else {
        actionBtn = `
            <button class="btn btn-primary tut-card-cta" data-tut-start="${tut.id}" style="background:${tut.color};border-color:${tut.color}">${t('hub.start')}</button>
        `;
    }

    // Assets badge
    const assetsBadge = tut.assets?.length ? `
        <div class="tut-assets-badge" title="${t('hub.assets.title')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            ${tut.assets.length} ${t('hub.assets.count')}
        </div>
    ` : '';

    return `
        <div class="tut-card ${complete ? 'is-complete' : ''}" style="--tut-color:${tut.color}">
            <div class="tut-card-left">
                <div class="tut-card-icon" style="color:${tut.color}">${tut.icon}</div>
            </div>
            <div class="tut-card-body">
                <div class="tut-card-top">
                    <div>
                        <h3 class="tut-card-title">${t(tut.title_key)}</h3>
                        <p class="tut-card-desc">${t(tut.desc_key)}</p>
                    </div>
                    <div class="tut-card-meta">
                        ${assetsBadge}
                        <span class="tut-card-parts">${tut.parts.length} ${t('hub.parts')}</span>
                    </div>
                </div>

                <div class="tut-mini-badges">${miniBadges}</div>

                <div class="tut-card-progress-bar">
                    <div class="tut-card-progress-fill" style="width:${pct}%; background:${tut.color}"></div>
                </div>
                <div class="tut-card-progress-label">${done}/${total} ${t('hub.stepsLabel')}</div>

                <details class="tut-parts-details">
                    <summary>${t('hub.showParts')}</summary>
                    <div class="tut-parts-list">${partsSummary}</div>
                </details>
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

// ── Assets panel ─────────────────────────────────────────────────────────────

export function openAssetsPanel(tutId: string): void {
    const tut = TUTORIALS.find(t => t.id === tutId);
    if (!tut?.assets?.length) return;

    const existing = document.getElementById('tut-assets-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tut-assets-overlay';
    overlay.className = 'tut-assets-overlay';

    const items = tut.assets.map(a => `
        <div class="tut-asset-item">
            <div class="tut-asset-type-badge tut-asset-${a.type}">${t(`hub.assets.type.${a.type}`)}</div>
            <div class="tut-asset-info">
                <strong>${t(a.name_key)}</strong>
                <p>${t(a.desc_key)}</p>
                <small class="tut-asset-usage">${t(a.usage_key)}</small>
            </div>
        </div>
    `).join('');

    overlay.innerHTML = `
        <div class="tut-assets-container">
            <div class="tut-assets-header">
                <h3>${t('hub.assets.title')}</h3>
                <button class="tut-hub-close" id="btn-assets-close">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <p class="tut-assets-desc">${t('hub.assets.desc')}</p>
            <div class="tut-asset-list">${items}</div>
        </div>
    `;

    document.getElementById('app-window-outer')?.appendChild(overlay);
    document.getElementById('btn-assets-close')?.addEventListener('click', () => overlay.remove());
}
