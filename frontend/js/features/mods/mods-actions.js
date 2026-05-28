// @ts-nocheck
import { appState } from '../../core/state.js';
import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { updateDiscordStatus } from '../settings/settings.js';
import { t } from '../../core/i18n.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { escHtml } from '../../core/utils.js';
import { refreshMods } from './mods.js';
import { setModLoading, updateCardState, updateBadge, updateSubtitle, updateToggleAllBtn } from './mods-list.js';
const S = new Proxy(appState.state, {
    get(target, prop) { return target[prop]; },
    set(target, prop, value) { appState.set(prop, value); return true; }
});
// ── Toggle-all cancel state ───────────────────────────────────────────────────
let _preOpSnapshot = [];
let _cancelRequested = false;
/** Single source of truth for every individual mod operation in flight. */
const _opState = new Map();
/** Sequential revert queue — prevents IPC freeze from parallel calls. */
const _revertQueue = [];
let _queueRunning = false;
export function registerSingleModOp(modId, prevEnabled, modName) {
    _opState.set(modId, { prevEnabled, cancelled: false, modName });
    _updateCancelBtn();
}
/** Checked from mods-list.ts try block to suppress success toasts. */
export function isCancelledOp(modId) {
    return _opState.get(modId)?.cancelled ?? false;
}
/** Called by the toggle finalizer (330ms after finally). */
export function consumeAndClearOp(modId) {
    const state = _opState.get(modId);
    _opState.delete(modId);
    _updateCancelBtn();
    if (state?.cancelled) {
        // Toggle finalizer shows the toast, drain just runs the IPC
        _revertQueue.push({ modId, prevEnabled: state.prevEnabled, modName: state.modName, showToast: false });
        _drainRevertQueue();
    }
    return state;
}
function _updateCancelBtn() {
    const hasOps = S.isGlobalProcessing || _opState.size > 0 || _queueRunning;
    _setCancelBtnState(hasOps, _queueRunning);
}
export function requestCancelModOps() {
    if (S.isGlobalProcessing) {
        _cancelRequested = true;
    }
    if (_opState.size === 0)
        return;
    _setCancelBtnState(true, true);
    for (const [modId, state] of Array.from(_opState.entries())) {
        if (S.processingMods.has(modId)) {
            // Still in-flight — finalizer handles the revert via consumeAndClearOp
            state.cancelled = true;
        }
        else {
            // Already finished — enqueue revert; drain shows the toast
            _revertQueue.push({ modId, prevEnabled: state.prevEnabled, modName: state.modName, showToast: true });
            _opState.delete(modId);
        }
    }
    _drainRevertQueue();
}
async function _drainRevertQueue() {
    if (_queueRunning)
        return;
    _queueRunning = true;
    _setCancelBtnState(true, true);
    while (_revertQueue.length > 0) {
        const item = _revertQueue.shift();
        try {
            // Sequential IPC — one call at a time
            if (item.prevEnabled)
                await invoke('enable_mod', { modId: item.modId, bypassSha: true });
            else
                await invoke('disable_mod', { modId: item.modId });
            const modRef = S.allMods.find((m) => m.id === item.modId);
            if (modRef) {
                modRef.enabled = item.prevEnabled;
                const card = document.querySelector(`.mod-card[data-id="${item.modId}"]`);
                if (card)
                    updateCardState(card, modRef);
            }
            if (item.showToast) {
                // prevEnabled=false → user was enabling → "Activation annulée"
                // prevEnabled=true  → user was disabling → "Désactivation annulée"
                const actionKey = item.prevEnabled ? 'lib.cancelToastDisable' : 'lib.cancelToastEnable';
                toast(`${item.modName} : ${t(actionKey)}`, 'info');
            }
        }
        catch (_) { /* best-effort */ }
    }
    _queueRunning = false;
    updateBadge();
    updateSubtitle();
    updateToggleAllBtn();
    _updateCancelBtn();
}
// ── Cancel button visual state ────────────────────────────────────────────────
const _CANCEL_SPINNER_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
let _cancelBtnOriginalHTML = null;
function _setCancelBtnState(active, spinning) {
    const btn = document.getElementById('btn-cancel-mod-ops');
    if (!btn)
        return;
    if (spinning) {
        if (_cancelBtnOriginalHTML === null)
            _cancelBtnOriginalHTML = btn.innerHTML;
        btn.innerHTML = _CANCEL_SPINNER_SVG;
        btn.disabled = false;
        btn.classList.add('btn-danger');
        btn.classList.remove('btn-ghost');
    }
    else {
        if (_cancelBtnOriginalHTML !== null) {
            btn.innerHTML = _cancelBtnOriginalHTML;
            _cancelBtnOriginalHTML = null;
        }
        btn.disabled = !active;
        btn.classList.toggle('btn-danger', active);
        btn.classList.toggle('btn-ghost', !active);
    }
}
export function openAddModModal() {
    ['mod-name', 'mod-folder', 'mod-version', 'mod-author', 'mod-desc'].forEach(id => {
        const el = document.getElementById(id);
        if (el)
            el.value = '';
    });
    const verEl = document.getElementById('mod-version');
    if (verEl)
        verEl.value = '1.0.0';
    const tagSelect = document.getElementById('mod-tag');
    if (tagSelect) {
        tagSelect.innerHTML = `<option value="">${t('prof.none') || 'None'}</option>`;
        S.userTags.forEach(tDef => {
            const opt = document.createElement('option');
            opt.value = tDef.id;
            opt.textContent = tDef.name;
            tagSelect.appendChild(opt);
        });
    }
    document.getElementById('modal-add-mod')?.classList.add('open');
    setupDependencyInput('mod-dependency-input', 'mod-dependencies-list', 'mod-dependency-suggestions');
}
export async function confirmAddMod() {
    const nameEl = document.getElementById('mod-name');
    const folderEl = document.getElementById('mod-folder');
    if (!nameEl || !folderEl)
        return;
    const name = nameEl.value.trim();
    const folder = folderEl.value.trim();
    const version = document.getElementById('mod-version')?.value.trim() || '1.0.0';
    const author = document.getElementById('mod-author')?.value.trim() || '';
    const description = document.getElementById('mod-desc')?.value.trim() || '';
    const tagSelect = document.getElementById('mod-tag');
    const tagId = tagSelect ? tagSelect.value : '';
    if (!name || !folder) {
        toast(t('mod.folderRequired') || "Name and folder required.", 'error');
        return;
    }
    const btn = document.getElementById('btn-confirm-add-mod');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${t('common.processing') || 'Copie en cours...'}`;
    const modal = document.getElementById('modal-add-mod');
    const download_links = modal?._pendingLinks || null;
    const dependencies = document.getElementById('mod-dependency-input')?._selectedDeps || [];
    try {
        await invoke('add_mod', {
            payload: {
                name, modFolderPath: folder, author, description, version,
                tags: tagId ? [tagId] : [], downloadLinks: download_links, dependencies
            }
        });
        if (modal) {
            modal._pendingLinks = null;
            document.getElementById('mod-dependency-input')._selectedDeps = [];
        }
        document.getElementById('modal-add-mod').classList.remove('open');
        toast(t('mod.added', { name }), 'success');
        await refreshMods(false, true); // Force immediate refresh
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}
export async function toggleAllMods(forcedEnable = null) {
    const enabledCount = S.allMods.filter(m => m.enabled).length;
    const enable = (forcedEnable === null) ? (enabledCount < S.allMods.length && S.allMods.length > 0) : forcedEnable;
    const targetMods = enable ? S.allMods.filter(m => !m.enabled) : S.allMods.filter(m => m.enabled);
    if (targetMods.length === 0)
        return;
    // Snapshot the state of all target mods BEFORE we touch them
    _preOpSnapshot = targetMods.map(m => ({ id: m.id, enabled: m.enabled }));
    _cancelRequested = false;
    S.isGlobalProcessing = true;
    targetMods.forEach(m => {
        S.processingMods.add(m.id);
        setModLoading(m.id, true);
    });
    // Show cancel button (isGlobalProcessing is now true)
    _updateCancelBtn();
    // Use the button that corresponds to the current action as the "active" loading button
    const btn = document.getElementById(enable ? 'btn-enable-all' : 'btn-disable-all-alt');
    const altBtn = document.getElementById(enable ? 'btn-disable-all-alt' : 'btn-enable-all');
    const originalHtml = btn?.innerHTML ?? '';
    if (btn)
        btn.disabled = true;
    if (altBtn)
        altBtn.disabled = true;
    if (btn)
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${enable ? t('common.enabling') : t('common.disabling')}`;
    try {
        await invoke('toggle_all_mods', { enable, bypassSha: false });
        await refreshMods();
        if (_cancelRequested) {
            // Revert: restore each mod to its snapshot state
            if (btn)
                btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${t('common.reverting') || 'Annulation…'}`;
            for (const snap of _preOpSnapshot) {
                try {
                    if (snap.enabled) {
                        await invoke('enable_mod', { modId: snap.id, bypassSha: false });
                    }
                    else {
                        await invoke('disable_mod', { modId: snap.id });
                    }
                }
                catch (_) { /* best-effort */ }
            }
            await refreshMods();
            toast(t('lib.cancelReverted') || 'Opération annulée — état précédent restauré.', 'info');
        }
        else {
            const key = enable ? 'mod.enabledCount' : 'mod.disabledCount';
            toast(t(key, { count: String(targetMods.length) }), 'success');
        }
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
    finally {
        _cancelRequested = false;
        _preOpSnapshot = [];
        targetMods.forEach(m => setModLoading(m.id, false));
        await new Promise(r => setTimeout(r, 250));
        targetMods.forEach(m => S.processingMods.delete(m.id));
        S.isGlobalProcessing = false;
        if (btn)
            btn.disabled = false;
        if (altBtn)
            altBtn.disabled = false;
        if (btn)
            btn.innerHTML = originalHtml;
        _updateCancelBtn();
        await refreshMods();
        await updateDiscordStatus();
    }
}
export function setupDependencyInput(inputId, listId, suggestionsId, initialDeps = []) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    const suggs = document.getElementById(suggestionsId);
    if (!input || !list || !suggs)
        return;
    let selectedIds = [...initialDeps];
    input._selectedDeps = selectedIds;
    const renderChips = () => {
        list.innerHTML = '';
        selectedIds.forEach(id => {
            const mod = S.allMods.find(m => m.id === id);
            if (!mod)
                return;
            const chip = document.createElement('div');
            chip.className = 'badge';
            chip.style.cssText = 'display:flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; background:rgba(255,255,255,0.1); font-size:11px';
            chip.innerHTML = `<span>${escHtml(mod.name)}</span><button style="background:none; border:none; color:var(--danger); cursor:pointer; padding:0; margin-left:4px">&times;</button>`;
            chip.querySelector('button').onclick = () => {
                selectedIds = selectedIds.filter(sid => sid !== id);
                input._selectedDeps = selectedIds;
                renderChips();
            };
            list.appendChild(chip);
        });
    };
    const updateSuggestions = () => {
        const val = input.value.toLowerCase().trim();
        const matches = S.allMods.filter(m => (!val || m.name.toLowerCase().includes(val) || m.id.toLowerCase().includes(val)) &&
            !selectedIds.includes(m.id) &&
            (!input._currentModId || m.id !== input._currentModId));
        if (matches.length === 0) {
            suggs.style.display = 'none';
            return;
        }
        suggs.innerHTML = matches.map(m => `
        <div class="suggestion-item" data-id="${m.id}" style="padding:10px 14px; cursor:pointer; font-size:12px; border-bottom:1px solid rgba(255,255,255,0.05); transition: background 0.2s">
            <div style="font-weight:600; color:var(--text-primary)">${escHtml(m.name)}</div>
            <div style="font-size:10px; color:var(--text-muted)">${escHtml(m.id)}</div>
        </div>
    `).join('');
        suggs.style.cssText += '; display:block; background:rgba(20,20,25,0.95); backdrop-filter:blur(10px); box-shadow:0 10px 25px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1)';
        suggs.style.display = 'block';
        suggs.querySelectorAll('.suggestion-item').forEach(item => {
            item.onmouseover = () => { item.style.background = 'rgba(255,255,255,0.05)'; };
            item.onmouseout = () => { item.style.background = 'transparent'; };
            item.onclick = (e) => {
                e.stopPropagation();
                selectedIds.push(item.dataset.id);
                input._selectedDeps = selectedIds;
                input.value = '';
                suggs.style.display = 'none';
                renderChips();
            };
        });
    };
    input.oninput = updateSuggestions;
    input.onfocus = updateSuggestions;
    input.onblur = () => setTimeout(() => { suggs.style.display = 'none'; }, 200);
    renderChips();
}
export async function scanModsFolder() {
    try {
        const result = await invoke('scan_mods_folder');
        if (result.added === 0 && result.removed === 0) {
            toast(t('mod.scanNone'), 'info');
        }
        else {
            let msg = '';
            if (result.added > 0)
                msg += `${result.added} ${t('mod.scanAdded')}`;
            if (result.added > 0 && result.removed > 0)
                msg += ' & ';
            if (result.removed > 0)
                msg += `${result.removed} ${t('mod.scanRemoved')}`;
            toast(msg, 'success');
            await refreshMods();
            // Kick-off background SHA hashing for newly discovered mods
            if (result.added > 0)
                invoke('trigger_sha_background_population').catch(() => { });
        }
        dispatchBmmAction(BMM_ACTIONS.MODS_SCANNED, { added: result.added, removed: result.removed });
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
}
export async function verifyIntegrity() {
    try {
        toast(t('integrity.checking'), 'info');
        const alteredFiles = await invoke('verify_integrity');
        const modal = document.getElementById('modal-integrity');
        const content = document.getElementById('integrity-report-content');
        if (!modal || !content)
            return;
        if (alteredFiles.length === 0) {
            content.innerHTML = `<div style="color:var(--success);padding:20px;text-align:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:12px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg><br><h3>${t('integrity.ok')}</h3><p style="font-size:13px;color:var(--text-muted);margin-top:8px">${t('integrity.okDesc')}</p></div>`;
        }
        else {
            let html = `<div style="color:var(--warning);padding:10px 0;"><h3 style="margin-bottom:12px;display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg> ${t('integrity.issues')}</h3><p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${t('integrity.issuesDesc')}</p><ul style="background:rgba(0,0,0,0.2);padding:12px;border-radius:8px;max-height:300px;overflow-y:auto;list-style:none;margin:0;border:1px solid var(--border)">`;
            alteredFiles.forEach(f => {
                html += `<li style="font-size:12px;font-family:var(--font-mono);margin-bottom:6px;word-break:break-all;color:var(--text-primary)"><span style="color:var(--accent)">></span> ${String(f).replace(/</g, '&lt;')}</li>`;
            });
            html += `</ul><div style="margin-top:16px;font-size:12px;color:var(--text-secondary)">${t('integrity.tip')}</div></div>`;
            content.innerHTML = html;
        }
        modal.classList.add('open');
        dispatchBmmAction(BMM_ACTIONS.INTEGRITY_CHECK);
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
}
//# sourceMappingURL=mods-actions.js.map