// @ts-nocheck
import { appState } from '../../core/state.js';
import { actAttrs } from '../../core/inline-actions.js';
import { renderTagChip } from '../../ui/icon-pack.js';
import { mountOrderSection } from './lib-order.js';
import { invoke } from '../../core/api.js';
import { toast, openExternal } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { detailOverlay, detailDialogHtml, detailHeaderHtml, detailActionsHtml, overviewHtml, filesHtml, linkRowHtml, DETAIL_TABS } from './mod-detail-view.js';
import { bindModal, ensureModalShellCss, topOverlay } from '../../ui/modal-shell.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { sourceAccessHtml, wireSourceAccess } from '../../core/source-access.js';
import { renderModList, updateCardState, revealMod, visibleMods } from './mods-list.js';
import { setupDependencyInput } from './mods-actions.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { uiIcon } from '../../ui/icons.js';
import { modReportHtml, reportIsValid, showIntegrityModal } from './integrity-report.js';
import { openKeyManager } from '../../core/settings-link.js';
const S = new Proxy(appState.state, {
    get(target, prop) { return target[prop]; },
    set(target, prop, value) { appState.set(prop, value); return true; }
});
let archiveCtxInit = false;
function initArchiveContextMenu() {
    if (archiveCtxInit)
        return;
    const ctxMenu = document.getElementById('archive-context-menu');
    if (!ctxMenu)
        return;
    archiveCtxInit = true;
    const hideCtx = () => { ctxMenu.style.display = 'none'; };
    document.addEventListener('click', hideCtx);
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('#archive-context-menu') && !e.target.closest('.tree-node'))
            hideCtx();
    });
    const modalOverlay = document.getElementById('modal-archive-explorer');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay)
                hideCtx();
        });
    }
    document.querySelectorAll('[data-close="modal-archive-explorer"]').forEach(btn => {
        btn.addEventListener('click', hideCtx);
    });
    const ctxOpenFile = document.getElementById('ctx-open-file');
    const ctxOpenFolder = document.getElementById('ctx-open-folder');
    const ctxCopyPath = document.getElementById('ctx-copy-path');
    if (ctxOpenFile) {
        ctxOpenFile.addEventListener('click', async () => {
            if (!window._currentArchiveNode)
                return;
            const relPath = window._currentArchiveNode.dataset.full;
            const tType = window._currentArchiveNode.dataset.type;
            const modId = window._currentExplorerModId;
            if (!relPath || !modId)
                return;
            try {
                const mod = S.allMods.find(m => m.id === modId);
                if (!mod)
                    return;
                const modFolderPath = mod.mod_folder_path;
                const fullPath = modFolderPath.replace(/\\/g, '/') + '/' + relPath.replace(/\\/g, '/');
                if (tType === 'folder')
                    invoke('open_folder', { path: fullPath }).catch((e) => toast(String(e), 'error'));
                else
                    invoke('open_file', { path: fullPath }).catch((e) => toast(String(e), 'error'));
            }
            catch (e) {
                toast(String(e), 'error');
            }
            hideCtx();
        });
    }
    if (ctxOpenFolder) {
        ctxOpenFolder.addEventListener('click', async () => {
            const modId = window._currentExplorerModId;
            if (!modId)
                return;
            try {
                const mod = S.allMods.find(m => m.id === modId);
                if (!mod)
                    return;
                // Use the appropriate command based on mod status
                if (mod.enabled) {
                    await invoke('open_mod_active_folder', { modId });
                }
                else {
                    await invoke('open_mod_backup_folder', { modId });
                }
            }
            catch (e) {
                toast(String(e), 'error');
            }
            hideCtx();
        });
    }
    if (ctxCopyPath) {
        ctxCopyPath.addEventListener('click', async () => {
            if (!window._currentArchiveNode)
                return;
            const relPath = window._currentArchiveNode.dataset.full;
            const modId = window._currentExplorerModId;
            if (!relPath || !modId)
                return;
            try {
                const mod = S.allMods.find(m => m.id === modId);
                if (!mod)
                    return;
                const modFolderPath = mod.mod_folder_path;
                const fullPath = modFolderPath.replace(/\\/g, '/') + '/' + relPath.replace(/\\/g, '/');
                navigator.clipboard.writeText(fullPath).then(() => toast(t('common.copied') || 'Copié !', 'success'));
            }
            catch (e) {
                toast(String(e), 'error');
            }
            hideCtx();
        });
    }
}
/**
 * Where a mod came from, in one phrase.
 *
 * DERIVED, never stored. It reads the same fields the updater reads, so it cannot claim a
 * provenance the updater disagrees with — a stored label would drift the first time a mod
 * was re-synced from somewhere else, and it would drift silently.
 *
 * The order is the order that answers the question: a server repo is the strongest claim, a
 * per-mod update address next, then a hand-typed link, and "added here" is what is left when
 * nothing else is known. `unverified` is worth its own phrase because a repo that shipped no
 * hashes is a different situation from one that did, and it is not visible anywhere else.
 */
function describeOrigin(mod) {
    const host = (u) => { try {
        return new URL(u).host;
    }
    catch {
        return String(u).slice(0, 48);
    } };
    if (mod.source_repo) {
        return (mod.unverified ? t('detail.originRepoUnverified') : t('detail.originRepo'))
            .replace('{h}', host(mod.source_repo));
    }
    if (mod.update_url)
        return t('detail.originUpdate').replace('{h}', host(mod.update_url));
    if ((mod.update_sources || []).length) {
        return t('detail.originSources').replace('{n}', String(mod.update_sources.length));
    }
    if ((mod.download_links || []).length) {
        return t('detail.originLink').replace('{h}', host(mod.download_links[0].url || ''));
    }
    return t('detail.originLocal');
}
// ── The dialog ──────────────────────────────────────────────────────────────────
// A mod opens in the house dialog, centred over the library (markup: mod-detail-view.ts). The
// library under it never moves or re-flows: the side drawer it replaces was a third column of
// the app shell and squeezed the toolbar and every card the moment a mod was opened. The list
// keeps its selection; ‹ › and ↑ / ↓ move to the previous / next mod of the list as it is
// filtered and sorted (the dialog stays open and redraws); Esc, × and a click on the dim close
// it. Every field is one form with one Save / Cancel bar, and leaving with unsaved changes asks
// first.
let _tab = (() => {
    try {
        const v = localStorage.getItem('bmm_mdd_tab');
        return DETAIL_TABS.includes(v) ? v : 'overview';
    }
    catch {
        return 'overview';
    }
})();
let _dirty = false;
let _wired = false;
let _softQueued = false;
let _release = null;
/** The overlay (#mod-detail-panel: app.ts reads it to know a mod is open). */
function overlayEl() { return document.getElementById('mod-detail-panel'); }
/** The dialog card inside it: every query of this module is scoped to it. */
function drawerEl() { return overlayEl()?.querySelector('.mod-detail') || null; }
/** The mods around `id` in the list as shown (filters and sort applied). */
function neighbours(id) {
    const list = visibleMods();
    const i = list.findIndex((m) => m.id === id);
    return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}
function ctxFor(mod) {
    const n = neighbours(mod.id);
    // A mod synced from a server repo already HAS a source; it was never among its hand-typed
    // links. Passed apart and drawn OUTSIDE #detail-links-list: the save handler rebuilds
    // download_links from those rows, so a derived link among them would be saved as typed.
    return {
        links: mod.download_links || [],
        repoLink: mod.source_repo || mod.update_url || null,
        origin: describeOrigin(mod),
        hasPrev: !!n.prev,
        hasNext: !!n.next,
    };
}
/** Leaving the mod (another one, close, Esc) with unsaved edits asks first. */
async function canLeave() {
    if (!_dirty || !drawerEl())
        return true;
    const ok = await window.confirmCustom?.(t('mdd.discardTitle'), escHtml(t('mdd.discardMsg')), 'warning', { yesLabel: t('mdd.discard') });
    if (ok)
        _dirty = false;
    return !!ok;
}
function markCard(id, on) {
    if (!id)
        return;
    document.querySelector(`.mod-card[data-id="${CSS.escape(id)}"]`)?.classList.toggle('selected', on);
}
/** Open the dialog on `modId` (or move the open one to it). */
export async function selectMod(modId) {
    await openModDetail(modId);
}
async function openModDetail(modId, revealCard = false) {
    if (S.selectedModId !== modId && !(await canLeave()))
        return;
    markCard(S.selectedModId, false);
    S.selectedModId = modId;
    markCard(modId, true);
    // Moving with ‹ ›: the list behind follows (scrolled, never re-flowed), so the card is there
    // to take the focus back when the dialog closes.
    if (revealCard)
        revealMod(modId);
    renderModDetail(modId);
    dispatchBmmAction(BMM_ACTIONS.MOD_DETAIL_OPENED, { modId });
}
async function requestClose() {
    if (await canLeave())
        closeModDetail();
}
export function closeModDetail() {
    const id = S.selectedModId;
    markCard(id, false);
    S.selectedModId = null;
    _dirty = false;
    const rel = _release;
    _release = null;
    rel?.();
    overlayEl()?.remove();
    // Back to the card of the mod last shown (‹ › may have moved it), so the keyboard carries on
    // in the list.
    if (id)
        document.querySelector(`.mod-card[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
async function stepMod(dir) {
    const id = S.selectedModId;
    if (!id)
        return;
    const n = neighbours(id);
    const target = dir < 0 ? n.prev : n.next;
    if (target)
        await openModDetail(target.id, true);
}
function showTab(panel, tab, focus = false) {
    _tab = tab;
    try {
        localStorage.setItem('bmm_mdd_tab', tab);
    }
    catch { /* private mode */ }
    panel.querySelectorAll('.mdd-tab').forEach((b) => {
        const on = b.dataset.tab === tab;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && focus)
            b.focus();
    });
    panel.querySelectorAll('.mdd-pane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === tab));
    const body = panel.querySelector('#mod-detail-container');
    if (body)
        body.scrollTop = 0;
    syncFoot(panel);
}
/** The Save / Cancel bar: always there (a dialog keeps its height), live when something is unsaved. */
function syncFoot(panel) {
    const foot = panel.querySelector('#mdd-foot');
    if (!foot)
        return;
    foot.classList.toggle('is-dirty', _dirty);
    panel.querySelector('#btn-save-detail').disabled = !_dirty;
    panel.querySelector('#btn-cancel-detail').disabled = !_dirty;
    const st = panel.querySelector('#mdd-foot-status');
    if (st)
        st.textContent = t(_dirty ? 'mdd.unsaved' : 'mdd.noChanges');
}
function setDirty(panel) {
    if (_dirty)
        return;
    _dirty = true;
    syncFoot(panel);
}
/** The read-only parts after the mod changed elsewhere (toggled, re-hashed, updated). */
function softRefresh() {
    const panel = drawerEl();
    const mod = panel ? S.allMods.find((m) => m.id === S.selectedModId) : null;
    if (!panel || !mod)
        return;
    const ctx = ctxFor(mod);
    const head = panel.querySelector('#mdd-head');
    if (head)
        head.innerHTML = detailHeaderHtml(mod, ctx);
    const acts = panel.querySelector('#mdd-actions');
    if (acts)
        acts.innerHTML = detailActionsHtml(mod);
    wireHeader(panel, mod);
    if (!_dirty) {
        const ov = panel.querySelector('#mdd-pane-overview');
        if (ov) {
            ov.innerHTML = overviewHtml(mod, ctx);
            paintOverview(panel, mod);
        }
        const files = panel.querySelector('#mdd-pane-files');
        if (files) {
            files.innerHTML = filesHtml(mod);
            wireFiles(panel, mod);
        }
    }
}
function queueSoftRefresh() {
    if (_softQueued)
        return;
    _softQueued = true;
    requestAnimationFrame(() => { _softQueued = false; softRefresh(); });
}
function wireOnce() {
    if (_wired)
        return;
    _wired = true;
    // The list changed (a toggle, a scan, a sync): the dialog follows, without losing edits.
    appState.subscribe('allMods', () => { if (drawerEl())
        queueSoftRefresh(); });
    // Leaving the library (a shortcut, a deep link) closes it: it is the library's dialog.
    const lib = document.getElementById('view-library');
    if (lib)
        new MutationObserver(() => {
            if (!lib.classList.contains('active') && drawerEl()) {
                _dirty = false;
                closeModDetail();
            }
        }).observe(lib, { attributes: true, attributeFilter: ['class'] });
}
/** The overlay and its card, built once per opening; ‹ › redraw the card in place. Escape, the
 *  Tab trap and the focus return come from the house shell (bindModal). */
function ensureDialog() {
    const existing = drawerEl();
    if (existing)
        return existing;
    const host = document.getElementById('app-window-outer') || document.body;
    if (!host)
        return null;
    ensureModalShellCss();
    const { overlay, card } = detailOverlay();
    host.appendChild(overlay);
    raiseAboveAll(overlay);
    // A click on the dim closes it — both ends of the click on the dim, so a text selection that
    // ends outside the card does not throw the form away.
    let downOnDim = false;
    overlay.addEventListener('mousedown', (e) => { downOnDim = e.target === overlay; });
    overlay.addEventListener('click', (e) => { if (downOnDim && e.target === overlay)
        void requestClose(); downOnDim = false; });
    // The dialog's own keys, before the shell's Escape (which listens on the document).
    overlay.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || topOverlay() !== overlay)
            return;
        const target = e.target;
        if (e.key === 'Escape') {
            // The tag menu or the dependency suggestions close first.
            const menu = card.querySelector('#detail-tag-menu');
            if (menu && menu.style.display !== 'none') {
                e.preventDefault();
                menu.style.display = 'none';
                return;
            }
            const sug = card.querySelector('#detail-dep-suggestions');
            if (sug && sug.style.display !== 'none') {
                e.preventDefault();
                sug.style.display = 'none';
                return;
            }
            return; // bindModal → requestClose (asks first when something is unsaved)
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')
            return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
            return;
        if (target.closest?.('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], .mdd-tabs, .bmm-tag-menu'))
            return;
        e.preventDefault();
        void stepMod(e.key === 'ArrowDown' ? 1 : -1);
    });
    _release = bindModal(overlay, { onClose: () => { void requestClose(); } });
    return card;
}
function wireHeader(panel, mod) {
    panel.querySelector('#btn-close-detail-inner')?.addEventListener('click', () => { void requestClose(); });
    panel.querySelector('#btn-detail-prev')?.addEventListener('click', () => { void stepMod(-1); });
    panel.querySelector('#btn-detail-next')?.addEventListener('click', () => { void stepMod(1); });
    // Enable / disable through the card's own switch: the same path as a click on it (conflict
    // warning, dependencies, the activity overlay), never a second way to change a mod.
    panel.querySelector('#btn-detail-toggle')?.addEventListener('click', () => {
        const card = revealMod(mod.id) || document.querySelector(`.mod-card[data-id="${CSS.escape(mod.id)}"]`);
        const input = card?.querySelector('.mod-toggle-input');
        if (!input || input.disabled || S.processingMods?.has?.(mod.id))
            return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
    });
    panel.querySelector('#btn-detail-folder')?.addEventListener('click', () => {
        invoke(mod.enabled ? 'open_mod_active_folder' : 'open_mod_backup_folder', { modId: mod.id })
            .catch((e) => toast(String(e), 'error'));
    });
}
/** Overview: the description through B.MD's untrusted path (it comes from a repo or an
 *  archive), the tags and the required mods as chips. */
function paintOverview(panel, mod) {
    const host = panel.querySelector('#mdd-desc-view');
    if (host) {
        const desc = String(mod.description || '').trim();
        if (!desc) {
            host.innerHTML = `<p class="mdd-muted">${escHtml(t('mdd.noDesc'))} <button type="button" class="mdd-link" data-goto="details">${escHtml(t('mdd.addDesc'))}</button></p>`;
        }
        else {
            host.textContent = desc;
            void Promise.all([import('../../docs/md-lite.js'), import('../../docs/md-hydrate.js')]).then(([lite, hyd]) => {
                if (!host.isConnected)
                    return;
                host.innerHTML = lite.renderDocMarkdown(desc);
                hyd.hydrateMdLite(host);
            }).catch(() => { });
        }
    }
    const tags = panel.querySelector('#mdd-tags-view');
    if (tags) {
        const chips = (mod.tags || []).map((id) => (S.userTags || []).find((x) => x.id === id)).filter(Boolean)
            .map((d) => renderTagChip(d, { fontSize: 11, pad: '2px 8px' })).join('');
        tags.innerHTML = chips || `<span class="mdd-muted">${escHtml(t('mdd.none'))}</span>`;
    }
    const deps = panel.querySelector('#mdd-deps-view');
    if (deps) {
        const names = (mod.dependencies || []).map((id) => (S.allMods || []).find((m) => m.id === id)?.name || id);
        deps.innerHTML = names.length ? names.map((n) => `<span class="mdd-chip">${escHtml(n)}</span>`).join('')
            : `<span class="mdd-muted">${escHtml(t('mdd.none'))}</span>`;
    }
}
function wireFiles(panel, mod) {
    panel.querySelector('#btn-browse-archive')?.addEventListener('click', () => openArchiveExplorer(mod));
    panel.querySelector('.btn-copy-content-id')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const contentId = e.currentTarget.dataset.contentId || '';
        if (!contentId)
            return;
        try {
            await navigator.clipboard.writeText(contentId);
            toast(t('common.contentIdCopied', { id: contentId.slice(0, 16) }), 'success', 2000);
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
    panel.querySelector('#btn-verify-mod-integrity')?.addEventListener('click', async () => {
        try {
            // No hashes yet: start the calculation first (get_mod_integrity reports every file as
            // "added" while there is none).
            if (!mod.file_hashes || Object.keys(mod.file_hashes).length === 0) {
                toast(t('mods.sha.calculating'), 'info');
                await invoke('recalculate_mod_sha', { modId: mod.id });
            }
            toast(t('integrity.checking'), 'info');
            const report = await invoke('get_mod_integrity', { modId: mod.id });
            showIntegrityReport(mod, report);
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
}
/** Draw the dialog for `modId` (or redraw it: ‹ ›, after a save, a re-hash, a language change). */
export async function renderModDetail(modId) {
    const mod = S.allMods.find(m => m.id === modId);
    if (!mod)
        return closeModDetail();
    wireOnce();
    // Redrawing the mod being edited would throw the edits away: the read-only parts only.
    const existing = drawerEl();
    if (existing && existing.dataset.modId === modId && _dirty) {
        softRefresh();
        return;
    }
    _dirty = false;
    // Where the focus was in the card (‹ › keep it on the arrow that was pressed).
    const focusedId = existing && existing.contains(document.activeElement) ? document.activeElement.id : '';
    const panel = ensureDialog();
    if (!panel)
        return;
    panel.dataset.modId = modId;
    const ctx = ctxFor(mod);
    panel.innerHTML = detailDialogHtml(mod, ctx, _tab);
    // The SHA listener (app.ts) and the hash deletion (settings.ts) refresh the open mod by this.
    const body = panel.querySelector('#mod-detail-container');
    if (body)
        body._currentModId = mod.id;
    const refocus = focusedId ? panel.querySelector(`#${CSS.escape(focusedId)}`) : null;
    if (refocus && !refocus.disabled)
        refocus.focus({ preventScroll: true });
    else if (!panel.contains(document.activeElement))
        panel.focus({ preventScroll: true });
    wireHeader(panel, mod);
    paintOverview(panel, mod);
    wireFiles(panel, mod);
    syncFoot(panel);
    // Tabs: click, and the tablist keys.
    panel.querySelectorAll('.mdd-tab').forEach((b) => b.addEventListener('click', () => showTab(panel, b.dataset.tab)));
    panel.querySelector('.mdd-tabs')?.addEventListener('keydown', (e) => {
        const order = DETAIL_TABS;
        const i = order.indexOf(_tab);
        const go = e.key === 'ArrowRight' ? order[(i + 1) % order.length] : e.key === 'ArrowLeft' ? order[(i - 1 + order.length) % order.length]
            : e.key === 'Home' ? order[0] : e.key === 'End' ? order[order.length - 1] : null;
        if (!go)
            return;
        e.preventDefault();
        showTab(panel, go, true);
    });
    // On the card itself, which outlives its redraws: wired once per card.
    if (!panel.dataset.gotoWired) {
        panel.dataset.gotoWired = '1';
        panel.addEventListener('click', (e) => {
            const go = e.target.closest('[data-goto]');
            if (go)
                showTab(panel, go.dataset.goto, true);
        });
    }
    // Where this mod sits in the profile's activation order, and the moves (lib-order.ts).
    mountOrderSection(panel, mod);
    // The protected-source block: mounted HERE, beside its listeners, because markup with no
    // listeners looks exactly like markup nobody has clicked yet.
    const accessSlot = panel.querySelector('#detail-links-access');
    if (accessSlot)
        accessSlot.innerHTML = sourceAccessHtml('mdl');
    // Wired AFTER the panel is in the document: wireSourceAccess finds its controls with
    // getElementById, and on a detached subtree it bails out and leaves a dead fold.
    wireSourceAccess('mdl', (m, k) => toast(t(m), k === 'warning' ? 'warning' : 'success'), () => {
        openKeyManager();
    }, () => panel.querySelector('.detail-link-url')?.value?.trim() || '');
    // The derived repo link opens in the system browser (window.open is a no-op in the webview).
    panel.querySelector('[data-open-url]')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        openExternal(ev.currentTarget.dataset.openUrl || '');
    });
    // Conflicts, in the background: the tab's count, and one button per conflict that opens the
    // conflict view for this mod.
    (async () => {
        try {
            const conflicts = await invoke('get_mod_conflicts', { modId: mod.id });
            if (!panel.isConnected || panel.dataset.modId !== mod.id || !conflicts?.length)
                return;
            const badge = panel.querySelector('.conflict-badge-container');
            if (badge) {
                badge.textContent = String(conflicts.length);
                badge.setAttribute('title', t('mod.conflictsFound', { n: String(conflicts.length) }));
            }
            const listContainer = panel.querySelector('#detail-conflicts-list');
            if (listContainer) {
                listContainer.innerHTML = conflicts.map(c => `
          <button type="button" class="mdc-card ${c.status === 'Active' ? 'is-active' : 'is-potential'}"
                  ${actAttrs(c.category === 'Intra' && c.status === 'Active' ? 'openConflictsFor' : 'openGlobalConflictModal', mod.id)}
                  data-tooltip="${escAttr(t('conflict.openFor'))}">
            <span class="mdc-top">
              <span class="tag-conflict tag-${String(c.category).toLowerCase()}-conflict ${String(c.status).toLowerCase()}">
                 ${c.category === 'Intra' ? uiIcon('home', 12) : uiIcon('globe', 12)}
                 ${escHtml(c.category)}
              </span>
              <span class="mdc-files">${escHtml(t('mdd.filesShort', { n: String(c.file_count) }))}</span>
              ${uiIcon('chevron-right', 12, { cls: 'mdc-chev' })}
            </span>
            <span class="mdc-name">${escHtml(c.other_mod_name)}</span>
            <span class="mdc-profile">${escHtml(t('mod.profilLabel'))}${escHtml(c.other_profile_name)}</span>
          </button>
        `).join('');
            }
        }
        catch (e) { /* the tab keeps « No conflicts detected » */ }
    })();
    const depInput = panel.querySelector('#detail-dep-input');
    if (depInput) {
        depInput._currentModId = mod.id;
        // The dependency widget keeps its own list; a pick or a removal there is an edit. Watched
        // once it has drawn the saved list (it loads the other profiles first).
        void setupDependencyInput('detail-dep-input', 'detail-deps-list', 'detail-dep-suggestions', mod.dependencies || []).then(() => {
            const list = panel.querySelector('#detail-deps-list');
            if (list && panel.isConnected)
                new MutationObserver(() => setDirty(panel)).observe(list, { childList: true });
        });
    }
    const setupCounter = (inputId, counterId, max) => {
        const input = panel.querySelector('#' + inputId);
        const counter = panel.querySelector('#' + counterId);
        if (input && counter) {
            const update = () => { counter.textContent = `${input.value.length}/${max}`; };
            input.addEventListener('input', update);
            update();
        }
    };
    const descTextarea = panel.querySelector('#detail-desc');
    if (descTextarea) {
        descTextarea.value = mod.description || '';
        const autoResize = () => { descTextarea.style.height = 'auto'; descTextarea.style.height = Math.min(descTextarea.scrollHeight + 2, 360) + 'px'; };
        descTextarea.addEventListener('input', autoResize);
        setTimeout(autoResize, 0);
    }
    setupCounter('detail-name', 'counter-name', 100);
    setupCounter('detail-author', 'counter-author', 50);
    setupCounter('detail-desc', 'counter-desc', 2000);
    // Any typed change, in Details or in the links, shows the Save / Cancel bar.
    panel.querySelector('#mdd-pane-details')?.addEventListener('input', (e) => {
        if (e.target.id !== 'detail-dep-input')
            setDirty(panel); // a search, not an edit
    });
    panel.querySelector('#mdd-pane-updates')?.addEventListener('input', (e) => {
        if (e.target.closest('#detail-links-list'))
            setDirty(panel);
    });
    panel.querySelector('#mdd-pane-updates')?.addEventListener('change', (e) => {
        if (e.target.closest('#detail-links-list'))
            setDirty(panel);
    });
    const tagList = panel.querySelector('#detail-tags-list');
    let modTags = [...(mod.tags || [])];
    const renderTagsUI = () => {
        tagList.innerHTML = '';
        modTags.forEach(tid => {
            const tDef = S.userTags.find(x => x.id === tid);
            if (!tDef)
                return;
            const chip = document.createElement('span');
            chip.className = 'mdd-tag';
            chip.innerHTML = renderTagChip(tDef, { fontSize: 11, pad: '2px 8px' })
                + `<button type="button" class="mdd-tag-x" data-tasky="mod.removeTagTip" data-tasky-icon="trash" aria-label="${escAttr(t('mod.removeTagTip'))}">${uiIcon('close', 12)}</button>`;
            chip.querySelector('button').onclick = async () => {
                const ok = await window.confirmCustom(t('common.delete'), t('mod.removeTagConfirm').replace('{name}', `<strong>${escHtml(tDef.name)}</strong>`), 'danger');
                if (ok) {
                    modTags = modTags.filter(id => id !== tid);
                    renderTagsUI();
                    setDirty(panel);
                }
            };
            tagList.appendChild(chip);
        });
        mod._currentTags = modTags;
    };
    const addTag = (tid) => {
        if (!tid || modTags.includes(tid))
            return;
        if (modTags.length >= 3) {
            toast(t('mod.tagLimit'), 'warning');
            return;
        }
        modTags.push(tid);
        renderTagsUI();
        setDirty(panel);
    };
    setupTagPicker(panel, () => modTags, addTag);
    renderTagsUI();
    // « Suggest » (optional AI): reads the mod's own files and, only if the user turned AI on and
    // chose a provider, asks it to rank THEIR tags. Nothing is written until they tick fields
    // and click Apply (features/ai/ai-suggest.ts). Loaded on click.
    const aiSlot = panel.querySelector('.mdd-ai-slot');
    if (aiSlot) {
        const aiBtn = document.createElement('button');
        aiBtn.type = 'button';
        aiBtn.id = 'btn-ai-suggest';
        aiBtn.className = 'btn btn-ghost btn-sm';
        aiBtn.title = t('ai.suggest.tip');
        aiBtn.innerHTML = uiIcon('ai', 14) + `<span>${escHtml(t('ai.suggest.button'))}</span>`;
        aiBtn.onclick = async () => {
            try {
                const { openAiSuggest } = await import('../ai/ai-suggest.js');
                await openAiSuggest(mod, {
                    tagName: (id) => (S.userTags || []).find((x) => x.id === id)?.name || id,
                    onApplied: (res) => {
                        const u = res?.mod;
                        if (u)
                            Object.assign(mod, { name: u.name, version: u.version, author: u.author, description: u.description, tags: u.tags, download_links: u.download_links });
                        _dirty = false;
                        appState.set('allMods', [...(S.allMods || [])]);
                        const c = document.querySelector(`.mod-card[data-id="${mod.id}"]`);
                        if (c)
                            updateCardState(c, mod);
                        renderModList(true);
                        renderModDetail(mod.id);
                        toast((res?.skippedTags || []).length ? t('ai.suggest.appliedSkipped') : t('ai.suggest.applied'), 'success');
                    },
                });
            }
            catch (err) {
                toast(t('common.error') + ' : ' + err, 'error');
            }
        };
        aiSlot.appendChild(aiBtn);
    }
    panel.querySelector('#btn-cancel-detail').onclick = () => { _dirty = false; renderModDetail(mod.id); };
    panel.querySelector('#btn-save-detail').onclick = async () => {
        const val = (sel) => (panel.querySelector(sel)?.value || '').trim();
        const name = val('#detail-name').substring(0, 100);
        const version = val('#detail-version').substring(0, 30);
        const author = val('#detail-author').substring(0, 50);
        const description = val('#detail-desc').substring(0, 2000);
        const tags = mod._currentTags || mod.tags || [];
        if (!name) {
            toast(t('mdd.nameRequired'), 'warning');
            showTab(panel, 'details');
            return;
        }
        try {
            const download_links = [];
            for (const row of Array.from(panel.querySelectorAll('#detail-links-list > .mdd-link-row'))) {
                const url = row.querySelector('.detail-link-url').value.trim();
                const linkType = row.querySelector('.detail-link-type').value;
                const label = row.querySelector('.detail-link-label').value.trim();
                if (url)
                    download_links.push({ url, link_type: linkType, label });
            }
            const dependencies = panel.querySelector('#detail-dep-input')?._selectedDeps || [];
            await invoke('update_mod_meta', {
                modId: mod.id, payload: { name, author, description, version, tags, downloadLinks: download_links, dependencies }
            });
            toast(t('common.saved'), 'success');
            Object.assign(mod, { name, version, author, description, tags, download_links, dependencies });
            _dirty = false;
            // A global state update, so every observer (and the card) follows.
            appState.set('allMods', [...(S.allMods || [])]);
            const card = document.querySelector(`.mod-card[data-id="${mod.id}"]`);
            if (card)
                updateCardState(card, mod);
            renderModList(true);
            renderModDetail(mod.id);
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    };
    // Links: remove a row, add one.
    panel.querySelector('#detail-links-list')?.addEventListener('click', (e) => {
        const x = e.target.closest('.btn-remove-link');
        if (!x)
            return;
        x.closest('.mdd-link-row')?.remove();
        setDirty(panel);
    });
    panel.querySelector('#btn-add-link').onclick = () => {
        const list = panel.querySelector('#detail-links-list');
        list.insertAdjacentHTML('beforeend', linkRowHtml('', 'direct', ''));
        list.lastElementChild?.querySelector('.detail-link-url')?.focus();
        setDirty(panel);
    };
}
export async function openArchiveExplorer(mod) {
    window._currentExplorerModId = mod.id;
    const modal = document.getElementById('modal-archive-explorer');
    const container = document.getElementById('archive-explorer-content');
    if (!modal || !container)
        return;
    initArchiveContextMenu();
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">${uiIcon('loader', 32, { style: 'animation:spin 1s linear infinite;margin-bottom:12px' })}<br>Scan en cours...</div>`;
    modal.classList.add('open');
    try {
        const files = await invoke('list_mod_files_recursive', { modId: mod.id });
        if (files.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;">${t('lib.emptyTitle')}</div>`;
            return;
        }
        const tree = buildFileTree(files);
        container.innerHTML = `<div class="tree-container">${renderTree(tree)}</div>`;
        setupTreeInteractions(mod);
    }
    catch (err) {
        container.innerHTML = `<div style="color:var(--danger);padding:20px;">${err}</div>`;
    }
}
function buildFileTree(files) {
    const root = {};
    files.sort().forEach(f => {
        const parts = f.split(/[/\\]/);
        let current = root;
        parts.forEach((part, i) => {
            if (!current[part])
                current[part] = { _isFolder: i < parts.length - 1, _fullPath: f, _relPath: parts.slice(0, i + 1).join('\\'), children: {} };
            current = current[part].children;
        });
    });
    return root;
}
function renderTree(nodes) {
    let html = '';
    const keys = Object.keys(nodes).sort((a, b) => {
        if (nodes[a]._isFolder && !nodes[b]._isFolder)
            return -1;
        if (!nodes[a]._isFolder && nodes[b]._isFolder)
            return 1;
        return a.localeCompare(b);
    });
    keys.forEach(key => {
        const node = nodes[key];
        const isFolder = node._isFolder;
        const arrow = isFolder ? `<span class="tree-node-arrow">${uiIcon('chevron-down', 12)}</span>` : '<span style="width:16px"></span>';
        const icon = isFolder ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` : `${uiIcon('file', 14, { style: 'opacity:0.6' })}`;
        html += `<div class="tree-node ${isFolder ? 'collapsed' : ''}" data-path="${escAttr(node._relPath)}" data-full="${escAttr(node._fullPath)}" data-type="${isFolder ? 'folder' : 'file'}">${arrow}<span class="tree-node-icon">${icon}</span><span class="tree-node-label">${escHtml(key)}</span></div>`;
        if (isFolder)
            html += `<div class="tree-children">${renderTree(node.children)}</div>`;
    });
    return html;
}
function setupTreeInteractions(mod) {
    const container = document.getElementById('archive-explorer-content');
    if (!container)
        return;
    container.querySelectorAll('.tree-node').forEach(node => {
        node.onclick = () => {
            if (node.dataset.type === 'folder')
                node.classList.toggle('collapsed');
            container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
            node.classList.add('selected');
        };
        node.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ctxMenu = document.getElementById('archive-context-menu');
            container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
            node.classList.add('selected');
            window._currentArchiveNode = node;
            ctxMenu.style.top = e.pageY + 'px';
            ctxMenu.style.left = e.pageX + 'px';
            ctxMenu.style.display = 'block';
        };
    });
}
export function showIntegrityReport(mod, report) {
    // Rust sends `isValid` (serde camelCase). This read `report.is_valid`, which never exists, so
    // every Verify from the details panel flagged the mod as tampered, clean or not.
    const isValid = reportIsValid(report);
    mod.file_hashes_invalid = !isValid;
    const stateMod = appState.state.allMods.find(m => m.id === mod.id);
    if (stateMod)
        stateMod.file_hashes_invalid = !isValid;
    // Refresh only the mod list UI (non-blocking)
    if (window._refreshModsFn)
        window._refreshModsFn(false, true);
    showIntegrityModal(modReportHtml(mod.name, report), t('integrity.modSub'), true);
}
/**
 * The tag picker: a list of real chips, and a way to make a new one without leaving.
 *
 * It was a native `<select>`. An `<option>` is text — the browser will not draw an icon or a
 * colour inside one — so the two things that tell tags apart were invisible in the one place
 * you pick a tag, and the only way to create a tag was to leave the mod, go to Settings, make
 * it, come back and find the mod again.
 */
function setupTagPicker(panel, currentTags, addTag) {
    const btn = panel.querySelector('#detail-tag-open');
    const menu = panel.querySelector('#detail-tag-menu');
    if (!btn || !menu)
        return;
    const close = () => { menu.style.display = 'none'; };
    const draw = () => {
        const taken = new Set(currentTags());
        menu.innerHTML = '';
        const tags = [...(S.userTags || [])].sort((a, b) => a.name.localeCompare(b.name));
        if (!tags.length) {
            const empty = document.createElement('div');
            empty.className = 'bmm-tag-menu-row';
            empty.setAttribute('disabled', '');
            empty.textContent = t('detail.noTagsYet') || 'No tags yet';
            menu.appendChild(empty);
        }
        for (const tDef of tags) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'bmm-tag-menu-row';
            // The chip is the whole point: same renderer as everywhere else, so a tag looks here
            // exactly like it looks on the card it is about to land on.
            row.innerHTML = renderTagChip(tDef, { fontSize: 11, pad: '2px 8px' });
            if (taken.has(tDef.id)) {
                row.setAttribute('disabled', '');
                row.disabled = true;
            }
            else {
                row.onclick = () => { addTag(tDef.id); draw(); };
            }
            menu.appendChild(row);
        }
        const sep = document.createElement('div');
        sep.className = 'bmm-tag-menu-sep';
        menu.appendChild(sep);
        const newRow = document.createElement('button');
        newRow.type = 'button';
        newRow.className = 'bmm-tag-menu-row';
        newRow.innerHTML = `${uiIcon('add', 14)} <span>${escHtml(t('detail.newTag') || 'New tag…')}</span>`;
        newRow.onclick = () => drawNew();
        menu.appendChild(newRow);
    };
    /** The creation form, inline. Name, colour, icon — the same three fields Settings asks
     *  for, and the same `create_tag` behind them, so a tag made here is not a lesser tag. */
    const drawNew = () => {
        menu.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'bmm-tag-new';
        box.innerHTML = `
      <div class="bmm-tag-new-row">
        <input type="text" class="input-field bmm-tag-name" maxlength="30"
               placeholder="${escAttr(t('settings.tagName') || 'Tag name')}"
               style="flex:1;padding:5px;font-size:11px">
        <input type="color" class="bmm-tag-color" value="#f97316"
               style="width:30px;height:26px;padding:0;border:none;background:none;cursor:pointer">
        <button type="button" class="btn btn-sm bmm-tag-icon" style="height:26px;padding:0 8px;display:inline-flex;align-items:center" aria-label="${escHtml(t('settings.tagIconTip'))}">${uiIcon('add', 14)}</button>
      </div>
      <div class="bmm-tag-new-row" style="justify-content:flex-end">
        <button type="button" class="btn btn-sm bmm-tag-cancel" style="height:24px;padding:0 8px;font-size:10px">${escHtml(t('common.cancel') || 'Cancel')}</button>
        <button type="button" class="btn btn-sm btn-primary bmm-tag-save" style="height:24px;padding:0 10px;font-size:10px">${escHtml(t('common.create') || 'Create')}</button>
      </div>`;
        menu.appendChild(box);
        let iconRef = '';
        const nameEl = box.querySelector('.bmm-tag-name');
        nameEl.focus();
        box.querySelector('.bmm-tag-icon').onclick = async () => {
            const { openIconPicker, renderPackIcon } = await import('../../ui/icon-pack.js');
            const ref = await openIconPicker({ current: iconRef });
            if (ref === null)
                return;
            iconRef = ref;
            box.querySelector('.bmm-tag-icon').innerHTML = renderPackIcon(ref, 14) || uiIcon('add', 14);
        };
        box.querySelector('.bmm-tag-cancel').onclick = () => draw();
        box.querySelector('.bmm-tag-save').onclick = async () => {
            const name = nameEl.value.trim();
            if (!name) {
                toast(t('settings.tagNameRequired') || 'Name required', 'error');
                return;
            }
            try {
                const color = box.querySelector('.bmm-tag-color').value;
                const tag = await invoke('create_tag', { name, color, icon: iconRef, color2: null });
                // Refreshed from the backend rather than pushed locally: Settings reads the same
                // list, and two copies of "the tags" is how one of them goes stale.
                S.userTags = await invoke('get_tags').catch(() => S.userTags);
                addTag(tag.id);
                draw();
            }
            catch (err) {
                toast(t('settings.tagCreateError', { err: String(err) }) || String(err), 'error');
            }
        };
    };
    btn.onclick = (e) => {
        e.stopPropagation();
        const open = menu.style.display !== 'none';
        if (open) {
            close();
            return;
        }
        draw();
        menu.style.display = 'block';
    };
    // Anywhere else closes it, including the panel behind — but not a click inside the menu,
    // which is how the creation form survives long enough to be filled in.
    document.addEventListener('mousedown', (ev) => {
        if (menu.style.display === 'none')
            return;
        if (ev.target.closest?.('#detail-tag-picker'))
            return;
        close();
    });
}
//# sourceMappingURL=mods-details.js.map