// @ts-nocheck
/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */

import { initProfiles, renderProfiles, updateProfileChip, openNewProfileModal } from '../features/profiles/profiles.js';
import { initMods, refreshMods } from '../features/mods/mods.js';
import { initI18n, applyTranslations, t } from '../core/i18n.js';
import { initBenchmark } from '../features/bench/benchmark.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';
import { initRepo } from '../features/repo/repo.js';
import { appState } from '../core/state.js';
import { initInteractiveDocs, openDiagram } from '../docs/interactive-docs.js';
import { initDocsUI } from '../docs/docs-ui.js';
import { debugUI } from '../features/debug/debug-ui.js';
import { initDeepLinks } from '../core/deep_link_manager.js';
import { initTitlebar } from './titlebar.js';
import { initSettings, runAutoBenchmarks } from '../features/settings/settings.js';
import { initModals } from './modals.js';
import { initNavbarVersion, initUpdateNotes, initAutoUpdate, checkPtbMode, checkAutoEula, checkShowReleaseNotes, checkLangSelect } from './update-notes.js';

// New Modularized Imports
import { initModlist } from '../features/mods/modlist.js';
import { initModpackCreator } from '../features/mods/modpack-creator.js';
import { initCrashReportUI, checkPreviousCrash } from './crash-report.js';
import { initInteractionLogging } from './user-logger.js';
import { initDebugMenu } from '../features/debug/debug-menu.js';
import { checkSecurityMode } from './security-modal.js';
import { escHtml, escAttr, formatBytes } from '../core/utils.js';
import { initMapper } from '../features/mapper/mapper.js';

 async function waitForModalClosed(id: string): Promise<void> {
     const el = document.getElementById(id);
     if (!el) return;
     if (!el.classList.contains('open')) return;

     await new Promise<void>((resolve) => {
         // Observer 1: class change (modal hidden via classList.remove('open'))
         const classObs = new MutationObserver(() => {
             if (!el.classList.contains('open')) {
                 classObs.disconnect();
                 domObs.disconnect();
                 resolve();
             }
         });
         classObs.observe(el, { attributes: true, attributeFilter: ['class'] });

         // Observer 2: element removal from DOM (modal closed via .remove())
         const domObs = new MutationObserver((mutations) => {
             for (const m of mutations) {
                 for (const node of Array.from(m.removedNodes)) {
                     if (node === el || (node as Element).contains?.(el)) {
                         classObs.disconnect();
                         domObs.disconnect();
                         resolve();
                         return;
                     }
                 }
             }
         });
         domObs.observe(document.body, { childList: true, subtree: true });
     });
 }

// ── Tauri bridge ──────────────────────────────────────────
import { loadTauri, invoke, pickFolder, pickFile, saveFile, listenFileDrop, sendOsNotification } from '../core/api.js';

export { invoke, pickFolder, pickFile, saveFile, listenFileDrop, sendOsNotification };

// ── Toast ─────────────────────────────────────────────────
export function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    
    const dot = document.createElement('div');
    dot.className = 'toast-dot';
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    
    el.appendChild(dot);
    el.appendChild(textSpan);
    container.appendChild(el);

    const remove = () => {
        el.classList.add('removing');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    setTimeout(remove, duration);
}

// ── Tasky Sync Loading ──────────────────────────────────────
export function startTaskyLoader(reverse = false) {
    const mascotContainer = document.getElementById('app-mascot-container');
    if (!mascotContainer) return;
    const isAnimated = localStorage.getItem('bmm_tasky_animated') !== 'false';
    if (!isAnimated) return;

    const className = reverse ? 'is-loading-reverse' : 'is-loading';
    const otherClass = reverse ? 'is-loading' : 'is-loading-reverse';

    if (!mascotContainer.dataset.spinStartTime || mascotContainer.dataset.spinStartTime === '0') {
        mascotContainer.dataset.spinStartTime = Date.now().toString();
        mascotContainer.classList.remove(otherClass);
        mascotContainer.classList.add(className);
    }

    if ((mascotContainer as any)._spinTimeout) {
        clearTimeout((mascotContainer as any)._spinTimeout);
        (mascotContainer as any)._spinTimeout = null;
    }
}

export function stopTaskyLoader() {
    const mascotContainer = document.getElementById('app-mascot-container');
    if (!mascotContainer || !mascotContainer.dataset.spinStartTime || mascotContainer.dataset.spinStartTime === '0') return;

    if ((mascotContainer as any)._spinTimeout) return; // Already stopping

    const startTime = parseInt(mascotContainer.dataset.spinStartTime);
    const elapsed = Date.now() - startTime;
    let timeToWait = 1000 - (elapsed % 1000);
    
    if (timeToWait < 300) timeToWait += 1000; // Add full spin if <300ms remaining

    (mascotContainer as any)._spinTimeout = setTimeout(() => {
        mascotContainer.classList.remove('is-loading', 'is-loading-reverse');
        mascotContainer.dataset.spinStartTime = '0';
        (mascotContainer as any)._spinTimeout = null;
    }, timeToWait);
}

export function triggerTaskyPulse() {
    startTaskyLoader();
    stopTaskyLoader();
}

// ── Navigation ────────────────────────────────────────────
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;

            invoke('log_frontend_line', { line: `Navigated to view: ${viewId}` });

            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Trigger mascot loading safely
            triggerTaskyPulse();

            // Yield to main thread so the nav button highlights instantly
            setTimeout(() => {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById('view-' + viewId)?.classList.add('active');

                // Auto-sync when entering library
                if (viewId === 'library') {
                    window._refreshModsFn?.(true);
                }

                // Credits video background control
                const creditsVideo = document.getElementById('credits-bg-video');
                if (creditsVideo) {
                    if (viewId === 'credits') {
                        creditsVideo.play().catch(() => { });
                    } else {
                        creditsVideo.pause();
                    }
                }
            }, 15);
        });
    });

    // Auto-detect when app regained focus
    window.addEventListener('focus', () => {
        const libView = document.getElementById('view-library');
        const detailOpen = !!document.getElementById('mod-detail-panel');
        if (libView && libView.classList.contains('active') && !detailOpen) {
            window._refreshModsFn?.(true);
        }
    });

    // Credits video visibility control
    document.addEventListener('visibilitychange', () => {
        const creditsVideo = document.getElementById('credits-bg-video');
        const creditsView = document.getElementById('view-credits');
        if (creditsVideo && creditsView && creditsView.classList.contains('active')) {
            if (document.hidden) {
                creditsVideo.pause();
            } else {
                creditsVideo.play().catch(() => { });
            }
        }
    });
}

// ── Navbar Language Dropdown ──────────────────────────────
export function initNavbarLangDropdown() {
    const container = document.getElementById('nav-lang-dropdown');
    if (!container) return;

    // Importing i18n functions here as they are tightly coupled with the UI
    import('../core/i18n.js').then(({ getLanguages, setLang }) => {
        function render() {
            const langs = getLanguages();
            const current = langs.find(l => l.active) || langs[0];
            const getFlag = (l) => {
                if (!l || !l.flag) return '⚪';

                const f = l.flag.trim();
                // If it's already an emoji (complex character) or a long string, return it as is
                if (f.length > 2) return f;

                // If it's a 2-letter ISO code (e.g., "us", "FR", "de")
                if (f.length === 2) {
                    const code = f.toLowerCase();
                    // Use flagcdn.com for high quality flags with an offline text fallback
                    return `<img src="https://flagcdn.com/w20/${code}.png" 
                                 width="20" 
                                 height="14" 
                                 alt="${f.toUpperCase()}"
                                 style="vertical-align: middle; border-radius: 2px; object-fit: cover;"
                                 onerror="this.outerHTML='<span style=\\'font-size:10px; font-weight:700\\'>${f.toUpperCase()}</span>'">`;
                }

                return f;
            };

            container.innerHTML = `
                <button class="nav-lang-btn" id="nav-lang-toggle">
                    <span class="nav-lang-flag" style="margin-right:8px">${getFlag(current)}</span>
                    <span class="nav-lang-name">${current.name}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="nav-lang-chevron"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <div class="nav-lang-menu" id="nav-lang-menu">
                    ${langs.map(l => `
                        <button class="nav-lang-option ${l.active ? 'active' : ''}" data-lang="${l.code}">
                            <span class="nav-lang-flag" style="margin-right:10px">${getFlag(l)}</span>
                            <span>${l.name}</span>
                            ${l.active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" style="margin-left:auto"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                        </button>
                    `).join('')}
                </div>
            `;

            const toggle = document.getElementById('nav-lang-toggle');
            const menu = document.getElementById('nav-lang-menu');

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('open');
                toggle.classList.toggle('open');
            });

            menu.querySelectorAll('.nav-lang-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    setLang(opt.dataset.lang);
                    menu.classList.remove('open');
                    toggle.classList.remove('open');
                    render();
                    // Re-render dynamic content
                    updateLibraryProfileSelector();
                    if (window._refreshModsFn) window._refreshModsFn();
                });
            });

            document.addEventListener('click', () => {
                menu.classList.remove('open');
                toggle.classList.remove('open');
            });
        }
        render();
        document.addEventListener('langChanged', render);
    });
}

// ── Offline Detection ─────────────────────────────────────
function initOfflineDetection() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;

    function updateStatus() {
        if (navigator.onLine) {
            banner.classList.remove('visible');
        } else {
            banner.classList.add('active'); // active matches the CSS transition
            banner.classList.add('visible');
        }
    }

    window.addEventListener('online', () => {
        banner.classList.remove('visible');
        setTimeout(() => banner.classList.remove('active'), 400);
    });
    window.addEventListener('offline', () => {
        banner.classList.add('active');
        setTimeout(() => banner.classList.add('visible'), 10);
    });

    // Initial check
    if (!navigator.onLine) {
        banner.classList.add('active');
        banner.classList.add('visible');
    }
}

// ── Profile selector in Library ───────────────────────────
export async function updateLibraryProfileSelector() {
    const select = document.getElementById('lib-profile-select');
    if (!select) return;

    try {
        const profiles = await invoke('get_profiles');
        const activeId = await invoke('get_active_profile_id');

        // Always include/reset to the placeholder as the first option
        select.innerHTML = `<option value="" data-i18n="lib.selectProfile">${t('lib.selectProfile') || '— Select a profile —'}</option>`;

        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.game_name ? ` — ${t(p.game_name) || p.game_name}` : '');
            if (p.id === activeId) opt.selected = true;
            select.appendChild(opt);
        });

        // Add change listener only once
        if (!select._hasListener) {
            select.addEventListener('change', async () => {
                const id = select.value;
                if (!id) return;
                
                // Trigger mascot loading
                startTaskyLoader();
                
                try {
                    await invoke('set_active_profile', { profileId: id });
                    await updateProfileChip();
                    if (window._refreshModsFn) await window._refreshModsFn();
                    await updateLibraryProfileSelector(); // Keep labels in sync
                    applyTranslations();
                } catch (e) {
                    toast((window.t ? window.t('common.error') : 'Error') + ' : ' + e, 'error');
                } finally {
                    stopTaskyLoader();
                }
            });
            select._hasListener = true;
        }
    } catch (err) {
        console.warn("Profile selector update failed:", err);
    }
}

// ── Boot ──────────────────────────────────────────────────
async function main() {
    console.log('[BMM] App starting from generated TypeScript!');

    // Initialize Offline Detection
    initOfflineDetection();

    const initVersionDisplay = async () => {
        // Safety delay
        await new Promise(r => setTimeout(r, 300));

        console.log("[BMM] Starting version display initialization...");
        try {
            // Safe extraction of Tauri APIs
            const tauri = window.__TAURI__;
            if (!tauri) {
                console.warn("[BMM] window.__TAURI__ is not available. Skipping version injection.");
                return;
            }

            const getVersion = tauri.app.getVersion;
            const version = await getVersion();
            console.log("[BMM] Found version:", version);

            // Fetch PTB mode
            let isPtb = false;
            try {
                isPtb = await invoke('is_ptb_mode');
            } catch (err) {
                console.warn("[BMM] Failed to fetch PTB mode:", err);
            }

            const suffix = isPtb ? "-FAB" : "";
            const versionStr = `V${version}${suffix}`;

            let buildDate = "Unknown";
            try {
                buildDate = await invoke('get_build_date');
                console.log("[BMM] Found build date:", buildDate);
            } catch (invErr) {
                console.warn("[BMM] get_build_date invoke failed, using current date as fallback:", invErr);
                buildDate = new Date().toISOString().split('T')[0];
            }

            const buildStr = `Build: ${buildDate} — ${versionStr}`;

            const buildDisplay = document.getElementById('app-build-display');
            if (buildDisplay) {
                buildDisplay.textContent = buildStr;
                console.log("[BMM] Updated build display.");
            } else {
                console.warn("[BMM] app-build-display element not found.");
            }

            const versionBadge = document.getElementById('credits-hero-version');
            if (versionBadge) {
                versionBadge.textContent = versionStr;
                console.log("[BMM] Updated version badge.");
            }

            const creditsVerSub = document.getElementById('credits-version-subtitle');
            if (creditsVerSub) {
                creditsVerSub.textContent = `Better Mod Manager — ${versionStr} —`;
                console.log("[BMM] Updated credits subtitle.");
            }

            // Exhaustive sync for all version labels
            document.querySelectorAll('.titlebar-version').forEach(el => el.textContent = 'V' + version);
            document.querySelectorAll('.footer-version-pill').forEach(el => el.textContent = 'v' + version);
            document.querySelectorAll('.about-version').forEach(el => el.textContent = 'v' + version);

        } catch (e) {
            console.error("[BMM] CRITICAL: Failed to init version display:", e);
        }
    };
    await loadTauri();
    try {
        await invoke('log_frontend_line', { line: '[BMM] App started from generated TypeScript!' });
    } catch(e) {}
    await initI18n();

    initNavigation();
    initModals();
    initBenchmark();
    await initTitlebar();
    initModlist();
    initRepo();
    initInteractiveDocs();
    initDocsUI();
    initDeepLinks();

    const modpackContainer = document.getElementById('modpack-container');
    if (modpackContainer) {
        initModpackCreator(modpackContainer);
    }

    // Bind Docs Diagram buttons
    document.getElementById('btn-docs-resumable')?.addEventListener('click', () => openDiagram('resumable-downloads'));
    document.getElementById('btn-faq-resumable')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDiagram('resumable-downloads');
    });
    document.getElementById('btn-faq-resumable-alt')?.addEventListener('click', () => openDiagram('resumable-downloads'));
    initNavbarLangDropdown();
    initNavbarVersion();
    initUpdateNotes();
    initMapper();

    document.getElementById('btn-restart-onboarding')?.addEventListener('click', () => {
        startOnboarding();
    });

    applyTranslations();

    // Call this after translations to ensure it's not overwritten and elements are ready
    await initVersionDisplay();

    await initProfiles();
    await initMods();
    await updateProfileChip();
    await updateLibraryProfileSelector();
    initCredits();

    // Show happy tasky when everything is ready
    const loaderImg = document.getElementById('loader-img');
    const loaderText = document.getElementById('loader-text');
    if (loaderImg) loaderImg.src = 'assets/Tasky_Happy.png';
    if (loaderText) loaderText.textContent = t('common.loaded');

    // Hide loader smoothly after a small delay to see the happy face
    const loader = document.getElementById('app-loader');
    if (loader) {
        setTimeout(() => {
            loader.style.opacity = '0';
            loader.style.visibility = 'hidden';
            setTimeout(() => loader.remove(), 600);
        }, 800);
    }

    await initSettings();

    // ── Startup Modal Sequence ──
    // 0. Language selection on first start (before everything else)
    await checkLangSelect();
    await waitForModalClosed('modal-lang-select');

    // 1. Auto EULA on first start (if enabled in app.cfg)
    await checkAutoEula();
    await waitForModalClosed('modal-eula');

    // 2. Crash report UI wiring and check
    initCrashReportUI();
    await checkPreviousCrash();
    await waitForModalClosed('modal-crash-report');

    // 3. Auto Update System
    initAutoUpdate();

    // 4. Show release notes on first launch
    await checkShowReleaseNotes();
    await waitForModalClosed('modal-update-notes');

    // 4.5. FS Security Mode Choice (Persistent)
    await checkSecurityMode();
    await waitForModalClosed('modal-security-choice');

    // 5. Show onboarding on first launch (language is step 0 inside onboarding)
    if (await shouldShowOnboarding()) {
        // Delay slightly to allow UI to render
        setTimeout(() => {
            startOnboarding();
        }, 800);
    }

    // ── Auto-Calibration trigger at startup ──
    setTimeout(async () => {
        try {
            const { getSettings } = await import('../core/api.js');
            const settings = await getSettings();
            if (settings.auto_io_calibration) {
                console.log("[BMM] Auto-Calibration enabled, running boot optimization...");
                const disks = await invoke('get_system_disks');
                // Run benchmarks asynchronously without awaiting to avoid blocking other startup tasks
                runAutoBenchmarks(disks, true); 
            }
        } catch (e) {
            console.error("[BMM] Auto-Calibration startup failed:", e);
        }
    }, 2000); // 2s delay to ensure disks are mounted and system is stable

    // Interaction log
    initInteractionLogging();

    // Debug Menu
    initDebugMenu();

    // PTB Mode check
    checkPtbMode();


    const restartBtn = document.getElementById('btn-restart-tutorial');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));
            document.getElementById('view-library').classList.add('active');
            startOnboarding();
        });
    }

    const newProfileLibBtn = document.getElementById('btn-new-profile-lib');
    if (newProfileLibBtn) {
        newProfileLibBtn.addEventListener('click', () => {
            openNewProfileModal();
        });
    }

    // Global helper for navigation
    window.showProfiles = () => {
        document.querySelector('.nav-item[data-view="profiles"]')?.click();
    };
    window.openNewProfileModal = openNewProfileModal;

    // Version button uses inline onclick
}

// ── Tasky mascot settings ────────────────────────────────
window.applyTaskySettings = function() {
    const visibleToggle = document.getElementById('toggle-tasky-visible') as HTMLInputElement;
    const animToggle = document.getElementById('toggle-tasky-animation') as HTMLInputElement;
    const tooltipToggle = document.getElementById('toggle-tasky-tooltip') as HTMLInputElement;
    const opacitySlider = document.getElementById('tasky-opacity-slider') as HTMLInputElement;
    const container = document.getElementById('app-mascot-container');
    const mascotImg = document.getElementById('app-mascot') as HTMLImageElement;
    const sidebarBrand = document.querySelector('.sidebar-brand');

    const isVisible = visibleToggle ? visibleToggle.checked : true;
    const isAnimated = animToggle ? animToggle.checked : true;
    const tooltipEnabled = tooltipToggle ? tooltipToggle.checked : true;
    const opacity = opacitySlider ? parseInt(opacitySlider.value) : 100;

    // Persist
    localStorage.setItem('bmm_tasky_visible', String(isVisible));
    localStorage.setItem('bmm_tasky_animated', String(isAnimated));
    localStorage.setItem('bmm_tasky_tooltip', String(tooltipEnabled));
    localStorage.setItem('bmm_tasky_opacity', String(opacity));

    // Apply visibility - when hidden, show text logo in sidebar like fullscreen
    if (container) container.style.display = isVisible ? '' : 'none';
    
    // Toggle class on body for global styling adjustments (like sidebar logo)
    if (isVisible) document.body.classList.remove('tasky-hidden');
    else document.body.classList.add('tasky-hidden');

    // Sidebar brand: removed redundant fallback logo logic

    // Animation: when off, make mascot look "stuck" (no shadow, flat)
    if (mascotImg) {
        if (isAnimated) {
            mascotImg.style.animation = '';
            mascotImg.style.filter = 'drop-shadow(2px 4px 12px rgba(0,0,0,0.6))';
            mascotImg.style.transform = '';
            if (container) container.style.animation = 'mascot-bounce 4s ease-in-out infinite';
        } else {
            mascotImg.style.animation = 'none';
            mascotImg.style.filter = 'none';
            mascotImg.style.transform = 'rotate(0deg)';
            if (container) container.style.animation = 'none';
        }
    }

    // Tooltip disable
    (window as any).__taskyTooltipEnabled = tooltipEnabled;

    // Opacity for the tooltip bubble
    document.documentElement.style.setProperty('--tasky-bubble-opacity', String(opacity / 100));

    // Update opacity label
    const opacityLabel = document.getElementById('tasky-opacity-value');
    if (opacityLabel) opacityLabel.textContent = opacity + '%';
};

// ── Tasky tooltip mouse-follow ───────────────────────────
(function initTaskyMouseFollow() {
    document.addEventListener('mousemove', (e: MouseEvent) => {
        const bubble = document.querySelector('.tasky-speech-bubble') as HTMLElement;
        const container = document.getElementById('tasky-bubble-docs') as HTMLElement;
        if (!bubble || !container) return;
        if (!bubble.classList.contains('active')) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        
        // Use total container width for accurate clamping (mascot + bubble)
        const tw = container.offsetWidth || 350;
        const th = container.offsetHeight || 100;

        const target = e.target as HTMLElement;
        const isDropdown = !!target.closest('#global-dropdown-portal, .mod-actions-dropdown-content, .dropdown-menu, .dropdown-item, .btn-open-folder, .btn-open-active-folder, .btn-open-backup-folder, .btn-edit-mod, .btn-remove-mod, .btn-open-source-folder');
        const isBusy = !!target.closest('button, .nav-item, .dropdown-menu, .mod-item-card, .glass-card, .search-mode-pill, .titlebar-controls');
        
        // Adaptive offsets: increased to avoid overlap with dropdowns
        const BASE_OFFSET = 20;
        const BUSY_OFFSET = isBusy ? 40 : BASE_OFFSET;
        const MARGIN = 20;

        // 1. Initial Candidate: Bottom-Right
        let targetX = e.clientX + BUSY_OFFSET;
        let targetY = e.clientY + BUSY_OFFSET;
        
        let isFlippedX = false;
        let isFlippedY = false;

        // Force position ABOVE if inside a dropdown to avoid obscuring other items
        if (isDropdown) {
            targetY = e.clientY - th - BUSY_OFFSET - 10; // Extra spacing from dropdown
            isFlippedY = true;
        }

        // 2. Horizontal Flip Decision: If more than 30% of tooltip would be hidden on the right
        if (targetX + tw > vw - MARGIN) {
            const overflowAmount = (targetX + tw) - (vw - MARGIN);
            if (overflowAmount > tw * 0.3) {
                targetX = e.clientX - tw - BUSY_OFFSET;
                isFlippedX = true;
            }
        }

        // 3. Vertical Flip Decision
        if (targetY + th > vh - MARGIN) {
            const overflowAmount = (targetY + th) - (vh - MARGIN);
            if (overflowAmount > th * 0.3) {
                targetY = e.clientY - th - BUSY_OFFSET;
                isFlippedY = true;
            }
        }

        // 4. Final Clamping: Ensure 100% visibility (if 1% or more is hidden, we push it back)
        let finalX = Math.max(MARGIN, Math.min(targetX, vw - tw - MARGIN));
        let finalY = Math.max(MARGIN, Math.min(targetY, vh - th - MARGIN));

        // 5. Layout adjustment: flip mascot if on left
        container.style.flexDirection = isFlippedX ? 'row-reverse' : 'row';
        
        container.style.position = 'fixed';
        container.style.left = finalX + 'px';
        container.style.top = finalY + 'px';
        container.style.bottom = 'auto';
        container.style.right = 'auto';
        container.style.transform = 'none';
        container.style.zIndex = '999999999'; 
    });
})();

// ── Restore Tasky preferences on page load ───────────────
(function initTaskyPrefs() {
    const container = document.getElementById('app-mascot-container');
    const mascotImg = document.getElementById('app-mascot') as HTMLImageElement;
    const visibleToggle = document.getElementById('toggle-tasky-visible') as HTMLInputElement;
    const animToggle = document.getElementById('toggle-tasky-animation') as HTMLInputElement;
    const tooltipToggle = document.getElementById('toggle-tasky-tooltip') as HTMLInputElement;
    const opacitySlider = document.getElementById('tasky-opacity-slider') as HTMLInputElement;
    const opacityLabel = document.getElementById('tasky-opacity-value');

    const isVisible = localStorage.getItem('bmm_tasky_visible') !== 'false';
    const isAnimated = localStorage.getItem('bmm_tasky_animated') !== 'false';
    const tooltipEnabled = localStorage.getItem('bmm_tasky_tooltip') !== 'false';
    const opacity = parseInt(localStorage.getItem('bmm_tasky_opacity') || '100');

    if (visibleToggle) visibleToggle.checked = isVisible;
    if (animToggle) animToggle.checked = isAnimated;
    if (tooltipToggle) tooltipToggle.checked = tooltipEnabled;
    if (opacitySlider) opacitySlider.value = String(opacity);
    if (opacityLabel) opacityLabel.textContent = opacity + '%';

    (window as any).__taskyTooltipEnabled = tooltipEnabled;
    document.documentElement.style.setProperty('--tasky-bubble-opacity', String(opacity / 100));

    if (container) container.style.display = isVisible ? '' : 'none';

    if (mascotImg) {
        if (isAnimated) {
            mascotImg.style.filter = 'drop-shadow(2px 4px 12px rgba(0,0,0,0.6))';
            if (container) container.style.animation = 'mascot-bounce 4s ease-in-out infinite';
        } else {
            mascotImg.style.animation = 'none';
            mascotImg.style.filter = 'none';
            mascotImg.style.transform = 'rotate(0deg)';
            if (container) container.style.animation = 'none';
        }
    }

    // Sidebar logo fallback - removed as per request to look like original
})();

// ── Credits & Contributors ──────────────────────────────
const CONTRIBUTORS = [
    {
        id: 'freeproject',
        username: 'FreeProject089',
        pfp: 'assets/pfp.webp',
        role: 'contributor.freeproject.role',
        description: 'contributor.freeproject.msg',
        github: 'https://github.com/FreeProject089',
        website: 'https://freeproject089.github.io/BMM_Web/'
    },
    {
        id: 'c0c0_1er',
        username: 'c0c0_1er',
        pfp: 'assets/pfpc0c0.png',
        role: 'contributor.c0c0_1er.role',
        description: 'contributor.c0c0_1er.msg',
        github: 'https://github.com/WarGameRP'
    }
];

const CREDITS_MESSAGES = [
    "Better Mods Manager — Modern Modding for DCS World",
    "Join our Discord community for support and updates",
    "Thank you for using BMM! Your feedback matters.",
    "Project source code is available on GitHub"
];

function initCredits() {
    const marqueeContainer = document.getElementById('credits-marquee-container');
    const contributorsGrid = document.getElementById('contributors-grid');

    if (marqueeContainer) {
        let msgIndex = 0;
        const updateMarquee = () => {
            // Remove old content to restart animation
            marqueeContainer.innerHTML = '';
            const msg = document.createElement('div');
            msg.className = 'credits-marquee-content';
            msg.innerHTML = `<span class="marquee-msg">${CREDITS_MESSAGES[msgIndex]}</span>`;
            marqueeContainer.appendChild(msg);
            
            msgIndex = (msgIndex + 1) % CREDITS_MESSAGES.length;
        };
        updateMarquee();
        setInterval(updateMarquee, 10000); // Must match CSS animation duration
    }

    if (contributorsGrid) {
        contributorsGrid.innerHTML = CONTRIBUTORS.map(c => `
            <div class="contributor-card glass-card" onclick="openContributorModal('${c.id}')">
                <div class="contributor-pfp-box">
                    <img src="${c.pfp}" class="contributor-pfp" alt="${c.username}">
                </div>
                <div class="contributor-name">${c.username}</div>
                <div class="contributor-role" data-i18n="${c.role}">${t(c.role)}</div>
            </div>
        `).join('');
    }

    // Language change support
    document.addEventListener('langChanged', () => {
        if (contributorsGrid) {
            contributorsGrid.querySelectorAll('.contributor-role').forEach(el => {
                const key = el.dataset.i18n;
                if (key) el.textContent = t(key);
            });
        }
    });
}

(window as any).openContributorModal = (id: string) => {
    const c = CONTRIBUTORS.find(x => x.id === id);
    if (!c) return;

    const modal = document.getElementById('modal-contributor-detail');
    const content = document.getElementById('contributor-modal-content');
    if (!modal || !content) return;

    content.innerHTML = `
        <div class="contributor-modal-hero">
            <img src="${c.pfp}" class="contributor-modal-pfp">
            <div class="contributor-modal-info">
                <h2>${c.username}</h2>
                <p data-i18n="${c.role}">${t(c.role)}</p>
            </div>
        </div>
        <div class="contributor-modal-bio" data-i18n="${c.description}">
            ${t(c.description)}
        </div>
        <div class="contributor-modal-links">
            ${c.github ? `
                <a href="${c.github}" target="_blank" class="contributor-link-btn">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                    GitHub
                </a>
            ` : ''}
            ${c.website ? `
                <a href="${c.website}" target="_blank" class="contributor-link-btn">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    Website
                </a>
            ` : ''}
        </div>
    `;

    modal.classList.add('open');
};

main().catch(console.error);
