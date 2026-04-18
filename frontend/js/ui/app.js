// @ts-nocheck
/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */
import { initProfiles, updateProfileChip, openNewProfileModal } from '../features/profiles/profiles.js';
import { initMods } from '../features/mods/mods.js';
import { initI18n, applyTranslations, t } from '../core/i18n.js';
import { initBenchmark } from '../features/bench/benchmark.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';
import { initRepo } from '../features/repo/repo.js';
import { initInteractiveDocs, openDiagram } from '../docs/interactive-docs.js';
import { initDocsUI } from '../docs/docs-ui.js';
import { initDeepLinks } from '../core/deep_link_manager.js';
import { initTitlebar } from './titlebar.js';
import { initSettings, runAutoBenchmarks } from '../features/settings/settings.js';
import { initModals } from './modals.js';
import { initNavbarVersion, initUpdateNotes, initAutoUpdate, checkPtbMode, checkAutoEula, checkShowReleaseNotes } from './update-notes.js';
// New Modularized Imports
import { initModlist } from '../features/mods/modlist.js';
import { initCrashReportUI, checkPreviousCrash } from './crash-report.js';
import { initInteractionLogging } from './user-logger.js';
import { initDebugMenu } from '../features/debug/debug-menu.js';
async function waitForModalClosed(id) {
    const el = document.getElementById(id);
    if (!el)
        return;
    if (!el.classList.contains('open'))
        return;
    await new Promise((resolve) => {
        const obs = new MutationObserver(() => {
            if (!el.classList.contains('open')) {
                obs.disconnect();
                resolve();
            }
        });
        obs.observe(el, { attributes: true, attributeFilter: ['class'] });
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
// ── Navigation ────────────────────────────────────────────
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            invoke('log_frontend_line', { line: `Navigated to view: ${viewId}` });
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
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
                    }
                    else {
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
            }
            else {
                creditsVideo.play().catch(() => { });
            }
        }
    });
}
// ── Navbar Language Dropdown ──────────────────────────────
export function initNavbarLangDropdown() {
    const container = document.getElementById('nav-lang-dropdown');
    if (!container)
        return;
    // Importing i18n functions here as they are tightly coupled with the UI
    import('../core/i18n.js').then(({ getLanguages, setLang }) => {
        function render() {
            const langs = getLanguages();
            const current = langs.find(l => l.active) || langs[0];
            const getFlag = (l) => {
                if (!l || !l.flag)
                    return '⚪';
                const f = l.flag.trim();
                // If it's already an emoji (complex character) or a long string, return it as is
                if (f.length > 2)
                    return f;
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
                    if (window._refreshModsFn)
                        window._refreshModsFn();
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
    if (!banner)
        return;
    function updateStatus() {
        if (navigator.onLine) {
            banner.classList.remove('visible');
        }
        else {
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
    if (!select)
        return;
    try {
        const profiles = await invoke('get_profiles');
        const activeId = await invoke('get_active_profile_id');
        // Always include/reset to the placeholder as the first option
        select.innerHTML = `<option value="" data-i18n="lib.selectProfile">${t('lib.selectProfile') || '— Select a profile —'}</option>`;
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.game_name ? ` — ${t(p.game_name) || p.game_name}` : '');
            if (p.id === activeId)
                opt.selected = true;
            select.appendChild(opt);
        });
        // Add change listener only once
        if (!select._hasListener) {
            select.addEventListener('change', async () => {
                const id = select.value;
                if (!id)
                    return;
                try {
                    await invoke('set_active_profile', { profileId: id });
                    await updateProfileChip();
                    if (window._refreshModsFn)
                        await window._refreshModsFn();
                    await updateLibraryProfileSelector(); // Keep labels in sync
                    applyTranslations();
                }
                catch (e) {
                    toast('Erreur chargement profil : ' + e, 'error');
                }
            });
            select._hasListener = true;
        }
    }
    catch (err) {
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
            }
            catch (err) {
                console.warn("[BMM] Failed to fetch PTB mode:", err);
            }
            const suffix = isPtb ? "-FAB" : "";
            const versionStr = `V${version}${suffix}`;
            let buildDate = "Unknown";
            try {
                buildDate = await invoke('get_build_date');
                console.log("[BMM] Found build date:", buildDate);
            }
            catch (invErr) {
                console.warn("[BMM] get_build_date invoke failed, using current date as fallback:", invErr);
                buildDate = new Date().toISOString().split('T')[0];
            }
            const buildStr = `Build: ${buildDate} — ${versionStr}`;
            const buildDisplay = document.getElementById('app-build-display');
            if (buildDisplay) {
                buildDisplay.textContent = buildStr;
                console.log("[BMM] Updated build display.");
            }
            else {
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
        }
        catch (e) {
            console.error("[BMM] CRITICAL: Failed to init version display:", e);
        }
    };
    await loadTauri();
    try {
        await invoke('log_frontend_line', { line: '[BMM] App started from generated TypeScript!' });
    }
    catch (e) { }
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
    // Show happy tasky when everything is ready
    const loaderImg = document.getElementById('loader-img');
    const loaderText = document.getElementById('loader-text');
    if (loaderImg)
        loaderImg.src = 'assets/Tasky_Happy.png';
    if (loaderText)
        loaderText.textContent = t('common.loaded');
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
        }
        catch (e) {
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
main().catch(console.error);
//# sourceMappingURL=app.js.map