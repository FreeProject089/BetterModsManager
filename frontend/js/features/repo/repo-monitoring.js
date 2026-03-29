// @ts-nocheck
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { copyToClipboard } from './repo.js';
export function initRepoMonitoring(elements) {
    const { modalMonitoring, monitoringListBody, monitoringEmptyHint, btnOpenMonitoring } = elements;
    let monitoringInterval = null;
    const startMonitoring = () => {
        if (monitoringInterval)
            clearInterval(monitoringInterval);
        updateMonitoring();
        monitoringInterval = setInterval(updateMonitoring, 1000);
    };
    const stopMonitoring = () => {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
        modalMonitoring?.classList.remove('open');
    };
    const updateMonitoring = async () => {
        try {
            const downloads = await invoke('get_active_downloads');
            if (!downloads || downloads.length === 0) {
                if (monitoringListBody)
                    monitoringListBody.innerHTML = '';
                if (monitoringEmptyHint)
                    monitoringEmptyHint.style.display = 'block';
                return;
            }
            if (monitoringEmptyHint)
                monitoringEmptyHint.style.display = 'none';
            if (monitoringListBody) {
                monitoringListBody.innerHTML = downloads.map(d => {
                    const pct = Math.min(Math.round(d.progress) || 0, 100);
                    const speed = d.speed || 0;
                    const creatorIdHtml = d.creator_id && d.creator_id !== '-' ?
                        `<div style="display:flex; align-items:center; gap:6px;">
                            <span style="overflow:hidden; text-overflow:ellipsis;">${escHtml(d.creator_id)}</span>
                            <button class="btn btn-ghost btn-xs copy-mon-id" data-val="${escAttr(d.creator_id)}" style="padding:0; min-width:20px; height:20px; opacity:0.5; border:none; background:transparent;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                        </div>` : '<span style="opacity:0.35; font-weight:800; font-size:14px;">-</span>';
                    const protocol = d.protocol || 'Unknown';
                    const protocolColor = protocol === 'LAN' ? 'var(--success)' : protocol === 'WAN' ? 'var(--accent)' : 'var(--cyan)';
                    const protocolBg = protocol === 'LAN' ? 'rgba(16, 185, 129, 0.1)' : protocol === 'WAN' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(6, 182, 212, 0.1)';
                    return `
                        <tr>
                            <td>
                                <div style="display:flex; align-items:center; gap:6px;">
                                    <span style="font-weight:600;">${escHtml(d.ip)}</span>
                                    <button class="btn btn-ghost btn-xs copy-mon-id" data-val="${escAttr(d.ip)}" style="padding:0; min-width:20px; height:20px; opacity:0.5; border:none; background:transparent;">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                    </button>
                                </div>
                            </td>
                            <td style="color:var(--text-secondary); max-width:140px;">${creatorIdHtml}</td>
                            <td>
                                <span style="font-size:10px; font-weight:900; background:${protocolBg}; border:1px solid rgba(255,255,255,0.05); padding:3px 8px; border-radius:6px; color:${protocolColor}; letter-spacing:0.05em;">${protocol}</span>
                            </td>
                            <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" title="${escAttr(d.file)}">${escHtml(d.file)}</td>
                            <td>
                                <div class="mon-progress-container">
                                    <div class="mon-progress-bar">
                                        <div class="mon-progress-fill" style="width:${pct}%;"></div>
                                    </div>
                                    <span style="font-weight:800; font-size:11px; min-width:35px; color:${pct === 100 ? 'var(--success)' : 'var(--text-primary)'}">${pct}%</span>
                                </div>
                            </td>
                            <td style="font-family:var(--font-mono); font-weight:600; color:var(--cyan);">${formatBytes(speed)}/s</td>
                            <td style="text-align:right;">
                                <div style="display:flex; justify-content:flex-end; gap:6px;">
                                    <button class="btn btn-ghost btn-xs whitelist-from-mon" data-ip="${escAttr(d.ip)}" data-key="${escAttr(d.creator_id || '')}" style="color:var(--accent); font-weight:800; padding:4px 10px; border-radius:8px; background:rgba(59, 130, 246, 0.08);">
                                        ${t('repo.whitelistBtn') || 'AUTORISER'}
                                    </button>
                                    <button class="btn btn-ghost btn-xs ban-from-mon" data-ip="${escAttr(d.ip)}" data-key="${escAttr(d.creator_id || '')}" style="color:var(--danger); font-weight:800; padding:4px 10px; border-radius:8px; background:rgba(239, 68, 68, 0.08);">
                                        ${t('repo.banBtn') || 'BANNIR'}
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
                // Attach listeners
                monitoringListBody.querySelectorAll('.whitelist-from-mon').forEach(btn => {
                    btn.onclick = () => {
                        const ip = btn.dataset.ip;
                        const key = btn.dataset.key;
                        invoke('add_to_whitelist', { ip: ip || null, key: key || null })
                            .then(() => toast(t('repo.whitelistAddSuccess') || "Ajouté à la whitelist !", 'success'))
                            .catch(e => toast(String(e), 'error'));
                    };
                });
                monitoringListBody.querySelectorAll('.ban-from-mon').forEach(btn => {
                    btn.onclick = () => {
                        if (window.banUser)
                            window.banUser(btn.dataset.ip, btn.dataset.key);
                    };
                });
                monitoringListBody.querySelectorAll('.copy-mon-id').forEach(btn => {
                    btn.onclick = () => copyToClipboard(btn.dataset.val);
                });
            }
        }
        catch (err) {
            console.error("[BMM] Monitoring error:", err);
        }
    };
    if (btnOpenMonitoring) {
        btnOpenMonitoring.addEventListener('click', () => {
            modalMonitoring.classList.add('open');
            startMonitoring();
        });
    }
    document.querySelectorAll('[data-close="modal-monitoring"]').forEach(btn => {
        btn.addEventListener('click', stopMonitoring);
    });
    modalMonitoring?.addEventListener('click', (e) => {
        if (e.target === modalMonitoring)
            stopMonitoring();
    });
    return {
        updateMonitoring
    };
}
//# sourceMappingURL=repo-monitoring.js.map