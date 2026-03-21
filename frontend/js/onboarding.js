/**
 * onboarding.js — Tasky onboarding tutorial with language selection
 */
import { t, getLang, setLang, applyTranslations, getLanguages, refreshLanguages } from './i18n.js';

function getSteps() {
    return [
        {
            title: t('onboard.s1.title'),
            text: t('onboard.s1.text'),
            img: 'assets/Tasky_Happy.png',
            navTarget: 'profiles'
        },
        {
            title: t('onboard.s2.title'),
            text: t('onboard.s2.text'),
            img: 'assets/Tasky.png',
            navTarget: 'profiles',
            selector: 'profiles-list'
        },
        {
            title: t('onboard.s3.title'),
            text: t('onboard.s3.text'),
            img: 'assets/Tasky_Happy.png',
            navTarget: 'profiles',
            selector: 'btn-import-ovgme'
        },
        {
            title: t('onboard.bg.title'),
            text: t('onboard.bg.text'),
            img: 'assets/Tasky_Happy.png',
            navTarget: 'profiles'
        },
        {
            title: t('onboard.s4.title'),
            text: t('onboard.s4.text'),
            img: 'assets/Tasky.png',
            navTarget: 'library',
            selector: 'view-library'
        },
        {
            title: t('onboard.s5.title'),
            text: t('onboard.s5.text'),
            img: 'assets/Tasky_yeux1.png',
            navTarget: 'library'
        },
        {
            title: t('onboard.conflicts.title'),
            text: t('onboard.conflicts.text'),
            img: 'assets/Tasky.png',
            navTarget: 'library',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f71a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
        },
        {
            title: t('onboard.explorer.title'),
            text: t('onboard.explorer.text'),
            img: 'assets/Tasky.png',
            navTarget: 'library',
            selector: 'btn-browse-archive',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--cyan)"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
        },
        {
            title: t('onboard.modding.title'),
            text: t('onboard.modding.text'),
            img: 'assets/Tasky.png',
            navTarget: 'library',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--accent)"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>'
        },
        {
            title: t('onboard.integrity.title'),
            text: t('onboard.integrity.text'),
            img: 'assets/Tasky_Happy.png',
            navTarget: 'library',
            selector: 'btn-verify-integrity',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--success)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>'
        },
        {
            title: t('onboard.s7.title'),
            text: t('onboard.s7.text'),
            img: 'assets/Tasky.png',
            navTarget: 'modlists',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-network-icon lucide-network"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>'
        },
        {
            title: t('onboard.storage.title'),
            text: t('onboard.storage.text'),
            img: 'assets/Tasky.png',
            navTarget: 'settings',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>'
        },
        {
            title: t('onboard.performance.title'),
            text: t('onboard.performance.text'),
            img: 'assets/Tasky.png',
            navTarget: 'library',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--warning)"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'
        },
        {
            title: t('onboard.benchmark.title'),
            text: t('onboard.benchmark.text'),
            img: 'assets/Tasky.png',
            navTarget: 'settings',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:#3b82f6"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
        },
        {
            title: t('onboard.tips.title'),
            text: t('onboard.tips.text'),
            img: 'assets/Tasky_Happy.png',
            navTarget: 'docs',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
        },
        {
            title: t('onboard.s8.title'),
            text: t('onboard.s8.text'),
            img: 'assets/Tasky_Happy.png',
            navTarget: 'credits'
        },

    ];
}

let currentStep = -1; // -1 = language step

export async function shouldShowOnboarding() {
    const { getSettings } = await import('./api.js');
    try {
        const settings = await getSettings();
        return !settings.onboarding_shown;
    } catch {
        return false;
    }
}

export async function markOnboardingShown() {
    const { getSettings, updateSettings } = await import('./api.js');
    try {
        const settings = await getSettings();
        settings.onboarding_shown = true;
        await updateSettings(settings);
    } catch (e) { console.error('Failed to save onboarding state:', e); }
}

export function startOnboarding() {
    currentStep = -1;
    renderOnboarding();

    // Reactive re-render on language change
    document.addEventListener('langChanged', () => {
        if (document.getElementById('onboarding-overlay')) {
            renderOnboarding();
        }
    });
}

function renderOnboarding() {
    let overlay = document.getElementById('onboarding-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'onboarding-overlay';
        overlay.className = 'onboarding-overlay';
        document.getElementById('app-window-outer').appendChild(overlay);

    }

    // Block all interaction behind the overlay
    const appShell = document.querySelector('.app-shell');
    if (appShell) appShell.style.pointerEvents = 'none';

    // Step -1: Language selection
    if (currentStep === -1) {
        const languages = getLanguages();
        const appLang = getLang();
        const current = languages.find(l => l.code === appLang) || languages.find(l => l.active) || languages[0];

        const getFlag = (l) => {
            if (!l || !l.flag) return '⚪';
            const f = l.flag.trim();
            if (f.length === 2) {
                const code = f.toLowerCase();
                return `<img src="https://flagcdn.com/w20/${code}.png" width="20" height="14" style="border-radius:2px;object-fit:cover;margin-right:8px">`;
            }
            return `<span style="margin-right:8px">${f}</span>`;
        };

        overlay.innerHTML = `
        <div class="onboarding-card">
          <div class="onboarding-mascot">
            <img src="assets/Tasky_Happy.png" alt="Tasky" class="onboarding-mascot-img" />
          </div>
          <div class="onboarding-content">
            <div class="onboarding-header">
              <span class="onboarding-label">${t('onboarding.tasky')}</span>
            </div>
            <h3 class="onboarding-title" data-i18n="onboarding.lang_title">${t('onboarding.lang_title')}</h3>
            <p class="onboarding-text" style="opacity:1" data-i18n="onboarding.lang_desc">Choisissez votre langue / Choose your language</p>
            
            <div class="onboarding-actions" style="position:relative; flex-direction:column; gap:8px; margin-top:16px; height:auto">
              <button class="nav-lang-btn" id="onboarding-lang-toggle" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid var(--border)">
                <span class="nav-lang-flag">${getFlag(current)}</span>
                <span class="nav-lang-name">${current.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="nav-lang-chevron"><polyline points="18 15 12 9 6 15"/></svg>
              </button>
              
              <div class="settings-lang-menu" id="onboarding-lang-menu" style="position:absolute; bottom:100%; left:0; right:0; margin-bottom:8px; top:auto; z-index:10001">
                ${languages.map(l => `
                  <button class="nav-lang-option ${l.active ? 'active' : ''}" data-lang="${l.code}">
                    <span class="nav-lang-flag">${getFlag(l)}</span>
                    <span>${l.name}</span>
                    ${l.active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" style="margin-left:auto"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                  </button>
                `).join('')}
              </div>

              <button class="btn btn-primary" id="btn-lang-confirm" style="width:100%; margin-top:12px; justify-content:center">${t('common.ok')}</button>
            </div>
          </div>
        </div>
        `;

        const toggle = document.getElementById('onboarding-lang-toggle');
        const menu = document.getElementById('onboarding-lang-menu');
        const confirmBtn = document.getElementById('btn-lang-confirm');

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
            toggle.classList.toggle('open');
        });

        menu.querySelectorAll('.nav-lang-option').forEach(opt => {
            opt.addEventListener('click', async (e) => {
                e.stopPropagation();
                const lang = opt.dataset.lang;
                await setLang(lang);
                // renderOnboarding() will be triggered by the 'langChanged' event
            });
        });

        confirmBtn.addEventListener('click', () => {
            currentStep = 0;
            renderOnboarding();
        });

        // Close menu on click outside
        document.addEventListener('click', () => {
            menu.classList.remove('open');
            toggle.classList.remove('open');
        }, { once: true });

        return;
    }

    // Normal steps
    const steps = getSteps();
    const step = steps[currentStep];
    const totalSteps = steps.length;

    // Switch view in background
    if (step.navTarget) {
        document.getElementById(`nav-${step.navTarget}`)?.click();
    }

    overlay.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-mascot">
        <img src="${step.img}" alt="Tasky" class="onboarding-mascot-img" />
      </div>
      <div class="onboarding-content" style="position:relative">
        <div class="onboarding-header">
          <span class="onboarding-label">${t('onboarding.tasky')}</span>
          <div class="onboarding-dots">
            ${Array.from({ length: totalSteps }, (_, i) => `<span class="onboarding-dot ${i === currentStep ? 'active' : ''}"></span>`).join('')}
          </div>
        </div>
        <p class="onboarding-step-counter">${t('onboarding.stepCounter').replace('{current}', currentStep + 1).replace('{total}', totalSteps)}</p>
        <h3 class="onboarding-title" style="display:flex;align-items:center;gap:10px">
            ${step.icon ? step.icon : ''}
            <span>${step.title}</span>
        </h3>
        <p class="onboarding-text" id="onboarding-typewriter"></p>
        <div class="onboarding-actions">
          ${currentStep > 0 ? `<button class="btn btn-secondary onboarding-prev" id="btn-onboarding-prev" style="padding:6px 12px">←</button>` : ''}
          <button class="btn btn-primary onboarding-next" id="btn-onboarding-next">${t('onboard.next')}</button>
          <button class="btn btn-ghost onboarding-skip" id="btn-onboarding-skip">${t('onboard.skip')}</button>
          ${currentStep === totalSteps - 1 ? `<button class="btn btn-ghost" onclick="window.openDiagram('app-architecture')" style="padding:4px 8px; font-size:16px; margin-left:auto" title="Besoin d'aide technique ?">?</button>` : ''}
        </div>
      </div>
    </div>
  `;

    // Visual help: draw a highlight box around the target element if exists
    if (step.selector) {
        const target = document.getElementById(step.selector) || document.querySelector(`.${step.selector}`);
        const parent = document.getElementById('app-window-outer');
        if (target && parent) {
            const rect = target.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            
            const highlight = document.createElement('div');
            highlight.id = 'onboarding-highlight';
            highlight.style.cssText = `
                position:absolute;
                top:${(rect.top - parentRect.top) - 8}px;
                left:${(rect.left - parentRect.left) - 8}px;
                width:${rect.width + 16}px;
                height:${rect.height + 16}px;
                border:2px solid var(--accent);
                border-radius:8px;
                box-shadow:0 0 0 9999px rgba(0,0,0,0.6), 0 0 20px var(--accent-glow);
                z-index:9998;
                pointer-events:none;
                transition: all 0.3s ease;
            `;
            parent.appendChild(highlight);
        }
    }

    // Typewriter effect
    const textEl = document.getElementById('onboarding-typewriter');
    let charIndex = 0;
    const typeInterval = setInterval(() => {
        if (charIndex < step.text.length) {
            textEl.textContent += step.text[charIndex];
            charIndex++;
        } else {
            clearInterval(typeInterval);
        }
    }, 18);

    // Button listeners
    document.getElementById('btn-onboarding-next').addEventListener('click', () => {
        clearInterval(typeInterval);
        document.getElementById('onboarding-highlight')?.remove();
        if (currentStep < totalSteps - 1) {
            currentStep++;
            renderOnboarding();
        } else {
            closeOnboarding();
        }
    });

    const prevBtn = document.getElementById('btn-onboarding-prev');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            clearInterval(typeInterval);
            document.getElementById('onboarding-highlight')?.remove();
            if (currentStep > 0) {
                currentStep--;
                renderOnboarding();
            }
        });
    }

    document.getElementById('btn-onboarding-skip').addEventListener('click', () => {
        clearInterval(typeInterval);
        document.getElementById('onboarding-highlight')?.remove();
        closeOnboarding();
    });
}

function closeOnboarding() {
    markOnboardingShown();

    // Restore interaction with the app
    const appShell = document.querySelector('.app-shell');
    if (appShell) appShell.style.pointerEvents = '';

    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
        overlay.classList.add('closing');
        overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
    }
}
