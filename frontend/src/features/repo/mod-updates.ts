// @ts-nocheck
// ── Mod update system — client UI ────────────────────────────────────────────
// Calls the `check_mod_updates` backend command (which compares every installed
// mod against the repo(s) it is linked to — its origin repo, any per-mod
// configured repos, and the global update repos) and surfaces the results.
//
//   • Manual / auto check  → `checkModUpdates()`
//   • Per-mod config modal  → `openModUpdateConfig(modId)` (also on window)
//   • Library badge state   → `window.__bmmModUpdates` (Map<modId, info>)
//
// Applying an update re-uses the existing `bmm:repo-focus` → connect path, which
// delta-syncs only the changed files.

import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { appState } from '../../core/state.js';

let _checking = false;
let _autoTimer: any = null;
let _lastUpdates: any[] = [];
let _lastErrors: any[] = [];

// ── Global update-repos setting (localStorage) ───────────────────────────────

export function getGlobalUpdateRepos(): string[] {
    try {
        const raw = localStorage.getItem('bmm_update_repos');
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : [];
    } catch { return []; }
}

export function setGlobalUpdateRepos(repos: string[]): void {
    try { localStorage.setItem('bmm_update_repos', JSON.stringify(repos.filter(s => s && s.trim()))); } catch {}
}

// ── Badge state shared with the library cards ────────────────────────────────

function setUpdateState(updates: any[]): void {
    const map = new Map<string, any>();
    for (const u of updates) map.set(u.mod_id, u);
    (window as any).__bmmModUpdates = map;
    // Repaint the library so the "update available" tags appear/disappear.
    import('../mods/mods-list.js').then(m => m.renderModList?.(true)).catch(() => {});
}

/** True if a given mod currently has a detected update. */
export function modHasUpdate(modId: string): boolean {
    const map = (window as any).__bmmModUpdates as Map<string, any> | undefined;
    return !!(map && map.has(modId));
}

// ── Check ─────────────────────────────────────────────────────────────────────

/** Run a check; returns the raw `{ updates, errors, checked }` result. */
export async function fetchModUpdates(): Promise<{ updates: any[]; errors: any[]; checked: number; baselined: string[]; directSources: any[] }> {
    const res = await invoke('check_mod_updates', { globalRepos: getGlobalUpdateRepos() });
    return {
        updates: Array.isArray(res?.updates) ? res.updates : [],
        errors: Array.isArray(res?.errors) ? res.errors : [],
        checked: typeof res?.checked === 'number' ? res.checked : 0,
        baselined: Array.isArray(res?.baselined) ? res.baselined : [],
        directSources: Array.isArray(res?.direct_sources) ? res.direct_sources : [],
    };
}

/** All update-source URLs configured on a mod (for matching against check errors). */
function modSourceUrls(mod: any): string[] {
    const out: string[] = [];
    if (mod?.source_repo) out.push(String(mod.source_repo));
    if (mod?.update_url) out.push(String(mod.update_url));
    if (mod?.direct_url) out.push(String(mod.direct_url));
    if (Array.isArray(mod?.update_sources)) for (const s of mod.update_sources) if (s?.repo_url) out.push(String(s.repo_url));
    return out.map(u => u.trim()).filter(Boolean);
}

/**
 * Trigger an update check.
 * @param silent when true, suppresses the "no updates" toast and only opens the
 *   modal if something is found. Returns the number of updates found.
 */
export async function checkModUpdates(silent = false): Promise<number> {
    if (_checking) return 0;
    _checking = true;
    const btn = document.getElementById('btn-check-mod-updates') as HTMLButtonElement | null;
    const hint = document.getElementById('mod-updates-hint');
    if (btn && !silent) btn.disabled = true;
    if (hint && !silent) hint.textContent = t('repo.checkingUpdates') || 'Checking…';
    try {
        const { updates, errors, checked, baselined } = await fetchModUpdates();
        _lastUpdates = updates; _lastErrors = errors;
        setUpdateState(updates);
        updateBadge(updates.length);
        // No mod is linked to any repo → don't pretend "up to date".
        const noneLinked = checked === 0;
        if (hint && !silent) {
            hint.textContent = noneLinked
                ? (t('repo.updatesNoneLinked') || 'No mods are linked to a repo yet')
                : (updates.length
                    ? (t('repo.updatesFound', { count: updates.length }) || `${updates.length} update(s) available`)
                    : (t('repo.updatesNone') || 'Everything is up to date'));
        }
        if (updates.length === 0 && errors.length === 0) {
            if (!silent) {
                if (noneLinked) {
                    toast(t('repo.updatesNoneLinkedHint') || 'No mods are linked to a repo. Use "Configure updates" on a mod, or add a global update repo in Settings.', 'info');
                } else if (baselined.length) {
                    // First time we saw these direct downloads — baseline recorded,
                    // nothing to compare yet. Be honest rather than say "up to date".
                    toast(t('repo.updatesBaselined', { count: baselined.length })
                        || `Now tracking ${baselined.length} direct download(s) — re-check later to detect changes.`, 'info');
                } else {
                    toast(t('repo.updatesNone') || 'Everything is up to date', 'success');
                }
            }
            return 0;
        }
        // Surface unreachable repos clearly (the user asked for a real error here).
        if (errors.length && !silent) {
            toast((t('repo.updatesRepoErrors', { count: errors.length })
                || `${errors.length} repo(s) could not be reached`), 'warning');
        }
        if (updates.length > 0 || (!silent && errors.length > 0)) openUpdatesModal(updates, errors);
        return updates.length;
    } catch (e) {
        if (!silent) {
            toast((t('repo.updatesCheckFailed') || 'Update check failed') + ': ' + e, 'error');
            if (hint) hint.textContent = '';
        }
        return 0;
    } finally {
        _checking = false;
        if (btn) btn.disabled = false;
    }
}

/** Small green count badge on the check button. */
function updateBadge(count: number): void {
    const btn = document.getElementById('btn-check-mod-updates');
    if (!btn) return;
    let badge = btn.querySelector('.mod-updates-badge') as HTMLElement | null;
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'mod-updates-badge';
            badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:100px;background:#2ecc71;color:#04210f;font-size:10px;font-weight:800;margin-left:2px;';
            btn.appendChild(badge);
        }
        badge.textContent = String(count);
    } else if (badge) {
        badge.remove();
    }
}

// ── Updates modal ────────────────────────────────────────────────────────────

// Use the app's standard modal chrome (.modal-overlay + .modal glass) verbatim —
// identical backdrop, blur, shadow, animation and z-index to e.g. the "New
// profile" modal. No custom inline overlay styling.
// Mount overlays inside #app-window-outer (like every static modal) rather than
// document.body — a body-level overlay sits in a different stacking/event context
// than the rest of the modals, which caused click-through to the page behind.
function overlayHost(): HTMLElement { return document.getElementById('app-window-outer') || document.body; }

function ensureOverlay(id: string): HTMLElement {
    let ov = document.getElementById(id);
    if (ov) { ov.className = 'modal-overlay'; ov.removeAttribute('style'); return ov; }
    ov = document.createElement('div');
    ov.id = id;
    ov.className = 'modal-overlay';
    ov.addEventListener('click', (e) => { if (e.target === ov) (ov as HTMLElement).classList.remove('open'); });
    overlayHost().appendChild(ov);
    return ov;
}

// Show via the standard `.open` class (CSS handles display:flex + fadeIn).
function openOverlay(ov: HTMLElement): void { overlayHost().appendChild(ov); ov.classList.add('open'); }
function hideOverlay(ov: HTMLElement | null): void { if (ov) ov.classList.remove('open'); }

export function closeUpdatesModal(): void {
    hideOverlay(document.getElementById('mod-updates-overlay'));
}

function openUpdatesModal(updates: any[], errors: any[] = [], reDownloadSources: any[] = []): void {
    const ov = ensureOverlay('mod-updates-overlay');

    // Direct-download updates apply via a one-click re-download, not the repo
    // sync flow, so they are rendered in their own blocks.
    const directUpdates = updates.filter(u => u.direct);
    const repoUpdates = updates.filter(u => !u.direct);
    // Neutral "re-download available" blocks for direct sources with no detected
    // change — a direct download has no version, so it's always re-downloadable.
    const reDownloadBlocks = reDownloadSources.map(s => `
        <div class="mod-updates-repo-block" style="background:var(--bmm-s03,rgba(255,255,255,0.03));border:1px solid var(--bmm-s06,rgba(255,255,255,0.06));border-radius:10px;padding:12px 14px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div style="min-width:0;">
                    <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${escHtml(s.name || '')}</div>
                    <div style="font-size:11.5px;color:var(--text-secondary);margin-top:3px;">${t('repo.directNoChange') || 'No change detected since last download'}${s.detail ? ` · <span style="color:var(--text-primary);">${escHtml(s.detail)}</span>` : ''}</div>
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted);margin-top:8px;">${t('repo.directFrom') || 'Direct download'}</div>
                    <div style="font-size:11px;color:var(--text-secondary);word-break:break-all;">${escHtml(s.url || '')}</div>
                </div>
                <button class="btn btn-secondary btn-sm mod-direct-apply" data-mod-id="${escAttr(s.mod_id)}" data-url="${escAttr(s.url || '')}"
                    style="flex-shrink:0;height:30px;padding:0 14px;font-size:12px;font-weight:700;">${t('repo.directUpdateBtn') || 'Re-download'}</button>
            </div>
        </div>`).join('');

    // Group repo updates by origin repo so the user can update a whole repo at once.
    const byRepo = new Map<string, any[]>();
    for (const u of repoUpdates) {
        if (!byRepo.has(u.repo_url)) byRepo.set(u.repo_url, []);
        byRepo.get(u.repo_url)!.push(u);
    }

    const repoBlocks = [...byRepo.entries()].map(([repoUrl, mods]) => {
        const rows = mods.map(m => `
            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid var(--bmm-s06,rgba(255,255,255,0.06));cursor:pointer;">
                <input type="checkbox" class="mod-update-cb" data-repo-url="${escAttr(repoUrl)}" data-mod-id="${escAttr(m.mod_id)}" checked style="margin-top:3px;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${escHtml(m.name)}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                        <span style="opacity:0.8;">${escHtml(m.current_version)}</span>
                        <span style="margin:0 5px;">→</span>
                        <span style="color:#2ecc71;font-weight:700;">${escHtml(m.new_version)}</span>
                    </div>
                    ${m.changelog ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;white-space:pre-wrap;line-height:1.45;background:var(--bmm-s04,rgba(255,255,255,0.04));padding:6px 8px;border-radius:5px;">${escHtml(m.changelog)}</div>` : ''}
                </div>
            </label>`).join('');
        return `
            <div class="mod-updates-repo-block" data-repo-url="${escAttr(repoUrl)}" style="background:var(--bmm-s03,rgba(255,255,255,0.03));border:1px solid var(--bmm-s06,rgba(255,255,255,0.06));border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                    <div style="min-width:0;">
                        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted);">${t('repo.updateFromRepo') || 'From repository'}</div>
                        <div style="font-size:12px;color:var(--text-secondary);word-break:break-all;">${escHtml(repoUrl)}</div>
                    </div>
                    <button class="btn btn-primary btn-sm mod-updates-apply" data-repo-url="${escAttr(repoUrl)}"
                        style="flex-shrink:0;display:flex;align-items:center;gap:6px;padding:0 14px;height:30px;font-size:12px;font-weight:700;">
                        <span class="mua-label">${t('repo.updateApply', { count: mods.length }) || `Update ${mods.length} mod(s)`}</span>
                    </button>
                </div>
                ${rows}
            </div>`;
    }).join('');

    const directBlocks = directUpdates.map(m => `
        <div class="mod-updates-repo-block" style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.28);border-radius:10px;padding:12px 14px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div style="min-width:0;">
                    <div style="display:flex;align-items:center;gap:7px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.4" style="flex-shrink:0;"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
                        <span style="font-weight:700;font-size:12.5px;color:#f59e0b;">${t('repo.directMaybe') || 'BMM may have detected an update'}</span>
                    </div>
                    <div style="font-weight:600;font-size:13px;color:var(--text-primary);margin-top:5px;">${escHtml(m.name)}</div>
                    ${m.detail ? `<div style="font-size:11.5px;color:var(--text-secondary);margin-top:4px;">${t('repo.directDetected') || 'Detected'}: <span style="color:var(--text-primary);font-weight:600;">${escHtml(m.detail)}</span></div>` : ''}
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted);margin-top:8px;">${t('repo.directFrom') || 'Direct download'}</div>
                    <div style="font-size:11px;color:var(--text-secondary);word-break:break-all;">${escHtml(m.repo_url)}</div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:6px;line-height:1.4;">${t('repo.directMaybeHint') || 'A direct download has no version number — BMM only knows the file changed. Re-download if you want the latest.'}</div>
                </div>
                <button class="btn btn-primary btn-sm mod-direct-apply" data-mod-id="${escAttr(m.mod_id)}" data-url="${escAttr(m.repo_url || '')}"
                    style="flex-shrink:0;height:30px;padding:0 14px;font-size:12px;font-weight:700;">${t('repo.directUpdateBtn') || 'Re-download'}</button>
            </div>
        </div>`).join('');

    const errorBlock = errors.length ? `
        <div style="background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
            <div style="font-size:11px;font-weight:700;color:#e74c3c;margin-bottom:6px;">${t('repo.updatesRepoErrorsTitle') || 'Some repos could not be reached'}</div>
            ${errors.map(e => `<div style="font-size:11px;color:var(--text-secondary);word-break:break-all;margin:2px 0;">• ${escHtml(e.repo_url)} <span style="color:var(--text-muted);">— ${escHtml(String(e.error || '').slice(0, 120))}</span></div>`).join('')}
        </div>` : '';

    const emptyMsg = (updates.length === 0 && reDownloadSources.length === 0)
        ? `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">${t('repo.updatesNone') || 'Everything is up to date'}</div>`
        : '';
    // When the modal only shows re-downloadable (unchanged) direct sources, lead
    // with an explanatory note instead of the repo-update blurb.
    const reDownloadNote = (updates.length === 0 && reDownloadSources.length > 0)
        ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 14px;line-height:1.5;">${t('repo.directReDownloadDesc') || 'No update detected. A direct download has no version, so BMM cannot tell if it is newer than what you have — but you can re-download it anytime.'}</p>`
        : '';

    ov.innerHTML = `
        <div class="modal glass" style="width:min(620px,92vw);max-width:620px;overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--bmm-s06,rgba(255,255,255,0.06));">
                <div style="display:flex;align-items:center;gap:10px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                    <span style="font-size:15px;font-weight:700;color:var(--text-primary);">${updates.length === 0 && reDownloadSources.length > 0 ? (t('repo.directReDownloadTitle') || 'Direct download') : (t('repo.updatesTitle') || 'Mod updates available')}</span>
                    ${updates.length > 0 ? `<span style="font-size:11px;font-weight:700;color:#2ecc71;background:rgba(46,204,113,0.14);padding:2px 8px;border-radius:100px;">${updates.length}</span>` : ''}
                </div>
                <button id="mod-updates-close" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;background:transparent;border:none;border-radius:6px;cursor:pointer;color:var(--text-secondary);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div style="padding:16px 18px;overflow-y:auto;flex:1 1 auto;min-height:0;">
                ${updates.length > 0 ? `<p style="font-size:12px;color:var(--text-muted);margin:0 0 14px;line-height:1.5;">${t('repo.updatesDesc') || 'These installed mods have a newer version in a repository they are linked to. Updating re-syncs only the changed files.'}</p>` : ''}
                ${reDownloadNote}
                ${errorBlock}
                ${directBlocks}
                ${repoBlocks}
                ${reDownloadBlocks}
                ${emptyMsg}
            </div>
        </div>`;

    ov.querySelector('#mod-updates-close')?.addEventListener('click', closeUpdatesModal);

    // Per-repo apply button reflects how many mods are checked in that block, and
    // is disabled when none are selected — so the user chooses exactly what updates.
    const refreshRepoBtn = (repoUrl: string) => {
        const block = ov.querySelector(`.mod-updates-repo-block[data-repo-url="${CSS.escape(repoUrl)}"]`);
        if (!block) return;
        const n = block.querySelectorAll('.mod-update-cb:checked').length;
        const btn = block.querySelector('.mod-updates-apply') as HTMLButtonElement | null;
        const label = block.querySelector('.mua-label');
        if (label) label.textContent = t('repo.updateApply', { count: n }) || `Update ${n} mod(s)`;
        if (btn) { btn.disabled = n === 0; btn.style.opacity = n === 0 ? '0.45' : '1'; }
    };
    ov.querySelectorAll('.mod-update-cb').forEach(cb => {
        cb.addEventListener('change', () => refreshRepoBtn((cb as HTMLElement).dataset.repoUrl || ''));
    });
    ov.querySelectorAll('.mod-direct-apply').forEach(btn => {
        btn.addEventListener('click', () => {
            const el = btn as HTMLElement;
            applyDirectUpdate(el.dataset.modId || '', btn as HTMLButtonElement, el.dataset.url || undefined);
        });
    });
    ov.querySelectorAll('.mod-updates-apply').forEach(btn => {
        btn.addEventListener('click', () => {
            const repoUrl = (btn as HTMLElement).dataset.repoUrl || '';
            const block = (btn as HTMLElement).closest('.mod-updates-repo-block');
            const selected = block
                ? Array.from(block.querySelectorAll('.mod-update-cb:checked')).map(c => (c as HTMLElement).dataset.modId)
                : [];
            if (selected.length === 0) return;
            applyRepoUpdate(repoUrl, selected as string[]);
        });
    });

    openOverlay(ov);
}

/** Jump to the sync flow pre-filled with the repo URL; delta-sync performs the update. */
function applyRepoUpdate(repoUrl: string, selectedModIds?: string[]): void {
    closeUpdatesModal();
    // Remember the user's per-mod choice so the sync screen can pre-tick exactly
    // those mods (it falls back to "all" when no selection is provided).
    (window as any).__bmmUpdateSelection = (selectedModIds && selectedModIds.length)
        ? { repoUrl, modIds: selectedModIds } : null;
    document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
        detail: { section: 'connect', prefill: { url: repoUrl } }
    }));
    toast(t('repo.updateSyncHint') || 'Select the profile(s) to update, then start the sync', 'info');
}

/** Apply a direct-download update in place: re-download the archive and overwrite
 *  the mod folder, then refresh state and re-check so the entry clears. */
async function applyDirectUpdate(modId: string, btn?: HTMLButtonElement, url?: string): Promise<void> {
    if (!modId) return;
    const prevLabel = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = t('repo.directUpdating') || 'Updating…'; }
    try {
        await invoke('apply_direct_update', { modId, url: url || null });
        toast(t('repo.directUpdateDone') || 'Mod updated from its direct download', 'success');
        // Drop it from the cached results and refresh the library + badges.
        _lastUpdates = _lastUpdates.filter(u => u.mod_id !== modId);
        setUpdateState(_lastUpdates);
        updateBadge(_lastUpdates.length);
        try { appState.set('allMods', await invoke('get_mods')); } catch {}
        // Remove the row's block; close the modal when nothing is left to review.
        const block = btn?.closest('.mod-updates-repo-block');
        block?.remove();
        if (!_lastUpdates.length && !_lastErrors.length) closeUpdatesModal();
    } catch (e) {
        toast((t('repo.directUpdateFailed') || 'Direct update failed') + ': ' + e, 'error');
        if (btn) { btn.disabled = false; btn.textContent = prevLabel; }
    }
}

/** Check a single mod for updates: runs a full check (repos are fetched once and
 *  cached) then surfaces only this mod's result. */
/** True when a mod is linked to at least one place we can check for updates. */
function modHasUpdateSource(mod: any): boolean {
    if (!mod) return false;
    const hasRid = !!(mod.repo_mod_id && String(mod.repo_mod_id).trim());
    return !!(
        (mod.source_repo && hasRid) ||
        (mod.update_url && String(mod.update_url).trim()) ||
        (mod.direct_url && String(mod.direct_url).trim()) ||
        (Array.isArray(mod.update_sources) && mod.update_sources.length) ||
        (getGlobalUpdateRepos().length && hasRid)
    );
}

export async function checkSingleModUpdate(modId: string): Promise<void> {
    if (!modId) return;
    const mod = ((appState.state.allMods || []) as any[]).find(m => m.id === modId);
    const name = mod?.name || modId;
    // No linked source → checking is meaningless; guide the user to configure one
    // instead of falsely reporting "up to date".
    if (!modHasUpdateSource(mod)) {
        toast(t('repo.modNoSource', { name }) || `"${name}" has no update source — use "Configure updates" to link a repo or direct download`, 'info');
        openModUpdateConfig(modId);
        return;
    }
    toast(t('repo.checkingMod', { name }) || `Checking "${name}" for updates…`, 'info');
    try {
        const { updates, errors, directSources } = await fetchModUpdates();
        _lastUpdates = updates; _lastErrors = errors;
        setUpdateState(updates);
        updateBadge(updates.length);
        const mine = updates.filter(u => u.mod_id === modId);
        const mineDirect = directSources.filter((d: any) => d.mod_id === modId);
        if (mine.length) {
            // A real change/update was detected (repo version or changed direct file).
            openUpdatesModal(mine, []);
        } else if (mineDirect.length) {
            // No change detected, but the mod has direct-download source(s): always
            // actionable — show them with the current remote info + Re-download.
            openUpdatesModal([], [], mineDirect);
        } else {
            // If this mod's source(s) couldn't be reached, say so rather than lie.
            const srcs = modSourceUrls(mod);
            const err = errors.find((e: any) => srcs.some(s => s === e.repo_url || e.repo_url?.includes(s) || s.includes(e.repo_url)));
            if (err) {
                toast((t('repo.modSourceUnreachable', { name }) || `Couldn't reach the update source for "${name}"`) + `: ${String(err.error || '').slice(0, 100)}`, 'warning');
            } else {
                toast(t('repo.modUpToDate', { name }) || `"${name}" is up to date`, 'success');
            }
        }
    } catch (e) {
        toast((t('repo.updatesCheckFailed') || 'Update check failed') + ': ' + e, 'error');
    }
}

// ── Per-mod update-source config modal ───────────────────────────────────────

export function openModUpdateConfig(modId: string): void {
    const mods = (appState.state.allMods || []) as any[];
    const mod = mods.find(m => m.id === modId);
    if (!mod) { toast(t('repo.cfgModNotFound') || 'Mod not found', 'error'); return; }

    const ov = ensureOverlay('mod-update-config-overlay');
    const sources: any[] = Array.isArray(mod.update_sources) ? [...mod.update_sources] : [];
    // Single typed primary: a direct download takes precedence as the primary
    // kind when configured, otherwise it's a server repo.
    const primaryKind = (mod.direct_url && mod.direct_url.trim()) ? 'direct' : 'repo';
    const primaryUrl = primaryKind === 'direct' ? (mod.direct_url || '') : (mod.update_url || '');

    const kindOptions = (kind: string) => `
        <option value="repo" ${kind !== 'direct' ? 'selected' : ''}>${t('repo.cfgKindRepo') || 'Server repo'}</option>
        <option value="direct" ${kind === 'direct' ? 'selected' : ''}>${t('repo.cfgKindDirect') || 'Direct download'}</option>`;

    const sourceRow = (s: any, i: number) => {
        const kind = s.kind === 'direct' ? 'direct' : 'repo';
        const repoPh = escAttr(t('repo.cfgRepoUrlPh') || 'Repo URL (https://…/repo.json)');
        const directPh = escAttr(t('repo.cfgDirectUrlPh') || 'https://…/mod-latest.zip');
        return `
        <div class="muc-source" data-i="${i}" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
            <select class="muc-src-kind" style="flex:0 0 auto;font-size:11px;padding:5px 6px;min-width:104px;">${kindOptions(kind)}</select>
            <input type="text" class="muc-src-url form-input" data-repo-ph="${repoPh}" data-direct-ph="${directPh}"
                placeholder="${kind === 'direct' ? directPh : repoPh}"
                value="${escAttr(s.repo_url || '')}" style="flex:2;font-size:11px;padding:5px 7px;" />
            <input type="text" class="muc-src-rid form-input" placeholder="${escAttr(t('repo.cfgModIdPh') || 'repo_mod_id (optional)')}"
                value="${escAttr(s.repo_mod_id || '')}" style="flex:1;font-size:11px;padding:5px 7px;${kind === 'direct' ? 'display:none;' : ''}" />
            <button class="muc-src-del" title="${escAttr(t('common.remove') || 'Remove')}" style="flex-shrink:0;width:26px;height:26px;border:none;border-radius:5px;background:rgba(231,76,60,0.15);color:#e74c3c;cursor:pointer;font-weight:700;">✕</button>
        </div>`;
    };

    ov.innerHTML = `
        <div class="modal glass" style="width:min(560px,92vw);max-width:560px;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--bmm-s06,rgba(255,255,255,0.06));">
                <div style="display:flex;flex-direction:column;min-width:0;">
                    <span style="font-size:14px;font-weight:700;color:var(--text-primary);">${t('repo.cfgTitle') || 'Update sources'}</span>
                    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px;">${escHtml(mod.name)}</span>
                </div>
                <button id="muc-close" style="width:26px;height:26px;padding:0;background:transparent;border:none;border-radius:6px;cursor:pointer;color:var(--text-secondary);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div style="padding:16px 18px;overflow-y:auto;flex:1 1 auto;min-height:0;">
                <p style="font-size:12px;color:var(--text-muted);margin:0 0 14px;line-height:1.5;">${t('repo.cfgDesc') || 'Link this mod to one or more repos so BMM can detect updates for it. The repo_mod_id is the mod\'s stable id inside that repo (visible in "Update an existing repo").'}</p>

                <label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:4px;">${t('repo.cfgModId') || 'This mod\'s id in its repo (repo_mod_id)'}</label>
                <input type="text" id="muc-repo-mod-id" class="form-input" value="${escAttr(mod.repo_mod_id || '')}"
                    placeholder="${escAttr(t('repo.cfgModIdPh') || 'repo_mod_id (optional)')}" style="width:100%;font-size:12px;padding:6px 8px;margin-bottom:6px;" />
                ${mod.source_repo ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:12px;">${t('repo.cfgOrigin') || 'Origin repo'}: <span style="color:var(--text-secondary);word-break:break-all;">${escHtml(mod.source_repo)}</span></div>` : '<div style="margin-bottom:12px;"></div>'}

                <label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:4px;">${t('repo.cfgPrimarySource') || 'Primary update source'}</label>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
                    <select id="muc-primary-kind" style="flex:0 0 auto;font-size:12px;padding:6px 7px;min-width:120px;">${kindOptions(primaryKind)}</select>
                    <input type="text" id="muc-primary-url" class="form-input" value="${escAttr(primaryUrl)}"
                        data-repo-ph="${escAttr(t('repo.cfgRepoUrlPh') || 'Repo URL (https://…/repo.json)')}"
                        data-direct-ph="${escAttr(t('repo.cfgDirectUrlPh') || 'https://…/mod-latest.zip')}"
                        placeholder="${escAttr(primaryKind === 'direct' ? (t('repo.cfgDirectUrlPh') || 'https://…/mod-latest.zip') : (t('repo.cfgRepoUrlPh') || 'Repo URL (https://…/repo.json)'))}"
                        style="flex:1;font-size:12px;padding:6px 8px;" />
                </div>
                <div style="font-size:10px;color:var(--text-muted);margin-bottom:14px;line-height:1.45;">${t('repo.cfgDirectHint') || 'For a Direct download, BMM detects a new build by comparing the archive\'s ETag, last-modified date and size together — or, if the host exposes none, a fingerprint of the file\'s first bytes — then re-downloads it on update. Redirect "latest" links are followed. For a Server repo, it compares versions from the repo.json instead.'}</div>

                <label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:2px;">${t('repo.cfgExtraSources') || 'Additional fallback sources'}</label>
                <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;">${t('repo.cfgExtraHint') || 'Tried only if the primary source has no update — each can be a repo or a direct download.'}</div>
                <div id="muc-sources">${sources.map((s, i) => sourceRow(s, i)).join('')}</div>
                <button id="muc-add-source" class="btn btn-secondary btn-sm" style="font-size:11px;padding:4px 10px;margin-top:4px;">+ ${t('repo.cfgAddSource') || 'Add fallback'}</button>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--bmm-s06,rgba(255,255,255,0.06));">
                <button id="muc-cancel" class="btn btn-secondary btn-sm">${t('common.cancel') || 'Cancel'}</button>
                <button id="muc-save" class="btn btn-primary btn-sm">${t('common.save') || 'Save'}</button>
            </div>
        </div>`;

    const close = () => hideOverlay(ov);
    const srcWrap = ov.querySelector('#muc-sources') as HTMLElement;
    let counter = sources.length;

    // Swap a URL field's placeholder to match the selected kind.
    const applyKindPh = (sel: HTMLSelectElement, urlInput: HTMLInputElement | null, rid?: HTMLInputElement | null) => {
        const direct = sel.value === 'direct';
        if (urlInput) urlInput.placeholder = (direct ? urlInput.dataset.directPh : urlInput.dataset.repoPh) || '';
        if (rid) rid.style.display = direct ? 'none' : '';
    };
    const wireRow = (row: HTMLElement) => {
        const sel = row.querySelector('.muc-src-kind') as HTMLSelectElement | null;
        const url = row.querySelector('.muc-src-url') as HTMLInputElement | null;
        const rid = row.querySelector('.muc-src-rid') as HTMLInputElement | null;
        const del = row.querySelector('.muc-src-del') as HTMLElement | null;
        if (del) del.onclick = () => row.remove();
        if (sel) sel.onchange = () => applyKindPh(sel, url, rid);
    };
    ov.querySelectorAll('.muc-source').forEach(r => wireRow(r as HTMLElement));

    // Primary kind toggle.
    const primKind = ov.querySelector('#muc-primary-kind') as HTMLSelectElement | null;
    const primUrl = ov.querySelector('#muc-primary-url') as HTMLInputElement | null;
    if (primKind) primKind.onchange = () => applyKindPh(primKind, primUrl);

    ov.querySelector('#muc-add-source')?.addEventListener('click', () => {
        srcWrap.insertAdjacentHTML('beforeend', sourceRow({}, counter++));
        wireRow(srcWrap.lastElementChild as HTMLElement);
    });
    ov.querySelector('#muc-close')?.addEventListener('click', close);
    ov.querySelector('#muc-cancel')?.addEventListener('click', close);
    ov.querySelector('#muc-save')?.addEventListener('click', async () => {
        const repoModId = (ov.querySelector('#muc-repo-mod-id') as HTMLInputElement).value.trim();
        const pKind = (ov.querySelector('#muc-primary-kind') as HTMLSelectElement).value;
        const pUrl = (ov.querySelector('#muc-primary-url') as HTMLInputElement).value.trim();
        // One typed primary → routes to either update_url (repo) or direct_url; the
        // other is cleared so there is never both at once.
        const updateUrl = pKind === 'direct' ? '' : pUrl;
        const directUrl = pKind === 'direct' ? pUrl : '';
        const updateSources = Array.from(ov.querySelectorAll('.muc-source')).map(row => {
            const kind = (row.querySelector('.muc-src-kind') as HTMLSelectElement).value === 'direct' ? 'direct' : 'repo';
            const rid = (row.querySelector('.muc-src-rid') as HTMLInputElement).value.trim();
            return {
                repo_url: (row.querySelector('.muc-src-url') as HTMLInputElement).value.trim(),
                repo_mod_id: kind === 'direct' ? null : (rid || null),
                kind,
            };
        }).filter(s => s.repo_url);
        try {
            await invoke('set_mod_update_config', {
                modId, repoModId, updateUrl, updateSources, directUrl,
            });
            toast(t('repo.cfgSaved') || 'Update sources saved', 'success');
            close();
            // refresh cached mods so the modal reflects new state next time
            try { appState.set('allMods', await invoke('get_mods')); } catch {}
        } catch (e) {
            toast((t('repo.cfgSaveFailed') || 'Failed to save') + ': ' + e, 'error');
        }
    });

    openOverlay(ov);
}

// ── Auto-check timer ─────────────────────────────────────────────────────────

/** Interval (minutes) between automatic update checks; 0 disables. */
export function getUpdateCheckInterval(): number {
    try { return Math.max(0, parseInt(localStorage.getItem('bmm_update_check_min') || '0', 10) || 0); }
    catch { return 0; }
}

export function startAutoUpdateChecks(): void {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    const min = getUpdateCheckInterval();
    if (min <= 0) return;
    // One deferred silent check so library badges populate without waiting a full
    // interval after launch.
    setTimeout(() => { checkModUpdates(true).catch(() => {}); }, 8000);
    _autoTimer = setInterval(() => { checkModUpdates(true).catch(() => {}); }, min * 60 * 1000);
}

/** Re-open the updates modal from the last check (used by the library badge),
 *  or run a fresh check if we have nothing cached yet. */
export function showModUpdates(): void {
    if (_lastUpdates.length || _lastErrors.length) openUpdatesModal(_lastUpdates, _lastErrors);
    else checkModUpdates(false);
}

export function initModUpdates(): void {
    const btn = document.getElementById('btn-check-mod-updates');
    if (btn) btn.addEventListener('click', () => checkModUpdates(false));
    const libBtn = document.getElementById('btn-lib-check-updates');
    if (libBtn) libBtn.addEventListener('click', () => checkModUpdates(false));
    (window as any).openModUpdateConfig = openModUpdateConfig;
    (window as any).bmmShowModUpdates = showModUpdates;
    (window as any).bmmCheckModUpdate = checkSingleModUpdate;
    startAutoUpdateChecks();
}
