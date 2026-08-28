// @ts-nocheck
import { appState } from '../../core/state.js';
import { invoke, pickFolder, sendOsNotification } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { updateDiscordStatus } from '../settings/settings.js';
import { t } from '../../core/i18n.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { escHtml } from '../../core/utils.js';
import { refreshMods, closeModDetail } from './mods.js';
import { setModLoading, updateCardState, updateBadge, updateSubtitle, updateToggleAllBtn } from './mods-list.js';

const S = new Proxy(appState.state, {
  get(target, prop) { return target[prop]; },
  set(target, prop, value) { appState.set(prop, value); return true; }
});

// ── Toggle-all cancel state ───────────────────────────────────────────────────
let _preOpSnapshot: { id: string; enabled: boolean }[] = [];
let _cancelRequested = false;

// ── Per-mod cancel state ──────────────────────────────────────────────────────
interface _OpState {
  prevEnabled: boolean;
  cancelled: boolean;
  modName: string;
}

interface _QueueItem {
  modId: string;
  prevEnabled: boolean;
  modName: string;
  /** true → drain shows the cancel toast; false → toggle finalizer shows it */
  showToast: boolean;
}

/** Single source of truth for every individual mod operation in flight. */
const _opState = new Map<string, _OpState>();

/** Sequential revert queue — prevents IPC freeze from parallel calls. */
const _revertQueue: _QueueItem[] = [];
let _queueRunning = false;

export function registerSingleModOp(modId: string, prevEnabled: boolean, modName: string) {
  _opState.set(modId, { prevEnabled, cancelled: false, modName });
  _updateCancelBtn();
}

/** Checked from mods-list.ts try block to suppress success toasts. */
export function isCancelledOp(modId: string): boolean {
  return _opState.get(modId)?.cancelled ?? false;
}

/** Called by the toggle finalizer (330ms after finally). */
export function consumeAndClearOp(modId: string): _OpState | undefined {
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

/**
 * Is anything running that a cancel would reach?
 *
 * The cancel BUTTON has always known this — it is what decides whether it is lit. Exported
 * so a keyboard shortcut can know it too: a shortcut that silently does nothing is worse
 * than no shortcut, because the person presses it again harder.
 */
export function hasCancellableOps(): boolean {
  return S.isGlobalProcessing || _opState.size > 0 || _queueRunning;
}

function _updateCancelBtn() {
  _setCancelBtnState(hasCancellableOps(), _queueRunning);
}

/** "Cancel current op only" — kill the running worker, let any queued
 *  ops continue (used by the main cancel button's default click).        */
export function requestCancelCurrentOnly() {
  try { invoke('kill_current_mod_op'); } catch (_) {}
  // Mark the in-flight op(s) as cancelled so the toggle finalizer shows the
  // "cancelled" toast and the success toast is suppressed — even when the backend
  // returns Ok instead of a CANCELLED error after being killed.
  for (const [modId, state] of _opState.entries()) {
    if (S.processingMods.has(modId)) state.cancelled = true;
  }
  // Brief spinner feedback so the user sees the click registered
  _setCancelBtnState(true, true);
  setTimeout(() => _updateCancelBtn(), 500);
}

/** True while a "cancel all" gesture is in progress.  Used so the
 *  drain queue doesn't prematurely clear the Rust cancel flag while
 *  there are still in-flight ops that should see CANCELLED. */
let _cancelAllInProgress = false;

export async function requestCancelModOps() {
  // Tell the Rust side to abort any running file copy IMMEDIATELY — this is
  // what makes cancel feel instant instead of "wait for current mod to finish".
  try { invoke('cancel_mod_ops'); } catch (_) { /* best-effort */ }

  if (S.isGlobalProcessing) {
    _cancelRequested = true;
  }
  if (_opState.size === 0) {
    _setCancelBtnState(S.isGlobalProcessing, true);
    return;
  }

  _setCancelBtnState(true, true);
  _cancelAllInProgress = true;

  // Mark every entry: in-flight gets cancelled flag set (their finalizer
  // will push to the revert queue); already-completed get pushed now.
  for (const [modId, state] of Array.from(_opState.entries())) {
    if (S.processingMods.has(modId)) {
      state.cancelled = true;
    } else {
      _revertQueue.push({ modId, prevEnabled: state.prevEnabled, modName: state.modName, showToast: true });
      _opState.delete(modId);
    }
  }

  // Wait until every in-flight has resolved (worker killed → finalizer
  // ran → pushed its revert).  Only THEN clear the Rust flag and start
  // the actual revert pass.  This prevents queued ops from sneaking past
  // a too-early clear and toggling for real.
  const waitStart = Date.now();
  while ((_opState.size > 0 || S.processingMods.size > 0) && Date.now() - waitStart < 15000) {
    await new Promise(r => setTimeout(r, 50));
  }

  try { await invoke('clear_mod_op_cancel'); } catch (_) {}
  _cancelAllInProgress = false;

  // Drain whatever piled up into the revert queue — single click, all
  // pending mods revert sequentially without the user clicking again.
  _drainRevertQueue();
}

async function _drainRevertQueue() {
  if (_queueRunning) return;
  _queueRunning = true;
  _setCancelBtnState(true, true);

  // Only clear the flag here if a cancel-all isn't actively waiting for
  // in-flight ops to settle (it owns the clear in that case).
  if (!_cancelAllInProgress) {
    try { await invoke('clear_mod_op_cancel'); } catch (_) {}
  }

  while (_revertQueue.length > 0) {
    const item = _revertQueue.shift()!;
    try {
      // Sequential IPC — one call at a time
      if (item.prevEnabled) await invoke('enable_mod', { modId: item.modId, bypassSha: true });
      else await invoke('disable_mod', { modId: item.modId });

      const modRef = S.allMods.find((m: any) => m.id === item.modId);
      if (modRef) {
        modRef.enabled = item.prevEnabled;
        const card = document.querySelector(`.mod-card[data-id="${item.modId}"]`) as HTMLElement | null;
        if (card) updateCardState(card, modRef);
      }

      if (item.showToast) {
        // prevEnabled=false → user was enabling → "Activation annulée"
        // prevEnabled=true  → user was disabling → "Désactivation annulée"
        const actionKey = item.prevEnabled ? 'lib.cancelToastDisable' : 'lib.cancelToastEnable';
        toast(`${item.modName} : ${t(actionKey)}`, 'info');
      }
    } catch (_) { /* best-effort */ }
  }

  _queueRunning = false;
  updateBadge();
  updateSubtitle();
  updateToggleAllBtn();
  _updateCancelBtn();
}

// ── Cancel button visual state ────────────────────────────────────────────────
const _CANCEL_SPINNER_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.7s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
let _cancelBtnOriginalHTML: string | null = null;

function _setCancelBtnState(active: boolean, spinning: boolean) {
  const btn = document.getElementById('btn-cancel-mod-ops') as HTMLButtonElement | null;
  const wrapper = document.getElementById('cancel-ops-wrapper');
  if (wrapper) wrapper.classList.toggle('disabled', !active);
  if (!btn) return;

  if (spinning) {
    if (_cancelBtnOriginalHTML === null) _cancelBtnOriginalHTML = btn.innerHTML;
    btn.innerHTML = _CANCEL_SPINNER_SVG;
    btn.disabled = false;
    btn.classList.add('btn-danger');
    btn.classList.remove('btn-ghost');
  } else {
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
    if (el) el.value = '';
  });
  
  const verEl = document.getElementById('mod-version');
  if (verEl) verEl.value = '1.0.0';

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
  if (!nameEl || !folderEl) return;
  
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
  const download_links = (modal as any)?._pendingLinks || null;
  const dependencies = (document.getElementById('mod-dependency-input') as any)?._selectedDeps || [];

  try {
    await invoke('add_mod', {
      payload: {
          name, modFolderPath: folder, author, description, version,
          tags: tagId ? [tagId] : [], downloadLinks: download_links, dependencies
      }
    });
    
    if (modal) {
      (modal as any)._pendingLinks = null;
      (document.getElementById('mod-dependency-input') as any)._selectedDeps = [];
    }
    document.getElementById('modal-add-mod').classList.remove('open');
    toast(t('mod.added', { name }), 'success');
    dispatchBmmAction(BMM_ACTIONS.MOD_ADDED, { name });
    await refreshMods(false, true); // Force immediate refresh
  } catch (err) {
    toast(t('common.error') + ' : ' + err, 'error');
  } finally {
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
  }
}

export async function toggleAllMods(forcedEnable = null) {
  (window as any).bmmTrack?.('feature', { name: 'mods.toggleAll' });
  const enabledCount = S.allMods.filter(m => m.enabled).length;
  const enable = (forcedEnable === null) ? (enabledCount < S.allMods.length && S.allMods.length > 0) : forcedEnable;

  const targetMods = enable ? S.allMods.filter(m => !m.enabled) : S.allMods.filter(m => m.enabled);
  if (targetMods.length === 0) return;

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
  const btn    = document.getElementById(enable ? 'btn-enable-all' : 'btn-disable-all-alt') as HTMLButtonElement;
  const altBtn = document.getElementById(enable ? 'btn-disable-all-alt' : 'btn-enable-all') as HTMLButtonElement;
  const originalHtml = btn?.innerHTML ?? '';

  if (btn)    btn.disabled = true;
  if (altBtn) altBtn.disabled = true;

  if (btn) btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${enable ? t('common.enabling') : t('common.disabling')}`;

  try {
    await invoke('toggle_all_mods', { enable, bypassSha: false });
    await refreshMods();

    if (_cancelRequested) {
      // Revert: restore each mod to its snapshot state
      if (btn) btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${t('common.reverting') || 'Annulation…'}`;
      // Clear the backend cancel flag so the revert IPCs themselves run.
      try { await invoke('clear_mod_op_cancel'); } catch (_) {}
      for (const snap of _preOpSnapshot) {
        try {
          if (snap.enabled) {
            await invoke('enable_mod', { modId: snap.id, bypassSha: false });
          } else {
            await invoke('disable_mod', { modId: snap.id });
          }
        } catch (_) { /* best-effort */ }
      }
      await refreshMods();
      toast(t('lib.cancelReverted') || 'Opération annulée — état précédent restauré.', 'info');
    } else {
      const key = enable ? 'mod.enabledCount' : 'mod.disabledCount';
      toast(t(key, { count: String(targetMods.length) }), 'success');
    }
  } catch (err) {
    if (typeof err === 'string' && (err === 'CANCELLED' || err.includes('CANCELLED'))) {
      // Silent — cancel path already handled
    } else {
      toast(t('common.error') + ' : ' + err, 'error');
    }
  } finally {
    _cancelRequested = false;
    _preOpSnapshot = [];
    // Always make sure the cancel flag is cleared at the end of the batch
    // so a follow-up toggle isn't accidentally short-circuited.
    try { await invoke('clear_mod_op_cancel'); } catch (_) {}
    targetMods.forEach(m => setModLoading(m.id, false));
    await new Promise(r => setTimeout(r, 250));
    targetMods.forEach(m => S.processingMods.delete(m.id));
    S.isGlobalProcessing = false;
    if (btn)    btn.disabled = false;
    if (altBtn) altBtn.disabled = false;
    if (btn)    btn.innerHTML = originalHtml;
    _updateCancelBtn();
    await refreshMods();
    await updateDiscordStatus();
  }
}

// Cache for all-profile mods — refreshed once per detail-panel open
let _allProfileMods: Record<string, { profile_name: string; mods: Array<{id:string;name:string;version:string;enabled:boolean}> }> = {};

async function _loadAllProfileMods() {
  try { _allProfileMods = await invoke('get_mods_all_profiles'); } catch { _allProfileMods = {}; }
}

/** Resolve a dep ref (same-profile: "mod-id" or cross-profile: "prof::mod-id") to a display name. */
function _resolveDep(depRef: string): { name: string; profileName?: string; crossProfile: boolean } {
  if (depRef.includes('::')) {
    const [profId, modId] = depRef.split('::');
    const profData = _allProfileMods[profId];
    const modEntry = profData?.mods.find(m => m.id === modId);
    return { name: modEntry?.name || modId, profileName: profData?.profile_name || profId, crossProfile: true };
  }
  const m = S.allMods.find((m: any) => m.id === depRef);
  return { name: m?.name || depRef, crossProfile: false };
}

export async function setupDependencyInput(inputId, listId, suggestionsId, initialDeps = []) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const suggs = document.getElementById(suggestionsId);
  if (!input || !list || !suggs) return;

  // Load cross-profile mods in background
  await _loadAllProfileMods();

  let selectedIds = [...initialDeps];
  input._selectedDeps = selectedIds;

  // Determine active profile id to distinguish same-profile mods
  const activeProfileId = S.activeProfileId || null;

  const renderChips = () => {
    list.innerHTML = '';
    selectedIds.forEach(depRef => {
      const { name, profileName, crossProfile } = _resolveDep(depRef);
      const chip = document.createElement('div');
      chip.className = 'badge';
      chip.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 9px;border-radius:6px;font-size:11px;';
      chip.style.background = crossProfile ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.1)';
      chip.style.border = crossProfile ? '1px solid rgba(168,85,247,0.35)' : '1px solid rgba(255,255,255,0.08)';
      chip.innerHTML = `
        ${crossProfile ? `<span style="font-size:9px;color:var(--bmm-purple);font-weight:700;">${escHtml(profileName || '?')} ›</span>` : ''}
        <span>${escHtml(name)}</span>
        <button style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0 0 0 4px;font-size:14px;line-height:1;">&times;</button>`;
      chip.querySelector('button').onclick = () => {
        selectedIds = selectedIds.filter(sid => sid !== depRef);
        input._selectedDeps = selectedIds;
        renderChips();
      };
      if (crossProfile) chip.title = `${t('mod.crossProfileDep') || 'Cross-profile dependency'}: ${profileName}`;
      list.appendChild(chip);
    });
  };

  const updateSuggestions = () => {
    const val = input.value.toLowerCase().trim();

    // Section 1: same-profile mods
    const sameProfileMatches = S.allMods.filter((m: any) =>
        (!val || m.name.toLowerCase().includes(val) || m.id.toLowerCase().includes(val)) &&
        !selectedIds.includes(m.id) &&
        (!input._currentModId || m.id !== input._currentModId)
    );

    // Section 2: cross-profile mods from other profiles
    // Identify "other" profiles by checking if their mods overlap with S.allMods.
    // This avoids relying on S.activeProfileId which may be null/stale.
    const activeModIds = new Set((S.allMods || []).map((m: any) => m.id));
    const crossProfileMatches: Array<{depRef: string; name: string; profileName: string; enabled: boolean}> = [];
    for (const [profId, profData] of Object.entries(_allProfileMods)) {
      // A profile is "active" if most of its mods are already in S.allMods.
      // Skip it (those mods are in sameProfileMatches already).
      const itsModIds = profData.mods.map(m => m.id);
      const overlap = itsModIds.filter(id => activeModIds.has(id)).length;
      const isCurrent = itsModIds.length > 0 && overlap / itsModIds.length > 0.5;
      if (isCurrent || profId === activeProfileId) continue;
      for (const m of profData.mods) {
        const depRef = `${profId}::${m.id}`;
        if (selectedIds.includes(depRef)) continue;
        if (input._currentModId && m.id === input._currentModId) continue;
        if (!val || m.name.toLowerCase().includes(val) || m.id.toLowerCase().includes(val)) {
          crossProfileMatches.push({ depRef, name: m.name, profileName: profData.profile_name, enabled: m.enabled });
        }
      }
    }

    if (sameProfileMatches.length === 0 && crossProfileMatches.length === 0) {
      suggs.style.display = 'none';
      return;
    }

    let html = '';
    if (sameProfileMatches.length) {
      html += `<div style="padding:4px 12px 2px;font-size:9px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.8px;">${t('mod.currentProfile') || 'Current profile'}</div>`;
      html += sameProfileMatches.slice(0, 8).map((m: any) => `
        <div class="suggestion-item" data-dep-ref="${m.id}" style="padding:8px 14px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="font-weight:600;color:var(--text-primary);">${escHtml(m.name)}</div>
          <div style="font-size:10px;color:var(--text-muted);">${escHtml(m.id)}</div>
        </div>`).join('');
    }
    if (crossProfileMatches.length) {
      html += `<div style="padding:4px 12px 2px;font-size:9px;font-weight:800;color:var(--bmm-purple);text-transform:uppercase;letter-spacing:.8px;">${t('mod.otherProfiles') || 'Other profiles'}</div>`;
      html += crossProfileMatches.slice(0, 8).map(m => `
        <div class="suggestion-item" data-dep-ref="${m.depRef}" style="padding:8px 14px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04);">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:600;color:var(--text-primary);">${escHtml(m.name)}</span>
            <span style="font-size:9px;background:rgba(168,85,247,0.15);color:var(--bmm-purple);padding:1px 6px;border-radius:4px;font-weight:700;">${escHtml(m.profileName)}</span>
            ${!m.enabled ? `<span style="font-size:9px;color:var(--text-muted);">(${t('mod.statusInactive')||'inactive'})</span>` : ''}
          </div>
          <div style="font-size:10px;color:var(--text-muted);">${escHtml(m.depRef)}</div>
        </div>`).join('');
    }

    suggs.innerHTML = html;
    suggs.style.cssText += ';display:block;background:rgba(12,15,24,0.97);backdrop-filter:blur(12px);box-shadow:0 10px 28px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,0.1);max-height:280px;overflow-y:auto;';
    suggs.style.display = 'block';

    suggs.querySelectorAll('.suggestion-item').forEach(item => {
      item.onmouseover = () => { (item as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; };
      item.onmouseout  = () => { (item as HTMLElement).style.background = 'transparent'; };
      item.onclick = (e) => {
        e.stopPropagation();
        const depRef = (item as HTMLElement).dataset.depRef;
        if (depRef && !selectedIds.includes(depRef)) {
          selectedIds.push(depRef);
          input._selectedDeps = selectedIds;
          input.value = '';
          suggs.style.display = 'none';
          renderChips();
        }
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
    (window as any).bmmTrack?.('feature', { name: 'mods.scan' });
    const result = await invoke('scan_mods_folder');
    if (result.added === 0 && result.removed === 0) {
      toast(t('mod.scanNone'), 'info');
    } else {
      let msg = '';
      if (result.added > 0) msg += `${result.added} ${t('mod.scanAdded')}`;
      if (result.added > 0 && result.removed > 0) msg += ' & ';
      if (result.removed > 0) msg += `${result.removed} ${t('mod.scanRemoved')}`;
      toast(msg, 'success');
      await refreshMods();
      // Kick-off background SHA hashing for newly discovered mods
      if (result.added > 0) invoke('trigger_sha_background_population').catch(() => {});
    }
    dispatchBmmAction(BMM_ACTIONS.MODS_SCANNED, { added: result.added, removed: result.removed });
  } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
}

export async function verifyIntegrity() {
  // Held open for the whole check, then dismissed as the report appears — the modal IS
  // the completion signal, so a second "done" toast would just repeat it.
  const dismiss = toast(t('integrity.checking'), 'info', 0);
  try {
    const alteredFiles = await invoke('verify_integrity');
    dismiss();
    const modal = document.getElementById('modal-integrity');
    const content = document.getElementById('integrity-report-content');
    if (!modal || !content) return;

    if (alteredFiles.length === 0) {
      content.innerHTML = `<div style="color:var(--success);padding:20px;text-align:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:12px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg><br><h3>${t('integrity.ok')}</h3><p style="font-size:13px;color:var(--text-muted);margin-top:8px">${t('integrity.okDesc')}</p></div>`;
    } else {
      let html = `<div style="color:var(--warning);padding:10px 0;"><h3 style="margin-bottom:12px;display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg> ${t('integrity.issues')}</h3><p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${t('integrity.issuesDesc')}</p><ul style="background:rgba(0,0,0,0.2);padding:12px;border-radius:8px;max-height:300px;overflow-y:auto;list-style:none;margin:0;border:1px solid var(--border)">`;
      alteredFiles.forEach(f => {
        html += `<li style="font-size:12px;font-family:var(--font-mono);margin-bottom:6px;word-break:break-all;color:var(--text-primary)"><span style="color:var(--accent)">></span> ${String(f).replace(/</g, '&lt;')}</li>`;
      });
      html += `</ul><div style="margin-top:16px;font-size:12px;color:var(--text-secondary)">${t('integrity.tip')}</div></div>`;
      content.innerHTML = html;
    }
    modal.classList.add('open');
    dispatchBmmAction(BMM_ACTIONS.INTEGRITY_CHECK);
  } catch (err) {
    dismiss();
    toast(t('common.error') + ' : ' + err, 'error');
  }
}
