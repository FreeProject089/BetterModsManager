// @ts-nocheck
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { copyToClipboard } from './repo.js';
import { toast } from '../../ui/app.js';
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
    const _updateStatBar = (clientCount, totalSpeed, activeFiles) => {
        const elClients = document.getElementById('monitoring-stat-clients');
        const elSpeed = document.getElementById('monitoring-stat-speed');
        const elFiles = document.getElementById('monitoring-stat-files');
        if (elClients)
            elClients.textContent = String(clientCount);
        if (elSpeed)
            elSpeed.textContent = totalSpeed > 0 ? formatBytes(totalSpeed) + '/s' : '0 KB/s';
        if (elFiles)
            elFiles.textContent = String(activeFiles);
    };
    const updateMonitoring = async () => {
        try {
            const [clients, downloads] = await Promise.all([
                invoke('get_connected_clients').catch(() => []),
                invoke('get_active_downloads').catch(() => [])
            ]);
            // Merge clients and downloads, using downloads as the source of truth for active ones
            const allClients = new Map();
            // Add/override with active downloads first (they take priority)
            downloads.forEach(d => {
                // Clean creator_id if it's a Some() wrapper format
                let cleanCreatorId = d.creator_id;
                if (typeof cleanCreatorId === 'string' && cleanCreatorId.startsWith('Some(') && cleanCreatorId.endsWith(')')) {
                    cleanCreatorId = cleanCreatorId.slice(5, -1);
                }
                allClients.set(`${d.ip}|${cleanCreatorId || ''}`, {
                    ...d,
                    creator_id: cleanCreatorId,
                    status: 'downloading'
                });
            });
            // Add idle clients only if not already in downloads
            clients.forEach(c => {
                // Clean creator_id if it's a Some() wrapper format
                let cleanCreatorId = c.creator_id;
                if (typeof cleanCreatorId === 'string' && cleanCreatorId.startsWith('Some(') && cleanCreatorId.endsWith(')')) {
                    cleanCreatorId = cleanCreatorId.slice(5, -1);
                }
                const key = `${c.ip}|${cleanCreatorId || ''}`;
                if (!allClients.has(key)) {
                    allClients.set(key, {
                        ...c,
                        creator_id: cleanCreatorId,
                        status: 'idle'
                    });
                }
            });
            const mergedClients = Array.from(allClients.values());
            if (!mergedClients || mergedClients.length === 0) {
                _updateStatBar(0, 0, 0);
                if (monitoringListBody)
                    monitoringListBody.innerHTML = '';
                if (monitoringEmptyHint)
                    monitoringEmptyHint.style.display = 'block';
                return;
            }
            // Compute stats for the bar
            const totalSpeed = mergedClients.reduce((sum, d) => sum + (d.status === 'downloading' ? (d.speed || 0) : 0), 0);
            const activeFiles = mergedClients.filter(d => d.status === 'downloading').length;
            _updateStatBar(mergedClients.length, totalSpeed, activeFiles);
            if (monitoringEmptyHint)
                monitoringEmptyHint.style.display = 'none';
            if (monitoringListBody) {
                monitoringListBody.innerHTML = mergedClients.map(d => {
                    const isDownloading = d.status === 'downloading';
                    const pct = isDownloading ? Math.min(Math.round(d.progress) || 0, 100) : 0;
                    const speed = isDownloading ? (d.speed || 0) : 0;
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
                    const statusColor = isDownloading ? 'var(--cyan)' : 'var(--text-secondary)';
                    const statusText = isDownloading ? (t('repo.downloading') || 'DOWNLOADING') : (t('repo.idle') || 'IDLE');
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
                            <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" title="${escAttr(d.file || '-')}">${escHtml(d.file || '-')}</td>
                            <td>
                                ${isDownloading ? `
                                <div class="mon-progress-container">
                                    <div class="mon-progress-bar">
                                        <div class="mon-progress-fill" style="width:${pct}%;"></div>
                                    </div>
                                    <span style="font-weight:800; font-size:11px; min-width:35px; color:${pct === 100 ? 'var(--success)' : 'var(--text-primary)'}">${pct}%</span>
                                </div>
                                ` : `<span style="font-size:11px; font-weight:600; color:${statusColor};">${statusText}</span>`}
                            </td>
                            <td style="font-family:var(--font-mono); font-weight:600; color:var(--cyan);">${isDownloading ? formatBytes(speed) + '/s' : '-'}</td>
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