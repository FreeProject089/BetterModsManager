/**
 * onboarding.js — Tasky onboarding tutorial with language selection
 */
import { t, setLang, applyTranslations } from './i18n.js';

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
            title: t('onboard.performance.title'),
            text: t('onboard.performance.text'),
            img: 'assets/Tasky.png',
            navTarget: 'library',
            icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--warning)"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'
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

export function shouldShowOnboarding() {
    return !localStorage.getItem('bmm-onboarding-done');
}

export function startOnboarding() {
    currentStep = -1;
    renderOnboarding();
}

function renderOnboarding() {
    let overlay = document.getElementById('onboarding-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'onboarding-overlay';
        overlay.className = 'onboarding-overlay';
        document.body.appendChild(overlay);
    }

    // Step -1: Language selection
    if (currentStep === -1) {
        overlay.innerHTML = `
        <div class="onboarding-card">
          <div class="onboarding-mascot">
            <img src="assets/Tasky_Happy.png" alt="Tasky" class="onboarding-mascot-img" />
          </div>
          <div class="onboarding-content">
            <div class="onboarding-header">
              <span class="onboarding-label">TASKY</span>
            </div>
            <h3 class="onboarding-title">🌐 Select Language</h3>
            <p class="onboarding-text" style="opacity:1">Choisissez votre langue / Choose your language</p>
            <div class="onboarding-actions" style="flex-direction:column;gap:8px;margin-top:16px">
              <button class="btn btn-primary" id="btn-lang-fr" style="justify-content:center;width:100%"><svg width="16" height="12" viewBox="0 0 3 2" style="margin-right:8px"><rect width="1" height="2" fill="#002395"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ED2939"/></svg> Français</button>
              <button class="btn btn-primary" id="btn-lang-en" style="justify-content:center;width:100%"><svg width="16" height="12" viewBox="0 0 60 30" style="margin-right:8px"><clipPath id="s"><path d="M0,0 v30 h60 v-30 z"/></clipPath><clipPath id="t"><path d="M30,15 h30 v15 z v0 h-30 z v-15 h-30 z v0 h30 z"/></clipPath><g clip-path="url(#s)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="4" clip-path="url(#t)"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></g></svg> English</button>
            </div>
          </div>
        </div>
        `;
        document.getElementById('btn-lang-fr').addEventListener('click', () => {
            setLang('fr');
            applyTranslations();
            currentStep = 0;
            renderOnboarding();
        });
        document.getElementById('btn-lang-en').addEventListener('click', () => {
            setLang('en');
            applyTranslations();
            currentStep = 0;
            renderOnboarding();
        });
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
          <span class="onboarding-label">TASKY</span>
          <div class="onboarding-dots">
            ${Array.from({ length: totalSteps }, (_, i) => `<span class="onboarding-dot ${i === currentStep ? 'active' : ''}"></span>`).join('')}
          </div>
        </div>
        <p class="onboarding-step-counter">STEP ${currentStep + 1} / ${totalSteps}</p>
        <h3 class="onboarding-title" style="display:flex;align-items:center;gap:10px">
            ${step.icon ? step.icon : ''}
            <span>${step.title}</span>
        </h3>
        <p class="onboarding-text" id="onboarding-typewriter"></p>
        <div class="onboarding-actions">
          ${currentStep > 0 ? `<button class="btn btn-secondary onboarding-prev" id="btn-onboarding-prev" style="padding:6px 12px">←</button>` : ''}
          <button class="btn btn-primary onboarding-next" id="btn-onboarding-next">${t('onboard.next')}</button>
          <button class="btn btn-ghost onboarding-skip" id="btn-onboarding-skip">${t('onboard.skip')}</button>
        </div>
      </div>
    </div>
  `;

    // Visual help: draw a highlight box around the target element if exists
    if (step.selector) {
        const target = document.getElementById(step.selector) || document.querySelector(`.${step.selector}`);
        if (target) {
            const rect = target.getBoundingClientRect();
            const highlight = document.createElement('div');
            highlight.id = 'onboarding-highlight';
            highlight.style.cssText = `
                position:fixed;
                top:${rect.top - 8}px;
                left:${rect.left - 8}px;
                width:${rect.width + 16}px;
                height:${rect.height + 16}px;
                border:2px solid var(--accent);
                border-radius:8px;
                box-shadow:0 0 0 9999px rgba(0,0,0,0.6), 0 0 20px var(--accent-glow);
                z-index:9998;
                pointer-events:none;
                transition: all 0.3s ease;
            `;
            document.body.appendChild(highlight);
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
    localStorage.setItem('bmm-onboarding-done', '1');
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
        overlay.classList.add('closing');
        overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
    }
}
