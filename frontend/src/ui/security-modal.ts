/**
 * security-modal.ts — Premium Security Access Mode Selection
 */

import { invoke } from '../core/api.js';
import { t } from '../core/i18n.js';

export async function checkSecurityMode(): Promise<void> {
    try {
        const settings = await invoke('get_settings');
        // @ts-ignore
        if (!settings.fs_security_mode) {
            await showSecurityModal();
        }
    } catch (e) {
        console.error('[Security] Failed to check security mode:', e);
    }
}

function showSecurityModal(): Promise<void> {
    return new Promise((resolve) => {
        let overlay = document.getElementById('modal-security-choice');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'modal-security-choice';
        overlay.className = 'modal-overlay-security';
        document.body.appendChild(overlay);

        overlay.innerHTML = `
            <style>
                .modal-overlay-security {
                    position: fixed;
                    inset: 0;
                    z-index: 999999;
                    background: rgba(4, 7, 12, 0.4);
                    backdrop-filter: blur(20px) saturate(180%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    opacity: 0;
                    transition: opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1);
                    pointer-events: auto;
                }
                .modal-overlay-security.open {
                    opacity: 1;
                }
                .security-container {
                    width: 100%;
                    max-width: 500px;
                    background: linear-gradient(165deg, rgba(17, 24, 39, 0.75) 0%, rgba(10, 14, 23, 0.85) 100%);
                    backdrop-filter: blur(40px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 32px;
                    box-shadow: 
                        0 20px 50px rgba(0, 0, 0, 0.5),
                        inset 0 0 20px rgba(59, 130, 246, 0.05);
                    overflow: hidden;
                    transform: translateY(30px) scale(0.95);
                    transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                    position: relative;
                    display: flex;
                    flex-direction: column;
                }
                .modal-overlay-security.open .security-container {
                    transform: translateY(0) scale(1);
                }
                .security-header {
                    padding: 40px 40px 24px;
                    text-align: center;
                }
                .security-icon-main {
                    width: 64px;
                    height: 64px;
                    background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%);
                    border-radius: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                    color: #60a5fa;
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    box-shadow: 0 0 30px rgba(59, 130, 246, 0.1);
                }
                .security-options-list {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    padding: 0 32px 32px;
                }
                .security-premium-card {
                    padding: 24px;
                    border-radius: 24px;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.06);
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    overflow: hidden;
                }
                .security-premium-card::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    background: radial-gradient(400px circle at var(--x, 0) var(--y, 0), rgba(59, 130, 246, 0.1), transparent 40%);
                    opacity: 0;
                    transition: opacity 0.3s;
                    pointer-events: none;
                }
                .security-premium-card:hover::before {
                    opacity: 1;
                }
                .security-premium-card:hover {
                    background: rgba(255, 255, 255, 0.05);
                    border-color: rgba(255, 255, 255, 0.15);
                    transform: translateX(4px);
                }
                .security-premium-card.active {
                    background: rgba(59, 130, 246, 0.08);
                    border-color: #3b82f6;
                    box-shadow: 0 10px 30px rgba(59, 130, 246, 0.1);
                }
                .card-icon-box {
                    width: 48px;
                    height: 48px;
                    border-radius: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    transition: all 0.3s;
                }
                .security-premium-card.active .card-icon-box {
                    background: rgba(59, 130, 246, 0.2);
                    color: #3b82f6;
                    transform: scale(1.05);
                }
                .card-info {
                    flex: 1;
                }
                .card-radio-outer {
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    border: 2px solid rgba(255, 255, 255, 0.2);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s;
                    flex-shrink: 0;
                }
                .security-premium-card.active .card-radio-outer {
                    border-color: #3b82f6;
                    background: #3b82f6;
                }
                .card-radio-inner {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: white;
                    transform: scale(0);
                    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                .security-premium-card.active .card-radio-inner {
                    transform: scale(1);
                }
                .security-footer {
                    padding: 24px 32px 32px;
                    background: rgba(0, 0, 0, 0.2);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                }
                .btn-premium-save {
                    width: 100%;
                    height: 52px;
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: white;
                    border: none;
                    border-radius: 16px;
                    font-size: 15px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.3s;
                    box-shadow: 0 8px 20px rgba(37, 99, 235, 0.3);
                }
                .btn-premium-save:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 12px 25px rgba(37, 99, 235, 0.4);
                }
                .btn-premium-save:active {
                    transform: translateY(0);
                }
                .badge-recommend {
                    background: rgba(16, 185, 129, 0.15);
                    color: #10b981;
                    padding: 2px 8px;
                    border-radius: 8px;
                    font-size: 9px;
                    font-weight: 800;
                    letter-spacing: 0.05em;
                    border: 1px solid rgba(16, 185, 129, 0.2);
                    margin-left: 8px;
                    vertical-align: middle;
                }
            </style>

            <div class="security-container" id="security-container-el">
                <div class="security-header">
                    <div class="security-icon-main">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    </div>
                    <h1 style="font-size: 26px; font-weight: 800; color: white; margin-bottom: 8px; letter-spacing: -0.02em;">${t('security.modal.title')}</h1>
                    <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">${t('security.modal.desc')}</p>
                </div>

                <div class="security-options-list">
                    <!-- Full Access Card -->
                    <div class="security-premium-card active" id="btn-sec-full">
                        <div class="card-icon-box" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="7.5 4.21 12 6.81 16.5 4.21"/><polyline points="7.5 19.79 7.5 14.6 3 12"/><polyline points="21 12 16.5 14.6 16.5 19.79"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                        </div>
                        <div class="card-info">
                            <h3 style="font-size: 16px; font-weight: 700; color: white; margin-bottom: 4px;">
                                ${t('security.modal.full')}
                                <span class="badge-recommend">${t('common.recommended')}</span>
                            </h3>
                            <p style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">${t('security.modal.fullDesc')}</p>
                        </div>
                        <div class="card-radio-outer"><div class="card-radio-inner"></div></div>
                    </div>

                    <!-- Limited Access Card -->
                    <div class="security-premium-card" id="btn-sec-limited">
                        <div class="card-icon-box" style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        </div>
                        <div class="card-info">
                            <h3 style="font-size: 16px; font-weight: 700; color: white; margin-bottom: 4px;">${t('security.modal.limited')}</h3>
                            <p style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">${t('security.modal.limitedDesc')}</p>
                        </div>
                        <div class="card-radio-outer"><div class="card-radio-inner"></div></div>
                    </div>
                </div>

                <div class="security-footer">
                    <button class="btn-premium-save" id="btn-sec-confirm">
                        ${t('security.modal.apply')}
                    </button>
                    <div style="font-size: 10px; color: var(--text-muted); opacity: 0.6; display: flex; align-items: center; gap: 6px; cursor: pointer;" onclick="window.openDiagram('security-system')">
                         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                         <span style="text-decoration: underline;">${t('common.howItWorks')}</span>
                    </div>
                </div>
            </div>

        `;

        let selected = 'full';
        const cardFull = overlay.querySelector('#btn-sec-full') as HTMLElement;
        const cardLimited = overlay.querySelector('#btn-sec-limited') as HTMLElement;
        const btnSave = overlay.querySelector('#btn-sec-confirm') as HTMLButtonElement;
        const container = overlay.querySelector('#security-container-el') as HTMLElement;

        const updateSelection = (mode: string) => {
            selected = mode;
            if (mode === 'full') {
                cardFull.classList.add('active');
                cardLimited.classList.remove('active');
            } else {
                cardFull.classList.remove('active');
                cardLimited.classList.add('active');
            }
        };

        const addGlowEffect = (card: HTMLElement) => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                card.style.setProperty('--x', `${x}px`);
                card.style.setProperty('--y', `${y}px`);
            });
        };

        addGlowEffect(cardFull);
        addGlowEffect(cardLimited);

        cardFull.onclick = () => updateSelection('full');
        cardLimited.onclick = () => updateSelection('limited');

        btnSave.onclick = async () => {
            btnSave.disabled = true;
            btnSave.textContent = t('common.loading') || '...';
            
            try {
                // @ts-ignore
                const settings = await invoke('get_settings');
                settings.fs_security_mode = selected;
                await invoke('update_settings', { settings });
                // Apply the scope immediately via backend command
                await invoke('apply_fs_security_mode_command');

                overlay!.classList.remove('open');
                setTimeout(() => {
                    overlay!.remove();
                    resolve();
                }, 500);
            } catch (err) {
                console.error('[Security] Error saving mode:', err);
                btnSave.disabled = false;
                btnSave.textContent = t('security.modal.apply');
            }
        };

        // Prevent closing by clicking outside if required
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                container.style.transform = 'scale(1.02)';
                setTimeout(() => container.style.transform = 'scale(1)', 100);
            }
        };

        // Animate entrance
        requestAnimationFrame(() => {
            overlay!.classList.add('open');
        });
    });
}
