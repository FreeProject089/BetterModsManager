// @ts-nocheck
import { appState } from '../../core/state.js';
import { t, applyTranslations } from '../../core/i18n.js';
import { getModCardHTML, getLoadingOverlayHTML } from '../../ui/components.js';
import { invoke, sendOsNotification } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { updateDiscordStatus } from '../settings/settings.js';
import { refreshMods, selectMod, closeModDetail } from './mods.js';
import { registerSingleModOp, isCancelledOp, consumeAndClearOp } from './mods-actions.js';
import { escHtml, escAttr, escJs, truncate } from '../../core/utils.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';

const S = new Proxy(appState.state, {
  get(target, prop) { return target[prop]; },
  set(target, prop, value) { appState.set(prop, value); return true; }
});

let ghostFilteredMods = [];
let lastStartIndex = -1;
let lastEndIndex = -1;
const CARD_HEIGHTS = { standard: 110, compact: 54 };

// ── Background sync (debounced) ───────────────────────────────────────────────
// Called after every individual toggle instead of a full refreshMods().
// Waits for 2.5 s of idle (no more toggles) before hitting the backend.
let _bgSyncTimer: ReturnType<typeof setTimeout> | null = null;
function _scheduleBackgroundSync() {
  if (_bgSyncTimer) clearTimeout(_bgSyncTimer);
  _bgSyncTimer = setTimeout(async () => {
    _bgSyncTimer = null;
    if (S.processingMods.size === 0) {
      await refreshMods();
    }
  }, 2500);
}

export function updateBadge() {
  const badge = document.getElementById('badge-library');
  if (!badge) return;
  badge.textContent = S.allMods.length;
  badge.classList.toggle('show', S.allMods.length > 0);
}

export function updateSubtitle() {
  const enabled = S.allMods.filter(m => m.enabled).length;
  const total = S.allMods.length;
  const el = document.getElementById('lib-subtitle');
  if (!el) return;
  
  if (total === 0) {
    el.textContent = t('lib.subtitle.empty');
  } else {
    el.textContent = t('lib.subtitle', {
      enabled,
      total,
      s1: enabled !== 1 ? 's' : '',
      s2: total !== 1 ? 's' : ''
    });
  }
}

// Reused across calls — matches `String.localeCompare()` defaults but skips the
// per-comparison setup cost (benchmarked notably faster on large libraries).
const NAME_COLLATOR = new Intl.Collator();

export function getFilteredMods() {
  // Hoist a tagId→tag map so the search-by-tag fallback is an O(1) lookup
  // instead of S.userTags.find() per mod-tag (was O(mods × tags) — see
  // benchmarks/js; ~2× faster filtering at 5000 mods). Rebuilt each call so it
  // can never go stale when the user edits tags.
  const tagById = new Map<string, any>((S.userTags || []).map((t: any) => [t.id, t]));
  const cmp = (a: string, b: string) => NAME_COLLATOR.compare(a, b);

  let filtered = S.allMods.filter((m:any) => {
    const matchFilter =
      S.currentFilter === 'all' ||
      (S.currentFilter === 'enabled' && m.enabled) ||
      (S.currentFilter === 'disabled' && !m.enabled);

    const matchTag = !S.currentTagFilter || S.currentTagFilter === 'all' || (m.tags && m.tags.includes(S.currentTagFilter));

    let matchSearch = !S.searchQuery || m.name.toLowerCase().includes(S.searchQuery);
    if (!matchSearch && S.searchQuery && m.tags && m.tags.length > 0) {
      matchSearch = m.tags.some((tid:string) => {
        const tDef = tagById.get(tid);
        return tDef && tDef.name.toLowerCase().includes(S.searchQuery);
      });
    }
    return matchFilter && matchSearch && matchTag;
  });

  filtered.sort((a, b) => {
    if (S.currentSort === 'name_asc') return cmp(a.name, b.name);
    if (S.currentSort === 'name_desc') return cmp(b.name, a.name);
    if (S.currentSort === 'status') {
      if (a.enabled === b.enabled) return cmp(a.name, b.name);
      return a.enabled ? -1 : 1;
    }
    if (S.currentSort === 'activation_order') {
      if (!a.enabled && !b.enabled) return cmp(a.name, b.name);
      if (!a.enabled) return 1;
      if (!b.enabled) return -1;
      return a.activation_order - b.activation_order;
    }
    return 0;
  });

  return filtered;
}

export async function renderModList(force = false) {
  const list = document.getElementById('mod-list');
  const viewport = document.getElementById('mod-list-viewport');
  const spacer = document.getElementById('mod-list-spacer');
  const empty = document.getElementById('empty-mods');
  const scrollContainer = document.querySelector('.content-area');

  if (!list || !viewport || !empty || !scrollContainer) return;

  // Only re-filter when necessary to improve performance
  if (force || ghostFilteredMods.length === 0) {
    ghostFilteredMods = getFilteredMods();
  }

  const modCount = ghostFilteredMods.length;
  if (modCount === 0) {
    viewport.innerHTML = '';
    if (spacer) spacer.style.height = '0px';

    const hasProfile = !!S.cachedActiveProfileId;
    const noProfileEmpty = document.getElementById('empty-library-no-profile');

    if (!hasProfile) {
      if (noProfileEmpty) noProfileEmpty.style.display = 'block';
      empty.style.display = 'none';
    } else {
      if (noProfileEmpty) noProfileEmpty.style.display = 'none';
      empty.style.display = 'block';
    }
    return;
  }
  
  const noProfileEmpty = document.getElementById('empty-library-no-profile');
  if (noProfileEmpty) noProfileEmpty.style.display = 'none';
  empty.style.display = 'none';

  const rowHeight = S.isCompact ? CARD_HEIGHTS.compact : CARD_HEIGHTS.standard;
  const scrollTop = scrollContainer.scrollTop;
  const containerHeight = scrollContainer.clientHeight || 800;

  const buffer = 20;
  let startIndex = Math.floor(scrollTop / rowHeight) - buffer;
  let endIndex = Math.ceil((scrollTop + containerHeight) / rowHeight) + buffer;

  if (startIndex < 0) startIndex = 0;
  if (endIndex > modCount) endIndex = modCount;

  if (!force && startIndex === lastStartIndex && endIndex === lastEndIndex) {
    return; 
  }

  lastStartIndex = startIndex;
  lastEndIndex = endIndex;

  if (spacer) spacer.style.height = (modCount * rowHeight) + 'px';

  const visibleBatch = ghostFilteredMods.slice(startIndex, endIndex);
  viewport.style.transform = `translateY(${startIndex * rowHeight}px)`;

  const newVisibleIds = new Set(visibleBatch.map(m => m.id));
  const currentNodes = Array.from(viewport.children);
  currentNodes.forEach(node => {
     if (!newVisibleIds.has(node.dataset.id)) {
       node.remove();
     }
  });

  const existingMap = new Map();
  Array.from(viewport.children).forEach(node => {
     existingMap.set(node.dataset.id, node);
  });

  let _anyNewCard = false;
  // Scroll-induced renders (force === false) just re-position the viewport
  // contents.  Card visuals haven't changed because the user scrolled, so
  // skip the per-card updateCardState (8–10 DOM queries each) — that was
  // the main scroll-frame cost.  State events still call renderModList(true)
  // when something actually changes, which DOES run updateCardState.
  const skipInPlaceUpdates = !force;

  for (let i = 0; i < visibleBatch.length; i++) {
    const mod = visibleBatch[i];
    let card = existingMap.get(mod.id);
    const isProcessing = S.processingMods.has(mod.id);

    if (!card) {
      card = createModCard(mod);
      _anyNewCard = true;
      if (S.selectedModId === mod.id) {
        setTimeout(() => import('./mods-details.js').then(m => m.renderModDetail(mod.id)), 0);
      }
    } else if (!skipInPlaceUpdates && !isProcessing) {
      updateCardState(card, mod);
    }

    if (viewport.children[i] !== card) {
       viewport.insertBefore(card, viewport.children[i] || null);
    }
  }

  // applyTranslations is expensive (many DOM queries). Only run it when:
  //   • force=true (content truly changed) or
  //   • new cards were just created (need their data-i18n values resolved)
  if (force || _anyNewCard) {
    applyTranslations(viewport);
  }
}

export function createModCard(mod) {
  const card = document.createElement('div');
  card.className = `mod-card ${mod.enabled ? 'enabled' : 'disabled'} ${S.selectedModId === mod.id ? 'selected' : ''}`;
  card.dataset.id = mod.id;

  const ctx = {
    selectedModId: S.selectedModId,
    conflictCache: S.conflictCache,
    processingMods: S.processingMods,
    userTags: S.userTags
  };

  card.innerHTML = getModCardHTML(mod, ctx);

  // Installed from a repo with no hashes. Shown on the card rather than only in the details
  // panel: the whole point of persisting the flag is that it stays visible afterwards, and a
  // fact you have to go looking for is a fact nobody sees.
  if ((mod as any).unverified) {
    const warn = document.createElement('span');
    warn.className = 'mod-unverified-badge';
    warn.textContent = t('mods.unverified') || 'unverified';
    warn.title = t('mods.unverifiedTip') || 'Installed from a repo with no checksums — BMM could not verify these files.';
    card.querySelector('.mod-card-name, .mod-name, h3, h4')?.append(warn);
  }

  // Toggle handler
  const toggle = card.querySelector('.mod-toggle-input');
  toggle.addEventListener('change', async () => {
    if (S.processingMods.has(mod.id)) {
      toggle.checked = !toggle.checked;
      return;
    }

    const conflicts = S.conflictCache[mod.id];
    let ignoreConflicts = false;
    try { ignoreConflicts = localStorage.getItem('bmm_ignore_conflicts') === 'true'; } catch(e) {}
    const bypassKey = `bypass_conflict_${mod.id}`;

    if (toggle.checked && conflicts && conflicts.length > 0 && !ignoreConflicts && !(window as any)[bypassKey]) {
      toggle.checked = false;
      const { showActivationWarning } = await import('./mods-conflicts.js');
      showActivationWarning(mod.id, conflicts, () => {
        try { if (document.getElementById('conflict-ignore-forever')?.checked) localStorage.setItem('bmm_ignore_conflicts', 'true'); } catch(e) {}
        (window as any)[bypassKey] = true;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
      });
      return;
    }
    (window as any)[bypassKey] = false;

    S.processingMods.add(mod.id);

    // Snapshot the PREVIOUS state so the cancel button can revert it.
    // At this point toggle.checked is already the NEW desired state.
    registerSingleModOp(mod.id, !toggle.checked, mod.name);

    // 360° spin animation on the toggle when activating
    if (toggle.checked) {
      const toggleLabel = card.querySelector('.mod-toggle');
      if (toggleLabel) {
        toggleLabel.classList.remove('spin-360');
        void (toggleLabel as HTMLElement).offsetWidth; // force reflow
        toggleLabel.classList.add('spin-360');
        setTimeout(() => toggleLabel.classList.remove('spin-360'), 600);
      }
    }

    setModLoading(mod.id, true);

    try {
      if (toggle.checked) {
        const warningMsg = await invoke('enable_mod', { modId: mod.id, bypassSha: false });
        if (warningMsg && warningMsg.startsWith('WARNING_SPACE|')) {
          // Protocol: WARNING_SPACE|<label>|<free>|<limit>. free/limit are the trailing
          // numbers; the label sits in the middle and may itself contain '|', so rebuild it
          // from everything between — never assume a fixed part index.
          const parts = warningMsg.split('|');
          const limit = parts[parts.length - 1], free = parts[parts.length - 2];
          const label = parts.slice(1, -2).join('|');
          toast(t('storage.alertWarningMod', { label, free, limit }), 'warning', 5000);
        } else if (!isCancelledOp(mod.id)) {
          toast(t('mod.activated', { name: mod.name }), 'success');
          try { if (localStorage.getItem('bmm_sysNotif') === 'true') sendOsNotification('Better Mod Manager', t('mod.activated', { name: mod.name })); } catch(e) {}
          dispatchBmmAction(BMM_ACTIONS.MOD_ACTIVATED, { modId: mod.id, name: mod.name });
        }
      } else {
        // ... (existing disable logic)
        const modDeps = mod.dependencies || [];
        const dependents = S.allMods.filter(m => m.enabled && m.dependencies && m.dependencies.includes(mod.id));
        let requirements = S.allMods.filter(m => m.enabled && modDeps.includes(m.id));

        requirements = requirements.filter(req => {
           const otherDependents = S.allMods.filter(other => 
               other.id !== mod.id && 
               other.enabled && 
               other.dependencies && 
               other.dependencies.includes(req.id)
           );
           return otherDependents.length === 0;
        });

        const relatedMods = [...new Set([...dependents, ...requirements])];

        if (relatedMods.length > 0) {
          const names = relatedMods.map(m => m.name).join(', ');
          const title = t('mod.disableDependentsTitle') || 'Désactiver les mods liés ?';
          const desc = (t('mod.disableDependentsDesc') || 'Les mods suivants sont liés à celui-ci et pourraient être désactivés : {names}. Voulez-vous les désactiver aussi ?').replace('{names}', `<strong>${names}</strong>`);
          
          const ok = await window.confirmCustom(title, desc, 'danger', { noLabel: t('common.no') || 'Non' });
          
          if (ok) {
            for (const rel of relatedMods) {
               await invoke('disable_mod', { modId: rel.id });
            }
          }
        }

        await invoke('disable_mod', { modId: mod.id });
        if (!isCancelledOp(mod.id)) {
          toast(t('mod.deactivated', { name: mod.name }), 'info');
          try { if (localStorage.getItem('bmm_sysNotif') === 'true') sendOsNotification('Better Mod Manager', t('mod.deactivated', { name: mod.name })); } catch(e) {}
          dispatchBmmAction(BMM_ACTIONS.MOD_DEACTIVATED, { modId: mod.id, name: mod.name });
        }
      }
    } catch (err) {
      if (typeof err === 'string' && (err === 'CANCELLED' || err.includes('CANCELLED'))) {
        // Cancel path: silent — the per-mod cancel finalizer already shows a toast
        // and the Rust side already cleaned up any partial files via the inverse undo.
        // No error toast, no state desync.
      } else if (typeof err === 'string' && err.startsWith('CRITICAL_SPACE|')) {
        // CRITICAL_SPACE|<label>|<free>|<limit> — see WARNING_SPACE above; label may contain '|'.
        const parts = err.split('|');
        const limit = parts[parts.length - 1], free = parts[parts.length - 2];
        const label = parts.slice(1, -2).join('|');
        toast(t('storage.alertCriticalMod', { label, free, limit }), 'error', 6000);
        toggle.checked = false;
      } else if (typeof err === 'string' && err.startsWith('MISSING_SHA|')) {
        // MISSING_SHA|<id>|<name>. The id is a UUID (never contains '|'); the name is free-form
        // (a URL-imported mod name can contain '|'), so it's the trailing field — rejoin the rest.
        const parts = err.split('|');
        const mId = parts[1];
        const mName = parts.slice(2).join('|');
        
        toggle.checked = false;
        
        const ok = await window.confirmCustom(
          t('mods.sha.missingTitle') || 'Missing Integrity Hash',
          (t('mods.sha.missingDesc') || 'The mod "{name}" does not have a valid SHA hash. For security reasons, it is recommended to calculate the hash before enabling.').replace('{name}', `<strong>${mName}</strong>`),
          'warning',
          { 
            yesLabel: t('mods.sha.calculateAndEnable') || 'Calculate & Enable',
            noLabel: t('mods.sha.enableAnyway') || 'Enable Anyway'
          }
        );
        
        if (ok) {
           toast(t('mods.sha.calculating') || 'Calculating...', 'info');
           await invoke('recalculate_mod_sha', { modId: mId });
           toast(t('mods.sha.queued') || 'Mod added to calculation queue', 'success');
        } else {
           // Retry with bypass
           try {
               await invoke('enable_mod', { modId: mod.id, bypassSha: true });
               toggle.checked = true;
               toast(t('mod.activated', { name: mod.name }), 'success');
           } catch (e) {
               toast(t('common.error') + ' : ' + e, 'error');
           }
        }
      } else {
        toast(t('common.error') + ' : ' + err, 'error');
        toggle.checked = !toggle.checked;
      }
    } finally {
      // Start fade-out animation (300ms) — does NOT block the event handler
      setModLoading(mod.id, false);
      const _mid = mod.id;
      const _newEnabled = toggle.checked;
      const _modName = mod.name;

      // ── Resolve cancel state + update model immediately so the UI feels
      //    instantaneous.  Visual cleanup that has to align with the 300ms
      //    overlay fade still happens in the setTimeout below.
      const opResult = consumeAndClearOp(_mid);
      const wasCancelled = opResult?.cancelled === true;
      const effectiveEnabled = wasCancelled ? opResult!.prevEnabled : _newEnabled;

      if (wasCancelled) {
        const actionKey = _newEnabled ? 'lib.cancelToastEnable' : 'lib.cancelToastDisable';
        toast(`${_modName} : ${t(actionKey)}`, 'info');
      }

      if (toggle.checked !== effectiveEnabled) toggle.checked = effectiveEnabled;

      const modRef = S.allMods.find((m: any) => m.id === _mid);
      if (modRef) modRef.enabled = effectiveEnabled;
      if (modRef && card.isConnected) updateCardState(card, modRef);
      updateBadge();
      updateSubtitle();
      updateToggleAllBtn();
      ghostFilteredMods = [];

      setTimeout(() => {
        S.processingMods.delete(_mid);
        _scheduleBackgroundSync();
        // NOTE: previously re-applied loading overlays to "other mods still
        // processing".  That logic could re-add an overlay to a mod whose
        // IPC had already resolved (overlay removed at +300ms but mod still
        // in processingMods until its own setTimeout fires) — once added,
        // nothing would come back to take it off → STUCK loading.  Each
        // mod's own toggle handler already manages its overlay correctly,
        // so we don't need to micro-manage cross-mod overlays here.
      }, 330);
      updateDiscordStatus();
    }
  });

  // Action listeners
  // Action listeners
  const toggleBtn = card.querySelector('.btn-dropdown-toggle');
  if (toggleBtn) {
    // Dropdown is now handled via CSS :hover for better stability and to prevent ghosting.
    // We only keep JS for specific click actions if needed, but for now we follow the "hover to open" request via CSS.
  }

  // "Source folder" → the active profile's game directory (where mods deploy).
  card.querySelector('.btn-open-folder').addEventListener('click', async (e) => {
    e.stopPropagation();
    window.closeGlobalDropdown(true);
    try { await invoke('open_active_game_folder'); } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
  });

  // "Active folder" → conditional: if the mod is enabled, open where its files are
  // deployed in the game directory; if not, open the mod's own library folder.
  // (open_mod_active_folder resolves the deployed path, falling back to the mod
  // folder when there are no installed files.)
  card.querySelector('.btn-open-active-folder').addEventListener('click', async (e) => {
    e.stopPropagation();
    window.closeGlobalDropdown(true);
    try { await invoke('open_mod_active_folder', { modId: mod.id }); } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
  });

  card.querySelector('.btn-open-backup-folder').addEventListener('click', async (e) => {
    e.stopPropagation();
    window.closeGlobalDropdown(true);
    try { await invoke('open_mod_backup_folder', { modId: mod.id }); } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
  });

  card.querySelectorAll('.btn-copy-id, .btn-copy-id-card').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      window.closeGlobalDropdown(true);
      try {
        await navigator.clipboard.writeText(mod.id);
        toast(t('mod.idCopied', { id: mod.id }), 'success', 2000);
      } catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
      }
    });
  });

  card.querySelector('.btn-copy-content-id')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    window.closeGlobalDropdown(true);
    const contentId = (e.currentTarget as HTMLElement).dataset.contentId || '';
    if (!contentId) return;
    try {
      await navigator.clipboard.writeText(contentId);
      toast(t('common.contentIdCopied', { id: contentId.slice(0, 16) }) || ('Content ID copied: ' + contentId.slice(0, 16) + '…'), 'success', 2000);
    } catch (err) {
      toast(t('common.error') + ' : ' + err, 'error');
    }
  });

  card.querySelector('.btn-copy-repo-mod-id')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    window.closeGlobalDropdown(true);
    const rid = (e.currentTarget as HTMLElement).dataset.repoModId || mod.repo_mod_id || mod.id;
    try {
      await navigator.clipboard.writeText(rid);
      toast(t('repo.update.idCopied') || 'repo_mod_id copied', 'success', 2000);
    } catch (err) {
      toast(t('common.error') + ' : ' + err, 'error');
    }
  });

  card.querySelector('.btn-edit-mod').addEventListener('click', (e) => {
    e.stopPropagation();
    window.closeGlobalDropdown(true);
    selectMod(mod.id);
  });

  card.querySelector('.btn-remove-mod').addEventListener('click', async e => {
    e.stopPropagation();
    window.closeGlobalDropdown(true);
    if (mod.enabled) {
      toast(t('mod.disableFirst'), 'warning');
      return;
    }
    const modal = document.getElementById('modal-delete-mod');
    const warningText = document.getElementById('delete-mod-warning-text');
    const confirmCheck = document.getElementById('check-delete-confirm');
    const finalBtn = document.getElementById('btn-final-delete-mod');
    const btnRemoveOnly = document.getElementById('btn-remove-only-mod');

    if (warningText) warningText.innerHTML = t('mod.deleteWarning', { name: `<strong style="color:var(--text-primary)">${mod.name}</strong>` });
    confirmCheck.checked = false;
    finalBtn.disabled = true;
    modal.classList.add('open');

    confirmCheck.onchange = () => { finalBtn.disabled = !confirmCheck.checked; };
    
    const performDeletion = async (deleteFiles) => {
      try {
        await invoke('remove_mod', { modId: mod.id, deleteFiles });
        toast(t(deleteFiles ? 'mod.removed' : 'mod.removedOnly', { name: mod.name }), 'info');
        modal.classList.remove('open');
        if (S.selectedModId === mod.id) closeModDetail();
        await refreshMods();
      } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
    };

    finalBtn.onclick = () => performDeletion(true);
    btnRemoveOnly.onclick = () => performDeletion(false);
  });

  card.addEventListener('click', (e) => {
    if (e.target.closest('.mod-toggle') || e.target.closest('.btn-remove-mod') || e.target.closest('.btn-edit-mod') || e.target.closest('.btn-open-folder')) return;
    selectMod(mod.id);
  });

  card.addEventListener('dblclick', (e) => {
    if (e.target.closest('.btn-remove-mod') || e.target.closest('.btn-edit-mod') || e.target.closest('.btn-open-folder')) return;
    const toggle = card.querySelector('.mod-toggle-input') as HTMLInputElement;
    if (toggle && !S.processingMods.has(mod.id)) {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change'));
    }
  });

  return card;
}

// ── Global right-click cancel context menu (delegated) ────────────────────
// Attached ONCE on the viewport — fires even when a loading overlay covers the card.
let _cancelCtxAttached = false;
export function ensureModCancelContextMenu(): void {
  if (_cancelCtxAttached) return;
  _cancelCtxAttached = true;

  const showModCancelMenu = (x: number, y: number, modId: string, modName: string) => {
    document.getElementById('__mod-cancel-backdrop')?.remove();

    const root = document.getElementById('app-window-outer') || document.body;

    // Full-screen invisible backdrop captures the outside click → closes the menu.
    // The menu sits above it; clicking a menu item works because items are children.
    const backdrop = document.createElement('div');
    backdrop.id = '__mod-cancel-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:99998;background:transparent;';
    const closeAll = () => backdrop.remove();
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeAll(); });
    backdrop.addEventListener('contextmenu', (e) => { e.preventDefault(); closeAll(); });

    const menu = document.createElement('div');
    menu.id = '__mod-cancel-ctx';
    menu.style.cssText = `position:fixed;z-index:99999;background:#131620;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:6px 4px;box-shadow:0 12px 32px rgba(0,0,0,.7);min-width:215px;font-size:13px;user-select:none;`;
    menu.style.left = `${Math.min(x, window.innerWidth - 235)}px`;
    menu.style.top  = `${Math.min(y, window.innerHeight - 130)}px`;

    const opForThis = S.processingMods.has(modId);
    const totalOps  = S.processingMods.size;

    const mkItem = (label: string, icon: string, action: () => void) => {
      const el = document.createElement('div');
      el.style.cssText = `padding:9px 14px;cursor:pointer;border-radius:7px;color:color-mix(in srgb, var(--bmm-danger) 75%, var(--bmm-text-primary));display:flex;align-items:center;gap:9px;transition:background .12s;`;
      el.innerHTML = `${icon} <span style="flex:1;">${label}</span>`;
      el.addEventListener('mouseenter', () => { el.style.background = 'rgba(239,68,68,.12)'; });
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAll();
        action();
      });
      return el;
    };

    const ICstop = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    const ICtrash = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>`;
    const ICSpin  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

    const header = document.createElement('div');
    header.style.cssText = 'padding:5px 14px 8px;font-size:10px;color:var(--bmm-text-muted);text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px;display:flex;align-items:center;gap:6px;';
    header.innerHTML = `${ICSpin} ${totalOps} ${t('lib.opsRunning') || 'operation(s) running'}`;
    menu.appendChild(header);

    if (opForThis) {
      menu.appendChild(mkItem(
        `${t('lib.cancelCurrent') || 'Cancel'} <em style="opacity:.55;font-size:11px;">${escHtml(modName)}</em>`,
        ICstop,
        () => import('./mods-actions.js').then(({ requestCancelCurrentOnly }) => requestCancelCurrentOnly())
      ));
    }

    if (totalOps > (opForThis ? 1 : 0)) {
      menu.appendChild(mkItem(
        `${t('lib.cancelAll') || 'Cancel all'} (${totalOps})`,
        ICtrash,
        () => import('./mods-actions.js').then(({ requestCancelModOps }) => requestCancelModOps())
      ));
    }

    backdrop.appendChild(menu);
    root.appendChild(backdrop);

    // Auto-close if all ops finish while the menu is open
    const watch = setInterval(() => {
      if (S.processingMods.size === 0) { clearInterval(watch); closeAll(); }
    }, 500);
    const obs = new MutationObserver(() => { if (!document.contains(backdrop)) { clearInterval(watch); obs.disconnect(); } });
    obs.observe(root, { childList: true });

    // Escape closes
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeAll(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
  };

  // Listen on the list viewport at capture phase to bypass loading overlays
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    if (S.processingMods.size === 0) return;

    const card = (e.target as HTMLElement).closest('.mod-card') as HTMLElement | null;
    if (!card) return;

    const modId   = card.dataset.id || '';
    const modName = (card.querySelector('.mod-name') as HTMLElement)?.textContent?.trim() || modId;

    // Only intercept if this card is loading OR any ops are running
    if (!S.processingMods.has(modId) && S.processingMods.size === 0) return;

    e.preventDefault();
    showModCancelMenu(e.clientX, e.clientY, modId, modName);
  }, true); // capture=true bypasses overlays
}

export function updateCardState(card, mod) {
  // While a toggle is in-flight the backend state is stale — freeze all
  // enabled/disabled visuals so the optimistic UI state isn't overwritten.
  const isProcessing = S.processingMods.has(mod.id);

  if (!isProcessing) {
    card.classList.toggle('enabled', mod.enabled);
    card.classList.toggle('disabled', !mod.enabled);

    const toggle = card.querySelector('.mod-toggle-input');
    if (toggle) toggle.checked = mod.enabled;

    const dot = card.querySelector('.mod-status-dot');
    if (dot) {
      dot.classList.toggle('enabled', mod.enabled);
      dot.classList.toggle('disabled', !mod.enabled);
    }

    const pill = card.querySelector('.mod-status-pill');
    if (pill) {
      pill.classList.toggle('enabled', mod.enabled);
      pill.classList.toggle('disabled', !mod.enabled);
      pill.style.background = mod.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)';
      pill.style.color = mod.enabled ? 'var(--success)' : 'var(--text-muted)';
      pill.textContent = mod.enabled ? (t('mod.statusActive') || 'ACTIVE') : (t('mod.statusInactive') || 'INACTIVE');
    }
  }

  const nameRow = card.querySelector('.mod-name')?.parentElement;
  if (nameRow) {
    let badge = nameRow.querySelector('.badge-accent');
    if (!isProcessing && mod.enabled) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge badge-accent';
        badge.style.cssText = 'font-size:9px;padding:1px 6px;border-radius:4px;font-family:var(--font-mono);font-weight:800;background:rgba(59,130,246,0.2);color:var(--accent);border:1px solid rgba(59,130,246,0.3)';
        badge.onmouseenter = () => window.showTaskyHelp('lib.activationOrderTip', 'help');
        badge.onmouseleave = () => window.hideTaskyHelp();
        const nameEl = nameRow.querySelector('.mod-name');
        if (nameEl && nameEl.nextSibling) {
          nameRow.insertBefore(badge, nameEl.nextSibling);
        } else {
          nameRow.appendChild(badge);
        }
      }
      badge.textContent = `#${mod.activation_order}`;
    } else if (!isProcessing && badge) {
      badge.remove();
    }
  }

  // Update SHA status icon
  const shaIcon = card.querySelector('.sha-status-icon');
  if (shaIcon) {
    const isMissing = !mod.file_hashes || Object.keys(mod.file_hashes).length === 0;
    const isInvalid = mod.file_hashes_invalid;
    
    shaIcon.className = `sha-status-icon ${isInvalid ? 'invalid' : (isMissing ? 'missing' : 'verified')}`;
    shaIcon.style.color = isInvalid ? 'var(--danger)' : (isMissing ? 'var(--text-muted)' : 'var(--success)');
    shaIcon.style.opacity = isMissing ? '0.5' : '0.9';

    // Update tooltip
    const tooltipKey = isInvalid ? 'hashes.status.invalid' : (isMissing ? 'hashes.status.missing' : 'hashes.status.verified');
    const tooltipIcon = isInvalid ? 'alert' : 'shield';
    shaIcon.setAttribute('onmouseenter', `window.showTaskyHelp('${tooltipKey}', '${tooltipIcon}')`);
  }

  // Update text content to reflect saved changes immediately
  const updateTextIfChanged = (selector, newText) => {
    const el = card.querySelector(selector);
    if (el && el.textContent !== newText) el.textContent = newText;
  };

  updateTextIfChanged('.mod-name', mod.name);
  updateTextIfChanged('.mod-version', `v${mod.version}`);

  // Update Author
  const authorContainer = card.querySelector('.mod-author-container');
  if (authorContainer) {
    authorContainer.style.display = mod.author ? 'flex' : 'none';
    const authorNameEl = authorContainer.querySelector('.mod-author-name');
    if (authorNameEl) authorNameEl.textContent = truncate(mod.author || '', 50);
    // Use escJs only (not escAttr): setAttribute bypasses the HTML parser so
    // &quot; would remain literal. Single-quoted JS strings don't need " escaped.
    authorContainer.setAttribute('onmouseenter', `window.showTaskyHelp('${escJs(mod.author || '')}', 'user', true)`);
  }

  // Update Tags
  const tagsContainer = card.querySelector('.mod-tags-container');
  if (tagsContainer) {
    if (mod.tags && mod.tags.length > 0) {
      tagsContainer.style.display = 'inline-flex';
      const userTags = appState.get('userTags') || [];
      const visibleTags = mod.tags.slice(0, 3).map(tid => {
        const tDef = userTags.find(t => t.id === tid);
        if (!tDef) return '';
        return `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">${escHtml(tDef.name)}</span>`;
      }).join('');
      const extraTagsCount = mod.tags.length > 3 ? `<button class="btn btn-ghost" onclick="window.showModTagsModal('${mod.id}'); event.stopPropagation();" style="color:var(--text-muted);font-size:9px;padding:0;height:auto;min-height:0;margin:0;background:rgba(255,255,255,0.05);border-radius:4px;padding:1px 4px;border:1px solid rgba(255,255,255,0.1)">+${mod.tags.length - 3}</button>` : '';
      tagsContainer.innerHTML = visibleTags + extraTagsCount;
    } else {
      tagsContainer.style.display = 'none';
      tagsContainer.innerHTML = '';
    }
  }
}

export function setModLoading(modId, isLoading) {
  const card = document.querySelector(`.mod-card[data-id="${modId}"]`);
  if (!card) return;

  const existingOverlay = card.querySelector('.mod-loading-overlay') as HTMLElement | null;

  if (isLoading) {
    if (!existingOverlay) {
      card.insertAdjacentHTML('beforeend', getLoadingOverlayHTML());
    } else if (existingOverlay.classList.contains('fade-out')) {
      // Overlay is fading out — cancel the fade so a re-activation doesn't
      // leave the card half-faded between two ops.
      existingOverlay.classList.remove('fade-out');
    }
  } else if (existingOverlay && !existingOverlay.classList.contains('fade-out')) {
    existingOverlay.classList.add('fade-out');
    setTimeout(() => {
      // Only remove if it's still fading out — a setModLoading(true) call
      // in between may have un-faded it, in which case leave it alone.
      if (existingOverlay.classList.contains('fade-out')) {
        existingOverlay.remove();
      }
    }, 300);
  }
}

export function updateToggleAllBtn() {
  const btn = document.getElementById('btn-enable-all');
  const container = document.getElementById('enable-all-container');
  if (!btn) return;

  const enabledCount = S.allMods.filter(m => m.enabled).length;
  const allEnabled = S.allMods.length > 0 && enabledCount === S.allMods.length;

  const label = btn.querySelector('span');
  const svg = btn.querySelector('svg');

  if (allEnabled) {
    if (label) label.innerHTML = t('lib.disableAll');
    if (svg) svg.innerHTML = '<path d="M18 6L6 18M6 6l12 12" /><circle cx="12" cy="12" r="10" />';
    btn.className = 'btn btn-ghost view-action-util';
    btn.style.color = 'var(--danger)';
    if (container) container.classList.add('all-enabled');
  } else {
    if (label) label.innerHTML = t('lib.enableAll');
    if (svg) svg.innerHTML = '<path d="m5 12 5 5L20 7" /><circle cx="12" cy="12" r="10" />';
    btn.className = 'btn btn-ghost view-action-util';
    btn.style.color = '';
    if (container) container.classList.remove('all-enabled');
  }
}

(window as any).showModTagsModal = function(modId: string) {
  const mod = S.allMods.find((m:any) => m.id === modId);
  if (!mod || !mod.tags || mod.tags.length === 0) return;

  const container = document.getElementById('mod-tags-list-container');
  const title = document.getElementById('mod-tags-modal-title');
  if (!container || !title) return;

  title.innerText = (t('mod.tagsTitle') || 'Tags du Mod') + ' - ' + mod.name;

  container.innerHTML = mod.tags.map((tid:string) => {
    const tDef = S.userTags.find((t:any) => t.id === tid);
    if (!tDef) return '';
    return `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600">${escHtml(tDef.name)}</span>`;
  }).join('');

  const modal = document.getElementById('modal-mod-tags');
  if (modal) modal.classList.add('open');
};

