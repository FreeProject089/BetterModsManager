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
        if (overlay) overlay.remove();        overlay = document.createElement('div');
        overlay.id = 'modal-security-choice';
        overlay.className = 'modal-overlay-security';
        
        // Append to app container instead of body to avoid overlapping Tasky/Shell
        const appRoot = document.getElementById('app-window-outer') || document.body;
        appRoot.appendChild(overlay);

        overlay.innerHTML = `
            <style>
                .modal-overlay-security {
                    position: absolute;
                    inset: 0;
                    z-index: 10000;
                    background: rgba(4, 7, 12, 0.5);
                    backdrop-filter: blur(12px) saturate(180%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    opacity: 0;
                    transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    pointer-events: auto;
                }
                .modal-overlay-security.open {
                    opacity: 1;
                }
                .security-container {
                    width: 100%;
                    max-width: 520px;
                    max-height: calc(100vh - 40px);
                    background: linear-gradient(165deg, rgba(17, 24, 39, 0.8) 0%, rgba(10, 14, 23, 0.9) 100%);
                    backdrop-filter: blur(40px);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 28px;
                    box-shadow:
                        0 25px 60px rgba(0, 0, 0, 0.6),
                        inset 0 0 0 1px rgba(255, 255, 255, 0.05);
                    overflow-y: auto;
                    overflow-x: hidden;
                    transform: translateY(20px) scale(0.97);
                    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255,255,255,0.1) transparent;
                }
                .modal-overlay-security.open .security-container {
                    transform: translateY(0) scale(1);
                }
                .security-header {
                    padding: 44px 40px 28px;
                    text-align: center;
                }
                .security-icon-main {
                    width: 72px;
                    height: 72px;
                    background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%);
                    border-radius: 22px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 24px;
                    color: #60a5fa;
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    box-shadow: 0 0 40px rgba(59, 130, 246, 0.15);
                }
                .security-options-list {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    padding: 0 32px 40px;
                }
                .security-premium-card {
                    padding: 24px;
                    border-radius: 20px;
                    background: rgba(255, 255, 255, 0.02);
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
                    background: radial-gradient(400px circle at var(--x, 0) var(--y, 0), rgba(59, 130, 246, 0.12), transparent 40%);
                    opacity: 0;
                    transition: opacity 0.4s;
                    pointer-events: none;
                }
                .security-premium-card:hover::before {
                    opacity: 1;
                }
                .security-premium-card:hover {
                    background: rgba(255, 255, 255, 0.04);
                    border-color: rgba(255, 255, 255, 0.12);
                    transform: translateX(4px);
                }
                .security-premium-card.active {
                    background: rgba(59, 130, 246, 0.08);
                    border-color: #3b82f6;
                    box-shadow: 0 10px 30px rgba(59, 130, 246, 0.1);
                }
                .card-icon-box {
                    width: 52px;
                    height: 52px;
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    transition: all 0.3s;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
                .security-premium-card.active .card-icon-box {
                    background: rgba(59, 130, 246, 0.2);
                    color: #3b82f6;
                    border-color: rgba(59, 130, 246, 0.3);
                    transform: scale(1.05);
                }
                .card-info {
                    flex: 1;
                }
                .card-radio-outer {
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    border: 2px solid rgba(255, 255, 255, 0.15);
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
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: white;
                    transform: scale(0);
                    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                .security-premium-card.active .card-radio-inner {
                    transform: scale(1);
                }
                .security-footer {
                    padding: 32px;
                    background: rgba(0, 0, 0, 0.25);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                }
                .btn-premium-save {
                    width: 100%;
                    height: 56px;
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: white;
                    border: none;
                    border-radius: 18px;
                    font-size: 16px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.3s;
                    box-shadow: 0 10px 25px rgba(37, 99, 235, 0.35);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                }
                .btn-premium-save:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 15px 30px rgba(37, 99, 235, 0.45);
                    filter: brightness(1.1);
                }
                .btn-premium-save:active {
                    transform: translateY(0);
                }
                .badge-recommend {
                    background: rgba(16, 185, 129, 0.15);
                    color: #10b981;
                    padding: 3px 10px;
                    border-radius: 8px;
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: 0.02em;
                    border: 1px solid rgba(16, 185, 129, 0.2);
                    margin-left: 10px;
                    vertical-align: middle;
                }
            </style>

            <div class="security-container" id="security-container-el">
                <div class="security-header">
                    <div class="security-icon-main">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                    </div>
                    <h1 style="font-size: 28px; font-weight: 850; color: white; margin-bottom: 10px; letter-spacing: -0.03em;">${t('security.modal.title')}</h1>
                    <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6; max-width: 400px; margin: 0 auto;">${t('security.modal.desc')}</p>
                </div>

                <div class="security-options-list">
                    <!-- Full Access Card -->
                    <div class="security-premium-card active" id="btn-sec-full">
                        <div class="card-icon-box">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        </div>
                        <div class="card-info">
                            <h3 style="font-size: 17px; font-weight: 750; color: white; margin-bottom: 4px;">
                                ${t('security.modal.full')}
                                <span class="badge-recommend">${t('common.recommended')}</span>
                            </h3>
                            <p style="font-size: 12px; color: var(--text-muted); line-height: 1.45;">${t('security.modal.fullDesc')}</p>
                        </div>
                        <div class="card-radio-outer"><div class="card-radio-inner"></div></div>
                    </div>

                    <!-- Limited Access Card -->
                    <div class="security-premium-card" id="btn-sec-limited">
                        <div class="card-icon-box">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        </div>
                        <div class="card-info">
                            <h3 style="font-size: 17px; font-weight: 750; color: white; margin-bottom: 4px;">${t('security.modal.limited')}</h3>
                            <p style="font-size: 12px; color: var(--text-muted); line-height: 1.45;">${t('security.modal.limitedDesc')}</p>
                        </div>
                        <div class="card-radio-outer"><div class="card-radio-inner"></div></div>
                    </div>
                </div>

                <div class="security-footer">
                    <button class="btn-premium-save" id="btn-sec-confirm">
                        <span>${t('security.modal.apply')}</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
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
            const originalContent = btnSave.innerHTML;
            btnSave.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
            
            try {
                // @ts-ignore
                const settings = await invoke('get_settings');
                settings.fs_security_mode = selected;
                await invoke('update_settings', { settings });
                await invoke('apply_fs_security_mode_command');

                overlay!.classList.remove('open');
                setTimeout(() => {
                    overlay!.remove();
                    resolve();
                }, 500);
            } catch (err) {
                console.error('[Security] Error saving mode:', err);
                btnSave.disabled = false;
                btnSave.innerHTML = originalContent;
            }
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) {
                container.style.transform = 'scale(1.02)';
                setTimeout(() => container.style.transform = 'scale(1)', 150);
            }
        };

        requestAnimationFrame(() => {
            overlay!.classList.add('open');
        });
    });
}
