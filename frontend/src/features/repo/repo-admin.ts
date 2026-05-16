// @ts-nocheck
import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { showConfirm, copyToClipboard } from './repo.js';

let currentBans = { banned_ips: [], banned_keys: [] };
let currentWhitelist = { enabled: false, ips: [], keys: [] };

export function initRepoAdmin(elements) {
    const {
        banListContainer,
        inputBanSearch,
        selectBanFilter,
        modalBans,
        btnOpenBans,
        btnUnbanAll,
        btnExportBans,
        btnAddManualBan,
        manualBanIp,
        manualBanKey,
        whitelistListContainer,
        whitelistToggle,
        whitelistSearch,
        btnClearWhitelist,
        btnExportWhitelist,
        modalWhitelist,
        btnOpenWhitelist,
        whitelistToggleBtn,
        btnAddManualWhitelist,
        manualWhitelistIp,
        manualWhitelistKey
    } = elements;

    // --- Ban Logic ---
    const renderBanItem = (val, type) => {
        const dataAttr = type === 'IP' ? `data-ip="${escAttr(val)}"` : `data-key="${escAttr(val)}"`;
        return `
            <div class="server-mgmt-item">
                <div class="item-info">
                    <div class="item-val">${escHtml(val)}</div>
                    <div class="item-type">${type}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn btn-ghost btn-xs copy-ban-val" data-val="${escAttr(val)}" style="padding:0; min-width:32px; height:32px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-xs btn-unban" ${dataAttr} style="color:var(--danger); font-size:11px; font-weight:800; padding: 0 12px; height:32px; border-radius:10px; background:rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.1);">
                        ${t('common.delete') }
                    </button>
                </div>
            </div>
        `;
    };

    const updateBanListUI = () => {
        const search = inputBanSearch?.value.toLowerCase() ;
        const filter = selectBanFilter?.value ;
        
        let filteredIps = (filter === 'ALL' || filter === 'IP') ? (currentBans.banned_ips || []).filter(ip => ip.toLowerCase().includes(search)) : [];
        let filteredKeys = (filter === 'ALL' || filter === 'KEY') ? (currentBans.banned_keys || []).filter(key => key.toLowerCase().includes(search)) : [];

        if (filteredIps.length === 0 && filteredKeys.length === 0) {
            if (banListContainer) banListContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">${t('repo.noBansFound') }</div>`;
            return;
        }

        let html = '';
        filteredIps.forEach(ip => html += renderBanItem(ip, 'IP'));
        filteredKeys.forEach(key => html += renderBanItem(key, 'KEY'));
        if (banListContainer) {
            banListContainer.innerHTML = html;
            banListContainer.querySelectorAll('.btn-unban').forEach(btn => {
                btn.onclick = async () => {
                    const { ip, key } = btn.dataset;
                    const val = ip || key;
                    const confirmed = await showConfirm(t('common.confirm') , `${t('common.delete') } : ${val} ?`);
                    if (!confirmed) return;
                    await invoke('unban_user', { ip: ip || null, key: key || null });
                    loadBanList();
                };
            });
            banListContainer.querySelectorAll('.copy-ban-val').forEach(btn => {
                btn.onclick = () => copyToClipboard(btn.dataset.val);
            });
        }
    };

    const loadBanList = async () => {
        try {
            currentBans = await invoke('get_ban_list');
            updateBanListUI();
        } catch (err) { console.error("[BMM] loadBanList error:", err); }
    };

    const banUser = async (ip, key) => {
        try {
            await invoke('ban_user', { ip: ip || null, key: key || null });
            toast(t('repo.banSuccess') , 'success');
            loadBanList(); 
        } catch (err) {
            toast(String(err), 'error');
        }
    };
    window.banUser = banUser; // For Monitoring module

    if (inputBanSearch) inputBanSearch.oninput = updateBanListUI;
    if (selectBanFilter) selectBanFilter.onchange = updateBanListUI;

    if (btnUnbanAll) {
        btnUnbanAll.addEventListener('click', async () => {
            const confirmed = await showConfirm(t('repo.bansTitle') , t('repo.confirmUnbanAll') );
            if (!confirmed) return;
            try {
                await invoke('unban_all');
                toast(t('repo.unbanAllSuccess') , 'success');
                loadBanList();
            } catch(e) { toast(String(e), 'error'); }
        });
    }

    if (btnExportBans) {
        btnExportBans.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentBans, null, 2));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", "bmm_bans_export.json");
            dlAnchorElem.click();
            toast(t('repo.exportSuccess') , 'success');
        });
    }

    if (btnOpenBans) {
        btnOpenBans.addEventListener('click', () => {
            modalBans.classList.add('open');
            loadBanList();
        });
    }

    document.querySelectorAll('[data-close="modal-bans"]').forEach(btn => {
        btn.onclick = () => { if(modalBans) modalBans.classList.remove('open'); };
    });
    modalBans?.addEventListener('click', (e) => {
        if (e.target === modalBans) modalBans.classList.remove('open');
    });

    if (btnAddManualBan) {
        btnAddManualBan.addEventListener('click', async () => {
            const ip = manualBanIp ? manualBanIp.value.trim() : "";
            const key = manualBanKey ? manualBanKey.value.trim() : "";
            if (ip || key) {
                await banUser(ip || null, key || null);
                if (manualBanIp) manualBanIp.value = '';
                if (manualBanKey) manualBanKey.value = '';
            }
        });
    }

    // --- Whitelist Logic ---
    const renderWhitelistItem = (val, type) => {
        const dataAttr = type === 'IP' ? `data-ip="${escAttr(val)}"` : `data-key="${escAttr(val)}"`;
        return `
            <div class="server-mgmt-item">
                <div class="item-info">
                    <div class="item-val">${escHtml(val)}</div>
                    <div class="item-type">${type}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn btn-ghost btn-xs copy-whitelist-val" data-val="${escAttr(val)}" style="padding:0; min-width:32px; height:32px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-xs btn-remove-whitelist" ${dataAttr} style="color:var(--danger); font-size:11px; font-weight:800; padding: 0 12px; height:32px; border-radius:10px; background:rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.1);">
                        ${t('common.delete') }
                    </button>
                </div>
            </div>
        `;
    };

    const updateWhitelistUI = () => {
        const search = whitelistSearch?.value.toLowerCase() ;
        let filteredIps = (currentWhitelist.ips || []).filter(ip => ip.toLowerCase().includes(search));
        let filteredKeys = (currentWhitelist.keys || []).filter(key => key.toLowerCase().includes(search));

        if (whitelistToggle) whitelistToggle.checked = currentWhitelist.enabled;
        if (filteredIps.length === 0 && filteredKeys.length === 0) {
            if (whitelistListContainer) whitelistListContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">${t('repo.noWhitelistFound') }</div>`;
            return;
        }

        let html = '';
        filteredIps.forEach(ip => html += renderWhitelistItem(ip, 'IP'));
        filteredKeys.forEach(key => html += renderWhitelistItem(key, 'KEY'));
        
        if (whitelistListContainer) {
            whitelistListContainer.innerHTML = html;
            whitelistListContainer.querySelectorAll('.btn-remove-whitelist').forEach(btn => {
                btn.onclick = async () => {
                    const { ip, key } = btn.dataset;
                    const val = ip || key;
                    const confirmed = await showConfirm(t('common.confirm') , `${t('common.delete') } : ${val} ?`);
                    if (!confirmed) return;
                    await invoke('remove_from_whitelist', { ip: ip || null, key: key || null });
                    loadWhitelist();
                };
            });
            whitelistListContainer.querySelectorAll('.copy-whitelist-val').forEach(btn => {
                btn.onclick = () => copyToClipboard(btn.dataset.val);
            });
        }
    };

    const loadWhitelist = async () => {
        try {
            currentWhitelist = await invoke('get_whitelist');
            updateWhitelistUI();
        } catch (err) { console.error("[BMM] loadWhitelist error:", err); }
    };

    if (whitelistSearch) whitelistSearch.oninput = updateWhitelistUI;

    if (whitelistToggleBtn) {
        whitelistToggleBtn.addEventListener('click', () => {
            if (whitelistToggle) {
                whitelistToggle.checked = !whitelistToggle.checked;
                whitelistToggle.dispatchEvent(new Event('change'));
            }
        });
    }

    if (whitelistToggle) {
        whitelistToggle.addEventListener('change', async () => {
            try {
                await invoke('toggle_whitelist', { enabled: whitelistToggle.checked });
                currentWhitelist.enabled = whitelistToggle.checked;
                toast(t('repo.whitelistUpdated') , 'success');
            } catch (e) {
                toast(String(e), 'error');
                whitelistToggle.checked = !whitelistToggle.checked;
            }
        });
    }

    if (btnAddManualWhitelist) {
        btnAddManualWhitelist.addEventListener('click', async () => {
            const ip = manualWhitelistIp ? manualWhitelistIp.value.trim() : "";
            const key = manualWhitelistKey ? manualWhitelistKey.value.trim() : "";
            if (ip || key) {
                try {
                    await invoke('add_to_whitelist', { ip: ip || null, key: key || null });
                    toast(t('repo.whitelistAddSuccess') , 'success');
                    if (manualWhitelistIp) manualWhitelistIp.value = '';
                    if (manualWhitelistKey) manualWhitelistKey.value = '';
                    loadWhitelist();
                } catch (e) { toast(String(e), 'error'); }
            }
        });
    }

    if (btnClearWhitelist) {
        btnClearWhitelist.addEventListener('click', async () => {
            const confirmed = await showConfirm(t('repo.whitelistTitle') , t('repo.confirmClearWhitelist') );
            if (!confirmed) return;
            try {
                await invoke('clear_whitelist');
                toast(t('repo.whitelistClearSuccess') , 'success');
                loadWhitelist();
            } catch(e) { toast(String(e), 'error'); }
        });
    }

    if (btnExportWhitelist) {
        btnExportWhitelist.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentWhitelist, null, 2));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", "bmm_whitelist_export.json");
            dlAnchorElem.click();
            toast(t('repo.exportSuccess') , 'success');
        });
    }

    if (btnOpenWhitelist) {
        btnOpenWhitelist.addEventListener('click', () => {
            modalWhitelist.classList.add('open');
            loadWhitelist();
        });
    }

    document.querySelectorAll('[data-close="modal-whitelist"]').forEach(btn => {
        btn.onclick = () => { if(modalWhitelist) modalWhitelist.classList.remove('open'); };
    });
    modalWhitelist?.addEventListener('click', (e) => {
        if (e.target === modalWhitelist) modalWhitelist.classList.remove('open');
    });

}
