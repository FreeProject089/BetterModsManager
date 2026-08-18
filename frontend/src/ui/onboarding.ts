// @ts-nocheck
/**
 * onboarding.ts — First-launch flow: language selection → Tutorial Hub.
 *
 * On first run this shows a language picker (step -1) then opens the
 * Tutorial Hub. Subsequent launches go directly to the app.
 * The hub can be reopened at any time via openTutorialHub().
 */
import { t, getLang, setLang, getLanguages } from '../core/i18n.js';
import { openTutorialHub } from './tutorial-hub.js';

let _langStep = false;

export async function shouldShowOnboarding() {
    const { getSettings } = await import('../core/api.js');
    try {
        const settings = await getSettings();
        return !settings.onboarding_shown;
    } catch {
        return false;
    }
}

export async function markOnboardingShown() {
    const { getSettings, updateSettings } = await import('../core/api.js');
    try {
        const settings = await getSettings();
        settings.onboarding_shown = true;
        await updateSettings(settings);
    } catch (e) { console.error('Failed to save onboarding state:', e); }
}

/** Called on first launch — shows language selection, then opens the hub. */
export function startOnboarding() {
    // Language was already chosen earlier (the standalone first-run picker, or the
    // BetterInstaller handoff) → skip this redundant step and go straight to the hub.
    if (localStorage.getItem('bmm_lang_selected') === 'true') {
        _closeAndOpenHub();
        return;
    }
    _langStep = true;
    _renderLangStep();

    document.addEventListener('langChanged', () => {
        if (_langStep && document.getElementById('onboarding-overlay')) {
            _renderLangStep();
        }
    });
}

function _renderLangStep() {
    let overlay = document.getElementById('onboarding-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'onboarding-overlay';
        overlay.className = 'onboarding-overlay';
        document.getElementById('app-window-outer')?.appendChild(overlay);
    }

    const appShell = document.querySelector('.app-shell');
    if (appShell) appShell.style.pointerEvents = 'none';

    const languages = getLanguages();
    const appLang = getLang();
    const current = languages.find(l => l.code === appLang) || languages.find(l => l.active) || languages[0];

    const getFlag = (l) => {
        if (!l?.flag) return '⚪';
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
        <p class="onboarding-text" style="opacity:1" data-i18n="onboarding.lang_desc">${t('onboarding.lang_desc')}</p>

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

    toggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
        toggle.classList.toggle('open');
    });

    menu?.querySelectorAll('.nav-lang-option').forEach(opt => {
        opt.addEventListener('click', async (e) => {
            e.stopPropagation();
            await setLang(opt.dataset.lang);
        });
    });

    confirmBtn?.addEventListener('click', () => {
        _langStep = false;
        _closeAndOpenHub();
    });

    document.addEventListener('click', () => {
        menu?.classList.remove('open');
        toggle?.classList.remove('open');
    }, { once: true });
}

function _closeAndOpenHub() {
    markOnboardingShown();

    const appShell = document.querySelector('.app-shell');
    if (appShell) appShell.style.pointerEvents = '';

    const overlay = document.getElementById('onboarding-overlay');
    // First launch (and therefore also right after a factory reset, which clears
    // localStorage and reboots into a first launch): offer the look BEFORE the lessons.
    // The style modal opens first and the hub follows when it closes — Skip is just
    // closing it. Sequenced by callback so neither overlay fights the other.
    // Style → "you already use OvGME/OMM?" → hub. The import offer sits here and nowhere
    // else on the first run: it only appears when the scan actually found something, and by
    // the time the tutorial starts the imported profiles exist, so the lessons have real
    // data to point at instead of an empty library.
    const hub = () => {
        void import('./legacy-import.js')
            .then((m) => m.offerLegacyImport(() => openTutorialHub()))
            .catch(() => openTutorialHub());
    };
    const styleThenHub = () => {
        void import('./style-modal.js')
            .then((m) => m.openStyleModal(hub))
            .catch(hub);   // the hub must never be lost to a load failure
    };
    if (overlay) {
        overlay.classList.add('closing');
        overlay.addEventListener('animationend', () => {
            overlay.remove();
            styleThenHub();
        }, { once: true });
    } else {
        styleThenHub();
    }
}
