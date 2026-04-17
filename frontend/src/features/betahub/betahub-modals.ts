/**
 * betahub-modals.ts — BetaHub Feedback & Bug Report Modals
 * Manages the UI and submission logic for both BetaHub modals.
 */

import { t, applyTranslations } from '../../core/i18n.js';
import { BETAHUB_PROJECT_ID } from './betahub-config.local.js';
import { invoke, pickFile } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { solvePoW } from './betahub-pow.js';
import {
    createDraftIssue,
    uploadScreenshot,
    uploadVideoClip,
    uploadLogContents,
    uploadBinaryFile,
    publishIssue,
    createFeatureRequest,
} from './betahub-api.js';

// =============================================================================
// State
// =============================================================================

let powAbortController: AbortController | null = null;
let selectedCrashZipPaths: string[] = [];
let selectedManualCrashZip: File | null = null;
let selectedScreenshots: File[] = [];
let selectedFeedbackScreenshots: File[] = [];
let selectedVideo: File | null = null;
let dynamicSteps: string[] = [""]; // Default one empty step
let activeExplorerTab: 'crash' | 'session' = 'crash';

let powFeedbackResult: any = null;
let powBugResult: any = null;
// =============================================================================
// Public API
// =============================================================================

export function initBetaHub(): void {
    wireFeedbackModal();
    wireBugReportModal();
    wireHistoryUI();

    renderReportHistory();

    // Global click-outside to close for BetaHub overlays
    // Note: must check overlay OR modal-container (the inner flex wrapper)
    document.querySelectorAll('.bh-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            const target = e.target as Element;
            if (target === overlay || target.classList.contains('modal-container')) {
                overlay.classList.remove('open');
            }
        });
    });
}

/**
 * Open the Feedback/Suggestion modal.
 */
export function openFeedbackModal(): void {
    resetFeedbackForm();
    const modal = document.getElementById('modal-betahub-feedback');
    if (modal) {
        modal.classList.add('open');
        const pow = document.getElementById('bh-feedback-pow');
        if (pow) pow.classList.add('bh-theme-feedback');
        
        // Force localization to avoid raw i18n keys
        applyTranslations(modal);
    }
}

/**
 * Open the Bug Report modal.
 * Automatically selects the most recent crash and session report.
 * @param crashZipPath Optional path to crash zip to auto-attach (overrides auto-select)
 */
export function openBugReportModal(crashZipPath?: string): void {
    resetBugReportForm();
    selectedCrashZipPaths = [];

    if (crashZipPath) {
        selectedCrashZipPaths.push(crashZipPath);
        updateCrashZipDisplay();
        renderCrashReports();
    } else {
        // Auto-attach the most recent crash + session report
        autoAttachLatestReports().then(() => {
            updateCrashZipDisplay();
            renderCrashReports();
        });
    }

    const modal = document.getElementById('modal-betahub-bugreport');
    if (modal) {
        modal.classList.add('open');
        const pow = document.getElementById('bh-bug-pow');
        if (pow) pow.classList.add('bh-theme-bug');
        applyTranslations(modal);
    }
}

/**
 * Auto-attach the most recent crash report and session report.
 * Selects one of each category (max 2 total).
 */
async function autoAttachLatestReports(): Promise<void> {
    try {
        const reports = await invoke('list_crash_reports') as any[];
        reports.sort((a: any, b: any) => parseInt(b.date) - parseInt(a.date));

        const latestCrash = reports.find((r: any) => {
            const cat = (r.category || '').toLowerCase();
            return cat === 'crash' || cat === 'archive/crash';
        });
        const latestSession = reports.find((r: any) => {
            const cat = (r.category || '').toLowerCase();
            return cat === 'session' || cat === 'archive/session';
        });

        if (latestCrash) selectedCrashZipPaths.push(latestCrash.path);
        if (latestSession) selectedCrashZipPaths.push(latestSession.path);
    } catch (e) {
        console.warn('[BetaHub] Auto-attach failed:', e);
    }
}

// =============================================================================
// Feedback Modal
// =============================================================================

function wireFeedbackModal(): void {
    const form = document.getElementById('betahub-feedback-form') as HTMLFormElement | null;
    if (!form) return;

    wireStrengthGauge('feedback');

    // Character counter
    const descEl = document.getElementById('bh-feedback-desc') as HTMLTextAreaElement | null;
    const descCount = document.getElementById('bh-feedback-desc-count');
    if (descEl && descCount) {
        descEl.addEventListener('input', () => {
            const len = descEl.value.length;
            descCount.textContent = `${len}/4500`;
            descCount.style.color = len > 4200 ? 'var(--error, #ef4444)' : 'var(--text-muted)';
        });
    }

    // Close buttons
    // Screenshots input
    const ssInput = document.getElementById('bh-feedback-screenshots') as HTMLInputElement | null;
    if (ssInput) {
        ssInput.addEventListener('change', () => handleScreenshotSelection(ssInput, 'feedback'));
    }

    // Submit
    const submitBtn = document.getElementById('bh-feedback-submit') as HTMLButtonElement | null;
    if (submitBtn) {
        submitBtn.addEventListener('click', () => handleFeedbackSubmit());
    }

    document.querySelectorAll('[data-close="modal-betahub-feedback"]').forEach(btn => {
        btn.addEventListener('click', () => closeFeedbackModal());
    });

    // Outside click — check both overlay and its modal-container child
    const overlay = document.getElementById('modal-betahub-feedback');
    overlay?.addEventListener('click', (e) => {
        const target = e.target as Element;
        if (target === overlay || target.classList.contains('modal-container')) {
            closeFeedbackModal();
        }
    });
}

function resetFeedbackForm(): void {
    const form = document.getElementById('betahub-feedback-form') as HTMLFormElement | null;
    if (form) form.reset();
    
    selectedFeedbackScreenshots = [];
    renderScreenshotList('feedback');

    const descCount = document.getElementById('bh-feedback-desc-count');
    if (descCount) { descCount.textContent = '0/4500'; descCount.style.color = ''; }

    // Reset due date to empty (will be auto-calculated)
    const dateInput = document.getElementById('bh-feedback-due-date') as HTMLInputElement | null;
    if (dateInput) dateInput.value = "";

    setPowState('feedback', 'idle');
    setSubmitState('feedback', false);
    clearFieldErrors('bh-feedback');
}

function closeFeedbackModal(): void {
    powAbortController?.abort();
    powAbortController = null;
    powFeedbackResult = null;
    const modal = document.getElementById('modal-betahub-feedback');
    if (modal) modal.classList.remove('open');
}

function wirePowInteractivity(modal: 'feedback' | 'bug'): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const check = document.getElementById(`bh-${prefix}-pow-check`) as HTMLInputElement | null;
    if (!check) return;

    check.addEventListener('change', async () => {
        if (!check.checked) {
            powAbortController?.abort();
            powAbortController = null;
            if (modal === 'feedback') powFeedbackResult = null;
            else powBugResult = null;
            setPowState(modal, 'idle');
            return;
        }

        // Start Solving
        setPowState(modal, 'solving');
        try {
            powAbortController = new AbortController();
            const result = await solvePoW({
                difficulty: 4,
                signal: powAbortController.signal,
                onProgress: (nonce) => updatePowProgress(modal, nonce),
            });
            
            if (modal === 'feedback') powFeedbackResult = result;
            else powBugResult = result;
            
            setPowState(modal, 'done');
        } catch (err: any) {
            if (err.name === 'AbortError') return;
            console.error('[BetaHub] PoW Error:', err);
            check.checked = false;
            setPowState(modal, 'idle');
            toast(`${t('betahub.errorPowFailed')}: ${err.message || err}`, 'error');
        } finally {
            powAbortController = null;
        }
    });
}

async function handleFeedbackSubmit(): Promise<void> {
    const descEl = document.getElementById('bh-feedback-desc') as HTMLTextAreaElement | null;
    const titleEl = document.getElementById('bh-feedback-title') as HTMLInputElement | null;
    const emailEl = document.getElementById('bh-feedback-email') as HTMLInputElement | null;
    const discordEl = document.getElementById('bh-feedback-discord') as HTMLInputElement | null;
    const dateEl = document.getElementById('bh-feedback-due-date') as HTMLInputElement | null;

    let description = descEl?.value?.trim() || '';
    if (description.length < 10) {
        showFieldError('bh-feedback-desc', t('betahub.errorDescTooShort'));
        return;
    }
    if (description.length > 4500) {
        showFieldError('bh-feedback-desc', t('betahub.errorDescTooLong'));
        return;
    }

    clearFieldErrors('bh-feedback');
    setSubmitState('feedback', true);
    setSubmitLoading('feedback', true);
    setPowState('feedback', 'solving');

    try {
        if (!powFeedbackResult) {
            toast(t('betahub.errorVerifyFirst'), 'warning');
            setSubmitState('feedback', false);
            return;
        }

        const creatorId = await invoke('get_creator_id').catch(() => t('common.unknown'));
        const discordId = discordEl?.value?.trim() || t('common.na');
        description += `\n\n${t('betahub.contextHeader')}\nCreator ID: ${creatorId}\nDiscord: ${discordId}`;

        const dueDate = getEffectiveDueDate(dateEl?.value);

        setPowState('feedback', 'upload');

        // Submit
        const result = await createFeatureRequest(
            description,
            emailEl?.value?.trim() || undefined,
            discordEl?.value?.trim() || undefined,
            titleEl?.value?.trim() || undefined,
            dueDate
        );

        saveReportToHistory('feedback', titleEl?.value?.trim() || t('betahub.themeFeedback'), (result as any)?.id || 'N/A');

        closeFeedbackModal();
        toast(t('betahub.successFeedback'), 'success');
    } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('[BetaHub] Feedback submit error:', err);
        setPowState('feedback', 'idle');
        toast(`${t('betahub.errorSubmit')}: ${err.message || err}`, 'error');
    } finally {
        setSubmitLoading('feedback', false);
        setSubmitState('feedback', false);
        powAbortController = null;
    }
}

// =============================================================================
// Bug Report Modal
// =============================================================================

function wireBugReportModal(): void {
    wireStrengthGauge('bug');

    // Character counters
    wireCharCounter('bh-bug-desc', 'bh-bug-desc-count', 4500);

    // Refresh reports
    const refreshBtn = document.getElementById('bh-bug-refresh-reports');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => renderCrashReports());
    }

    // Dynamic steps
    const addStepBtn = document.getElementById('bh-bug-add-step');
    if (addStepBtn) {
        addStepBtn.addEventListener('click', () => {
            if (dynamicSteps.length >= 50) {
                toast(t('betahub.errorMaxSteps'), 'warning');
                return;
            }
            dynamicSteps.push("");
            renderSteps();
        });
    }

    // Manual Crash Zip
    const addCrashBtn = document.getElementById('bh-bug-crash-add');
    if (addCrashBtn) {
        addCrashBtn.addEventListener('click', async () => {
            const path = await pickFile(['zip']);
            if (path) {
                if (!selectedCrashZipPaths.includes(path)) {
                    if (selectedCrashZipPaths.length >= 3) {
                        toast(t('betahub.errorMaxZips'), 'warning');
                        return;
                    }
                    selectedCrashZipPaths.push(path);
                }
                updateCrashZipDisplay();
                renderCrashReports();
            }
        });
    }

    const removeCrashBtn = document.getElementById('bh-bug-crash-remove');
    if (removeCrashBtn) {
        removeCrashBtn.addEventListener('click', () => {
            selectedCrashZipPaths = [];
            updateCrashZipDisplay();
            renderCrashReports();
        });
    }

    // Screenshot file input
    const ssInput = document.getElementById('bh-bug-screenshots') as HTMLInputElement | null;
    if (ssInput) {
        ssInput.addEventListener('change', () => handleScreenshotSelection(ssInput, 'bug'));
    }

    // Video file input
    const vidInput = document.getElementById('bh-bug-video') as HTMLInputElement | null;
    if (vidInput) {
        vidInput.addEventListener('change', () => handleVideoSelection(vidInput));
    }

    // Submit
    const submitBtn = document.getElementById('bh-bug-submit') as HTMLButtonElement | null;
    if (submitBtn) {
        submitBtn.addEventListener('click', () => handleBugReportSubmit());
    }

    // Tabs
    document.querySelectorAll('.bh-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            const tabName = target.dataset.bhTab as 'crash' | 'session';
            if (!tabName || tabName === activeExplorerTab) return;

            // UI Update
            document.querySelectorAll('.bh-tab').forEach(t => t.classList.remove('active'));
            target.classList.add('active');

            activeExplorerTab = tabName;
            renderCrashReports();
        });
    });

    // Close buttons
    wirePowInteractivity('feedback');
    wirePowInteractivity('bug');

    document.querySelectorAll('[data-close="modal-betahub-bugreport"]').forEach(btn => {
        (btn as HTMLElement).onclick = (e: MouseEvent) => {
            e.preventDefault();
            closeBugReportModal();
        };
    });

    // Outside click — check both overlay and its modal-container child
    const overlay = document.getElementById('modal-betahub-bugreport');
    overlay?.addEventListener('click', (e) => {
        const target = e.target as Element;
        if (target === overlay || target.classList.contains('modal-container')) {
            closeBugReportModal();
        }
    });
}

interface CrashReportEntry {
    name: string;
    path: string;
    size: number;
    date: string;
    is_archived: boolean;
}

async function renderCrashReports(): Promise<void> {
    const list = document.getElementById('bh-bug-report-list');
    if (!list) return;

    list.innerHTML = `<div class="bh-report-loading" style="padding:15px;text-align:center;font-size:12px;color:var(--text-muted)">${t('common.loading')}</div>`;

    try {
        let reports = await invoke('list_crash_reports') as any[];
        
        // 1. Sort by date (backend might only string sort, let's be sure)
        // Date is a timestamp string in seconds
        reports.sort((a, b) => parseInt(b.date) - parseInt(a.date));

        // 2. Filter by active tab
        reports = reports.filter(r => {
            const cat = (r.category || '').toLowerCase();
            if (activeExplorerTab === 'crash') {
                return cat === 'crash' || cat === 'archive/crash';
            } else {
                return cat === 'session' || cat === 'archive/session';
            }
        });

        if (reports.length === 0) {
            list.innerHTML = `<div class="bh-report-empty" data-i18n="betahub.noReports">${t('betahub.noReports')}</div>`;
            return;
        }

        list.innerHTML = '';
        reports.forEach((report, index) => {
            const normalizedReportPath = report.path.replace(/\\/g, '/');
            const isSelected = selectedCrashZipPaths.some(p => p.replace(/\\/g, '/') === normalizedReportPath);
            const item = document.createElement('div');
            item.className = `bh-report-item ${isSelected ? 'selected' : ''}`;
            item.style.animationDelay = `${index * 0.05}s`;
            
            const isArchived = (report.category || '').toLowerCase().includes('archive');
            const dateStr = formatDate(parseInt(report.date));
            const icon = activeExplorerTab === 'crash' ? `
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            ` : `
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            `;

            item.innerHTML = `
                <div class="bh-report-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        ${icon}
                    </svg>
                </div>
                <div class="bh-report-info">
                    <div class="bh-report-name">${report.name}</div>
                    <div class="bh-report-meta">${dateStr} • ${formatFileSize(report.size)}${isArchived ? ` <span style="opacity:0.6;font-style:italic"> (${t('betahub.archived')})</span>` : ''}</div>
                </div>
                ${isSelected ? `
                    <div class="bh-report-check">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                ` : ''}
            `;
            item.addEventListener('click', () => {
                if (isSelected) {
                    selectedCrashZipPaths = selectedCrashZipPaths.filter(p => p !== report.path);
                } else {
                    if (selectedCrashZipPaths.length >= 3) {
                        toast(t('betahub.errorMaxZips'), 'warning');
                        return;
                    }
                    selectedCrashZipPaths.push(report.path);
                }
                updateCrashZipDisplay();
                renderCrashReports(); // Refresh selection state
            });
            list.appendChild(item);
        });
    } catch (err) {
        list.innerHTML = `<div class="bh-report-error" style="color:#ef4444;padding:10px;font-size:11px">${t('betahub.errorListReports')}: ${err}</div>`;
    }
}

function formatDate(timestamp: number): string {
    const d = new Date(timestamp * 1000);
    return d.toLocaleString(undefined, {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function wireCharCounter(inputId: string, counterId: string, max: number): void {
    const el = document.getElementById(inputId) as HTMLTextAreaElement | null;
    const counter = document.getElementById(counterId);
    if (!el || !counter) return;
    counter.textContent = `0/${max}`;
    el.addEventListener('input', () => {
        const len = el.value.length;
        counter.textContent = `${len}/${max}`;
        counter.style.color = len > max * 0.93 ? 'var(--error, #ef4444)' : 'var(--text-muted)';
    });
}

async function convertToPng(file: File): Promise<File> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(file);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(blob => {
                if (!blob) return resolve(file);
                const name = file.name.replace(/\.[^/.]+$/, ".png");
                resolve(new File([blob], name, { type: 'image/png' }));
            }, 'image/png');
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
    });
}

async function handleScreenshotSelection(input: HTMLInputElement, modal: 'bug' | 'feedback'): Promise<void> {
    const files = Array.from(input.files || []);
    // BetaHub only accepts: image/png, image/jpeg, image/jpg
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    const maxSize = 5 * 1024 * 1024; // 5MB
    const targetList = modal === 'bug' ? selectedScreenshots : selectedFeedbackScreenshots;

    for (let file of files) {
        const isWebp = file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp');
        if (isWebp) {
            file = await convertToPng(file);
        }

        // Also check by extension for files without proper MIME type
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const validByExt = ['png', 'jpg', 'jpeg'].includes(ext);
        if (!validTypes.includes(file.type) && !validByExt) {
            toast(`${file.name}: ${t('betahub.errorUnsupportedImage')}`, 'warning');
            continue;
        }
        if (file.size > maxSize) {
            toast(t('betahub.errorScreenshotTooLarge').replace('{name}', file.name), 'warning');
            continue;
        }
        if (targetList.length >= 3) {
            toast(t('betahub.errorMaxScreenshots'), 'warning');
            break;
        }
        targetList.push(file);
    }
    input.value = '';
    renderScreenshotList(modal);
}

function handleVideoSelection(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;

    const validTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/avi'];
    const maxSize = 50 * 1024 * 1024; // 50MB

    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp4|webm|mov|avi)$/i)) {
        toast(t('betahub.errorInvalidVideo'), 'warning');
        input.value = '';
        return;
    }
    if (file.size > maxSize) {
        toast(t('betahub.errorVideoTooLarge'), 'warning');
        input.value = '';
        return;
    }
    selectedVideo = file;
    input.value = '';
    renderVideoPreview();
}

function renderSteps(): void {
    const container = document.getElementById('bh-bug-steps-container');
    if (!container) return;

    updateStrengthGauge('bug', calculateSubmissionStrength('bug'));

    container.innerHTML = dynamicSteps.map((step, i) => `
        <div class="bh-step-item">
            <div class="bh-step-badge">
                <span class="bh-step-index">${String(i + 1).padStart(2, '0')}</span>
            </div>
            <div class="bh-step-content">
                <textarea class="bh-step-input" placeholder="${t('betahub.stepPlaceholder', { n: String(i + 1) })}" data-step-idx="${i}">${step}</textarea>
            </div>
            ${dynamicSteps.length > 1 ? `
                <button type="button" class="bh-step-remove" title="${t('common.remove')}" data-remove-step="${i}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            ` : ''}
        </div>
    `).join('');

    // Re-wire inputs
    container.querySelectorAll('.bh-step-input').forEach(el => {
        el.addEventListener('input', (e) => {
            const idx = parseInt((e.target as HTMLElement).dataset.stepIdx!, 10);
            dynamicSteps[idx] = (e.target as HTMLTextAreaElement).value;
        });
    });

    // Re-wire remove buttons
    container.querySelectorAll('[data-remove-step]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt((e.currentTarget as HTMLElement).dataset.removeStep!, 10);
            dynamicSteps.splice(idx, 1);
            renderSteps();
        });
    });
}

function renderScreenshotList(modal: 'bug' | 'feedback'): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const list = document.getElementById(`bh-${prefix}-screenshots-list`);
    const targetList = modal === 'bug' ? selectedScreenshots : selectedFeedbackScreenshots;
    
    if (!list) return;

    updateStrengthGauge(modal, calculateSubmissionStrength(modal));
    list.innerHTML = '';
    targetList.forEach((file, i) => {
        const item = document.createElement('div');
        item.className = 'bh-file-item';
        item.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span class="bh-file-name bh-file-item-name">${file.name}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                <span style="font-size:10px;opacity:0.6">${formatFileSize(file.size)}</span>
                <button type="button" class="bh-remove-file-btn" data-remove-ss="${i}" data-modal="${modal}" title="${t('betahub.removeFile')}">✕</button>
            </div>
        `;
        list.appendChild(item);
    });

    // Re-wire remove
    list.querySelectorAll('[data-remove-ss]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const el = e.currentTarget as HTMLElement;
            const idx = parseInt(el.dataset.removeSs!, 10);
            const m = el.dataset.modal as 'bug' | 'feedback';
            if (m === 'bug') selectedScreenshots.splice(idx, 1);
            else selectedFeedbackScreenshots.splice(idx, 1);
            renderScreenshotList(m);
        });
    });

    const addBtn = document.getElementById(`bh-${prefix}-screenshots-add`);
    if (addBtn) {
        addBtn.style.display = targetList.length >= 3 ? 'none' : '';
        const limitText = addBtn.querySelector('.bh-btn-limit') || document.createElement('span');
        (limitText as HTMLElement).className = 'bh-btn-limit';
        (limitText as HTMLElement).style.marginLeft = '4px';
        (limitText as HTMLElement).style.opacity = '0.6';
        limitText.textContent = t('betahub.filesSelected', { count: String(targetList.length) });
        if (!addBtn.contains(limitText)) addBtn.appendChild(limitText);
    }
}

function renderVideoPreview(): void {
    const preview = document.getElementById('bh-bug-video-preview');
    const addBtn = document.getElementById('bh-bug-video-add');
    if (!preview) return;

    if (selectedVideo) {
        preview.innerHTML = `
            <div class="bh-file-item">
                <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
                        <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                    </svg>
                    <span class="bh-file-name bh-file-item-name">${selectedVideo.name}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                    <span style="font-size:10px;opacity:0.6">${formatFileSize(selectedVideo.size)}</span>
                    <button type="button" class="bh-remove-file-btn" id="bh-bug-video-remove" title="${t('betahub.removeFile')}">✕</button>
                </div>
            </div>
        `;
        document.getElementById('bh-bug-video-remove')?.addEventListener('click', () => {
            selectedVideo = null;
            renderVideoPreview();
        });
        if (addBtn) {
            addBtn.style.display = 'none';
        }
    } else {
        preview.innerHTML = '';
        if (addBtn) {
            addBtn.style.display = '';
            const limitText = addBtn.querySelector('.bh-btn-limit') || document.createElement('span');
            (limitText as HTMLElement).className = 'bh-btn-limit';
            (limitText as HTMLElement).style.marginLeft = '4px';
            (limitText as HTMLElement).style.opacity = '0.6';
            limitText.textContent = '(0/1)';
            if (!addBtn.contains(limitText)) addBtn.appendChild(limitText);
        }
    }
}

function updateCrashZipDisplay(): void {
    const autoSection = document.getElementById('bh-bug-crash-section');
    const manualDisplay = document.getElementById('bh-bug-crash-display');
    const manualAddBtn = document.getElementById('bh-bug-crash-add');
    const filenameEl = document.getElementById('bh-bug-crash-filename');
    const pathEl = document.getElementById('bh-bug-crash-path');

    updateStrengthGauge('bug', calculateSubmissionStrength('bug'));

    if (selectedCrashZipPaths.length > 0) {
        const count = selectedCrashZipPaths.length;
        const lastFile = selectedCrashZipPaths[count - 1].split(/[\\/]/).pop();
        const displayText = count > 1 ? `${t('betahub.filesSelected', { count: String(count) })} (${lastFile})` : lastFile;

        if (manualDisplay) {
            manualDisplay.style.display = 'flex';
            if (filenameEl) filenameEl.textContent = displayText || '';
        }
        if (manualAddBtn) manualAddBtn.style.display = count >= 3 ? 'none' : 'flex';
        // Auto section logic for trace auto-attach
        if (autoSection) autoSection.style.display = selectedCrashZipPaths.some(p => p.toLowerCase().includes('trace')) ? 'block' : 'none';
    } else {
        if (autoSection) autoSection.style.display = 'none';
        if (manualDisplay) manualDisplay.style.display = 'none';
        if (manualAddBtn) manualAddBtn.style.display = 'flex';
    }
}

function resetBugReportForm(): void {
    const form = document.getElementById('betahub-bugreport-form') as HTMLFormElement | null;
    if (form) form.reset();
    
    // Clear State
    selectedScreenshots = [];
    selectedVideo = null;
    selectedCrashZipPaths = [];
    selectedManualCrashZip = null;
    dynamicSteps = [""];

    // Update UI Counters
    const descCount = document.getElementById('bh-bug-desc-count');
    if (descCount) { 
        descCount.textContent = '0/4500'; 
        descCount.style.color = ''; 
    }

    // Refresh All Lists
    renderSteps();
    renderScreenshotList('bug');
    renderVideoPreview();
    updateCrashZipDisplay();
    renderCrashReports(); // Refresh the explorer list too

    setPowState('bug', 'idle');
    setSubmitState('bug', false);
    clearFieldErrors('bh-bug');
}

function closeBugReportModal(): void {
    powAbortController?.abort();
    powAbortController = null;
    powBugResult = null;
    const modal = document.getElementById('modal-betahub-bugreport');
    if (modal) modal.classList.remove('open');
}

async function handleBugReportSubmit(): Promise<void> {
    const descEl = document.getElementById('bh-bug-desc') as HTMLTextAreaElement | null;
    const titleEl = document.getElementById('bh-bug-title') as HTMLInputElement | null;
    const emailEl = document.getElementById('bh-bug-email') as HTMLInputElement | null;
    const contactEl = document.getElementById('bh-bug-contact') as HTMLInputElement | null;
    const discordEl = document.getElementById('bh-bug-discord') as HTMLInputElement | null;
    const includeLogsEl = document.getElementById('bh-bug-include-logs') as HTMLInputElement | null;
    const includeDxDiagEl = document.getElementById('bh-bug-include-dxdiag') as HTMLInputElement | null;
    const dateEl = document.getElementById('bh-bug-due-date') as HTMLInputElement | null;

    let description = descEl?.value?.trim() || '';
    if (description.length < 10) {
        showFieldError('bh-bug-desc', t('betahub.errorDescTooShort'));
        return;
    }
    if (description.length > 4500) {
        showFieldError('bh-bug-desc', t('betahub.errorDescTooLong'));
        return;
    }

    clearFieldErrors('bh-bug');
    setSubmitState('bug', true);
    setSubmitLoading('bug', true);
    setPowState('bug', 'solving');

    try {
        if (!powBugResult) {
            toast(t('betahub.errorVerifyFirst'), 'warning');
            setSubmitState('bug', false);
            return;
        }

        // IDs for description
        const creatorId = await invoke('get_creator_id').catch(() => t('common.unknown'));
        const appVersion = await invoke('get_app_version').catch(() => t('common.na'));
        const buildDate = await invoke('get_build_date').catch(() => t('common.unknown'));
        const discordId = discordEl?.value?.trim() || t('common.na');
        
        description += `\n\n${t('betahub.contextHeader')}\nCreator ID: ${creatorId}\nDiscord: ${discordId}\nBMM Version: ${appVersion} (Build: ${buildDate})`;

        // Format Steps
        const stepsToReproduce = dynamicSteps
            .map((s, i) => s.trim() ? `${i + 1}. ${s.trim()}` : null)
            .filter(Boolean)
            .join('\n');

        // Due Date
        const dueDate = getEffectiveDueDate(dateEl?.value);

        setPowState('bug', 'upload');

        const contactEmail = contactEl?.value?.trim() || undefined;

        // Step 1: Create draft issue
        const { id: issueId, token: jwtToken } = await createDraftIssue(
            description,
            titleEl?.value?.trim() || undefined,
            stepsToReproduce || undefined,
            contactEmail,
            discordId === t('common.na') ? undefined : discordId,
            dueDate
        );

        // Step 2: Upload attachments
        const uploadTasks: Promise<void>[] = [];

        // Screenshots / Video
        for (const ss of selectedScreenshots) {
            uploadTasks.push(uploadScreenshot(issueId, jwtToken, ss).catch(e => console.warn(e)));
        }
        if (selectedVideo) {
            uploadTasks.push(uploadVideoClip(issueId, jwtToken, selectedVideo).catch(e => console.warn(e)));
        }

        // Logs
        if (includeLogsEl?.checked) {
            uploadTasks.push(fetchAndUploadLogs(issueId, jwtToken).catch(e => console.warn(e)));
        }

        // DxDiag
        if (includeDxDiagEl?.checked) {
            uploadTasks.push((async () => {
                const diag = await invoke('get_dxdiag_report').catch(() => null);
                if (diag) await uploadLogContents(issueId, jwtToken, diag, 'dxdiag_report.txt');
            })());
        }

        // Crash ZIPs (Manually selected or Explorer selected)
        for (const zipPath of selectedCrashZipPaths) {
            uploadTasks.push(uploadCrashZip(issueId, jwtToken, zipPath).catch(e => console.warn(e)));
        }

        await Promise.all(uploadTasks);

        // Step 4: Publish
        await publishIssue(issueId, jwtToken, !!contactEmail);

        saveReportToHistory('bug', titleEl?.value?.trim() || t('betahub.themeBug'), issueId);

        closeBugReportModal();
        toast(t('betahub.successBugReport'), 'success');

    } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('[BetaHub] Bug report error:', err);
        setPowState('bug', 'idle');
        toast(`${t('betahub.errorSubmit')}: ${err.message || err}`, 'error');
    } finally {
        setSubmitLoading('bug', false);
        setSubmitState('bug', false);
        powAbortController = null;
    }
}

// =============================================================================
// Helpers
// =============================================================================

function getEffectiveDueDate(userValue?: string): string {
    if (userValue && userValue.trim()) return userValue.trim();
    // Default +7 days in ISO format YYYY-MM-DD
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().split('T')[0];
}

async function fetchAndUploadLogs(issueId: string, jwtToken: string): Promise<void> {
    try {
        const { debugHub } = await import('../debug/debug.js');
        const logs = debugHub?.logs?.length > 0 
            ? debugHub.logs.map(l => `[${l.level.toUpperCase()}] ${l.message}`).join('\n')
            : t('betahub.errorNoLogs');
        
        await uploadLogContents(issueId, jwtToken, logs, 'bmm_frontend.log');
    } catch (e) {
        console.warn('Log capture failed, uploading fallback:', e);
        await uploadLogContents(issueId, jwtToken, `${t('betahub.errorSubmit')} (Log capture failed)`, 'bmm_error.log');
    }
}

async function uploadCrashZip(issueId: string, jwtToken: string, zipPath: string): Promise<void> {
    try {
        const base64Data = await invoke('read_file_base64', { path: zipPath }) as string;
        
        // Convert base64 to Blob/File
        const sliceSize = 512;
        const byteCharacters = atob(base64Data);
        const byteArrays = [];

        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        const filename = zipPath.split(/[\\/]/).pop() || 'crash_report.zip';
        const file = new File(byteArrays, filename, { type: 'application/zip' });
        
        await uploadBinaryFile(issueId, jwtToken, file);
    } catch (e) {
        console.error('Binary upload failed, falling back to path text:', e);
        await uploadLogContents(issueId, jwtToken, `Crash ZIP path: ${zipPath}`, 'crash_path.txt');
    }
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showFieldError(fieldId: string, message: string): void {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.style.borderColor = '#ef4444';
    const errorEl = document.createElement('div');
    errorEl.className = 'bh-field-error';
    errorEl.textContent = message;
    field.parentElement?.appendChild(errorEl);
    field.focus();
}

function clearFieldErrors(prefix: string): void {
    document.querySelectorAll(`[id^="${prefix}"]`).forEach(el => (el as HTMLElement).style.borderColor = '');
    document.querySelectorAll('.bh-field-error').forEach(el => el.remove());
}

/**
 * Save a summary of the report to local storage for the 'My Reports' history view.
 */
function saveReportToHistory(type: 'feedback' | 'bug', title: string, issueId: string): void {
    try {
        const history = JSON.parse(localStorage.getItem('bmm_report_history') || '[]');
        history.unshift({
            id: issueId,
            type,
            title,
            date: new Date().toISOString()
        });
        localStorage.setItem('bmm_report_history', JSON.stringify(history.slice(0, 10)));
        // Trigger UI refresh if needed
        renderReportHistory();
    } catch (e) {
        console.warn('[BetaHub] Failed to save history:', e);
    }
}

(window as any).deleteBetaHubHistoryItem = (id: string, type: string) => {
    try {
        const history = JSON.parse(localStorage.getItem('bmm_report_history') || '[]');
        const newHistory = history.filter((i: any) => !(String(i.id) === String(id) && i.type === type));
        localStorage.setItem('bmm_report_history', JSON.stringify(newHistory));
        renderReportHistory();
    } catch (e) {
        console.warn('[BetaHub] Failed to delete history item:', e);
    }
};

let historyCurrentTab: 'bug' | 'feedback' = 'bug';
let historyShowAll = false;

function wireHistoryUI(): void {
    const refreshBtn = document.getElementById('bh-history-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            historyShowAll = false;
            renderReportHistory();
        });
    }

    const clearBtn = document.getElementById('bh-history-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            localStorage.removeItem('bmm_report_history');
            renderReportHistory();
        });
    }

    const viewOlderBtn = document.getElementById('bh-history-view-older');
    if (viewOlderBtn) {
        viewOlderBtn.addEventListener('click', () => {
            historyShowAll = true;
            renderReportHistory();
        });
    }

    const tabs = document.querySelectorAll('.bh-explorer-tabs .bh-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!target) return;
            const tabId = target.getAttribute('data-bh-tab');
            if (!tabId) return;

            tabs.forEach(t => t.classList.remove('active'));
            target.classList.add('active');

            historyCurrentTab = tabId === 'history-bug' ? 'bug' : 'feedback';
            historyShowAll = false;
            renderReportHistory();
        });
    });
}

/**
 * Render the report history list in the settings tab.
 */
function renderReportHistory(): void {
    const list = document.getElementById('bh-history-list');
    const section = document.getElementById('bh-history-section');
    const viewOlderBtn = document.getElementById('bh-history-view-older');
    
    if (!list || !section) return;

    try {
        const history = JSON.parse(localStorage.getItem('bmm_report_history') || '[]');
        
        if (history.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = '';

        const filteredHistory = history.filter((item: any) => item.type === historyCurrentTab);
        
        if (filteredHistory.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:12px; font-size:11px; color:var(--text-muted); font-style:italic">No records found.</div>`;
            if (viewOlderBtn) viewOlderBtn.style.display = 'none';
            return;
        }

        const itemsToShow = historyShowAll ? filteredHistory : filteredHistory.slice(0, 5);

        if (viewOlderBtn) {
            viewOlderBtn.style.display = (!historyShowAll && filteredHistory.length > 5) ? 'block' : 'none';
        }

        itemsToShow.forEach((item: any) => {
            const date = new Date(item.date).toLocaleString(undefined, {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            const color = item.type === 'bug' ? '#ef4444' : '#10b981';
            const icon = item.type === 'bug' ? 
                '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' :
                '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-11.7 8.3 8.3 0 0 1 3.2.6"/>';

            const url = item.type === 'bug' ? 
                `https://app.betahub.io/projects/${BETAHUB_PROJECT_ID}/issues/g-${item.id}` :
                `https://app.betahub.io/projects/${BETAHUB_PROJECT_ID}/feature_requests/${item.id}`;

            const div = document.createElement('div');
            div.style.cssText = 'background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:10px; display:flex; align-items:center; gap:12px; transition:all 0.2s;';
            div.onmouseover = () => div.style.background = 'rgba(255,255,255,0.05)';
            div.onmouseout = () => div.style.background = 'rgba(255,255,255,0.03)';

            div.innerHTML = `
                <div style="width:28px; height:28px; border-radius:6px; background:${color}15; display:flex; align-items:center; justify-content:center; color:${color}; flex-shrink:0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        ${icon}
                    </svg>
                </div>
                <div style="flex:1; overflow:hidden; display:flex; flex-direction:column; gap:2px">
                    <div style="font-size:12px; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${item.title}</div>
                    <div style="font-size:10px; color:var(--text-muted); display:flex; align-items:center; gap:8px;">
                        <span>${date}</span>
                        <span style="opacity:0.3">•</span>
                        <span style="font-family:monospace; opacity:0.6">ID: ${item.id}</span>
                    </div>
                </div>
                <a href="${url}" target="_blank" class="bh-history-link" onmouseenter="window.showTaskyHelp('betahub.historyViewTip', 'info')" onmouseleave="window.hideTaskyHelp()" style="padding:6px; background:rgba(255,255,255,0.05); border-radius:6px; color:var(--text-secondary); transition:all 0.2s; display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,0.05)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </a>
                <button class="bh-history-link bh-history-del" data-id="${item.id}" data-type="${item.type}" style="padding:6px; background:rgba(239,68,68,0.05); border-radius:6px; color:#ef4444; transition:all 0.2s; display:flex; align-items:center; justify-content:center; border:1px solid rgba(239,68,68,0.1); cursor:pointer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
                    </svg>
                </button>
            `;
            list.appendChild(div);
        });

        const delButtons = list.querySelectorAll('.bh-history-del');
        delButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const id = target.getAttribute('data-id');
                const type = target.getAttribute('data-type');
                if (id && type) {
                    (window as any).deleteBetaHubHistoryItem(id, type);
                }
            });
        });

    } catch (e) {
        console.warn('[BetaHub] Render history failed:', e);
    }
}


export function setPowState(modal: 'feedback' | 'bug', state: 'idle' | 'solving' | 'upload' | 'done' | 'error'): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const container = document.getElementById(`bh-${prefix}-pow`);
    if (!container) return;

    container.className = `bh-pow-container bh-pow-${state} bh-theme-${prefix}`;
    const msgEl = container.querySelector('.bh-pow-msg');
    const barEl = container.querySelector('.bh-pow-bar-fill') as HTMLElement | null;
    const checkEl = document.getElementById(`bh-${prefix}-pow-check`) as HTMLInputElement | null;
    
    // Auto-Toggle Submit Button: Enabled ONLY when verification is 'done'
    setSubmitState(modal, state === 'done');

    if (msgEl) {
        let key = 'powIdle';
        if (state === 'solving') key = 'powSolving';
        else if (state === 'upload') key = 'powUploading';
        else if (state === 'done') key = 'powDone';
        else if (state === 'error') key = 'powError';
        msgEl.textContent = t(`betahub.${key}`) || state.toUpperCase();
    }

    if (checkEl) {
        checkEl.disabled = (state === 'solving' || state === 'upload');
        if (state === 'done') checkEl.checked = true;
        if (state === 'idle') checkEl.checked = false;
    }

    if (barEl) {
        if (state === 'idle') barEl.style.width = '0%';
        else if (state === 'done' || state === 'error') barEl.style.width = '100%';
    }
}

function updatePowProgress(modal: 'feedback' | 'bug', nonce: number): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const barEl = document.querySelector(`#bh-${prefix}-pow .bh-pow-bar-fill`) as HTMLElement | null;
    if (barEl) {
        const pct = Math.min(95, Math.round((nonce / 65536) * 100));
        barEl.style.width = `${pct}%`;
    }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBetaHubForm(modal: 'feedback' | 'bug'): boolean {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const desc = (document.getElementById(`bh-${prefix}-desc`) as HTMLTextAreaElement)?.value || '';
    
    // Check contact fields (IDs differ slightly between modals)
    const emailEl = document.getElementById(modal === 'feedback' ? 'bh-feedback-email' : 'bh-bug-contact') as HTMLInputElement | null;
    const discordEl = document.getElementById(`bh-${prefix}-discord`) as HTMLInputElement | null;
    
    const email = emailEl?.value.trim() || '';
    const discord = discordEl?.value.trim() || '';
    
    const isEmailValid = email.length > 0 && EMAIL_REGEX.test(email);
    const isDiscordValid = discord.length > 2; // Basic check for username
    
    const hasContact = isEmailValid || isDiscordValid;
    const powDone = (modal === 'feedback' ? powFeedbackResult : powBugResult) !== null;

    return desc.trim().length >= 10 && hasContact && powDone;
}

function setSubmitState(modal: 'feedback' | 'bug', _enabledByPow?: boolean): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const btn = document.getElementById(`bh-${prefix}-submit`) as HTMLButtonElement | null;
    if (btn) {
        btn.disabled = !validateBetaHubForm(modal);
    }
}

/**
 * Toggle the loading state (animation + text) for the submit button.
 */
function setSubmitLoading(modal: 'feedback' | 'bug', isLoading: boolean): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const btn = document.getElementById(`bh-${prefix}-submit`) as HTMLButtonElement | null;
    if (!btn) return;

    if (isLoading) {
        btn.classList.add('loading');
        // Save original text if not already saved
        if (!btn.dataset.originalText) {
            btn.dataset.originalText = btn.textContent || '';
        }
        btn.textContent = t('betahub.submitting') || 'SENDING...';
    } else {
        btn.classList.remove('loading');
        if (btn.dataset.originalText) {
            btn.textContent = btn.dataset.originalText;
        }
    }
}

// =============================================================================
// Quality Gauge & Guidance Logic
// =============================================================================

function wireStrengthGauge(modal: 'feedback' | 'bug'): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const inputs = [
        `bh-${prefix}-title`,
        `bh-${prefix}-desc`,
        `bh-${prefix}-discord`,
        modal === 'feedback' ? 'bh-feedback-email' : 'bh-bug-contact'
    ];
    if (modal === 'bug') {
        inputs.push('bh-bug-video', 'bh-bug-include-logs', 'bh-bug-include-dxdiag', 'bh-bug-pow-check');
    } else {
        inputs.push('bh-feedback-pow-check');
    }

    const update = () => {
        const score = calculateSubmissionStrength(modal);
        updateStrengthGauge(modal, score);
        setSubmitState(modal); // This will update button state
    };

    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', update);
        if (el) el.addEventListener('change', update);
    });

    // Initial update
    update();
}

function calculateSubmissionStrength(modal: 'feedback' | 'bug'): number {
    let score = 0;
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';

    // 1. Title
    const title = (document.getElementById(`bh-${prefix}-title`) as HTMLInputElement)?.value || '';
    if (title.length > 5) score += 10;

    // 2. Description
    const desc = (document.getElementById(`bh-${prefix}-desc`) as HTMLTextAreaElement)?.value || '';
    if (desc.length > 500) score += 30;
    else if (desc.length > 100) score += 20;
    else if (desc.length > 20) score += 10;

    // 3. Media
    const ssCount = modal === 'feedback' ? selectedFeedbackScreenshots.length : selectedScreenshots.length;
    if (ssCount > 0) score += 15;
    if (modal === 'bug' && selectedVideo) score += 15;

    // 4. Bug Specifics
    if (modal === 'bug') {
        // Steps
        const validSteps = dynamicSteps.filter(s => s.trim().length > 3).length;
        score += Math.min(30, validSteps * 10);

        // Logs/Data
        const logs = (document.getElementById('bh-bug-include-logs') as HTMLInputElement)?.checked;
        if (logs) score += 5;
        
        // ZIPs: +10 for first, +5 for each subsequent (max 20 total for ZIPs)
        const zipCount = selectedCrashZipPaths.length;
        if (zipCount > 0) {
            score += 10 + (Math.min(2, zipCount - 1) * 5);
        }
    } else {
        // Feedback Specifics (Double weight on desc/media to match 100)
        if (desc.length > 1000) score += 20;
        if (ssCount > 1) score += 10;
    }

    return Math.min(100, score);
}

function updateStrengthGauge(modal: 'feedback' | 'bug', score: number): void {
    const prefix = modal === 'feedback' ? 'feedback' : 'bug';
    const fill = document.getElementById(`bh-${prefix}-gauge-fill`);
    const needleGroup = document.getElementById(`bh-${prefix}-gauge-needle-group`);
    const scoreText = document.getElementById(`bh-${prefix}-strength-score`);
    const labelText = document.getElementById(`bh-${prefix}-strength-label`);
    const suggestionsList = document.getElementById(`bh-${prefix}-suggestions`);

    if (!needleGroup || !scoreText || !labelText) return;
    const rotation = (score / 100) * 180 - 90;
    needleGroup.style.transform = `rotate(${rotation}deg)`;

    // 2. Dynamic Needle Color
    let needleColor = '#ef4444'; // Bad
    if (score >= 25 && score < 50) needleColor = '#f59e0b'; // Well
    else if (score >= 50 && score < 75) needleColor = '#3b82f6'; // Good
    else if (score >= 75) needleColor = '#10b981'; // Best
    
    needleGroup.style.color = needleColor;

    // 3. Score & Labels (Optional but keep for info)
    scoreText.textContent = String(score);
    if (score < 40) {
        labelText.textContent = t('betahub.strengthLow');
        labelText.className = 'bh-strength-label bh-label-low';
    } else if (score < 80) {
        labelText.textContent = t('betahub.strengthGood');
        labelText.className = 'bh-strength-label bh-label-good';
    } else {
        labelText.textContent = t('betahub.strengthExpert');
        labelText.className = 'bh-strength-label bh-label-expert';
    }

    // 4. Dynamic Suggestions
    if (suggestionsList) {
        const suggestions: string[] = [];
        const desc = (document.getElementById(`bh-${prefix}-desc`) as HTMLTextAreaElement)?.value || '';
        const title = (document.getElementById(`bh-${prefix}-title`) as HTMLInputElement)?.value || '';

        if (title.length < 5) suggestions.push(t('betahub.suggestTitle'));
        if (desc.length < 100) suggestions.push(t('betahub.suggestDesc'));
        
        const ssCount = modal === 'feedback' ? selectedFeedbackScreenshots.length : selectedScreenshots.length;
        if (ssCount === 0) suggestions.push(t('betahub.suggestScreenshot'));

        if (modal === 'bug') {
            const validSteps = dynamicSteps.filter(s => s.trim().length > 3).length;
            if (validSteps < 2) suggestions.push(t('betahub.suggestSteps'));
            if (selectedCrashZipPaths.length === 0) suggestions.push(t('betahub.suggestCrash'));
        }

        suggestionsList.innerHTML = suggestions.slice(0, 2).map((s: string) => `<li>+ ${s}</li>`).join('');
    }
}
