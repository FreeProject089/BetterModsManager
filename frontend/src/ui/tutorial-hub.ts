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
                <button class="tut-hub-close" id="btn-hub-close" title="${t('hub.close')}">
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
            _maybePromptAssetsThenLaunch(tutId, false);
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
    overlay.querySelectorAll('[data-tut-assets]').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const tutId = (badge as HTMLElement).dataset.tutAssets!;
            openAssetsPanel(tutId);
        });
    });
}

function _maybePromptAssetsThenLaunch(tutId: string, resume: boolean): void {
    const tut = TUTORIALS.find(t => t.id === tutId);
    if (!tut?.assets?.length) { _launchTutorial(tutId, resume); return; }

    const overlay = document.createElement('div');
    overlay.className = 'tut-assets-prompt-overlay';
    overlay.innerHTML = `
        <div class="tut-assets-prompt">
            <div class="tut-assets-prompt-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${tut.color}" stroke-width="2.2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </div>
            <h3>${t('hub.assets.promptTitle')}</h3>
            <p>${t('hub.assets.promptDesc').replace('{n}', String(tut.assets.length))}</p>
            <ul class="tut-assets-prompt-list">
                ${tut.assets.map(a => `<li><strong>${t(a.name_key)}</strong> <span class="tut-asset-type-badge tut-asset-${a.type}">${t(`hub.assets.type.${a.type}`)}</span></li>`).join('')}
            </ul>
            <div class="tut-assets-prompt-btns">
                <button class="btn btn-ghost" id="btn-prompt-skip">${t('hub.assets.skipBtn')}</button>
                <button class="btn btn-primary" id="btn-prompt-view" style="background:${tut.color};border-color:${tut.color}">${t('hub.assets.viewBtn')}</button>
            </div>
        </div>
    `;
    document.getElementById('app-window-outer')?.appendChild(overlay);

    overlay.querySelector('#btn-prompt-skip')?.addEventListener('click', () => {
        overlay.remove();
        _launchTutorial(tutId, resume);
    });
    overlay.querySelector('#btn-prompt-view')?.addEventListener('click', () => {
        overlay.remove();
        openAssetsPanel(tutId, () => _launchTutorial(tutId, resume));
    });
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

        return `<div class="${chipClass}" style="${partInProgress ? `--part-color:${tut.color}` : ''}">
            ${icon}
            <span>${t(p.title_key)}</span>
            <span class="tut-hub-part-count">${partDone}/${partTotal}</span>
        </div>`;
    }).join('');

    // Assets badge (clickable)
    const assetsBadge = tut.assets?.length ? `
        <button class="tut-assets-badge" data-tut-assets="${tut.id}" title="${t('hub.assets.title')}" type="button">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            ${tut.assets.length} ${t('hub.assets.count')}
        </button>
    ` : '';

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
                        ${assetsBadge}
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

// ── Assets panel ─────────────────────────────────────────────────────────────

export function openAssetsPanel(tutId: string, onContinue?: () => void): void {
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

    const continueBtnHtml = onContinue
        ? `<button class="btn btn-primary" id="btn-assets-continue" style="background:${tut.color};border-color:${tut.color}">${t('hub.assets.continueBtn')}</button>`
        : '';

    overlay.innerHTML = `
        <div class="tut-assets-container">
            <div class="tut-assets-header">
                <h3>${t('hub.assets.title')}</h3>
                <button class="tut-hub-close" id="btn-assets-close">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <p class="tut-assets-desc">${t('hub.assets.desc')}</p>
            <div class="tut-asset-list">${items}</div>
            <div class="tut-assets-actions">
                <button class="btn btn-ghost tut-assets-download-btn" id="btn-assets-download">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    ${t('hub.assets.downloadBtn')}
                </button>
                ${continueBtnHtml}
            </div>
            <p class="tut-assets-path">assets/tutorial-assets/</p>
        </div>
    `;

    document.getElementById('app-window-outer')?.appendChild(overlay);
    document.getElementById('btn-assets-close')?.addEventListener('click', () => overlay.remove());
    document.getElementById('btn-assets-download')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-assets-download') as HTMLButtonElement | null;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;animation:spin 1s linear infinite"><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.8"/><circle cx="12" cy="12" r="10" stroke-opacity="0.2"/></svg>${t('hub.assets.saving')}`;
        }
        try {
            const tauri = (window as any).__TAURI__;

            // 1. Get the bundled source path
            const assetsPath: string = await tauri.invoke('get_tutorial_assets_path');

            // 2. Show folder picker — user chooses where to save
            const destDir: string | null = await tauri.dialog.open({
                directory: true,
                multiple: false,
                title: t('hub.assets.saveDialogTitle'),
            });

            if (!destDir) {
                // User cancelled the dialog
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${t('hub.assets.downloadBtn')}`;
                }
                return;
            }

            // 3. Copy tutorial-assets folder to chosen destination
            const finalPath: string = await tauri.invoke('export_tutorial_assets', {
                source: assetsPath,
                destination: destDir,
            });

            // 4. Open the resulting folder so the user can see it, then close overlay
            await tauri.invoke('open_folder', { path: finalPath });
            overlay.remove();
        } catch (err) {
            console.error('[tutorial-hub] export_tutorial_assets failed:', err);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${t('hub.assets.downloadBtn')}`;
            }
        }
    });
    document.getElementById('btn-assets-continue')?.addEventListener('click', () => {
        overlay.remove();
        if (onContinue) onContinue();
    });
}
