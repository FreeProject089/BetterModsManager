/**
 * launch_packs.ts — Management of application groups (Launch Packs)
 */
import { invoke, pickFile } from '../../core/api.js';
import { copyIdButtons, wireCopyIds } from '../../core/copy-id.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml } from '../../core/utils.js';

let currentSelectedExes: string[] = [];
let currentSelectedIcon: string | null = null;
/** When set, the modal is in EDIT mode for this pack ID. null = CREATE mode. */
let editingPackId: string | null = null;
/** Existing icon path of the pack being edited (for the preview when no new icon picked). */
let editingExistingIconPath: string | null = null;

export async function initLaunchPackSettings() {
    const btnCreate = document.getElementById('btn-create-launchpack');
    if (!btnCreate) return;

    btnCreate.addEventListener('click', () => {
        openLaunchPackModal();
    });

    const btnAddExe = document.getElementById('lp-btn-add-exe');
    if (btnAddExe) {
        btnAddExe.addEventListener('click', async () => {
            const path = await pickFile(['exe', 'bat', 'ps1', 'cmd', 'lnk']);
            if (path) {
                if (!currentSelectedExes.includes(path as string)) {
                    currentSelectedExes.push(path as string);
                    renderSelectedExes();
                }
            }
        });
    }

    // ── App Picker (Steam-style) ───────────────────────────────────────────────
    const btnDetect = document.getElementById('lp-btn-detect-exe');
    if (btnDetect) {
        btnDetect.addEventListener('click', () => openAppPicker());
    }

    const btnSelectIcon = document.getElementById('lp-btn-select-icon');
    if (btnSelectIcon) {
        btnSelectIcon.addEventListener('click', async () => {
            const path = await pickFile(['png', 'jpg', 'jpeg', 'bmp']);
            if (path) {
                currentSelectedIcon = path as string;
                const preview = document.getElementById('lp-icon-preview');
                if (preview) {
                    const assetUrl = (window as any).__TAURI__?.tauri?.convertFileSrc(path) || `asset.localhost/${path}`;
                    preview.innerHTML = `<img src="${assetUrl}" style="width:100%;height:100%;object-fit:cover;" />`;
                }
            }
        });
    }

    const btnConfirm = document.getElementById('lp-btn-confirm') as HTMLButtonElement;
    if (btnConfirm) {
        btnConfirm.addEventListener('click', async () => {
            const nameInput = document.getElementById('lp-input-name') as HTMLInputElement;
            const name = nameInput?.value.trim();

            if (!name) {
                return toast(t('settings.launchPackNameRequired') || 'Name is required', 'error');
            }
            if (currentSelectedExes.length === 0) {
                return toast(t('settings.launchPackNoExes') || 'Add at least one application', 'error');
            }

            btnConfirm.disabled = true;
            btnConfirm.innerHTML = `<span>${t('common.loading') || '...'}</span>`;

            try {
                if (editingPackId) {
                    await invoke('update_launch_pack', {
                        id: editingPackId,
                        name,
                        exePaths: currentSelectedExes,
                        iconSourcePath: currentSelectedIcon
                    });
                    toast(t('settings.launchPackUpdated') || t('settings.launchPackAdded'), 'success');
                } else {
                    await invoke('create_launch_pack', {
                        name,
                        exePaths: currentSelectedExes,
                        iconSourcePath: currentSelectedIcon
                    });
                    toast(t('settings.launchPackAdded'), 'success');
                }

                document.getElementById('modal-launchpack')?.classList.remove('open');
                editingPackId = null;
                editingExistingIconPath = null;
                renderLaunchPacks();
            } catch (err) {
                toast(t('settings.launchPackError', { err: String(err) }), 'error');
            } finally {
                btnConfirm.disabled = false;
                btnConfirm.innerHTML = `<span>${t('common.confirm')}</span>`;
            }
        });
    }

    renderLaunchPacks();
}

export async function renderLaunchPacks() {
    const container = document.getElementById('launchpack-list-container');
    if (!container) return;

    try {
        const packs = await invoke('get_launch_packs') as any[];
        container.innerHTML = '';

        if (packs.length === 0) {
            container.innerHTML = `<span style="color:var(--text-muted);font-size:12px;font-style:italic">${t('settings.launchPackNone')}</span>`;
            return;
        }

        packs.forEach((pack: any) => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.cssText = 'padding:12px; display:flex; align-items:center; gap:12px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05);';
            
            const iconUrl = pack.icon_path ? ((window as any).__TAURI__?.tauri?.convertFileSrc(pack.icon_path) || `asset.localhost/${pack.icon_path}`) : null;
            const iconHtml = iconUrl 
                ? `<img src="${iconUrl}" style="width:32px; height:32px; border-radius:8px; object-fit:cover;" />`
                : `<div style="width:32px; height:32px; background:var(--accent-dim); color:var(--accent); border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg></div>`;

            card.innerHTML = `
                ${iconHtml}
                <div style="flex:1; min-width:0;">
                    <div style="font-size:13px; font-weight:700; color:var(--text-bright); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(pack.name)}</div>
                    <div style="font-size:10px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pack.executable_paths.length} ${t('settings.launchPackExes') || 'Apps'}</div>
                    <div class="lp-card-ids">${copyIdButtons('launchpack', pack.id, { compact: true, doc: { executable_paths: pack.executable_paths || [] } })}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary btn-xs btn-run-lp" data-id="${pack.id}">${t('settings.launchPackRun')}</button>
                    <button class="btn btn-ghost btn-xs btn-edit-lp" data-id="${pack.id}" data-tooltip="${t('common.edit') || 'Edit'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    <button class="btn btn-ghost btn-xs btn-open-lp" data-id="${pack.id}" data-tooltip="${t('settings.launchPackOpenFolder') || 'Open folder'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
                    <button class="btn btn-ghost btn-xs btn-del-lp" data-id="${pack.id}" style="color:var(--error);" data-tooltip="${t('common.delete') || 'Delete'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
            `;

            wireCopyIds(card, toast);
            container.appendChild(card);
        });

        // Event listeners for run and delete
        container.querySelectorAll('.btn-run-lp').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await invoke('run_launch_pack', { id: (btn as HTMLElement).dataset.id });
                    toast(t('common.success'), 'success');
                } catch (err) {
                    toast(t('settings.launchPackError', { err: String(err) }), 'error');
                }
            });
        });

        container.querySelectorAll('.btn-edit-lp').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = (btn as HTMLElement).dataset.id;
                const pack = packs.find(p => p.id === id);
                if (pack) openEditLaunchPackModal(pack);
            });
        });

        container.querySelectorAll('.btn-open-lp').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    // Open the folder containing the pack
                    await invoke('open_launch_pack_folder', { id: (btn as HTMLElement).dataset.id });
                } catch (err) {
                    toast(String(err), 'error');
                }
            });
        });

        container.querySelectorAll('.btn-del-lp').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = (btn as HTMLElement).dataset.id;
                const pack = packs.find(p => p.id === id);
                if (!pack) return;

                const deleteModal = document.getElementById('modal-launchpack-delete');
                const deleteText = document.getElementById('lp-delete-confirm-text');
                const deleteConfirmBtn = document.getElementById('lp-btn-delete-confirm');

                if (deleteModal && deleteText && deleteConfirmBtn) {
                    deleteText.innerHTML = t('settings.launchPackDeleteConfirmText', { name: `<span style="color: var(--bmm-danger); font-weight: 800; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px;">${escHtml(pack.name)}</span>` });
                    deleteModal.classList.add('open');

                    // Clean previous listeners
                    const newBtn = deleteConfirmBtn.cloneNode(true) as HTMLButtonElement;
                    deleteConfirmBtn.parentNode?.replaceChild(newBtn, deleteConfirmBtn);

                    newBtn.addEventListener('click', async () => {
                        try {
                            newBtn.disabled = true;
                            await invoke('delete_launch_pack', { id });
                            toast(t('settings.launchPackDeleted'), 'success');
                            deleteModal.classList.remove('open');
                            renderLaunchPacks();
                        } catch (err) {
                            toast(t('settings.launchPackError', { err: String(err) }), 'error');
                        } finally {
                            newBtn.disabled = false;
                        }
                    });
                }
            });
        });

    } catch (err) {
        console.error('Failed to render launch packs:', err);
    }
}

function openLaunchPackModal() {
    const modal = document.getElementById('modal-launchpack');
    if (!modal) return;

    // CREATE mode
    editingPackId = null;
    editingExistingIconPath = null;

    const nameInput = document.getElementById('lp-input-name') as HTMLInputElement;
    if (nameInput) nameInput.value = '';

    currentSelectedExes = [];
    currentSelectedIcon = null;

    const preview = document.getElementById('lp-icon-preview');
    if (preview) {
        preview.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    }

    _setLaunchPackModalTitle(false);
    renderSelectedExes();
    modal.classList.add('open');
}

function openEditLaunchPackModal(pack: any) {
    const modal = document.getElementById('modal-launchpack');
    if (!modal) return;

    editingPackId = pack.id;
    editingExistingIconPath = pack.icon_path || null;

    const nameInput = document.getElementById('lp-input-name') as HTMLInputElement;
    if (nameInput) nameInput.value = pack.name || '';

    currentSelectedExes = (pack.executable_paths || []).map((p: any) => typeof p === 'string' ? p : String(p));
    currentSelectedIcon = null; // null = keep existing on backend side

    const preview = document.getElementById('lp-icon-preview');
    if (preview) {
        if (editingExistingIconPath) {
            const assetUrl = (window as any).__TAURI__?.tauri?.convertFileSrc(editingExistingIconPath) || `asset.localhost/${editingExistingIconPath}`;
            preview.innerHTML = `<img src="${assetUrl}" style="width:100%;height:100%;object-fit:cover;" />`;
        } else {
            preview.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        }
    }

    _setLaunchPackModalTitle(true);
    renderSelectedExes();
    modal.classList.add('open');
}

function _setLaunchPackModalTitle(isEdit: boolean) {
    const titleEl = document.querySelector('#modal-launchpack .modal-title') as HTMLElement | null;
    if (titleEl) {
        const key = isEdit ? 'settings.launchPackEditTitle' : 'settings.launchPackCreateTitle';
        const fallback = isEdit ? 'Edit Launch Pack' : 'Create Launch Pack';
        titleEl.textContent = t(key) || fallback;
    }
}

function renderSelectedExes() {
    const list = document.getElementById('lp-exe-list');
    if (!list) return;

    list.innerHTML = '';
    currentSelectedExes.forEach((path, index) => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:6px; font-size:11px;';

        const fileName = path.split(/[\\/]/).pop();
        item.innerHTML = `
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" data-tooltip="${escHtml(path)}">${escHtml(fileName || path)}</span>
            <button class="btn-del-exe" data-index="${index}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:14px;">&times;</button>
        `;
        list.appendChild(item);
    });

    list.querySelectorAll('.btn-del-exe').forEach(btn => {
        btn.addEventListener('click', () => {
            currentSelectedExes.splice(parseInt((btn as HTMLElement).dataset.index!), 1);
            renderSelectedExes();
        });
    });
}

// ── Steam-style App Picker ────────────────────────────────────────────────────

interface InstalledApp { name: string; exe_path: string; icon_path?: string | null; }

let _appPickerCache: InstalledApp[] | null = null;
let _appPickerLoading = false;

async function openAppPicker() {
    const modal = document.getElementById('modal-app-picker');
    if (!modal) return;
    modal.classList.add('open');
    _renderAppPickerList([]);
    _wireAppPickerEvents();

    if (_appPickerLoading) return;
    if (_appPickerCache) { _renderAppPickerList(_appPickerCache); return; }

    _appPickerLoading = true;
    const statusEl = document.getElementById('app-picker-status');
    if (statusEl) statusEl.textContent = t('settings.appPicker.scanning');

    try {
        const apps: InstalledApp[] = await invoke('scan_installed_apps');
        _appPickerCache = apps;
        _renderAppPickerList(apps);
    } catch (e) {
        const tbody = document.getElementById('app-picker-list');
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--error);font-size:12px;">${t('settings.appPicker.error', { err: String(e) })}</td></tr>`;
    } finally {
        _appPickerLoading = false;
    }
}

// Icon cache: exe_path → data:image/png;base64,...
const _iconCache = new Map<string, string>();
// Generic program icon SVG (used as placeholder / fallback)
const _genericIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;

function _renderAppPickerList(apps: InstalledApp[], filter = '') {
    const tbody = document.getElementById('app-picker-list');
    if (!tbody) return;

    const filtered = filter
        ? apps.filter(a => a.name.toLowerCase().includes(filter) || a.exe_path.toLowerCase().includes(filter))
        : apps;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">${apps.length === 0 ? `<span id="app-picker-status">${t('settings.appPicker.noApps')}</span>` : t('settings.appPicker.noResults')}</td></tr>`;
        return;
    }

    // Build rows with icon placeholder
    tbody.innerHTML = filtered.map((app) => {
        const alreadyAdded = currentSelectedExes.includes(app.exe_path);
        // If we have a cached icon, embed it immediately; otherwise show placeholder
        const cachedIcon  = _iconCache.get(app.exe_path);
        const iconContent = cachedIcon
            ? `<img src="${cachedIcon}" width="20" height="20" style="border-radius:3px;object-fit:contain;">`
            : _genericIcon;
        return `<tr class="app-picker-row" data-exe="${escHtml(app.exe_path)}"
            style="border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;transition:background .1s;"
            data-hover="background:rgba(255,255,255,0.04)" data-hover-out="background:transparent">
            <td style="padding:5px 10px;text-align:center;width:28px;">
                <input type="checkbox" class="app-picker-cb" data-path="${escHtml(app.exe_path)}" data-name="${escHtml(app.name)}"
                    style="accent-color:var(--accent);width:13px;height:13px;cursor:pointer;"
                    ${alreadyAdded ? 'checked disabled' : ''}>
            </td>
            <td style="padding:5px 6px;width:28px;">
                <span class="app-icon-cell" data-exe="${escHtml(app.exe_path)}"
                    style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;">${iconContent}</span>
            </td>
            <td style="padding:5px 6px;font-weight:600;color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;" data-tooltip="${escHtml(app.name)}">${escHtml(app.name)}</td>
            <td style="padding:5px 6px;color:var(--text-muted);font-size:10px;font-family:'JetBrains Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;" data-tooltip="${escHtml(app.exe_path)}">${escHtml(app.exe_path)}</td>
        </tr>`;
    }).join('');

    // Click row = toggle checkbox
    tbody.querySelectorAll('.app-picker-row').forEach(row => {
        row.addEventListener('click', (e) => {
            const cb = row.querySelector('.app-picker-cb') as HTMLInputElement;
            if (!cb || cb.disabled) return;
            if ((e.target as HTMLElement).tagName === 'INPUT') return;
            cb.checked = !cb.checked;
            _updateAppPickerCount();
        });
        row.querySelector('.app-picker-cb')?.addEventListener('change', () => _updateAppPickerCount());
    });

    // Lazy icon loading via IntersectionObserver
    _observeIconCells(tbody);
    _updateAppPickerCount();
}

/** Watches icon cells in the tbody and loads icons as they scroll into view */
function _observeIconCells(tbody: HTMLElement) {
    const tauri = (window as any).__TAURI__?.tauri;
    if (!tauri) return; // Not in Tauri context — no icon extraction

    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const cell = entry.target as HTMLElement;
            const exe   = cell.dataset.exe!;
            io.unobserve(cell);

            if (_iconCache.has(exe)) {
                _applyIcon(cell, _iconCache.get(exe)!);
                return;
            }

            // Always use extract_exe_icon (runs in Rust, no asset-protocol scope required)
            _loadExeIcon(cell, exe, tauri);
        });
    }, { root: tbody.closest('div'), rootMargin: '100px', threshold: 0 });

    tbody.querySelectorAll<HTMLElement>('.app-icon-cell').forEach(cell => {
        // Skip if already cached
        if (_iconCache.has(cell.dataset.exe || '')) {
            _applyIcon(cell, _iconCache.get(cell.dataset.exe!)!);
        } else {
            io.observe(cell);
        }
    });
}

async function _loadExeIcon(cell: HTMLElement, exe: string, tauri: any) {
    try {
        const b64: string = await tauri.invoke('extract_exe_icon', { exePath: exe });
        const dataUrl = `data:image/png;base64,${b64}`;
        _iconCache.set(exe, dataUrl);
        _applyIcon(cell, dataUrl);
    } catch { /* keep generic icon */ }
}

function _applyIcon(cell: HTMLElement, src: string) {
    cell.innerHTML = '';
    const img = document.createElement('img');
    img.width = 20;
    img.height = 20;
    img.style.cssText = 'border-radius:3px;object-fit:contain';
    img.addEventListener('error', () => { cell.innerHTML = _genericIcon; });
    img.src = src;   // last: the handler must exist before the load can fail
    cell.appendChild(img);
}

function _updateAppPickerCount() {
    const checked = document.querySelectorAll('#app-picker-list .app-picker-cb:checked:not(:disabled)');
    const countEl = document.getElementById('app-picker-sel-count');
    const confirmBtn = document.getElementById('app-picker-confirm') as HTMLButtonElement | null;
    if (countEl) countEl.textContent = checked.length > 0 ? t('settings.appPicker.selected', { n: String(checked.length) }) : '';
    if (confirmBtn) confirmBtn.disabled = checked.length === 0;
}

function _wireAppPickerEvents() {
    // Search
    const search = document.getElementById('app-picker-search') as HTMLInputElement | null;
    if (search && !search.dataset.wired) {
        search.dataset.wired = '1';
        search.addEventListener('input', () => {
            if (_appPickerCache) _renderAppPickerList(_appPickerCache, search.value.toLowerCase().trim());
        });
    }

    // Browse fallback
    const browseBtn = document.getElementById('app-picker-browse');
    if (browseBtn && !browseBtn.dataset.wired) {
        browseBtn.dataset.wired = '1';
        browseBtn.addEventListener('click', async () => {
            const path = await pickFile(['exe', 'bat', 'ps1', 'cmd', 'lnk']);
            if (path && !currentSelectedExes.includes(path as string)) {
                currentSelectedExes.push(path as string);
                renderSelectedExes();
                document.getElementById('modal-app-picker')?.classList.remove('open');
            }
        });
    }

    // Confirm: add selected to currentSelectedExes
    const confirmBtn = document.getElementById('app-picker-confirm');
    if (confirmBtn && !confirmBtn.dataset.wired) {
        confirmBtn.dataset.wired = '1';
        confirmBtn.addEventListener('click', () => {
            document.querySelectorAll('#app-picker-list .app-picker-cb:checked:not(:disabled)').forEach(cb => {
                const path = (cb as HTMLElement).dataset.path!;
                if (path && !currentSelectedExes.includes(path)) {
                    currentSelectedExes.push(path);
                }
            });
            renderSelectedExes();
            document.getElementById('modal-app-picker')?.classList.remove('open');
        });
    }
}
