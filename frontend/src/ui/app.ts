// @ts-nocheck
/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */

import { initProfiles, renderProfiles, updateProfileChip, openNewProfileModal, getProfileIconSvg } from '../features/profiles/profiles.js';
import { initMods, refreshMods } from '../features/mods/mods.js';
import { initI18n, applyTranslations, t, getLang } from '../core/i18n.js';
import { initBenchmark } from '../features/bench/benchmark.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';
import { initNavbarCustomize } from './navbar-customize.js';
import { openTutorialHub } from './tutorial-hub.js';
import { initRepo } from '../features/repo/repo.js';
import { appState } from '../core/state.js';
import { initInteractiveDocs, openDiagram } from '../docs/interactive-docs.js';
import { initDocsHub } from '../docs/docs-hub.js';
import { initCommands } from '../core/commands.js';
import { debugUI } from '../features/debug/debug-ui.js';
import { initDeepLinks } from '../core/deep_link_manager.js';
import { initAnalytics, trackView } from '../core/analytics.js';
import { initApiActivity } from '../core/api_activity.js';
import { initTitlebar } from './titlebar.js';
import { initSettings, runAutoBenchmarks } from '../features/settings/settings.js';
import { initModals } from './modals.js';
import { initNavbarVersion, initUpdateNotes, initAutoUpdate, checkPtbMode, checkAutoEula, checkAutoPrivacy, checkShowReleaseNotes, checkLangSelect } from './update-notes.js';

// New Modularized Imports
import { initModlist } from '../features/mods/modlist.js';
import { initModpackCreator } from '../features/mods/modpack-creator.js';
import { initCrashReportUI, checkPreviousCrash } from './crash-report.js';
import { initInteractionLogging } from './user-logger.js';
import { initDebugMenu } from '../features/debug/debug-menu.js';
import { checkSecurityMode } from './security-modal.js';
import { initPlugins } from '../features/plugins/plugins.js';
import { escHtml, escAttr, formatBytes } from '../core/utils.js';
import { loadLinks, loadBcConfig, getLinks } from '../core/links-config.js';
import { initMapper } from '../features/mapper/mapper.js';
import { initAppsCatalog } from '../features/apps/apps-catalog.js';
import { initCommunity, openCommunity } from '../features/community/community.js';
import { openAdvancedPerfModal } from '../features/bench/benchmark.js';
import { restoreThemeAtBoot, initDataPage } from '../features/themes/theme-engine.js';
import { initThemeEditor } from '../features/themes/theme-editor.js';
import { initThemeCatalog } from '../features/themes/theme-catalog.js';
import { initCustomSelects } from './custom-select.js';
import { initTooltips } from './tooltips.js';
import { playBootSound, playCloseSound, setSoundEnabled, setSoundVolume } from './sound-engine.js';
export { setSoundEnabled, setSoundVolume, playCloseSound };

// Expose boot sound to inline loader script. If the loader already fired before this module
// loaded, __bmmBootSoundPending will be true — play it now.
(window as any).__bmmPlayBootSound = () => playBootSound();
if ((window as any).__bmmBootSoundPending) {
    (window as any).__bmmBootSoundPending = false;
    try { playBootSound(); } catch (_) {}
}

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
import { loadTauri, invoke, pickFolder, pickFile, saveFile, convertFileSrc, listenFileDrop, sendOsNotification, lastSavePath } from '../core/api.js';
import { recordNotification, initNotificationCenter } from './notification-center.js';
// Imported from the tiny standalone module, NOT from debug-ui: the trap has to be
// installed at boot to be worth anything, and pulling the whole DevTools surface
// onto the boot path to get it would trade one diagnostic for a slower start.
import { initWebviewErrorTrap } from '../features/debug/webview-env.js';

export { invoke, pickFolder, pickFile, saveFile, listenFileDrop, sendOsNotification };

/**
 * "Exported" is only half an answer. The other half — WHERE — was missing from every
 * export in the app, so the file existed somewhere the user then had to go and find.
 * This appends the destination and, because knowing the path and getting to it are
 * different problems, opens the containing folder on click.
 *
 * The path comes from the save dialog the export just used (core/api lastSavePath),
 * so no call site has to thread its own variable through. When an export did not go
 * through a dialog — an unattended backup to a configured folder — there is nothing
 * to name and this degrades to the plain message rather than inventing one.
 */
export function toastSaved(message: string, path?: string | null): void {
    const dest = path || lastSavePath();
    if (!dest) { toast(message, 'success'); return; }
    // The FOLDER, not the file: it is what you would open, and a full path in a toast
    // is unreadable at this width anyway.
    const folder = String(dest).replace(/[\\/][^\\/]+$/, '');
    toast(`${message} → ${folder}`, 'success', 6000);
    // Fire-and-forget: the toast has already told the truth, and a failure to open a
    // file manager must not turn a successful export into an error.
    setTimeout(() => {
        const el = document.querySelector('#toast-container .toast:last-child') as HTMLElement | null;
        if (!el) return;
        el.style.cursor = 'pointer';
        el.title = folder;
        el.addEventListener('click', () => {
            invoke('open_folder', { path: folder }).catch(() => { /* nothing to do */ });
        });
    }, 0);
}

// ── Toast ─────────────────────────────────────────────────
export function toast(message, type = 'info', duration = 3000, icon = '') {
    // Recorded here and ONLY here. A toast is a three-second window onto something
    // that already happened — miss it and the information was simply gone, because
    // there was no second place to look. Hooking the record into toast() rather
    // than into each caller means the notification centre and the toast can never
    // disagree about what the app said. (ui/notification-center.ts)
    try { recordNotification(String(message ?? ''), type as any); } catch { /* never let history break a message */ }

    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;

    if (icon) {
        // Custom SVG icon (replaces the default colored dot)
        const iconSpan = document.createElement('span');
        iconSpan.className = 'toast-icon';
        iconSpan.innerHTML = icon;
        el.appendChild(iconSpan);
    } else {
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

    // `duration: 0` = stays until the caller dismisses it. A "working…" toast on a
    // fixed timer either vanishes while the work is still running or, worse, lingers
    // next to the finished result — which is how the integrity check ended up showing
    // "checking…" beside its own completed report.
    const timer = duration > 0 ? setTimeout(remove, duration) : null;
    return () => {
        if (timer) clearTimeout(timer);
        remove();
    };
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
    // Apply saved navbar customization (order / hidden / rename) + add the editor trigger.
    initNavbarCustomize();

    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;

            invoke('log_frontend_line', { line: `Navigated to view: ${viewId}` });
            if (viewId) trackView(viewId);

            // Clear ALL nav items (incl. custom navbar buttons), not just [data-view],
            // otherwise a custom button stays stuck in its active/hover state.
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Trigger mascot loading safely
            triggerTaskyPulse();

            // Yield to main thread so the nav button highlights instantly
            setTimeout(() => {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById('view-' + viewId)?.classList.add('active');

                // Re-apply the (existing) collapsible-cards enhancement on every Settings
                // open — catches cards that were re-rendered since the initial pass.
                if (viewId === 'settings') {
                    import('./settings-fold.js').then(m => m.initCollapsibleSettingsCards()).catch(() => {});
                }

                // Auto-sync when entering library
                if (viewId === 'library') {
                    window._refreshModsFn?.(true);
                }

                // Load / render the BetterCommunity blog on entry (fetches once).
                if (viewId === 'community') {
                    openCommunity();
                }

                // Credits video background control
                const creditsVideo = document.getElementById('credits-bg-video') as HTMLVideoElement | null;
                const marqueeContainer = document.getElementById('credits-marquee-container');
                if (viewId === 'credits') {
                    creditsVideo?.play().catch(() => { });
                    // Restart the marquee — it was cleared when leaving credits, and
                    // without this it stays frozen/blank on every re-entry.
                    startCreditsMarquee();
                } else {
                    // Pause video and clear marquee interval to free memory
                    if (creditsVideo && !creditsVideo.paused) creditsVideo.pause();
                    if (marqueeContainer && (marqueeContainer as any)._marqueeInterval) {
                        clearInterval((marqueeContainer as any)._marqueeInterval);
                        (marqueeContainer as any)._marqueeInterval = null;
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
                        const iframe = f as HTMLIFrameElement;
                        // Stash the real src so we can restore it on return
                        if (iframe.src && iframe.src !== 'about:blank') {
                            iframe.dataset.bmmPausedSrc = iframe.src;
                            try { iframe.src = 'about:blank'; } catch {}
                        }
                    });
                    // Also pause any <video> playing to free decoder resources
                    document.querySelectorAll('#view-docs video').forEach((v) => {
                        try { (v as HTMLVideoElement).pause(); } catch {}
                    });
                } else {
                    // Entering docs: restore stashed iframes; if the players
                    // were never set up (first navigation), trigger setup.
                    let anyRestored = false;
                    document.querySelectorAll('#view-docs iframe').forEach((f) => {
                        const iframe = f as HTMLIFrameElement;
                        if (iframe.dataset.bmmPausedSrc) {
                            try { iframe.src = iframe.dataset.bmmPausedSrc; } catch {}
                            delete iframe.dataset.bmmPausedSrc;
                            anyRestored = true;
                        }
                    });
                    if (!anyRestored) {
                        try { (window as any).__bmmSetupDocsVideos?.(); } catch {}
                    }
                }
            }, 15);
        });
    });

    // Auto-detect when app regained focus — debounced to prevent Tauri multi-fire
    let _focusDebounce: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('focus', () => {
        if (_focusDebounce) return; // Ignore rapid re-fires (Tauri emits focus multiple times at startup)
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
            let _shaRefreshDebounce: ReturnType<typeof setTimeout> | null = null;
            await listen('sha-status-changed', async (event: any) => {
                const payload = event.payload; // { mod_id, status, is_manual }
                console.log(`[BLAKE3] Hash status changed for mod ${payload.mod_id}: ${payload.status}`);

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
                            } else {
                                // Stronger spinner for manual calculation
                                shaIcon.innerHTML = '<span class="spinner" style="width:12px;height:12px;border:2px solid rgba(139, 92, 246, 0.3);border-top-color:#8b5cf6;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;"></span>';
                            }
                        }
                    }
                    // Find the detail button
                    const btn = document.getElementById('btn-recalculate-sha');
                    const detailContainer = document.getElementById('mod-detail-container');
                    if (btn && detailContainer && (detailContainer as any)._currentModId === payload.mod_id) {
                        btn.classList.add('loading');
                        if (isLazy) {
                            btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.1);border-top-color:rgba(255,255,255,0.5);border-radius:50%;animation:spin 1.5s linear infinite;display:inline-block;"></span>';
                        } else {
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
                    if (cidHint) cidHint.textContent = 'Hashing file content...';
                    if (cidBtn) cidBtn.style.opacity = '0.4';
                } else if (payload.status === 'done' || payload.status === 'error' || payload.status === 'missing') {
                    if (payload.is_manual && payload.status !== 'missing') {
                        stopTaskyLoader(); // Stop Tasky mascot animation
                    }

                    // Explicitly remove loading spinners to ensure they don't get stuck before list refresh
                    const modCard = document.querySelector(`.mod-card[data-id="${payload.mod_id}"]`);
                    if (modCard) {
                        const shaIcon = modCard.querySelector('.sha-status-icon') as HTMLElement;
                        if (shaIcon) {
                            shaIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
                            if (payload.status === 'done') {
                                shaIcon.style.color = 'var(--success)';
                                shaIcon.style.opacity = '0.9';
                                shaIcon.className = 'sha-status-icon verified';
                            } else {
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
                    if (cidBtnDone) cidBtnDone.style.opacity = '';

                    if (payload.status === 'error' && payload.is_manual) {
                        const { toast } = await import('../ui/app.js');
                        toast(t('toast.hashFailed', { id: payload.mod_id }) || ('Failed to hash mod ' + payload.mod_id), 'error');
                    } else if (payload.status === 'done' && payload.is_manual) {
                        const { toast } = await import('../ui/app.js');
                        toast(t('toast.hashDone') || 'Hash calculation completed', 'success');
                    }

                    // Refresh main mod list — debounce background SHA refreshes to avoid 100+ rapid re-renders
                    if (window._refreshModsFn) {
                        if (payload.is_manual) {
                            window._refreshModsFn();
                        } else {
                            if (_shaRefreshDebounce) clearTimeout(_shaRefreshDebounce);
                            _shaRefreshDebounce = setTimeout(() => {
                                (window as any)._refreshModsFn?.();
                                _shaRefreshDebounce = null;
                            }, 1500);
                        }
                    }

                    // Refresh detail panel if it's the same mod
                    const detailContainer = document.getElementById('mod-detail-container');
                    if (detailContainer && (detailContainer as any)._currentModId === payload.mod_id) {
                        import('../features/mods/mods-details.js').then(m => m.renderModDetail(payload.mod_id));
                    }
                }
            });
        } catch (e) { console.error("[BLAKE3] Failed to setup global hash listener", e); }
    })();

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
// Real reachability (probe), a guard (requireOnline) + safeFetch live in
// core/offline.ts. Online features call window.bmmRequireOnline(...) so they
// show a message instead of erroring when there's no connection.
function initOfflineDetection() {
    import('../core/offline.js').then(m => m.initOffline()).catch(() => {});
}

// ── Profile selector in Library ───────────────────────────
export async function updateLibraryProfileSelector() {
    const select = document.getElementById('lib-profile-select');
    if (!select) return;

    try {
        const profiles = await invoke('get_profiles') as any[];
        const activeId = await invoke('get_active_profile_id') as string | null;

        // Fetch custom icon paths in parallel.
        const iconPaths = await fetchProfileIconPaths(profiles);

        // Always include/reset to the placeholder as the first option
        select.innerHTML = `<option value="" data-i18n="lib.selectProfile">${t('lib.selectProfile') || '— Select a profile —'}</option>`;

        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.game_name ? ` — ${t(p.game_name) || p.game_name}` : '');
            if (p.id === activeId) opt.selected = true;
            select.appendChild(opt);
        });

        // The dropdown rows get the profile icon too, not just the closed trigger
        // below. This select was missed when the other three were done — the list is
        // where you compare profiles, so it is the place the icon earns most.
        decorateProfileOptions(select as HTMLSelectElement, profiles, iconPaths);

        // Update the dynamic profile icon in the wrapper (supports custom icon img).
        const wrapper = (select as HTMLElement).closest('.profile-select-icon-wrap');
        if (wrapper) {
            let iconEl = wrapper.querySelector('.profile-icon-display') as HTMLElement | null;
            if (!iconEl) {
                iconEl = document.createElement('span');
                iconEl.className = 'profile-icon-display';
                wrapper.insertBefore(iconEl, select);
            }
            updateSelectProfileIcon(select as HTMLSelectElement, profiles, iconPaths, iconEl);
        }

        // On change, refresh the icon next to the select.
        const wrp = (select as HTMLElement).closest('.profile-select-icon-wrap');
        const onChangeIconRefresh = () => {
            if (wrp) {
                const el = wrp.querySelector('.profile-icon-display') as HTMLElement | null;
                updateSelectProfileIcon(select as HTMLSelectElement, profiles, iconPaths, el);
            }
        };

        // Refresh icon when the user changes selection (no page reload needed).
        if (!(select as any)._iconChangeListener) {
            (select as any)._iconChangeListener = onChangeIconRefresh;
            select.addEventListener('change', onChangeIconRefresh);
        } else {
            // Already wired — just update to use the freshly fetched iconPaths.
            select.removeEventListener('change', (select as any)._iconChangeListener);
            (select as any)._iconChangeListener = onChangeIconRefresh;
            select.addEventListener('change', onChangeIconRefresh);
        }

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
                    const { toast } = await import('../ui/app.js');
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

// ── Reusable profile-select icon helpers ──────────────────────────────────────
// Enriches <option> elements and maintains a sibling icon/thumbnail that
// reflects the currently selected profile's custom icon (or builtin SVG).
// Works for any <select> that lists profiles.

/** Fetch the custom icon path for every profile that has one (parallel). */
export async function fetchProfileIconPaths(profiles: any[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
        profiles
            .filter(p => p.icon_image)
            .map(async p => {
                try {
                    const path = await invoke('get_profile_icon_path', { profileId: p.id }) as string | null;
                    return path ? [p.id, path] as [string, string] : null;
                } catch { return null; }
            })
    );
    return new Map(entries.filter(Boolean) as [string, string][]);
}

/** Update an icon element next to a <select> to show the selected profile's icon. */
/** The icon markup for ONE profile, as the custom select wants it.
 *
 *  The dropdown already supports a per-option icon — `data-icon` on the <option>,
 *  rendered by ui/custom-select.ts — and nothing was filling it for profiles. So the
 *  closed select showed the profile's icon and the open list showed bare names, which
 *  is the one moment you are actually comparing profiles and the icons would help
 *  most.
 *
 *  Extracted from updateSelectProfileIcon rather than copied, so the trigger and the
 *  list can never disagree about what a profile looks like. */
export function profileIconMarkup(
    profile: any,
    iconPaths: Map<string, string>,
    size = 14,
): string {
    const custom = profile?.id ? iconPaths.get(profile.id) : null;
    if (custom) {
        // Cache-busted: a re-uploaded icon keeps its path, so without this the browser
        // serves the old file forever.
        return `<img src="${convertFileSrc(custom)}?t=${Date.now()}" style="width:${size + 2}px;height:${size + 2}px;border-radius:3px;object-fit:cover;display:block" alt="">`;
    }
    return getProfileIconSvg(profile?.icon || 'user', `width:${size}px;height:${size}px`);
}

/** Stamp every <option> of a profile select with its icon, then let the custom
 *  select rebuild. Call it after the options have been filled. */
export function decorateProfileOptions(
    selectEl: HTMLSelectElement | null,
    profiles: any[],
    iconPaths: Map<string, string>,
): void {
    if (!selectEl) return;
    for (const opt of Array.from(selectEl.options)) {
        const prof = profiles.find(x => x.id === opt.value);
        // The placeholder row ("— pick one —") has no profile and must stay bare:
        // giving it a default user glyph would make it look like a real choice.
        if (prof) opt.dataset.icon = profileIconMarkup(prof, iconPaths);
        else delete opt.dataset.icon;
    }
}

export function updateSelectProfileIcon(
    selectEl: HTMLSelectElement | null,
    profiles: any[],
    iconPaths: Map<string, string>,
    iconEl: HTMLElement | null
): void {
    if (!selectEl || !iconEl) return;
    const id = selectEl.value;
    const p = profiles.find(x => x.id === id);
    const imgSrc = id && iconPaths.get(id) ? convertFileSrc(iconPaths.get(id)!) : null;
    const ts = Date.now();
    if (imgSrc) {
        iconEl.innerHTML = `<img src="${imgSrc}?t=${ts}" style="width:16px;height:16px;border-radius:3px;object-fit:cover;vertical-align:middle;display:block;" alt="">`;
    } else {
        iconEl.innerHTML = getProfileIconSvg(p?.icon || 'user', 'width:14px;height:14px;vertical-align:middle');
    }
}

// ── Link patcher ──────────────────────────────────────────
// Updates every [data-link-key] element in the HTML with the
// value from links.json, so no URL is hardcoded in static HTML.
function patchHtmlLinks(): void {
    const links = getLinks() as Record<string, string>;
    document.querySelectorAll<HTMLElement>('[data-link-key]').forEach(el => {
        const key = el.getAttribute('data-link-key');
        if (!key || !(key in links)) return;
        const url = links[key];
        // <a href="...">
        if (el instanceof HTMLAnchorElement) el.href = url;
        // <div data-url="..."> (quicklink cards)
        if (el.dataset.url !== undefined) el.dataset.url = url;
    });
}

// Open an external URL in the system browser. `window.open(url,'_blank')` is a
// no-op in the Tauri v2 webview, so route through the backend `open_external`
// command (this is why the credits stack links stopped working after v2).
export function openExternal(url: string): void {
    if (!url) return;
    invoke('open_external', { url }).catch((e) => {
        console.warn('[BMM] open_external failed:', e);
        try { window.open(url, '_blank'); } catch { /* ignore */ }
    });
}
(window as any).openExternal = openExternal;

// ── Boot ──────────────────────────────────────────────────
async function main() {
    console.log('[BMM] App starting from generated TypeScript!');

    // Load external link registry first so every module can call getLinks() safely
    await loadLinks();
    patchHtmlLinks();

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
    // Resolve the BetterCommunity test-mode/base from app.cfg (blog + account link).
    // MUST run AFTER loadTauri() — get_bc_config is a Tauri command, and calling it
    // before the bridge is ready threw "Tauri bridge not initialized".
    await loadBcConfig();
    try {
        await invoke('log_frontend_line', { line: '[BMM] App started from generated TypeScript!' });
    } catch (e) { }

    // First-run handoff from BetterInstaller: if the installer pre-configured BMM
    // (privacy/ToS, language, tutorial, telemetry), apply it BEFORE the first-run
    // modals below so they don't appear. Settings (language/onboarding/telemetry)
    // are applied Rust-side; the legal/lang modals are localStorage-gated, so we
    // satisfy those keys here. No-op when installed without BetterInstaller.
    try {
        const ho: any = await invoke('consume_installer_handoff');
        if (ho?.applied) {
            if (ho.legal_accepted) {
                localStorage.setItem('bmm_eula_accepted', 'true');
                localStorage.setItem('bmm_privacy_seen', 'true');
            }
            if (ho.language_set) localStorage.setItem('bmm_lang_selected', 'true');
            // Local session recorder is a JS-side setting (localStorage bmm_replay_enabled,
            // default on). The installer only needs to act when the user turned it OFF.
            if (ho.session_recorder === false) localStorage.setItem('bmm_replay_enabled', '0');
            // Theme chosen on the installer's swatch page. Also a JS-side setting, and it
            // must land BEFORE restoreThemeAtBoot() below reads bmm_active_theme — the
            // installer wrote this all along and nobody consumed it, so the pick never
            // survived the first launch.
            if (ho.active_theme) localStorage.setItem('bmm_active_theme', ho.active_theme);
            // Pre-import a bundled preset (themes / translations / catalogue / plugins)
            // through the same path as a manual backup import. Runs before i18n init
            // so freshly-imported languages are available immediately.
            if (ho.import_preset_path) {
                try {
                    await invoke('import_app_data', { srcPath: ho.import_preset_path });
                    console.log('[BMM] Imported installer preset:', ho.import_preset_path);
                } catch (e) { console.warn('[BMM] preset import failed:', e); }
            }
            console.log('[BMM] Applied installer handoff:', ho);
        }
    } catch (e) { /* no handoff / older backend — normal */ }

    // Block the WebView2 "Inspect" context menu + F12 / Ctrl+Shift+I,J,C in
    // PRODUCTION only. Runs AFTER loadTauri() so the bridge is ready (otherwise
    // is_dev_build threw "bridge not initialized" and defaulted to prod, killing
    // right-click in dev). Dev builds keep everything; inputs keep native menus;
    // the theme element picker still receives the event.
    try {
        const isDev = await invoke('is_dev_build').catch(() => true); // unknown → assume dev (don't block)
        if (!isDev) {
            document.addEventListener('contextmenu', (e) => {
                const el = e.target as HTMLElement;
                if (el && el.closest('input, textarea, [contenteditable="true"]')) return;
                e.preventDefault();
            }, { capture: true });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I','i','J','j','C','c'].includes(e.key))) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, { capture: true });
        }
    } catch { /* non-fatal */ }
    // Restore active theme ASAP (before first render to avoid flash)
    restoreThemeAtBoot().catch(() => {});

    await initI18n();

    initNavigation();
    initModals();
    initBenchmark();
    await initTitlebar();
    initModlist();
    initRepo();
    // After the UI is up, never before: this makes network calls, and a slow or unreachable
    // repo must not delay the window appearing.
    void import('../features/repo/auto-sync.js').then((m) => m.runAutoSyncCheck());
    initInteractiveDocs();   // diagram modal engine + Tasky tooltips (still used app-wide)
    initDocsHub();           // the rebuilt Help & documentation hub (owns #view-docs)
    initCommands();          // command registry + Ctrl+K palette + global shortcut dispatcher
    initDeepLinks();
    initApiActivity();
    initAnalytics().catch(() => {});
    // Local session recorder (user-controlled, separate from telemetry). Wire the
    // settings card now, but defer starting the (heavy) recorder until idle so it
    // doesn't fight the startup animation.
    import('../features/settings/replay-watcher.js').then((m) => {
        m.initWatcherUI();
        const begin = () => m.syncWatcher();
        const ric = (window as any).requestIdleCallback;
        if (ric) ric(begin, { timeout: 7000 }); else setTimeout(begin, 4500);
    }).catch(() => {});

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
    initNotificationCenter();
    initWebviewErrorTrap();
    // Second source for the same centre. Does nothing without a stored key, so it
    // costs an idle check for everyone who has not linked an account.
    void import('../core/bcweb-notifications.js').then(m => m.startBcwebNotifications()).catch(() => {});
    initUpdateNotes();
    initMapper();
    initPlugins();
    initAppsCatalog();
    initCommunity();
    initThemeEditor();
    initThemeCatalog();
    initCustomSelects();
    initTooltips();

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
    if (loaderImg) loaderImg.src = 'assets/Tasky_Happy.png';
    if (loaderText) loaderText.textContent = t('common.loaded');

    // Hide loader smoothly after a small delay to see the happy face
    const loader = document.getElementById('app-loader');
    if (loader) {
        setTimeout(() => {
            loader.style.opacity = '0';
            loader.style.visibility = 'hidden';
            setTimeout(() => {
                // Kill the loader timeline + all tweens on loader elements before
                // removing, so no scheduled step fires on missing targets.
                (window as any).__ldTimeline?.kill?.();
                const gsapInst = (window as any).gsap;
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
        const { getSettings, setApiPort, invoke: inv } = await import('../core/api.js');
        const cfg = await getSettings();
        // Sync apiBase() with the port the server ACTUALLY bound this session —
        // not settings.api_port, which may have been changed and needs a restart.
        try {
            const p = await inv('get_effective_api_port');
            if (p) { setApiPort(p as number); applyTranslations(); }   // re-sub port in docs examples
        } catch {}
        const soundEnabled = cfg.sound_effects_enabled !== false;
        const soundVol = (cfg.sound_volume ?? 70) / 100;
        setSoundEnabled(soundEnabled);
        setSoundVolume(soundVol);
        localStorage.setItem('bmm_sound_enabled', String(soundEnabled));
        localStorage.setItem('bmm_sound_volume', String(soundVol));
    } catch (_e) { /* use defaults */ }

    // ── Startup Modal Sequence ──
    // First run = onboarding hasn't been shown yet. We use this to AVOID piling
    // first-launch-irrelevant modals onto a brand-new user (e.g. "what's new" release
    // notes for a version they never had).
    const isFirstRun = await shouldShowOnboarding();

    // 0. Language selection on first start (before everything else)
    await checkLangSelect();
    await waitForModalClosed('modal-lang-select');

    // 1. Auto TOS (Terms of Service) on first start (if enabled in app.cfg)
    const tosShown = await checkAutoEula();
    await waitForModalClosed('modal-tos');

    // 1.5. Privacy Policy right after the TOS (first start only)
    if (tosShown) {
        await checkAutoPrivacy();
        await waitForModalClosed('modal-privacy');
    }

    // 2. Crash report UI wiring and check
    // The getting-started checklist measures real state now (see gs-checklist.ts).
    try { const { initSetupChecklist } = await import('./gs-checklist.js'); initSetupChecklist(); } catch { /* decorative if it fails */ }
    initCrashReportUI();
    await checkPreviousCrash();
    await waitForModalClosed('modal-crash-report');

    // 3. Auto Update System
    initAutoUpdate();

    // 4. Release notes — only for returning users. A fresh install has no previous
    // version, so "what's new" is just noise; mark it seen and skip it (the onboarding
    // + tutorial hub is the first-run welcome instead).
    if (isFirstRun) {
        try { localStorage.setItem('bmm_release_notes_shown', 'true'); } catch { /* ignore */ }
    } else {
        await checkShowReleaseNotes();
        await waitForModalClosed('modal-update-notes');
    }

    // 4.5 + 4.9 — De-spam the first launch. A brand-new user already wades through
    // language + TOS + privacy before even seeing the welcome; the FS-security-mode and
    // telemetry-consent prompts are NOT urgent, so we DON'T stack them on top on the very
    // first run. They surface on a later launch instead (and stay reachable in Settings),
    // and a fresh install keeps its safe defaults until then. Returning users see them
    // normally.
    if (!isFirstRun) {
        // 4.5. FS Security Mode Choice (Persistent)
        await checkSecurityMode();
        await waitForModalClosed('modal-security-choice');

        // 4.9. Telemetry consent.
        try {
            const { maybeShowConsentModal } = await import('../core/analytics.js');
            await maybeShowConsentModal();
        } catch (e) { console.warn('[BMM] consent modal failed', e); }
    }

    // 4.95. If BMM crashed (or was killed) in the middle of an interactive tutorial,
    // the example profile survived on disk — remove it now, before the user sees it.
    try {
        const { cleanupOrphanTutorialDemo } = await import('./tutorial-engine.js');
        await cleanupOrphanTutorialDemo();
    } catch (e) { console.warn('[BMM] orphan tutorial demo cleanup failed', e); }

    // 5. Show onboarding on first launch (it handles language too, so the standalone
    // picker above won't be repeated — see startOnboarding).
    if (isFirstRun) {
        // Delay slightly to allow UI to render
        setTimeout(() => {
            startOnboarding();
        }, 800);
    } else {
        // Not a first run → gently remind (once) that BMM has a Ko-fi.
        try {
            const { maybeShowKofiReminder } = await import('./kofi-modal.js');
            maybeShowKofiReminder();
        } catch (e) { console.error('kofi reminder failed', e); }
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

    // Make the Settings glass cards collapsible (declutter).
    try {
        const { initCollapsibleSettingsCards } = await import('./settings-fold.js');
        initCollapsibleSettingsCards();
    } catch (e) { console.warn('[BMM] settings-fold init failed', e); }

    // Interaction log
    initInteractionLogging();

    // Debug Menu
    initDebugMenu();

    // Run any user-defined auto-animations (Animation Studio). Guarded on a cheap string
    // check so the module is only loaded when the user actually created auto-run entries.
    try {
        if (localStorage.getItem('bmm_custom_anims')?.includes('"auto":true')) {
            import('../features/debug/anim-studio.js').then((m) => m.installAutoAnimations()).catch(() => {});
        }
    } catch { /* ignore */ }

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

    // The command palette can now return things, not just commands — a mod you own, a profile
    // you made. Picking one has to land you somewhere useful, and these listeners are what
    // makes that true.
    //
    // Deliberately driven through the EXISTING controls (the nav item's click, the mod search
    // box's input event) rather than by reaching into the views' internals: whatever those
    // already do about filters, re-rendering and scroll position keeps working, and there is
    // no second way to "focus a mod" to keep in step with the first.
    document.addEventListener('bmm:search:open-mod', (e: Event) => {
        const name = (e as CustomEvent).detail?.name;
        (document.querySelector('.nav-item[data-view="mods"]') as HTMLElement | null)?.click();
        if (!name) return;
        // After the view switch, so the input exists and the list re-renders with the filter.
        setTimeout(() => {
            const box = document.getElementById('mod-search') as HTMLInputElement | null;
            if (!box) return;
            box.value = name;
            box.dispatchEvent(new Event('input', { bubbles: true }));
            box.focus();
        }, 60);
    });
    document.addEventListener('bmm:search:open-profile', () => {
        (document.querySelector('.nav-item[data-view="profiles"]') as HTMLElement | null)?.click();
    });

    // Global helper for navigation
    window.showProfiles = () => {
        document.querySelector('.nav-item[data-view="profiles"]')?.click();
    };
    window.openNewProfileModal = openNewProfileModal;

    // Version button uses inline onclick
}

// ── Tasky mascot settings ────────────────────────────────
// Restore the tips flag before first paint of the settings card.
try {
    const tipsSaved = localStorage.getItem('bmm_tips_visible');
    if (tipsSaved === 'false') {
        document.body.classList.add('bmm-tips-hidden');
        const cb = document.getElementById('toggle-bmm-tips') as HTMLInputElement | null;
        if (cb) cb.checked = false;
    }
} catch { /* default: visible */ }

window.applyTaskySettings = function () {
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

    // In-app tips (the unified .bmm-tip callouts). A CLASS on <body>, so hiding is one
    // rule and a page can never half-obey. Warnings are exempt by design: danger/warning
    // callouts never carry .bmm-tip, so the toggle cannot silence anything load-bearing.
    const tipsToggle = document.getElementById('toggle-bmm-tips') as HTMLInputElement | null;
    const tipsOn = tipsToggle ? tipsToggle.checked : true;
    localStorage.setItem('bmm_tips_visible', String(tipsOn));
    document.body.classList.toggle('bmm-tips-hidden', !tipsOn);

    // Apply visibility - when hidden, show text logo in sidebar like fullscreen
    if (container) container.style.display = isVisible ? '' : 'none';

    // Toggle class on body for global styling adjustments: the sidebar text logo
    // AND the CSS rule that fully removes the corner-mascot div (#app-mascot-container)
    // when hidden. The help bubbles are NOT affected — they have their own toggle.
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
    let lastX = 0;
    let lastY = 0;

    window.updateTaskyPosition = (e: MouseEvent | { clientX: number, clientY: number, target?: any }) => {
        const bubble = document.querySelector('.tasky-speech-bubble') as HTMLElement;
        const container = document.getElementById('tasky-bubble-docs') as HTMLElement;
        if (!bubble || !container) return;

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
        if (container.style.display === 'none' && !bubble.classList.contains('active')) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const tw = container.offsetWidth || 350;
        const th = container.offsetHeight || 100;

        const target = (e && e.target) ? e.target : document.elementFromPoint(lastX, lastY);
        const isDropdown = target && !!(target as HTMLElement).closest('#global-dropdown-portal, .mod-actions-dropdown-content, .dropdown-menu, .dropdown-item, .btn-open-folder, .btn-open-active-folder, .btn-open-backup-folder, .btn-edit-mod, .btn-remove-mod, .btn-open-source-folder');

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
    // Reflect the hidden state as a body class on load too (was only set on toggle),
    // so the corner-mascot removal + sidebar logo apply from the first paint.
    if (!isVisible) document.body.classList.add('tasky-hidden');
    else document.body.classList.remove('tasky-hidden');

    // The titlebar version badge duplicates the corner Tasky's role; when the
    // corner Tasky is hidden, hide the lone badge too (cleaner titlebar).
    document.querySelectorAll('.titlebar-version').forEach(el => { (el as HTMLElement).style.display = isVisible ? '' : 'none'; });

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
let CONTRIBUTORS: any[] = [];
let CREDITS_MESSAGES: string[] = [
    'credits.msg1',
    'credits.msg2',
    'credits.msg3',
    'credits.msg4',
    'credits.msg5',
    'credits.msg6',
    'credits.msg7'
];
const CONTRIBUTORS_LOCAL_FALLBACK = 'assets/contributors.json';

async function fetchContributors() {
    const applyData = (data: any) => {
        if (data.contributors) CONTRIBUTORS = data.contributors;
        else if (Array.isArray(data)) CONTRIBUTORS = data; // Backward compatibility

        if (data.messages && Array.isArray(data.messages)) {
            CREDITS_MESSAGES = data.messages;
        }
    };

    try {
        // Route through the Rust backend (reqwest) — the webview blocks a direct cross-origin
        // fetch of bettercommunity.ch/api/assets/* on CORS. `quiet` keeps a 404 (endpoint not
        // deployed) out of the console; we just fall back to the bundled copy below.
        const remoteUrl = getLinks().contributors;
        if (/^https?:\/\//i.test(remoteUrl)) {
            const text = await invoke('fetch_remote_json', { url: remoteUrl }, { quiet: true }) as string;
            if (text) { applyData(JSON.parse(text)); return; }
        }
    } catch (e) {
        console.warn("[BMM] Remote contributors fetch failed, using local fallback:", e);
    }

    try {
        const response = await fetch(CONTRIBUTORS_LOCAL_FALLBACK);
        if (response.ok) {
            const data = await response.json();
            applyData(data);
            console.log("[BMM] Successfully loaded local fallback contributors.");
        }
    } catch (e) {
        console.error("[BMM] CRITICAL: Failed to load any contributors:", e);
    }
}

// Messages will be updated by fetchContributors()

/** (Re)start the rotating credits marquee. Idempotent — safe to call every time
 *  the credits view is opened. The nav handler clears the interval when leaving
 *  credits (to save work), so this MUST run again on re-entry or the marquee stays
 *  frozen/blank after the first navigation. */
export function startCreditsMarquee(): void {
    const marqueeContainer = document.getElementById('credits-marquee-container');
    if (!marqueeContainer) return;
    if ((marqueeContainer as any)._marqueeInterval) return; // already running
    let msgIndex = 0;
    const updateMarquee = () => {
        if (!CREDITS_MESSAGES.length) return; // guard: no messages → no % 0 = NaN
        const key = CREDITS_MESSAGES[msgIndex % CREDITS_MESSAGES.length];
        // Escape: messages can come from the remote contributors.json (data.messages),
        // and t() returns the raw string when the key isn't a translation — never trust
        // it in an innerHTML sink. The CSS animation handles entry/exit each time.
        marqueeContainer.innerHTML = `<div class="credits-marquee-content"><span class="marquee-msg">${escHtml(t(key) || key)}</span></div>`;
        msgIndex = (msgIndex + 1) % CREDITS_MESSAGES.length;
    };
    updateMarquee();
    (marqueeContainer as any)._marqueeInterval = setInterval(updateMarquee, 7000);
}

function initCredits() {
    const contributorsGrid = document.getElementById('contributors-grid');
    startCreditsMarquee();
    if (contributorsGrid) {
        const sections = [
            { id: 'staff', title: 'credits.sections.staff' },
            { id: 'kofi', title: 'credits.sections.kofi' },
            { id: 'testers', title: 'credits.sections.testers' }
        ];

        // Subcategory role mapping
        const subcategoryRoleMap: Record<string, string> = {
            'dev': 'credits.subcategory.dev',
            'community_support': 'credits.subcategory.communitySupport',
            'testing_team': 'credits.subcategory.testingTeam',
            'ptb': 'credits.subcategory.ptbTester',
            'early_access': 'credits.subcategory.earlyAccessTester'
        };

        contributorsGrid.style.display = 'block';
        contributorsGrid.innerHTML = sections.map(section => {
            const members = CONTRIBUTORS.filter(c => (c as any).category === section.id || (section.id === 'testers' && (c as any).category === 'tester'));
            if (members.length === 0) return '';

            return `
                <div class="credits-category-section" style="margin-bottom: 24px;">
                    <div class="credits-category-title" data-i18n="${section.title}" style="margin-bottom:12px; font-size:0.8rem; opacity:0.5; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:6px;">
                        ${t(section.title)}
                    </div>
                    <div class="sub-contributors-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px;">
                        ${members.map(c => {
                const sub = (c as any).subcategory;
                // Check if role is a translation key or a literal string
                const isKey = c.role && c.role.includes('.');
                const roleText = isKey ? t(c.role) : c.role;

                return `
                                <div class="contributor-card glass-card" onclick="openContributorModal('${c.id}')">
                                    <div class="contributor-pfp-box">
                                        <img src="${c.pfp}" class="contributor-pfp" alt="${(c as any).display_name || c.username}">
                                    </div>
                                    <div class="contributor-name">${(c as any).display_name || c.username}</div>
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
                const key = (el as HTMLElement).dataset.i18n;
                if (key)
                    el.textContent = t(key);
            });
            contributorsGrid.querySelectorAll('.credits-category-title').forEach(el => {
                const key = (el as HTMLElement).dataset.i18n;
                if (key)
                    el.textContent = t(key);
            });
        }
    });
}
(window as any).openStackModal = () => {
    const modal = document.getElementById('modal-stack');
    const content = document.getElementById('stack-modal-content');
    if (!modal || !content)
        return;
    // Links point to the canonical registry page (crates.io / npm) — these never
    // 404 for a published crate/package, unlike upstream GitHub repos that move.
    const crate = (c: string) => `https://crates.io/crates/${c}`;
    const npm = (p: string) => `https://www.npmjs.com/package/${p}`;
    const backend = [
        { name: "Tauri", v: "2", key: "tauri", url: crate("tauri") },
        { name: "Tauri Plugins", v: "2", key: "tauri-plugins", url: crate("tauri-plugin-fs") },
        { name: "rmcp (MCP)", v: "1.4", key: "rmcp", url: crate("rmcp") },
        { name: "Serde", v: "1.0", key: "serde", url: crate("serde") },
        { name: "Tokio", v: "1.0", key: "tokio", url: crate("tokio") },
        { name: "Reqwest", v: "0.12", key: "reqwest", url: crate("reqwest") },
        { name: "Walkdir", v: "2.0", key: "walkdir", url: crate("walkdir") },
        { name: "Zip", v: "0.6", key: "zip", url: crate("zip") },
        { name: "SHA2", v: "0.10", key: "sha2", url: crate("sha2") },
        { name: "BLAKE3", v: "1", key: "blake3", url: crate("blake3") },
        { name: "Discord RP", v: "0.2", key: "discord-rich-presence", url: crate("discord-rich-presence") },
        { name: "Warp", v: "0.3", key: "warp", url: crate("warp") },
        { name: "Rayon", v: "1.8", key: "rayon", url: crate("rayon") },
        { name: "Anyhow", v: "1.0", key: "anyhow", url: crate("anyhow") },
        { name: "Sysinfo", v: "0.30", key: "sysinfo", url: crate("sysinfo") },
        { name: "Tracing", v: "0.1", key: "tracing", url: crate("tracing") },
        { name: "Clap", v: "4.0", key: "clap", url: crate("clap") },
        { name: "Comfy Table", v: "7.0", key: "comfy-table", url: crate("comfy-table") },
        { name: "Chrono", v: "0.4", key: "chrono", url: crate("chrono") },
        { name: "Regex", v: "1.0", key: "regex", url: crate("regex") },
        { name: "UUID", v: "1.0", key: "uuid", url: crate("uuid") },
        { name: "Image", v: "0.25", key: "image", url: crate("image") },
        { name: "Rand", v: "0.8", key: "rand", url: crate("rand") },
        { name: "Tempfile", v: "3.0", key: "tempfile", url: crate("tempfile") },
        { name: "Base64", v: "0.21", key: "base64", url: crate("base64") },
        { name: "Winreg", v: "0.52", key: "winreg", url: crate("winreg") },
        { name: "Jwalk", v: "0.8", key: "jwalk", url: crate("jwalk") },
        { name: "Hex", v: "0.4", key: "hex", url: crate("hex") },
        { name: "Serde JSON", v: "1.0", key: "serde-json", url: crate("serde_json") },
        { name: "Thiserror", v: "1.0", key: "thiserror", url: crate("thiserror") },
        { name: "Futures", v: "0.3", key: "futures", url: crate("futures") },
        { name: "Flate2", v: "1.0", key: "flate2", url: crate("flate2") },
        { name: "Tar", v: "0.4", key: "tar", url: crate("tar") },
        { name: "Sevenz Rust", v: "0.6", key: "sevenz-rust", url: crate("sevenz-rust") },
        { name: "Unrar", v: "0.5", key: "unrar", url: crate("unrar") },
        { name: "Ed25519 Dalek", v: "2.0", key: "ed25519-dalek", url: crate("ed25519-dalek") },
        { name: "IGD", v: "0.12", key: "igd", url: crate("igd") },
        { name: "Local IP Address", v: "0.6", key: "local-ip-address", url: crate("local-ip-address") },
        { name: "Lazy Static", v: "1.4", key: "lazy-static", url: crate("lazy_static") },
        { name: "mimalloc", v: "0.1", key: "mimalloc", url: crate("mimalloc") },
        { name: "Open", v: "5", key: "open", url: crate("open") },
        { name: "fs_extra", v: "1", key: "fs-extra", url: crate("fs_extra") },
        { name: "Tracing Subscriber", v: "0.3", key: "tracing-subscriber", url: crate("tracing-subscriber") },
        { name: "Tokio Util", v: "0.7", key: "tokio-util", url: crate("tokio-util") },
        { name: "Bytes", v: "1", key: "bytes", url: crate("bytes") },
        { name: "Percent Encoding", v: "2.3", key: "percent-encoding", url: crate("percent-encoding") },
        { name: "Schemars", v: "0.8", key: "schemars", url: crate("schemars") },
        { name: "Colored", v: "2", key: "colored", url: crate("colored") },
        { name: "Backtrace", v: "0.3", key: "backtrace", url: crate("backtrace") },
        { name: "Windows", v: "0.52", key: "windows", url: crate("windows") }
    ];
    const frontend = [
        { name: "TypeScript", v: "5.7", key: "typescript", url: npm("typescript") },
        { name: "TanStack Query", v: "5.0", key: "tanstack-query", url: npm("@tanstack/query-core") },
        { name: "Cheerio", v: "1.2", key: "cheerio", url: npm("cheerio") },
        { name: "DOMPurify", v: "3.4", key: "dompurify", url: npm("dompurify") },
        { name: "rrweb", v: "2.0", key: "rrweb", url: npm("rrweb") },
        { name: "Puppeteer Core", v: "25", key: "puppeteer-core", url: npm("puppeteer-core") },
        { name: "Prisma Client", v: "5.22", key: "prisma", url: npm("@prisma/client") },
        { name: "Tauri API", v: "2", key: "tauri-api", url: npm("@tauri-apps/api") },
        { name: "Tauri CLI", v: "2", key: "tauri-cli", url: npm("@tauri-apps/cli") },
        { name: "Concurrently", v: "9.2", key: "concurrently", url: npm("concurrently") },
        { name: "Lucide", v: "0.5", key: "lucide", url: npm("lucide") },
        { name: "Simple Icons", v: "13", key: "simple-icons", url: npm("simple-icons") }
    ];

    // Where each piece actually earns its place. A dependency list answers "what do
    // we ship"; this answers "why", which is the only reason to read one. Entries are
    // optional on purpose — the point is to explain the load-bearing ones, not to pad
    // every row with a paraphrase of its own README.
    const STACK_ROLE: Record<string, { en: string; fr: string }> = {
        'jwalk':         { en: 'Walks your mod folders. Recursive scanning is the hottest path in BMM, so it runs in parallel.', fr: 'Parcourt tes dossiers de mods. Le scan récursif est le chemin le plus chaud de BMM, donc il tourne en parallèle.' },
        'rayon':         { en: 'Turns per-file work (hashing, copying, verifying) into multithreaded iteration without hand-rolling a pool.', fr: 'Transforme le travail par fichier (hash, copie, vérification) en itération multithread sans écrire de pool à la main.' },
        'blake3':        { en: 'Every integrity check and every delta-sync decision compares BLAKE3 fingerprints, never file contents.', fr: 'Chaque vérification d’intégrité et chaque décision de delta-sync compare des empreintes BLAKE3, jamais le contenu des fichiers.' },
        'ed25519-dalek': { en: 'Signs and verifies repo manifests, so a mod list can prove who produced it.', fr: 'Signe et vérifie les manifestes de dépôt, pour qu’une liste de mods puisse prouver qui l’a produite.' },
        'tokio':         { en: 'The async runtime behind downloads, the local API and the repo server.', fr: 'Le runtime asynchrone derrière les téléchargements, l’API locale et le serveur de dépôt.' },
        'mimalloc':      { en: 'Replaces the system allocator — measurably faster under the allocation storm a large library scan produces.', fr: 'Remplace l’allocateur système — mesurablement plus rapide sous la tempête d’allocations d’un gros scan.' },
        'rrweb':         { en: 'Records a session as replayable DOM events: the .bmmreplay files behind bug reports and the docs player.', fr: 'Enregistre une session en événements DOM rejouables : les fichiers .bmmreplay des rapports de bug et du lecteur de docs.' },
        'dompurify':     { en: 'Sanitises every piece of markdown BMM renders, because catalogs and repos are content written by other people.', fr: 'Assainit chaque markdown affiché par BMM, parce que catalogues et dépôts sont du contenu écrit par d’autres.' },
        'lucide':        { en: 'Build-time source of the 2000+ stroke icons in the shared picker. Generated to JSON — never a runtime dependency.', fr: 'Source à la compilation des 2000+ icônes du sélecteur partagé. Générée en JSON — jamais une dépendance d’exécution.' },
        'simple-icons':  { en: 'Build-time source of the 3400+ brand glyphs, sharded per first letter so one stored icon costs KB, not MB.', fr: 'Source à la compilation des 3400+ glyphes de marques, shardée par première lettre pour qu’une icône stockée coûte des Ko, pas des Mo.' },
        'clap':          { en: 'Parses the BMM CLI — the same surface the MCP server exposes to agents.', fr: 'Analyse le CLI de BMM — la même surface que le serveur MCP expose aux agents.' },
        'schemars':      { en: 'Generates the JSON Schemas the MCP tools advertise, so an agent knows what a tool accepts.', fr: 'Génère les schémas JSON annoncés par les outils MCP, pour qu’un agent sache ce qu’un outil accepte.' },
        'tauri-api':     { en: 'The bridge the whole UI talks through: every action crosses it to reach the Rust core.', fr: 'Le pont par lequel toute l’UI passe : chaque action le traverse pour atteindre le cœur Rust.' },
    };
    (window as any).__bmmStackRole = STACK_ROLE;
    content.innerHTML = `
        <div class="stack-section-title" data-i18n="credits.stackBackend">${t('credits.stackBackend')}</div>
        <div class="stack-grid">
            ${backend.map(item => `
                <div class="stack-item" style="cursor:pointer" data-stack-key="${item.key}" data-stack-name="${escAttr(item.name)}" data-stack-v="${escAttr(item.v)}" data-stack-url="${escAttr(item.url)}">
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
                <div class="stack-item" style="cursor:pointer" data-stack-key="${item.key}" data-stack-name="${escAttr(item.name)}" data-stack-v="${escAttr(item.v)}" data-stack-url="${escAttr(item.url)}">
                    <div class="stack-item-header">
                        <span class="stack-item-name">${item.name}</span>
                        <span class="stack-item-version">${item.v}</span>
                    </div>
                    <div class="stack-item-desc" data-i18n="credits.stackPkg.${item.key}">${t(`credits.stackPkg.${item.key}`)}</div>
                </div>
            `).join('')}
        </div>
        <div class="stack-docs-link">
            <span data-i18n="credits.stackDocsBlurb">${t('credits.stackDocsBlurb')}</span>
            <button type="button" onclick="window.openExternal('https://freeproject089.github.io/BMM-Docs/how-it-works/architecture/')">
                <span data-i18n="credits.stackDocsCta">${t('credits.stackDocsCta')}</span> ↗
            </button>
        </div>
    `;

    // A card used to launch the browser on click, which is an abrupt way to answer
    // "what is this?". It opens an explainer first — what the library does, what BMM
    // uses it FOR — and the way out to its page is an explicit button.
    content.onclick = (e) => {
        const card = (e.target as HTMLElement).closest('.stack-item') as HTMLElement | null;
        if (!card?.dataset.stackKey) return;
        openStackDetail(card.dataset.stackKey, card.dataset.stackName || '',
                        card.dataset.stackV || '', card.dataset.stackUrl || '');
    };
    modal.classList.add('open');
};

/** The dependency explainer: what it is, why it is here, then the way out. */
function openStackDetail(key: string, name: string, version: string, url: string): void {
    document.getElementById('bmm-stack-detail')?.remove();
    const role = (window as any).__bmmStackRole?.[key];
    const lang = getLang() === 'fr' ? 'fr' : 'en';
    // The card's own description lives under one of two key prefixes (crates vs npm).
    const desc = t(`credits.stackCrate.${key}`) !== `credits.stackCrate.${key}`
        ? t(`credits.stackCrate.${key}`)
        : t(`credits.stackPkg.${key}`);
    const overlay = document.createElement('div');
    overlay.id = 'bmm-stack-detail';
    overlay.className = 'modal-generic-overlay open';
    overlay.innerHTML = `
        <div class="modal stackd-modal">
            <div class="stackd-head">
                <div class="stackd-id">
                    <span class="stackd-name">${escHtml(name)}</span>
                    <span class="stackd-v">v${escHtml(version)}</span>
                </div>
                <button class="stackd-close" id="stackd-close" data-tooltip="${escAttr(t('common.close') || 'Close')}">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="stackd-block">
                <div class="stackd-label">${escHtml(t('credits.stackWhatIs') || 'What it is')}</div>
                <p class="stackd-text">${escHtml(desc)}</p>
            </div>
            ${role ? `<div class="stackd-block stackd-role">
                <div class="stackd-label">${escHtml(t('credits.stackWhyHere') || 'Why BMM uses it')}</div>
                <p class="stackd-text">${escHtml(role[lang])}</p>
            </div>` : ''}
            <div class="stackd-foot">
                <button class="btn btn-secondary btn-sm" id="stackd-open">${escHtml(t('credits.stackOpenPage') || 'Open its page')} ↗</button>
            </div>
        </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#stackd-close')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(); });
    overlay.querySelector('#stackd-open')?.addEventListener('click', () => {
        (window as any).openExternal?.(url);
        close();
    });
}

(window as any).openContributorModal = (id: string) => {
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
                <h2>${(c as any).display_name || c.username}</h2>
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
                <a href="${c.github}" onclick="event.preventDefault();window.openExternal('${c.github}')" class="contributor-link-btn" style="cursor:pointer">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                    GitHub
                </a>
            ` : ''}
            ${c.website ? `
                <a href="${c.website}" onclick="event.preventDefault();window.openExternal('${c.website}')" class="contributor-link-btn" style="cursor:pointer">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    Website
                </a>
            ` : ''}
        </div>
    `;
    modal.classList.add('open');
};

main().catch(console.error);
