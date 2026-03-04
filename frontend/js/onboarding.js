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
        },
        {
            title: t('onboard.s2.title'),
            text: t('onboard.s2.text'),
            img: 'assets/Tasky.png',
        },
        {
            title: t('onboard.s3.title'),
            text: t('onboard.s3.text'),
            img: 'assets/Tasky_yeux1.png',
        },
        {
            title: t('onboard.s4.title'),
            text: t('onboard.s4.text'),
            img: 'assets/Tasky.png',
        },
        {
            title: t('onboard.s5.title'),
            text: t('onboard.s5.text'),
            img: 'assets/Tasky_yeux1.png',
        },
        {
            title: t('onboard.s6.title'),
            text: t('onboard.s6.text'),
            img: 'assets/Tasky_Happy.png',
        },
        {
            title: t('onboard.s7.title'),
            text: t('onboard.s7.text'),
            img: 'assets/Tasky.png',
        },
        {
            title: t('onboard.s8.title'),
            text: t('onboard.s8.text'),
            img: 'assets/Tasky_Happy.png',
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
              <button class="btn btn-primary" id="btn-lang-fr" style="justify-content:center;width:100%">🇫🇷 Français</button>
              <button class="btn btn-primary" id="btn-lang-en" style="justify-content:center;width:100%">🇬🇧 English</button>
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

    overlay.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-mascot">
        <img src="${step.img}" alt="Tasky" class="onboarding-mascot-img" />
      </div>
      <div class="onboarding-content">
        <div class="onboarding-header">
          <span class="onboarding-label">TASKY</span>
          <div class="onboarding-dots">
            ${Array.from({ length: totalSteps }, (_, i) => `<span class="onboarding-dot ${i === currentStep ? 'active' : ''}"></span>`).join('')}
          </div>
        </div>
        <p class="onboarding-step-counter">STEP ${currentStep + 1} / ${totalSteps}</p>
        <h3 class="onboarding-title">${step.title}</h3>
        <p class="onboarding-text" id="onboarding-typewriter"></p>
        <div class="onboarding-actions">
          ${currentStep > 0 ? `<button class="btn btn-secondary onboarding-prev" id="btn-onboarding-prev" style="padding:6px 12px">←</button>` : ''}
          <button class="btn btn-primary onboarding-next" id="btn-onboarding-next">${t('onboard.next')}</button>
          <button class="btn btn-ghost onboarding-skip" id="btn-onboarding-skip">${t('onboard.skip')}</button>
        </div>
      </div>
    </div>
  `;

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
            if (currentStep > 0) {
                currentStep--;
                renderOnboarding();
            }
        });
    }

    document.getElementById('btn-onboarding-skip').addEventListener('click', () => {
        clearInterval(typeInterval);
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
