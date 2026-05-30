// @ts-nocheck
/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */
import { initProfiles, updateProfileChip, openNewProfileModal, getProfileIconSvg } from '../features/profiles/profiles.js';
import { initMods, refreshMods } from '../features/mods/mods.js';
import { initI18n, applyTranslations, t } from '../core/i18n.js';
import { initBenchmark } from '../features/bench/benchmark.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';
import { openTutorialHub } from './tutorial-hub.js';
import { initRepo } from '../features/repo/repo.js';
import { appState } from '../core/state.js';
import { initInteractiveDocs, openDiagram } from '../docs/interactive-docs.js';
import { initDocsUI } from '../docs/docs-ui.js';
import { initDeepLinks } from '../core/deep_link_manager.js';
import { initApiActivity } from '../core/api_activity.js';
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
import { initPlugins } from '../features/plugins/plugins.js';
import { initMapper } from '../features/mapper/mapper.js';
import { playBootSound, playCloseSound, setSoundEnabled, setSoundVolume } from './sound-engine.js';
export { setSoundEnabled, setSoundVolume, playCloseSound };
// Expose boot sound to inline loader script. If the loader already fired before this module
// loaded, __bmmBootSoundPending will be true — play it now.
window.__bmmPlayBootSound = () => playBootSound();
if (window.__bmmBootSoundPending) {
    window.__bmmBootSoundPending = false;
    try {
        playBootSound();
    }
    catch (_) { }
}
async function waitForModalClosed(id) {
    const el = document.getElementById(id);
    if (!el)
        return;
    if (!el.classList.contains('open'))
        return;
    await new Promise((resolve) => {
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
                    if (node === el || node.contains?.(el)) {
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
import { loadTauri, invoke, pickFolder, pickFile, saveFile, convertFileSrc, listenFileDrop, sendOsNotification } from '../core/api.js';
export { invoke, pickFolder, pickFile, saveFile, listenFileDrop, sendOsNotification };
// ── Toast ─────────────────────────────────────────────────
export function toast(message, type = 'info', duration = 3000, icon = '') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    if (icon) {
        // Custom SVG icon (replaces the default colored dot)
        const iconSpan = document.createElement('span');
        iconSpan.className = 'toast-icon';
        iconSpan.innerHTML = icon;
        el.appendChild(iconSpan);
    }
    else {
        const dot = document.createElement('div');
        dot.className = 'toast-dot';
        el.appendChild(dot);
    }
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
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
    if (!mascotContainer)
        return;
    const isAnimated = localStorage.getItem('bmm_tasky_animated') !== 'false';
    if (!isAnimated)
        return;
    const className = reverse ? 'is-loading-reverse' : 'is-loading';
    const otherClass = reverse ? 'is-loading' : 'is-loading-reverse';
    if (!mascotContainer.dataset.spinStartTime || mascotContainer.dataset.spinStartTime === '0') {
        mascotContainer.dataset.spinStartTime = Date.now().toString();
        mascotContainer.classList.remove(otherClass);
        mascotContainer.classList.add(className);
    }
    if (mascotContainer._spinTimeout) {
        clearTimeout(mascotContainer._spinTimeout);
        mascotContainer._spinTimeout = null;
    }
}
export function stopTaskyLoader() {
    const mascotContainer = document.getElementById('app-mascot-container');
    if (!mascotContainer || !mascotContainer.dataset.spinStartTime || mascotContainer.dataset.spinStartTime === '0')
        return;
    if (mascotContainer._spinTimeout)
        return; // Already stopping
    const startTime = parseInt(mascotContainer.dataset.spinStartTime);
    const elapsed = Date.now() - startTime;
    let timeToWait = 1000 - (elapsed % 1000);
    if (timeToWait < 300)
        timeToWait += 1000; // Add full spin if <300ms remaining
    mascotContainer._spinTimeout = setTimeout(() => {
        mascotContainer.classList.remove('is-loading', 'is-loading-reverse');
        mascotContainer.dataset.spinStartTime = '0';
        mascotContainer._spinTimeout = null;
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
                const marqueeContainer = document.getElementById('credits-marquee-container');
                if (viewId === 'credits') {
                    creditsVideo?.play().catch(() => { });
                }
                else {
                    // Pause video and clear marquee interval to free memory
                    if (creditsVideo && !creditsVideo.paused)
                        creditsVideo.pause();
                    if (marqueeContainer && marqueeContainer._marqueeInterval) {
                        clearInterval(marqueeContainer._marqueeInterval);
                        marqueeContainer._marqueeInterval = null;
                    }
                }
                // MEMORY OPTIMIZATION: Flush conflict cache if not in library
                if (viewId !== 'library') {
                    appState.flushMemory();
                }
                // MEMORY OPTIMIZATION: pause/release YouTube iframes when
                // leaving the docs view, then re-mount them on re-entry.
                // Removing the <iframe> outright (previous behaviour) broke
                // the docs page because nothing came back to repaint the
                // players.  Now we just blank the src, which releases the
                // WebView2 subframe process while leaving the DOM intact —
                // and on re-entry we ask the docs UI to rehydrate the players.
                if (viewId !== 'docs') {
                    document.querySelectorAll('#view-docs iframe').forEach((f) => {
                        const iframe = f;
                        // Stash the real src so we can restore it on return
                        if (iframe.src && iframe.src !== 'about:blank') {
                            iframe.dataset.bmmPausedSrc = iframe.src;
                            try {
                                iframe.src = 'about:blank';
                            }
                            catch { }
                        }
                    });
                    // Also pause any <video> playing to free decoder resources
                    document.querySelectorAll('#view-docs video').forEach((v) => {
                        try {
                            v.pause();
                        }
                        catch { }
                    });
                }
                else {
                    // Entering docs: restore stashed iframes; if the players
                    // were never set up (first navigation), trigger setup.
                    let anyRestored = false;
                    document.querySelectorAll('#view-docs iframe').forEach((f) => {
                        const iframe = f;
                        if (iframe.dataset.bmmPausedSrc) {
                            try {
                                iframe.src = iframe.dataset.bmmPausedSrc;
                            }
                            catch { }
                            delete iframe.dataset.bmmPausedSrc;
                            anyRestored = true;
                        }
                    });
                    if (!anyRestored) {
                        try {
                            window.__bmmSetupDocsVideos?.();
                        }
                        catch { }
                    }
                }
            }, 15);
        });
    });
    // Auto-detect when app regained focus — debounced to prevent Tauri multi-fire
    let _focusDebounce = null;
    window.addEventListener('focus', () => {
        if (_focusDebounce)
            return; // Ignore rapid re-fires (Tauri emits focus multiple times at startup)
        _focusDebounce = setTimeout(() => { _focusDebounce = null; }, 2000);
        const libView = document.getElementById('view-library');
        const detailOpen = !!document.getElementById('mod-detail-panel');
        if (libView && libView.classList.contains('active') && !detailOpen) {
            window._refreshModsFn?.(true);
        }
    });
    // Global SHA Status Listener
    (async () => {
        try {
            const { listen } = await import('../core/api.js');
            // Debounce timer for background (non-manual) SHA refresh — prevents 100 rapid refreshes
            let _shaRefreshDebounce = null;
            await listen('sha-status-changed', async (event) => {
                const payload = event.payload; // { mod_id, status, is_manual }
                console.log(`[SHA] Status changed for mod ${payload.mod_id}: ${payload.status}`);
                if (payload.status === 'calculating') {
                    const isLazy = !payload.is_manual;
                    const { getSettings } = await import('../core/api.js');
                    const settings = await getSettings();
                    if (payload.is_manual && settings.show_sha_loading_animation !== false) {
                        startTaskyLoader(); // Added Tasky mascot animation
                    }
                    // Show spinner on mod card (both manual and lazy)
                    const modCard = document.querySelector(`.mod-card[data-id="${payload.mod_id}"]`);
                    if (modCard) {
                        const shaIcon = modCard.querySelector('.sha-status-icon');
                        if (shaIcon) {
                            if (isLazy) {
                                // Lighter, more transparent spinner for background lazy processing
                                shaIcon.innerHTML = '<span class="spinner" style="width:12px;height:12px;border:2px solid rgba(139, 92, 246, 0.1);border-top-color:rgba(139, 92, 246, 0.4);border-radius:50%;animation:spin 1.5s linear infinite;display:inline-block;"></span>';
                            }
                            else {
                                // Stronger spinner for manual calculation
                                shaIcon.innerHTML = '<span class="spinner" style="width:12px;height:12px;border:2px solid rgba(139, 92, 246, 0.3);border-top-color:#8b5cf6;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;"></span>';
                            }
                        }
                    }
                    // Find the detail button
                    const btn = document.getElementById('btn-recalculate-sha');
                    const detailContainer = document.getElementById('mod-detail-container');
                    if (btn && detailContainer && detailContainer._currentModId === payload.mod_id) {
                        btn.classList.add('loading');
                        if (isLazy) {
                            btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.1);border-top-color:rgba(255,255,255,0.5);border-radius:50%;animation:spin 1.5s linear infinite;display:inline-block;"></span>';
                        }
                        else {
                            btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;"></span>';
                        }
                    }
                    // Content ID section animation
                    const cidBox = document.getElementById('content-id-box');
                    const cidLabel = document.getElementById('content-id-status-label');
                    const cidDot = document.getElementById('content-id-dot');
                    const cidHint = document.getElementById('content-id-hint');
                    const cidBtn = document.getElementById('btn-compute-content-id');
                    if (cidBox) {
                        cidBox.style.borderColor = 'rgba(139,92,246,0.4)';
                        cidBox.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.1), 0 0 8px rgba(139,92,246,0.15)';
                    }
                    if (cidLabel) {
                        cidLabel.style.color = 'var(--accent)';
                        cidLabel.innerHTML = `<span class="spinner" style="width:8px;height:8px;border:1.5px solid rgba(139,92,246,0.3);border-top-color:#8b5cf6;border-radius:50%;animation:spin 0.9s linear infinite;display:inline-block;flex-shrink:0"></span> COMPUTING...`;
                    }
                    if (cidHint)
                        cidHint.textContent = 'Hashing file content...';
                    if (cidBtn)
                        cidBtn.style.opacity = '0.4';
                }
                else if (payload.status === 'done' || payload.status === 'error' || payload.status === 'missing') {
                    if (payload.is_manual && payload.status !== 'missing') {
                        stopTaskyLoader(); // Stop Tasky mascot animation
                    }
                    // Explicitly remove loading spinners to ensure they don't get stuck before list refresh
                    const modCard = document.querySelector(`.mod-card[data-id="${payload.mod_id}"]`);
                    if (modCard) {
                        const shaIcon = modCard.querySelector('.sha-status-icon');
                        if (shaIcon) {
                            shaIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
                            if (payload.status === 'done') {
                                shaIcon.style.color = 'var(--success)';
                                shaIcon.style.opacity = '0.9';
                                shaIcon.className = 'sha-status-icon verified';
                            }
                            else {
                                shaIcon.style.color = 'var(--text-muted)';
                                shaIcon.style.opacity = '0.5';
                                shaIcon.className = 'sha-status-icon missing';
                            }
                        }
                    }
                    const btn = document.getElementById('btn-recalculate-sha');
                    if (btn) {
                        btn.classList.remove('loading');
                        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span data-i18n="mods.sha.recalculate">Recalculate SHA</span>';
                        const { applyTranslations } = await import('../core/i18n.js');
                        applyTranslations(btn);
                    }
                    // Reset Content ID section (re-render via list refresh will update values)
                    const cidBoxDone = document.getElementById('content-id-box');
                    const cidBtnDone = document.getElementById('btn-compute-content-id');
                    if (cidBoxDone) {
                        cidBoxDone.style.borderColor = '';
                        cidBoxDone.style.boxShadow = '';
                    }
                    if (cidBtnDone)
                        cidBtnDone.style.opacity = '';
                    if (payload.status === 'error' && payload.is_manual) {
                        const { toast } = await import('../ui/app.js');
                        toast('Failed to hash mod ' + payload.mod_id, 'error');
                    }
                    else if (payload.status === 'done' && payload.is_manual) {
                        const { toast } = await import('../ui/app.js');
                        toast('Hash calculation completed', 'success');
                    }
                    // Refresh main mod list — debounce background SHA refreshes to avoid 100+ rapid re-renders
                    if (window._refreshModsFn) {
                        if (payload.is_manual) {
                            window._refreshModsFn();
                        }
                        else {
                            if (_shaRefreshDebounce)
                                clearTimeout(_shaRefreshDebounce);
                            _shaRefreshDebounce = setTimeout(() => {
                                window._refreshModsFn?.();
                                _shaRefreshDebounce = null;
                            }, 1500);
                        }
                    }
                    // Refresh detail panel if it's the same mod
                    const detailContainer = document.getElementById('mod-detail-container');
                    if (detailContainer && detailContainer._currentModId === payload.mod_id) {
                        import('../features/mods/mods-details.js').then(m => m.renderModDetail(payload.mod_id));
                    }
                }
            });
        }
        catch (e) {
            console.error("[SHA] Failed to setup global listener", e);
        }
    })();
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
        // Fetch custom icon paths in parallel.
        const iconPaths = await fetchProfileIconPaths(profiles);
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
        // Update the dynamic profile icon in the wrapper (supports custom icon img).
        const wrapper = select.closest('.profile-select-icon-wrap');
        if (wrapper) {
            let iconEl = wrapper.querySelector('.profile-icon-display');
            if (!iconEl) {
                iconEl = document.createElement('span');
                iconEl.className = 'profile-icon-display';
                wrapper.insertBefore(iconEl, select);
            }
            updateSelectProfileIcon(select, profiles, iconPaths, iconEl);
        }
        // On change, refresh the icon next to the select.
        const wrp = select.closest('.profile-select-icon-wrap');
        const onChangeIconRefresh = () => {
            if (wrp) {
                const el = wrp.querySelector('.profile-icon-display');
                updateSelectProfileIcon(select, profiles, iconPaths, el);
            }
        };
        // Refresh icon when the user changes selection (no page reload needed).
        if (!select._iconChangeListener) {
            select._iconChangeListener = onChangeIconRefresh;
            select.addEventListener('change', onChangeIconRefresh);
        }
        else {
            // Already wired — just update to use the freshly fetched iconPaths.
            select.removeEventListener('change', select._iconChangeListener);
            select._iconChangeListener = onChangeIconRefresh;
            select.addEventListener('change', onChangeIconRefresh);
        }
        // Add change listener only once
        if (!select._hasListener) {
            select.addEventListener('change', async () => {
                const id = select.value;
                if (!id)
                    return;
                // Trigger mascot loading
                startTaskyLoader();
                try {
                    await invoke('set_active_profile', { profileId: id });
                    await updateProfileChip();
                    if (window._refreshModsFn)
                        await window._refreshModsFn();
                    await updateLibraryProfileSelector(); // Keep labels in sync
                    applyTranslations();
                }
                catch (e) {
                    const { toast } = await import('../ui/app.js');
                    toast((window.t ? window.t('common.error') : 'Error') + ' : ' + e, 'error');
                }
                finally {
                    stopTaskyLoader();
                }
            });
            select._hasListener = true;
        }
    }
    catch (err) {
        console.warn("Profile selector update failed:", err);
    }
}
// ── Reusable profile-select icon helpers ──────────────────────────────────────
// Enriches <option> elements and maintains a sibling icon/thumbnail that
// reflects the currently selected profile's custom icon (or builtin SVG).
// Works for any <select> that lists profiles.
/** Fetch the custom icon path for every profile that has one (parallel). */
export async function fetchProfileIconPaths(profiles) {
    const entries = await Promise.all(profiles
        .filter(p => p.icon_image)
        .map(async (p) => {
        try {
            const path = await invoke('get_profile_icon_path', { profileId: p.id });
            return path ? [p.id, path] : null;
        }
        catch {
            return null;
        }
    }));
    return new Map(entries.filter(Boolean));
}
/** Update an icon element next to a <select> to show the selected profile's icon. */
export function updateSelectProfileIcon(selectEl, profiles, iconPaths, iconEl) {
    if (!selectEl || !iconEl)
        return;
    const id = selectEl.value;
    const p = profiles.find(x => x.id === id);
    const imgSrc = id && iconPaths.get(id) ? convertFileSrc(iconPaths.get(id)) : null;
    const ts = Date.now();
    if (imgSrc) {
        iconEl.innerHTML = `<img src="${imgSrc}?t=${ts}" style="width:16px;height:16px;border-radius:3px;object-fit:cover;vertical-align:middle;display:block;" alt="">`;
    }
    else {
        iconEl.innerHTML = getProfileIconSvg(p?.icon || 'user', 'width:14px;height:14px;vertical-align:middle');
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
    initApiActivity();
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
    initPlugins();
    document.getElementById('btn-restart-onboarding')?.addEventListener('click', () => {
        openTutorialHub();
    });
    applyTranslations();
    // Call this after translations to ensure it's not overwritten and elements are ready
    await initVersionDisplay();
    await initProfiles();
    await initMods();
    await updateProfileChip();
    await updateLibraryProfileSelector();
    // Load contributors before initializing credits
    await fetchContributors();
    initCredits();
    // Force an explicit initial scan at startup so we don't rely on the debounced focus event
    setTimeout(() => { refreshMods(true); }, 500);
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
            setTimeout(() => {
                // Kill all GSAP tweens on loader elements before removing to prevent "target not found" warnings
                const gsapInst = window.gsap;
                if (gsapInst) {
                    const targets = Array.from(loader.querySelectorAll('[id], .ld-char, .ld-word'));
                    targets.push(loader);
                    gsapInst.killTweensOf(targets);
                }
                loader.remove();
            }, 600);
        }, 800);
    }
    await initSettings();
    // ── Apply sound settings from config ──
    try {
        const { getSettings } = await import('../core/api.js');
        const cfg = await getSettings();
        const soundEnabled = cfg.sound_effects_enabled !== false;
        const soundVol = (cfg.sound_volume ?? 70) / 100;
        setSoundEnabled(soundEnabled);
        setSoundVolume(soundVol);
        localStorage.setItem('bmm_sound_enabled', String(soundEnabled));
        localStorage.setItem('bmm_sound_volume', String(soundVol));
    }
    catch (_e) { /* use defaults */ }
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
// ── Tasky mascot settings ────────────────────────────────
window.applyTaskySettings = function () {
    const visibleToggle = document.getElementById('toggle-tasky-visible');
    const animToggle = document.getElementById('toggle-tasky-animation');
    const tooltipToggle = document.getElementById('toggle-tasky-tooltip');
    const opacitySlider = document.getElementById('tasky-opacity-slider');
    const container = document.getElementById('app-mascot-container');
    const mascotImg = document.getElementById('app-mascot');
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
    if (container)
        container.style.display = isVisible ? '' : 'none';
    // Toggle class on body for global styling adjustments (like sidebar logo)
    if (isVisible)
        document.body.classList.remove('tasky-hidden');
    else
        document.body.classList.add('tasky-hidden');
    // Sidebar brand: removed redundant fallback logo logic
    // Animation: when off, make mascot look "stuck" (no shadow, flat)
    if (mascotImg) {
        if (isAnimated) {
            mascotImg.style.animation = '';
            mascotImg.style.filter = 'drop-shadow(2px 4px 12px rgba(0,0,0,0.6))';
            mascotImg.style.transform = '';
            if (container)
                container.style.animation = 'mascot-bounce 4s ease-in-out infinite';
        }
        else {
            mascotImg.style.animation = 'none';
            mascotImg.style.filter = 'none';
            mascotImg.style.transform = 'rotate(0deg)';
            if (container)
                container.style.animation = 'none';
        }
    }
    // Tooltip disable
    window.__taskyTooltipEnabled = tooltipEnabled;
    // Opacity for the tooltip bubble
    document.documentElement.style.setProperty('--tasky-bubble-opacity', String(opacity / 100));
    // Update opacity label
    const opacityLabel = document.getElementById('tasky-opacity-value');
    if (opacityLabel)
        opacityLabel.textContent = opacity + '%';
};
// ── Tasky tooltip mouse-follow ───────────────────────────
(function initTaskyMouseFollow() {
    let lastX = 0;
    let lastY = 0;
    window.updateTaskyPosition = (e) => {
        const bubble = document.querySelector('.tasky-speech-bubble');
        const container = document.getElementById('tasky-bubble-docs');
        if (!bubble || !container)
            return;
        // If e is null, use last coordinates (for manual calls)
        const clientX = e ? e.clientX : lastX;
        const clientY = e ? e.clientY : lastY;
        if (e && e.clientX !== undefined) {
            lastX = e.clientX;
            lastY = e.clientY;
        }
        // Only update if visible or active to save some cycles, 
        // but we need it to be positioned correctly THE INSTANT it's shown.
        // showTaskyHelp calls this manually.
        if (container.style.display === 'none' && !bubble.classList.contains('active'))
            return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const tw = container.offsetWidth || 350;
        const th = container.offsetHeight || 100;
        const target = (e && e.target) ? e.target : document.elementFromPoint(lastX, lastY);
        const isDropdown = target && !!target.closest('#global-dropdown-portal, .mod-actions-dropdown-content, .dropdown-menu, .dropdown-item, .btn-open-folder, .btn-open-active-folder, .btn-open-backup-folder, .btn-edit-mod, .btn-remove-mod, .btn-open-source-folder');
        const OFFSET = 20;
        const MARGIN = 15;
        let targetX = clientX + OFFSET;
        let targetY = clientY + OFFSET;
        let isFlippedX = false;
        let isFlippedY = false;
        if (isDropdown) {
            targetY = clientY - th - OFFSET;
            isFlippedY = true;
        }
        if (targetX + tw > vw - MARGIN) {
            targetX = clientX - tw - OFFSET;
            isFlippedX = true;
        }
        if (targetY + th > vh - MARGIN) {
            targetY = clientY - th - OFFSET;
            isFlippedY = true;
        }
        let finalX = Math.max(MARGIN, Math.min(targetX, vw - tw - MARGIN));
        let finalY = Math.max(MARGIN, Math.min(targetY, vh - th - MARGIN));
        container.style.flexDirection = isFlippedX ? 'row-reverse' : 'row';
        container.style.position = 'fixed';
        container.style.left = finalX + 'px';
        container.style.top = finalY + 'px';
        container.style.bottom = 'auto';
        container.style.right = 'auto';
        container.style.transform = 'none';
        container.style.zIndex = '999999999';
    };
    document.addEventListener('mousemove', (e) => window.updateTaskyPosition(e));
})();
// ── Restore Tasky preferences on page load ───────────────
(function initTaskyPrefs() {
    const container = document.getElementById('app-mascot-container');
    const mascotImg = document.getElementById('app-mascot');
    const visibleToggle = document.getElementById('toggle-tasky-visible');
    const animToggle = document.getElementById('toggle-tasky-animation');
    const tooltipToggle = document.getElementById('toggle-tasky-tooltip');
    const opacitySlider = document.getElementById('tasky-opacity-slider');
    const opacityLabel = document.getElementById('tasky-opacity-value');
    const isVisible = localStorage.getItem('bmm_tasky_visible') !== 'false';
    const isAnimated = localStorage.getItem('bmm_tasky_animated') !== 'false';
    const tooltipEnabled = localStorage.getItem('bmm_tasky_tooltip') !== 'false';
    const opacity = parseInt(localStorage.getItem('bmm_tasky_opacity') || '100');
    if (visibleToggle)
        visibleToggle.checked = isVisible;
    if (animToggle)
        animToggle.checked = isAnimated;
    if (tooltipToggle)
        tooltipToggle.checked = tooltipEnabled;
    if (opacitySlider)
        opacitySlider.value = String(opacity);
    if (opacityLabel)
        opacityLabel.textContent = opacity + '%';
    window.__taskyTooltipEnabled = tooltipEnabled;
    document.documentElement.style.setProperty('--tasky-bubble-opacity', String(opacity / 100));
    if (container)
        container.style.display = isVisible ? '' : 'none';
    if (mascotImg) {
        if (isAnimated) {
            mascotImg.style.filter = 'drop-shadow(2px 4px 12px rgba(0,0,0,0.6))';
            if (container)
                container.style.animation = 'mascot-bounce 4s ease-in-out infinite';
        }
        else {
            mascotImg.style.animation = 'none';
            mascotImg.style.filter = 'none';
            mascotImg.style.transform = 'rotate(0deg)';
            if (container)
                container.style.animation = 'none';
        }
    }
    // Sidebar logo fallback - removed as per request to look like original
})();
// ── Credits & Contributors ──────────────────────────────
let CONTRIBUTORS = [];
let CREDITS_MESSAGES = [
    'credits.msg1',
    'credits.msg2',
    'credits.msg3',
    'credits.msg4',
    'credits.msg5',
    'credits.msg6',
    'credits.msg7'
];
const CONTRIBUTORS_REMOTE_URL = 'https://raw.githubusercontent.com/BetterDCS/BMM_Contributors/refs/heads/main/contributors.json';
const CONTRIBUTORS_LOCAL_FALLBACK = 'assets/contributors.json';
async function fetchContributors() {
    const applyData = (data) => {
        if (data.contributors)
            CONTRIBUTORS = data.contributors;
        else if (Array.isArray(data))
            CONTRIBUTORS = data; // Backward compatibility
        if (data.messages && Array.isArray(data.messages)) {
            CREDITS_MESSAGES = data.messages;
        }
    };
    try {
        console.log("[BMM] Fetching contributors from remote...");
        const response = await fetch(CONTRIBUTORS_REMOTE_URL, { cache: 'no-cache' });
        if (response.ok) {
            const data = await response.json();
            applyData(data);
            console.log("[BMM] Successfully loaded remote contributors.");
            return;
        }
    }
    catch (e) {
        console.warn("[BMM] Remote contributors fetch failed, using local fallback:", e);
    }
    try {
        const response = await fetch(CONTRIBUTORS_LOCAL_FALLBACK);
        if (response.ok) {
            const data = await response.json();
            applyData(data);
            console.log("[BMM] Successfully loaded local fallback contributors.");
        }
    }
    catch (e) {
        console.error("[BMM] CRITICAL: Failed to load any contributors:", e);
    }
}
// Messages will be updated by fetchContributors()
function initCredits() {
    const marqueeContainer = document.getElementById('credits-marquee-container');
    const contributorsGrid = document.getElementById('contributors-grid');
    if (marqueeContainer) {
        let msgIndex = 0;
        const updateMarquee = () => {
            const key = CREDITS_MESSAGES[msgIndex];
            const newContent = `<div class="credits-marquee-content"><span class="marquee-msg">${t(key) || key}</span></div>`;
            // If first run, just set it
            if (marqueeContainer.children.length === 0) {
                marqueeContainer.innerHTML = newContent;
            }
            else {
                // Smooth replacement: the CSS animation handles the entry/exit
                marqueeContainer.innerHTML = newContent;
            }
            msgIndex = (msgIndex + 1) % CREDITS_MESSAGES.length;
        };
        updateMarquee();
        // Store interval ID on container so navigation can clear it
        marqueeContainer._marqueeInterval = setInterval(updateMarquee, 7000);
    }
    if (contributorsGrid) {
        const sections = [
            { id: 'staff', title: 'credits.sections.staff' },
            { id: 'kofi', title: 'credits.sections.kofi' },
            { id: 'testers', title: 'credits.sections.testers' }
        ];
        // Subcategory role mapping
        const subcategoryRoleMap = {
            'dev': 'credits.subcategory.dev',
            'community_support': 'credits.subcategory.communitySupport',
            'testing_team': 'credits.subcategory.testingTeam',
            'ptb': 'credits.subcategory.ptbTester',
            'early_access': 'credits.subcategory.earlyAccessTester'
        };
        contributorsGrid.style.display = 'block';
        contributorsGrid.innerHTML = sections.map(section => {
            const members = CONTRIBUTORS.filter(c => c.category === section.id || (section.id === 'testers' && c.category === 'tester'));
            if (members.length === 0)
                return '';
            return `
                <div class="credits-category-section" style="margin-bottom: 24px;">
                    <div class="credits-category-title" data-i18n="${section.title}" style="margin-bottom:12px; font-size:0.8rem; opacity:0.5; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:6px;">
                        ${t(section.title)}
                    </div>
                    <div class="sub-contributors-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px;">
                        ${members.map(c => {
                const sub = c.subcategory;
                // Check if role is a translation key or a literal string
                const isKey = c.role && c.role.includes('.');
                const roleText = isKey ? t(c.role) : c.role;
                return `
                                <div class="contributor-card glass-card" onclick="openContributorModal('${c.id}')">
                                    <div class="contributor-pfp-box">
                                        <img src="${c.pfp}" class="contributor-pfp" alt="${c.display_name || c.username}">
                                    </div>
                                    <div class="contributor-name">${c.display_name || c.username}</div>
                                    <div class="contributor-role" ${isKey ? `data-i18n="${c.role}"` : ''}>${roleText}</div>
                                </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }
    // Language change support
    document.addEventListener('langChanged', () => {
        if (contributorsGrid) {
            contributorsGrid.querySelectorAll('.contributor-role').forEach(el => {
                const key = el.dataset.i18n;
                if (key)
                    el.textContent = t(key);
            });
            contributorsGrid.querySelectorAll('.credits-category-title').forEach(el => {
                const key = el.dataset.i18n;
                if (key)
                    el.textContent = t(key);
            });
        }
    });
}
window.openStackModal = () => {
    const modal = document.getElementById('modal-stack');
    const content = document.getElementById('stack-modal-content');
    if (!modal || !content)
        return;
    const backend = [
        { name: "Tauri", v: "1.0", key: "tauri", url: "https://tauri.app/" },
        { name: "Serde", v: "1.0", key: "serde", url: "https://serde.rs/" },
        { name: "Tokio", v: "1.0", key: "tokio", url: "https://tokio.rs/" },
        { name: "Reqwest", v: "0.11", key: "reqwest", url: "https://github.com/seanmonstar/reqwest" },
        { name: "Walkdir", v: "2.0", key: "walkdir", url: "https://github.com/BurntSushi/walkdir" },
        { name: "Zip", v: "0.6", key: "zip", url: "https://github.com/zip-rs/zip" },
        { name: "SHA2", v: "0.10", key: "sha2", url: "https://github.com/RustCrypto/hashes" },
        { name: "Discord RP", v: "0.2", key: "discord-rich-presence", url: "https://github.com/vionya/discord-rich-presence" },
        { name: "Warp", v: "0.3", key: "warp", url: "https://github.com/seanmonstar/warp" },
        { name: "Rayon", v: "1.8", key: "rayon", url: "https://github.com/rayon-rs/rayon" },
        { name: "Anyhow", v: "1.0", key: "anyhow", url: "https://github.com/dtolnay/anyhow" },
        { name: "Sysinfo", v: "0.30", key: "sysinfo", url: "https://github.com/GuillaumeGomez/sysinfo" },
        { name: "Tracing", v: "0.1", key: "tracing", url: "https://github.com/tokio-rs/tracing" },
        { name: "Clap", v: "4.0", key: "clap", url: "https://github.com/clap-rs/clap" },
        { name: "Comfy Table", v: "7.0", key: "comfy-table", url: "https://github.com/Nukesor/comfy-table" },
        { name: "Chrono", v: "0.4", key: "chrono", url: "https://github.com/chronotope/chrono" },
        { name: "Regex", v: "1.0", key: "regex", url: "https://github.com/rust-lang/regex" },
        { name: "UUID", v: "1.0", key: "uuid", url: "https://github.com/uuid-rs/uuid" },
        { name: "Image", v: "0.25", key: "image", url: "https://github.com/image-rs/image" },
        { name: "Rand", v: "0.8", key: "rand", url: "https://github.com/rust-random/rand" },
        { name: "Tempfile", v: "3.0", key: "tempfile", url: "https://github.com/Stebalien/tempfile" },
        { name: "Base64", v: "0.21", key: "base64", url: "https://github.com/marshallpierce/rust-base64" },
        { name: "Winreg", v: "0.52", key: "winreg", url: "https://github.com/gentoo90/winreg-rs" },
        { name: "Jwalk", v: "0.8", key: "jwalk", url: "https://github.com/Byron/jwalk" },
        { name: "Hex", v: "0.4", key: "hex", url: "https://github.com/KokaKiwi/rust-hex" }
    ];
    const frontend = [
        { name: "TypeScript", v: "5.7", key: "typescript", url: "https://www.typescriptlang.org/" },
        { name: "TanStack Query", v: "5.0", key: "tanstack-query", url: "https://tanstack.com/query/latest" },
        { name: "Cheerio", v: "1.2", key: "cheerio", url: "https://cheerio.js.org/" },
        { name: "Tauri API", v: "1.0", key: "tauri-api", url: "https://tauri.app/v1/api/js/" },
        { name: "Tauri CLI", v: "1.0", key: "tauri-cli", url: "https://tauri.app/v1/guides/features/cli" },
        { name: "Concurrently", v: "9.2", key: "concurrently", url: "https://github.com/open-cli-tools/concurrently" }
    ];
    content.innerHTML = `
        <div class="stack-section-title" data-i18n="credits.stackBackend">${t('credits.stackBackend')}</div>
        <div class="stack-grid">
            ${backend.map(item => `
                <div class="stack-item" style="cursor:pointer" onclick="window.open('${item.url}', '_blank')">
                    <div class="stack-item-header">
                        <span class="stack-item-name">${item.name}</span>
                        <span class="stack-item-version">${item.v}</span>
                    </div>
                    <div class="stack-item-desc" data-i18n="credits.stackCrate.${item.key}">${t(`credits.stackCrate.${item.key}`)}</div>
                </div>
            `).join('')}
        </div>
        <div class="stack-section-title" data-i18n="credits.stackFrontend">${t('credits.stackFrontend')}</div>
        <div class="stack-grid">
            ${frontend.map(item => `
                <div class="stack-item" style="cursor:pointer" onclick="window.open('${item.url}', '_blank')">
                    <div class="stack-item-header">
                        <span class="stack-item-name">${item.name}</span>
                        <span class="stack-item-version">${item.v}</span>
                    </div>
                    <div class="stack-item-desc" data-i18n="credits.stackPkg.${item.key}">${t(`credits.stackPkg.${item.key}`)}</div>
                </div>
            `).join('')}
        </div>
    `;
    modal.classList.add('open');
};
window.openContributorModal = (id) => {
    const c = CONTRIBUTORS.find(x => x.id === id);
    if (!c)
        return;
    const modal = document.getElementById('modal-contributor-detail');
    const content = document.getElementById('contributor-modal-content');
    if (!modal || !content)
        return;
    content.innerHTML = `
        <div class="contributor-modal-hero">
            <img src="${c.pfp}" class="contributor-modal-pfp">
            <div class="contributor-modal-info">
                <h2>${c.display_name || c.username}</h2>
                <p ${c.role && c.role.includes('.') ? `data-i18n="${c.role}"` : ''}>
                    ${c.role && c.role.includes('.') ? t(c.role) : c.role}
                </p>
            </div>
        </div>
        <div class="contributor-modal-bio" ${c.description && c.description.includes('.') ? `data-i18n="${c.description}"` : ''}>
            ${c.description && c.description.includes('.') ? t(c.description) : c.description}
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
//# sourceMappingURL=app.js.map