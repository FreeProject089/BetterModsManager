// @ts-nocheck
import { appState } from '../../core/state.js';
import { actAttrs } from '../../core/inline-actions.js';
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr, escJs } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
import { wireDismissibleTip } from '../../ui/dismissible-tip.js';

const S = new Proxy(appState.state, {
  get(target, prop) { return target[prop]; },
  set(target, prop, value) { appState.set(prop, value); return true; }
});

let conflictCheckGeneration = 0;

export async function checkAllConflicts() {
  const currentGen = ++conflictCheckGeneration;

  // ONE batched IPC call instead of N/5 round-trips (was the main import/large-
  // library lag): the backend computes every mod's conflicts behind a single
  // lock pass and returns a `mod_id -> conflicts` map (conflict-free mods omitted).
  let conflictMap: Record<string, any[]> = {};
  try {
    conflictMap = await invoke('get_all_mod_conflicts');
  } catch {
    return; // backend unavailable / no active profile — leave cache untouched
  }

  if (currentGen !== conflictCheckGeneration) return;

  // Rebuild the cache from the fresh map (drops stale/deleted mods automatically).
  const newCache: Record<string, any[]> = {};
  for (const id in conflictMap) {
    if (conflictMap[id] && conflictMap[id].length > 0) newCache[id] = conflictMap[id];
  }

  // Update only the badges that actually changed to avoid touching every card.
  const changed = new Set<string>([...Object.keys(S.conflictCache), ...Object.keys(newCache)]);
  S.conflictCache = newCache;
  changed.forEach(id => updateConflictBadgeOnCard(id));

  saveConflictCache();
}

export function updateConflictBadgeOnCard(modId) {
  const card = document.querySelector(`.mod-card[data-id="${modId}"]`);
  if (!card) return;

  const reports = S.conflictCache[modId] || [];
  const modInfo = card.querySelector('.mod-info');
  const nameRow = modInfo ? modInfo.firstElementChild : null;
  if (!nameRow) return;

  nameRow.querySelectorAll('.tag-conflict, .conflict-badge').forEach(e => e.remove());

  if (reports.length > 0) {
    const hasIntraActive = reports.some(c => c.category === 'Intra' && c.status === 'Active');
    const hasIntraPotential = reports.some(c => c.category === 'Intra' && c.status === 'Potential');
    const hasInterActive = reports.some(c => c.category === 'Inter' && c.status === 'Active');
    const hasInterPotential = reports.some(c => c.category === 'Inter' && c.status === 'Potential');

    let conflictHtml = '';
    const intraSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
    const interSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

    if (hasIntraActive) conflictHtml += `<div class="tag-conflict tag-intra-conflict active" data-tasky="lib.conflictActiveTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${intraSvg}Intra</div>`;
    else if (hasIntraPotential) conflictHtml += `<div class="tag-conflict tag-intra-conflict potential" data-tasky="lib.conflictPotentialTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${intraSvg}Intra</div>`;

    if (hasInterActive) conflictHtml += `<div class="tag-conflict tag-inter-conflict active" data-tasky="lib.conflictInterActiveTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${interSvg}Inter</div>`;
    else if (hasInterPotential) conflictHtml += `<div class="tag-conflict tag-inter-conflict potential" data-tasky="lib.conflictInterPotentialTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${interSvg}Inter</div>`;

    if (conflictHtml) nameRow.insertAdjacentHTML('beforeend', conflictHtml);
  }
}

export function saveConflictCache() {
  try {
    localStorage.setItem('bmm_conflict_cache', JSON.stringify(S.conflictCache));
  } catch (e) {}
}

export function restoreConflictCache() {
  try {
    const cached = localStorage.getItem('bmm_conflict_cache');
    if (cached) S.conflictCache = JSON.parse(cached);
  } catch (e) { S.conflictCache = {}; }
}

export async function openGlobalConflictModal(preselectModId = null) {
  const modal = document.getElementById('modal-global-conflicts');
  const container = document.getElementById('global-conflicts-list');
  const searchInput = document.getElementById('global-conflict-search');
  const profileFilter = document.getElementById('global-conflict-profile-filter');
  const typeFilter = document.getElementById('global-conflict-type-filter');
  const statusFilter = document.getElementById('global-conflict-status-filter');
  const resetBtn = document.getElementById('global-conflict-reset');
  const legend = document.getElementById('global-conflict-legend');
  const legendClose = document.getElementById('global-conflict-legend-close');
  const legendShow = document.getElementById('global-conflict-legend-show');
  const closeBtn = document.getElementById('btn-close-global-conflicts');

  if (!modal || !container) return;

  try {
    const activeId = await invoke('get_active_profile_id').catch(() => null);
    if (!activeId) return toast(t('prof.noneActive'), 'error');

    modal.classList.add('open');
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><br>${t('conflict.loading') || 'Analyse des conflits...'}</div>`;

    let allConflicts = [];
    const allModsGlobal = await invoke('get_all_mods').catch(() => []);

    Object.keys(S.conflictCache).forEach(mid => {
       const reports = S.conflictCache[mid];
       if (reports && reports.length > 0) {
          const mod = allModsGlobal.find(m => m.id === mid);
          const modName = mod?.name || mid;
          const activationOrder = mod?.activation_order ?? -1;
          allConflicts.push({ sourceModId: mid, sourceModName: modName, reports, activationOrder });
       }
    });

    if (preselectModId) {
      const idx = allConflicts.findIndex(c => c.sourceModId === preselectModId);
      if (idx > -1) {
        const [target] = allConflicts.splice(idx, 1);
        allConflicts.unshift(target);
      }
    }

    const profiles = await invoke('get_profiles');
    profileFilter.innerHTML = `<option value="all">${t('conflict.allProfiles') || 'All profiles'}</option>` + profiles.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

    // Which cards are unfolded. Kept in the closure rather than in the markup, so changing
    // a filter re-renders the list without folding everything the user just opened.
    // Past four cards the list is a table of contents, so only one starts open.
    const openCards = new Set();
    let seeded = false;

    const renderList = (respectPrioritization = false) => {
      const q = searchInput.value.toLowerCase();
      const p = profileFilter.value;
      const tFilter = typeFilter.value;
      const sFilter = statusFilter ? statusFilter.value : 'all';

      // Sorted by what the panel is FOR, not by an axis the user has to choose.
      //
      // The control that used to sit here offered "oldest activation first" and "newest
      // first" — two arrangements of the source mods, neither of which answers the question
      // somebody opens this panel with. Activation order decides who wins a single overlap,
      // and it is already on every row that has one (#3); ordering the CARDS by it just
      // moved the urgent ones around. So: mods with a live conflict first, then the ones
      // with the most to look at, then alphabetically so the list stops moving.
      if (!respectPrioritization || !preselectModId) {
        allConflicts.sort((a, b) => {
           const liveA = a.reports.some(r => r.status === 'Active') ? 1 : 0;
           const liveB = b.reports.some(r => r.status === 'Active') ? 1 : 0;
           if (liveA !== liveB) return liveB - liveA;
           if (a.reports.length !== b.reports.length) return b.reports.length - a.reports.length;
           return a.sourceModName.localeCompare(b.sourceModName);
        });
      }

      let html = '';
      let totalActive = 0;
      let totalPotential = 0;
      const rendered = [];
      // Every mod that has a conflict at all, so "0 shown" can say whether the profile is
      // clean or the filters are simply hiding everything — two very different answers, and
      // the panel used to give the reassuring one for both.
      const totalModsWithConflicts = allConflicts.length;
      const anyFilterOn = !!q || p !== 'all' || tFilter !== 'all' || sFilter !== 'all';

      const survivors = [];
      allConflicts.forEach(item => {
        let filteredReports = item.reports;
        if (tFilter !== 'all') {
           filteredReports = filteredReports.filter(r => r.category.toLowerCase() === tFilter.toLowerCase());
        }
        if (p !== 'all') {
           const pName = profiles.find(pr => pr.id === p)?.name || '';
           filteredReports = filteredReports.filter(r => r.other_profile_name === pName);
        }
        if (sFilter !== 'all') {
           const want = sFilter === 'active' ? 'Active' : 'Potential';
           filteredReports = filteredReports.filter(r => r.status === want);
        }

        if (q) {
           const sourceMatch = item.sourceModName.toLowerCase().includes(q);
           if (!sourceMatch) {
              filteredReports = filteredReports.filter(r => r.other_mod_name.toLowerCase().includes(q));
           }
        }

        if (filteredReports.length === 0) return;
        survivors.push({ item, filteredReports });
      });

      // First draw decides what starts open; after that the user's own folding wins, so
      // changing a filter never re-folds a card they just opened.
      if (!seeded) {
        seeded = true;
        if (survivors.length <= 4) for (const sv of survivors) openCards.add(sv.item.sourceModId);
        else if (survivors.length) openCards.add(preselectModId && survivors.some(sv => sv.item.sourceModId === preselectModId)
          ? preselectModId : survivors[0].item.sourceModId);
      }

      survivors.forEach(({ item, filteredReports }) => {
        const activeCount = filteredReports.filter(r => r.status === 'Active').length;
        const potentialCount = filteredReports.filter(r => r.status === 'Potential').length;
        totalActive += activeCount;
        totalPotential += potentialCount;

        const hasIntra = filteredReports.some(r => r.category === 'Intra');
        const hasInter = filteredReports.some(r => r.category === 'Inter');

        // The same two badges the legend explains, so the legend is about THIS list rather
        // than about a similar-looking one.
        const typeBadges = [
          hasIntra ? `<span class="cflt-tag cflt-intra">INTRA</span>` : '',
          hasInter ? `<span class="cflt-tag cflt-inter">INTER</span>` : '',
        ].filter(Boolean).join('');

        const groups = {};
        filteredReports.forEach(r => {
           if (!groups[r.other_profile_name]) groups[r.other_profile_name] = [];
           groups[r.other_profile_name].push(r);
        });

        // The profile row is worth a line only when it TELLS you something. A card whose
        // conflicts are all Intra has exactly one target profile, and it is the mod's own —
        // the INTRA badge in the header already said that, so the sub-header was a second
        // copy of it above every list. Shown when there is more than one profile involved,
        // or when the conflict crosses profiles.
        const showProfileRows = Object.keys(groups).length > 1 || hasInter;
        // The same reasoning for the per-row ACTIVE/POTENTIAL pill: when a card is all one
        // status the header counts it once, and repeating it on every row is decoration
        // that costs a column. Kept when the card actually mixes the two.
        const mixedStatus = activeCount > 0 && potentialCount > 0;

        const targetsHtml = Object.keys(groups).map(pName => {
           const grps = groups[pName];
           grps.sort((a, b) => a.activation_order - b.activation_order);

           return `
             <div class="cflt-target-group">
               ${showProfileRows ? `<div class="cflt-target-head">
                 <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                 <span class="cflt-target-name">${escHtml(pName)}</span>
                 <span class="cflt-target-count">${grps.length} ${grps.length > 1 ? (t('conflict.conflicts')||'conflicts') : (t('conflict.conflict')||'conflict')}</span>
               </div>` : ''}
               <div class="cflt-target-rows">
                 ${grps.map(r => {
                   const isActive = r.status === 'Active';
                   const statusColor = isActive ? 'var(--danger)' : 'var(--warning)';
                   const statusBg = isActive ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)';
                   return `
                   <div class="cflt-row" style="background:${statusBg};border-left:2px solid ${statusColor}">
                     <span style="font-size:11.5px;font-weight:600;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help"
                           data-tooltip="${escAttr(r.other_mod_name)}"
                           data-tasky="${escAttr(escJs(r.other_mod_name))}" data-tasky-icon="package" data-tasky-literal="1"
                          >${escHtml(r.other_mod_name)}</span>
                     ${isActive ? `<span style="font-size:10px;background:rgba(255,255,255,0.08);color:var(--text-secondary);padding:1px 6px;border-radius:4px;font-family:var(--font-mono);flex-shrink:0" data-tooltip="${t('conflict.activationOrder')||'Activation order'}">#${r.activation_order}</span>` : ''}
                     <button class="cflt-files-btn" ${actAttrs('showConflictContextMenu', item.sourceModId, r.other_mod_id)} data-act-with="event"
                             data-tooltip="${escAttr(t('conflict.filesTip') || 'See which files overlap, and choose which mod wins')}">
                       <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                       <span>${r.file_count} ${t('conflict.files') || 'files'}</span>
                       <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="cflt-files-chev"><polyline points="9 18 15 12 9 6"/></svg>
                     </button>
                     ${mixedStatus ? `<span class="cflt-row-status" style="color:${statusColor};border-color:${statusColor};background:${statusBg}">${isActive ? (t('conflict.active')||'ACTIVE') : (t('conflict.potential')||'POTENTIAL')}</span>` : ''}
                   </div>`;
                 }).join('')}
               </div>
             </div>
           `;
        }).join('');

        // Collapsed by default past a handful, because the panel's job is "which of my mods
        // are in trouble" — and eight expanded cards answer a question nobody asked before
        // showing the one they did. The header is a real <button>: the whole strip is the
        // target, not a chevron somebody has to aim at.
        const open = openCards.has(item.sourceModId);
        rendered.push(`
          <div class="conflict-group-card cflt-card${open ? ' is-open' : ''}" data-cflt-card="${escAttr(item.sourceModId)}">
             <button type="button" class="cflt-card-head" aria-expanded="${open ? 'true' : 'false'}"
                     data-cflt-toggle="${escAttr(item.sourceModId)}">
               <svg class="cflt-card-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="9 18 15 12 9 6"/></svg>
               <span class="cflt-card-dot" style="background:${activeCount > 0 ? 'var(--danger)' : 'var(--warning)'};box-shadow:0 0 6px ${activeCount > 0 ? 'var(--danger)' : 'var(--warning)'}"></span>
               <span class="cflt-card-name"
                     data-tooltip="${escAttr(item.sourceModName)}"
                     data-tasky="${escAttr(escJs(item.sourceModName))}" data-tasky-icon="package" data-tasky-literal="1"
                    >${escHtml(item.sourceModName)}</span>
               ${typeBadges}
               ${activeCount > 0 ? `<span class="cflt-count cflt-count-active">${activeCount} ${t('conflict.active')||'ACTIVE'}</span>` : ''}
               ${potentialCount > 0 ? `<span class="cflt-count cflt-count-potential">${potentialCount} ${t('conflict.potential')||'POTENTIAL'}</span>` : ''}
             </button>
             <div class="cflt-card-body">
               ${targetsHtml}
             </div>
          </div>
        `);
      });

      if (rendered.length > 0) {
        // One control for the whole list, because folding eight cards one at a time to see
        // the shape of the problem is the sort of thing a panel should do for you.
        const allOpen = rendered.length > 0 && survivors.every(sv => openCards.has(sv.item.sourceModId));
        const summaryBar = `<div class="cflt-summary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${totalActive > 0 ? 'var(--danger)' : 'var(--warning)'}" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <span class="cflt-summary-main">${rendered.length} ${t('conflict.modsInConflict')||'mods in conflict'}</span>
          ${totalActive > 0 ? `<span class="cflt-summary-active">— ${totalActive} ${t('conflict.active')||'active'}</span>` : ''}
          ${totalPotential > 0 ? `<span class="cflt-summary-potential">— ${totalPotential} ${t('conflict.potential')||'potential'}</span>` : ''}
          <button type="button" class="cflt-linkbtn cflt-foldall" id="cflt-fold-all">${escHtml(allOpen
            ? (t('conflict.collapseAll') || 'Collapse all')
            : (t('conflict.expandAll') || 'Expand all'))}</button>
        </div>`;
        const hidden = totalModsWithConflicts - rendered.length;
        const filterNote = hidden > 0
          ? `<div class="cflt-hidden-note">${escHtml((t('conflict.hiddenNote') || '{n} more mod(s) have conflicts, hidden by the filters above.').replace('{n}', String(hidden)))}
               <button class="cflt-linkbtn" id="cflt-note-reset">${escHtml(t('conflict.reset') || 'Show everything')}</button></div>`
          : '';
        container.innerHTML = summaryBar + filterNote + rendered.join('');
        container.querySelector('#cflt-note-reset')?.addEventListener('click', () => resetFilters());
        container.querySelector('#cflt-fold-all')?.addEventListener('click', () => {
          if (allOpen) openCards.clear();
          else for (const sv of survivors) openCards.add(sv.item.sourceModId);
          renderList(respectPrioritization);
        });
      } else {
        // "No conflicts" and "your filters hid all of them" look identical and mean opposite
        // things. Saying the reassuring one while four filters are on is the panel lying.
        const hiddenByFilters = anyFilterOn && totalModsWithConflicts > 0;
        container.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text-muted)">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.25;margin-bottom:12px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <div>${hiddenByFilters
            ? escHtml((t('conflict.allFiltered') || 'Nothing matches these filters — {n} mod(s) do have conflicts.').replace('{n}', String(totalModsWithConflicts)))
            : escHtml(t('conflict.empty') || 'No conflicts detected.')}</div>
          ${hiddenByFilters ? `<button class="btn btn-sm btn-secondary" id="cflt-empty-reset" style="margin-top:14px">${escHtml(t('conflict.reset') || 'Show everything')}</button>` : ''}
        </div>`;
        container.querySelector('#cflt-empty-reset')?.addEventListener('click', () => resetFilters());
      }
    };

    const resetFilters = () => {
      searchInput.value = '';
      profileFilter.value = 'all';
      typeFilter.value = 'all';
      if (statusFilter) statusFilter.value = 'all';
      renderList(false);
    };

    // One delegated handler, assigned rather than added: this modal is opened again and
    // again from several places, and addEventListener would stack a fresh copy each time
    // until one click toggled a card five times.
    container.onclick = (ev) => {
      const head = (ev.target as HTMLElement)?.closest?.('[data-cflt-toggle]') as HTMLElement | null;
      if (!head || !container.contains(head)) return;
      const id = head.dataset.cfltToggle || '';
      const card = head.closest('.cflt-card') as HTMLElement | null;
      if (!card) return;
      const nowOpen = !card.classList.contains('is-open');
      // Toggled in place, not re-rendered: a re-render would scroll the list back to the
      // top, which is exactly where the card you just folded is not.
      card.classList.toggle('is-open', nowOpen);
      head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      if (nowOpen) openCards.add(id); else openCards.delete(id);
      const fold = container.querySelector('#cflt-fold-all');
      if (fold) fold.textContent = container.querySelector('.cflt-card:not(.is-open)')
        ? (t('conflict.expandAll') || 'Expand all')
        : (t('conflict.collapseAll') || 'Collapse all');
    };

    // The legend is a tip: it earns its space the first time and then sits above the list
    // for ever. Same helper the mapper and the server-repo banners use, so "put it away and
    // get it back" behaves identically in all three.
    if (legend && legendClose && legendShow) {
      wireDismissibleTip({
        bannerId: 'global-conflict-legend',
        closeId: 'global-conflict-legend-close',
        showId: 'global-conflict-legend-show',
        storageKey: 'bmm_tip_conflict_legend',
      });
    }

    renderList(true);
    resetBtn?.addEventListener('click', resetFilters);
    if (statusFilter) statusFilter.onchange = () => renderList(false);
    searchInput.oninput = () => renderList(false);
    profileFilter.onchange = () => renderList(false);
    typeFilter.onchange = () => renderList(false);

    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('open');

    if (preselectModId) {
      setTimeout(() => {
        searchInput.value = S.allMods.find(m => m.id === preselectModId)?.name || '';
        renderList(true);
      }, 100);
    }
  } catch (err) {
    container.innerHTML = '<div style="color:var(--danger)">'+err+'</div>';
  }
}

window.openGlobalConflictModal = openGlobalConflictModal;

/**
 * Clicking a conflict opens the file list.
 *
 * It used to open a one-item menu — "View conflicting files" — whose only button did this.
 * A menu with one entry is a second click charged for nothing: it cannot be a choice, and
 * the thing it leads to is the thing that was clicked. The entry point keeps its name
 * because several call sites and `actAttrs` refer to it.
 */
export function showConflictContextMenu(e, mod1Id, mod2Id) {
  e.preventDefault();
  // Any menu left open from before this changed — and the one the markup still carries for
  // other callers — must not stay on screen behind the modal.
  const ctx = document.getElementById('conflict-context-menu');
  if (ctx) ctx.style.display = 'none';
  return openConflictTree(mod1Id, mod2Id);
}

/** The shared-files list for one pair of mods. */
export async function openConflictTree(mod1Id, mod2Id) {
  {
    const modal = document.getElementById('modal-conflict-tree');
    const container = document.getElementById('conflict-tree-container');
    const btnConfirm = document.getElementById('btn-confirm-conflict-tree');
    if (btnConfirm) btnConfirm.style.display = 'none';

    modal.style.zIndex = '10005';
    modal.classList.add('open');
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">${t('conflict.loadingTree')||"Chargement de l'arbre..."}</div>`;

    try {
      // The command now returns { files, total, truncated } and caps the list: two mods can
      // share tens of thousands of paths, and this view builds one DOM row per entry, so an
      // uncapped answer cost a huge payload, a huge HTML string and thousands of nodes at once.
      const tree = await invoke('get_conflict_file_tree', { modId: mod1Id, otherModId: mod2Id });
      const files = Array.isArray(tree) ? tree : (tree?.files || []);          // tolerate the old shape
      const total = Array.isArray(tree) ? tree.length : (tree?.total ?? files.length);
      const truncated = Array.isArray(tree) ? false : !!tree?.truncated;
      if (files.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">${t('conflict.noTreeFiles')}</div>`;
        return;
      }
      // Who is actually involved, and who currently wins.
      //
      // The modal used to be a list of paths and the sentence "Last activated mod wins",
      // which states the RULE without saying who that is here. The two questions somebody
      // opens this to answer are "between which mods" and "so which file am I getting", and
      // neither was on screen.
      const all = await invoke('get_all_mods').catch(() => []);
      const byId = new Map((all || []).map((m) => [m.id, m]));
      const a = byId.get(mod1Id);
      const b = byId.get(mod2Id);
      const nameOf = (id, m) => (m?.name || id);
      // Who wins, for real.
      //
      // This used to say "BMM cannot tell which from here" when both were on. That was true
      // while the deployment order was invisible — it is `Profile.active_mods`, last wins,
      // and nothing surfaced it. mod_order_get does, so the sentence became a lie the moment
      // it existed and is gone.
      const bothOn = !!a?.enabled && !!b?.enabled;
      let order: string[] = [];
      if (bothOn) {
          try {
              const [ordered] = await invoke('mod_order_get', { profileId: null }) as [{ id: string }[], unknown];
              order = (ordered || []).map((m) => m.id);
          } catch { order = []; }
      }
      const iA = order.indexOf(mod1Id);
      const iB = order.indexOf(mod2Id);
      const known = bothOn && iA >= 0 && iB >= 0;
      const winner = bothOn
          ? (known ? (iA > iB ? a : b) : null)
          : (a?.enabled ? a : (b?.enabled ? b : null));
      const loserId = known ? (iA > iB ? mod2Id : mod1Id) : null;

      const chip = (m, id) => `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;
            background:${m?.enabled ? 'var(--success-dim, rgba(34,197,94,.15))' : 'var(--bmm-s06)'};
            font-size:10.5px;font-weight:600;color:var(--text-primary);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <span style="width:6px;height:6px;border-radius:50%;flex:none;background:${m?.enabled ? 'var(--success)' : 'var(--text-muted)'}"></span>
          ${escHtml(nameOf(id, m))}</span>`;

      const summary = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          ${chip(a, mod1Id)}
          <span style="font-size:11px;color:var(--text-muted)">\u2194</span>
          ${chip(b, mod2Id)}
          <span style="margin-left:auto;font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono)">
            ${total} ${escHtml(t('conflict.sharedCount') || 'shared')}</span>
        </div>
        <div style="font-size:11px;color:${winner ? 'var(--text-secondary)' : 'var(--warning)'};margin-bottom:10px;line-height:1.5">
          ${winner
            ? escHtml((t('conflict.currentlyWins') || '{m} is active, so its version of these files is the one on disk.')
                .replace('{m}', nameOf(winner.id, winner)))
            : (bothOn
                ? escHtml(t('conflict.bothOnUnknown'))
                : escHtml(t('conflict.noneOn') || 'Neither is active, so none of these files is currently installed.'))}
        </div>
        ${loserId
            // Offered only when both are on and the order is known: with one of them off there
            // is nothing to swap, and the honest fix is to enable it.
            ? `<div style="margin-bottom:12px"><button type="button" class="btn btn-sm btn-secondary" id="conf-flip">
                   ${escHtml(t('conflict.makeWin').replace('{m}', nameOf(loserId, byId.get(loserId))))}
               </button>
               <p style="font-size:10.5px;color:var(--text-muted);margin:6px 2px 0;line-height:1.45">${escHtml(t('conflict.makeWinHint'))}</p></div>`
            : ''}`;

      container.innerHTML = summary + files.map(f => {
        const base = String(f).replace(/^.*[/\\]/, '');
        const dir = String(f).slice(0, String(f).length - base.length).replace(/[/\\]$/, '');
        return `<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);line-height:1.4;min-height:24px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:all 0.15s ease;border-radius:6px;margin-bottom:2px"
           data-hover="background:rgba(59,130,246,0.15);border-left:2px solid var(--accent)"
           data-hover-out="background:transparent;border-left:none"
           ${actAttrs('showFileConflictSelector', f, mod1Id, mod2Id)} data-act-with="event"
           data-tooltip="${escAttr(f)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--accent)"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--text-primary)">${escHtml(base)}</span>
          ${dir ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;color:var(--text-muted)">${escHtml(dir)}</span>` : ''}
        </span>
      </div>`;
      }).join('');
      container.querySelector('#conf-flip')?.addEventListener('click', async () => {
          if (!loserId) return;
          try {
              // Moving the loser to the END is the whole change: last wins, so the deployment
              // order IS the answer. Everything that shares a file with it follows, which is
              // what somebody asking for this actually wants — not just this one pair.
              const next = [...order.filter((id) => id !== loserId), loserId];
              const moved = await invoke('mod_order_set', { profileId: null, order: next }) as number;
              toast(t('conflict.flipped').replace('{n}', String(moved)), 'success', 7000);
              await openConflictTree(mod1Id, mod2Id);
          } catch (e) { toast(String(e), 'error', 9000); }
      });

      // Say so when the list was cut, rather than silently implying these are all of them.
      if (truncated) {
        container.innerHTML += `<div style="padding:10px;text-align:center;font-size:11px;color:var(--text-muted)">`
          + (t('conflict.treeTruncated') || 'Showing the first {n} of {total} shared files.')
              .replace('{n}', String(files.length)).replace('{total}', String(total))
          + `</div>`;
      }
    } catch (err) {
      container.innerHTML = `<span style="color:var(--danger)">${t('common.error')||"Error"}: ${err}</span>`;
    }
  }
}
window.showConflictContextMenu = showConflictContextMenu;

let fileConflictSelectorState = {
  currentFile: '',
  modIds: [],
  selectedMods: new Set()
};

export async function showFileConflictSelectorAsync(e, filePath, mod1Id, mod2Id) {
  e.preventDefault();
  const modal = document.getElementById('modal-conflict-file-selector');
  const nameLabel = document.getElementById('conflict-file-selector-name');
  const list = document.getElementById('conflict-file-selector-list');
  const openBtn = document.getElementById('btn-open-conflict-files');
  const cancelBtn = document.getElementById('btn-cancel-conflict-file-selector');
  const closeBtn = document.getElementById('btn-close-conflict-file-selector');

  if (!modal) return;

  fileConflictSelectorState = {
    currentFile: filePath,
    modIds: [mod1Id, mod2Id],
    selectedMods: new Set()
  };

  nameLabel.textContent = filePath;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Chargement...</div>';

  const allModsGlobal = await invoke('get_all_mods').catch(() => []);
  const modsByIdMap = new Map(allModsGlobal.map(m => [m.id, m]));

  list.innerHTML = [mod1Id, mod2Id].map(modId => {
    const mod = modsByIdMap.get(modId);
    const modName = mod?.name || modId;
    const checkboxId = `conflict-mod-checkbox-${modId}`;

    return `
      <label style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;border:1.5px solid rgba(255,255,255,0.1);transition:all 0.15s ease"
           data-hover="background:rgba(59,130,246,0.1);border-color:rgba(59,130,246,0.3);box-shadow:0 0 0 1px rgba(59,130,246,0.2)"
           data-hover-out="background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.1);box-shadow:none">
        <input type="checkbox" id="${checkboxId}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--accent);flex-shrink:0" data-act-change="toggleModSelector" data-act-change-args='["${modId}"]'>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(modName)}</div>
          <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-top:2px">${escHtml(modId)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--accent);opacity:0.6">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </label>
    `;
  }).join('');

  cancelBtn.onclick = () => modal.classList.remove('open');
  closeBtn.onclick = () => modal.classList.remove('open');

  openBtn.onclick = async () => {
    if (fileConflictSelectorState.selectedMods.size === 0) {
      toast(t('common.selectOneMod') || 'Select at least one mod', 'warning');
      return;
    }

    modal.classList.remove('open');

    for (const modId of fileConflictSelectorState.selectedMods) {
      try {
        await invoke('open_mod_folder_at', { modId, relativePath: filePath });
      } catch (err) {
        toast(t('toast.openError', { id: modId, err: String(err) }) || `Error opening ${modId}: ${err}`, 'error');
      }
    }
  };

  modal.classList.add('open');
}

export function showFileConflictSelector(e, filePath, mod1Id, mod2Id) {
  showFileConflictSelectorAsync(e, filePath, mod1Id, mod2Id).catch(err => {
    console.error('Erreur sélecteur conflit:', err);
    toast((t('common.error') || 'Error') + ': ' + err, 'error');
  });
}
window.showFileConflictSelector = showFileConflictSelector;

export function toggleModSelector(modId) {
  if (fileConflictSelectorState.selectedMods.has(modId)) {
    fileConflictSelectorState.selectedMods.delete(modId);
  } else {
    fileConflictSelectorState.selectedMods.add(modId);
  }
}
window.toggleModSelector = toggleModSelector;

export function showActivationWarning(modId, conflicts, onConfirm) {
  const modal = document.getElementById('modal-activation-warning');
  const list = document.getElementById('activation-warning-list');
  const btn = document.getElementById('btn-confirm-activation-anyway');
  const cancelBtn = document.getElementById('btn-cancel-activation-warning');
  const orderPanel = document.getElementById('activation-order-panel');
  const orderList = document.getElementById('activation-order-list');

  if (!modal) return;

  list.innerHTML = conflicts.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:6px;border-left:3px solid ${c.status === 'Active' ? 'var(--danger)' : 'var(--warning)'}">
      <div style="flex:1;min-width:0;padding-right:10px">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-tooltip="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</div>
        <div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.other_profile_name)}</div>
      </div>
      <div style="font-size:10px;font-weight:900;padding:2px 6px;border-radius:12px;color:${c.status==='Active'?'var(--danger)':'var(--warning)'};border:1px solid ${c.status==='Active'?'var(--danger)':'var(--warning)'};flex-shrink:0">
        ${c.status === 'Active' ? (t('conflict.active')||'ACTIF') : (t('conflict.potential')||'POTENTIEL')}
      </div>
    </div>
  `).join('');

  const activeConflicts = conflicts.filter(c => c.status === 'Active');
  if (activeConflicts.length > 0) {
    activeConflicts.sort((a, b) => a.activation_order - b.activation_order);
    orderList.innerHTML = activeConflicts.map(c => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04)">
        <span style="font-size:10px;background:rgba(255,255,255,0.12);color:var(--text-primary);padding:1px 6px;border-radius:4px;font-weight:700;flex-shrink:0">#${c.activation_order}</span>
        <span style="font-size:11px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-tooltip="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</span>
        <span style="font-size:9px;color:var(--text-muted);flex-shrink:0">${escHtml(c.other_profile_name)}</span>
      </div>
    `).join('');
    orderPanel.style.display = '';
  } else {
    orderPanel.style.display = 'none';
  }

  btn.onclick = () => {
    modal.classList.remove('open');
    onConfirm();
  };
  if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove('open');
  modal.classList.add('open');
}
window.showActivationWarning = showActivationWarning;
