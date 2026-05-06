/**
 * launch_packs.ts — Management of application groups (Launch Packs)
 */
import { invoke, pickFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml } from '../../core/utils.js';

let currentSelectedExes: string[] = [];
let currentSelectedIcon: string | null = null;

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
                await invoke('create_launch_pack', {
                    name,
                    exePaths: currentSelectedExes,
                    iconSourcePath: currentSelectedIcon
                });

                toast(t('settings.launchPackAdded'), 'success');
                document.getElementById('modal-launchpack')?.classList.remove('open');
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
                    <div style="font-size:10px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pack.executable_paths.length} Apps</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary btn-xs btn-run-lp" data-id="${pack.id}">${t('settings.launchPackRun')}</button>
                    <button class="btn btn-ghost btn-xs btn-open-lp" data-id="${pack.id}" title="Open Folder"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
                    <button class="btn btn-ghost btn-xs btn-del-lp" data-id="${pack.id}" style="color:var(--error);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
            `;

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
                    deleteText.innerHTML = t('settings.launchPackDeleteConfirmText', { name: `<span style="color: #ef4444; font-weight: 800; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px;">${escHtml(pack.name)}</span>` });
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

    // Reset form
    const nameInput = document.getElementById('lp-input-name') as HTMLInputElement;
    if (nameInput) nameInput.value = '';
    
    currentSelectedExes = [];
    currentSelectedIcon = null;
    
    const preview = document.getElementById('lp-icon-preview');
    if (preview) {
        preview.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    }

    renderSelectedExes();
    modal.classList.add('open');
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
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escHtml(path)}">${escHtml(fileName)}</span>
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
